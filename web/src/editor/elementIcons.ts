// Symbole (lucide) für Markdoc-Elemente: Menü „+ Element“ in der Werkzeugleiste
// und Autovervollständigung nach `{%`.

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  Blocks,
  Building2,
  Columns2,
  FileInput,
  Footprints,
  Highlighter,
  ImageIcon,
  Info,
  Keyboard,
  LayoutGrid,
  LayoutTemplate,
  ListCollapse,
  PanelTop,
  RectangleHorizontal,
  Scale,
  SeparatorHorizontal,
  Sigma,
  Split,
  Superscript,
  Table2,
  Tag,
  Terminal,
  TextCursorInput,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentDef } from '../lib/types';

/** Eingebaute Elemente (assets/components) und Markdoc-eigene Tags. */
const BY_NAME: Record<string, LucideIcon> = {
  badge: Tag,
  callout: Info,
  card: RectangleHorizontal,
  cards: LayoutGrid,
  decision: Scale,
  details: ListCollapse,
  endpoint: Webhook,
  figure: ImageIcon,
  footnote: Superscript,
  kbd: Keyboard,
  math: Sigma,
  pagebreak: SeparatorHorizontal,
  step: Footprints,
  steps: Footprints,
  tab: PanelTop,
  tabs: PanelTop,
  // Markdoc
  if: Split,
  else: Split,
  partial: FileInput,
  table: Table2,
};

/** Rückfall für eigene Elemente: Kategorie (deutsch oder englisch, wie bei den eingebauten). */
const BY_CATEGORY: Record<string, LucideIcon> = {
  inline: TextCursorInput,
  hervorhebung: Highlighter,
  emphasis: Highlighter,
  struktur: LayoutTemplate,
  structure: LayoutTemplate,
  medien: ImageIcon,
  media: ImageIcon,
  layout: Columns2,
  technik: Terminal,
  technical: Terminal,
  architektur: Building2,
  architecture: Building2,
};

/** Symbol eines Elements; eigene Elemente ohne passende Kategorie nach Inline/Block. */
export function elementIcon(c: Pick<ComponentDef, 'name' | 'category' | 'inline'>): LucideIcon {
  return BY_NAME[c.name] ?? BY_CATEGORY[c.category?.trim().toLowerCase() ?? ''] ?? (c.inline ? TextCursorInput : Blocks);
}

/** Symbol eines Tags ohne Elementdefinition (`if`, `partial` …). */
export function tagIcon(name: string): LucideIcon | undefined {
  return BY_NAME[name];
}

const markup = new Map<LucideIcon, string>();

/** SVG-Markup eines Symbols für DOM außerhalb von React (z. B. CodeMirror). */
export function iconMarkup(icon: LucideIcon): string {
  let html = markup.get(icon);
  if (html === undefined) {
    const host = document.createElement('div');
    const root = createRoot(host);
    flushSync(() => root.render(createElement(icon, { 'aria-hidden': true })));
    html = host.innerHTML;
    root.unmount();
    if (html) markup.set(icon, html);
  }
  return html;
}
