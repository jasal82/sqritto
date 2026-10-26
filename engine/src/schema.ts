// Markdoc-Konfiguration: Standardknoten mit Zeilennummern, Überschriften-IDs
// und eigene Elemente (Komponenten) aus Definitionsdateien.

import Markdoc, { type Config, type Node, type Schema, type SchemaAttribute } from '@markdoc/markdoc';
import type { ComponentDef } from './types';
import { IdRegistry, slugify, textOf } from './util';
import { formatDateParts, ui, type Lang } from './i18n';

const { Tag } = Markdoc;

export interface PageContext {
  ids: IdRegistry;
  preview: boolean;
  headings: { level: number; id: string; text: string; line?: number }[];
  /** Sprache der Beschriftungen (Dokumentsprache). */
  lang: Lang;
}

const TYPES: Record<string, unknown> = {
  String,
  Number,
  Boolean,
  Array,
  Object,
};

function lineOf(node: Node): number | undefined {
  return node.lines?.length ? node.lines[0] + 1 : undefined;
}

function withLine(attrs: Record<string, any>, node: Node, _ctx: PageContext) {
  // Zeilennummern werden immer mitgeführt (Diagnosen, Zuordnung zur Quelle);
  // die HTML-Ausgabe entscheidet selbst, ob sie sie ausgibt.
  const l = lineOf(node);
  if (l !== undefined) attrs['data-line'] = l;
  return attrs;
}

function ctxOf(config: Config): PageContext {
  return (config as any).__page as PageContext;
}

export function buildNodes(): Config['nodes'] {
  const n = Markdoc.nodes;
  const simple = (schema: Schema, name: string): Schema => ({
    ...schema,
    transform(node, config) {
      const ctx = ctxOf(config);
      return new Tag(name, withLine(node.transformAttributes(config), node, ctx), node.transformChildren(config));
    },
  });
  return {
    heading: {
      ...n.heading,
      attributes: { ...n.heading.attributes, id: { type: String } },
      transform(node, config) {
        const ctx = ctxOf(config);
        const attrs = node.transformAttributes(config);
        const children = node.transformChildren(config);
        const text = textOf(children).replace(/\s+/g, ' ').trim();
        const level = Number(node.attributes.level);
        const id = attrs.id ? ctx.ids.claim(String(attrs.id)) : ctx.ids.claim(slugify(text));
        attrs.id = id;
        ctx.headings.push({ level, id, text, line: lineOf(node) });
        return new Tag(`h${level}`, withLine(attrs, node, ctx), children);
      },
    },
    paragraph: simple(n.paragraph, 'p'),
    blockquote: {
      ...n.blockquote,
      transform(node, config) {
        const ctx = ctxOf(config);
        const attrs = withLine(node.transformAttributes(config), node, ctx);
        const children = node.transformChildren(config) as any[];
        const alert = githubAlert(children, config);
        if (alert) return new Tag('ts:callout', { ...attrs, type: alert.type }, alert.children);
        return new Tag('blockquote', attrs, children);
      },
    },
    hr: simple(n.hr, 'hr'),
    item: simple(n.item, 'li'),
    table: simple(n.table, 'table'),
    list: {
      ...n.list,
      transform(node, config) {
        const ctx = ctxOf(config);
        const attrs = withLine(node.transformAttributes(config), node, ctx);
        return new Tag(node.attributes.ordered ? 'ol' : 'ul', attrs, node.transformChildren(config));
      },
    },
    fence: {
      ...n.fence,
      attributes: {
        ...n.fence.attributes,
        title: { type: String },
        filename: { type: String },
        lines: { type: Boolean },
        render: { type: Boolean },
      },
      transform(node, config) {
        const ctx = ctxOf(config);
        const attrs = node.transformAttributes(config);
        const content = node.children.length
          ? textOf(node.transformChildren(config))
          : String(node.attributes.content ?? '');
        const language = String(node.attributes.language ?? '').trim().split(/\s+/)[0] || '';
        return new Tag(
          'ts:fence',
          withLine(
            {
              content: content.replace(/\n$/, ''),
              language,
              title: attrs.title ?? attrs.filename,
              lines: attrs.lines ?? false,
              render: attrs.render ?? false,
            },
            node,
            ctx,
          ),
          [],
        );
      },
    },
    image: {
      ...n.image,
      attributes: { ...n.image.attributes, width: { type: String } },
      transform(node, config) {
        return new Tag('img', node.transformAttributes(config), []);
      },
    },
  };
}

const ALERTS: Record<string, string> = {
  NOTE: 'note',
  INFO: 'info',
  TIP: 'tip',
  IMPORTANT: 'important',
  WARNING: 'warning',
  CAUTION: 'caution',
  DANGER: 'danger',
};

/** Erkennt GitHub-Hinweisblöcke (`> [!NOTE]`) und wandelt sie in Callouts um. */
function githubAlert(children: any[], config: Config): { type: string; children: any[] } | null {
  if (!(config.tags ?? {})['callout']) return null;
  const first = children[0];
  if (!Markdoc.Tag.isTag(first) || first.name !== 'p') return null;
  const head = first.children[0];
  if (typeof head !== 'string') return null;
  const m = /^\[!([A-Za-z]+)\]\s*/.exec(head);
  if (!m || !ALERTS[m[1].toUpperCase()]) return null;
  const rest = [head.slice(m[0].length), ...first.children.slice(1)];
  while (rest.length && typeof rest[0] === 'string' && !rest[0].trim()) rest.shift();
  const out = rest.length ? [new Tag('p', first.attributes, rest), ...children.slice(1)] : children.slice(1);
  return { type: ALERTS[m[1].toUpperCase()], children: out };
}

function attrSchema(def: ComponentDef['attributes']): Record<string, SchemaAttribute> {
  const out: Record<string, SchemaAttribute> = {};
  for (const [key, a] of Object.entries(def ?? {})) {
    const attr: SchemaAttribute = {};
    if (a.type && TYPES[a.type]) attr.type = TYPES[a.type] as any;
    if (a.default !== undefined) attr.default = a.default;
    if (a.required) attr.required = true;
    if (a.matches?.length) attr.matches = a.matches as any;
    if (a.description) attr.description = a.description;
    out[key] = attr;
  }
  return out;
}

export function buildTags(components: ComponentDef[]): Record<string, Schema> {
  const tags: Record<string, Schema> = {};
  for (const c of components) {
    if (!/^[a-zA-Z][\w-]*$/.test(c.name)) continue;
    const schema: Schema = {
      inline: c.inline ?? false,
      selfClosing: c.selfClosing ?? false,
      attributes: attrSchema(c.attributes),
      description: c.description,
      transform(node, config) {
        const ctx = ctxOf(config);
        const attrs = node.transformAttributes(config);
        // Für Typst sollen auch gesetzte Defaults übergeben werden.
        for (const [k, a] of Object.entries(c.attributes ?? {})) {
          if (attrs[k] === undefined && a.default !== undefined) attrs[k] = a.default;
        }
        const tag = new Tag(`ts:${c.name}`, withLine(attrs, node, ctx), node.transformChildren(config));
        (tag as any).__inline = node.inline;
        return tag;
      },
    };
    if (c.parents?.length) {
      const parents = c.parents;
      schema.validate = (node: Node, _config: Config) => {
        // Markdoc übergibt Eltern über validation.parents
        const ps: Node[] = ((_config as any).validation?.parents ?? []) as Node[];
        const parent = [...ps].reverse().find((p) => p.type === 'tag');
        if (parent && parent.tag && !parents.includes(parent.tag)) {
          return [
            {
              id: 'tag-placement-invalid',
              level: 'warning',
              message: ui(
                `\`${c.name}\` sollte innerhalb von ${parents.map((p) => `\`${p}\``).join(' oder ')} stehen.`,
                `\`${c.name}\` should be placed inside ${parents.map((p) => `\`${p}\``).join(' or ')}.`,
              ),
            },
          ];
        }
        return [];
      };
    }
    tags[c.name] = schema;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Inline-Elemente in eigener Zeile
// ---------------------------------------------------------------------------

/** Eltern, in denen Inline-Inhalt ohne Absatz steht (enge Listen, Tabellenzellen). */
const BARE_FLOW_PARENTS = new Set(['item', 'td', 'th']);

/**
 * Markdoc liest einen Tag, der allein in einer Zeile steht, als Block
 * (`node.inline === false`). Für Inline-Elemente (`kbd`, `badge` …) ergäbe das
 * die Meldung „should be inline“, obwohl die Schreibweise naheliegt. Solche
 * Elemente werden hier in den Textfluss geholt: Sie bilden einen Absatz, der nur
 * dieses Element enthält, oder werden an einen direkt angrenzenden Absatz (ohne
 * Leerzeile dazwischen) angehängt. Steht der Inhalt eines Elements in eigenen
 * Zeilen, wird er als Inline-Inhalt übernommen. Enthält das Element Listen,
 * Tabellen o. Ä., bleibt es unverändert und wird bei der Prüfung gemeldet.
 */
export function placeInlineTags(node: Node, inlineTags: ReadonlySet<string>): void {
  if (!inlineTags.size) return;
  const out: Node[] = [];
  // Zuletzt erzeugter oder erweiterter Absatz mit einem solchen Element.
  let lifted: Node | undefined;
  for (const child of node.children) {
    placeInlineTags(child, inlineTags);
    const prev = out[out.length - 1];
    if (child.type === 'tag' && !child.inline && child.tag && inlineTags.has(child.tag)) {
      const content = inlineContent(child);
      if (content) {
        child.children = content;
        child.inline = true;
        const target = prev && touches(prev, child) ? flowOf(prev) : undefined;
        if (target) {
          target.children.push(flowNode('softbreak', child), child);
          extendLines(prev, child);
          lifted = prev;
        } else {
          const bare = BARE_FLOW_PARENTS.has(node.type) && !node.children.some((c) => c.type === 'paragraph');
          const flow = flowNode('inline', child, [child]);
          lifted = bare ? flow : flowNode('paragraph', child, [flow]);
          out.push(lifted);
        }
        continue;
      }
    }
    // Text direkt unter einem solchen Element gehört zum selben Absatz.
    const next = flowOf(child);
    if (prev && prev === lifted && next && touches(prev, child)) {
      flowOf(prev)!.children.push(flowNode('softbreak', child), ...next.children);
      extendLines(prev, child);
      continue;
    }
    out.push(child);
  }
  node.children = out;
}

/** Inline-Inhalt eines Absatzes bzw. Inline-Knotens. */
function flowOf(node: Node): Node | undefined {
  if (node.type === 'inline') return node;
  if (node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'inline') return node.children[0];
  return undefined;
}

/** Kinder eines Elements als Inline-Inhalt; `null`, wenn Blöcke wie Listen enthalten sind. */
function inlineContent(tag: Node): Node[] | null {
  const out: Node[] = [];
  for (const c of tag.children) {
    const flow = c.type === 'paragraph' ? flowOf(c) : undefined;
    if (!flow) return null;
    // Mehrere Absätze bleiben als Zeilenumbruch erkennbar.
    if (out.length) out.push(flowNode('hardbreak', c));
    out.push(...flow.children);
  }
  return out;
}

/** Endet `a` in der Zeile, in der `b` beginnt (keine Leerzeile dazwischen)? */
function touches(a: Node, b: Node): boolean {
  return a.lines.length > 0 && b.lines.length > 0 && a.lines[a.lines.length - 1] === b.lines[0];
}

function extendLines(target: Node, by: Node) {
  const end = by.lines[by.lines.length - 1];
  for (const n of [target, flowOf(target)]) if (n && n.lines.length) n.lines = [n.lines[0], end];
}

function flowNode(type: 'paragraph' | 'inline' | 'softbreak' | 'hardbreak', at: Node, children: Node[] = []): Node {
  const n = new Markdoc.Ast.Node(type, {}, children);
  n.lines = [at.lines[0], at.lines[at.lines.length - 1]].filter((l) => l !== undefined);
  n.location = at.location;
  n.inline = type === 'softbreak' || type === 'hardbreak';
  return n;
}

export const functions: Config['functions'] = {
  upper: {
    transform(params) {
      return String(params[0] ?? '').toUpperCase();
    },
  },
  lower: {
    transform(params) {
      return String(params[0] ?? '').toLowerCase();
    },
  },
  join: {
    transform(params) {
      const arr = params[0];
      return Array.isArray(arr) ? arr.join(params[1] ?? ', ') : String(arr ?? '');
    },
  },
  today: {
    // Heutiges Datum in der Schreibweise der Dokumentsprache, `today("iso")` als ISO-Datum.
    transform(params, config) {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      if (params[0] === 'iso') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const lang = (config as any)?.__page?.lang ?? 'de';
      return formatDateParts(d.getFullYear(), d.getMonth() + 1, d.getDate(), lang);
    },
  },
};
