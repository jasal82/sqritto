import { useEffect, useRef } from 'react';

export type ServerEvent =
  | { type: 'files-changed'; id: string; paths: string[] }
  | { type: 'library-changed' };

type Handler = (e: ServerEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;

function ensure() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onmessage = (msg) => {
    try {
      const ev = JSON.parse(msg.data) as ServerEvent;
      handlers.forEach((h) => h(ev));
    } catch {
      /* ignorieren */
    }
  };
  source.onerror = () => {
    // EventSource verbindet sich selbst neu.
  };
}

/** Abonniert Server-Ereignisse (Dateiänderungen von außen, Bibliothek). */
export function useServerEvents(handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensure();
    const h: Handler = (e) => ref.current(e);
    handlers.add(h);
    return () => {
      handlers.delete(h);
    };
  }, []);
}
