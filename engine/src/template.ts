// Minimalistische, Mustache-kompatible Vorlagen-Engine für HTML-Vorlagen
// eigener Markdoc-Elemente.
//
//   {{name}}            HTML-escaped Wert
//   {{{name}}}          unescaped Wert (z. B. {{{children}}})
//   {{#name}}…{{/name}} Abschnitt, wenn Wert wahr ist (Arrays werden iteriert)
//   {{^name}}…{{/name}} Abschnitt, wenn Wert falsch/leer ist
//   {{name=value}}…{{/name=value}}  Abschnitt, wenn Wert gleich `value`
//   {{! Kommentar }}
//
// `children` wird immer unescaped eingesetzt, da es bereits HTML ist.
//
// Neben den Attributen stehen bereit: `children`, `text`, `hasChildren`, `uid`
// und `docLang` – die Sprache der Beschriftungen im Dokument (`de` für
// deutsche Dokumente, sonst `en`), etwa für
//   {{#docLang=de}}Entschieden am{{/docLang=de}}{{#docLang=en}}Decided on{{/docLang=en}}

import { escapeHtml } from './util';

type Ctx = Record<string, unknown>;

interface Token {
  type: 'text' | 'var' | 'raw' | 'section' | 'inverted' | 'equals';
  value: string;
  arg?: string;
  children?: Token[];
}

const cache = new Map<string, Token[]>();

function parse(tpl: string): Token[] {
  const cached = cache.get(tpl);
  if (cached) return cached;
  const root: Token[] = [];
  const stack: { tok: Token | null; list: Token[]; key: string }[] = [{ tok: null, list: root, key: '' }];
  const re = /\{\{(\{?)\s*([#^/!]?)\s*([^}]*?)\s*\}?\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.list.push({ type: 'text', value: tpl.slice(last, m.index) });
    last = re.lastIndex;
    const [, brace, sigil, body] = m;
    if (sigil === '!') continue;
    if (sigil === '#' || sigil === '^') {
      let tok: Token;
      const eq = body.indexOf('=');
      if (sigil === '#' && eq > 0) {
        tok = { type: 'equals', value: body.slice(0, eq).trim(), arg: body.slice(eq + 1).trim().replace(/^["']|["']$/g, ''), children: [] };
      } else {
        tok = { type: sigil === '#' ? 'section' : 'inverted', value: body, children: [] };
      }
      top.list.push(tok);
      stack.push({ tok, list: tok.children!, key: body });
      continue;
    }
    if (sigil === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    top.list.push({ type: brace || body === 'children' ? 'raw' : 'var', value: body });
  }
  if (last < tpl.length) stack[stack.length - 1].list.push({ type: 'text', value: tpl.slice(last) });
  cache.set(tpl, root);
  return root;
}

function lookup(ctxs: Ctx[], name: string): unknown {
  if (name === '.') return ctxs[ctxs.length - 1]?.['.'];
  const parts = name.split('.');
  for (let i = ctxs.length - 1; i >= 0; i--) {
    const ctx = ctxs[i];
    if (ctx && parts[0] in ctx) {
      let v: any = ctx[parts[0]];
      for (const p of parts.slice(1)) v = v == null ? undefined : v[p];
      return v;
    }
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

function str(v: unknown): string {
  if (v === undefined || v === null || v === false) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderTokens(tokens: Token[], ctxs: Ctx[]): string {
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        out += t.value;
        break;
      case 'var':
        out += escapeHtml(str(lookup(ctxs, t.value)));
        break;
      case 'raw':
        out += str(lookup(ctxs, t.value));
        break;
      case 'section': {
        const v = lookup(ctxs, t.value);
        if (Array.isArray(v)) {
          for (const item of v) {
            const c = typeof item === 'object' && item !== null ? (item as Ctx) : { '.': item };
            out += renderTokens(t.children!, [...ctxs, c]);
          }
        } else if (truthy(v)) {
          out += renderTokens(t.children!, typeof v === 'object' ? [...ctxs, v as Ctx] : ctxs);
        }
        break;
      }
      case 'inverted':
        if (!truthy(lookup(ctxs, t.value))) out += renderTokens(t.children!, ctxs);
        break;
      case 'equals':
        if (str(lookup(ctxs, t.value)) === t.arg) out += renderTokens(t.children!, ctxs);
        break;
    }
  }
  return out;
}

export function renderTemplate(tpl: string, ctx: Ctx): string {
  return renderTokens(parse(tpl), [ctx]);
}
