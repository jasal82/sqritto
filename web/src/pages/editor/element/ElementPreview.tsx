// Live-Vorschau eines Elements: Beispiel (Markdoc) als HTML und als PDF-Ausschnitt.

import { AlertCircle, AlertTriangle, ChevronRight, Info, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { useDevicePixelRatio } from '../../../lib/dpr';
import { t } from '../../../lib/i18n';
import { useApp } from '../../../lib/store';
import type { Diagnostic, ElementPreview as PreviewResult, ElementPreviewRequest } from '../../../lib/types';
import { IconButton, Segmented } from '../../../ui';
import { elementDir, getText, languageFor, openElement, reveal, setFileText, setPreviewDiagnostics, useEditor } from '../store';
import { MiniEditor } from './MiniEditor';
import { exampleOf, sectionInfo, type ElementJson } from './util';

type Mode = 'html' | 'pdf';

function readDefinition(name: string): ElementJson | null {
  try {
    const v = JSON.parse(getText(`${elementDir(name)}/component.json`) ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ElementJson) : null;
  } catch {
    return null;
  }
}

export function ElementPreview({ name, section }: { name: string; section: string }) {
  const id = useEditor((s) => s.id);
  const tick = useEditor((s) => s.editTick);
  const manifest = useEditor((s) => s.manifest);
  const [mode, setMode] = useState<Mode>(() => (manifest?.pdf.enabled === false ? 'html' : 'pdf'));
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(true);
  const seq = useRef(0);
  const body = useRef<HTMLDivElement>(null);
  const [bodyW, setBodyW] = useState(420);
  const dpr = useDevicePixelRatio();

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth));
    ro.observe(el);
    setBodyW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // PDF-Ausschnitt als PNG in Bildschirmauflösung: CSS-Pixel je pt passend
  // zur Breite der Vorschau (höchstens 160 %), gerastert auf 1/16.
  const cropW = result?.pdf?.[0]?.width ?? 470;
  const cssPerPt = Math.min(Math.max(bodyW - 36, 120) / cropW, 1.6);
  const pdfScale = Math.round(cssPerPt * dpr * 16) / 16;

  // Passende Vorschau zum gewählten Bereich
  useEffect(() => {
    const p = sectionInfo(section)?.preview;
    if (p) setMode(p);
  }, [section]);

  const def = readDefinition(name);
  const example = def ? exampleOf(name, def) : '';
  const hasOwnExample = typeof def?.example === 'string';

  const setExample = (v: string | undefined) => {
    const cur = readDefinition(name);
    if (!cur) return;
    const next = { ...cur };
    if (v === undefined) delete next.example;
    else next.example = v;
    setFileText(`${elementDir(name)}/component.json`, `${JSON.stringify(next, null, 2)}\n`);
  };

  // Vorschau nach kurzer Pause neu erzeugen (mit ungespeicherten Inhalten)
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const n = ++seq.current;
      const dir = elementDir(name);
      const req: ElementPreviewRequest = { source: example, targets: [mode], ...(mode === 'pdf' ? { pdfScale } : {}) };
      const d = readDefinition(name);
      if (d) req.definition = d;
      const html = getText(`${dir}/template.html`);
      const typ = getText(`${dir}/template.typ`);
      const css = getText(`${dir}/style.css`);
      const js = getText(`${dir}/script.js`);
      if (html !== undefined) req.html = html;
      if (typ !== undefined) req.typ = typ;
      if (css !== undefined) req.css = css;
      if (js !== undefined) req.js = js;
      setBusy(true);
      try {
        const r = await api.elementPreview(id, name, req);
        if (n !== seq.current) return;
        setResult(r);
        setError(null);
        // Fehler auch direkt im Code-Editor anzeigen
        setPreviewDiagnostics(`${dir}/`, r.diagnostics);
      } catch (e) {
        if (n !== seq.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (n === seq.current) setBusy(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, name, mode, tick, example, mode === 'pdf' ? pdfScale : 0]);

  useEffect(() => () => setPreviewDiagnostics(`${elementDir(name)}/`, []), [name]);

  const markdoc = useMemo(() => languageFor('content/__element__.mdoc'), []);
  const diagnostics = result?.diagnostics ?? [];

  return (
    <div className="el-preview">
      <div className="el-preview__bar">
        <strong>{t('Vorschau')}</strong>
        <Segmented
          label={t('Ausgabe')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'html', label: 'HTML' },
            { value: 'pdf', label: 'PDF' },
          ]}
        />
        <span className="spacer" />
        <span className="el-preview__status" aria-live="polite">
          {busy ? <span className="spinner" aria-label={t('Wird erzeugt')} /> : result ? `${result.durationMs} ms` : ''}
        </span>
      </div>

      <div className={`el-example${exampleOpen ? ' is-open' : ''}`}>
        <div className="el-example__head">
          <button type="button" className="el-example__toggle" aria-expanded={exampleOpen} onClick={() => setExampleOpen(!exampleOpen)}>
            <ChevronRight />
            {t('Beispiel')}
          </button>
          {!hasOwnExample && <span className="el-example__note">{t('aus der Einfüge-Vorlage')}</span>}
          <span className="spacer" />
          {hasOwnExample && (
            <IconButton label={t('Beispiel aus der Einfüge-Vorlage übernehmen')} icon={<RotateCcw />} onClick={() => setExample(undefined)} />
          )}
        </div>
        {exampleOpen && def && (
          <MiniEditor label={t('Beispiel für die Vorschau')} value={example} onChange={(v) => setExample(v)} extensions={markdoc} minLines={3} />
        )}
      </div>

      <div className="el-preview__body" ref={body}>
        {error ? (
          <div className="el-banner el-banner--error">{error}</div>
        ) : mode === 'html' ? (
          <HtmlFrame html={result?.html ?? null} />
        ) : (
          <PdfView pages={result?.pdf ?? null} skipped={def?.pdf === false} dpr={dpr} />
        )}
      </div>

      {diagnostics.length > 0 && <DiagnosticList name={name} items={diagnostics} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML: zwei iframes im Wechsel, damit beim Aktualisieren nichts flackert
// ---------------------------------------------------------------------------

function HtmlFrame({ html }: { html: string | null }) {
  const a = useRef<HTMLIFrameElement>(null);
  const b = useRef<HTMLIFrameElement>(null);
  const front = useRef(0);
  const [shown, setShown] = useState<number | null>(null);
  const theme = useApp((s) => s.settings.theme);

  const applyTheme = (frame: HTMLIFrameElement | null) => {
    const doc = frame?.contentDocument;
    if (!doc) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    doc.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  };

  useEffect(() => {
    if (html === null) return;
    const frames = [a.current, b.current];
    const backIndex = shown === null ? 0 : 1 - front.current;
    const back = frames[backIndex];
    if (!back) return;
    back.onload = () => {
      applyTheme(back);
      const prev = frames[front.current];
      // Scrollposition übernehmen
      const top = prev?.contentWindow?.scrollY ?? 0;
      back.contentWindow?.scrollTo(0, top);
      front.current = backIndex;
      setShown(backIndex);
    };
    back.srcdoc = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  useEffect(() => {
    applyTheme(a.current);
    applyTheme(b.current);
  }, [theme]);

  return (
    <div className="el-html">
      {[a, b].map((ref, i) => (
        <iframe key={i} ref={ref} title={t('HTML-Vorschau des Elements')} className={shown === i ? 'is-front' : ''} aria-hidden={shown !== i} />
      ))}
      {html === null && <div className="el-preview__empty">{t('Vorschau wird erzeugt …')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF: zugeschnittene Seitenausschnitte als SVG
// ---------------------------------------------------------------------------

function PdfView({ pages, skipped, dpr }: { pages: PreviewResult['pdf']; skipped: boolean; dpr: number }) {
  if (skipped) return <div className="el-preview__empty">{t('Dieses Element wird im PDF ausgelassen („Im PDF ausgeben“ ist aus).')}</div>;
  if (pages === null) return <div className="el-preview__empty">{t('Das PDF konnte nicht erzeugt werden. Details stehen unten.')}</div>;
  if (!pages.length) return <div className="el-preview__empty">{t('Das Beispiel erzeugt im PDF keine Ausgabe.')}</div>;
  return (
    <div className="el-pdf">
      {pages.map((p, i) =>
        p.png ? (
          <PngPage key={i} src={p.png} dpr={dpr} />
        ) : (
          <div
            key={i}
            className="el-pdf__page"
            style={{ maxWidth: Math.round(p.width * 1.6) }}
            // SVG stammt vom eigenen Server (Typst-Ausgabe)
            dangerouslySetInnerHTML={{ __html: p.svg ?? '' }}
          />
        ),
      )}
    </div>
  );
}

/** PNG-Ausschnitt in natürlicher Größe (1 Bildpunkt = 1 Gerätepixel). */
function PngPage({ src, dpr }: { src: string; dpr: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="el-pdf__page el-pdf__page--png" style={size ? { width: size.w / dpr } : undefined}>
      <img
        src={src}
        alt={t('PDF-Ausschnitt')}
        draggable={false}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={size ? { width: size.w / dpr } : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------

function DiagnosticList({ name, items }: { name: string; items: Diagnostic[] }) {
  const dir = `${elementDir(name)}/`;
  const where = (d: Diagnostic) => {
    let label = d.path;
    if (d.path === '@example') label = t('Beispiel');
    else if (d.path.startsWith(dir)) {
      const file = d.path.slice(dir.length);
      label = file === 'component.json' ? t('Definition') : (sectionInfo(file)?.label ?? file);
    }
    return d.line ? t('{label}, Zeile {line}', { label, line: d.line }) : label;
  };
  const open = (d: Diagnostic) => {
    if (d.path.startsWith(dir)) {
      const file = d.path.slice(dir.length);
      void openElement(name, file === 'component.json' ? 'settings' : file, d.line ?? undefined, d.column ?? undefined);
    } else if (d.path && d.path !== '@example') {
      void reveal(d.path, d.line ?? undefined, d.column ?? undefined);
    }
  };
  return (
    <ul className="el-diags" aria-label={t('Meldungen')}>
      {items.map((d, i) => {
        const Icon = d.severity === 'error' ? AlertCircle : d.severity === 'warning' ? AlertTriangle : Info;
        const clickable = d.path !== '@example' && !!d.path;
        return (
          <li key={i} className={`el-diag el-diag--${d.severity}`}>
            <Icon />
            <div>
              <button type="button" className="el-diag__where" disabled={!clickable} onClick={() => open(d)}>
                {where(d)}
              </button>
              <p>{d.message}</p>
              {d.hints.map((h, j) => (
                <small key={j}>{t('Hinweis: {hint}', { hint: h })}</small>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
