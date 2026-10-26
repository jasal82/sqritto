// Übersetzt den transformierten Markdoc-Baum in Typst-Markup.
//
// Robustheit hat Vorrang vor Kürze: Inline-Formatierung wird als
// Funktionsaufruf (`#strong[…];`) ausgegeben, Text wird vollständig
// maskiert und alle Blöcke werden über Funktionen der Basisbibliothek
// `@sqritto/markdoc` gesetzt, damit Vorlagen sie überschreiben können.

import type { RenderableTreeNode, Tag } from '@markdoc/markdoc';
import type { ComponentDef } from './types';
import { collapseWs, isExternalUrl, isTag, resolveDocPath, textOf } from './util';
import type { LinkResolver } from './links';
import { ui } from './i18n';

export interface TypstCtx {
  pagePath: string;
  slug: string;
  links: LinkResolver;
  components: Map<string, ComponentDef>;
  warn(message: string, line?: number): void;
  assets: Set<string>;
}

const TEXT_SPECIAL = /[\\#*_`$@<>[\]~/]/g;

export function escText(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(TEXT_SPECIAL, (c) => '\\' + c);
}

/** Maskiert Zeichen, die am Zeilenanfang Listen oder Überschriften erzeugen. */
function escLineStart(s: string): string {
  const m = /^(\s*)([-+=]|\d+\.)/.exec(s);
  if (!m) return s;
  const [, ws, tok] = m;
  if (tok.endsWith('.') && tok.length > 1) {
    return ws + tok.slice(0, -1) + '\\.' + s.slice(ws.length + tok.length);
  }
  return ws + '\\' + s.slice(ws.length);
}

export function tsStr(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t') +
    '"'
  );
}

function tsKey(k: string): string {
  return /^[a-zA-Z_][\w-]*$/.test(k) ? k : tsStr(k);
}

export function tsValue(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return tsStr(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'none';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '(' + v.map(tsValue).join(', ') + (v.length === 1 ? ',' : '') + ')';
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return '(:)';
    return '(' + entries.map(([k, x]) => `${tsKey(k)}: ${tsValue(x)}`).join(', ') + ')';
  }
  return tsStr(String(v));
}

const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'table', 'blockquote', 'hr', 'ts:fence', 'figure', 'article', 'section', 'div',
]);

function isBlock(node: RenderableTreeNode, ctx: TypstCtx): boolean {
  if (!isTag(node)) return false;
  if (node.name.startsWith('ts:') && node.name !== 'ts:fence') {
    const def = ctx.components.get(node.name.slice(3));
    // Die Platzierung im Text entscheidet; die Definition ist nur Vorgabe.
    return !((node as any).__inline ?? def?.inline ?? false);
  }
  return BLOCK_TAGS.has(node.name);
}

function lineAttr(tag: Tag): number | undefined {
  const l = tag.attributes['data-line'];
  return typeof l === 'number' ? l : undefined;
}

/** Rendert eine Folge gemischter Block- und Inline-Knoten. */
export function renderFlow(nodes: RenderableTreeNode[], ctx: TypstCtx, sep = '\n\n'): string {
  const chunks: string[] = [];
  let run: RenderableTreeNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = run.map((n) => renderInline(n, ctx)).join('').trim();
    if (text) chunks.push(escLineStart(text));
    run = [];
  };
  for (const n of nodes) {
    if (isBlock(n, ctx)) {
      flush();
      const out = renderBlock(n as Tag, ctx);
      if (out.trim()) chunks.push(out);
    } else {
      run.push(n);
    }
  }
  flush();
  return chunks.join(sep);
}

/** Rendert Top-Level-Blöcke einzeln (für die Zeilenzuordnung). */
export function renderTopLevel(
  nodes: RenderableTreeNode[],
  ctx: TypstCtx,
  onLine?: (line: number | undefined) => void,
): { code: string; line?: number }[] {
  const out: { code: string; line?: number }[] = [];
  let run: RenderableTreeNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = run.map((n) => renderInline(n, ctx)).join('').trim();
    if (text) out.push({ code: escLineStart(text) });
    run = [];
  };
  for (const n of nodes) {
    if (isBlock(n, ctx)) {
      flush();
      const line = lineAttr(n as Tag);
      onLine?.(line);
      const code = renderBlock(n as Tag, ctx);
      if (code.trim()) out.push({ code, line });
    } else run.push(n);
  }
  flush();
  return out;
}

function content(inner: string): string {
  return `[${inner}]`;
}

function blockContent(inner: string): string {
  if (!inner.trim()) return '[]';
  return `[\n${indent(inner)}\n]`;
}

function indent(s: string): string {
  // Einrückung nur zur Lesbarkeit; in Raw-Strings steht kein echter Zeilenumbruch.
  return s
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
}

function renderBlock(tag: Tag, ctx: TypstCtx): string {
  const name = tag.name;
  const m = /^h([1-6])$/.exec(name);
  if (m) return renderHeading(tag, Number(m[1]), ctx);
  switch (name) {
    case 'p':
      return renderParagraph(tag, ctx);
    case 'ul':
    case 'ol':
      return renderList(tag, ctx);
    case 'table':
      return renderTable(tag, ctx);
    case 'blockquote':
      return `#quote(block: true)${blockContent(renderFlow(tag.children, ctx))}`;
    case 'hr':
      return '#ts-hr()';
    case 'ts:fence':
      return renderFence(tag);
    case 'figure':
    case 'article':
    case 'section':
    case 'div':
      return renderFlow(tag.children, ctx);
  }
  if (name.startsWith('ts:')) return renderComponent(tag, ctx, false);
  return renderFlow(tag.children, ctx);
}

function renderHeading(tag: Tag, level: number, ctx: TypstCtx): string {
  const text = tag.children.map((c) => renderInline(c, ctx)).join('').trim();
  const id = String(tag.attributes.id ?? '');
  const label = id ? ` <${ctx.links.label(ctx.slug, id)}>` : '';
  const cls = String(tag.attributes.class ?? '');
  if (/\b(unnumbered|no-number)\b/.test(cls)) {
    return `#heading(level: ${level}, numbering: none)[${text}]${label}`;
  }
  if (/\b(no-toc|unlisted)\b/.test(cls)) {
    return `#heading(level: ${level}, outlined: false)[${text}]${label}`;
  }
  return `${'='.repeat(level)} ${text}${label}`;
}

function renderParagraph(tag: Tag, ctx: TypstCtx): string {
  // Ein Absatz, der nur aus einem Bild besteht, wird zur Abbildung.
  const meaningful = tag.children.filter((c) => !(typeof c === 'string' && !c.trim()));
  if (meaningful.length === 1 && isTag(meaningful[0]) && meaningful[0].name === 'img') {
    return renderFigure(meaningful[0], ctx);
  }
  const text = tag.children.map((c) => renderInline(c, ctx)).join('').trim();
  return escLineStart(text);
}

function imagePath(src: string, ctx: TypstCtx): string | null {
  if (isExternalUrl(src) || src.startsWith('data:')) return null;
  const clean = decodeURI(src.split(/[?#]/)[0]);
  const path = resolveDocPath(ctx.pagePath, clean);
  ctx.assets.add(path);
  return '/' + path;
}

function renderFigure(img: Tag, ctx: TypstCtx): string {
  const src = String(img.attributes.src ?? '');
  const alt = String(img.attributes.alt ?? '');
  const title = img.attributes.title ? String(img.attributes.title) : '';
  const width = img.attributes.width ? String(img.attributes.width) : '';
  const path = imagePath(src, ctx);
  if (!path) {
    ctx.warn(
      ui(
        `Externes Bild „${src}“ kann im PDF nicht eingebettet werden. Lege es im Ordner assets/ ab.`,
        `External image “${src}” cannot be embedded in the PDF. Put it in the assets/ folder.`,
      ),
    );
    return `#ts-missing-image(${tsStr(src)}, alt: ${tsStr(alt)})`;
  }
  const args = [`path(${tsStr(path)})`, `alt: ${tsStr(alt)}`];
  if (title) args.push(`caption: [${escText(title)}]`);
  if (width) args.push(`width: ${typstLength(width)}`);
  return `#ts-figure(${args.join(', ')})`;
}

function typstLength(w: string): string {
  const v = w.trim();
  if (/^\d+(\.\d+)?%$/.test(v)) return v;
  if (/^\d+(\.\d+)?(pt|mm|cm|in|em)$/.test(v)) return v;
  if (/^\d+(\.\d+)?px$/.test(v)) return `${(parseFloat(v) * 0.75).toFixed(1)}pt`;
  if (/^\d+(\.\d+)?$/.test(v)) return `${(parseFloat(v) * 0.75).toFixed(1)}pt`;
  return 'auto';
}

function isLoose(li: Tag): boolean {
  return li.children.some((c) => isTag(c) && c.name === 'p');
}

const TASK_RE = /^\[([ xX])\]\s+/;

function renderList(tag: Tag, ctx: TypstCtx): string {
  const items = tag.children.filter((c): c is Tag => isTag(c) && c.name === 'li');
  const loose = items.some(isLoose);
  const args: string[] = [];
  if (tag.name === 'ol' && tag.attributes.start !== undefined && tag.attributes.start !== 1) {
    args.push(`start: ${Number(tag.attributes.start)}`);
  }
  args.push(`tight: ${loose ? 'false' : 'true'}`);
  const isTask = (li: Tag) => typeof li.children[0] === 'string' && TASK_RE.test(li.children[0] as string);
  if (tag.name === 'ul' && items.length && items.every(isTask)) args.push('marker: []');
  const rendered = items.map((li) => {
    let children = li.children;
    let prefix = '';
    const first = children[0];
    if (typeof first === 'string' && TASK_RE.test(first)) {
      const done = first[1].toLowerCase() === 'x';
      prefix = `#ts-checkbox(${done}) `;
      children = [first.replace(TASK_RE, ''), ...children.slice(1)];
    }
    const body = renderFlow(children, ctx, loose ? '\n\n' : '\n');
    return blockContent(prefix + body);
  });
  const fn = tag.name === 'ol' ? 'enum' : 'list';
  return `#${fn}(${args.join(', ')},\n${indent(rendered.join(',\n'))},\n)`;
}

function cellsOf(row: Tag): Tag[] {
  return row.children.filter((c): c is Tag => isTag(c) && (c.name === 'td' || c.name === 'th'));
}

function renderTable(tag: Tag, ctx: TypstCtx): string {
  const headRows: Tag[] = [];
  const bodyRows: Tag[] = [];
  for (const part of tag.children) {
    if (!isTag(part)) continue;
    if (part.name === 'thead') headRows.push(...part.children.filter((r): r is Tag => isTag(r) && r.name === 'tr'));
    else if (part.name === 'tbody') bodyRows.push(...part.children.filter((r): r is Tag => isTag(r) && r.name === 'tr'));
    else if (part.name === 'tr') bodyRows.push(part);
  }
  const rows = [...headRows, ...bodyRows];
  const width = (r: Tag) => cellsOf(r).reduce((n, c) => n + (Number(c.attributes.colSpan ?? c.attributes.colspan) || 1), 0);
  const columns = Math.max(1, ...rows.map(width));
  const aligns: string[] = [];
  const alignSource = headRows[0] ?? bodyRows[0];
  for (let i = 0; i < columns; i++) {
    const cell = alignSource ? cellsOf(alignSource)[i] : undefined;
    const a = String(cell?.attributes.align ?? '');
    aligns.push(a === 'left' || a === 'center' || a === 'right' ? a : 'auto');
  }
  const cell = (c: Tag) => {
    const inner = renderFlow(c.children, ctx, '\n\n');
    const colspan = Number(c.attributes.colSpan ?? c.attributes.colspan) || 1;
    const rowspan = Number(c.attributes.rowSpan ?? c.attributes.rowspan) || 1;
    const body = inner.includes('\n') ? blockContent(inner) : content(inner);
    if (colspan > 1 || rowspan > 1) {
      const args = [];
      if (colspan > 1) args.push(`colspan: ${colspan}`);
      if (rowspan > 1) args.push(`rowspan: ${rowspan}`);
      return `table.cell(${args.join(', ')})${body}`;
    }
    return body;
  };
  const header = headRows.flatMap(cellsOf).map(cell);
  const body = bodyRows.map((r) => cellsOf(r).map(cell).join(', '));
  const parts = [
    `columns: ${columns}`,
    `align: (${aligns.join(', ')}${aligns.length === 1 ? ',' : ''})`,
    `header: (${header.join(', ')}${header.length === 1 ? ',' : ''})`,
  ];
  return `#ts-table(\n${indent(parts.join(',\n'))},\n${indent(body.join(',\n'))}${body.length ? ',' : ''}\n)`;
}

function renderFence(tag: Tag): string {
  const a = tag.attributes;
  const code = String(a.content ?? '');
  const lang = String(a.language ?? '');
  if (lang === 'math') return `#ts-math(${tsStr(code)})`;
  if ((lang === 'typst' || lang === 'typ') && a.render) {
    // Typst-Code direkt einbetten (eigener Gültigkeitsbereich).
    return `#[
${code}
]`;
  }
  const args = [`lang: ${lang ? tsStr(lang) : 'none'}`];
  if (a.title) args.push(`title: ${tsStr(String(a.title))}`);
  if (a.lines) args.push('lines: true');
  return `#ts-code(${args.join(', ')}, ${tsStr(code)})`;
}

function componentArgs(tag: Tag, def: ComponentDef, ctx: TypstCtx): string[] {
  const args: string[] = [];
  for (const [key, a] of Object.entries(def.attributes ?? {})) {
    const v = tag.attributes[key];
    if (v === undefined) continue;
    if (a.link && typeof v === 'string' && v) {
      const target = ctx.links.resolve(ctx.pagePath, v);
      if (target.kind === 'page') {
        const label = target.anchor ? ctx.links.label(target.slug, target.anchor) : ctx.links.pageLabel(target.slug);
        if (ctx.links.hasLabel(label)) args.push(`${tsKey(key)}: <${label}>`);
        else ctx.warn(ui(`Verweisziel „${v}“ wurde nicht gefunden.`, `Link target “${v}” was not found.`));
      } else {
        args.push(`${tsKey(key)}: ${tsStr(v)}`);
      }
      continue;
    }
    if (a.asset && typeof v === 'string' && v) {
      const p = imagePath(v, ctx);
      if (p) {
        args.push(`${tsKey(key)}: path(${tsStr(p)})`);
        continue;
      }
      ctx.warn(ui(`Externe Datei „${v}“ kann im PDF nicht eingebettet werden.`, `External file “${v}” cannot be embedded in the PDF.`));
      continue;
    }
    args.push(`${tsKey(key)}: ${tsValue(v)}`);
  }
  return args;
}

function renderComponent(tag: Tag, ctx: TypstCtx, inline: boolean): string {
  const name = tag.name.slice(3);
  const def = ctx.components.get(name);
  if (!def) return inline ? tag.children.map((c) => renderInline(c, ctx)).join('') : renderFlow(tag.children, ctx);
  if (def.pdf === false) return '';
  const fn = def.typst || `ts-${name}`;
  const args = componentArgs(tag, def, ctx);
  if (def.collect) {
    // Kinder als Positionsargumente übergeben (Code-Modus, ohne `#`).
    const items = tag.children
      .filter((c): c is Tag => isTag(c) && c.name === `ts:${def.collect}`)
      .map((c) => renderComponent(c, ctx, false).replace(/^#/, ''));
    const parts = [...args, ...items.map((i) => '\n' + indent(i))];
    return `#${fn}(${parts.join(', ')}\n)`;
  }
  let call = `#${fn}(${args.join(', ')})`;
  if (!def.selfClosing) {
    if (inline || def.inline) call += content(tag.children.map((c) => renderInline(c, ctx)).join(''));
    else call += blockContent(renderFlow(tag.children, ctx));
  }
  return inline ? call + ';' : call;
}

function renderInline(node: RenderableTreeNode, ctx: TypstCtx): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return escText(String(node));
  if (Array.isArray(node)) return node.map((n) => renderInline(n, ctx)).join('');
  if (!isTag(node)) return '';
  const kids = () => node.children.map((c) => renderInline(c, ctx)).join('');
  switch (node.name) {
    case 'strong':
      return `#strong[${kids()}];`;
    case 'em':
      return `#emph[${kids()}];`;
    case 's':
      return `#strike[${kids()}];`;
    case 'code':
      return `#raw(${tsStr(textOf(node.children))});`;
    case 'br':
      return '#linebreak();';
    case 'a':
      return renderLink(node, kids(), ctx);
    case 'img': {
      const path = imagePath(String(node.attributes.src ?? ''), ctx);
      if (!path) return escText(String(node.attributes.alt ?? ''));
      return `#ts-inline-image(path(${tsStr(path)}), alt: ${tsStr(String(node.attributes.alt ?? ''))});`;
    }
    case 'span':
      return kids();
  }
  if (node.name.startsWith('ts:')) {
    if (isBlock(node, ctx)) return renderBlock(node, ctx);
    return renderComponent(node, ctx, true);
  }
  if (BLOCK_TAGS.has(node.name)) return renderBlock(node, ctx);
  return kids();
}

function renderLink(tag: Tag, inner: string, ctx: TypstCtx): string {
  const href = String(tag.attributes.href ?? '');
  const text = inner || escText(href);
  const target = ctx.links.resolve(ctx.pagePath, href);
  if (target.kind === 'external') return `#link(${tsStr(href)})[${text}];`;
  if (target.kind === 'page') {
    const label = target.anchor ? ctx.links.label(target.slug, target.anchor) : ctx.links.pageLabel(target.slug);
    if (ctx.links.hasLabel(label)) return `#link(<${label}>)[${text}];`;
    ctx.warn(ui(`Verweisziel „${href}“ wurde nicht gefunden.`, `Link target “${href}” was not found.`));
    return `#ts-broken-link[${text}];`;
  }
  // Datei-Link (z. B. PDF-Anhang im assets-Ordner): als Text mit Pfad.
  return `#link(${tsStr(collapseWs(href))})[${text}];`;
}
