export type DocKind = 'markdoc' | 'typst';

export interface AppInfo {
  name: string;
  version: string;
  typst: string;
  mode: 'local' | 'server';
  workspace: string;
  gitCli: boolean;
  gitIdentity: [string, string] | null;
  author: string;
  platform: string;
  /** Sprache der Oberfläche (aus Einstellung oder Systemsprache). */
  language: 'de' | 'en';
}

export interface DocSummary {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  kind: DocKind;
  template?: string | null;
  authors: string[];
  path: string;
  folder: string;
  modified: number;
  created?: string | null;
  git: boolean;
  outputs: string[];
  thumbnail?: string | null;
  external: boolean;
  error?: string | null;
}

export interface NavSection {
  title?: string | null;
  pages: string[];
}

export interface Manifest {
  document: {
    title: string;
    subtitle?: string | null;
    kind: DocKind;
    template?: string | null;
    authors: string[];
    lang: string;
    version?: string | null;
    description?: string | null;
    date?: string | null;
    created?: string | null;
  };
  markdoc: { content: string; nav: NavSection[] };
  typst: { entry: string };
  variables: Record<string, unknown>;
  pdf: {
    enabled: boolean;
    template: string;
    options: Record<string, unknown>;
    standard?: string | null;
    filename?: string | null;
  };
  html: {
    enabled: boolean;
    accent?: string | null;
    logo?: string | null;
    footer?: string | null;
    repo?: string | null;
    include_pdf: boolean;
    filename?: string | null;
    /** Startseite mit Titelbereich und Kapitelübersicht. */
    landing?: boolean;
  };
}

export interface Heading {
  level: number;
  id: string;
  text: string;
  line?: number | null;
}

export interface OutlineEntry {
  path: string;
  slug: string;
  title: string;
  headings: Heading[];
}

export interface Diagnostic {
  path: string;
  line?: number | null;
  column?: number | null;
  endLine?: number | null;
  endColumn?: number | null;
  severity: 'error' | 'warning' | 'info';
  message: string;
  hints: string[];
  source: 'typst' | 'markdoc' | 'engine';
}

export interface PageMeta {
  width: number;
  height: number;
  hash: string;
}

export interface CompileResult {
  ok: boolean;
  kind: DocKind;
  version: number;
  durationMs: number;
  diagnostics: Diagnostic[];
  pages: PageMeta[];
  outline: OutlineEntry[];
  html: boolean;
}

export interface DocDetail {
  summary: DocSummary;
  manifest: Manifest | null;
  last: CompileResult | null;
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size: number;
  children?: FileNode[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: DocKind;
  outputs: string[];
  order: number;
  source: 'builtin' | 'user';
}

export interface UniverseTemplate {
  name: string;
  version: string;
  description: string;
  authors: string[];
  categories: string[];
  keywords: string[];
  updated: number;
}

export interface ComponentAttribute {
  type?: 'String' | 'Number' | 'Boolean' | 'Array' | 'Object';
  default?: unknown;
  required?: boolean;
  matches?: unknown[];
  description?: string;
  asset?: boolean;
  link?: boolean;
}

export interface ComponentDef {
  name: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  inline?: boolean | null;
  selfClosing?: boolean | null;
  attributes: Record<string, ComponentAttribute>;
  parents?: string[] | null;
  snippet?: string | null;
  /** Beispiel (Markdoc) für die Vorschau in der Element-Ansicht. */
  example?: string | null;
  typst?: string | null;
  pdf?: boolean | null;
  collect?: string | null;
  source: 'builtin' | 'local';
  typPath?: string | null;
}

/** Vorschau eines Elements (HTML-Seite und zugeschnittene PDF-Ausschnitte). */
export interface ElementPreview {
  html: string | null;
  pdf: { svg?: string; png?: string; width: number; height: number }[] | null;
  diagnostics: Diagnostic[];
  durationMs: number;
}

export interface ElementPreviewRequest {
  source: string;
  definition?: unknown;
  html?: string;
  typ?: string;
  css?: string;
  js?: string;
  targets?: ('html' | 'pdf')[];
  /** Bildpunkte je pt für PNG-Ausschnitte (sonst SVG). */
  pdfScale?: number;
}

export interface CommitInfo {
  id: string;
  short: string;
  summary: string;
  body: string;
  author: string;
  email: string;
  time: number;
  parents: string[];
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted';
  staged: boolean;
  oldPath?: string | null;
}

export interface RepoStatus {
  initialized: boolean;
  branch?: string | null;
  head?: CommitInfo | null;
  changes: FileChange[];
  remote?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  cliAvailable: boolean;
  identity?: [string, string] | null;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream?: string | null;
  lastCommit?: number | null;
}

export interface CommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  language: 'system' | 'de' | 'en';
  editorFontSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  gitByDefault: boolean;
  previewDelay: number;
  syncScroll: boolean;
  libraryView: 'grid' | 'list';
  librarySort: 'modified' | 'name' | 'created';
}

export interface JumpTarget {
  kind: 'file' | 'url' | 'position';
  path?: string;
  line?: number;
  column?: number;
  url?: string;
  page?: number;
  x?: number;
  y?: number;
}
