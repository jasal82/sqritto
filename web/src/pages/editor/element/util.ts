// Hilfen der Element-Ansicht: Bereiche, Beispiel, Snippet und Typst-Signatur.

import { t } from '../../../lib/i18n';
import type { ComponentAttribute } from '../../../lib/types';

/** Inhalt von `component.json` (lose typisiert, unbekannte Felder bleiben erhalten). */
export interface ElementJson {
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  inline?: boolean;
  selfClosing?: boolean;
  pdf?: boolean;
  typst?: string;
  parents?: string[];
  collect?: string;
  snippet?: string;
  example?: string;
  attributes?: Record<string, ComponentAttribute>;
  [key: string]: unknown;
}

export interface SectionInfo {
  file: string;
  label: string;
  short: string;
  description: string;
  /** Vorschau, die zu diesem Bereich passt. */
  preview?: 'html' | 'pdf';
  /** Startinhalt beim Anlegen. */
  template: (name: string) => string;
}

export const KNOWN_FILES: SectionInfo[] = [
  {
    file: 'template.html',
    label: t('HTML-Vorlage'),
    short: 'HTML',
    description: t('Ausgabe in der Website (Mustache-Platzhalter)'),
    preview: 'html',
    template: (n) => `<div class="${n}">\n  {{{children}}}\n</div>\n`,
  },
  {
    file: 'template.typ',
    label: t('PDF-Vorlage'),
    short: 'Typst',
    description: t('Typst-Funktion für das PDF'),
    preview: 'pdf',
    template: (n) => typstSkeleton(n, {}),
  },
  {
    file: 'style.css',
    label: t('Stil'),
    short: 'CSS',
    description: t('Gestaltung in der Website'),
    preview: 'html',
    template: (n) => `.${n} {\n  margin: 1.5rem 0;\n}\n`,
  },
  {
    file: 'script.js',
    label: t('Skript'),
    short: 'JS',
    description: t('Verhalten in der Website'),
    preview: 'html',
    template: (n) =>
      `// ${t('Läuft in der HTML-Ausgabe nach dem Laden der Seite.')}\ndocument.querySelectorAll('.${n}').forEach((el) => {\n  // …\n});\n`,
  },
];

export function sectionInfo(file: string): SectionInfo | undefined {
  return KNOWN_FILES.find((f) => f.file === file);
}

/** Snippet mit Platzhaltern `${…}` → Beispieltext ohne Platzhalter. */
export function fillPlaceholders(snippet: string): string {
  return snippet.replace(/\$\{([^}]*)\}/g, (_m, inner: string) => inner);
}

/** Erzeugt ein Snippet aus den Attributen der Definition. */
export function snippetFromDefinition(name: string, def: ElementJson): string {
  const attrs = Object.entries(def.attributes ?? {});
  const shown = attrs.filter(([, a]) => a.required);
  const list = (shown.length ? shown : attrs.slice(0, 1))
    .map(([k, a]) => {
      const sample = a.matches?.length ? String(a.matches[0]) : a.default !== undefined ? String(a.default) : k;
      if (a.type === 'Boolean') return ` ${k}=\${${sample === k ? 'true' : sample}}`;
      if (a.type === 'Number') return ` ${k}=\${${/^\d/.test(sample) ? sample : '1'}}`;
      return ` ${k}="\${${sample}}"`;
    })
    .join('');
  if (def.selfClosing) return `{% ${name}${list} /%}`;
  if (def.inline) return `{% ${name}${list} %}\${${t('Text')}}{% /${name} %}`;
  return `{% ${name}${list} %}\n\${${t('Inhalt')}}\n{% /${name} %}`;
}

/** Beispiel für die Vorschau: gespeichertes Beispiel oder aus dem Snippet abgeleitet. */
export function exampleOf(name: string, def: ElementJson): string {
  if (typeof def.example === 'string') return def.example;
  return fillPlaceholders(def.snippet?.trim() || snippetFromDefinition(name, def)) + '\n';
}

function typstDefault(a: ComponentAttribute): string {
  if (a.default === undefined || a.default === null) return 'none';
  if (typeof a.default === 'string') return JSON.stringify(a.default);
  if (typeof a.default === 'boolean' || typeof a.default === 'number') return String(a.default);
  return 'none';
}

/** Name der Typst-Funktion. */
export function typstFunction(name: string, def: ElementJson): string {
  return def.typst?.trim() || `ts-${name}`;
}

/** So ruft die Engine die Typst-Funktion auf (zur Orientierung). */
export function typstCall(name: string, def: ElementJson): string {
  const args = Object.entries(def.attributes ?? {}).map(([k, a]) => {
    if (a.type === 'Boolean') return `${k}: true`;
    if (a.type === 'Number') return `${k}: 1`;
    return `${k}: "…"`;
  });
  const call = `#${typstFunction(name, def)}(${args.join(', ')})`;
  return def.selfClosing ? call : `${call}[${t('Inhalt')}]`;
}

/** Grundgerüst einer Typst-Funktion passend zur Definition. */
export function typstSkeleton(name: string, def: ElementJson): string {
  const params = Object.entries(def.attributes ?? {}).map(([k, a]) => `${k}: ${typstDefault(a)}`);
  if (!def.selfClosing) params.push('body');
  const fn = typstFunction(name, def);
  const head = '#import "@sqritto/markdoc:0.1.0": ts-theme\n\n';
  const inner = def.selfClosing ? 'none' : 'body';
  if (def.inline) {
    return `${head}#let ${fn}(${params.join(', ')}) = context {\n  let t = ts-theme.get()\n  box(inset: (x: 3pt), radius: 2pt, fill: t.surface, ${inner})\n}\n`;
  }
  return `${head}#let ${fn}(${params.join(', ')}) = context {\n  let t = ts-theme.get()\n  block(width: 100%, inset: 10pt, radius: t.radius, stroke: 0.6pt + t.border, ${inner})\n}\n`;
}

/** CSS-Klassen, die in der HTML-Vorlage vorkommen. */
export function classesIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-zA-Z_][\w-]*$/.test(c)) out.add(c);
  }
  return [...out];
}

export const ATTR_TYPES: { value: NonNullable<ComponentAttribute['type']>; label: string }[] = [
  { value: 'String', label: t('Text') },
  { value: 'Number', label: t('Zahl') },
  { value: 'Boolean', label: t('Ja/Nein') },
  { value: 'Array', label: t('Liste') },
  { value: 'Object', label: t('Objekt') },
];
