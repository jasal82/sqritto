// Rendert den transformierten Markdoc-Baum als semantisches HTML5.

import type { RenderableTreeNode, Tag } from '@markdoc/markdoc';
import type { ComponentDef } from './types';
import type { LinkResolver } from './links';
import { renderTemplate } from './template';
import { escapeHtml, isExternalUrl, isTag, resolveDocPath, textOf } from './util';
import type { Lang } from './i18n';

export interface HostApi {
  highlight?(code: string, lang: string): string | null | undefined;
  typstSvg?(code: string, mode: string): string | null | undefined;
  /** Sprache der Oberfläche (`de` oder `en`) für Meldungen. */
  uiLang?(): string;
}

export interface HtmlCtx {
  pagePath: string;
  slug: string;
  links: LinkResolver;
  components: Map<string, ComponentDef>;
  host: HostApi;
  assets: Set<string>;
  /** Sprache der Beschriftungen (Dokumentsprache). */
  lang: Lang;
  warn(message: string, line?: number): void;
  uid(): string;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

let EMIT_LINES = false;
/** Steuert, ob `data-line`-Attribute (Scroll-Synchronisation) ausgegeben werden. */
export function setEmitLines(v: boolean) {
  EMIT_LINES = v;
}

const ATTR_RENAME: Record<string, string> = { colSpan: 'colspan', rowSpan: 'rowspan', className: 'class' };

function attrs(a: Record<string, unknown>, skip: string[] = []): string {
  let out = '';
  for (const [k0, v] of Object.entries(a)) {
    if (skip.includes(k0) || v === undefined || v === null || v === false) continue;
    if (k0 === 'data-line' && !EMIT_LINES) continue;
    const k = ATTR_RENAME[k0] ?? k0;
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(k)) continue;
    if (k === 'align') {
      out += ` style="text-align:${escapeHtml(String(v))}"`;
      continue;
    }
    if (v === true) out += ` ${k}`;
    else out += ` ${k}="${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}"`;
  }
  return out;
}

export function renderHtml(node: RenderableTreeNode | RenderableTreeNode[], ctx: HtmlCtx): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
  if (Array.isArray(node)) return node.map((n) => renderHtml(n, ctx)).join('');
  if (!isTag(node)) return '';
  const kids = () => node.children.map((c) => renderHtml(c, ctx)).join('');
  const name = node.name;

  const h = /^h([1-6])$/.exec(name);
  if (h) {
    const id = String(node.attributes.id ?? '');
    const anchor = id
      ? `<a class="ts-anchor" href="#${escapeHtml(id)}" aria-label="${ctx.lang === 'de' ? 'Direktlink zu diesem Abschnitt' : 'Link to this section'}" tabindex="-1"></a>`
      : '';
    return `<${name}${attrs(node.attributes)}>${kids()}${anchor}</${name}>`;
  }

  switch (name) {
    case 'article':
      return kids();
    case 'ts:fence':
      return renderFence(node, ctx);
    case 'a':
      return renderLink(node, kids(), ctx);
    case 'img':
      return renderImg(node, ctx);
    case 'p': {
      const meaningful = node.children.filter((c) => !(typeof c === 'string' && !c.trim()));
      if (meaningful.length === 1 && isTag(meaningful[0]) && meaningful[0].name === 'img') {
        return renderFigure(meaningful[0], ctx, node.attributes);
      }
      return `<p${attrs(node.attributes)}>${kids()}</p>`;
    }
    case 'table':
      return `<div class="ts-table-wrap"${attrs({ 'data-line': node.attributes['data-line'] })}><table${attrs(node.attributes, ['data-line'])}>${kids()}</table></div>`;
    case 'li':
      return renderListItem(node, ctx);
    case 'code':
      return `<code>${escapeHtml(textOf(node.children))}</code>`;
  }

  if (name.startsWith('ts:')) return renderComponent(node, ctx);
  if (VOID.has(name)) return `<${name}${attrs(node.attributes)}>`;
  if (!/^[a-zA-Z][\w-]*$/.test(name)) return kids();
  return `<${name}${attrs(node.attributes)}>${kids()}</${name}>`;
}

const TASK_RE = /^\[([ xX])\]\s+/;

function renderListItem(node: Tag, ctx: HtmlCtx): string {
  const first = node.children[0];
  if (typeof first === 'string' && TASK_RE.test(first)) {
    const done = first[1].toLowerCase() === 'x';
    const rest = [first.replace(TASK_RE, ''), ...node.children.slice(1)];
    return `<li class="ts-task${done ? ' is-done' : ''}"${attrs(node.attributes)}><span class="ts-task__box" aria-hidden="true"></span><span class="ts-task__label"><span class="ts-sr">${taskLabel(done, ctx.lang)}</span>${renderHtml(rest, ctx)}</span></li>`;
  }
  return `<li${attrs(node.attributes)}>${renderHtml(node.children, ctx)}</li>`;
}

function taskLabel(done: boolean, lang: Lang): string {
  if (lang === 'de') return done ? 'Erledigt: ' : 'Offen: ';
  return done ? 'Done: ' : 'To do: ';
}

function renderFence(node: Tag, ctx: HtmlCtx): string {
  const a = node.attributes;
  const code = String(a.content ?? '');
  const lang = String(a.language ?? '');
  const line = a['data-line'];
  if ((lang === 'typst' || lang === 'typ') && a.render) {
    const svg = ctx.host.typstSvg?.(code, 'markup');
    return `<div class="ts-typst-render"${attrs({ 'data-line': line })}>${svg ?? `<pre>${escapeHtml(code)}</pre>`}</div>`;
  }
  if (lang === 'math') {
    const svg = ctx.host.typstSvg?.(code, 'math-block');
    return `<div class="ts-math ts-math--block"${attrs({ 'data-line': line })}>${svg ?? `<pre class="ts-math__fallback">${escapeHtml(code)}</pre>`}</div>`;
  }
  let highlighted: string | null | undefined = null;
  try {
    highlighted = lang ? ctx.host.highlight?.(code, lang) : null;
  } catch {
    highlighted = null;
  }
  const body = highlighted ?? escapeHtml(code);
  const title = a.title ? String(a.title) : '';
  const header = `<div class="ts-code__header">${
    title ? `<span class="ts-code__title">${escapeHtml(title)}</span>` : `<span class="ts-code__lang">${escapeHtml(languageLabel(lang))}</span>`
  }</div>`;
  // Zeilennummern erzeugt die Site-Laufzeit selbst (Klasse ts-code--lines).
  const numbered = a.lines ? ' ts-code--lines' : '';
  return `<div class="ts-code${numbered}" data-lang="${escapeHtml(lang)}"${attrs({ 'data-line': line })}>${header}<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${body}</code></pre></div>`;
}

const LANG_NAMES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', rs: 'Rust', rust: 'Rust',
  py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash', shell: 'Shell', ps1: 'PowerShell', powershell: 'PowerShell',
  json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', html: 'HTML', css: 'CSS', sql: 'SQL', go: 'Go', java: 'Java',
  kotlin: 'Kotlin', c: 'C', cpp: 'C++', csharp: 'C#', cs: 'C#', xml: 'XML', md: 'Markdown', markdown: 'Markdown',
  typ: 'Typst', typst: 'Typst', dockerfile: 'Dockerfile', diff: 'Diff', http: 'HTTP', text: 'Text', txt: 'Text',
};

function languageLabel(lang: string): string {
  if (!lang) return 'Code';
  return LANG_NAMES[lang.toLowerCase()] ?? lang;
}

function assetUrl(src: string, ctx: HtmlCtx): string {
  if (isExternalUrl(src) || src.startsWith('data:')) return src;
  const [p, ...rest] = src.split(/(?=[?#])/);
  const path = resolveDocPath(ctx.pagePath, decodeURI(p));
  ctx.assets.add(path);
  return encodeURI(path) + rest.join('');
}

function renderImg(node: { attributes: Record<string, any> }, ctx: HtmlCtx): string {
  const src = assetUrl(String(node.attributes.src ?? ''), ctx);
  const width = node.attributes.width ? ` style="width:${escapeHtml(String(node.attributes.width))}"` : '';
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(String(node.attributes.alt ?? ''))}" loading="lazy"${
    node.attributes.title ? ` title="${escapeHtml(String(node.attributes.title))}"` : ''
  }${width}>`;
}

function renderFigure(img: Tag, ctx: HtmlCtx, pAttrs: Record<string, unknown>): string {
  const caption = img.attributes.title ? String(img.attributes.title) : '';
  const imgTag = renderImg({ attributes: { ...img.attributes, title: undefined } }, ctx);
  return `<figure class="ts-figure"${attrs({ 'data-line': pAttrs['data-line'] })}>${imgTag}${
    caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''
  }</figure>`;
}

function linkUrl(href: string, ctx: HtmlCtx): string {
  const target = ctx.links.resolve(ctx.pagePath, href);
  if (target.kind === 'external') return href;
  if (target.kind === 'page') {
    const sameP = target.slug === ctx.slug;
    return (sameP ? '' : `${target.slug}.html`) + (target.anchor ? `#${encodeURIComponent(target.anchor)}` : sameP ? '#' : '');
  }
  return assetUrl(target.path, ctx);
}

function renderLink(node: Tag, inner: string, ctx: HtmlCtx): string {
  const href = String(node.attributes.href ?? '');
  const title = node.attributes.title ? ` title="${escapeHtml(String(node.attributes.title))}"` : '';
  const target = ctx.links.resolve(ctx.pagePath, href);
  if (target.kind === 'external') {
    const ext = /^https?:/i.test(href);
    return `<a href="${escapeHtml(href)}"${title}${ext ? ' class="ts-external" target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
  }
  if (target.kind === 'page') {
    const sameP = target.slug === ctx.slug;
    const url = (sameP ? '' : `${target.slug}.html`) + (target.anchor ? `#${encodeURIComponent(target.anchor)}` : sameP ? '#' : '');
    const label = target.anchor ? ctx.links.label(target.slug, target.anchor) : ctx.links.pageLabel(target.slug);
    if (!ctx.links.hasLabel(label)) {
      return `<a href="${escapeHtml(url)}" class="ts-broken-link"${title}>${inner}</a>`;
    }
    return `<a href="${escapeHtml(url)}"${title}>${inner}</a>`;
  }
  const url = assetUrl(target.path, ctx) + (target.anchor ? `#${target.anchor}` : '');
  return `<a href="${escapeHtml(url)}"${title} download>${inner}</a>`;
}

function injectAttr(html: string, extra: string): string {
  if (!extra) return html;
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1${extra}`);
}

function renderComponent(node: Tag, ctx: HtmlCtx): string {
  const name = node.name.slice(3);
  const def = ctx.components.get(name);
  const children = node.children.map((c) => renderHtml(c, ctx)).join('');
  if (!def) return children;
  const a = { ...node.attributes };
  for (const [key, attr] of Object.entries(def.attributes ?? {})) {
    if (attr.asset && typeof a[key] === 'string' && a[key]) a[key] = assetUrl(a[key], ctx);
    if (attr.link && typeof a[key] === 'string' && a[key]) a[key] = linkUrl(a[key], ctx);
  }
  const context: Record<string, unknown> = {
    ...a,
    children,
    uid: ctx.uid(),
    text: textOf(node.children).trim(),
    hasChildren: node.children.length > 0,
    // Sprache der Beschriftungen (`de` oder `en`), z. B. {{#docLang=en}}…{{/docLang=en}}
    docLang: ctx.lang,
  };
  // Formeln über den Typst-Host als SVG darstellen (gleiches Ergebnis wie im PDF).
  if (name === 'math' && ctx.host.typstSvg && typeof a.formula === 'string') {
    const svg = ctx.host.typstSvg(a.formula, 'math-inline');
    if (svg) context.svg = svg;
  }
  let html = renderTemplate(def.html, context);
  const extras: string[] = [];
  if (EMIT_LINES && a['data-line'] !== undefined) extras.push(` data-line="${a['data-line']}"`);
  if (a.id && !/\sid=/.test(html.slice(0, html.indexOf('>')))) extras.push(` id="${escapeHtml(String(a.id))}"`);
  html = injectAttr(html.trim(), extras.join(''));
  return html;
}
