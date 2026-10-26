// Kleiner Code-Editor für einzelne Felder (Snippet, Beispiel) der Element-Ansicht.

import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { Annotation, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { editorTheme, highlight } from '../../../editor/theme';

/** Markiert Änderungen, die von außen kommen (kein Rückruf an `onChange`). */
const external = Annotation.define<boolean>();

const miniTheme = EditorView.theme({
  '&': { height: 'auto', fontSize: '13px' },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 10px' },
  '.cm-scroller': { lineHeight: '1.55' },
});

export function MiniEditor({
  value,
  onChange,
  extensions = [],
  placeholder,
  label,
  minLines = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  extensions?: Extension[];
  placeholder?: string;
  label: string;
  minLines?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          closeBrackets(),
          EditorView.lineWrapping,
          editorTheme,
          Prec.highest(miniTheme),
          highlight,
          EditorState.tabSize.of(2),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) onChangeRef.current(u.state.doc.toString());
          }),
          ...extensions,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Erweiterungen werden nur beim Erzeugen gesetzt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Änderungen von außen übernehmen (z. B. „Aus Attributen erzeugen“).
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, annotations: external.of(true) });
  }, [value]);

  return <div className="mini-editor" ref={host} style={{ ['--mini-lines' as string]: minLines }} />;
}
