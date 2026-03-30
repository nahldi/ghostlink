import { useState, useRef, useCallback, useMemo, useEffect, type KeyboardEvent, type ClipboardEvent } from 'react';
import { motion } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useMentionAutocomplete } from '../hooks/useMentionAutocomplete';
import { api } from '../lib/api';
import { toast } from './Toast';
import { VoiceCall } from './VoiceCall';

// ── Voice Input (Web Speech API) ───────────────────────────────────

// Web Speech API types (not in standard TS lib)
interface SpeechRecognitionResult { readonly [index: number]: { transcript: string; confidence: number }; }
interface SpeechRecognitionResultList { readonly length: number; readonly [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvent extends Event { readonly results: SpeechRecognitionResultList; }
interface SpeechRecognitionErrorEvent extends Event { readonly error: string; readonly message?: string; }
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const _win = window as Window & { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance };
const SpeechRecognition = _win.SpeechRecognition || _win.webkitSpeechRecognition;
const HAS_BROWSER_STT = !!SpeechRecognition;
const HAS_MEDIA_DEVICES = !!(navigator.mediaDevices?.getUserMedia);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useVoiceInput(onTranscript: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Check mic permission on mount
  useEffect(() => {
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then(result => {
        setPermissionState(result.state as 'granted' | 'denied' | 'prompt');
        result.addEventListener('change', () => setPermissionState(result.state as 'granted' | 'denied' | 'prompt'));
      }).catch(() => setPermissionState('unknown'));
    }
  }, []);

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    if (!HAS_MEDIA_DEVICES) {
      setError('Microphone not supported in this browser');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Got permission — stop the test stream
      stream.getTracks().forEach(t => t.stop());
      setPermissionState('granted');
      setError('');
      return true;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === 'NotAllowedError') {
        setPermissionState('denied');
        setError('Microphone access denied. Check browser permissions.');
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Connect a microphone and try again.');
      } else {
        setError('Microphone error: ' + err.message);
      }
      return false;
    }
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    setError('');

    // Request permission first if needed
    if (permissionState !== 'granted') {
      const ok = await requestMicPermission();
      if (!ok) return;
    }

    // Try browser SpeechRecognition first (real-time, free)
    if (HAS_BROWSER_STT) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = lang || navigator.language || 'en-US';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          onTranscript(transcript);
          setListening(false);
        };

        recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
          if (e.error === 'not-allowed') {
            setError('Microphone access denied');
            setPermissionState('denied');
          } else if (e.error === 'no-speech') {
            setError('No speech detected. Try again.');
          } else {
            setError('Speech recognition error: ' + (e.error || 'unknown'));
          }
          setListening(false);
        };

        recognition.onend = () => setListening(false);

        recognitionRef.current = recognition;
        recognition.start();
        setListening(true);
        return;
      } catch {
        // Fall through to server-side
      }
    }

    // Fallback: Record audio and send to /api/transcribe (Whisper)
    if (HAS_MEDIA_DEVICES) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
          // Send to server for transcription
          try {
            const fd = new FormData();
            fd.append('audio', audioBlob, 'recording.webm');
            const resp = await fetch('/api/transcribe', { method: 'POST', body: fd });
            if (resp.ok) {
              const data = await resp.json();
              if (data.text) onTranscript(data.text);
              else setError('No speech detected');
            } else {
              const err = await resp.json().catch(() => ({ error: 'Transcription failed' }));
              setError(err.error || 'Transcription failed');
            }
          } catch (e: unknown) {
            setError('Transcription error: ' + getErrorMessage(e));
          }
          setListening(false);
        };

        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start();
        setListening(true);
      } catch (e: unknown) {
        setError('Could not start recording: ' + getErrorMessage(e));
      }
    } else {
      setError('Voice input not available in this browser');
    }
  }, [listening, onTranscript, lang, permissionState, requestMicPermission]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setListening(false);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  const available = HAS_BROWSER_STT || HAS_MEDIA_DEVICES;
  return { listening, start, stop, available, error, permissionState };
}

interface SlashCommand {
  name: string;
  description: string;
  execute: () => void;
}

// Command history stored in localStorage
const HISTORY_KEY = 'ghostlink_cmd_history';
const MAX_HISTORY = 100;

function getHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function pushHistory(msg: string) {
  try {
    const h = getHistory().filter(m => m !== msg);
    h.push(msg);
    if (h.length > MAX_HISTORY) h.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch { /* localStorage full or unavailable — ignore */ }
}

export function MessageInput() {
  const [text, setText] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<{ name: string; url: string; type: string }[]>([]);
  // Voice note recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeChannel = useChatStore((s) => s.activeChannel);
  const settings = useChatStore((s) => s.settings);
  const pendingInput = useChatStore((s) => s.pendingInput);
  const setPendingInput = useChatStore((s) => s.setPendingInput);

  // Watch for external input (from SearchModal command palette)
  useEffect(() => {
    if (pendingInput) {
      // Defer setState to avoid synchronous set-state-in-effect
      queueMicrotask(() => {
        setText(pendingInput);
        setPendingInput('');
        textareaRef.current?.focus();
      });
    }
  }, [pendingInput, setPendingInput]);
  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const messages = useChatStore((s) => s.messages);
  const agents = useChatStore((s) => s.agents);
  const setMessages = useChatStore((s) => s.setMessages);
  const addMessage = useChatStore((s) => s.addMessage);

  const { suggestions, selectedIndex, setSelectedIndex, isOpen, applyMention } =
    useMentionAutocomplete(text, cursorPos);

  // Voice input hook kept for potential fallback but mic button now uses MediaRecorder directly
  const voiceFallback = useVoiceInput(
    (transcript) => setText(prev => (prev ? `${prev} ${transcript}` : transcript)),
    settings.voiceLanguage
  );
  const canUseVoiceInput = HAS_MEDIA_DEVICES || voiceFallback.available;

  // Slash commands
  const slashCommands: SlashCommand[] = useMemo(() => [
    {
      name: '/status',
      description: 'Show agent states',
      execute: () => {
        const lines = agents.length
          ? agents.map(a => `${a.label || a.name}: ${a.state}`).join('\n')
          : 'No agents registered';
        addMessage({
          id: Date.now(),
          uid: 'cmd-' + Date.now(),
          sender: 'system',
          text: lines,
          type: 'system',
          timestamp: Date.now() / 1000,
          time: new Date().toLocaleTimeString(),
          channel: activeChannel,
        });
      },
    },
    {
      name: '/clear',
      description: 'Clear chat display',
      execute: () => {
        setMessages(messages.filter(m => m.channel !== activeChannel));
      },
    },
    {
      name: '/export',
      description: 'Download channel as markdown',
      execute: () => {
        const channelMsgs = messages.filter(m => m.channel === activeChannel);
        const md = channelMsgs
          .map(m => `**${m.sender}** (${m.time})\n${m.text}`)
          .join('\n\n---\n\n');
        const blob = new Blob([`# #${activeChannel}\n\n${md}`], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeChannel}-export.md`;
        a.click();
        URL.revokeObjectURL(url);
      },
    },
    {
      name: '/ping',
      description: 'Check if backend is alive',
      execute: () => {
        const t0 = performance.now();
        api.getStatus().then(() => {
          const ms = Math.round(performance.now() - t0);
          addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: `Pong! (${ms}ms)`, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
        }).catch((e) => {
          console.warn('Ping failed:', e instanceof Error ? e.message : String(e));
          addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Backend unreachable', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
        });
      },
    },
    {
      name: '/theme',
      description: 'Toggle dark/light theme',
      execute: () => {
        const current = useChatStore.getState().settings.theme;
        const next = current === 'dark' ? 'light' : 'dark';
        useChatStore.getState().updateSettings({ theme: next });
        api.saveSettings({ theme: next }).catch((e: unknown) => console.warn('Settings save:', getErrorMessage(e)));
      },
    },
    {
      name: '/focus',
      description: 'Scroll to bottom & clear unread',
      execute: () => {
        const feed = document.querySelector('[data-chat-feed]') as HTMLElement;
        if (feed) { feed.scrollTop = feed.scrollHeight; }
        useChatStore.getState().clearUnread(activeChannel);
        useChatStore.getState().setChatAtBottom(true);
        useChatStore.getState().setNewMsgCount(0);
      },
    },
    {
      name: '/pinned',
      description: 'List pinned messages',
      execute: () => {
        const pinned = messages.filter(m => m.channel === activeChannel && m.pinned);
        const text = pinned.length
          ? pinned.map(m => `[${m.sender}] ${m.text.slice(0, 80)}${m.text.length > 80 ? '...' : ''}`).join('\n')
          : 'No pinned messages in this channel';
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/bookmarks',
      description: 'List bookmarked messages',
      execute: () => {
        const bookmarked = messages.filter(m => m.channel === activeChannel && m.bookmarked);
        const text = bookmarked.length
          ? bookmarked.map(m => `[${m.sender}] ${m.text.slice(0, 80)}${m.text.length > 80 ? '...' : ''}`).join('\n')
          : 'No bookmarked messages in this channel';
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/jobs',
      description: 'Open jobs panel',
      execute: () => {
        useChatStore.getState().setSidebarPanel('jobs');
      },
    },
    {
      name: '/rules',
      description: 'Open rules panel',
      execute: () => {
        useChatStore.getState().setSidebarPanel('rules');
      },
    },
    {
      name: '/settings',
      description: 'Open settings panel',
      execute: () => {
        useChatStore.getState().setSidebarPanel('settings');
      },
    },
    {
      name: '/debug',
      description: 'Toggle debug mode',
      execute: () => {
        const current = useChatStore.getState().settings.debugMode;
        useChatStore.getState().updateSettings({ debugMode: !current });
        api.saveSettings({ debugMode: !current }).catch((e: unknown) => console.warn('Settings save:', getErrorMessage(e)));
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: `Debug mode: ${!current ? 'ON' : 'OFF'}`, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/notify',
      description: 'Test desktop notification',
      execute: () => {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('GhostLink', { body: 'Notifications are working!', icon: '/favicon.ico' });
        } else if ('Notification' in window) {
          Notification.requestPermission().then(p => {
            if (p === 'granted') new Notification('GhostLink', { body: 'Notifications enabled!', icon: '/favicon.ico' });
          });
        }
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Notification test sent', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/mute',
      description: 'Mute notification sounds',
      execute: () => {
        useChatStore.getState().updateSettings({ notificationSounds: false });
        api.saveSettings({ notificationSounds: false }).catch((e: unknown) => console.warn('Settings save:', getErrorMessage(e)));
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Notifications muted', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/unmute',
      description: 'Unmute notification sounds',
      execute: () => {
        useChatStore.getState().updateSettings({ notificationSounds: true });
        api.saveSettings({ notificationSounds: true }).catch((e: unknown) => console.warn('Settings save:', getErrorMessage(e)));
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Notifications unmuted', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/agents',
      description: 'List all agents with details',
      execute: () => {
        const lines = agents.length
          ? agents.map(a => `${a.label} (@${a.name}) — ${a.state}${a.role ? ` [${a.role}]` : ''}${a.workspace ? ` in ${a.workspace}` : ''}`).join('\n')
          : 'No agents registered';
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: lines, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/stats',
      description: 'Show session statistics',
      execute: () => {
        const online = agents.filter(a => a.state === 'active' || a.state === 'thinking').length;
        const totalMsgs = messages.length;
        const chMsgs = messages.filter(m => m.channel === activeChannel).length;
        const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
        const estTokens = Math.round(totalChars / 4);
        const lines = [
          `Agents: ${online}/${agents.length} online`,
          `Messages: ${totalMsgs} total, ${chMsgs} in #${activeChannel}`,
          `Est. tokens: ~${estTokens > 1000 ? (estTokens / 1000).toFixed(1) + 'K' : estTokens}`,
          `Channels: ${useChatStore.getState().channels.length}`,
        ];
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: lines.join('\n'), type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/role',
      description: 'Set agent role: /role [agent] [manager|worker|peer]',
      execute: () => {
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Usage: /role [agent-name] [manager|worker|peer]\nType the full command with arguments.', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/consensus',
      description: 'Ask all agents a question',
      execute: () => {
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Usage: /consensus [question]\nAsks all online agents the same question independently.', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/debate',
      description: 'Start a debate between two agents',
      execute: () => {
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Usage: /debate [agent1] [agent2] [topic]\nStarts a structured debate between two agents.', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/spawn',
      description: 'Launch agent: /spawn [base] [label]',
      execute: () => {
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Usage: /spawn [base] [label]\nExample: /spawn claude my-claude\nType the full command with arguments.', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/kill',
      description: 'Stop an agent: /kill [agent-name]',
      execute: () => {
        addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text: 'Usage: /kill [agent-name]\nType the full command with arguments.', type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });
      },
    },
    {
      name: '/help',
      description: 'Show available commands',
      execute: () => {
        const lines = [
          '/status — show agent states',
          '/clear — clear chat display',
          '/export — download channel as markdown',
          '/ping — check backend latency',
          '/theme — toggle dark/light theme',
          '/focus — scroll to bottom',
          '/mute — mute notifications',
          '/unmute — unmute notifications',
          '/agents — list agents with details',
          '/stats — show session statistics',
          '/role [agent] [role] — set agent role',
          '/spawn [base] [label] — launch agent',
          '/kill [agent] — stop agent',
          '/pinned — list pinned messages',
          '/bookmarks — list bookmarked messages',
          '/jobs — open jobs panel',
          '/rules — open rules panel',
          '/settings — open settings panel',
          '/debug — toggle debug mode',
          '/notify — test desktop notification',
          '/help — show this help',
        ];
        addMessage({
          id: Date.now(),
          uid: 'cmd-' + Date.now(),
          sender: 'system',
          text: lines.join('\n'),
          type: 'system',
          timestamp: Date.now() / 1000,
          time: new Date().toLocaleTimeString(),
          channel: activeChannel,
        });
      },
    },
  ], [agents, activeChannel, messages, addMessage, setMessages]);

  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.toLowerCase() : '';
  const filteredCommands = slashQuery
    ? slashCommands.filter(c => c.name.startsWith(slashQuery))
    : [];
  const showSlash = filteredCommands.length > 0 && slashQuery.length > 0;

  // Voice note recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          try {
            await api.sendVoiceNote(blob, activeChannel, settings.username, recordingTime);
          } catch { /* best-effort */ }
        }
        setRecordingTime(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect data every 250ms
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch {
      /* mic permission denied or unavailable */
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream?.getTracks().forEach(t => t.stop());
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
  };

  const executeSlashCommand = (cmd: SlashCommand) => {
    cmd.execute();
    setText('');
    setSlashIndex(0);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > 100000) {
      toast('Message too long (max 100KB)', 'error');
      return;
    }

    // Check for slash command
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const cmdName = parts[0].toLowerCase();

      // Exact match for simple commands
      const cmd = slashCommands.find(c => c.name === trimmed || c.name === cmdName);
      if (cmd && parts.length === 1) {
        cmd.execute();
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      // Parameterized commands
      const sysMsg = (text: string) => addMessage({ id: Date.now(), uid: 'cmd-' + Date.now(), sender: 'system', text, type: 'system', timestamp: Date.now() / 1000, time: new Date().toLocaleTimeString(), channel: activeChannel });

      if (cmdName === '/spawn' && parts.length >= 2) {
        const base = parts[1];
        const label = parts[2] || base;
        sysMsg(`Spawning ${base} agent "${label}"...`);
        api.spawnAgent(base, label, '.', []).then(() => {
          setTimeout(() => api.getStatus().then(r => useChatStore.getState().setAgents(r.agents)).catch((e: unknown) => console.warn('Status fetch:', getErrorMessage(e))), 3000);
        }).catch(() => sysMsg(`Failed to spawn ${base}`));
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/kill' && parts.length >= 2) {
        const name = parts[1];
        sysMsg(`Stopping agent "${name}"...`);
        api.killAgent(name).then(() => {
          api.getStatus().then(r => useChatStore.getState().setAgents(r.agents)).catch((e: unknown) => console.warn('Status fetch:', getErrorMessage(e)));
        }).catch(() => sysMsg(`Failed to stop ${name}`));
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/role' && parts.length >= 3) {
        const agentName = parts[1];
        const role = parts[2] as 'manager' | 'worker' | 'peer';
        if (['manager', 'worker', 'peer'].includes(role)) {
          sysMsg(`Setting ${agentName} role to ${role}...`);
          api.setAgentConfig(agentName, { role }).then(() => {
            sysMsg(`${agentName} is now a ${role}`);
            api.getStatus().then(r => useChatStore.getState().setAgents(r.agents)).catch((e: unknown) => console.warn('Status fetch:', getErrorMessage(e)));
          }).catch(() => sysMsg(`Failed to set role — agent "${agentName}" may not be registered`));
        } else {
          sysMsg('Invalid role. Use: manager, worker, or peer');
        }
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/focus' && parts.length >= 2) {
        const agentName = parts[1];
        const topic = parts.slice(2).join(' ');
        sysMsg(`Focusing ${agentName}${topic ? ` on "${topic}"` : ''}`);
        api.sendMessage(settings.username, trimmed, activeChannel).catch((e: unknown) => console.warn('Send message:', getErrorMessage(e)));
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/theme' && parts.length >= 2) {
        const theme = parts[1] as 'dark' | 'light';
        if (theme === 'dark' || theme === 'light') {
          useChatStore.getState().updateSettings({ theme });
          api.saveSettings({ theme }).catch((e: unknown) => console.warn('Settings save:', getErrorMessage(e)));
          sysMsg(`Theme set to ${theme}`);
        } else {
          sysMsg('Usage: /theme dark|light');
        }
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/consensus' && parts.length >= 2) {
        const question = parts.slice(1).join(' ');
        const onlineAgents = agents.filter(a => a.state === 'active' || a.state === 'thinking');
        if (onlineAgents.length === 0) {
          sysMsg('No agents online. Start an agent first.');
        } else {
          sysMsg(`Consensus: asking ${onlineAgents.length} agents — "${question}"`);
          // Send the question @all so every agent gets it
          api.sendMessage(settings.username, `@all ${question}`, activeChannel).catch((e: unknown) => console.warn('Consensus send:', getErrorMessage(e)));
        }
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/debate' && parts.length >= 4) {
        const agent1 = parts[1];
        const agent2 = parts[2];
        const topic = parts.slice(3).join(' ');
        sysMsg(`Debate started: @${agent1} (FOR) vs @${agent2} (AGAINST)\nTopic: ${topic}`);
        // Send initial prompts to both agents
        api.sendMessage(settings.username, `@${agent1} You are arguing FOR the following position. Make your case in 2-3 paragraphs: "${topic}"`, activeChannel).catch((e: unknown) => console.warn('Debate send (FOR):', getErrorMessage(e)));
        setTimeout(() => {
          api.sendMessage(settings.username, `@${agent2} You are arguing AGAINST the following position. Make your case in 2-3 paragraphs: "${topic}"`, activeChannel).catch((e: unknown) => console.warn('Debate send (AGAINST):', getErrorMessage(e)));
        }, 1000);
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (cmdName === '/ping' && parts.length >= 2) {
        const agentName = parts[1];
        const agent = agents.find(a => a.name === agentName);
        if (agent) {
          const isOn = agent.state === 'active' || agent.state === 'thinking' || agent.state === 'idle';
          sysMsg(`@${agentName} is ${isOn ? 'online' : agent.state}`);
        } else {
          sysMsg(`Agent "${agentName}" not found`);
        }
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      // Fallback: try exact command match
      if (cmd) {
        cmd.execute();
        setText('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }
    }

    try {
      pushHistory(trimmed);
      setHistoryIndex(-1);
      setSavedDraft('');
      await api.sendMessage(settings.username, trimmed, activeChannel, replyTo?.id, pendingAttachments.length > 0 ? pendingAttachments : undefined);
      setText('');
      setPendingAttachments([]);
      setReplyTo(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (e: unknown) {
      toast('Failed to send message', 'error');
    }
  }, [text, activeChannel, settings.username, replyTo, setReplyTo, slashCommands, pendingAttachments, addMessage, agents]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command picker navigation
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((slashIndex + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((slashIndex - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        setText(filteredCommands[slashIndex].name);
        setSlashIndex(0);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        executeSlashCommand(filteredCommands[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setText('');
        return;
      }
    }
    // Mention autocomplete
    if (isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((selectedIndex + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (selectedIndex - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const newText = applyMention(suggestions[selectedIndex].name);
        setText(newText);
        setSelectedIndex(0);
        return;
      }
      if (e.key === 'Escape') {
        setCursorPos(0);
        return;
      }
    }
    // Command history: Up/Down when input is empty or already browsing history
    if (e.key === 'ArrowUp' && !showSlash && !isOpen) {
      const ta = textareaRef.current;
      // Only activate if cursor is at start of input (or input is empty)
      if (ta && (ta.selectionStart === 0 || text === '')) {
        const history = getHistory();
        if (history.length > 0) {
          e.preventDefault();
          if (historyIndex === -1) setSavedDraft(text);
          const newIdx = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
          setHistoryIndex(newIdx);
          setText(history[newIdx]);
        }
        return;
      }
    }
    if (e.key === 'ArrowDown' && !showSlash && !isOpen && historyIndex >= 0) {
      e.preventDefault();
      const history = getHistory();
      const newIdx = historyIndex + 1;
      if (newIdx >= history.length) {
        setHistoryIndex(-1);
        setText(savedDraft);
      } else {
        setHistoryIndex(newIdx);
        setText(history[newIdx]);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const result = await api.uploadImage(file);
          if (result.url) {
            setText((prev) => prev + `![image](${result.url})`);
            setPendingAttachments((prev) => [...prev, { name: result.name || 'image', url: result.url, type: 'image' }]);
          }
        } catch (err) {
          toast('File upload failed', 'error');
        }
        return;
      }
    }
  };

  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 160) + 'px';
      setCursorPos(textareaRef.current.selectionStart);
    }
  };

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const result = await api.uploadImage(file);
        if (result.url) {
          setText((prev) => prev + `![image](${result.url})`);
          setPendingAttachments((prev) => [...prev, { name: result.name || file.name, url: result.url, type: 'image' }]);
        }
      } catch (err) {
        toast('File upload failed', 'error');
      }
    };
    input.click();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const result = await api.uploadImage(file);
          if (result.url) {
            setText((prev) => prev + `![${file.name}](${result.url})`);
          }
        } catch (err) {
          toast('File upload failed', 'error');
        }
      }
    }
  };

  return (
    <div
      className="relative"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/40 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 text-primary text-sm font-medium">
            <span className="material-symbols-outlined">cloud_upload</span>
            Drop files to upload
          </div>
        </div>
      )}

      {/* Reply indicator */}
      {replyTo && (
        <div className="w-full flex items-center gap-2 px-4 py-2 bg-surface-container border-t border-outline-variant/10 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-sm">reply</span>
          Replying to <span className="font-bold text-primary">{replyTo.sender}</span>
          <button
            onClick={() => setReplyTo(null)}
            className="ml-auto text-outline hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Mention autocomplete dropdown */}
      {isOpen && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-surface-container-high border border-outline-variant/20 rounded-lg overflow-hidden shadow-xl z-50">
          {suggestions.map((s, i) => (
            <button
              key={s.name}
              onClick={() => {
                const newText = applyMention(s.name);
                setText(newText);
                setSelectedIndex(0);
                textareaRef.current?.focus();
              }}
              className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors ${
                i === selectedIndex
                  ? 'bg-primary-container/20 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              <span className="font-bold">@{s.name}</span>
              <span className="text-outline">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Slash command picker */}
      {showSlash && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-surface-container-high border border-outline-variant/20 rounded-lg overflow-hidden shadow-xl z-50">
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.name}
              onClick={() => executeSlashCommand(cmd)}
              className={`w-full text-left px-4 py-2.5 text-xs flex items-center gap-3 transition-colors ${
                i === slashIndex
                  ? 'bg-primary-container/20 text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-highest'
              }`}
            >
              <span className="font-bold text-primary/80">{cmd.name}</span>
              <span className="text-outline">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="w-full flex items-end gap-2 p-3 lg:px-6 lg:py-4 safe-bottom">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('ghostlink:open-session-launcher'))}
          className="p-2 rounded-lg text-on-surface-variant/40 hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
          title="Start a session"
        >
          <span className="material-symbols-outlined text-xl">play_circle</span>
        </button>
        <button
          onClick={handleFileUpload}
          className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors shrink-0"
          title="Upload image"
        >
          <span className="material-symbols-outlined text-xl">attachment</span>
        </button>
        {/* Pending attachment previews */}
        {pendingAttachments.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.type.startsWith('image/') ? (
                  <img src={att.url} alt={att.name} className="w-8 h-8 rounded-lg object-cover border border-outline-variant/15" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center border border-outline-variant/15">
                    <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40">description</span>
                  </div>
                )}
                <button
                  onClick={() => setPendingAttachments(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-error/90 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${att.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={handleInput}
          placeholder={`Message #${activeChannel}...`}
          aria-label={`Message input for #${activeChannel}`}
          rows={1}
          className="flex-1 bg-surface-container/60 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/30 resize-none max-h-40 outline-none border border-outline-variant/8 focus:border-primary/25 focus:shadow-[0_0_16px_rgba(167,139,250,0.08)] transition-all"
        />
        {/* Voice Note Recording */}
        {isRecording ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-[11px] text-red-400 font-mono tabular-nums w-8">
              {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
            </span>
            <button onClick={cancelRecording} className="p-1.5 rounded-lg text-on-surface-variant/40 hover:text-red-400 hover:bg-red-500/10 transition-colors" aria-label="Cancel recording" title="Cancel">
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
            <button onClick={stopRecording} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" aria-label="Send voice note" title="Send voice note">
              <span className="material-symbols-outlined text-lg">send</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Mic button — voice note */}
            <button
              onClick={startRecording}
              disabled={!canUseVoiceInput}
              className="p-2.5 rounded-xl text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high/60 transition-all active:scale-90"
              title={canUseVoiceInput ? 'Record voice note' : 'Voice input unavailable in this browser'}
              aria-label="Record voice note"
            >
              <span className="material-symbols-outlined text-xl">mic</span>
            </button>
            {/* Phone button — voice call */}
            <button
              onClick={() => setShowVoiceCall(true)}
              disabled={!canUseVoiceInput}
              className="p-2.5 rounded-xl text-on-surface-variant/40 hover:text-on-surface hover:bg-surface-container-high/60 transition-all active:scale-90"
              title={canUseVoiceInput ? 'Start voice call' : 'Voice input unavailable in this browser'}
              aria-label="Start voice call with agent"
            >
              <span className="material-symbols-outlined text-xl">call</span>
            </button>
          </div>
        )}
        <motion.button
          onClick={handleSend}
          disabled={!text.trim()}
          whileTap={{ scale: 0.88 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="p-2.5 rounded-xl bg-primary-container text-primary-fixed hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <span className="material-symbols-outlined text-xl">send</span>
        </motion.button>
      </div>

      {/* Voice Call Overlay */}
      {showVoiceCall && <VoiceCall onClose={() => setShowVoiceCall(false)} />}
    </div>
  );
}
