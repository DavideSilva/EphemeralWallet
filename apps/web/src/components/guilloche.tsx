import { useMemo } from "react";

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

function rosette(cx: number, cy: number, R: number, r: number, d: number, scale: number) {
  const turns = r / gcd(R, r);
  const steps = 900;
  let path = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = cx + scale * ((R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t));
    const y = cy + scale * ((R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t));
    path += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path;
}

function waves(width: number, top: number, count: number, amplitude: number, frequency: number, phase: number) {
  return Array.from({ length: count }, (_, line) => {
    let path = "";
    for (let x = 0; x <= width; x += 4) {
      const y = top + line * 3 + amplitude * Math.sin((x / width) * Math.PI * 2 * frequency + phase + line * 0.35);
      path += `${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`;
    }
    return path;
  });
}

export function Guilloche({ seed, ink }: { seed: string; ink: string }) {
  const paths = useMemo(() => {
    const random = rng(seed);
    const R = 36 + Math.floor(random() * 20);
    const r = 7 + Math.floor(random() * 12);
    const d = 8 + random() * 14;
    const cx = 258;
    const cy = 104;
    return {
      rosettes: [0.92, 0.72, 0.52].map((scale, i) => rosette(cx, cy, R, r + (i % 2), d * (1 - i * 0.1), scale)),
      band: waves(340, 176, 7, 5 + random() * 4, 2 + Math.floor(random() * 3), random() * Math.PI),
    };
  }, [seed]);

  return (
    <svg viewBox="0 0 340 214" className="absolute inset-0 size-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="none" stroke={ink} strokeWidth={0.45}>
        {paths.rosettes.map((d, i) => (
          <path key={i} d={d} opacity={0.5 - i * 0.12} />
        ))}
        {paths.band.map((d, i) => (
          <path key={`b${i}`} d={d} opacity={0.22} />
        ))}
      </g>
    </svg>
  );
}
