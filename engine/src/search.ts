import MiniSearch from 'minisearch';
import type { RenderableTreeNode } from '@markdoc/markdoc';
import type { SearchSection } from './types';
import { collapseWs, isTag, textOf } from './util';
import { SEARCH_OPTIONS } from './search-options';

/** Zerlegt eine Seite an Überschriften (h1–h3) in durchsuchbare Abschnitte. */
export function sectionsOf(
  nodes: RenderableTreeNode[],
  page: { slug: string; title: string },
): SearchSection[] {
  const sections: SearchSection[] = [];
  let current: SearchSection = {
    id: `${page.slug}#`,
    page: page.slug,
    anchor: '',
    pageTitle: page.title,
    heading: page.title,
    text: '',
  };
  const parts: string[] = [];
  const push = () => {
    current.text = collapseWs(parts.join(' ')).slice(0, 4000);
    if (current.text || current.anchor) sections.push(current);
    parts.length = 0;
  };
  const walk = (list: RenderableTreeNode[]) => {
    for (const n of list) {
      if (isTag(n) && /^h[1-3]$/.test(n.name)) {
        push();
        const id = String(n.attributes.id ?? '');
        current = {
          id: `${page.slug}#${id}`,
          page: page.slug,
          anchor: id,
          pageTitle: page.title,
          heading: collapseWs(textOf(n.children)),
          text: '',
        };
      } else if (isTag(n) && n.name === 'article') {
        walk(n.children);
      } else {
        parts.push(textOf(n));
      }
    }
  };
  walk(nodes);
  push();
  return sections;
}

export function buildSearchIndex(sections: SearchSection[]): string {
  const ms = new MiniSearch<SearchSection>(SEARCH_OPTIONS as any);
  const seen = new Set<string>();
  const docs = sections.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  ms.addAll(docs);
  return JSON.stringify({ version: 1, index: ms.toJSON() });
}
