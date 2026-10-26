// Sprachen der Engine.
//
// Zwei Sprachen sind zu unterscheiden:
// – Dokumentsprache (`lang` in sqritto.toml, als `site.lang` bzw.
//   `variables.document.lang` übergeben): alles, was im erzeugten Dokument
//   landet (Seitenrahmen, Beschriftungen in Elementen). Deutsch für `de`,
//   jede andere Sprache erhält englische Beschriftungen.
// – Sprache der Oberfläche (`__host.uiLang()`): Meldungen der Engine an die
//   Problemliste der App. Ohne Host (Tests) Deutsch.

export type Lang = 'de' | 'en';

/** Sprache der Beschriftungen zu einer Dokumentsprache (ohne Angabe Deutsch). */
export function labelLang(lang: string | undefined | null): Lang {
  const l = String(lang ?? '').trim().toLowerCase();
  if (!l) return 'de';
  return l === 'de' || l.startsWith('de-') || l.startsWith('de_') ? 'de' : 'en';
}

let UI: Lang = 'de';

/** Übernimmt die Sprache der Oberfläche vom Host (`__host.uiLang()`). */
export function initUiLang(host: { uiLang?: () => unknown } | undefined) {
  let v: unknown;
  try {
    v = host?.uiLang?.();
  } catch {
    v = undefined;
  }
  UI = v === 'en' ? 'en' : 'de';
}

export function uiLang(): Lang {
  return UI;
}

/** Meldung in der Sprache der Oberfläche: `ui('Datei fehlt', 'File is missing')`. */
export function ui(de: string, en: string): string {
  return UI === 'en' ? en : de;
}

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Datum in der Schreibweise der Dokumentsprache: „26.10.2026“ bzw. „October 26, 2026“. */
export function formatDateParts(year: number, month: number, day: number, lang: Lang): string {
  if (lang === 'en') return `${MONTHS_EN[month - 1]} ${day}, ${year}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(day)}.${pad(month)}.${year}`;
}

/**
 * Bringt ein Datum (ISO `2026-10-26` oder deutsch `26.10.2026`) in die
 * Schreibweise der Dokumentsprache. Andere Angaben bleiben unverändert.
 */
export function formatDate(raw: string, lang: Lang): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return raw;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return raw;
  return formatDateParts(y, mo, d, lang);
}
