// Zustand und Steuerung des Editors: geöffnete Dateien (CodeMirror-Zustände),
// Autospeichern, Live-Übersetzung und Sprünge zwischen Quelle und Vorschau.

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import * as fmt from '../../editor/commands';
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { create } from 'zustand';
import { api } from '../../lib/api';
import { basename, extname } from '../../lib/format';
import { t } from '../../lib/i18n';
import { toast, useApp } from '../../lib/store';
import type { CompileResult, ComponentDef, Diagnostic as SourceDiagnostic, DocDetail, FileNode, Manifest } from '../../lib/types';
import { baseExtensions, gutterCompartment, gutterExt, wrapCompartment, wrapExt } from '../../editor/setup';
import { markdocLanguage } from '../../editor/markdoc';
import { typstLanguage } from '../../editor/typst';
import { mustacheTemplate } from '../../editor/mustache';

export type FileKind = 'markdoc' | 'typst' | 'code' | 'image' | 'binary' | 'element';

// ---------------------------------------------------------------------------
// Element-Tabs: ein Tab „element:<name>“ bündelt alle Dateien eines eigenen
// Markdoc-Elements (components/<name>/…) in der Element-Ansicht.
// ---------------------------------------------------------------------------

const ELEMENT_PREFIX = 'element:';
export const elementTab = (name: string) => ELEMENT_PREFIX + name;
export const isElementTab = (path: string) => path.startsWith(ELEMENT_PREFIX);
export const elementName = (tab: string) => tab.slice(ELEMENT_PREFIX.length);
export const elementDir = (name: string) => `components/${name}`;

/** Bereich der Element-Ansicht: `settings` (Formular) oder ein Dateiname. */
export type ElementSection = string;

/** Liefert Elementname und Datei, wenn der Pfad zu einem eigenen Element gehört. */
export function elementFileOf(path: string): { name: string; file: string } | null {
  const m = /^components\/([^/]+)\/(.+)$/.exec(path);
  if (!m) return null;
  const dir = findNode(get().tree, `components/${m[1]}`);
  if (!dir?.children?.some((c) => c.kind === 'file' && c.name === 'component.json')) return null;
  return { name: m[1], file: m[2] };
}

function findNode(nodes: FileNode[], path: string): FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.kind === 'dir' && n.children && path.startsWith(`${n.path}/`)) return findNode(n.children, path);
  }
  return null;
}

/** Dateien eines Elements (relativ zum Elementordner). */
export function elementFiles(tree: FileNode[], name: string): string[] {
  const out: string[] = [];
  const walk = (nodes: FileNode[], prefix: string) => {
    for (const n of nodes) {
      if (n.kind === 'file') out.push(prefix + n.name);
      else if (n.children) walk(n.children, `${prefix}${n.name}/`);
    }
  };
  walk(findNode(tree, elementDir(name))?.children ?? [], '');
  return out;
}

export function fileKind(path: string): FileKind {
  if (isElementTab(path)) return 'element';
  const ext = extname(path);
  if (['mdoc', 'md', 'markdoc'].includes(ext)) return 'markdoc';
  if (ext === 'typ') return 'typst';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['pdf', 'ttf', 'otf', 'woff', 'woff2', 'zip', 'docx', 'xlsx'].includes(ext)) return 'binary';
  return 'code';
}

export interface PdfTarget {
  page: number;
  x: number;
  y: number;
  t: number;
}

export interface EditorStore {
  id: string;
  detail: DocDetail | null;
  manifest: Manifest | null;
  tree: FileNode[];
  components: ComponentDef[];
  tabs: string[];
  active: string | null;
  dirty: Record<string, true>;
  result: CompileResult | null;
  compiling: boolean;
  saveState: 'saved' | 'saving' | 'dirty' | 'error';
  saveError: string | null;
  cursor: { line: number; col: number; selected: number };
  words: number;
  previewMode: 'pdf' | 'html';
  previewSlug: string | null;
  pdfTarget: PdfTarget | null;
  htmlLine: { line: number; t: number } | null;
  panels: { sidebar: boolean; preview: boolean; problems: boolean; git: boolean };
  sidebarTab: 'files' | 'outline' | 'elements';
  loadError: string | null;
  /** Gewählter Bereich je Element-Tab. */
  elementSection: Record<string, ElementSection>;
  /** Zähler für Textänderungen (für abhängige Ansichten wie Formulare). */
  editTick: number;
}

const initial = (id: string): EditorStore => ({
  id,
  detail: null,
  manifest: null,
  tree: [],
  components: [],
  tabs: [],
  active: null,
  dirty: {},
  result: null,
  compiling: false,
  saveState: 'saved',
  saveError: null,
  cursor: { line: 1, col: 1, selected: 0 },
  words: 0,
  previewMode: 'pdf',
  previewSlug: null,
  pdfTarget: null,
  htmlLine: null,
  panels: { sidebar: true, preview: true, problems: false, git: false },
  sidebarTab: 'files',
  loadError: null,
  elementSection: {},
  editTick: 0,
});

export const useEditor = create<EditorStore>(() => initial(''));

const set = (p: Partial<EditorStore> | ((s: EditorStore) => Partial<EditorStore>)) => useEditor.setState(p);
const get = () => useEditor.getState();

// ---------------------------------------------------------------------------
// Nicht-reaktiver Zustand
// ---------------------------------------------------------------------------

const states = new Map<string, EditorState>();
const savedText = new Map<string, string>();
const scroll = new Map<string, number>();
let view: EditorView | null = null;
/** Datei, deren Zustand gerade in `view` liegt. Weicht kurzzeitig von `active`
    ab (beim Laden, Schließen oder wenn ein Bild angezeigt wird). */
let shown: string | null = null;
let openSeq = 0;
let compileTimer: number | undefined;
let saveTimer: number | undefined;
let compileRunning = false;
let compileQueued = false;
let cursorTimer: number | undefined;

/** Aktuellen Stand der Ansicht unter der angezeigten Datei sichern. */
function syncShown() {
  if (view && shown && states.has(shown)) states.set(shown, view.state);
}

/** Zustand einer geöffneten Datei in die Ansicht holen. */
function show(path: string) {
  const next = states.get(path);
  if (!view || !next) return;
  syncShown();
  view.setState(next);
  shown = path;
  applyPrefs();
  applyDiagnostics();
}

export function attachView(v: EditorView | null) {
  syncShown();
  view = v;
  shown = null;
  const a = get().active;
  // Element-Tabs holen ihre Datei selbst in die Ansicht (showFile).
  if (v && a && !isElementTab(a)) {
    show(a);
    restoreScroll(a);
  }
}

function restoreScroll(path: string) {
  const top = scroll.get(path);
  if (top !== undefined) requestAnimationFrame(() => view && shown === path && (view.scrollDOM.scrollTop = top));
}

export function getView() {
  return view;
}

/** Pfad der Datei, die gerade in der Ansicht liegt. */
export function shownPath() {
  return shown;
}

export function getText(path: string): string | undefined {
  if (view && shown === path) return view.state.doc.toString();
  return states.get(path)?.doc.toString();
}

/** Lädt eine Datei in den Speicher, ohne sie anzuzeigen oder einen Tab zu öffnen. */
export async function ensureLoaded(path: string): Promise<boolean> {
  if (states.has(path)) return true;
  const id = get().id;
  try {
    const text = await api.readFile(id, path);
    const extra = await codeLanguage(path);
    if (get().id !== id) return false;
    if (!states.has(path)) {
      states.set(path, createState(path, text, extra));
      savedText.set(path, text);
      set((s) => ({ editTick: s.editTick + 1 }));
    }
    return true;
  } catch {
    return false;
  }
}

/** Zeigt eine (ggf. erst zu ladende) Datei in der Ansicht, ohne Tabs zu ändern. */
export async function showFile(path: string, line?: number, col?: number): Promise<boolean> {
  if (!(await ensureLoaded(path))) {
    toast.error(t('Datei konnte nicht geöffnet werden'), path);
    return false;
  }
  if (!view) return false;
  if (shown !== path) {
    show(path);
    restoreScroll(path);
  }
  if (line) gotoLine(line, col);
  countWords();
  onCursor(view);
  return true;
}

/**
 * Ersetzt den Text einer geladenen Datei (z. B. aus einem Formular). Es wird
 * nur der geänderte Bereich ersetzt, damit Auswahl und Rückgängig erhalten bleiben.
 */
export function setFileText(path: string, text: string) {
  const cur = getText(path);
  if (cur === undefined || cur === text) return;
  let from = 0;
  while (from < cur.length && from < text.length && cur[from] === text[from]) from++;
  let endA = cur.length;
  let endB = text.length;
  while (endA > from && endB > from && cur[endA - 1] === text[endB - 1]) {
    endA--;
    endB--;
  }
  const changes = { from, to: endA, insert: text.slice(from, endB) };
  if (view && shown === path) {
    view.dispatch({ changes });
    return;
  }
  states.set(path, states.get(path)!.update({ changes }).state);
  onDocChanged(path);
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

export async function loadDocument(id: string, initialFile?: string) {
  states.clear();
  savedText.clear();
  scroll.clear();
  shown = null;
  openSeq++;
  useEditor.setState(initial(id), true);
  try {
    const [detail, tree, comps] = await Promise.all([
      api.document(id),
      api.tree(id),
      api.components(id).catch(() => ({ components: [] as ComponentDef[], errors: [] })),
    ]);
    if (get().id !== id) return;
    const manifest = detail.manifest;
    let previewMode: 'pdf' | 'html' = manifest?.html.enabled && manifest.document.kind === 'markdoc' && !manifest.pdf.enabled ? 'html' : 'pdf';
    try {
      const saved = localStorage.getItem(`sqritto-preview:${id}`);
      if (saved === 'pdf' || saved === 'html') previewMode = saved;
    } catch {
      /* ignorieren */
    }
    set({ detail, manifest, tree, components: comps.components, result: detail.last, previewMode });
    document.title = `${detail.summary.title} – Sqritto`;
    void api.watch(id).catch(() => undefined);
    const first = initialFile ?? defaultFile(manifest, tree);
    if (first) await openFile(first);
    void compileNow();
  } catch (e) {
    set({ loadError: e instanceof Error ? e.message : String(e) });
  }
}

function flatten(nodes: FileNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n.path);
    if (n.children) flatten(n.children, out);
  }
  return out;
}

export function allFiles(): string[] {
  return flatten(get().tree);
}

function defaultFile(m: Manifest | null, tree: FileNode[]): string | null {
  const files = flatten(tree);
  if (m?.document.kind === 'typst') {
    const entry = m.typst.entry.replace(/^\//, '');
    if (files.includes(entry)) return entry;
    return files.find((f) => f.endsWith('.typ')) ?? null;
  }
  const content = m?.markdoc.content ?? 'content';
  const firstNav = m?.markdoc.nav.flatMap((s) => s.pages)[0];
  if (firstNav && files.includes(`${content}/${firstNav}`)) return `${content}/${firstNav}`;
  return files.find((f) => f === `${content}/index.mdoc`) ?? files.find((f) => f.endsWith('.mdoc')) ?? null;
}

export async function refreshTree() {
  const id = get().id;
  try {
    const tree = await api.tree(id);
    if (get().id === id) set({ tree });
  } catch {
    /* ignorieren */
  }
}

export async function refreshComponents() {
  const id = get().id;
  try {
    const c = await api.components(id);
    if (get().id === id) set({ components: c.components });
  } catch {
    /* ignorieren */
  }
}

export async function refreshManifest() {
  const id = get().id;
  const detail = await api.document(id);
  set({ detail, manifest: detail.manifest });
}

// ---------------------------------------------------------------------------
// Dateien
// ---------------------------------------------------------------------------

export function languageFor(path: string): Extension[] {
  const kind = fileKind(path);
  if (kind === 'markdoc') {
    return markdocLanguage({
      components: () => get().components,
      variables: () => [...Object.keys(get().manifest?.variables ?? {}), 'document.title', 'document.version', 'document.authors', 'page.title'],
      pages: () => (get().result?.outline ?? []).map((o) => ({ path: o.path, title: o.title, headings: o.headings })),
      files: () => allFiles(),
      currentPath: () => path,
    });
  }
  if (kind === 'typst') {
    return typstLanguage((text, offset, explicit) => api.complete(get().id, path, text, offset, explicit));
  }
  return [];
}

/** Sprachunterstützung für sonstige Dateien (HTML, CSS, JSON …), bei Bedarf nachgeladen. */
async function codeLanguage(path: string): Promise<Extension[]> {
  if (fileKind(path) !== 'code') return [];
  const extra: Extension[] = [];
  const el = /^components\/([^/]+)\/template\.html$/.exec(path);
  if (el) extra.push(mustacheTemplate(() => elementAttributes(el[1])));
  const desc = LanguageDescription.matchFilename(languages, basename(path));
  if (!desc) return extra;
  try {
    return [await desc.load(), ...extra];
  } catch {
    return extra;
  }
}

/** Attributnamen eines Elements aus seiner (ggf. ungespeicherten) Definition. */
export function elementAttributes(name: string): string[] {
  try {
    const def = JSON.parse(getText(`${elementDir(name)}/component.json`) ?? 'null');
    if (def && typeof def === 'object') return Object.keys(def.attributes ?? {});
  } catch {
    /* ungültiges JSON: auf den zuletzt geladenen Stand zurückgreifen */
  }
  return Object.keys(get().components.find((c) => c.name === name)?.attributes ?? {});
}

/** Tastenkürzel für die Formatierung (passend zur Werkzeugleiste). */
function formatKeymap(path: string): Extension[] {
  const kind = fileKind(path);
  if (kind !== 'markdoc' && kind !== 'typst') return [];
  const f = kind;
  return [
    Prec.high(
      keymap.of([
        { key: 'Mod-b', run: (v) => fmt.bold(v, f) },
        { key: 'Mod-i', run: (v) => fmt.italic(v, f) },
        { key: 'Mod-e', run: (v) => fmt.inlineCode(v) },
        { key: 'Mod-Shift-k', run: (v) => fmt.link(v, f) },
        { key: 'Mod-Alt-1', run: (v) => fmt.heading(v, f, 1) },
        { key: 'Mod-Alt-2', run: (v) => fmt.heading(v, f, 2) },
        { key: 'Mod-Alt-3', run: (v) => fmt.heading(v, f, 3) },
      ]),
    ),
  ];
}

function createState(path: string, text: string, extra: Extension[] = []): EditorState {
  const s = useApp.getState().settings;
  return EditorState.create({
    doc: text,
    extensions: baseExtensions({ lineNumbers: s.lineNumbers, wordWrap: s.wordWrap }, [
      ...languageFor(path),
      ...extra,
      ...formatKeymap(path),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onDocChanged(path);
        if (u.selectionSet || u.docChanged) onCursor(u.view);
      }),
      EditorView.domEventHandlers({
        scroll: (_e, v) => {
          scroll.set(path, v.scrollDOM.scrollTop);
        },
      }),
    ]),
  });
}

export async function openFile(path: string, line?: number, col?: number) {
  // Dateien eigener Elemente öffnen sich in der Element-Ansicht.
  const el = elementFileOf(path);
  if (el) return openElement(el.name, el.file === 'component.json' ? 'settings' : el.file, line, col);
  const seq = ++openSeq;
  const id = get().id;
  const kind = fileKind(path);
  if (kind === 'element') {
    set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path], active: path }));
    return;
  }
  if (!states.has(path) && kind !== 'image' && kind !== 'binary') {
    let text: string;
    let extra: Extension[];
    try {
      text = await api.readFile(id, path);
      extra = await codeLanguage(path);
    } catch (e) {
      if (seq === openSeq) toast.error(t('Datei konnte nicht geöffnet werden'), e);
      return;
    }
    if (get().id !== id) return;
    if (!states.has(path)) {
      states.set(path, createState(path, text, extra));
      savedText.set(path, text);
    }
    // Während des Ladens wurde schon eine andere Datei gewählt: nur den Tab anlegen.
    if (seq !== openSeq) {
      set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path] }));
      return;
    }
  }
  set((s) => ({ tabs: s.tabs.includes(path) ? s.tabs : [...s.tabs, path], active: path }));
  updatePreviewSlug(path);
  if (view && states.has(path)) {
    const swapped = shown !== path;
    if (swapped) show(path);
    const top = scroll.get(path);
    if (line) gotoLine(line, col);
    else if (swapped && top !== undefined) requestAnimationFrame(() => view && (view.scrollDOM.scrollTop = top));
    countWords();
    onCursor(view);
    // Vorschau zur neu geöffneten Datei bewegen
    const c = get().cursor;
    scheduleSync(c.line, c.col);
  }
}

/** Öffnet die Element-Ansicht, optional mit Bereich und Zeile. */
export async function openElement(name: string, section?: ElementSection, line?: number, col?: number) {
  const path = section && section !== 'settings' ? `${elementDir(name)}/${section}` : null;
  // Sprungziel vormerken, bevor die Ansicht wechselt (sie holt es sich ab).
  if (path && line) pendingReveal = { path, line, col };
  if (section) set((s) => ({ elementSection: { ...s.elementSection, [name]: section } }));
  await openFile(elementTab(name));
  if (path && shown === path) {
    const r = takeReveal(path);
    if (r) gotoLine(r.line, r.col);
  }
}

let pendingReveal: { path: string; line: number; col?: number } | null = null;

/** Sprungziel, das die Element-Ansicht nach dem Anzeigen einer Datei anspringt. */
export function takeReveal(path: string): { line: number; col?: number } | null {
  if (pendingReveal?.path !== path) return null;
  const r = pendingReveal;
  pendingReveal = null;
  return r;
}

/** Gehört die Datei zum Tab (bei Element-Tabs: alle Dateien des Elements)? */
export function tabOwns(tab: string, path: string): boolean {
  return isElementTab(tab) ? path.startsWith(`${elementDir(elementName(tab))}/`) : tab === path;
}

/** Schließt einen Tab. Ungespeicherte Änderungen werden geschrieben, außer
    `discard` ist gesetzt (z. B. weil die Datei gelöscht wurde). */
export function closeTab(path: string, opts: { discard?: boolean } = {}) {
  const st = get();
  if (!st.tabs.includes(path)) return;
  syncShown();
  const owned = [...new Set([...states.keys(), ...Object.keys(st.dirty)])].filter((p) => tabOwns(path, p));
  if (!isElementTab(path) && !owned.includes(path)) owned.push(path);
  const pending = opts.discard
    ? []
    : owned.filter((p) => st.dirty[p]).flatMap((p) => {
        const text = getText(p);
        return text === undefined ? [] : [[p, text] as const];
      });
  const idx = st.tabs.indexOf(path);
  const tabs = st.tabs.filter((t) => t !== path);
  const wasActive = st.active === path;
  const active = wasActive ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : st.active;
  const dirty = { ...st.dirty };
  for (const p of owned) {
    delete dirty[p];
    states.delete(p);
    savedText.delete(p);
    scroll.delete(p);
    // Die Ansicht zeigt noch die geschlossene Datei; ihr Zustand darf beim
    // nächsten Wechsel nicht unter einem anderen Pfad gesichert werden.
    if (shown === p) shown = null;
  }
  set({ tabs, active, dirty, saveState: Object.keys(dirty).length ? 'dirty' : st.saveState === 'dirty' ? 'saved' : st.saveState });
  for (const [p, text] of pending) void writeClosed(st.id, p, text);
  if (wasActive && active) void openFile(active);
}

async function writeClosed(id: string, path: string, text: string) {
  set({ saveState: 'saving' });
  try {
    await api.writeFile(id, path, text);
    if (get().id !== id) return;
    set({ saveState: Object.keys(get().dirty).length ? 'dirty' : 'saved', saveError: null });
    void compileNow();
  } catch (e) {
    set({ saveState: 'error', saveError: e instanceof Error ? e.message : String(e) });
    toast.error(t('{path} konnte nicht gespeichert werden', { path }), e);
  }
}

export function gotoLine(line: number, col = 1) {
  if (!view) return;
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}

/** Öffnet Datei und springt an Zeile/Spalte. */
export async function reveal(path: string, line?: number, col?: number) {
  if (get().active !== path) await openFile(path, line ?? undefined, col ?? undefined);
  else if (line) gotoLine(line, col);
}

function updatePreviewSlug(path: string) {
  const entry = get().result?.outline.find((o) => o.path === path);
  if (entry) set({ previewSlug: entry.slug });
}

/** Externe Änderung einer Datei übernehmen (wenn lokal unverändert). */
export async function reloadFromDisk(path: string) {
  const id = get().id;
  if (!states.has(path)) return;
  try {
    const text = await api.readFile(id, path);
    if (text === savedText.get(path)) return;
    if (get().dirty[path]) {
      toast.info(t('Datei wurde außerhalb geändert'), t('{path} hat ungespeicherte Änderungen und wurde nicht neu geladen.', { path }));
      return;
    }
    savedText.set(path, text);
    if (view && shown === path) {
      const cur = view.state.doc.toString();
      if (cur !== text) {
        view.dispatch({ changes: { from: 0, to: cur.length, insert: text }, userEvent: 'external' });
        set((s) => {
          const d = { ...s.dirty };
          delete d[path];
          return { dirty: d };
        });
      }
    } else {
      states.set(path, createState(path, text, await codeLanguage(path)));
      set((s) => ({ editTick: s.editTick + 1 }));
    }
  } catch {
    /* Datei evtl. gelöscht */
  }
}

// ---------------------------------------------------------------------------
// Speichern und Übersetzen
// ---------------------------------------------------------------------------

function onDocChanged(path: string) {
  const text = getText(path);
  if (text === undefined) return;
  const isDirty = text !== savedText.get(path);
  set((s) => {
    const d = { ...s.dirty };
    if (isDirty) d[path] = true;
    else delete d[path];
    return { dirty: d, saveState: Object.keys(d).length ? 'dirty' : 'saved', editTick: s.editTick + 1 };
  });
  if (isDirty) scheduleSaveAndCompile();
  countWordsSoon();
}

function scheduleSaveAndCompile() {
  window.clearTimeout(saveTimer);
  const delay = useApp.getState().settings.previewDelay;
  saveTimer = window.setTimeout(() => {
    void saveNow().then((ok) => {
      if (ok) void compileNow();
    });
  }, delay);
}

export async function saveNow(): Promise<boolean> {
  window.clearTimeout(saveTimer);
  syncShown();
  const dirty = Object.keys(get().dirty);
  if (!dirty.length) return true;
  set({ saveState: 'saving' });
  const id = get().id;
  try {
    for (const path of dirty) {
      const text = getText(path);
      if (text === undefined) continue;
      await api.writeFile(id, path, text);
      savedText.set(path, text);
      set((s) => {
        const d = { ...s.dirty };
        if (getText(path) === text) delete d[path];
        return { dirty: d };
      });
    }
    set({ saveState: Object.keys(get().dirty).length ? 'dirty' : 'saved', saveError: null });
    return true;
  } catch (e) {
    set({ saveState: 'error', saveError: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function compileNow() {
  window.clearTimeout(compileTimer);
  if (compileRunning) {
    compileQueued = true;
    return;
  }
  compileRunning = true;
  set({ compiling: true });
  const id = get().id;
  try {
    const result = await api.compile(id);
    if (get().id !== id) return;
    const first = !get().result;
    set({ result });
    if (first) {
      const c = get().cursor;
      scheduleSync(c.line, c.col);
    }
    applyDiagnostics();
    const a = get().active;
    if (a) updatePreviewSlug(a);
  } catch (e) {
    toast.error(t('Übersetzung fehlgeschlagen'), e);
  } finally {
    compileRunning = false;
    set({ compiling: false });
    if (compileQueued) {
      compileQueued = false;
      void compileNow();
    }
  }
}

export async function saveAndCompile() {
  if (await saveNow()) await compileNow();
}

/** Meldungen der Element-Vorschau (berücksichtigen ungespeicherte Änderungen). */
const previewDiags = new Map<string, SourceDiagnostic[]>();

/** Setzt die Vorschau-Meldungen für alle Dateien unterhalb von `scope`. */
export function setPreviewDiagnostics(scope: string, diags: SourceDiagnostic[]) {
  for (const k of [...previewDiags.keys()]) if (k.startsWith(scope)) previewDiags.delete(k);
  for (const d of diags) if (d.path.startsWith(scope)) previewDiags.set(d.path, [...(previewDiags.get(d.path) ?? []), d]);
  applyDiagnostics();
}

function toCmDiagnostics(state: EditorState, path: string): CmDiagnostic[] {
  const seen = new Set<string>();
  const list = [...(get().result?.diagnostics ?? []), ...(previewDiags.get(path) ?? [])].filter((d) => {
    const key = `${d.line}:${d.column}:${d.message}`;
    if (d.path !== path || !d.line || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const doc = state.doc;
  return list
    .map((d) => {
      const line = doc.line(Math.max(1, Math.min(d.line!, doc.lines)));
      let from = line.from + Math.max(0, (d.column ?? 1) - 1);
      let to = line.to;
      if (d.endLine && d.endColumn && d.endLine <= doc.lines) {
        const el = doc.line(d.endLine);
        to = Math.min(el.from + d.endColumn - 1, el.to);
      }
      from = Math.min(from, line.to);
      if (to <= from) {
        // Ganze Zeile markieren (Markdoc-Fehler ohne Spalte)
        from = line.from + (line.text.length - line.text.trimStart().length);
        to = Math.max(line.to, from);
      }
      return {
        from,
        to,
        severity: d.severity === 'info' ? 'info' : d.severity,
        message: d.message + (d.hints.length ? `\n${d.hints.map((h) => t('Hinweis: {hint}', { hint: h })).join('\n')}` : ''),
        source: d.source === 'typst' ? 'Typst' : 'Markdoc',
      } satisfies CmDiagnostic;
    });
}

export function applyDiagnostics() {
  if (!view || !shown) return;
  view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, shown)));
}

export function applyPrefs() {
  if (!view) return;
  const s = useApp.getState().settings;
  view.dispatch({
    effects: [
      gutterCompartment.reconfigure(gutterExt({ lineNumbers: s.lineNumbers, wordWrap: s.wordWrap })),
      wrapCompartment.reconfigure(wrapExt({ lineNumbers: s.lineNumbers, wordWrap: s.wordWrap })),
    ],
  });
}

// ---------------------------------------------------------------------------
// Cursor und Synchronisation
// ---------------------------------------------------------------------------

let wordsTimer: number | undefined;

function countWordsSoon() {
  window.clearTimeout(wordsTimer);
  wordsTimer = window.setTimeout(countWords, 600);
}

function countWords() {
  if (!view) return;
  const text = view.state.doc.toString();
  const words = text
    .replace(/\{%[\s\S]*?%\}/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  set({ words });
}

function onCursor(v: EditorView) {
  const sel = v.state.selection.main;
  const line = v.state.doc.lineAt(sel.head);
  const cursor = { line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) };
  const prev = get().cursor;
  if (prev.line !== cursor.line || prev.col !== cursor.col || prev.selected !== cursor.selected) set({ cursor });
  if (prev.line !== cursor.line) scheduleSync(cursor.line, cursor.col);
}

function scheduleSync(line: number, col: number) {
  if (!useApp.getState().settings.syncScroll) return;
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => void syncPreview(line, col), 260);
}

export async function syncPreview(line: number, col: number) {
  const st = get();
  const path = st.active;
  if (!path || !st.result || isElementTab(path)) return;
  if (st.previewMode === 'html') {
    set({ htmlLine: { line, t: Date.now() } });
    return;
  }
  if (!st.result.pages.length) return;
  try {
    const positions = await api.cursor(st.id, path, line, col);
    if (positions.length) set({ pdfTarget: { ...positions[0], t: Date.now() } });
  } catch {
    /* ignorieren */
  }
}

/** Klick in der PDF-Vorschau → Quelltext. */
export async function jumpFromPdf(page: number, x: number, y: number) {
  try {
    const target = await api.jump(get().id, page, x, y);
    if (!target) return;
    if (target.kind === 'file' && target.path) await reveal(target.path, target.line, target.column);
    else if (target.kind === 'url' && target.url) window.open(target.url, '_blank', 'noopener');
    else if (target.kind === 'position' && target.page !== undefined)
      set({ pdfTarget: { page: target.page, x: target.x ?? 0, y: target.y ?? 0, t: Date.now() } });
  } catch {
    /* ignorieren */
  }
}

export function setPanels(p: Partial<EditorStore['panels']>) {
  set((s) => ({ panels: { ...s.panels, ...p } }));
}

export function hasUnsaved(): boolean {
  return Object.keys(get().dirty).length > 0;
}

/** Datei wurde umbenannt/verschoben: Tabs und Zustände nachziehen. */
export async function renamed(from: string, to: string) {
  const affected = (p: string) => p === from || p.startsWith(`${from}/`);
  const target = (p: string) => (affected(p) ? to + p.slice(from.length) : p);
  // Element-Tabs folgen ihrem Ordner, solange er ein Element bleibt.
  const tabTarget = (t: string): string | null => {
    if (!isElementTab(t)) return target(t);
    const m = /^components\/([^/]+)$/.exec(target(elementDir(elementName(t))));
    return m ? elementTab(m[1]) : null;
  };
  const moved = [...states.keys()].filter(affected);
  const extras = new Map(await Promise.all(moved.map(async (a) => [a, await codeLanguage(target(a))] as const)));
  syncShown();
  for (const a of moved) {
    const st = states.get(a);
    if (!st) continue;
    const b = target(a);
    // Neuer Zustand, damit Sprache und Speicherziel zum neuen Pfad passen.
    states.set(b, createState(b, st.doc.toString(), extras.get(a)));
    states.delete(a);
    savedText.set(b, savedText.get(a) ?? '');
    savedText.delete(a);
    const top = scroll.get(a);
    scroll.delete(a);
    if (top !== undefined) scroll.set(b, top);
  }
  if (shown && affected(shown)) shown = null;
  set((s) => ({
    tabs: s.tabs.map(tabTarget).filter((t): t is string => !!t),
    active: s.active ? tabTarget(s.active) : null,
    dirty: Object.fromEntries(Object.keys(s.dirty).map((p) => [target(p), true as const])),
    elementSection: Object.fromEntries(
      Object.entries(s.elementSection).map(([n, sec]) => [elementName(tabTarget(elementTab(n)) ?? elementTab(n)), sec]),
    ),
  }));
  const a = get().active;
  if (a) void openFile(a);
}

export function removed(path: string) {
  const hit = (p: string) => p === path || p.startsWith(`${path}/`);
  for (const t of get().tabs) {
    if (isElementTab(t) ? hit(elementDir(elementName(t))) : hit(t)) closeTab(t, { discard: true });
  }
  // Gelöschte Dateien eines weiterhin geöffneten Elements verwerfen.
  const dropped = [...states.keys()].filter(hit);
  if (!dropped.length) return;
  for (const p of dropped) {
    states.delete(p);
    savedText.delete(p);
    scroll.delete(p);
    if (shown === p) shown = null;
  }
  set((s) => {
    const dirty = { ...s.dirty };
    for (const p of dropped) delete dirty[p];
    return { dirty, editTick: s.editTick + 1 };
  });
}

export function insertAtCursor(fn: (v: EditorView) => void) {
  if (view) fn(view);
}

// Gewählte Vorschau je Dokument merken
useEditor.subscribe((s, prev) => {
  if (s.previewMode !== prev.previewMode && s.id) {
    try {
      localStorage.setItem(`sqritto-preview:${s.id}`, s.previewMode);
    } catch {
      /* ignorieren */
    }
  }
});
