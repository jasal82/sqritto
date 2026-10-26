import { ExternalLink, FileText, Globe, Maximize2, Minus, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useDevicePixelRatio } from '../../lib/dpr';
import { t } from '../../lib/i18n';
import { useApp } from '../../lib/store';
import type { PageMeta } from '../../lib/types';
import { Empty, IconButton, Segmented, Tip } from '../../ui';
import { compileNow, jumpFromPdf, openFile, setPanels, useEditor } from './store';

export function Preview() {
  const { previewMode, manifest, result } = useEditor();
  const kind = manifest?.document.kind ?? 'markdoc';
  const htmlAvailable = kind === 'markdoc' && !!manifest?.html.enabled;
  const pdfAvailable = kind === 'typst' || !!manifest?.pdf.enabled;
  const mode = previewMode === 'html' && htmlAvailable ? 'html' : pdfAvailable ? 'pdf' : 'html';
  return (
    <div className="preview">
      <div className="preview__bar">
        <Segmented
          label={t('Vorschau')}
          value={mode}
          onChange={(m) => useEditor.setState({ previewMode: m })}
          options={[
            { value: 'pdf', label: 'PDF', icon: <FileText />, disabled: !pdfAvailable, title: pdfAvailable ? t('PDF-Vorschau') : t('PDF-Ausgabe ist deaktiviert') },
            {
              value: 'html',
              label: 'HTML',
              icon: <Globe />,
              disabled: !htmlAvailable,
              title: htmlAvailable ? t('HTML5-Vorschau') : kind === 'typst' ? t('Typst-Dokumente erzeugen nur PDF') : t('HTML-Ausgabe ist deaktiviert'),
            },
          ]}
        />
        <div className="spacer" />
        {mode === 'pdf' ? <PdfControls /> : <HtmlControls />}
      </div>
      <div className="preview__body">
        {mode === 'pdf' ? <PdfView /> : <HtmlView />}
        {result && !result.ok && result.pages.length > 0 && (
          <button type="button" className="preview__stale" onClick={() => setPanels({ problems: true })}>
            <TriangleAlert /> {t('Vorschau zeigt den letzten fehlerfreien Stand')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

type Zoom = { mode: 'fit' } | { mode: 'fixed'; value: number };

const zoomStore = { current: { mode: 'fit' } as Zoom, listeners: new Set<() => void>() };

function useZoom(): [Zoom, (z: Zoom) => void] {
  const [z, setZ] = useState(zoomStore.current);
  useEffect(() => {
    const l = () => setZ(zoomStore.current);
    zoomStore.listeners.add(l);
    return () => {
      zoomStore.listeners.delete(l);
    };
  }, []);
  return [
    z,
    (nz) => {
      zoomStore.current = nz;
      zoomStore.listeners.forEach((l) => l());
    },
  ];
}

const pageInfo = { current: 1, listeners: new Set<() => void>() };

function PdfControls() {
  const [zoom, setZoom] = useZoom();
  const pages = useEditor((s) => s.result?.pages.length ?? 0);
  const [page, setPage] = useState(pageInfo.current);
  useEffect(() => {
    const l = () => setPage(pageInfo.current);
    pageInfo.listeners.add(l);
    return () => {
      pageInfo.listeners.delete(l);
    };
  }, []);
  const current = zoom.mode === 'fixed' ? zoom.value : null;
  const step = (d: number) => {
    const base = current ?? (lastFitScale.current || 1);
    const next = Math.max(0.25, Math.min(4, Math.round((base + d) * 4) / 4));
    setZoom({ mode: 'fixed', value: next });
  };
  return (
    <div className="preview__controls">
      {pages > 0 && (
        <span className="preview__pages" aria-live="polite">
          {page} / {pages}
        </span>
      )}
      <IconButton label={t('Herauszoomen')} onClick={() => step(-0.25)}>
        <Minus />
      </IconButton>
      <Tip label={t('Zoom zurücksetzen (Breite einpassen)')}>
        <button type="button" className="preview__zoom" onClick={() => setZoom({ mode: 'fit' })}>
          {current ? `${Math.round(current * 100)} %` : t('Breite')}
        </button>
      </Tip>
      <IconButton label={t('Hineinzoomen')} onClick={() => step(0.25)}>
        <Plus />
      </IconButton>
      <IconButton label={t('Neu übersetzen')} keys="Mod S" onClick={() => void compileNow()}>
        <RefreshCw />
      </IconButton>
    </div>
  );
}

const lastFitScale = { current: 1 };

function PdfView() {
  const { id, result, pdfTarget, compiling } = useEditor();
  const [zoom] = useZoom();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [marker, setMarker] = useState<{ page: number; x: number; y: number; t: number } | null>(null);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const dpr = useDevicePixelRatio();
  const pages = result?.pages ?? [];
  const maxW = Math.max(...pages.map((p) => p.width), 595);
  const fit = Math.max(0.2, (width - 48) / maxW);
  lastFitScale.current = fit;
  const scale = zoom.mode === 'fit' ? fit : zoom.value * (96 / 72);

  // Aktuelle Seite beim Scrollen ermitteln
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => {
      const kids = el.querySelectorAll<HTMLElement>('.pdf-page');
      const mid = el.scrollTop + el.clientHeight * 0.35;
      let cur = 1;
      kids.forEach((k, i) => {
        if (k.offsetTop <= mid) cur = i + 1;
      });
      if (pageInfo.current !== cur) {
        pageInfo.current = cur;
        pageInfo.listeners.forEach((l) => l());
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [pages.length]);

  // Cursor im Editor → Stelle im PDF
  useEffect(() => {
    if (!pdfTarget || !container.current) return;
    const el = container.current;
    const pageEl = el.querySelectorAll<HTMLElement>('.pdf-page')[pdfTarget.page];
    if (!pageEl) return;
    const y = pageEl.offsetTop + pdfTarget.y * scale;
    const visibleTop = el.scrollTop;
    const visibleBottom = el.scrollTop + el.clientHeight;
    if (y < visibleTop + 40 || y > visibleBottom - 60) {
      el.scrollTo({ top: Math.max(0, y - el.clientHeight * 0.3), behavior: 'smooth' });
    }
    setMarker(pdfTarget);
    const t = window.setTimeout(() => setMarker(null), 1600);
    return () => window.clearTimeout(t);
  }, [pdfTarget]);

  if (!result) {
    return (
      <div ref={container} className="pdf-view">
        <div className="pdf-loading">
          <span className="spinner" /> {t('Dokument wird übersetzt…')}
        </div>
      </div>
    );
  }
  if (!pages.length) {
    return (
      <div ref={container} className="pdf-view">
        <Empty icon={<TriangleAlert />} title={compiling ? t('Übersetze…') : t('Keine Vorschau')}>
          {result.diagnostics.find((d) => d.severity === 'error')?.message ?? t('Das Dokument enthält noch keine Seiten.')}
        </Empty>
      </div>
    );
  }
  return (
    <div ref={container} className="pdf-view" tabIndex={0} aria-label={t('PDF-Vorschau')}>
      {pages.map((p, i) => (
        <PdfPage
          key={i}
          id={id}
          index={i}
          page={p}
          scale={scale}
          dpr={dpr}
          marker={marker && marker.page === i ? marker : null}
        />
      ))}
    </div>
  );
}

/** Bis zu diesem Maßstab (Bildpunkte je pt) werden Seiten als PNG geladen. */
const PNG_MAX_SCALE = 3;

function PdfPage({
  id,
  index,
  page,
  scale,
  dpr,
  marker,
}: {
  id: string;
  index: number;
  page: PageMeta;
  scale: number;
  dpr: number;
  marker: { x: number; y: number; t: number } | null;
}) {
  // Seiten kommen als PNG in genau der Bildschirmauflösung vom Server
  // (wie der PDF-Export gerastert). So hängt die Kantenglättung nicht davon
  // ab, wie der Browser Vektorgrafik auf der GPU zeichnet, und das Bild wird
  // 1:1 ohne Nachskalierung angezeigt. Nur bei sehr starker Vergrößerung
  // wird stattdessen die SVG-Fassung verwendet.
  const q = Math.round(scale * dpr * 64) / 64;
  const usePng = q <= PNG_MAX_SCALE;
  const w = usePng ? Math.round(page.width * q) / dpr : page.width * scale;
  const h = usePng ? Math.round(page.height * q) / dpr : page.height * scale;
  const k = w / page.width;
  const url = usePng ? api.pagePngUrl(id, index, q, page.hash) : api.pageUrl(id, index, page.hash);
  // Doppelpuffer: neues Bild erst zeigen, wenn es geladen ist (kein Flackern).
  const [shown, setShown] = useState(url);
  const [visible, setVisible] = useState(index < 3);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  useEffect(() => {
    if (url === shown) return;
    // Kurz warten, damit beim Ziehen der Fensterbreite nicht jede Zwischengröße geladen wird.
    const t = window.setTimeout(() => {
      const img = new Image();
      img.onload = () => setShown(url);
      img.src = url;
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <div
      ref={ref}
      className="pdf-page"
      style={{ width: w, height: h }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        void jumpFromPdf(index, (e.clientX - rect.left) / k, (e.clientY - rect.top) / k);
      }}
      title={t('Klicken, um zur Quelle zu springen')}
    >
      {visible && <img src={shown} alt={t('Seite {n}', { n: index + 1 })} draggable={false} />}
      {marker && <span key={marker.t} className="pdf-marker" style={{ left: marker.x * k, top: marker.y * k }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const frameRef: { current: HTMLIFrameElement | null } = { current: null };

function HtmlControls() {
  const { id, previewSlug } = useEditor();
  return (
    <div className="preview__controls">
      <IconButton label={t('Neu laden')} onClick={() => frameRef.current?.contentWindow?.postMessage({ type: 'ts:reload', hard: true }, '*')}>
        <RefreshCw />
      </IconButton>
      <IconButton label={t('In neuem Tab öffnen')} onClick={() => window.open(api.previewUrl(id, previewSlug ?? undefined), '_blank', 'noopener')}>
        <ExternalLink />
      </IconButton>
      <IconButton
        label={t('Vollbild')}
        onClick={() => {
          void frameRef.current?.requestFullscreen?.();
        }}
      >
        <Maximize2 />
      </IconButton>
    </div>
  );
}

function HtmlView() {
  const { id, result, previewSlug, htmlLine } = useEditor();
  const theme = useApp((s) => s.settings.theme);
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState(() => api.previewUrl(id, previewSlug ?? undefined));
  const currentSlug = useRef<string | null>(previewSlug);
  const ready = useRef(false);

  useEffect(() => {
    frameRef.current = frame.current;
    return () => {
      frameRef.current = null;
    };
  });

  // Seite wechseln, wenn im Editor eine andere Seite geöffnet wird
  useEffect(() => {
    if (previewSlug && previewSlug !== currentSlug.current) {
      currentSlug.current = previewSlug;
      ready.current = false;
      setSrc(api.previewUrl(id, previewSlug));
    }
  }, [previewSlug, id]);

  // Nach jeder Übersetzung Inhalt austauschen (ohne Scrollsprung)
  useEffect(() => {
    if (!result || !ready.current) return;
    frame.current?.contentWindow?.postMessage({ type: 'ts:reload' }, '*');
  }, [result?.version]);

  // Cursor im Editor → Abschnitt in der Vorschau
  useEffect(() => {
    if (htmlLine && ready.current) frame.current?.contentWindow?.postMessage({ type: 'ts:scrollToLine', line: htmlLine.line }, '*');
  }, [htmlLine]);

  // Farbschema an die Vorschau weitergeben
  useEffect(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      const dark = document.documentElement.dataset.theme === 'dark';
      win.document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    } catch {
      /* fremder Ursprung */
    }
  }, [theme]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== 'object') return;
      const msg = e.data as { type: string; slug?: string };
      if (msg.type === 'ts:ready') {
        ready.current = true;
        if (msg.slug) currentSlug.current = msg.slug;
        try {
          const dark = document.documentElement.dataset.theme === 'dark';
          frame.current!.contentWindow!.document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        } catch {
          /* ignorieren */
        }
      }
      if (msg.type === 'ts:navigate' && msg.slug) {
        currentSlug.current = msg.slug;
        const entry = useEditor.getState().result?.outline.find((o) => o.slug === msg.slug);
        if (entry && entry.path !== useEditor.getState().active) void openFile(entry.path);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  if (!result) {
    return (
      <div className="pdf-loading">
        <span className="spinner" /> {t('Dokument wird übersetzt…')}
      </div>
    );
  }
  if (!result.html) {
    return (
      <Empty icon={<Globe />} title={t('Keine HTML-Vorschau')}>
        {t('Die HTML-Ausgabe ist für dieses Dokument nicht aktiviert.')}
      </Empty>
    );
  }
  return <iframe ref={frame} className="html-frame" src={src} title={t('HTML-Vorschau')} onLoad={() => (ready.current = true)} />;
}
