// Formatierungsbefehle für Markdoc und Typst.

import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { snippet } from '@codemirror/autocomplete';
import { t } from '../lib/i18n';

export type Flavor = 'markdoc' | 'typst';

/** Umschließt die Auswahl (oder das Wort am Cursor) mit Markierungen. */
export function wrapSelection(view: EditorView, before: string, after = before, placeholder = t('Text')): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    let { from, to } = range;
    if (from === to) {
      const word = state.wordAt(from);
      if (word) ({ from, to } = word);
    }
    const text = state.sliceDoc(from, to);
    // Bereits umschlossen → entfernen
    if (
      text.length >= before.length + after.length &&
      text.startsWith(before) &&
      text.endsWith(after) &&
      (before.length || after.length)
    ) {
      const inner = text.slice(before.length, text.length - after.length);
      return { changes: { from, to, insert: inner }, range: EditorSelection.range(from, from + inner.length) };
    }
    const outerBefore = state.sliceDoc(from - before.length, from);
    const outerAfter = state.sliceDoc(to, to + after.length);
    if (outerBefore === before && outerAfter === after && (before || after)) {
      return {
        changes: [
          { from: from - before.length, to: from, insert: '' },
          { from: to, to: to + after.length, insert: '' },
        ],
        range: EditorSelection.range(from - before.length, to - before.length),
      };
    }
    const inner = text || placeholder;
    return {
      changes: { from, to, insert: before + inner + after },
      range: EditorSelection.range(from + before.length, from + before.length + inner.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
  return true;
}

/** Setzt/entfernt ein Präfix am Zeilenanfang (Überschrift, Liste, Zitat). */
export function toggleLinePrefix(view: EditorView, prefix: string, family: RegExp): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const m = family.exec(line.text);
        if (m && m[0] === prefix) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' });
        else if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: prefix });
        else changes.push({ from: line.from, insert: prefix });
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: 'input', scrollIntoView: true });
  view.focus();
  return true;
}

/** Fügt Text (optional als Snippet mit ${Feldern}) am Cursor ein. */
export function insertText(view: EditorView, text: string, asBlock = false): boolean {
  const { state } = view;
  const r = state.selection.main;
  let insert = text;
  let from = r.from;
  if (asBlock) {
    const line = state.doc.lineAt(r.from);
    const needsBreakBefore = line.text.trim().length > 0;
    if (needsBreakBefore) {
      from = line.to;
      insert = `\n\n${text}`;
    } else if (line.number > 1 && state.doc.line(line.number - 1).text.trim()) {
      insert = `\n${text}`;
    }
    insert += '\n';
  }
  if (insert.includes('${')) {
    snippet(insert)(view, { label: '' } as never, from, asBlock ? from : r.to);
  } else {
    view.dispatch({
      changes: { from, to: asBlock ? from : r.to, insert },
      selection: { anchor: from + insert.length },
      userEvent: 'input',
      scrollIntoView: true,
    });
  }
  view.focus();
  return true;
}

export const HEADING_RE: Record<Flavor, RegExp> = {
  markdoc: /^#{1,6}\s/,
  typst: /^=+\s/,
};

export function heading(view: EditorView, flavor: Flavor, level: number) {
  const prefix = (flavor === 'markdoc' ? '#' : '=').repeat(level) + ' ';
  return toggleLinePrefix(view, prefix, HEADING_RE[flavor]);
}

export function bold(view: EditorView, flavor: Flavor) {
  return flavor === 'markdoc' ? wrapSelection(view, '**') : wrapSelection(view, '*');
}

export function italic(view: EditorView, flavor: Flavor) {
  return flavor === 'markdoc' ? wrapSelection(view, '*') : wrapSelection(view, '_');
}

export function strike(view: EditorView, flavor: Flavor) {
  return flavor === 'markdoc' ? wrapSelection(view, '~~') : wrapSelection(view, '#strike[', ']');
}

export function inlineCode(view: EditorView) {
  return wrapSelection(view, '`', '`', 'code');
}

export function bulletList(view: EditorView, flavor: Flavor) {
  return toggleLinePrefix(view, '- ', flavor === 'markdoc' ? /^(\s*)([-*+]|\d+\.|-\s\[[ x]\])\s/ : /^(\s*)([-+])\s/);
}

export function orderedList(view: EditorView, flavor: Flavor) {
  return toggleLinePrefix(view, flavor === 'markdoc' ? '1. ' : '+ ', flavor === 'markdoc' ? /^(\s*)([-*+]|\d+\.)\s/ : /^(\s*)([-+])\s/);
}

export function taskList(view: EditorView) {
  return toggleLinePrefix(view, '- [ ] ', /^(\s*)(-\s\[[ x]\]|[-*+]|\d+\.)\s/);
}

export function quote(view: EditorView, flavor: Flavor) {
  if (flavor === 'markdoc') return toggleLinePrefix(view, '> ', /^>\s?/);
  return wrapSelection(view, '#quote(block: true)[', ']', t('Zitat'));
}

export function link(view: EditorView, flavor: Flavor) {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to);
  const isUrl = /^https?:\/\//.test(text);
  const linkText = `\${${t('Linktext')}}`;
  if (flavor === 'markdoc') {
    return insertText(view, isUrl ? `[${linkText}](${text})` : `[${text || linkText}](\${https://})`);
  }
  return insertText(view, isUrl ? `#link("${text}")[${linkText}]` : `#link("\${https://}")[${text || linkText}]`);
}

export function codeBlock(view: EditorView, flavor: Flavor) {
  const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const lang = `\${${t('sprache')}}`;
  if (flavor === 'markdoc') return insertText(view, '```' + lang + '\n' + (sel || '${}') + '\n```', true);
  return insertText(view, '```' + lang + '\n' + (sel || '${}') + '\n```', true);
}

export function table(view: EditorView, flavor: Flavor) {
  const [c1, c2, c3] = [1, 2, 3].map((n) => t('Spalte {n}', { n }));
  const v = t('Wert');
  if (flavor === 'markdoc') {
    return insertText(view, `| \${${c1}} | ${c2} | ${c3} |\n|:--|:--|:--|\n| ${v} | ${v} | ${v} |\n| ${v} | ${v} | ${v} |`, true);
  }
  return insertText(view, `#table(\n  columns: 3,\n  table.header[*\${${c1}}*][*${c2}*][*${c3}*],\n  [${v}], [${v}], [${v}],\n)`, true);
}

export function hr(view: EditorView, flavor: Flavor) {
  return insertText(view, flavor === 'markdoc' ? '---' : '#line(length: 100%)', true);
}

export function math(view: EditorView, flavor: Flavor) {
  if (flavor === 'markdoc') return insertText(view, '```math\n${a^2 + b^2 = c^2}\n```', true);
  return wrapSelection(view, '$', '$', 'x^2');
}

export function image(view: EditorView, flavor: Flavor, path: string, alt = '') {
  if (flavor === 'markdoc') return insertText(view, `![${alt || `\${${t('Beschreibung')}}`}](${path})`, true);
  return insertText(view, `#figure(\n  image("${path}", width: 80%),\n  caption: [\${${t('Bildunterschrift')}}],\n)`, true);
}
