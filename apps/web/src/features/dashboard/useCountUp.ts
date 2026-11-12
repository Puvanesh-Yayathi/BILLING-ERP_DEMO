import { useEffect, useRef, useState } from 'react';

let entrancePlayed = false;

/** Figures count up once on the dashboard's first load; later changes morph smoothly (240 ms). */
export function useCountUp(target: number | undefined): number | undefined {
  const [value, setValue] = useState<number | undefined>(target === undefined ? undefined : entrancePlayed ? target : 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (target === undefined) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === target) {
      setValue(target);
      from.current = target;
      return;
    }
    const duration = entrancePlayed ? 240 : 600;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (target - start) * eased);
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else {
        from.current = target;
        entrancePlayed = true;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

export function firstEntrance(): boolean {
  return !entrancePlayed;
}
