export const SOUND_OPTIONS: { id: string; label: string; url: string }[] = [
  { id: 'warm-bell', label: 'Warm Bell', url: '/sounds/warm-bell.mp3' },
  { id: 'bright-ping', label: 'Bright Ping', url: '/sounds/bright-ping.mp3' },
  { id: 'soft-chime', label: 'Soft Chime', url: '/sounds/soft-chime.mp3' },
  { id: 'gentle-pop', label: 'Gentle Pop', url: '/sounds/gentle-pop.mp3' },
  { id: 'pluck', label: 'Pluck', url: '/sounds/pluck.mp3' },
  { id: 'click', label: 'Click', url: '/sounds/click.mp3' },
  { id: 'alert-tone', label: 'Alert Tone', url: '/sounds/alert-tone.mp3' },
  { id: 'none', label: 'None', url: '' },
];

const DEFAULT_AGENT_SOUNDS: Record<string, string> = {
  claude: 'warm-bell',
  codex: 'bright-ping',
  gemini: 'soft-chime',
  grok: 'pluck',
  copilot: 'click',
  aider: 'alert-tone',
  default: 'gentle-pop',
};

let muted = false;
let volume = 0.5;
const cache: Record<string, HTMLAudioElement> = {};

// Custom per-agent sound assignments (persisted via settings)
let _customSounds: Record<string, string> = {};

function getSoundUrl(soundId: string): string {
  const opt = SOUND_OPTIONS.find(s => s.id === soundId);
  return opt?.url || '';
}

function getAudio(url: string): HTMLAudioElement {
  if (!cache[url]) {
    cache[url] = new Audio(url);
  }
  return cache[url];
}

export const SoundManager = {
  play(agentBase: string) {
    if (muted) return;
    const soundId = _customSounds[agentBase] || DEFAULT_AGENT_SOUNDS[agentBase] || DEFAULT_AGENT_SOUNDS.default;
    if (soundId === 'none') return;
    const url = getSoundUrl(soundId);
    if (!url) return;
    try {
      const audio = getAudio(url);
      audio.volume = volume;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  },

  preview(soundId: string) {
    const url = getSoundUrl(soundId);
    if (!url) return;
    try {
      const audio = getAudio(url);
      audio.volume = volume;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } catch {}
  },

  setVolume(v: number) {
    volume = Math.max(0, Math.min(1, v));
  },

  setMuted(m: boolean) {
    muted = m;
  },

  isMuted() {
    return muted;
  },

  setCustomSounds(sounds: Record<string, string>) {
    _customSounds = sounds;
  },

  getCustomSounds(): Record<string, string> {
    return { ...DEFAULT_AGENT_SOUNDS, ..._customSounds };
  },

  getSoundForAgent(agentBase: string): string {
    return _customSounds[agentBase] || DEFAULT_AGENT_SOUNDS[agentBase] || DEFAULT_AGENT_SOUNDS.default;
  },
};
