import Markdoc from '@markdoc/markdoc';
import { buildDocument } from './build';
import type { BuildInput } from './types';
import { initUiLang, ui } from './i18n';

export { buildDocument };
export type * from './types';

/** JSON-Schnittstelle für den Rust-Host (QuickJS). */
export function buildJson(input: string): string {
  try {
    return JSON.stringify(buildDocument(JSON.parse(input) as BuildInput));
  } catch (e: any) {
    initUiLang((globalThis as any).__host);
    return JSON.stringify({
      pages: [],
      assets: [],
      usedComponents: [],
      outline: [],
      diagnostics: [
        { path: '', level: 'error', message: ui(`Interner Fehler der Markdoc-Engine: ${e?.stack ?? String(e)}`, `Internal error in the Markdoc engine: ${e?.stack ?? String(e)}`), source: 'engine' },
      ],
    });
  }
}

/** Formatiert Markdoc-Quelltext (für die Editor-Funktion „Dokument formatieren“). */
export function formatJson(source: string): string {
  try {
    const ast = Markdoc.parse(source);
    return JSON.stringify({ ok: true, text: Markdoc.format(ast) });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}

export const version = '0.1.0';
