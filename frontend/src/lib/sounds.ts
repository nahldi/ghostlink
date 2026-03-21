const AGENT_SOUNDS: Record<string, string> = {
  claude: '/sounds/warm-bell.mp3',
  codex: '/sounds/bright-ping.mp3',
  gemini: '/sounds/soft-chime.mp3',
  default: '/sounds/gentle-pop.mp3',
};

let muted = false;
let volume = 0.5;
const cache: Record<string, HTMLAudioElement> = {};

function getAudio(url: string): HTMLAudioElement {
  if (!cache[url]) {
    cache[url] = new Audio(url);
  }
  return cache[url];
}

export const SoundManager = {
  play(agentBase: string) {
    if (muted) return;
    const url = AGENT_SOUNDS[agentBase] || AGENT_SOUNDS.default;
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
};
