import { useCallback, useEffect, useRef, useState } from 'react';

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

const _win = window as Window & {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
};
const SpeechRecognition = _win.SpeechRecognition || _win.webkitSpeechRecognition;
const HAS_BROWSER_STT = !!SpeechRecognition;
export const HAS_MEDIA_DEVICES = !!(navigator.mediaDevices?.getUserMedia);

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useVoiceInput(onTranscript: (text: string) => void, lang?: string) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

    if (permissionState !== 'granted') {
      const ok = await requestMicPermission();
      if (!ok) return;
    }

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
        // Fall through to server-side transcription.
      }
    }

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
  }, [lang, listening, onTranscript, permissionState, requestMicPermission]);

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
    };
  }, []);

  const available = HAS_BROWSER_STT || HAS_MEDIA_DEVICES;
  return { listening, start, stop, available, error, permissionState };
}
