/**
 * v3.2.0: SVG orbiting particles for agent "thinking" state.
 * 5 circles with randomized orbit speeds, colored by agent color.
 */
import { motion } from 'framer-motion';

interface ThinkingParticlesProps {
  color: string;
  size?: number;
}

const PARTICLES = [
  { r: 14, size: 2.5, duration: 1.8, delay: 0,    offsetAngle: 0   },
  { r: 16, size: 2,   duration: 2.3, delay: 0.3,  offsetAngle: 72  },
  { r: 13, size: 1.8, duration: 1.5, delay: 0.1,  offsetAngle: 144 },
  { r: 17, size: 2.2, duration: 2.7, delay: 0.5,  offsetAngle: 216 },
  { r: 12, size: 1.5, duration: 2.0, delay: 0.7,  offsetAngle: 288 },
];

export function ThinkingParticles({ color, size = 36 }: ThinkingParticlesProps) {
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      {PARTICLES.map((p, i) => {
        const startAngle = (p.offsetAngle * Math.PI) / 180;
        const x = cx + p.r * Math.cos(startAngle);
        const y = cy + p.r * Math.sin(startAngle);
        return (
          <motion.circle
            key={i}
            cx={x}
            cy={y}
            r={p.size}
            fill={color}
            initial={{ opacity: 0 }}
            animate={{
              opacity: [0, 0.7, 0.3, 0.7, 0],
              rotate: 360,
            }}
            transition={{
              opacity: { duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' },
              rotate: { duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'linear' },
            }}
            style={{ originX: `${cx}px`, originY: `${cy}px` }}
          />
        );
      })}
    </svg>
  );
}
