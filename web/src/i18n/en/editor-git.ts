// Englische Texte: Versionen (pages/editor/GitPanel.tsx).
export default {
  // Kürzel und Bezeichnungen des Dateistatus (englisch wie bei git status)
  N: 'A',
  Neu: 'New',
  G: 'M',
  Geändert: 'Modified',
  E: 'D',
  Entfernt: 'Deleted',
  U: 'R',
  Umbenannt: 'Renamed',
  Konflikt: 'Conflict',

  // Panel
  Aktualisieren: 'Refresh',
  Änderungen: 'Changes',
  Verlauf: 'History',
  Synchronisieren: 'Sync',

  // Aktivieren
  'Versionsverwaltung aktiviert': 'Version control enabled',
  'Die erste Version wurde gespeichert.': 'The first version has been saved.',
  'Aktivieren fehlgeschlagen': 'Enabling failed',
  'Versionen sind noch nicht aktiviert': 'Versions are not enabled yet',
  'Mit der Versionsverwaltung speicherst du Zwischenstände deines Dokuments, vergleichst Änderungen und kannst jederzeit zu einer früheren Fassung zurückkehren. Technisch ist das ein Git-Repository im Dokumentordner.':
    'With version control, you save snapshots of your document, compare changes and can return to an earlier version at any time. Under the hood, it’s a Git repository in the document folder.',
  Name: 'Name',
  'E-Mail': 'Email',
  'name@beispiel.de': 'name@example.com',
  'Versionsverwaltung aktivieren': 'Enable version control',
  'Für die Synchronisation mit GitHub & Co. wird zusätzlich Git benötigt.': 'Syncing with GitHub and similar services also requires Git.',

  // Zweige
  'Zweig „{name}“ aktiv': 'Switched to branch “{name}”',
  'Wechsel nicht möglich': 'Could not switch branch',
  'Neuer Zweig': 'New branch',
  'Ein Zweig ist eine eigene Entwicklungslinie, z. B. für eine Überarbeitung.': 'A branch is a separate line of development, e.g. for a revision.',
  'ueberarbeitung-kapitel-3': 'revise-chapter-3',
  'Erstellen und wechseln': 'Create and switch',
  'Nur Buchstaben, Ziffern, -, _, / und .': 'Only letters, digits, -, _, / and .',
  'Zweig „{name}“ erstellt': 'Branch “{name}” created',
  'Zweig konnte nicht erstellt werden': 'Could not create branch',
  Zweige: 'Branches',
  'Neuer Zweig…': 'New branch…',

  // Änderungen
  'Version gespeichert': 'Version saved',
  'Speichern der Version fehlgeschlagen': 'Saving the version failed',
  'Änderungen an „{name}“ verwerfen?': 'Discard changes to “{name}”?',
  'Die neue Datei wird gelöscht.': 'The new file will be deleted.',
  'Die Datei wird auf den Stand der letzten Version zurückgesetzt.': 'The file will be reset to the last version.',
  Verwerfen: 'Discard',
  'Verwerfen fehlgeschlagen': 'Discarding failed',
  'Alles gespeichert': 'Everything saved',
  'Letzte Version: {summary} · {time}': 'Last version: {summary} · {time}',
  '{path} einbeziehen': 'Include {path}',
  'Änderungen ansehen': 'View changes',
  'Was hat sich geändert? (z. B. „Kapitel Installation überarbeitet“)': 'What changed? (e.g. “Revised installation chapter”)',
  'Version speichern ({n})': 'Save version ({n})',
  'Version speichern': 'Save version',

  // Verlauf
  '„{name}“ wiederherstellen?': 'Restore “{name}”?',
  'Diese Version wiederherstellen?': 'Restore this version?',
  'Die Datei wird auf den Stand von „{summary}“ gesetzt.': 'The file will be reset to the state of “{summary}”.',
  'Alle Dateien werden auf den Stand von „{summary}“ ({date}) gesetzt. Die Wiederherstellung erscheint danach als Änderung, die du als neue Version speichern kannst – es geht nichts verloren.':
    'All files will be reset to the state of “{summary}” ({date}). The restore then shows up as a change that you can save as a new version – nothing gets lost.',
  Wiederherstellen: 'Restore',
  Wiederhergestellt: 'Restored',
  'Speichere eine neue Version, um den Stand festzuhalten.': 'Save a new version to keep this state.',
  'Wiederherstellen fehlgeschlagen': 'Restoring failed',
  'Noch keine Versionen.': 'No versions yet.',
  '(ohne Beschreibung)': '(no description)',
  'Nur diese Datei wiederherstellen': 'Restore only this file',
  'Diese Version wiederherstellen': 'Restore this version',

  // Synchronisieren
  'Fertig.': 'Done.',
  Hochgeladen: 'Uploaded',
  Aktualisiert: 'Updated',
  Abgerufen: 'Checked for changes',
  'Synchronisation fehlgeschlagen': 'Sync failed',
  'Entferntes Repository gespeichert': 'Remote repository saved',
  'Entferntes Repository entfernt': 'Remote repository removed',
  'Für Hoch- und Herunterladen wird Git benötigt. Lokale Versionen funktionieren auch ohne.':
    'Uploading and downloading require Git. Local versions work without it.',
  'Entferntes Repository (origin)': 'Remote repository (origin)',
  'https://github.com/team/handbuch.git': 'https://github.com/team/handbook.git',
  'Anmeldung erfolgt über die Git-Anmeldedaten dieses Rechners.': 'Sign-in uses this computer’s Git credentials.',
  'Auf dem gleichen Stand wie {upstream}': 'Up to date with {upstream}',
  '1 Version zum Hochladen, {behind} zum Herunterladen': '1 version to upload, {behind} to download',
  '{ahead} Versionen zum Hochladen, {behind} zum Herunterladen': '{ahead} versions to upload, {behind} to download',
  'Noch nicht verbunden – zuerst hochladen.': 'Not connected yet – upload first.',
  Herunterladen: 'Download',
  Hochladen: 'Upload',
  'Auf Änderungen prüfen': 'Check for changes',
  'Versionen werden gespeichert als {name} <{email}>.': 'Versions are saved as {name} <{email}>.',

  // Vergleich
  'Änderungen in Version {commit} · {path}': 'Changes in version {commit} · {path}',
  'Ungespeicherte Änderungen seit der letzten Version · {path}': 'Unsaved changes since the last version · {path}',
  Vorher: 'Before',
  Nachher: 'After',
} satisfies Record<string, string>;
