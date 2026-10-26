import { locale, t } from './i18n';

const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
const dtf = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' });
const nf = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** „vor 5 Minuten“, „gestern“ … */
export function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return t('gerade eben');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return df.format(new Date(ms));
}

export function dateTime(ms: number): string {
  return dtf.format(new Date(ms));
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${nf.format(bytes / 1024)} KB`;
  return `${nf.format(bytes / 1024 / 1024)} MB`;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : t('Strg');

export function shortcut(keys: string): string {
  return keys
    .replace(/Mod/g, modKey)
    .replace(/Shift/g, isMac ? '⇧' : t('Umschalt'))
    .replace(/Alt/g, isMac ? '⌥' : 'Alt');
}

/** Projektdatei eines Dokuments (ältere Dokumente: typeset.toml). */
export function isManifest(path: string): boolean {
  return path === 'sqritto.toml' || path === 'typeset.toml';
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i + 1).toLowerCase();
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || t('seite')
  );
}
