import type { ReactNode } from 'react';

interface AgentIconProps {
  base: string;
  color: string;
  size?: number;
}

const ICONS: Record<string, (color: string) => ReactNode> = {
  claude: (color) => (
    // Anthropic sunburst/starburst
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" fill={color} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <line
          key={angle}
          x1="12"
          y1="12"
          x2={12 + 8 * Math.cos((angle * Math.PI) / 180)}
          y2={12 + 8 * Math.sin((angle * Math.PI) / 180)}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.85"
        />
      ))}
    </svg>
  ),
  codex: (color) => (
    // OpenAI hexagonal flower
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C13.5 5 16 6.5 19 6.5C19 9.5 20.5 12 22 13.5C20.5 15 19 17.5 19 20.5C16 20.5 13.5 22 12 24C10.5 22 8 20.5 5 20.5C5 17.5 3.5 15 2 13.5C3.5 12 5 9.5 5 6.5C8 6.5 10.5 5 12 2Z"
        fill={color}
        opacity="0.85"
        transform="scale(0.85) translate(2.1, 2.1)"
      />
    </svg>
  ),
  gemini: (color) => (
    // Google Gemini 4-point star
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C12 2 14 8 16 10C18 12 22 12 22 12C22 12 18 12 16 14C14 16 12 22 12 22C12 22 10 16 8 14C6 12 2 12 2 12C2 12 6 12 8 10C10 8 12 2 12 2Z"
        fill={color}
        opacity="0.9"
      />
    </svg>
  ),
  grok: (color) => (
    // xAI angular X
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 4L11 12L4 20H7L12 14L17 20H20L13 12L20 4H17L12 10L7 4H4Z" fill={color} opacity="0.85" />
    </svg>
  ),
};

const DEFAULT_ICON = (color: string): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 2L13.5 7.5L19 9L13.5 10.5L12 16L10.5 10.5L5 9L10.5 7.5L12 2Z" fill={color} opacity="0.8" />
    <path d="M17 14L18 17L21 18L18 19L17 22L16 19L13 18L16 17L17 14Z" fill={color} opacity="0.5" />
  </svg>
);

export function AgentIcon({ base, color, size = 32 }: AgentIconProps) {
  const iconFn = ICONS[base] || DEFAULT_ICON;

  return (
    <div
      className="rounded-xl flex items-center justify-center"
      style={{
        width: size,
        height: size,
        backgroundColor: color + '18',
        boxShadow: `0 0 12px ${color}20`,
      }}
    >
      <div style={{ width: size * 0.6, height: size * 0.6 }}>
        {iconFn(color)}
      </div>
    </div>
  );
}
