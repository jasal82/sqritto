import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language';
import { lintGutter, lintKeymap } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { editorTheme, highlight } from './theme';

export const gutterCompartment = new Compartment();
export const wrapCompartment = new Compartment();
export const languageCompartment = new Compartment();

export interface EditorPrefs {
  lineNumbers: boolean;
  wordWrap: boolean;
}

export function gutterExt(p: EditorPrefs): Extension {
  return p.lineNumbers ? [lineNumbers(), foldGutter({ openText: '▾', closedText: '▸' }), lintGutter()] : [lintGutter()];
}

export function wrapExt(p: EditorPrefs): Extension {
  return p.wordWrap ? EditorView.lineWrapping : [];
}

export function baseExtensions(prefs: EditorPrefs, extra: Extension[]): Extension[] {
  return [
    gutterCompartment.of(gutterExt(prefs)),
    wrapCompartment.of(wrapExt(prefs)),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    search({ top: true }),
    editorTheme,
    highlight,
    EditorState.tabSize.of(2),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
      indentWithTab,
    ]),
    ...extra,
  ];
}
