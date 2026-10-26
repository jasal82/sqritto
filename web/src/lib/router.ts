import { useSyncExternalStore } from 'react';

// Minimaler History-Router: "/" (Bibliothek) und "/doc/:id" (Editor).

export type Route = { name: 'library' } | { name: 'editor'; id: string; file?: string };

function parse(): Route {
  const path = window.location.pathname;
  const m = /^\/doc\/([^/]+)\/?$/.exec(path);
  if (m) {
    const params = new URLSearchParams(window.location.search);
    return { name: 'editor', id: decodeURIComponent(m[1]), file: params.get('file') ?? undefined };
  }
  return { name: 'library' };
}

let current = parse();
const listeners = new Set<() => void>();

function emit() {
  current = parse();
  listeners.forEach((l) => l());
}

window.addEventListener('popstate', emit);

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  emit();
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const routes = {
  library: () => '/',
  editor: (id: string, file?: string) => `/doc/${encodeURIComponent(id)}${file ? `?file=${encodeURIComponent(file)}` : ''}`,
};
