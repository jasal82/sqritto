import Markdoc, { type Node, type RenderableTreeNode, type ValidateError } from '@markdoc/markdoc';
import yaml from 'js-yaml';
import type {
  BuildInput,
  BuildOutput,
  ComponentDef,
  Diagnostic,
  LineMapEntry,
  NavSection,
  OutlineItem,
  PageOutput,
  SearchSection,
} from './types';
import { buildNodes, buildTags, functions, placeInlineTags, type PageContext } from './schema';
import { LinkResolver } from './links';
import { renderTopLevel, tsStr, type TypstCtx } from './typst';
import { renderHtml, setEmitLines, type HostApi, type HtmlCtx } from './html';
import { renderShell, type ShellPage } from './shell';
import { buildSearchIndex, sectionsOf } from './search';
import { IdRegistry, isTag, pageSlug, slugify, textOf, collapseWs, truncate } from './util';
import { initUiLang, labelLang, ui, type Lang } from './i18n';

interface ParsedPage {
  path: string;
  slug: string;
  source: string;
  ast: Node;
  frontmatter: Record<string, unknown>;
  ctx: PageContext;
  tree: RenderableTreeNode;
  title: string;
  description?: string;
  /** Wörter im Fließtext (für die Lesezeit). */
  words: number;
  /** Kurzbeschreibung für Übersichten. */
  excerpt?: string;
}

const HOME_SLUG = 'index';

/** Titel einer Seite vor dem Parsen (Frontmatter `title` oder erste Überschrift). */
function guessTitle(source: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const t = fm ? /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1]) : null;
  if (t) return t[1];
  const h = /^#\s+(.+?)\s*#*\s*$/m.exec(source);
  return h ? h[1].replace(/[*_`{}%]/g, '') : undefined;
}

/** Wörter je Minute für die geschätzte Lesezeit (Fachtext). */
const WORDS_PER_MINUTE = 180;

function firstParagraph(body: RenderableTreeNode[]): string {
  for (const n of body) {
    if (isTag(n) && n.name === 'p') {
      const t = collapseWs(textOf(n.children));
      if (t) return t;
    }
  }
  return '';
}

const LEVEL: Record<string, Diagnostic['level']> = {
  debug: 'info',
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'error',
};

function bodyOf(tree: RenderableTreeNode): RenderableTreeNode[] {
  if (isTag(tree) && tree.name === 'article') return tree.children;
  return Array.isArray(tree) ? tree : [tree];
}

export function buildDocument(input: BuildInput): BuildOutput {
  const host: HostApi = ((globalThis as any).__host as HostApi) ?? {};
  initUiLang(host);
  // Dokumentsprache für Beschriftungen (Seitenrahmen, Elemente, Datumsangaben).
  const docVars = (input.variables?.document ?? {}) as { lang?: string };
  const lang: Lang = labelLang(input.site?.lang ?? docVars.lang);
  const diagnostics: Diagnostic[] = [];
  const componentList: ComponentDef[] = input.components ?? [];
  const components = new Map(componentList.map((c) => [c.name, c]));
  const nodes = buildNodes();
  const tags = buildTags(componentList);
  const preview = !!input.preview;
  const usedComponents = new Set<string>();
  // Inline-Elemente, die allein in einer Zeile stehen, in den Textfluss holen.
  const inlineTags = new Set(componentList.filter((c) => c.inline).map((c) => c.name));
  const parse = (source: string, file: string): Node => {
    const ast = Markdoc.parse(source, { file } as any);
    placeInlineTags(ast, inlineTags);
    return ast;
  };

  // Partials: unter mehreren Schlüsseln erreichbar (`partials/x.mdoc`, `x.mdoc`).
  const partials: Record<string, Node> = {};
  for (const [p, src] of Object.entries(input.partials ?? {})) {
    try {
      const ast = parse(src, p);
      const rel = p.replace(/^content\//, '');
      partials[p] = ast;
      partials[rel] = ast;
      partials[rel.replace(/^partials\//, '')] = ast;
    } catch (e) {
      diagnostics.push({ path: p, level: 'error', message: ui(`Partial konnte nicht gelesen werden: ${String(e)}`, `Could not read partial: ${String(e)}`), source: 'engine' });
    }
  }

  // Seiten: eindeutige Slugs vergeben.
  const slugs = new IdRegistry();
  // Startseite der HTML-Ausgabe: „index“ ist für die Übersicht reserviert,
  // eine Inhaltsseite index.mdoc erhält einen Namen nach ihrem Titel.
  const landing = !!input.targets.html && !!input.site && input.site.landing !== false && input.pages.length > 1;
  if (landing) slugs.claim(HOME_SLUG);
  const infos = input.pages.map((p) => {
    const base = pageSlug(p.path);
    const slug = landing && base === HOME_SLUG ? slugify(guessTitle(p.source) ?? '') || 'start' : base;
    return { ...p, slug: slugs.claim(slug) };
  });
  const links = new LinkResolver(infos);

  const parsed: ParsedPage[] = [];
  for (const p of infos) {
    let ast: Node;
    try {
      ast = parse(p.source, p.path);
    } catch (e) {
      diagnostics.push({ path: p.path, level: 'error', message: ui(`Datei konnte nicht gelesen werden: ${String(e)}`, `Could not read file: ${String(e)}`), source: 'engine' });
      continue;
    }
    let frontmatter: Record<string, unknown> = {};
    const fm = ast.attributes.frontmatter as string | undefined;
    if (fm) {
      try {
        const v = yaml.load(fm);
        if (v && typeof v === 'object' && !Array.isArray(v)) frontmatter = v as Record<string, unknown>;
      } catch (e: any) {
        diagnostics.push({
          path: p.path,
          line: (e?.mark?.line ?? 0) + 2,
          level: 'error',
          message: ui(`Frontmatter (YAML) ist ungültig: ${e?.reason ?? String(e)}`, `Invalid frontmatter (YAML): ${e?.reason ?? String(e)}`),
          source: 'markdoc',
        });
      }
    }
    const ctx: PageContext = { ids: new IdRegistry(), preview, headings: [], lang };
    const variables = {
      ...(input.variables ?? {}),
      page: { path: p.path, slug: p.slug, ...frontmatter },
      markdoc: { frontmatter },
    };
    const config: any = { nodes, tags, functions, partials, variables, __page: ctx };

    let errors: ValidateError[] = [];
    try {
      errors = Markdoc.validate(ast, config);
    } catch (e) {
      diagnostics.push({ path: p.path, level: 'error', message: String(e), source: 'markdoc' });
    }
    for (const err of errors) {
      const start = err.location?.start ?? (err.lines?.length ? { line: err.lines[0] } : undefined);
      diagnostics.push({
        path: p.path,
        line: start ? start.line + 1 : undefined,
        column: (start as any)?.character !== undefined ? (start as any).character + 1 : undefined,
        level: LEVEL[err.error.level] ?? 'warning',
        message: translateMarkdocError(err.error.message),
        source: 'markdoc',
      });
    }

    let tree: RenderableTreeNode;
    try {
      tree = Markdoc.transform(ast, config) as RenderableTreeNode;
    } catch (e) {
      diagnostics.push({ path: p.path, level: 'error', message: ui(`Umwandlung fehlgeschlagen: ${String(e)}`, `Transformation failed: ${String(e)}`), source: 'markdoc' });
      continue;
    }
    collectComponents(tree, usedComponents);
    const h1 = ctx.headings.find((h) => h.level === 1);
    const fallback = p.path.split('/').pop()!.replace(/\.[^.]+$/, '');
    const title = String(frontmatter.title ?? h1?.text ?? humanize(fallback));
    const description = typeof frontmatter.description === 'string' ? frontmatter.description : undefined;
    const body = bodyOf(tree);
    const plain = collapseWs(textOf(body));
    const words = plain ? plain.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
    const lead = description ?? firstParagraph(body);
    const excerpt = lead ? truncate(lead, 170) : undefined;
    parsed.push({ ...p, ast, frontmatter, ctx, tree, title, description, words, excerpt });

    links.addLabel(links.pageLabel(p.slug));
    for (const h of ctx.headings) links.addLabel(links.label(p.slug, h.id));
  }

  const assets = new Set<string>();
  const out: BuildOutput = {
    pages: [],
    diagnostics,
    assets: [],
    usedComponents: [],
    outline: [],
  };

  // ---- Typst ----
  if (input.targets.typst) {
    const lineMap: LineMapEntry[] = [];
    let code = '';
    let gen = 0;
    const append = (s: string, path?: string, line?: number) => {
      if (path && line !== undefined) lineMap.push({ gen, path, line });
      code += s + '\n\n';
      gen += countLines(s) + 1;
    };
    for (const page of parsed) {
      const tctx: TypstCtx & { line?: number } = {
        pagePath: page.path,
        slug: page.slug,
        links,
        components,
        assets,
        warn(message, line) {
          diagnostics.push({ path: page.path, line: line ?? tctx.line, level: 'warning', message, source: 'engine' });
        },
      };
      // Seitenmarke (Sprungziel für Verweise); bewusst ohne Zeilenzuordnung,
      // damit Cursor-Synchronisation auf echte Inhaltsblöcke zielt.
      append(`#metadata((kind: "ts-page", slug: ${tsStr(page.slug)}, title: ${tsStr(page.title)})) <${links.pageLabel(page.slug)}>`);
      const blocks = renderTopLevel(bodyOf(page.tree), tctx, (line) => (tctx.line = line));
      for (const b of blocks) append(b.code, page.path, b.line);
    }
    out.typst = code;
    out.lineMap = lineMap;
  }

  // ---- HTML ----
  const sections: SearchSection[] = [];
  let uid = 0;
  setEmitLines(preview);
  for (const page of parsed) {
    const result: PageOutput = {
      path: page.path,
      slug: page.slug,
      title: page.title,
      description: page.description,
      frontmatter: page.frontmatter,
      headings: page.ctx.headings,
      minutes: Math.max(1, Math.round(page.words / WORDS_PER_MINUTE)),
      excerpt: page.excerpt,
    };
    if (input.targets.html) {
      const hctx: HtmlCtx = {
        pagePath: page.path,
        slug: page.slug,
        links,
        components,
        host,
        assets,
        lang,
        uid: () => `ts-${page.slug}-${++uid}`,
        warn(message, line) {
          diagnostics.push({ path: page.path, line, level: 'warning', message, source: 'engine' });
        },
      };
      result.html = renderHtml(bodyOf(page.tree), hctx);
      sections.push(...sectionsOf(bodyOf(page.tree), { slug: page.slug, title: page.title }));
    }
    out.pages.push(result);
    out.outline.push({ page: page.path, slug: page.slug, title: page.title, headings: page.ctx.headings });
  }

  if (input.targets.html) {
    out.searchIndex = buildSearchIndex(sections);
    if (input.site) {
      const nav = normalizeNav(input.nav, parsed, links, lang);
      const shellPages = new Map<string, ShellPage>();
      for (const p of out.pages) {
        shellPages.set(p.slug, {
          slug: p.slug,
          title: p.title,
          description: p.description,
          headings: p.headings,
          html: p.html ?? '',
          path: p.path,
          minutes: p.minutes,
          excerpt: p.excerpt,
        });
      }
      const order = nav.flatMap((s) => s.pages);
      const sectionOf = new Map<string, string | undefined>();
      for (const s of nav) for (const slug of s.pages) sectionOf.set(slug, s.title);
      // Startseite mit Titelbereich und Kapitelübersicht
      let home: string | undefined;
      if (landing) {
        home = HOME_SLUG;
        shellPages.set(home, { slug: home, title: input.site.title, headings: [], html: '', path: '', synthetic: true });
        out.pages.push({ path: '', slug: home, title: input.site.title, frontmatter: {}, headings: [], html: '' });
      }
      const shellCtx = { site: input.site, nav, pages: shellPages, order, sectionOf, home, lang };
      for (const p of out.pages) {
        p.document = renderShell(shellPages.get(p.slug)!, shellCtx);
      }
    }
  }

  out.assets = [...assets];
  out.usedComponents = [...usedComponents];
  return out;
}

function normalizeNav(nav: NavSection[] | undefined, pages: ParsedPage[], links: LinkResolver, lang: Lang): NavSection[] {
  const known = new Set(pages.map((p) => p.slug));
  const used = new Set<string>();
  const result: NavSection[] = [];
  for (const sec of nav ?? []) {
    const slugs: string[] = [];
    for (const ref of sec.pages) {
      const slug = links.slugFor(ref) ?? links.slugFor(`content/${ref}`) ?? (known.has(ref) ? ref : undefined);
      if (slug && known.has(slug) && !used.has(slug)) {
        slugs.push(slug);
        used.add(slug);
      }
    }
    if (slugs.length) result.push({ title: sec.title, pages: slugs });
  }
  const rest = pages.map((p) => p.slug).filter((s) => !used.has(s));
  if (rest.length) {
    if (result.length) result.push({ title: lang === 'de' ? 'Weitere Seiten' : 'More pages', pages: rest });
    else result.push({ pages: rest });
  }
  return result;
}

function collectComponents(node: RenderableTreeNode, set: Set<string>) {
  if (Array.isArray(node)) return node.forEach((n) => collectComponents(n, set));
  if (!isTag(node)) return;
  if (node.name.startsWith('ts:') && node.name !== 'ts:fence') set.add(node.name.slice(3));
  for (const c of node.children) collectComponents(c, set);
}

function countLines(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function humanize(s: string): string {
  const t = s.replace(/^\d+[-_.\s]*/, '').replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : s;
}

/** Meldungen von Markdoc in der Sprache der Oberfläche. */
const MARKDOC_ERRORS: [RegExp, string, string][] = [
  [/^Undefined variable: '(.+)'$/, 'Unbekannte Variable: $$$1', 'Unknown variable: $$$1'],
  [/^Undefined tag: '(.+)'$/, 'Unbekanntes Element: `$1`', 'Unknown element: `$1`'],
  [/^Invalid attribute: '(.+)'$/, 'Ungültiges Attribut: `$1`', 'Invalid attribute: `$1`'],
  [/^Missing required attribute: '(.+)'$/, 'Pflichtattribut fehlt: `$1`', 'Missing required attribute: `$1`'],
  [/^Node '(.+)' is missing closing$/, 'Element `$1` wird nicht geschlossen', 'Element `$1` is not closed'],
  [/^Can't nest '(.+)' in '(.+)'$/, '`$1` darf nicht in `$2` stehen', '`$1` cannot be placed inside `$2`'],
  [
    /^Attribute '(.+)' must match one of (.+)\. Got '(.+)' instead\.$/,
    'Attribut `$1` muss einer der Werte $2 sein (erhalten: „$3“).',
    'Attribute `$1` must be one of $2 (got “$3”).',
  ],
  [/^Attribute '(.+)' must be type of '(.+)'$/, 'Attribut `$1` muss vom Typ $2 sein', 'Attribute `$1` must be of type $2'],
  // Platzierung: Inline-Elemente in eigener Zeile werden vorher in den Textfluss
  // geholt (placeInlineTags); übrig bleiben echte Fehlplatzierungen.
  [
    /^'(.+)' tag should be block$/,
    '`$1` ist ein Block-Element und kann nicht im Fließtext stehen. Schreibe es in eine eigene Zeile mit Leerzeilen davor und danach.',
    '`$1` is a block element and cannot be used within running text. Put it on its own line with blank lines before and after.',
  ],
  [
    /^'(.+)' tag should be inline$/,
    '`$1` ist ein Inline-Element und kann nur Text enthalten, keine Listen, Tabellen oder anderen Blöcke.',
    '`$1` is an inline element and can only contain text, not lists, tables or other blocks.',
  ],
];

function translateMarkdocError(msg: string): string {
  for (const [re, de, en] of MARKDOC_ERRORS) {
    if (re.test(msg)) return msg.replace(re, ui(de, en));
  }
  return msg;
}

export function _textForTests(n: RenderableTreeNode) {
  return collapseWs(textOf(n));
}
