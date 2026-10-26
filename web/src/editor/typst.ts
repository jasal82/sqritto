// Typst-Unterstützung für CodeMirror: Tokenizer für Markup-, Code- und
// Mathematik-Modus sowie Autovervollständigung über den Typst-Compiler im
// Backend (typst-ide).

import { StreamLanguage, type StreamParser, type StringStream } from '@codemirror/language';
import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

type Mode = 'markup' | 'code' | 'math' | 'content';

interface Frame {
  mode: Mode;
  /** Klammertiefe, bei der dieser Rahmen endet. */
  close: string;
}

interface State {
  stack: Frame[];
  blockComment: number;
  raw: string | null;
  /** Nach `#ident` in Markup: einzelner Ausdruck im Code-Modus. */
  embedded: boolean;
}

const KEYWORDS = new Set([
  'let', 'set', 'show', 'if', 'else', 'for', 'in', 'while', 'return', 'import', 'include', 'as', 'context', 'break', 'continue',
]);
const ATOMS = new Set(['none', 'auto', 'true', 'false']);
const OPERATORS_WORD = new Set(['and', 'or', 'not']);

function top(s: State): Frame {
  return s.stack[s.stack.length - 1];
}

function tokenComment(stream: StringStream, state: State): string | null {
  if (state.blockComment > 0) {
    while (!stream.eol()) {
      if (stream.match('*/')) {
        state.blockComment--;
        if (state.blockComment === 0) return 'comment';
      } else if (stream.match('/*')) state.blockComment++;
      else stream.next();
    }
    return 'comment';
  }
  if (stream.match('//')) {
    stream.skipToEnd();
    return 'comment';
  }
  if (stream.match('/*')) {
    state.blockComment = 1;
    return tokenComment(stream, state);
  }
  return null;
}

function tokenString(stream: StringStream): string {
  let escaped = false;
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '"' && !escaped) break;
    escaped = !escaped && ch === '\\';
  }
  return 'string';
}

function tokenCode(stream: StringStream, state: State): string | null {
  const frame = top(state);
  if (stream.eatSpace()) return null;
  const c = tokenComment(stream, state);
  if (c) return c;
  const ch = stream.peek()!;
  if (ch === '"') {
    stream.next();
    return tokenString(stream);
  }
  if (ch === '[') {
    stream.next();
    state.stack.push({ mode: 'content', close: ']' });
    return 'bracket';
  }
  if (ch === '{' || ch === '(') {
    stream.next();
    state.stack.push({ mode: 'code', close: ch === '{' ? '}' : ')' });
    return 'bracket';
  }
  if (ch === '}' || ch === ')') {
    stream.next();
    if (frame.close === ch) {
      state.stack.pop();
      // Ende eines eingebetteten Ausdrucks?
      if (state.embedded && top(state).mode !== 'code') state.embedded = !endsEmbedded(stream);
    }
    return 'bracket';
  }
  if (ch === '$') {
    stream.next();
    state.stack.push({ mode: 'math', close: '$' });
    return 'keyword';
  }
  if (stream.match(/^<[\w\-.:]+>/)) return 'labelName';
  if (stream.match(/^\d+(\.\d+)?(e[+-]?\d+)?(pt|mm|cm|in|em|fr|%|deg|rad)?/)) return 'number';
  const word = stream.match(/^[a-zA-Z_][\w-]*/) as RegExpMatchArray | null;
  if (word) {
    const w = word[0];
    if (KEYWORDS.has(w)) return 'keyword';
    if (ATOMS.has(w)) return 'atom';
    if (OPERATORS_WORD.has(w)) return 'operator';
    const next = stream.peek();
    if (next === '(' || next === '[') return 'variableName.function';
    return 'variableName';
  }
  if (stream.match(/^(=>|==|!=|<=|>=|\+=|-=|\*=|\/=|\.\.|[+\-*/=<>.:,;])/)) return 'operator';
  stream.next();
  return null;
}

/** Nach `#ausdruck` in Markup: endet der Ausdruck? */
function endsEmbedded(stream: StringStream): boolean {
  const next = stream.peek();
  return !(next === '(' || next === '[' || next === '.');
}

function tokenEmbedded(stream: StringStream, state: State): string | null {
  // Einzelner Ausdruck nach `#` in Markup/Math: Bezeichner, Aufrufe, Feldzugriffe.
  const ch = stream.peek();
  if (ch === '(' || ch === '{') {
    stream.next();
    state.stack.push({ mode: 'code', close: ch === '{' ? '}' : ')' });
    return 'bracket';
  }
  if (ch === '[') {
    stream.next();
    state.stack.push({ mode: 'content', close: ']' });
    return 'bracket';
  }
  if (ch === '"') {
    stream.next();
    state.embedded = false;
    return tokenString(stream);
  }
  if (ch === '.' && stream.match(/^\.[a-zA-Z_][\w-]*/, false)) {
    stream.next();
    return 'operator';
  }
  const word = stream.match(/^[a-zA-Z_][\w-]*/) as RegExpMatchArray | null;
  if (word) {
    const w = word[0];
    if (KEYWORDS.has(w)) {
      // `#let x = …` usw.: Rest der Zeile im Code-Modus.
      state.embedded = false;
      state.stack.push({ mode: 'code', close: '\n' });
      return 'keyword';
    }
    const next = stream.peek();
    if (ATOMS.has(w)) {
      state.embedded = next === '.';
      return 'atom';
    }
    state.embedded = next === '(' || next === '[' || next === '.';
    return next === '(' || next === '[' ? 'variableName.function' : 'variableName';
  }
  state.embedded = false;
  return null;
}

function tokenMarkup(stream: StringStream, state: State): string | null {
  if (state.raw) {
    if (stream.match(state.raw)) {
      state.raw = null;
      return 'monospace';
    }
    while (!stream.eol() && !stream.match(state.raw, false)) stream.next();
    return 'monospace';
  }
  const c = tokenComment(stream, state);
  if (c) return c;
  const frame = top(state);
  if (stream.sol()) {
    stream.eatSpace();
    if (stream.match(/^=+\s/)) {
      stream.skipToEnd();
      return 'heading';
    }
    if (stream.match(/^[-+]\s/) || stream.match(/^\d+\.\s/)) return 'list';
    if (stream.match(/^\/\s[^:]*:/)) return 'strong';
  }
  const ch = stream.next()!;
  if (ch === '\\') {
    stream.next();
    return 'escape';
  }
  if (ch === '#') {
    state.embedded = true;
    return 'keyword';
  }
  if (ch === '$') {
    state.stack.push({ mode: 'math', close: '$' });
    return 'keyword';
  }
  if (ch === ']' && frame.mode === 'content') {
    state.stack.pop();
    if (top(state).mode !== 'code') state.embedded = !endsEmbedded(stream);
    return 'bracket';
  }
  if (ch === '`') {
    if (stream.match('``')) {
      state.raw = '```';
      stream.skipToEnd();
      return 'monospace';
    }
    while (!stream.eol()) if (stream.next() === '`') break;
    return 'monospace';
  }
  if (ch === '*') {
    if (stream.match(/^[^*\n]+\*/)) return 'strong';
    return 'strong';
  }
  if (ch === '_') {
    if (stream.match(/^[^_\n]+_/)) return 'emphasis';
    return null;
  }
  if (ch === '<' && stream.match(/^[\w\-.:]+>/)) return 'labelName';
  if (ch === '@' && stream.match(/^[\w\-.:]+/)) return 'labelName';
  if (ch === 'h' && stream.match(/^ttps?:\/\/\S+/)) return 'link';
  if (ch === '~' || (ch === '-' && stream.match(/^-+/))) return 'operator';
  stream.match(/^[^\\#$\]`*_<@~\-/h]+/);
  return null;
}

function tokenMath(stream: StringStream, state: State): string | null {
  if (stream.eatSpace()) return null;
  const c = tokenComment(stream, state);
  if (c) return c;
  const ch = stream.next()!;
  if (ch === '$') {
    state.stack.pop();
    return 'keyword';
  }
  if (ch === '\\') {
    stream.next();
    return 'escape';
  }
  if (ch === '#') {
    state.embedded = true;
    return 'keyword';
  }
  if (ch === '"') return tokenString(stream);
  if (/[a-zA-Z]/.test(ch)) {
    stream.match(/^[a-zA-Z.]*/);
    return stream.peek() === '(' ? 'variableName.function' : 'variableName';
  }
  if (/\d/.test(ch)) {
    stream.match(/^[\d.]*/);
    return 'number';
  }
  return 'operator';
}

const typstParser: StreamParser<State> = {
  name: 'typst',
  startState: () => ({ stack: [{ mode: 'markup', close: '' }], blockComment: 0, raw: null, embedded: false }),
  copyState: (s) => ({ stack: s.stack.map((f) => ({ ...f })), blockComment: s.blockComment, raw: s.raw, embedded: s.embedded }),
  token(stream, state) {
    // Zeilenende beendet `#let …`-Zeilen
    if (stream.sol()) {
      while (top(state).close === '\n' && state.stack.length > 1) state.stack.pop();
      if (state.embedded && top(state).mode !== 'code') state.embedded = false;
    }
    if (state.blockComment > 0) return tokenComment(stream, state);
    if (state.embedded && top(state).mode !== 'code') {
      const r = tokenEmbedded(stream, state);
      if (r !== null || stream.pos > stream.start) return r;
    }
    const mode = top(state).mode;
    if (mode === 'code') return tokenCode(stream, state);
    if (mode === 'math') return tokenMath(stream, state);
    return tokenMarkup(stream, state);
  },
  blankLine(state) {
    while (top(state).close === '\n' && state.stack.length > 1) state.stack.pop();
    state.embedded = false;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"', '$'] },
  },
};

export const typstStreamLanguage = StreamLanguage.define(typstParser);

// ---------------------------------------------------------------------------
// Vervollständigung über das Backend
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function byteOffset(text: string, pos: number): number {
  return encoder.encode(text.slice(0, pos)).length;
}

function charOffset(text: string, bytes: number): number {
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    if (b >= bytes) return i;
    const code = text.codePointAt(i)!;
    b += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (code >= 0x10000) i++;
  }
  return text.length;
}

const KIND_TYPE: Record<string, string> = {
  func: 'function',
  type: 'type',
  param: 'property',
  constant: 'constant',
  path: 'text',
  package: 'namespace',
  label: 'enum',
  font: 'text',
  syntax: 'keyword',
};

export type TypstCompleter = (
  text: string,
  offset: number,
  explicit: boolean,
) => Promise<{ from: number; items: { label: string; apply?: string | null; detail?: string | null; kind: string }[] } | null>;

function typstCompletions(complete: TypstCompleter) {
  return async (cx: CompletionContext): Promise<CompletionResult | null> => {
    const before = cx.state.doc.sliceString(Math.max(0, cx.pos - 1), cx.pos);
    const word = cx.matchBefore(/[\w\-.#@<"/]*$/);
    if (!cx.explicit && !word?.text && !/[#.(,:\s]/.test(before)) return null;
    if (!cx.explicit && before === ' ' && !/[(,:]\s$/.test(cx.state.doc.sliceString(Math.max(0, cx.pos - 2), cx.pos))) return null;
    const text = cx.state.doc.toString();
    const res = await complete(text, byteOffset(text, cx.pos), cx.explicit).catch(() => null);
    if (!res || cx.aborted) return null;
    const from = charOffset(text, res.from);
    const options: Completion[] = res.items.map((i) => {
      const kind = i.kind.startsWith('symbol') ? 'constant' : (KIND_TYPE[i.kind] ?? 'text');
      const apply = i.apply ?? i.label;
      return {
        label: i.label,
        detail: i.kind.startsWith('symbol') ? i.kind.replace(/^symbol\("?|"?\)$/g, '') : undefined,
        info: i.detail ?? undefined,
        type: kind,
        apply: apply.includes('${') ? snippet(apply) : apply,
      };
    });
    return { from, options, validFor: /^[\w\-.]*$/ };
  };
}

export function typstLanguage(complete: TypstCompleter): Extension[] {
  return [
    typstStreamLanguage,
    typstStreamLanguage.data.of({ autocomplete: typstCompletions(complete) }),
    autocompletion({ activateOnTyping: true, icons: true, maxRenderedOptions: 100 }),
  ];
}
