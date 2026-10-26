// SPDX-License-Identifier: MIT-0
// Der Seitenrahmen landet in jeder exportierten Site und steht deshalb, wie die
// Site-Laufzeit, unter MIT-0. Icons nach Lucide (ISC), siehe third-party/.
//
// Seitenrahmen der exportierten HTML5-Site.
//
// Aufbau: Kopfzeile mit Suche, Navigation links, Inhalt, „Auf dieser Seite“
// rechts. Die Startseite (index) erhält einen Titelbereich und eine
// Kapitelübersicht mit Direktlinks. Verhalten (Suche, Scroll-Spy, Lupe,
// Tastenkürzel …) liefert `site/src/site.ts`, die Gestaltung `site/src/site.css`.

import type { Heading, NavSection, SiteOptions } from './types';
import { escapeHtml } from './util';
import { formatDate, labelLang, type Lang } from './i18n';

export interface ShellPage {
  slug: string;
  title: string;
  description?: string;
  headings: Heading[];
  html: string;
  path: string;
  /** Geschätzte Lesezeit in Minuten. */
  minutes?: number;
  /** Kurzbeschreibung für Übersichten und Metadaten. */
  excerpt?: string;
  /** Erzeugte Startseite ohne eigene Markdoc-Quelle. */
  synthetic?: boolean;
}

export interface ShellContext {
  site: SiteOptions;
  nav: NavSection[];
  pages: Map<string, ShellPage>;
  order: string[];
  sectionOf: Map<string, string | undefined>;
  /** Slug der Startseite, wenn eine Startseite mit Übersicht erzeugt wird. */
  home?: string;
  /** Sprache der Beschriftungen; Standard: aus `site.lang`. */
  lang?: Lang;
}

// ---------------------------------------------------------------------------
// Beschriftungen je Dokumentsprache (Deutsch, sonst Englisch)
// ---------------------------------------------------------------------------

interface Labels {
  overview: string;
  onThisPage: string;
  downloadPdf: string;
  downloadAsPdf: string;
  copyLink: string;
  backToTop: string;
  more(n: number): string;
  contents: string;
  chapters(n: number): string;
  readingTime(minutes: number): string;
  version(v: string): string;
  updated(date: string): string;
  startReading: string;
  searchDocs: string;
  searchShort: string;
  shortcutKey: string;
  prev: string;
  next: string;
  pagerLabel: string;
  openRepo: string;
  repo: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
  skipToContent: string;
  openNav: string;
  closeNav: string;
  openSearch: string;
  focusMode: string;
  chooseTheme: string;
  theme: string;
  siteNav: string;
  docsNav: string;
  tocLabel: string;
  builtWith: string;
}

const LABELS: Record<Lang, Labels> = {
  de: {
    overview: 'Übersicht',
    onThisPage: 'Auf dieser Seite',
    downloadPdf: 'PDF herunterladen',
    downloadAsPdf: 'Als PDF herunterladen',
    copyLink: 'Link kopieren',
    backToTop: 'Nach oben',
    more: (n) => `+ ${n} weitere`,
    contents: 'Inhalt',
    chapters: (n) => `${n} Kapitel`,
    readingTime: (m) => `${m} Min. Lesezeit`,
    version: (v) => `Version ${v}`,
    updated: (d) => `Stand ${d}`,
    startReading: 'Lesen beginnen',
    searchDocs: 'Dokumentation durchsuchen',
    searchShort: 'Suchen …',
    shortcutKey: 'Strg K',
    prev: 'Zurück',
    next: 'Weiter',
    pagerLabel: 'Weitere Seiten',
    openRepo: 'Quell-Repository öffnen',
    repo: 'Repository',
    themeLight: 'Hell',
    themeDark: 'Dunkel',
    themeSystem: 'System',
    skipToContent: 'Zum Inhalt springen',
    openNav: 'Navigation öffnen',
    closeNav: 'Navigation schließen',
    openSearch: 'Suche öffnen',
    focusMode: 'Fokusmodus',
    chooseTheme: 'Farbschema wählen',
    theme: 'Farbschema',
    siteNav: 'Seitennavigation',
    docsNav: 'Dokumentation',
    tocLabel: 'Inhalt dieser Seite',
    builtWith: 'Erstellt mit Sqritto',
  },
  en: {
    overview: 'Overview',
    onThisPage: 'On this page',
    downloadPdf: 'Download PDF',
    downloadAsPdf: 'Download as PDF',
    copyLink: 'Copy link',
    backToTop: 'Back to top',
    more: (n) => `+ ${n} more`,
    contents: 'Contents',
    chapters: (n) => `${n} ${n === 1 ? 'chapter' : 'chapters'}`,
    readingTime: (m) => `${m} min read`,
    version: (v) => `Version ${v}`,
    updated: (d) => `Updated ${d}`,
    startReading: 'Start reading',
    searchDocs: 'Search documentation',
    searchShort: 'Search…',
    shortcutKey: 'Ctrl K',
    prev: 'Previous',
    next: 'Next',
    pagerLabel: 'More pages',
    openRepo: 'Open source repository',
    repo: 'Repository',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    skipToContent: 'Skip to content',
    openNav: 'Open navigation',
    closeNav: 'Close navigation',
    openSearch: 'Open search',
    focusMode: 'Focus mode',
    chooseTheme: 'Choose color scheme',
    theme: 'Color scheme',
    siteNav: 'Site navigation',
    docsNav: 'Documentation',
    tocLabel: 'Contents of this page',
    builtWith: 'Built with Sqritto',
  },
};

const I = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  repo: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.1-1.3-.3-2.5-1-3.5.3-1.1.3-2.3 0-3.5 0 0-1 0-3 1.5a10.3 10.3 0 0 0-6 0C8 2 7 2 7 2c-.3 1.2-.3 2.4 0 3.5-.7 1-1.1 2.2-1 3.5 0 3.5 3 5.5 6 5.5-.4.5-.7 1-.9 1.6-.2.6-.2 1.2-.1 1.9v4M9 18c-4.5 2-5-2-7-2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M8 7h7M8 11h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};

function icon(name: keyof typeof I, cls = 'ts-icon', size = 18): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name]}</svg>`;
}

function readingTime(n: number | undefined, L: Labels): string {
  return L.readingTime(Math.max(1, Math.round(n ?? 1)));
}

function navHtml(nav: NavSection[], pages: Map<string, ShellPage>, current: string, L: Labels, home?: string): string {
  const homeLink =
    home && pages.has(home) && !nav.some((s) => s.pages.includes(home))
      ? `<div class="ts-nav__section"><ul class="ts-nav__list" role="list"><li class="ts-nav__item${current === home ? ' is-active' : ''}"><a class="ts-nav__link" href="${escapeHtml(home)}.html"${
          current === home ? ' aria-current="page"' : ''
        }>${L.overview}</a></li></ul></div>`
      : '';
  return (
    homeLink +
    nav
      .map((sec, i) => {
        const items = sec.pages
          .map((slug) => pages.get(slug))
          .filter((p): p is ShellPage => !!p)
          .map((p) => {
            const active = p.slug === current;
            return `<li class="ts-nav__item${active ? ' is-active' : ''}"><a class="ts-nav__link" href="${escapeHtml(p.slug)}.html"${
              active ? ' aria-current="page"' : ''
            }>${escapeHtml(p.title)}</a></li>`;
          })
          .join('');
        if (!items) return '';
        const hasActive = sec.pages.includes(current);
        const title = sec.title
          ? `<button class="ts-nav__section-title" type="button" aria-expanded="true" aria-controls="ts-nav-${i}" data-section="${escapeHtml(sec.title)}"${
              hasActive ? ' data-active' : ''
            }><span>${escapeHtml(sec.title)}</span>${icon('down', 'ts-icon ts-nav__chevron', 14)}</button>`
          : '';
        return `<div class="ts-nav__section">${title}<ul class="ts-nav__list" id="ts-nav-${i}" role="list">${items}</ul></div>`;
      })
      .join('')
  );
}

function tocItems(headings: Heading[]): Heading[] {
  return headings.filter((h) => h.level === 2 || h.level === 3);
}

function tocList(items: Heading[], cls: string): string {
  return `<ul class="${cls}" role="list">${items
    .map(
      (h) =>
        `<li class="ts-toc__item ts-toc__item--l${h.level}"><a class="ts-toc__link" href="#${escapeHtml(h.id)}" data-toc-id="${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join('')}</ul>`;
}

function tocHtml(page: ShellPage, site: SiteOptions, L: Labels): string {
  const items = tocItems(page.headings);
  const head = items.length
    ? `<p class="ts-toc__title" id="ts-toc-title"><svg class="ts-toc__progress" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8"/><circle class="ts-toc__progress-bar" cx="10" cy="10" r="8" pathLength="100"/></svg><span>${L.onThisPage}</span></p><nav aria-labelledby="ts-toc-title">${tocList(
        items,
        'ts-toc__list',
      )}</nav>`
    : '';
  const pdf = site.pdfDownload
    ? `<a class="ts-toc__action" href="${escapeHtml(site.pdfDownload)}" download>${icon('download', 'ts-icon', 15)}<span>${L.downloadPdf}</span></a>`
    : '';
  return `<div class="ts-toc__inner">${head}<div class="ts-toc__actions"><button class="ts-toc__action" type="button" data-ts-copy-link>${icon(
    'link',
    'ts-icon',
    15,
  )}<span>${L.copyLink}</span></button>${pdf}<button class="ts-toc__action" type="button" data-ts-top>${icon('up', 'ts-icon', 15)}<span>${L.backToTop}</span></button></div></div>`;
}

function inlineToc(headings: Heading[], L: Labels): string {
  const items = tocItems(headings);
  if (items.length < 2) return '';
  return `<details class="ts-toc-inline"><summary>${icon('list', 'ts-icon', 15)}<span>${L.onThisPage}</span>${icon('down', 'ts-icon ts-toc-inline__chevron', 15)}</summary>${tocList(items, 'ts-toc-inline__list')}</details>`;
}

const THEME_INIT = `(function(){try{var t=localStorage.getItem('ts-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);if(localStorage.getItem('ts-focus')==='1')document.documentElement.setAttribute('data-focus','');}catch(e){}})();`;

// Seiten im Voraus laden (nur über http(s), harmlos bei file://).
const SPECULATION = `<script type="speculationrules">{"prefetch":[{"source":"document","where":{"href_matches":"*.html"},"eagerness":"moderate"}]}</script>`;

function favicon(letter: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="22" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Kapitel für die Übersicht der Startseite, nach Navigationsabschnitten. */
function chapters(ctx: ShellContext): { title?: string; items: (ShellPage & { no: number })[] }[] {
  let no = 0;
  return ctx.nav
    .map((sec) => ({
      title: sec.title,
      items: sec.pages
        .filter((s) => s !== ctx.home)
        .map((s) => ctx.pages.get(s))
        .filter((p): p is ShellPage => !!p)
        .map((p) => ({ ...p, no: ++no })),
    }))
    .filter((g) => g.items.length);
}

function chaptersHtml(ctx: ShellContext, L: Labels): string {
  const groups = chapters(ctx);
  if (!groups.length) return '';
  const cards = (items: (ShellPage & { no: number })[]) =>
    items
      .map((p) => {
        const subs = p.headings.filter((h) => h.level === 2).slice(0, 4);
        const more = p.headings.filter((h) => h.level === 2).length - subs.length;
        const subList = subs.length
          ? `<ul class="ts-chapter__subs" role="list">${subs
              .map((h) => `<li><a href="${escapeHtml(p.slug)}.html#${escapeHtml(encodeURIComponent(h.id))}">${escapeHtml(h.text)}</a></li>`)
              .join('')}${more > 0 ? `<li class="ts-chapter__more">${L.more(more)}</li>` : ''}</ul>`
          : '';
        return `<li class="ts-chapter">
  <a class="ts-chapter__link" href="${escapeHtml(p.slug)}.html"><span class="ts-chapter__no">${String(p.no).padStart(2, '0')}</span><span class="ts-chapter__title">${escapeHtml(p.title)}</span>${icon('arrow', 'ts-icon ts-chapter__arrow', 16)}</a>
  ${p.excerpt ? `<p class="ts-chapter__text">${escapeHtml(p.excerpt)}</p>` : ''}
  ${subList}
  <p class="ts-chapter__meta">${icon('clock', 'ts-icon', 13)}<span>${readingTime(p.minutes, L)}</span></p>
</li>`;
      })
      .join('');
  return `<section class="ts-chapters" aria-labelledby="ts-chapters-title">
<h2 class="ts-chapters__title" id="ts-chapters-title">${L.contents}</h2>
${groups
  .map(
    (g) =>
      `<div class="ts-chapters__group">${g.title ? `<h3 class="ts-chapters__group-title">${escapeHtml(g.title)}</h3>` : ''}<ol class="ts-chapters__list" role="list">${cards(g.items)}</ol></div>`,
  )
  .join('')}
</section>`;
}

function heroHtml(page: ShellPage, ctx: ShellContext, L: Labels, lang: Lang): string {
  const { site } = ctx;
  const all = chapters(ctx).flatMap((g) => g.items);
  const first = all[0];
  const total = all.reduce((n, p) => n + (p.minutes ?? 0), 0) + (page.minutes ?? 0);
  const facts: string[] = [];
  if (all.length) facts.push(`<span>${icon('book', 'ts-icon', 15)}${L.chapters(all.length)}</span>`);
  if (total) facts.push(`<span>${icon('clock', 'ts-icon', 15)}${readingTime(total, L)}</span>`);
  if (site.authors?.length) facts.push(`<span>${escapeHtml(site.authors.join(', '))}</span>`);
  const eyebrow = [site.version ? L.version(escapeHtml(site.version)) : '', site.date ? L.updated(escapeHtml(formatDate(site.date, lang))) : '']
    .filter(Boolean)
    .join(' · ');
  const lead = site.subtitle || site.description;
  const pdf = site.pdfDownload
    ? `<a class="ts-hero__btn" href="${escapeHtml(site.pdfDownload)}" download>${icon('download', 'ts-icon', 17)}<span>${L.downloadPdf}</span></a>`
    : '';
  return `<header class="ts-hero">
  ${eyebrow ? `<p class="ts-hero__eyebrow">${eyebrow}</p>` : ''}
  <h1 class="ts-hero__title">${escapeHtml(site.title)}</h1>
  ${lead ? `<p class="ts-hero__lead">${escapeHtml(lead)}</p>` : ''}
  ${site.subtitle && site.description ? `<p class="ts-hero__desc">${escapeHtml(site.description)}</p>` : ''}
  <div class="ts-hero__actions">
    ${first ? `<a class="ts-hero__btn ts-hero__btn--primary" href="${escapeHtml(first.slug)}.html"><span>${L.startReading}</span>${icon('arrow', 'ts-icon', 17)}</a>` : ''}
    ${pdf}
    <button class="ts-hero__search" type="button" data-ts-search aria-haspopup="dialog">${icon('search', 'ts-icon', 17)}<span>${L.searchDocs}</span><kbd class="ts-kbd" data-ts-shortcut>${L.shortcutKey}</kbd></button>
  </div>
  ${facts.length ? `<p class="ts-hero__facts">${facts.join('')}</p>` : ''}
</header>`;
}

export function renderShell(page: ShellPage, ctx: ShellContext): string {
  const { site } = ctx;
  const lang = ctx.lang ?? labelLang(site.lang);
  const L = LABELS[lang];
  const s = escapeHtml(site.staticBase);
  const isHome = !!ctx.home && page.slug === ctx.home;
  const seq = ctx.home && !ctx.order.includes(ctx.home) ? [ctx.home, ...ctx.order] : ctx.order;
  const pos = seq.indexOf(page.slug);
  const prev = pos > 0 ? ctx.pages.get(seq[pos - 1]) : undefined;
  const next = pos >= 0 && pos < seq.length - 1 ? ctx.pages.get(seq[pos + 1]) : undefined;
  const section = ctx.sectionOf.get(page.slug);
  const home = ctx.home ?? ctx.order[0] ?? 'index';
  const docTitle = isHome || (page.slug === home && page.title === site.title) ? site.title : `${page.title} · ${site.title}`;
  const accentOk = !!site.accent && /^#[0-9a-fA-F]{3,8}$/.test(site.accent);
  const accent = accentOk ? `<style>:root{--ts-accent:${site.accent}}</style>` : '';
  const initial = escapeHtml(site.title.trim().charAt(0).toUpperCase() || 'T');
  const logo = site.logo
    ? `<img class="ts-brand__logo" src="${escapeHtml(site.logo)}" alt="" width="28" height="28">`
    : `<span class="ts-brand__mark" aria-hidden="true">${initial}</span>`;
  const icoHref = favicon(initial, accentOk ? site.accent! : '#1c1917');
  const description = page.description ?? page.excerpt ?? site.description ?? site.subtitle ?? '';

  const pagerLink = (p: ShellPage, dir: 'prev' | 'next') => {
    const label = dir === 'prev' ? L.prev : L.next;
    const sec = ctx.sectionOf.get(p.slug);
    const title = ctx.home === p.slug ? L.overview : p.title;
    return `<a class="ts-pager__link ts-pager__link--${dir}" href="${escapeHtml(p.slug)}.html" rel="${dir}" data-ts-${dir}>${
      dir === 'prev' ? icon('left', 'ts-icon ts-pager__icon') : ''
    }<span class="ts-pager__text"><small>${label}${sec ? ` · ${escapeHtml(sec)}` : ''}</small><strong>${escapeHtml(title)}</strong></span>${
      dir === 'next' ? icon('right', 'ts-icon ts-pager__icon') : ''
    }</a>`;
  };
  const pager =
    prev || next
      ? `<nav class="ts-pager" aria-label="${L.pagerLabel}">${prev ? pagerLink(prev, 'prev') : '<span class="ts-pager__spacer"></span>'}${
          next ? pagerLink(next, 'next') : ''
        }</nav>`
      : '';
  const pdf = site.pdfDownload
    ? `<a class="ts-btn ts-btn--ghost ts-hide-sm" href="${escapeHtml(site.pdfDownload)}" download title="${L.downloadAsPdf}">${icon('download', 'ts-icon', 17)}<span>PDF</span></a>`
    : '';
  const repo = site.repoUrl
    ? `<a class="ts-btn ts-btn--icon" href="${escapeHtml(site.repoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${L.openRepo}" title="${L.repo}">${icon('repo')}</a>`
    : '';
  const eyebrow = isHome
    ? ''
    : `<div class="ts-eyebrow">${section ? `<span class="ts-eyebrow__section">${escapeHtml(section)}</span>` : ''}<span class="ts-eyebrow__time">${icon(
        'clock',
        'ts-icon',
        14,
      )}${readingTime(page.minutes, L)}</span></div>`;
  const extraCss = site.extraCss.map((h) => `<link rel="stylesheet" href="${escapeHtml(h)}">`).join('');
  const extraJs = site.extraJs.map((h) => `<script src="${escapeHtml(h)}" defer></script>`).join('');
  const year = new Date().getFullYear();
  const footer = site.footer
    ? escapeHtml(site.footer)
    : `© ${year} ${escapeHtml(site.title)}${site.version ? ` · ${L.version(escapeHtml(site.version))}` : ''}`;
  const themeMenu = (['light', 'dark', 'system'] as const)
    .map((v) => {
      const label = v === 'light' ? L.themeLight : v === 'dark' ? L.themeDark : L.themeSystem;
      const ic = v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'monitor';
      return `<button type="button" class="ts-theme__option" role="menuitemradio" aria-checked="false" data-theme-value="${v}">${icon(ic, 'ts-icon', 16)}<span>${label}</span>${icon('check', 'ts-icon ts-theme__check', 15)}</button>`;
    })
    .join('');
  const content = isHome
    ? `${page.synthetic ? '' : page.html}${chaptersHtml(ctx, L)}`
    : `${eyebrow}${inlineToc(page.headings, L)}
${page.html}`;

  return `<!doctype html>
<html lang="${escapeHtml(site.lang || lang)}"${site.preview ? ' data-ts-preview="1"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ''}<meta name="generator" content="${escapeHtml(site.generator ?? 'Sqritto')}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(docTitle)}">
${description ? `<meta property="og:description" content="${escapeHtml(description)}">\n` : ''}<link rel="icon" href="${icoHref}">
<link rel="stylesheet" href="${s}site.css">
${extraCss}${accent}
<script>${THEME_INIT}</script>
${site.preview ? '' : SPECULATION}
</head>
<body data-page="${escapeHtml(page.slug)}" data-site="${escapeHtml(site.title)}"${isHome ? ' data-home' : ''}>
<a class="ts-skip" href="#ts-content">${L.skipToContent}</a>
<header class="ts-header">
  <div class="ts-header__inner">
    <button class="ts-btn ts-btn--icon ts-menu-toggle" type="button" aria-label="${L.openNav}" aria-controls="ts-sidebar" aria-expanded="false">${icon('menu')}</button>
    <a class="ts-brand" href="${escapeHtml(home)}.html">${logo}<span class="ts-brand__title">${escapeHtml(site.title)}</span>${
      site.version ? `<span class="ts-brand__version">${escapeHtml(site.version)}</span>` : ''
    }</a>
    <div class="ts-header__search">
      <button class="ts-search-trigger" type="button" data-ts-search aria-haspopup="dialog" aria-label="${L.openSearch}">${icon('search', 'ts-icon', 16)}<span class="ts-search-trigger__label">${L.searchShort}</span><kbd class="ts-kbd" data-ts-shortcut>${L.shortcutKey}</kbd></button>
    </div>
    <div class="ts-header__actions">${pdf}${repo}
      <button class="ts-btn ts-btn--icon ts-focus-toggle ts-hide-sm" type="button" data-ts-focus aria-pressed="false" aria-label="${L.focusMode}" title="${L.focusMode} (F)">${icon('focus')}</button>
      <div class="ts-theme">
        <button class="ts-btn ts-btn--icon ts-theme__btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${L.chooseTheme}" title="${L.theme}">${icon('sun', 'ts-icon ts-icon--sun')}${icon('moon', 'ts-icon ts-icon--moon')}</button>
        <div class="ts-theme__menu" role="menu" aria-label="${L.theme}" hidden>${themeMenu}</div>
      </div>
    </div>
  </div>
</header>
<div class="ts-layout${isHome ? ' ts-layout--home' : ''}">
  <aside class="ts-sidebar" id="ts-sidebar" aria-label="${L.siteNav}">
    <div class="ts-sidebar__head">
      <span class="ts-sidebar__title">${escapeHtml(site.title)}</span>
      <button class="ts-btn ts-btn--icon ts-sidebar__close" type="button" aria-label="${L.closeNav}">${icon('close')}</button>
    </div>
    <nav class="ts-nav" aria-label="${L.docsNav}">${navHtml(ctx.nav, ctx.pages, page.slug, L, ctx.home)}</nav>
  </aside>
  <div class="ts-backdrop" hidden></div>
  <main class="ts-main" id="ts-content" tabindex="-1">
    ${isHome ? heroHtml(page, ctx, L, lang) : ''}
    <article class="ts-article ts-prose${isHome ? ' ts-article--home' : ''}" data-slug="${escapeHtml(page.slug)}">
${content}
    </article>
    ${pager}
    <footer class="ts-footer"><span>${footer}</span><span class="ts-footer__gen">${L.builtWith}</span></footer>
  </main>
  <aside class="ts-toc" aria-label="${L.tocLabel}">${isHome ? '' : tocHtml(page, site, L)}</aside>
</div>
<button class="ts-totop" type="button" data-ts-top aria-label="${L.backToTop}" title="${L.backToTop}" hidden>${icon('up', 'ts-icon', 18)}</button>
<script src="${s}site.js" defer></script>
${extraJs}
</body>
</html>
`;
}
