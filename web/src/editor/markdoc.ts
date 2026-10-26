// Markdoc-Unterstützung für CodeMirror: Markdown-Grammatik erweitert um
// {% Tags %}, Variablen und YAML-Frontmatter, dazu Autovervollständigung für
// Elemente, Attribute, Werte, Variablen, Seitenlinks und Dateien.

import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  autocompletion,
  insertCompletionText,
  pickedCompletion,
  snippet,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import type { LucideIcon } from 'lucide-react';
import { t } from '../lib/i18n';
import type { ComponentDef, Heading } from '../lib/types';
import { elementIcon, iconMarkup, tagIcon } from './elementIcons';

// ---------------------------------------------------------------------------
// Grammatik
// ---------------------------------------------------------------------------

const TAG_RE = /\s*(\/?)([a-zA-Z][\w-]*)?/y;
const TOKEN_RE = /\s*(?:("(?:[^"\\]|\\.)*")|(\$[\w.]+)|([a-zA-Z_][\w-]*)(=)?|([#.][\w-]+)|(\d+(?:\.\d+)?)|(true|false|null)|([()[\]{},:]))/y;

function tagChildren(cx: InlineContext, from: number, to: number) {
  const els = [cx.elt('MarkdocMark', from, from + 2)];
  const text = cx.slice(from + 2, to - 2);
  const base = from + 2;
  let i = 0;
  TAG_RE.lastIndex = 0;
  const m = TAG_RE.exec(text);
  if (m) {
    const nameStart = base + m[0].length - (m[2]?.length ?? 0);
    if (m[2]) els.push(cx.elt('MarkdocTagName', nameStart, nameStart + m[2].length));
    i = m[0].length;
  }
  while (i < text.length) {
    TOKEN_RE.lastIndex = i;
    const tok = TOKEN_RE.exec(text);
    if (!tok) {
      i++;
      continue;
    }
    const start = base + tok.index + tok[0].length - tok[0].trimStart().length;
    if (tok[1]) els.push(cx.elt('MarkdocString', start, start + tok[1].length));
    else if (tok[2]) els.push(cx.elt('MarkdocVariable', start, start + tok[2].length));
    else if (tok[3]) {
      const isFn = text[TOKEN_RE.lastIndex] === '(';
      els.push(cx.elt(tok[4] ? 'MarkdocAttrName' : isFn ? 'MarkdocFunction' : 'MarkdocWord', start, start + tok[3].length));
    } else if (tok[5]) els.push(cx.elt('MarkdocAnnotation', start, start + tok[5].length));
    else if (tok[6] || tok[7]) els.push(cx.elt('MarkdocLiteral', start, start + (tok[6] ?? tok[7]).length));
    i = TOKEN_RE.lastIndex;
  }
  els.push(cx.elt('MarkdocMark', to - 2, to));
  return els;
}

const markdocExtension: MarkdownConfig = {
  defineNodes: [
    { name: 'MarkdocTag', style: tags.special(tags.content) },
    { name: 'MarkdocMark', style: tags.processingInstruction },
    { name: 'MarkdocTagName', style: tags.tagName },
    { name: 'MarkdocAttrName', style: tags.attributeName },
    { name: 'MarkdocString', style: tags.attributeValue },
    { name: 'MarkdocVariable', style: tags.special(tags.variableName) },
    { name: 'MarkdocFunction', style: tags.function(tags.variableName) },
    { name: 'MarkdocAnnotation', style: tags.labelName },
    { name: 'MarkdocLiteral', style: tags.number },
    { name: 'MarkdocWord', style: tags.keyword },
    { name: 'MarkdocFrontmatter', block: true, style: tags.meta },
  ],
  parseInline: [
    {
      name: 'MarkdocTag',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 123 /* { */ || cx.char(pos + 1) !== 37 /* % */) return -1;
        const rel = cx.text.indexOf('%}', pos - cx.offset + 2);
        if (rel < 0) return -1;
        const end = cx.offset + rel + 2;
        return cx.addElement(cx.elt('MarkdocTag', pos, end, tagChildren(cx, pos, end)));
      },
      before: 'Emphasis',
    },
  ],
  parseBlock: [
    {
      name: 'MarkdocFrontmatter',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== '---') return false;
        const start = cx.lineStart;
        let end = start + line.text.length;
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length;
          if (line.text.trimEnd() === '---') {
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt('MarkdocFrontmatter', start, end));
        return true;
      },
      before: 'HorizontalRule',
    },
  ],
};

// ---------------------------------------------------------------------------
// Vervollständigung
// ---------------------------------------------------------------------------

export interface MarkdocContext {
  components: () => ComponentDef[];
  variables: () => string[];
  pages: () => { path: string; title: string; headings: Heading[] }[];
  files: () => string[];
  currentPath: () => string;
}

/** Vorschlag mit eigenem Symbol (lucide) statt des Standardsymbols. */
interface IconCompletion extends Completion {
  icon?: LucideIcon;
}

const BUILTIN_TAGS: Completion[] = [
  tagCompletion('if', `{% if \${$${t('bedingung')}} %}\n\${}\n{% /if %}`, { detail: t('Bedingung'), type: 'keyword', icon: tagIcon('if') }),
  tagCompletion('else', '{% else /%}', { detail: t('Alternative in if'), type: 'keyword', icon: tagIcon('else') }),
  tagCompletion('partial', `{% partial file="\${partials/${t('datei')}.mdoc}" /%}`, {
    detail: t('Baustein einbinden'),
    type: 'keyword',
    icon: tagIcon('partial'),
  }),
  tagCompletion(
    'table',
    `{% table %}\n* ${t('Spalte {n}', { n: 'A' })}\n* ${t('Spalte {n}', { n: 'B' })}\n---\n* \${${t('Wert')}}\n* ${t('Wert')}\n{% /table %}`,
    {
      detail: t('Tabelle (Listenform)'),
      type: 'keyword',
      icon: tagIcon('table'),
    },
  ),
];

/**
 * Symbol vor jedem Vorschlag. Ersetzt das Standardsymbol von CodeMirror
 * (`icons: false`): Elemente und Tags erhalten ihr lucide-Symbol, alle übrigen
 * Vorschläge (Attribute, Werte, Links …) behalten das Zeichen ihres Typs.
 */
const completionIcon = {
  position: 20,
  render(completion: Completion): Node {
    const el = document.createElement('div');
    el.className = 'cm-completionIcon';
    el.setAttribute('aria-hidden', 'true');
    const icon = (completion as IconCompletion).icon;
    if (icon) {
      el.classList.add('cm-completionIcon-lucide');
      el.innerHTML = iconMarkup(icon);
    } else if (completion.type) {
      el.classList.add(...completion.type.split(/\s+/).filter(Boolean).map((c) => `cm-completionIcon-${c}`));
    }
    return el;
  },
};

/**
 * Vervollständigung eines Tagnamens. Eingefügt wird immer der vollständige
 * Tag: Der bereits getippte Anfang (`{%`, `{% `) und ein schon vorhandener
 * Abschluss (`}` von der automatischen Klammer, `%}`) werden ersetzt. Steht
 * der Tag schon mit Attributen da, wird nur der Name ausgetauscht.
 */
function tagCompletion(name: string, template: string, opts: Omit<IconCompletion, 'label' | 'apply'>): IconCompletion {
  const insertSnippet = snippet(template);
  return {
    ...opts,
    label: name,
    apply: (view: EditorView, completion: Completion, from: number, to: number) => {
      const line = view.state.doc.lineAt(from);
      const before = line.text.slice(0, from - line.from);
      const after = line.text.slice(to - line.from);
      const open = /\{%[ \t]*\/?[ \t]*$/.exec(before);
      // Tag mit Attributen vorhanden: nur den Namen ersetzen.
      if (!open || /^[ \t]+[^%\s}][^{}]*%\}/.test(after)) {
        view.dispatch({
          ...insertCompletionText(view.state, name, from, to),
          annotations: pickedCompletion.of(completion),
        });
        return;
      }
      const close = /^[ \t]*\/?%?\}/.exec(after);
      insertSnippet(view, completion, from - open[0].length, to + (close ? close[0].length : 0));
    },
  };
}

/** Vollständiges Snippet eines Elements, z. B. `{% name … %}…{% /name %}`. */
function fullSnippet(c: ComponentDef): string {
  const s = c.snippet?.trim();
  if (s) return s.startsWith('{%') ? s : `{% ${s.replace(/\s*%\}$/, '')} %}`;
  const attrs = Object.entries(c.attributes ?? {})
    .filter(([, a]) => a.required)
    .map(([k]) => ` ${k}="\${${k}}"`)
    .join('');
  return c.selfClosing ? `{% ${c.name}${attrs} /%}` : `{% ${c.name}${attrs} %}\n\${}\n{% /${c.name} %}`;
}

function relativePath(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

function markdocCompletions(ctx: MarkdocContext) {
  return (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos);
    const before = line.text.slice(0, cx.pos - line.from);

    // Innerhalb eines Tags?
    const open = before.lastIndexOf('{%');
    const close = before.lastIndexOf('%}');
    if (open >= 0 && open > close) {
      const inside = before.slice(open + 2);
      // Variablen
      const varM = /\$([\w.]*)$/.exec(inside);
      if (varM) {
        return {
          from: cx.pos - varM[1].length,
          options: ctx.variables().map((v) => ({ label: v, type: 'variable', detail: t('Variable') })),
          validFor: /^[\w.]*$/,
        };
      }
      // Tagname
      const nameM = /^\s*(\/?)([\w-]*)$/.exec(inside);
      if (nameM) {
        if (nameM[1]) {
          // schließendes Tag: offene Tags vorschlagen
          const names = [
            ...ctx.components().map((c) => ({ name: c.name, icon: elementIcon(c) })),
            ...['if', 'table'].map((name) => ({ name, icon: tagIcon(name) })),
          ];
          return {
            from: cx.pos - nameM[2].length,
            options: names.map(({ name, icon }) => tagCompletion(name, `{% /${name} %}`, { type: 'type', icon })),
            validFor: /^[\w-]*$/,
          };
        }
        const options: Completion[] = [
          ...ctx.components().map((c) =>
            tagCompletion(c.name, fullSnippet(c), {
              detail: c.title ?? undefined,
              info: c.description ?? undefined,
              type: c.source === 'local' ? 'class' : 'type',
              icon: elementIcon(c),
              boost: 2,
            }),
          ),
          ...BUILTIN_TAGS,
        ];
        return { from: cx.pos - nameM[2].length, options, validFor: /^[\w-]*$/ };
      }
      const tagName = /^\s*([\w-]+)/.exec(inside)?.[1];
      const comp = ctx.components().find((c) => c.name === tagName);
      if (comp) {
        // Wert eines Attributs
        const valM = /([\w-]+)="([^"]*)$/.exec(inside);
        if (valM) {
          const attr = comp.attributes?.[valM[1]];
          let options: Completion[] = [];
          if (attr?.matches?.length) options = attr.matches.map((m) => ({ label: String(m), type: 'enum' }));
          else if (attr?.link) options = linkOptions(ctx);
          else if (attr?.asset) options = assetOptions(ctx, true);
          if (options.length) return { from: cx.pos - valM[2].length, options, validFor: /^[^"]*$/ };
          return null;
        }
        // Attributname
        const attrM = /\s([\w-]*)$/.exec(inside);
        if (attrM) {
          const used = new Set([...inside.matchAll(/([\w-]+)=/g)].map((m) => m[1]));
          const options = Object.entries(comp.attributes ?? {})
            .filter(([k]) => !used.has(k))
            .map(([k, a]) => {
              const isBool = a.type === 'Boolean';
              const isNum = a.type === 'Number';
              const tpl = isBool ? `${k}=\${true}` : isNum ? `${k}=\${${a.default ?? 1}}` : `${k}="\${}"`;
              const type = a.type ?? 'String';
              return snippetCompletion(tpl, {
                label: k,
                type: 'property',
                detail: a.required ? t('{type} · Pflicht', { type }) : type,
                info: a.description ?? undefined,
              });
            });
          return { from: cx.pos - attrM[1].length, options, validFor: /^[\w-]*$/ };
        }
      }
      return null;
    }

    // Links: ](…  bzw. Bilder ![…](…
    const linkM = /(!?)\[[^\]]*\]\(([^)\s]*)$/.exec(before);
    if (linkM) {
      const isImage = linkM[1] === '!';
      const options = isImage ? assetOptions(ctx, false) : linkOptions(ctx);
      return { from: cx.pos - linkM[2].length, options, validFor: /^[^)\s]*$/ };
    }

    // "{%" eintippen → Elementliste anbieten
    const trigger = /\{%\s*$/.exec(before);
    if (trigger && cx.explicit) return null;
    return null;
  };
}

function linkOptions(ctx: MarkdocContext): Completion[] {
  const cur = ctx.currentPath();
  const out: Completion[] = [];
  for (const p of ctx.pages()) {
    const rel = p.path === cur ? '' : relativePath(cur, p.path);
    if (rel) out.push({ label: rel, detail: p.title, type: 'text', boost: 1 });
    for (const h of p.headings) {
      if (h.level < 2) continue;
      out.push({ label: `${rel}#${h.id}`, detail: `${p.title} › ${h.text}`, type: 'text' });
    }
  }
  return out;
}

function assetOptions(ctx: MarkdocContext, absolute: boolean): Completion[] {
  const cur = ctx.currentPath();
  return ctx
    .files()
    .filter((f) => /\.(png|jpe?g|gif|svg|webp|pdf)$/i.test(f))
    .map((f) => ({ label: absolute ? `/${f}` : relativePath(cur, f), type: 'text', detail: t('Datei') }));
}

export function markdocLanguage(ctx: MarkdocContext): Extension[] {
  return [
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [markdocExtension] }),
    markdownLanguage.data.of({ autocomplete: markdocCompletions(ctx) }),
    autocompletion({ activateOnTyping: true, icons: false, addToOptions: [completionIcon], maxRenderedOptions: 80 }),
  ];
}

/** Elemente für Menüs/Toolbar: Snippet als vollständiger Tag. */
export function componentSnippet(c: ComponentDef): string {
  return fullSnippet(c);
}
