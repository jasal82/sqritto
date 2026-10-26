// SPDX-License-Identifier: MIT-0
// Icons nach Lucide (ISC), siehe third-party/.
//
// Laufzeit der exportierten HTML5-Dokumentation.
//
// – Farbschema (hell/dunkel/System), Navigation (aufklappbar, Schublade auf
//   kleinen Bildschirmen), Scroll-Spy für „Auf dieser Seite“
// – Volltextsuche über einen vorab erzeugten MiniSearch-Index
// – Kopieren-Schaltflächen und Zeilennummern für Codeblöcke
// – Vorschau-Protokoll (postMessage) für den Editor
//
// Funktioniert ohne Server direkt aus dem Dateisystem (file://).

import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS } from '../../engine/src/search-options';

declare global {
  interface Window {
    __TS_SEARCH__?: { version: number; index: unknown };
  }
}

interface SearchDoc {
  id: string;
  page: string;
  anchor: string;
  pageTitle: string;
  heading: string;
  text: string;
}

type Hit = SearchDoc & { score: number; terms: string[]; match?: Record<string, string[]> };

/** Treffer für die Seite als Ganzes (Einleitung oder Hauptüberschrift). */
function isPageHit(h: SearchDoc): boolean {
  return !h.anchor || h.heading === h.pageTitle;
}

const doc = document;
const root = doc.documentElement;
const SCRIPT_SRC = (doc.currentScript as HTMLScriptElement | null)?.src ?? '';
const STATIC_BASE = SCRIPT_SRC ? SCRIPT_SRC.replace(/site\.js(?:[?#].*)?$/, '') : '_static/';
const PREVIEW = root.getAttribute('data-ts-preview') === '1';
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Beschriftungen nach Sprache des Dokuments (<html lang>): Deutsch, sonst Englisch
// ---------------------------------------------------------------------------

const DOC_LANG = (root.getAttribute('lang') || 'de').toLowerCase();
const IS_DE = DOC_LANG === 'de' || DOC_LANG.startsWith('de-');

const STRINGS = {
  de: {
    theme: (m: string) => `Farbschema: ${m}`,
    light: 'Hell',
    dark: 'Dunkel',
    system: 'System',
    copy: 'Kopieren',
    copyCode: 'Code in die Zwischenablage kopieren',
    copied: 'Kopiert!',
    codeCopied: 'Code kopiert',
    copyFailed: 'Kopieren nicht möglich',
    ctrl: 'Strg',
    searchDocs: 'Dokumentation durchsuchen',
    searchPlaceholder: 'Dokumentation durchsuchen…',
    searchTerm: 'Suchbegriff',
    closeSearch: 'Suche schließen',
    cancel: 'Abbrechen',
    searchResults: 'Suchergebnisse',
    keyOpen: 'öffnen',
    keySelect: 'auswählen',
    keyClose: 'schließen',
    recent: 'Zuletzt gesucht',
    clearHistory: 'Verlauf löschen',
    chapters: 'Kapitel',
    emptyTitle: 'Wonach suchen Sie?',
    emptyText: 'Suche nach Überschriften und Text in allen Seiten.',
    unavailableTitle: 'Suche nicht verfügbar',
    unavailableText: 'Der Suchindex konnte nicht geladen werden.',
    noHitsFor: (q: string) => `Keine Treffer für „${q}“`,
    noHitsText: 'Versuchen Sie einen anderen oder kürzeren Begriff.',
    noHits: 'Keine Treffer',
    hits: (n: number) => `${n} Treffer`,
    sectionLinkCopied: 'Link zum Abschnitt kopiert',
    pageLinkCopied: 'Link zur Seite kopiert',
    image: 'Bild',
    close: 'Schließen',
    focusOn: 'Fokusmodus an',
    focusOff: 'Fokusmodus aus',
    or: 'oder',
    search: 'Suchen',
    prevPage: 'Vorherige Seite',
    nextPage: 'Nächste Seite',
    focusMode: 'Fokusmodus',
    toTop: 'Nach oben',
    thisHelp: 'Diese Übersicht',
    shortcuts: 'Tastenkürzel',
  },
  en: {
    theme: (m: string) => `Color scheme: ${m}`,
    light: 'Light',
    dark: 'Dark',
    system: 'System',
    copy: 'Copy',
    copyCode: 'Copy code to clipboard',
    copied: 'Copied!',
    codeCopied: 'Code copied',
    copyFailed: 'Copying failed',
    ctrl: 'Ctrl',
    searchDocs: 'Search documentation',
    searchPlaceholder: 'Search documentation…',
    searchTerm: 'Search term',
    closeSearch: 'Close search',
    cancel: 'Cancel',
    searchResults: 'Search results',
    keyOpen: 'open',
    keySelect: 'select',
    keyClose: 'close',
    recent: 'Recent searches',
    clearHistory: 'Clear history',
    chapters: 'Chapters',
    emptyTitle: 'What are you looking for?',
    emptyText: 'Search headings and text across all pages.',
    unavailableTitle: 'Search unavailable',
    unavailableText: 'The search index could not be loaded.',
    noHitsFor: (q: string) => `No results for “${q}”`,
    noHitsText: 'Try a different or shorter term.',
    noHits: 'No results',
    hits: (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`,
    sectionLinkCopied: 'Link to section copied',
    pageLinkCopied: 'Link to page copied',
    image: 'Image',
    close: 'Close',
    focusOn: 'Focus mode on',
    focusOff: 'Focus mode off',
    or: 'or',
    search: 'Search',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    focusMode: 'Focus mode',
    toTop: 'Back to top',
    thisHelp: 'This overview',
    shortcuts: 'Keyboard shortcuts',
  },
};

const L = IS_DE ? STRINGS.de : STRINGS.en;

const $ = <T extends Element = HTMLElement>(sel: string, ctx: ParentNode = doc) => ctx.querySelector<T>(sel as any) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, ctx: ParentNode = doc) => Array.from(ctx.querySelectorAll<T>(sel as any)) as T[];

function closestFrom<T extends Element = HTMLElement>(target: EventTarget | null, sel: string): T | null {
  return target instanceof Element ? (target.closest(sel) as T | null) : null;
}

function siteKey(name: string): string {
  return `ts:${doc.body.getAttribute('data-site') || ''}:${name}`;
}

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Speicher nicht verfügbar */
  }
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function headerOffset(): number {
  const h = $('.ts-header');
  return h ? h.getBoundingClientRect().height : 0;
}

function scrollBehavior(): ScrollBehavior {
  return REDUCED_MOTION.matches ? 'auto' : 'smooth';
}

const ICONS = {
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  page: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  enter: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M8 7h7M8 11h5"/>',
};

function icon(name: keyof typeof ICONS, size = 16, cls = 'ts-icon'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

// Live-Region für Ansagen an Bildschirmleser.
let liveRegion: HTMLElement | null = null;
function announce(msg: string) {
  if (!liveRegion) {
    liveRegion = doc.createElement('div');
    liveRegion.className = 'ts-sr';
    liveRegion.setAttribute('aria-live', 'polite');
    doc.body.appendChild(liveRegion);
  }
  liveRegion.textContent = '';
  window.setTimeout(() => (liveRegion!.textContent = msg), 30);
}

function focusables(container: HTMLElement): HTMLElement[] {
  return $$<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    container,
  ).filter((el) => el.offsetParent !== null || el === doc.activeElement);
}

function trapTab(e: KeyboardEvent, container: HTMLElement) {
  if (e.key !== 'Tab') return;
  const items = focusables(container);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && doc.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && doc.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// Farbschema
// ---------------------------------------------------------------------------

type ThemeMode = 'light' | 'dark' | 'system';

function currentTheme(): ThemeMode {
  const t = root.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

function applyTheme(mode: ThemeMode, persist = true) {
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  if (persist) store('ts-theme', mode === 'system' ? null : mode);
  $$('.ts-theme__option').forEach((o) => o.setAttribute('aria-checked', String(o.getAttribute('data-theme-value') === mode)));
}

function initTheme() {
  const wrap = $('.ts-theme');
  const btn = $<HTMLButtonElement>('.ts-theme__btn');
  const menu = $('.ts-theme__menu');
  if (!wrap || !btn || !menu) return;
  applyTheme(currentTheme(), false);

  const options = () => $$<HTMLButtonElement>('.ts-theme__option', menu);
  const close = (focusBtn = false) => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBtn) btn.focus();
  };
  const open = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const checked = options().find((o) => o.getAttribute('aria-checked') === 'true') ?? options()[0];
    checked?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.addEventListener('click', (e) => {
    const opt = closestFrom<HTMLElement>(e.target, '.ts-theme__option');
    if (!opt) return;
    const mode = opt.getAttribute('data-theme-value') as ThemeMode;
    applyTheme(mode);
    announce(L.theme(mode === 'light' ? L.light : mode === 'dark' ? L.dark : L.system));
    close(true);
  });
  menu.addEventListener('keydown', (e) => {
    const items = options();
    const i = items.indexOf(doc.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? i + 1 : i - 1;
      items[(n + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close();
    }
  });
  doc.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target as Node)) close();
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'ts-theme') applyTheme((e.newValue as ThemeMode) || 'system', false);
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function initNav() {
  for (const btn of $$<HTMLButtonElement>('.ts-nav__section-title')) {
    if (btn.dataset.tsInit) continue;
    btn.dataset.tsInit = '1';
    const list = doc.getElementById(btn.getAttribute('aria-controls') || '');
    if (!list) continue;
    const key = siteKey(`nav:${btn.getAttribute('data-section') || ''}`);
    const set = (expanded: boolean) => {
      btn.setAttribute('aria-expanded', String(expanded));
      list.hidden = !expanded;
    };
    if (!btn.hasAttribute('data-active') && store(key) === '0') set(false);
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') !== 'true';
      set(expanded);
      store(key, expanded ? null : '0');
    });
  }
  revealActiveNav();
}

function revealActiveNav() {
  const sidebar = $('.ts-sidebar');
  const active = $('.ts-nav__item.is-active > a');
  if (!sidebar || !active) return;
  const r = active.getBoundingClientRect();
  const s = sidebar.getBoundingClientRect();
  if (r.top < s.top + 40 || r.bottom > s.bottom - 40) {
    sidebar.scrollTop += r.top - s.top - s.height / 3;
  }
}

function initDrawer() {
  const sidebar = $('.ts-sidebar');
  const toggle = $<HTMLButtonElement>('.ts-menu-toggle');
  const backdrop = $('.ts-backdrop');
  const closeBtn = $<HTMLButtonElement>('.ts-sidebar__close');
  if (!sidebar || !toggle || !backdrop) return;
  const mq = window.matchMedia('(max-width: 959px)');

  const isOpen = () => sidebar.classList.contains('is-open');
  // Geschlossene Schublade ist für Tastatur und Bildschirmleser unerreichbar.
  const sync = () => {
    sidebar.inert = mq.matches && !isOpen();
  };
  const open = () => {
    sidebar.classList.add('is-open');
    sync();
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    doc.body.classList.add('ts-lock');
    window.setTimeout(() => {
      revealActiveNav();
      ($('.ts-nav__item.is-active > a', sidebar) ?? closeBtn)?.focus({ preventScroll: true });
    }, 50);
  };
  const close = (restoreFocus = true) => {
    if (!isOpen()) return;
    sidebar.classList.remove('is-open');
    sync();
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-modal');
    doc.body.classList.remove('ts-lock');
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  closeBtn?.addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  doc.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (sidebar.contains(doc.activeElement)) trapTab(e, sidebar);
  });
  sidebar.addEventListener('click', (e) => {
    if (closestFrom(e.target, '.ts-nav__link')) close(false);
  });
  mq.addEventListener('change', () => {
    if (!mq.matches) close(false);
    sync();
  });
  sync();
}

// ---------------------------------------------------------------------------
// Inhaltsverzeichnis (Scroll-Spy)
// ---------------------------------------------------------------------------

let tocCleanup: (() => void) | null = null;

function initToc() {
  tocCleanup?.();
  tocCleanup = null;
  const links = $$<HTMLAnchorElement>('.ts-toc .ts-toc__link');
  const marker = $('.ts-toc__marker');
  const tocBox = $('.ts-toc');
  if (!links.length) return;
  const targets = links
    .map((a) => ({ a, el: doc.getElementById(decodeURIComponent(a.getAttribute('data-toc-id') || '')) }))
    .filter((t): t is { a: HTMLAnchorElement; el: HTMLElement } => !!t.el);
  if (!targets.length) return;

  let current: HTMLAnchorElement | null = null;
  let frame = 0;
  const update = () => {
    frame = 0;
    const offset = headerOffset() + 32;
    let active: (typeof targets)[number] | null = null;
    for (const t of targets) {
      if (t.el.getBoundingClientRect().top - offset <= 0) active = t;
      else break;
    }
    if (!active) active = targets[0];
    const atBottom = window.innerHeight + window.scrollY >= doc.documentElement.scrollHeight - 4;
    if (atBottom) {
      const visible = targets.filter((t) => t.el.getBoundingClientRect().top < window.innerHeight);
      if (visible.length) active = visible[visible.length - 1];
    }
    const a = active?.a ?? null;
    if (a === current) return;
    current?.classList.remove('is-active');
    current?.removeAttribute('aria-current');
    current = a;
    if (a) {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'location');
      if (marker) {
        marker.style.opacity = '1';
        marker.style.height = `${a.offsetHeight - 8}px`;
        marker.style.transform = `translateY(${a.offsetTop + 4}px)`;
      }
      if (tocBox && tocBox.scrollHeight > tocBox.clientHeight) {
        const r = a.getBoundingClientRect();
        const b = tocBox.getBoundingClientRect();
        if (r.top < b.top + 60 || r.bottom > b.bottom - 60) tocBox.scrollTop += r.top - b.top - b.height / 2;
      }
    } else if (marker) {
      marker.style.opacity = '0';
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(schedule, { rootMargin: '0px 0px -60% 0px' }) : null;
  targets.forEach((t) => io?.observe(t.el));
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  update();
  tocCleanup = () => {
    io?.disconnect();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    if (frame) cancelAnimationFrame(frame);
  };
}

function initInlineToc() {
  for (const d of $$<HTMLDetailsElement>('.ts-toc-inline')) {
    if (d.dataset.tsInit) continue;
    d.dataset.tsInit = '1';
    d.addEventListener('click', (e) => {
      if (closestFrom(e.target, 'a')) d.open = false;
    });
  }
}

function flash(el: Element | null) {
  if (!el) return;
  el.classList.remove('ts-flash');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('ts-flash');
  window.setTimeout(() => el.classList.remove('ts-flash'), 1700);
}

function targetOfHash(): HTMLElement | null {
  const id = decodeURIComponent(location.hash.slice(1));
  return id ? doc.getElementById(id) : null;
}

// ---------------------------------------------------------------------------
// Codeblöcke
// ---------------------------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* Rückfall unten */
  }
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  doc.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function initCode() {
  for (const block of $$('.ts-code')) {
    if (block.dataset.tsInit) continue;
    block.dataset.tsInit = '1';
    const code = $('pre code', block) ?? $('pre', block);
    const pre = $('pre', block);
    if (!code || !pre) continue;

    if (block.classList.contains('ts-code--lines') && !$('.ts-code__gutter', block)) {
      const text = (code.textContent || '').replace(/\n$/, '');
      const count = text.split('\n').length;
      const gutter = doc.createElement('span');
      gutter.className = 'ts-code__gutter';
      gutter.setAttribute('aria-hidden', 'true');
      gutter.textContent = Array.from({ length: count }, (_, i) => String(i + 1)).join('\n');
      pre.insertBefore(gutter, pre.firstChild);
    }

    let header = $('.ts-code__header', block);
    if (!header) {
      header = doc.createElement('div');
      header.className = 'ts-code__header';
      block.insertBefore(header, block.firstChild);
    }
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ts-code__copy';
    const idle = `${icon('copy', 14)}<span>${L.copy}</span>`;
    btn.innerHTML = idle;
    btn.setAttribute('aria-label', L.copyCode);
    let timer = 0;
    btn.addEventListener('click', async () => {
      const ok = await copyText((code.textContent || '').replace(/\n$/, ''));
      window.clearTimeout(timer);
      btn.classList.toggle('is-copied', ok);
      btn.innerHTML = ok ? `${icon('check', 14)}<span>${L.copied}</span>` : `<span>${L.copyFailed}</span>`;
      announce(ok ? L.codeCopied : L.copyFailed);
      timer = window.setTimeout(() => {
        btn.classList.remove('is-copied');
        btn.innerHTML = idle;
      }, 1800);
    });
    header.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

let index: MiniSearch<SearchDoc> | null = null;
let indexPromise: Promise<MiniSearch<SearchDoc> | null> | null = null;
let indexStale = false;

function loadIndex(force = false): Promise<MiniSearch<SearchDoc> | null> {
  if (force || indexStale) {
    indexStale = false;
    indexPromise = null;
    index = null;
  }
  if (indexPromise) return indexPromise;
  indexPromise = new Promise((resolve) => {
    const build = () => {
      const data = window.__TS_SEARCH__;
      if (!data || !data.index) return resolve(null);
      try {
        index = MiniSearch.loadJS<SearchDoc>(data.index as any, SEARCH_OPTIONS as any);
        resolve(index);
      } catch {
        resolve(null);
      }
    };
    if (window.__TS_SEARCH__ && !force) return build();
    const s = doc.createElement('script');
    s.src = `${STATIC_BASE}search-index.js${force || PREVIEW ? `?v=${Date.now()}` : ''}`;
    s.async = true;
    s.onload = () => {
      build();
      s.remove();
    };
    s.onerror = () => {
      s.remove();
      resolve(null);
    };
    doc.head.appendChild(s);
  });
  return indexPromise;
}

const DIACRITICS = /[̀-ͯ]/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let n = s[i].toLowerCase();
    if (n === 'ß') n = 'ss';
    n = n.normalize('NFD').replace(DIACRITICS, '');
    for (const c of n) {
      norm += c;
      map.push(i);
    }
  }
  map.push(s.length);
  return { norm, map };
}

function matchRanges(s: string, terms: string[]): [number, number][] {
  if (!s || !terms.length) return [];
  const { norm, map } = normalizeWithMap(s);
  const ranges: [number, number][] = [];
  for (const term of [...new Set(terms)].sort((a, b) => b.length - a.length)) {
    if (!term) continue;
    let i = 0;
    while ((i = norm.indexOf(term, i)) !== -1) {
      if (i === 0 || !WORD_CHAR.test(norm[i - 1])) {
        let end = i + term.length;
        while (end < norm.length && WORD_CHAR.test(norm[end])) end++;
        ranges.push([map[i], map[end] ?? s.length]);
        i = end;
      } else i += term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function highlight(s: string, ranges: [number, number][], from = 0, to = s.length): string {
  let out = '';
  let pos = from;
  for (const [a, b] of ranges) {
    if (b <= from || a >= to) continue;
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    out += escapeHtml(s.slice(pos, start)) + `<mark>${escapeHtml(s.slice(start, end))}</mark>`;
    pos = end;
  }
  return out + escapeHtml(s.slice(pos, to));
}

function excerpt(text: string, terms: string[]): string {
  const ranges = matchRanges(text, terms);
  const LEN = 170;
  if (!ranges.length) {
    const end = Math.min(text.length, LEN);
    return escapeHtml(text.slice(0, end)) + (end < text.length ? ' …' : '');
  }
  let start = Math.max(0, ranges[0][0] - 55);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp !== -1 && sp < ranges[0][0]) start = sp + 1;
  }
  let end = Math.min(text.length, start + LEN);
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > ranges[0][1]) end = sp;
  }
  return (start > 0 ? '… ' : '') + highlight(text, ranges, start, end) + (end < text.length ? ' …' : '');
}

interface Group {
  page: string;
  title: string;
  hits: Hit[];
}

function search(ms: MiniSearch<SearchDoc>, query: string): Group[] {
  const opts = {
    prefix: (term: string) => term.length >= 2,
    fuzzy: (term: string) => (term.length > 4 ? 0.2 : false),
    boost: { heading: 3, pageTitle: 2 },
  };
  let results = ms.search(query, { ...opts, combineWith: 'AND' }) as unknown as Hit[];
  if (!results.length) results = ms.search(query, { ...opts, combineWith: 'OR' }) as unknown as Hit[];
  // Abschnitte, die nur über den Seitentitel passen, nicht einzeln aufführen –
  // stattdessen höchstens einen Treffer pro Seite für den Titel zeigen.
  const onlyTitle = (r: Hit) => {
    const fields = Object.values(r.match ?? {}).flat();
    return fields.length > 0 && fields.every((f) => f === 'pageTitle');
  };
  const covered = new Set(results.filter(isPageHit).map((r) => r.page));
  results = results.filter((r) => {
    if (isPageHit(r) || !onlyTitle(r)) return true;
    if (covered.has(r.page)) return false;
    covered.add(r.page);
    r.anchor = '';
    r.heading = r.pageTitle;
    return true;
  });
  const groups = new Map<string, Group>();
  let total = 0;
  for (const r of results) {
    let g = groups.get(r.page);
    if (!g) {
      g = { page: r.page, title: r.pageTitle, hits: [] };
      groups.set(r.page, g);
    }
    if (g.hits.length >= 6 || total >= 40) continue;
    g.hits.push(r);
    total++;
  }
  return [...groups.values()].filter((g) => g.hits.length);
}

function hrefOf(page: string, anchor: string): string {
  return `${encodeURIComponent(page)}.html${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

function currentPage(): string {
  return doc.body.getAttribute('data-page') || '';
}

function goTo(page: string, anchor: string) {
  if (page === currentPage()) {
    if (anchor) {
      const el = doc.getElementById(anchor);
      if (el) {
        history.pushState(null, '', `#${encodeURIComponent(anchor)}`);
        el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        flash(el);
      }
    } else {
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }
    return;
  }
  location.href = hrefOf(page, anchor);
}

function recentSearches(): string[] {
  try {
    const v = JSON.parse(store(siteKey('recent')) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

function rememberSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  const list = [t, ...recentSearches().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
  store(siteKey('recent'), JSON.stringify(list));
}

function initSearch() {
  const triggers = $$('[data-ts-search]');
  const shortcut = $$('[data-ts-shortcut]');
  shortcut.forEach((k) => (k.textContent = IS_MAC ? '⌘ K' : `${L.ctrl} K`));

  let modal: HTMLElement | null = null;
  let input: HTMLInputElement;
  let list: HTMLElement;
  let lastFocus: HTMLElement | null = null;
  let options: HTMLElement[] = [];
  let active = -1;
  let seq = 0;

  const build = () => {
    modal = doc.createElement('div');
    modal.className = 'ts-search';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="ts-search__backdrop"></div>
      <div class="ts-search__panel" role="dialog" aria-modal="true" aria-label="${L.searchDocs}">
        <div class="ts-search__bar">
          ${icon('search', 19)}
          <input class="ts-search__input" type="search" placeholder="${L.searchPlaceholder}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go"
            role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="ts-search-results" aria-label="${L.searchTerm}">
          <button class="ts-btn ts-search__close" type="button" aria-label="${L.closeSearch}"><kbd class="ts-kbd ts-search__close-key">Esc</kbd><span class="ts-search__close-text">${L.cancel}</span></button>
        </div>
        <div class="ts-search__results" id="ts-search-results" role="listbox" aria-label="${L.searchResults}"></div>
        <div class="ts-search__footer" aria-hidden="true">
          <span><kbd class="ts-kbd">↵</kbd> ${L.keyOpen}</span>
          <span><kbd class="ts-kbd">↑</kbd><kbd class="ts-kbd">↓</kbd> ${L.keySelect}</span>
          <span><kbd class="ts-kbd">Esc</kbd> ${L.keyClose}</span>
        </div>
      </div>`;
    doc.body.appendChild(modal);
    input = $<HTMLInputElement>('.ts-search__input', modal)!;
    list = $('.ts-search__results', modal)!;
    $('.ts-search__backdrop', modal)!.addEventListener('click', close);
    $('.ts-search__close', modal)!.addEventListener('click', close);
    input.addEventListener('input', () => run());
    modal.addEventListener('keydown', onKey);
    list.addEventListener('mousemove', (e) => {
      const opt = closestFrom<HTMLElement>(e.target, '[role="option"]');
      if (opt) setActive(options.indexOf(opt), false);
    });
    list.addEventListener('click', (e) => {
      const opt = closestFrom<HTMLElement>(e.target, '[role="option"]');
      if (opt) {
        e.preventDefault();
        choose(opt);
      }
      const clear = closestFrom(e.target, '.ts-search__recent-clear');
      if (clear) {
        store(siteKey('recent'), null);
        run();
        input.focus();
      }
    });
  };

  const setActive = (i: number, scroll = true) => {
    if (active >= 0 && options[active]) options[active].setAttribute('aria-selected', 'false');
    active = options.length ? Math.max(0, Math.min(i, options.length - 1)) : -1;
    if (active >= 0) {
      const opt = options[active];
      opt.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', opt.id);
      if (scroll) opt.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const choose = (opt: HTMLElement) => {
    const recent = opt.getAttribute('data-recent');
    if (recent !== null) {
      input.value = recent;
      run();
      input.focus();
      return;
    }
    rememberSearch(input.value);
    const page = opt.getAttribute('data-page') || '';
    const anchor = opt.getAttribute('data-anchor') || '';
    close();
    goTo(page, anchor);
  };

  const renderEmpty = () => {
    const recent = recentSearches();
    // Ohne Suchbegriff: zuletzt gesucht und die Kapitel als Schnellzugriff.
    const pages = $$<HTMLAnchorElement>('.ts-nav .ts-nav__link')
      .map((a) => ({ title: (a.textContent || '').trim(), slug: decodeURIComponent((/([^/?#]+)\.html/.exec(a.getAttribute('href') || '') ?? [])[1] || '') }))
      .filter((p) => p.slug && p.slug !== currentPage())
      .slice(0, 8);
    let n = 0;
    const recentHtml = recent.length
      ? `<div role="group" aria-labelledby="ts-search-recent"><p class="ts-search__group-title" id="ts-search-recent">${L.recent}<button type="button" class="ts-search__recent-clear">${L.clearHistory}</button></p><div class="ts-search__list">${recent
          .map(
            (q) =>
              `<a class="ts-search__item" role="option" id="ts-search-opt-${n++}" aria-selected="false" data-recent="${escapeHtml(q)}" href="#"><span class="ts-search__item-icon">${icon('clock', 15)}</span><span class="ts-search__item-body"><span class="ts-search__item-title">${escapeHtml(q)}</span></span><span class="ts-search__item-enter">${icon('enter', 15)}</span></a>`,
          )
          .join('')}</div></div>`
      : '';
    const pagesHtml = pages.length
      ? `<div role="group" aria-labelledby="ts-search-pages"><p class="ts-search__group-title" id="ts-search-pages">${L.chapters}</p><div class="ts-search__list">${pages
          .map(
            (p) =>
              `<a class="ts-search__item" role="option" id="ts-search-opt-${n++}" aria-selected="false" data-page="${escapeHtml(p.slug)}" data-anchor="" href="${hrefOf(p.slug, '')}" tabindex="-1"><span class="ts-search__item-icon">${icon('book', 15)}</span><span class="ts-search__item-body"><span class="ts-search__item-title">${escapeHtml(p.title)}</span></span><span class="ts-search__item-enter">${icon('enter', 15)}</span></a>`,
          )
          .join('')}</div></div>`
      : '';
    list.innerHTML =
      recentHtml || pagesHtml
        ? recentHtml + pagesHtml
        : `<div class="ts-search__empty"><strong>${L.emptyTitle}</strong>${L.emptyText}</div>`;
    options = $$('[role="option"]', list);
    setActive(-1);
  };

  const run = async () => {
    const q = input.value;
    const my = ++seq;
    if (!q.trim()) return renderEmpty();
    const ms = await loadIndex();
    if (my !== seq) return;
    if (!ms) {
      list.innerHTML = `<div class="ts-search__empty"><strong>${L.unavailableTitle}</strong>${L.unavailableText}</div>`;
      options = [];
      return;
    }
    const groups = search(ms, q);
    if (!groups.length) {
      list.innerHTML = `<div class="ts-search__empty"><strong>${L.noHitsFor(escapeHtml(q.trim()))}</strong>${L.noHitsText}</div>`;
      options = [];
      setActive(-1);
      announce(L.noHits);
      return;
    }
    let n = 0;
    list.innerHTML = groups
      .map((g, gi) => {
        const items = g.hits
          .map((h) => {
            const isPage = isPageHit(h);
            const title = isPage ? h.pageTitle : h.heading;
            const anchor = isPage ? '' : h.anchor;
            const terms = h.terms ?? [];
            return `<a class="ts-search__item" role="option" id="ts-search-opt-${n++}" aria-selected="false" data-page="${escapeHtml(h.page)}" data-anchor="${escapeHtml(anchor)}" href="${hrefOf(h.page, anchor)}" tabindex="-1">
              <span class="ts-search__item-icon">${icon(isPage ? 'page' : 'hash', 15)}</span>
              <span class="ts-search__item-body"><span class="ts-search__item-title">${highlight(title, matchRanges(title, terms))}</span>${
                h.text ? `<span class="ts-search__item-text">${excerpt(h.text, terms)}</span>` : ''
              }</span>
              <span class="ts-search__item-enter">${icon('enter', 15)}</span></a>`;
          })
          .join('');
        return `<div role="group" aria-labelledby="ts-search-g${gi}"><p class="ts-search__group-title" id="ts-search-g${gi}">${escapeHtml(g.title)}</p><div class="ts-search__list">${items}</div></div>`;
      })
      .join('');
    options = $$('[role="option"]', list);
    setActive(0);
    list.scrollTop = 0;
    announce(L.hits(options.length));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active < 0 ? 0 : (active + 1) % Math.max(options.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      if (active >= 0 && options[active]) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === 'Tab') {
      trapTab(e, $('.ts-search__panel', modal!)!);
    }
  };

  const open = (initial = '') => {
    if (!modal) build();
    if (!modal!.hidden) return;
    lastFocus = doc.activeElement as HTMLElement;
    modal!.hidden = false;
    doc.body.classList.add('ts-lock');
    triggers.forEach((t) => t.setAttribute('aria-expanded', 'true'));
    if (initial) input.value = initial;
    input.select();
    input.focus();
    void loadIndex();
    run();
  };

  const close = () => {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    doc.body.classList.remove('ts-lock');
    triggers.forEach((t) => t.setAttribute('aria-expanded', 'false'));
    lastFocus?.focus?.();
  };

  triggers.forEach((t) => t.addEventListener('click', () => open()));
  doc.addEventListener('keydown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const typing = target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey) {
      e.preventDefault();
      if (modal && !modal.hidden) close();
      else open();
    } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  });

  // Index im Leerlauf vorladen, damit die erste Suche sofort reagiert.
  const idle = (window as any).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
  idle(() => void loadIndex());

  searchApi = {
    refresh() {
      indexStale = true;
      if (modal && !modal.hidden) {
        void loadIndex(true).then(() => run());
      }
    },
  };
}

let searchApi: { refresh(): void } | null = null;

// ---------------------------------------------------------------------------
// Vorschau-Protokoll (Editor ↔ Vorschau-iframe)
// ---------------------------------------------------------------------------

function initPreview() {
  if (!PREVIEW || window.parent === window) return;
  const post = (msg: Record<string, unknown>) => window.parent.postMessage(msg, '*');
  let suppressUntil = 0;

  const RESTORE = 'ts-preview-scroll';
  try {
    const saved = sessionStorage.getItem(RESTORE);
    if (saved) {
      sessionStorage.removeItem(RESTORE);
      const { path, y } = JSON.parse(saved);
      if (path === location.pathname) {
        suppressUntil = Date.now() + 800;
        window.scrollTo(0, y);
      }
    }
  } catch {
    /* ignorieren */
  }

  const linesIn = () =>
    $$('[data-line]', $('.ts-article') ?? doc).filter((el) => (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0);

  const scrollToLine = (line: number) => {
    let best: HTMLElement | null = null;
    let bestLine = -1;
    for (const el of linesIn()) {
      const l = Number(el.getAttribute('data-line'));
      if (Number.isFinite(l) && l <= line && l >= bestLine) {
        best = el;
        bestLine = l;
      }
    }
    if (!best) {
      suppressUntil = Date.now() + 700;
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      return;
    }
    const top = best.getBoundingClientRect().top + window.scrollY - headerOffset() - 16;
    suppressUntil = Date.now() + 900;
    window.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
    flash(best);
  };

  const reload = async (hard: boolean) => {
    if (hard) {
      try {
        sessionStorage.setItem(RESTORE, JSON.stringify({ path: location.pathname, y: window.scrollY }));
      } catch {
        /* ignorieren */
      }
      location.reload();
      return;
    }
    let html: string;
    try {
      const res = await fetch(location.href.split('#')[0], { cache: 'no-store' });
      if (!res.ok) return;
      html = await res.text();
    } catch {
      return;
    }
    const next = new DOMParser().parseFromString(html, 'text/html');
    // Andere Dokumentsprache: Beschriftungen der Laufzeit stimmen nicht mehr.
    if ((next.documentElement.getAttribute('lang') || 'de').toLowerCase() !== DOC_LANG) return reload(true);
    const y = window.scrollY;
    const swap = (sel: string) => {
      const cur = $(sel);
      const neu = $(sel, next);
      if (cur && neu && cur.innerHTML !== neu.innerHTML) cur.innerHTML = neu.innerHTML;
    };
    swap('.ts-main');
    swap('.ts-toc');
    swap('.ts-nav');
    swap('.ts-brand');
    if (next.title) doc.title = next.title;
    // Stile (z. B. geänderte Komponenten-CSS) ohne Flackern neu laden.
    const link = $<HTMLLinkElement>('link[rel="stylesheet"][href*="site.css"]');
    if (link) {
      const fresh = link.cloneNode() as HTMLLinkElement;
      fresh.href = `${link.href.split('?')[0]}?v=${Date.now()}`;
      fresh.onload = () => link.remove();
      link.after(fresh);
    }
    suppressUntil = Date.now() + 500;
    window.scrollTo(0, y);
    initContent();
    searchApi?.refresh();
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ts:reload') void reload(!!d.hard);
    else if (d.type === 'ts:scrollToLine' && typeof d.line === 'number') scrollToLine(d.line);
  });

  doc.addEventListener('click', (e) => {
    const a = closestFrom<HTMLAnchorElement>(e.target, 'a[href]');
    if (!a || a.target === '_blank') return;
    const href = a.getAttribute('href') || '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return;
    const m = /([^/?#]+)\.html(?:[?#]|$)/.exec(href);
    if (m) post({ type: 'ts:navigate', slug: decodeURIComponent(m[1]) });
  });

  let timer = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (Date.now() < suppressUntil) return;
        const offset = headerOffset() + 8;
        for (const el of linesIn()) {
          if (el.getBoundingClientRect().bottom > offset) {
            const line = Number(el.getAttribute('data-line'));
            if (Number.isFinite(line)) post({ type: 'ts:visible-line', line });
            break;
          }
        }
      }, 120);
    },
    { passive: true },
  );

  post({ type: 'ts:ready', slug: currentPage() });
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

let toastEl: HTMLElement | null = null;
let toastTimer = 0;

function toast(msg: string, ok = true) {
  window.clearTimeout(toastTimer);
  toastEl?.remove();
  toastEl = doc.createElement('div');
  toastEl.className = 'ts-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.innerHTML = `${ok ? icon('check', 15) : ''}<span>${escapeHtml(msg)}</span>`;
  doc.body.appendChild(toastEl);
  const el = toastEl;
  toastTimer = window.setTimeout(() => {
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 220);
  }, 1600);
}

function pageUrl(hash = ''): string {
  return location.href.split('#')[0] + (hash ? `#${hash}` : '');
}

// ---------------------------------------------------------------------------
// Direktlinks, Nach oben, Lesefortschritt
// ---------------------------------------------------------------------------

function initLinks() {
  doc.addEventListener('click', async (e) => {
    // Überschrift: Direktlink kopieren
    const anchor = closestFrom<HTMLAnchorElement>(e.target, '.ts-anchor');
    if (anchor) {
      e.preventDefault();
      const id = decodeURIComponent((anchor.getAttribute('href') || '').slice(1));
      if (!id) return;
      history.replaceState(null, '', `#${encodeURIComponent(id)}`);
      const ok = await copyText(pageUrl(encodeURIComponent(id)));
      toast(ok ? L.sectionLinkCopied : L.copyFailed, ok);
      flash(doc.getElementById(id));
      return;
    }
    if (closestFrom(e.target, '[data-ts-copy-link]')) {
      const ok = await copyText(pageUrl());
      toast(ok ? L.pageLinkCopied : L.copyFailed, ok);
      return;
    }
    if (closestFrom(e.target, '[data-ts-top]')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      $<HTMLElement>('#ts-content')?.focus({ preventScroll: true });
    }
  });
}

function initScrollUi() {
  const topBtn = $('.ts-totop');
  let frame = 0;
  const update = () => {
    frame = 0;
    const y = window.scrollY;
    if (topBtn) topBtn.hidden = y < 700;
    const bar = $<SVGCircleElement>('.ts-toc__progress-bar');
    const article = $('.ts-article');
    if (bar && article) {
      const start = article.getBoundingClientRect().top + y - headerOffset();
      const end = start + article.offsetHeight - window.innerHeight + headerOffset();
      const p = end > start ? Math.min(1, Math.max(0, (y - start) / (end - start))) : 1;
      bar.style.setProperty('--ts-progress', String(100 - p * 100));
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  doc.addEventListener('ts:content', schedule);
  update();
}

// ---------------------------------------------------------------------------
// Bildlupe
// ---------------------------------------------------------------------------

function markZoomable() {
  for (const img of $$<HTMLImageElement>('.ts-article img')) {
    if (img.dataset.tsZoom || img.closest('a, .ts-chapter, .ts-math, .ts-typst-render')) continue;
    img.dataset.tsZoom = '1';
    img.classList.add('ts-zoomable');
  }
}

function initLightbox() {
  let box: HTMLElement | null = null;
  let lastFocus: HTMLElement | null = null;
  const close = () => {
    if (!box) return;
    box.remove();
    box = null;
    doc.body.classList.remove('ts-lock');
    lastFocus?.focus?.({ preventScroll: true });
  };
  const open = (img: HTMLImageElement) => {
    lastFocus = doc.activeElement as HTMLElement;
    const caption = img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt || '';
    box = doc.createElement('div');
    box.className = 'ts-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', caption || L.image);
    box.innerHTML = `<button class="ts-btn ts-btn--icon ts-lightbox__close" type="button" aria-label="${L.close}">${icon('close', 18)}</button><img class="ts-lightbox__img" alt="${escapeHtml(img.alt || '')}" src="${escapeHtml(img.currentSrc || img.src)}">${
      caption ? `<p class="ts-lightbox__caption">${escapeHtml(caption)}</p>` : ''
    }`;
    // Vektorgrafiken auf die verfügbare Breite vergrößern
    if (/\.svg(?:[?#]|$)/i.test(img.currentSrc || img.src)) $('.ts-lightbox__img', box)?.classList.add('is-vector');
    box.addEventListener('click', close);
    doc.body.appendChild(box);
    doc.body.classList.add('ts-lock');
    $<HTMLButtonElement>('.ts-lightbox__close', box)?.focus({ preventScroll: true });
  };
  doc.addEventListener('click', (e) => {
    const img = closestFrom<HTMLImageElement>(e.target, 'img.ts-zoomable');
    if (img) open(img);
  });
  doc.addEventListener('keydown', (e) => {
    if (box && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
}

// ---------------------------------------------------------------------------
// Fokusmodus und Tastenkürzel
// ---------------------------------------------------------------------------

function setFocusMode(on: boolean) {
  if (on) root.setAttribute('data-focus', '');
  else root.removeAttribute('data-focus');
  store('ts-focus', on ? '1' : null);
  $$('[data-ts-focus]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
  announce(on ? L.focusOn : L.focusOff);
}

function initFocusMode() {
  const on = root.hasAttribute('data-focus');
  $$('[data-ts-focus]').forEach((b) => {
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => setFocusMode(!root.hasAttribute('data-focus')));
  });
}

let helpBox: HTMLElement | null = null;

function toggleHelp() {
  if (helpBox) {
    helpBox.remove();
    helpBox = null;
    return;
  }
  const k = (s: string) => `<kbd class="ts-kbd">${escapeHtml(s)}</kbd>`;
  const mod = IS_MAC ? '⌘' : L.ctrl;
  const rows: [string, string][] = [
    [L.search, `${k(mod)}${k('K')} ${L.or} ${k('/')}`],
    [L.prevPage, k('[')],
    [L.nextPage, k(']')],
    [L.focusMode, k('F')],
    [L.toTop, k('T')],
    [L.thisHelp, k('?')],
  ];
  helpBox = doc.createElement('div');
  helpBox.className = 'ts-dialog';
  helpBox.innerHTML = `<div class="ts-dialog__backdrop"></div><div class="ts-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="ts-help-title"><p class="ts-dialog__title" id="ts-help-title">${L.shortcuts}</p><dl class="ts-shortcuts">${rows
    .map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`)
    .join('')}</dl></div>`;
  helpBox.addEventListener('click', (e) => {
    if (closestFrom(e.target, '.ts-dialog__backdrop')) toggleHelp();
  });
  doc.body.appendChild(helpBox);
}

function initShortcuts() {
  doc.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if ($('.ts-search:not([hidden])') || $('.ts-lightbox')) return;
    if (helpBox && (e.key === 'Escape' || e.key === '?')) {
      e.preventDefault();
      toggleHelp();
      return;
    }
    const go = (sel: string) => {
      const a = $<HTMLAnchorElement>(sel);
      if (a) location.href = a.href;
    };
    switch (e.key) {
      case '[':
        go('[data-ts-prev]');
        break;
      case ']':
        go('[data-ts-next]');
        break;
      case 'f':
      case 'F':
        setFocusMode(!root.hasAttribute('data-focus'));
        break;
      case 't':
      case 'T':
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
        break;
      case '?':
        toggleHelp();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}

// Position der Navigation beim Seitenwechsel beibehalten.
function initSidebarMemory() {
  const sidebar = $('.ts-sidebar');
  if (!sidebar) return;
  const key = siteKey('sidebar-scroll');
  try {
    const y = Number(sessionStorage.getItem(key));
    if (Number.isFinite(y) && y > 0) sidebar.scrollTop = y;
  } catch {
    /* ignorieren */
  }
  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(key, String(sidebar.scrollTop));
    } catch {
      /* ignorieren */
    }
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function initContent() {
  initNav();
  initToc();
  initInlineToc();
  initCode();
  markZoomable();
  doc.dispatchEvent(new Event('ts:content'));
}

function start() {
  initTheme();
  initSidebarMemory();
  initDrawer();
  initSearch();
  initLinks();
  initLightbox();
  initFocusMode();
  initShortcuts();
  initContent();
  initScrollUi();
  initPreview();
  window.addEventListener('hashchange', () => flash(targetOfHash()));
  if (location.hash) {
    const t = targetOfHash();
    if (t && /^H[2-6]$/.test(t.tagName)) window.setTimeout(() => flash(t), 250);
  }
}

if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
else start();
