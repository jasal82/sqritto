// Englische Texte: Dokumenteinstellungen (pages/editor/DocSettingsDialog.tsx).
export default {
  // Layout-Vorlagen
  'Technische Dokumentation': 'Technical documentation',
  'Titelseite, Inhaltsverzeichnis, Kapitel': 'Cover page, table of contents, chapters',
  'Architektur (arc42)': 'Architecture (arc42)',
  'Architekturdokumentation nach arc42': 'Architecture documentation based on arc42',
  Bericht: 'Report',
  'Redaktionelles Layout mit Serifenschrift': 'Editorial layout with a serif font',
  Schlicht: 'Plain',
  'Minimales Grundlayout': 'Minimal base layout',

  // PDF-Standards
  'Standard (getaggtes PDF 1.7)': 'Default (tagged PDF 1.7)',
  'PDF/A-2b (Langzeitarchivierung)': 'PDF/A-2b (long-term archiving)',
  'PDF/A-3b (Archiv mit Anhängen)': 'PDF/A-3b (archive with attachments)',
  'PDF/UA-1 (barrierefrei)': 'PDF/UA-1 (accessible)',

  // Dokumentsprachen
  Deutsch: 'German',
  Englisch: 'English',
  Französisch: 'French',
  Spanisch: 'Spanish',
  Italienisch: 'Italian',
  Niederländisch: 'Dutch',

  // Dialog
  'Einstellungen gespeichert': 'Settings saved',
  Allgemein: 'General',
  Variablen: 'Variables',
  'Gespeichert in sqritto.toml im Dokumentordner.': 'Stored in sqritto.toml in the document folder.',

  // Allgemein
  Titel: 'Title',
  Untertitel: 'Subtitle',
  'Autorinnen und Autoren': 'Authors',
  'Mehrere durch Komma trennen': 'Separate multiple names with commas',
  Version: 'Version',
  'z. B. 1.0': 'e.g. 1.0',
  Datum: 'Date',
  'leer = heutiges Datum': 'empty = today’s date',
  Sprache: 'Language',
  'Steuert Silbentrennung und Anführungszeichen.': 'Controls hyphenation and quotation marks.',
  Dokumenttyp: 'Document type',
  'Markdoc → PDF und HTML5': 'Markdoc → PDF and HTML5',
  Beschreibung: 'Description',
  'PDF erzeugen': 'Generate PDF',
  'Übersetzung mit Typst in ein druckfertiges PDF.': 'Compiled with Typst into a print-ready PDF.',
  'HTML5 erzeugen': 'Generate HTML5',
  'Statische Website mit Suche und Navigation.': 'Static website with search and navigation.',

  // PDF
  'Layout-Vorlage': 'Layout template',
  'Eigene Typst-Vorlage aus dem Dokument…': 'Custom Typst template from the document…',
  'theme/template.typ oder @preview/paket:1.0.0': 'theme/template.typ or @preview/package:1.0.0',
  'Eigene Vorlagen exportieren eine Funktion `ts-document(title, …, body)` und können die Elemente überschreiben.':
    'Custom templates export a function `ts-document(title, …, body)` and can override the elements.',
  Hauptdatei: 'Main file',
  'PDF-Standard': 'PDF standard',
  Titelseite: 'Cover page',
  Inhaltsverzeichnis: 'Table of contents',
  'Nummerierte Überschriften': 'Numbered headings',
  'Jedes Kapitel auf neuer Seite': 'Start each chapter on a new page',
  Serifenschrift: 'Serif font',
  Akzentfarbe: 'Accent color',
  Papierformat: 'Paper size',
  Logo: 'Logo',
  'Kein Logo': 'No logo',
  Organisation: 'Organization',
  Klassifizierung: 'Classification',
  'z. B. Intern': 'e.g. Internal',
  Dokumentart: 'Document category',
  'z. B. Handbuch': 'e.g. Manual',
  System: 'System',
  Status: 'Status',
  'z. B. Entwurf': 'e.g. Draft',
  Zusammenfassung: 'Abstract',

  // HTML5
  'PDF beilegen': 'Include PDF',
  'Das PDF liegt im Paket und ist über die Kopfzeile erreichbar.': 'The PDF is included in the package and linked from the header.',
  'Startseite mit Kapitelübersicht': 'Home page with chapter overview',
  'Titelbereich mit Lesedauer und Direktlinks zu allen Kapiteln; die Seite index wird dazu als Einleitung verwendet.':
    'Title area with reading time and direct links to all chapters; the index page serves as the introduction.',
  Standard: 'Default',
  Fußzeile: 'Footer',
  '© 2026 Firma GmbH': '© 2026 Company Inc.',
  'Link zum Repository': 'Repository link',

  // Variablen
  'Variablen stehen in allen Seiten als `{% $name %}` zur Verfügung, z. B. für Produktnamen oder Versionen.':
    'Variables are available on all pages as `{% $name %}`, e.g. for product names or versions.',
  'Variablen stehen in Typst über `sys.inputs.name` zur Verfügung.': 'In Typst, variables are available via `sys.inputs.name`.',
  Wert: 'Value',
  'Variable entfernen': 'Remove variable',
  'Variable hinzufügen': 'Add variable',
} satisfies Record<string, string>;
