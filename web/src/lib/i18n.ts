// Sprache der Oberfläche: Deutsch oder Englisch.
//
// Texte stehen im Code auf Deutsch und werden mit `t()` übersetzt:
//   t('Speichern')                       → „Save“
//   t('{n} Dateien geändert', { n: 3 })  → „3 files changed“
// Die englischen Texte liegen in `src/i18n/en/*.ts` (Schlüssel = deutscher
// Text, je Bereich eine Datei). Fehlt eine Übersetzung, erscheint der deutsche
// Text und im Entwicklungsmodus eine Warnung in der Konsole.
//
// Die Sprache steht beim Laden dieses Moduls fest (zuletzt verwendete Sprache
// oder Browsersprache), also auch für Konstanten auf Modulebene. Der Server
// meldet die tatsächliche Sprache (Einstellung oder Systemsprache); weicht sie
// ab, lädt die App neu (siehe `useApp.load`).

export type Lang = 'de' | 'en';

const STORAGE_KEY = 'sqritto-lang';

const modules = import.meta.glob<{ default: Record<string, string> }>('../i18n/en/*.ts', { eager: true });
const EN: Record<string, string> = Object.assign({}, ...Object.values(modules).map((m) => m.default));

let current: Lang = initialLang();
document.documentElement.lang = current;

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    /* kein Speicher verfügbar */
  }
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Aktuelle Sprache der Oberfläche. */
export function lang(): Lang {
  return current;
}

/**
 * Übernimmt die vom Server gemeldete Sprache und merkt sie sich für den
 * nächsten Start. Liefert `true`, wenn sie von der geladenen abweicht.
 */
export function adoptLang(next: Lang): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignorieren */
  }
  return next !== current;
}

const missing = new Set<string>();

/** Übersetzt einen deutschen Text; `{name}`-Platzhalter werden ersetzt. */
export function t(de: string, params?: Record<string, string | number>): string {
  let text = de;
  if (current === 'en') {
    const en = EN[de];
    if (en !== undefined) text = en;
    else if (import.meta.env.DEV && !missing.has(de)) {
      missing.add(de);
      console.warn('[i18n] Übersetzung fehlt:', de);
    }
  }
  return params ? text.replace(/\{(\w+)\}/g, (m, key: string) => (key in params ? String(params[key]) : m)) : text;
}

/** Locale für Datums- und Zahlenformate (`toLocaleString`, `Intl`). */
export function locale(): string {
  if (current === 'de') return 'de-DE';
  return navigator.language.toLowerCase().startsWith('en') ? navigator.language : 'en-US';
}
