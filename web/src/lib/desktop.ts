// Integration mit dem nativen App-Fenster (WebView). Im Browser sind alle
// Funktionen wirkungslos.

import { create } from 'zustand';
import type { MouseEvent as ReactMouseEvent } from 'react';

type Platform = 'windows' | 'macos';

interface DesktopInfo {
  platform: Platform;
}

declare global {
  interface Window {
    __SQRITTO_DESKTOP__?: DesktopInfo;
    __sqrittoWindow?: (s: { maximized: boolean }) => void;
    ipc?: { postMessage: (msg: string) => void };
  }
}

export const desktop: DesktopInfo | undefined = window.__SQRITTO_DESKTOP__;
export const isDesktop = !!desktop;
/** Eigene Fensterknöpfe zeichnen (macOS behält seine Ampel). */
export const ownWindowControls = desktop?.platform === 'windows';

export function windowCommand(cmd: 'drag' | 'minimize' | 'maximize' | 'close' | 'ready') {
  window.ipc?.postMessage(cmd);
}

export const useWindowState = create<{ maximized: boolean }>(() => ({ maximized: false }));

if (desktop) {
  window.__sqrittoWindow = (s) => useWindowState.setState(s);
  document.documentElement.classList.add('is-desktop', `is-desktop-${desktop.platform}`);
  windowCommand('ready');

  // Kein Browser-Kontextmenü außerhalb von Eingabefeldern (wirkt wie eine App).
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement | null;
    const editable = t?.closest('input, textarea, [contenteditable="true"], .cm-content');
    if (!editable) e.preventDefault();
  });
}

const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [role="tab"], [role="menuitem"], [data-no-drag]';

/** Kopfleiste als Titelleiste: Ziehen verschiebt das Fenster, Doppelklick maximiert. */
export function titleBarMouseDown(e: ReactMouseEvent<HTMLElement>) {
  if (!desktop || e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest(INTERACTIVE)) return;
  e.preventDefault();
  if (e.detail >= 2) windowCommand('maximize');
  else windowCommand('drag');
}
