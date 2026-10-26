import { isExternalUrl, normalizePath, pageSlug, resolveDocPath } from './util';

export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'page'; slug: string; anchor?: string; path: string }
  | { kind: 'file'; path: string; anchor?: string };

const PAGE_EXT = /\.(mdoc|md|markdoc)$/i;

/** Löst Verweise zwischen Seiten, Ankern und Dateien auf. */
export class LinkResolver {
  private pagesByPath = new Map<string, string>();
  private labels = new Set<string>();

  constructor(pages: { path: string; slug: string }[]) {
    for (const p of pages) this.pagesByPath.set(normalizePath(p.path), p.slug);
  }

  slugFor(path: string): string | undefined {
    return this.pagesByPath.get(normalizePath(path));
  }

  label(slug: string, id: string): string {
    return `${slug}:${id}`;
  }

  pageLabel(slug: string): string {
    return `page:${slug}`;
  }

  addLabel(label: string) {
    this.labels.add(label);
  }

  hasLabel(label: string): boolean {
    return this.labels.has(label);
  }

  resolve(fromPage: string, href: string): LinkTarget {
    if (!href) return { kind: 'external', href };
    if (isExternalUrl(href)) return { kind: 'external', href };
    const hashIdx = href.indexOf('#');
    const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const anchor = hashIdx >= 0 ? decodeURIComponent(href.slice(hashIdx + 1)) || undefined : undefined;
    if (!pathPart) {
      const slug = this.slugFor(fromPage) ?? pageSlug(fromPage);
      return { kind: 'page', slug, anchor, path: fromPage };
    }
    let path = resolveDocPath(fromPage, decodeURI(pathPart));
    // Links auf .html-Seiten der exportierten Site ebenfalls zuordnen.
    if (/\.html$/i.test(path)) {
      const slug = path.replace(/\.html$/i, '').split('/').pop()!;
      for (const [p, s] of this.pagesByPath) if (s === slug) return { kind: 'page', slug, anchor, path: p };
    }
    if (!PAGE_EXT.test(path)) {
      for (const ext of ['.mdoc', '.md']) {
        const s = this.slugFor(path + ext);
        if (s) return { kind: 'page', slug: s, anchor, path: path + ext };
      }
      return { kind: 'file', path, anchor };
    }
    const slug = this.slugFor(path);
    if (slug) return { kind: 'page', slug, anchor, path };
    return { kind: 'page', slug: pageSlug(path), anchor, path };
  }
}
