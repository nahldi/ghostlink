import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';

interface VoiceCallProps {
  onClose: () => void;
}

/**
 * VoiceCall — live conversation overlay with agent.
 * Continuously records audio, transcribes, sends to agent, and plays TTS responses.
 */
export function VoiceCall({ onClose }: VoiceCallProps) {
  const [callTime, setCallTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastResponse, setLastResponse] = useState('');
  const [error, setError] = useState('');

  const agents = useChatStore((s) => s.agents);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const settings = useChatStore((s) => s.settings);
  const messages = useChatStore((s) => s.messages);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(true);
  const lastMsgCountRef = useRef(messages.length);
  const audioQueueRef = useRef<HTMLAudioElement[]>([]);

  const onlineAgent = agents.find(a => a.state === 'active' || a.state === 'idle');
  const agentName = onlineAgent?.label || onlineAgent?.name || 'Agent';
  const agentColor = onlineAgent?.color || '#a78bfa';
  const waveformHeights = speaking || agentSpeaking ? [14, 22, 30, 22, 14] : [4, 4, 4, 4, 4];

  // Call timer
  useEffect(() => {
    timerRef.current = setInterval(() => setCallTime(t => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Watch for new agent messages → auto-TTS
  useEffect(() => {
    if (messages.length > lastMsgCountRef.current) {
      const newMsgs = messages.slice(lastMsgCountRef.current);
      for (const msg of newMsgs) {
        if (msg.sender !== settings.username && msg.sender !== 'You' && msg.sender !== 'system' && msg.type === 'chat') {
          setLastResponse(msg.text.slice(0, 200));
          // Auto-TTS the agent's response
          (async () => {
            try {
              setAgentSpeaking(true);
              const r = await api.textToSpeech(msg.text.slice(0, 1000));
              if (r.audio) {
                const audio = new Audio(r.audio);
                audio.onended = () => setAgentSpeaking(false);
                audio.onerror = () => setAgentSpeaking(false);
                audioQueueRef.current.push(audio);
                audio.play().catch(() => setAgentSpeaking(false));
              } else {
                setAgentSpeaking(false);
              }
            } catch {
              setAgentSpeaking(false);
            }
          })();
        }
      }
    }
    lastMsgCountRef.current = messages.length;
  }, [messages, settings.username]);

  // Start continuous recording
  const startListening = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingRef.current = true;

      const recordChunk = () => {
        if (!recordingRef.current || !streamRef.current) return;
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = async () => {
          if (!recordingRef.current) return;
          const blob = new Blob(chunks, { type: 'audio/webm' });
          if (blob.size > 1000) { // skip tiny chunks (silence)
            try {
              setSpeaking(true);
              const form = new FormData();
              form.append('audio', blob, 'chunk.webm');
              const resp = await fetch('/api/transcribe', { method: 'POST', body: form });
              if (resp.ok) {
                const data = await resp.json();
                const text = data.text?.trim();
                if (text && text.length > 1) {
                  setLastTranscript(text);
                  // Send as message
                  await api.sendMessage(text, activeChannel, settings.username);
                }
              }
            } catch { /* best-effort */ }
            setSpeaking(false);
          }
          // Start next chunk
          if (recordingRef.current) setTimeout(recordChunk, 200);
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
        // Stop after 4 seconds to send chunk
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop();
        }, 4000);
      };

      recordChunk();
    } catch {
      setError('Microphone access denied');
    }
  }, [activeChannel, settings.username]);

  // Start listening on mount
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void startListening();
    });
    const queuedAudio = audioQueueRef.current;
    return () => {
      cancelled = true;
      recordingRef.current = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
      queuedAudio.forEach(a => { a.pause(); a.src = ''; });
    };
  }, [startListening]);

  // Toggle mute
  const toggleMute = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    }
    setMuted(!muted);
  };

  const endCall = () => {
    recordingRef.current = false;
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioQueueRef.current.forEach(a => { a.pause(); a.src = ''; });
    onClose();
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" />

        <motion.div
          className="relative flex flex-col items-center gap-6 p-8"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
        >
          {/* Agent avatar */}
          <div className="relative">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold"
              style={{
                background: `${agentColor}20`,
                border: `3px solid ${agentColor}`,
                boxShadow: agentSpeaking ? `0 0 30px ${agentColor}40` : 'none',
                transition: 'box-shadow 0.3s',
              }}
            >
              <span style={{ color: agentColor }}>{agentName[0]?.toUpperCase()}</span>
            </div>
            {agentSpeaking && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-xs text-white">volume_up</span>
              </div>
            )}
          </div>

          {/* Agent name + call time */}
          <div className="text-center">
            <div className="text-lg font-semibold text-on-surface">{agentName}</div>
            <div className="text-sm text-on-surface-variant/50 font-mono">{formatTime(callTime)}</div>
          </div>

          {/* Status */}
          <div className="text-center max-w-xs">
            {error ? (
              <div className="text-[11px] text-red-400">{error}</div>
            ) : speaking ? (
              <div className="text-[11px] text-primary/60">Listening...</div>
            ) : agentSpeaking ? (
              <div className="text-[11px] text-green-400/60">Speaking...</div>
            ) : (
              <div className="text-[11px] text-on-surface-variant/30">Speak to {agentName}</div>
            )}
            {lastTranscript && (
              <div className="mt-2 text-[10px] text-on-surface-variant/40 italic truncate">You: {lastTranscript}</div>
            )}
            {lastResponse && (
              <div className="mt-1 text-[10px] text-primary/40 italic truncate">{agentName}: {lastResponse}</div>
            )}
          </div>

          {/* Waveform indicator */}
          <div className="flex items-center gap-1 h-8">
            {waveformHeights.map((height, i) => (
              <div
                key={i}
                className="w-1 rounded-full transition-all duration-150"
                style={{
                  height: `${height}px`,
                  background: agentSpeaking ? '#34d399' : speaking ? agentColor : 'rgba(255,255,255,0.1)',
                  transition: 'height 0.15s, background 0.3s',
                }}
              />
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6">
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                muted ? 'bg-red-500/20 text-red-400' : 'bg-surface-container-high/50 text-on-surface-variant/60 hover:text-on-surface'
              }`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <span className="material-symbols-outlined text-xl">{muted ? 'mic_off' : 'mic'}</span>
            </button>

            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
              aria-label="End call"
            >
              <span className="material-symbols-outlined text-2xl">call_end</span>
            </button>

            {/* Speaker indicator — audio plays automatically */}
            <div
              className="w-14 h-14 rounded-full bg-surface-container-high/30 text-on-surface-variant/40 flex items-center justify-center"
              title="Audio plays automatically"
            >
              <span className="material-symbols-outlined text-xl">volume_up</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
