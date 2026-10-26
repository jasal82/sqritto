import Markdoc, { type RenderableTreeNode, type Tag } from '@markdoc/markdoc';

export const isTag = (n: unknown): n is Tag => Markdoc.Tag.isTag(n as any);

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

/** Erzeugt einen URL- und Typst-Label-tauglichen Bezeichner. */
export function slugify(text: string): string {
  const s = text
    .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'abschnitt';
}

/** Vergibt eindeutige IDs innerhalb einer Seite. */
export class IdRegistry {
  private used = new Map<string, number>();
  claim(base: string): string {
    const n = this.used.get(base);
    if (n === undefined) {
      this.used.set(base, 1);
      return base;
    }
    let i = n;
    let candidate = `${base}-${i}`;
    while (this.used.has(candidate)) candidate = `${base}-${++i}`;
    this.used.set(base, i + 1);
    this.used.set(candidate, 1);
    return candidate;
  }
  reserve(id: string) {
    if (!this.used.has(id)) this.used.set(id, 1);
  }
}

/** Reiner Text eines gerenderten Baums (für Überschriften und Suche). */
export function textOf(node: RenderableTreeNode | RenderableTreeNode[]): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isTag(node)) {
    if (node.name === 'ts:fence') return ` ${String(node.attributes.content ?? '')} `;
    const inner = node.children.map(textOf).join('');
    // Block-Elemente durch Leerzeichen trennen (Suche, Auszüge).
    return BLOCKISH.test(node.name) ? ` ${inner} ` : inner;
  }
  return '';
}

const BLOCKISH = /^(p|li|td|th|tr|h[1-6]|blockquote|ul|ol|table|thead|tbody|figure|section|div|article|ts:.*)$/;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** Normalisiert einen Pfad (POSIX), entfernt `.` und löst `..` auf. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function isExternalUrl(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
}

/** Pfad zu einer Datei im Dokument relativ zum Dokumentstamm auflösen. */
export function resolveDocPath(fromPage: string, ref: string): string {
  if (ref.startsWith('/')) return normalizePath(ref);
  return normalizePath(`${dirname(fromPage)}/${ref}`);
}

export function pageSlug(path: string): string {
  let p = path.replace(/\\/g, '/');
  p = p.replace(/^content\//, '');
  p = p.replace(/\.(mdoc|md|markdoc)$/i, '');
  const s = p
    .split('/')
    .map((seg) => slugify(seg))
    .join('-');
  return s || 'index';
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + ' …';
}

export function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
