import { memo, useMemo } from 'react';

/** Deterministic topographic contour lines: distorted rings around a few summits, like a sea chart. */
function rings(): string[] {
  const summits = [
    { x: 300, y: 330, r0: 26, n: 11, seed: 1.3 },
    { x: 690, y: 690, r0: 30, n: 13, seed: 2.7 },
    { x: 760, y: 170, r0: 22, n: 7, seed: 4.1 },
  ];
  const paths: string[] = [];
  for (const s of summits) {
    for (let k = 0; k < s.n; k++) {
      const r = s.r0 + k * 34;
      const pts: string[] = [];
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const wob = 1 + 0.11 * Math.sin(3 * a + s.seed + k * 0.35) + 0.07 * Math.sin(5 * a - s.seed * 1.7 + k * 0.2) + 0.04 * Math.cos(7 * a + k * 0.5);
        const x = s.x + Math.cos(a) * r * wob * 1.18;
        const y = s.y + Math.sin(a) * r * wob * 0.86;
        pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
      }
      paths.push(`${pts.join(' ')}Z`);
    }
  }
  return paths;
}

export const Contours = memo(function Contours({ className = '', animate = true }: { className?: string; animate?: boolean }) {
  const paths = useMemo(rings, []);
  return (
    <svg className={`contours ${animate ? '' : 'contours-static'} ${className}`} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <style>{`
        .contours g { animation: drift 60s ease-in-out infinite alternate; transform-origin: center; }
        .contours path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.2s cubic-bezier(0.2,0,0,1) forwards; }
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes drift { from { transform: translate(0,0); } to { transform: translate(-7px, 5px); } }
        .contours-static path { animation: none; stroke-dashoffset: 0; }
        @media (prefers-reduced-motion: reduce) {
          .contours path { animation: none; stroke-dashoffset: 0; }
          .contours g { animation: none; }
        }
      `}</style>
      <g fill="none" stroke="#FFFFFF" strokeWidth="1.1" vectorEffect="non-scaling-stroke">
        {paths.map((d, i) => (
          <path key={i} d={d} pathLength={1} strokeOpacity={i % 4 === 0 ? 0.14 : 0.08} style={{ animationDelay: `${(i % 13) * 35}ms` }} />
        ))}
      </g>
    </svg>
  );
});
