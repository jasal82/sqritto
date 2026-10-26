// HTML-Vorlagen eigener Elemente: Platzhalter wie {{title}}, {{{children}}}
// und Abschnitte {{#name}}…{{/name}} hervorheben und vervollständigen.

import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { t } from '../lib/i18n';

const decorator = new MatchDecorator({
  regexp: /\{\{\{?\s*([#^/!]?)[^{}]*\}?\}\}/g,
  decoration: (m) =>
    Decoration.mark({
      class: m[1] === '!' ? 'cm-mustache cm-mustache--comment' : m[1] ? 'cm-mustache cm-mustache--section' : 'cm-mustache',
    }),
});

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = decorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Werte, die jede Vorlage zusätzlich zu den Attributen erhält. */
export const TEMPLATE_VALUES: { name: string; info: string }[] = [
  { name: 'children', info: t('Inhalt des Elements (bereits HTML)') },
  { name: 'text', info: t('Inhalt als reiner Text') },
  { name: 'uid', info: t('Eindeutige ID, z. B. für aria-controls') },
  { name: 'hasChildren', info: t('Wahr, wenn das Element Inhalt hat') },
];

function source(attributes: () => string[]) {
  return (cx: CompletionContext): CompletionResult | null => {
    const before = cx.state.sliceDoc(Math.max(0, cx.pos - 80), cx.pos);
    const m = /\{\{(\{?)\s*([#^/]?)\s*([\w.-]*)$/.exec(before);
    if (!m) return null;
    const [, triple, , word] = m;
    // Schließende Klammern ergänzen, falls sie noch fehlen.
    const close = cx.state.sliceDoc(cx.pos, cx.pos + 1) === '}' ? '' : triple ? '}}}' : '}}';
    const options: Completion[] = [
      ...attributes().map((a) => ({ label: a, type: 'property', detail: t('Attribut'), boost: 2 })),
      ...TEMPLATE_VALUES.map((v) => ({ label: v.name, type: 'variable', detail: v.info })),
    ].map((o) => ({ ...o, apply: o.label + close }));
    return { from: cx.pos - word.length, options, validFor: /^[\w.-]*$/ };
  };
}

/** Erweiterung für `template.html` eines Elements. */
export function mustacheTemplate(attributes: () => string[]): Extension[] {
  return [
    highlight,
    EditorState.languageData.of(() => [{ autocomplete: source(attributes) }]),
    autocompletion({ activateOnTyping: true, icons: true }),
  ];
}
