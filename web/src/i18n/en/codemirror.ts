// Englische Texte: CodeMirror-Erweiterungen (editor/*): Vervollständigung und
// Platzhalter in eingefügten Snippets.
export default {
  // markdoc.ts
  bedingung: 'condition',
  Bedingung: 'Condition',
  'Alternative in if': 'Alternative in if',
  datei: 'file',
  'Baustein einbinden': 'Include partial',
  'Spalte {n}': 'Column {n}',
  Wert: 'Value',
  'Tabelle (Listenform)': 'Table (list form)',
  Variable: 'Variable',
  '{type} · Pflicht': '{type} · required',
  Datei: 'File',

  // mustache.ts
  'Inhalt des Elements (bereits HTML)': 'Content of the element (already HTML)',
  'Inhalt als reiner Text': 'Content as plain text',
  'Eindeutige ID, z. B. für aria-controls': 'Unique ID, e.g. for aria-controls',
  'Wahr, wenn das Element Inhalt hat': 'True if the element has content',
  Attribut: 'Attribute',

  // commands.ts
  Text: 'Text',
  Zitat: 'Quote',
  Linktext: 'Link text',
  sprache: 'language',
  Beschreibung: 'Description',
  Bildunterschrift: 'Caption',
} satisfies Record<string, string>;
