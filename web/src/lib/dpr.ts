import { useEffect, useState } from 'react';

/** Aktuelles Verhältnis Bildpunkte je CSS-Pixel; folgt Monitorwechseln und Zoom. */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const update = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [dpr]);
  return dpr;
}
