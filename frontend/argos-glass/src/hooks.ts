import { useEffect, useRef, useState } from 'react';

/** Anima un número desde su valor previo hasta `target` (ease-out). */
export function useCountUp(target: number, duration = 900, decimals = 0): string {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (target - a) * e;
      setVal(v);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, duration]);
  return val.toLocaleString('es-PE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Ejecuta `fn` cada `ms` mientras `active` sea true (y al activarse, si `immediate`). */
export function useInterval(fn: () => void, ms: number, active = true, immediate = false) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    if (immediate) ref.current();
    const i = setInterval(() => ref.current(), ms);
    return () => clearInterval(i);
  }, [ms, active, immediate]);
}
