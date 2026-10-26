// Gemeinsame Typen der Sqritto-Engine. Die Engine läuft eingebettet in
// QuickJS (Rust-Backend) und tauscht Daten ausschließlich als JSON aus.

export type AttrType = 'String' | 'Number' | 'Boolean' | 'Array' | 'Object';

export interface ComponentAttribute {
  type?: AttrType;
  default?: unknown;
  required?: boolean;
  matches?: unknown[];
  description?: string;
  /** Pfad zu einer Datei im Dokument (Bild, Anhang); wird aufgelöst. */
  asset?: boolean;
  /** Verweisziel (Seite, Anker, URL); wird wie ein Link aufgelöst. */
  link?: boolean;
}

/** Definition eines Markdoc-Elements mit HTML- und Typst-Vorlage. */
export interface ComponentDef {
  name: string;
  title?: string;
  description?: string;
  /** Inline-Element (z. B. Badge, Tastenkürzel) statt Block. */
  inline?: boolean;
  selfClosing?: boolean;
  attributes?: Record<string, ComponentAttribute>;
  /** Erlaubte Eltern-Tags (z. B. `tab` nur in `tabs`). */
  parents?: string[];
  /** Mustache-ähnliche HTML-Vorlage. */
  html: string;
  /** Name der Typst-Funktion, Standard: `ts-<name>`. */
  typst?: string;
  /** Wird die Komponente in der PDF-Ausgabe ausgelassen? */
  pdf?: boolean;
  /** Snippet für den Editor. */
  snippet?: string;
  /** Beispiel (Markdoc) für die Vorschau in der Element-Ansicht. */
  example?: string;
  category?: string;
  /**
   * Kind-Elemente dieses Typs werden in Typst als einzelne Positionsargumente
   * übergeben (z. B. `cards` sammelt `card`).
   */
  collect?: string;
}

export interface PageInput {
  /** Pfad relativ zum Dokumentordner, z. B. `content/index.mdoc`. */
  path: string;
  source: string;
}

export interface NavSection {
  title?: string;
  pages: string[];
}

export interface SiteOptions {
  title: string;
  subtitle?: string;
  lang: string;
  logo?: string;
  accent?: string;
  /** Pfad-Präfix für statische Dateien, z. B. `_static/`. */
  staticBase: string;
  /** Zusätzliche CSS-Dateien (relativ zur Site-Wurzel). */
  extraCss: string[];
  extraJs: string[];
  /** Vorschau-Modus: Live-Reload-Skript einbinden. */
  preview: boolean;
  footer?: string;
  generator?: string;
  repoUrl?: string;
  version?: string;
  pdfDownload?: string;
  /** Startseite mit Titelbereich und Kapitelübersicht (Standard: an). */
  landing?: boolean;
  /** Beschreibung des Dokuments (Startseite, Metadaten). */
  description?: string;
  authors?: string[];
  /** Stand des Dokuments (Text, z. B. „26.10.2026“). */
  date?: string;
}

export interface BuildInput {
  pages: PageInput[];
  partials?: Record<string, string>;
  components?: ComponentDef[];
  variables?: Record<string, unknown>;
  nav?: NavSection[];
  targets: { typst?: boolean; html?: boolean };
  /** Vorschau: `data-line`-Attribute für Scroll-Synchronisation ausgeben. */
  preview?: boolean;
  site?: SiteOptions;
}

export interface Heading {
  level: number;
  id: string;
  text: string;
  line?: number;
}

export interface SearchSection {
  id: string;
  page: string;
  anchor: string;
  pageTitle: string;
  heading: string;
  text: string;
}

export interface PageOutput {
  path: string;
  slug: string;
  title: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  headings: Heading[];
  /** Inhalt als HTML-Fragment. */
  html?: string;
  /** Vollständiges HTML-Dokument mit Navigation, TOC und Suche. */
  document?: string;
  /** Geschätzte Lesezeit in Minuten. */
  minutes?: number;
  /** Kurzbeschreibung (Frontmatter `description` oder erster Absatz). */
  excerpt?: string;
}

export type DiagnosticLevel = 'error' | 'warning' | 'info';

export interface Diagnostic {
  path: string;
  line?: number;
  column?: number;
  level: DiagnosticLevel;
  message: string;
  source: 'markdoc' | 'typst' | 'engine';
}

/** Zuordnung generierter Typst-Zeilen zu Markdoc-Quellzeilen. */
export interface LineMapEntry {
  /** 0-basierte Zeile im generierten Typst-Körper. */
  gen: number;
  path: string;
  /** 1-basierte Zeile in der Markdoc-Quelle. */
  line: number;
}

export interface BuildOutput {
  typst?: string;
  lineMap?: LineMapEntry[];
  pages: PageOutput[];
  searchIndex?: string;
  diagnostics: Diagnostic[];
  assets: string[];
  usedComponents: string[];
  outline: OutlineItem[];
}

export interface OutlineItem {
  page: string;
  slug: string;
  title: string;
  headings: Heading[];
}
