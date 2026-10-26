import { create } from 'zustand';
import { api } from './api';
import { adoptLang } from './i18n';
import type { AppInfo, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'system',
  editorFontSize: 14,
  wordWrap: true,
  lineNumbers: true,
  gitByDefault: true,
  previewDelay: 350,
  syncScroll: true,
  libraryView: 'grid',
  librarySort: 'modified',
  updateCheck: true,
  skippedVersion: '',
};

interface AppState {
  info: AppInfo | null;
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(patch: Partial<Settings>): void;
  /** Speichert die Sprache sofort und lädt die Oberfläche in der neuen Sprache. */
  setLanguage(language: Settings['language']): Promise<void>;
}

let saveTimer: number | undefined;

export const useApp = create<AppState>((set, getState) => ({
  info: null,
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const [info, s] = await Promise.all([api.info().catch(() => null), api.settings().catch(() => ({}))]);
    const settings = { ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) };
    applyTheme(settings.theme);
    // Weicht die Sprache des Servers von der geladenen ab: neu laden.
    if (info?.language && adoptLang(info.language)) {
      location.reload();
      return;
    }
    set({ info, settings, loaded: true });
  },
  update(patch) {
    const settings = { ...getState().settings, ...patch };
    set({ settings });
    if (patch.theme) applyTheme(patch.theme);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void api.saveSettings(settings).catch(() => undefined), 400);
  },
  async setLanguage(language) {
    const settings = { ...getState().settings, language };
    set({ settings });
    window.clearTimeout(saveTimer);
    await api.saveSettings(settings);
    const info = await api.info();
    adoptLang(info.language);
    location.reload();
  },
}));

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Settings['theme']) {
  try {
    localStorage.setItem('sqritto-theme', theme);
  } catch {
    /* ignorieren */
  }
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

media.addEventListener('change', () => applyTheme(useApp.getState().settings.theme));

// ---------------------------------------------------------------------------
// Benachrichtigungen
// ---------------------------------------------------------------------------

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: { label: string; run: () => void };
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, getState) => ({
  toasts: [],
  push(t) {
    const id = nextId++;
    const toast: Toast = { duration: t.kind === 'error' ? 8000 : 4000, ...t, id };
    set({ toasts: [...getState().toasts.slice(-3), toast] });
    if (toast.duration > 0) window.setTimeout(() => getState().dismiss(id), toast.duration);
    return id;
  },
  dismiss(id) {
    set({ toasts: getState().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: unknown) =>
    useToasts.getState().push({
      kind: 'error',
      title,
      description: description instanceof Error ? description.message : description ? String(description) : undefined,
    }),
  info: (title: string, description?: string, action?: Toast['action']) =>
    useToasts.getState().push({ kind: 'info', title, description, action }),
};
