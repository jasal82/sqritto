import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { toast } from '../../lib/store';
import type { Manifest } from '../../lib/types';
import { Button, Dialog, SwitchRow } from '../../ui';
import { RichText } from '../common';
import { allFiles, compileNow, refreshManifest, useEditor } from './store';

type Tab = 'general' | 'pdf' | 'html' | 'variables';

const layouts = () => [
  { value: '@sqritto/techdoc:0.1.0', label: t('Technische Dokumentation'), hint: t('Titelseite, Inhaltsverzeichnis, Kapitel') },
  { value: '@sqritto/arc42:0.1.0', label: t('Architektur (arc42)'), hint: t('Architekturdokumentation nach arc42') },
  { value: '@sqritto/report:0.1.0', label: t('Bericht'), hint: t('Redaktionelles Layout mit Serifenschrift') },
  { value: '@sqritto/markdoc:0.1.0', label: t('Schlicht'), hint: t('Minimales Grundlayout') },
];

const standards = () => [
  { value: '', label: t('Standard (getaggtes PDF 1.7)') },
  { value: 'a-2b', label: t('PDF/A-2b (Langzeitarchivierung)') },
  { value: 'a-3b', label: t('PDF/A-3b (Archiv mit Anhängen)') },
  { value: 'ua-1', label: t('PDF/UA-1 (barrierefrei)') },
];

const langs = () => [
  ['de', t('Deutsch')],
  ['en', t('Englisch')],
  ['fr', t('Französisch')],
  ['es', t('Spanisch')],
  ['it', t('Italienisch')],
  ['nl', t('Niederländisch')],
];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function DocSettingsDialog({ tab, onClose }: { tab: string | null; onClose: () => void }) {
  const { manifest, id } = useEditor();
  const [current, setCurrent] = useState<Tab>('general');
  const [m, setM] = useState<Manifest | null>(null);
  const [vars, setVars] = useState<[string, string][]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tab && manifest) {
      setCurrent(tab as Tab);
      setM(clone(manifest));
      setVars(Object.entries(manifest.variables ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    }
  }, [tab, manifest]);

  const images = useMemo(() => allFiles().filter((f) => /\.(svg|png|jpe?g|webp)$/i.test(f)), [tab]);
  const typFiles = useMemo(() => allFiles().filter((f) => f.endsWith('.typ')), [tab]);

  if (!m) return null;
  const isMarkdoc = m.document.kind === 'markdoc';
  // Ältere Dokumente verweisen noch auf den früheren Namensraum @typeset/.
  const layout = m.pdf.template.replace(/^@typeset\//, '@sqritto/');
  const layoutOptions = layouts();
  const layoutKnown = layoutOptions.some((l) => l.value === layout);
  const opt = (k: string, d: unknown) => (m.pdf.options?.[k] ?? d) as never;
  const setOpt = (k: string, v: unknown) => setM({ ...m, pdf: { ...m.pdf, options: { ...m.pdf.options, [k]: v } } });
  const setDoc = (patch: Partial<Manifest['document']>) => setM({ ...m, document: { ...m.document, ...patch } });
  const setPdf = (patch: Partial<Manifest['pdf']>) => setM({ ...m, pdf: { ...m.pdf, ...patch } });
  const setHtml = (patch: Partial<Manifest['html']>) => setM({ ...m, html: { ...m.html, ...patch } });
  const isReport = layout.includes('report');
  const isArc42 = layout.includes('arc42');

  const save = async () => {
    setBusy(true);
    try {
      const variables: Record<string, unknown> = {};
      for (const [k, v] of vars) {
        const key = k.trim();
        if (!key) continue;
        variables[key] = v;
      }
      // Entfernte Variablen löschen (null)
      for (const k of Object.keys(manifest?.variables ?? {})) if (!(k in variables)) variables[k] = null;
      const cleanOptions: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m.pdf.options ?? {})) cleanOptions[k] = v === '' ? null : v;
      const patch = {
        document: {
          title: m.document.title,
          subtitle: m.document.subtitle || null,
          authors: m.document.authors.filter((a) => a.trim()),
          version: m.document.version || null,
          date: m.document.date || null,
          lang: m.document.lang,
          description: m.document.description || null,
        },
        pdf: {
          enabled: m.pdf.enabled,
          ...(isMarkdoc ? { template: m.pdf.template } : {}),
          standard: m.pdf.standard || null,
          options: cleanOptions,
        },
        ...(isMarkdoc
          ? {
              html: {
                enabled: m.html.enabled,
                accent: m.html.accent || null,
                logo: m.html.logo || null,
                footer: m.html.footer || null,
                repo: m.html.repo || null,
                include_pdf: m.html.include_pdf,
                landing: m.html.landing !== false,
              },
            }
          : { typst: { entry: m.typst.entry } }),
        variables,
      };
      await api.patchManifest(id, patch);
      await refreshManifest();
      void compileNow();
      toast.success(t('Einstellungen gespeichert'));
      onClose();
    } catch (e) {
      toast.error(t('Speichern fehlgeschlagen'), e);
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string][] = [
    ['general', t('Allgemein')],
    ['pdf', 'PDF'],
    ...(isMarkdoc ? ([['html', 'HTML5']] as [Tab, string][]) : []),
    ['variables', t('Variablen')],
  ];

  return (
    <Dialog
      open={!!tab}
      onOpenChange={(o) => !o && onClose()}
      title={t('Dokumenteinstellungen')}
      description={t('Gespeichert in sqritto.toml im Dokumentordner.')}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t('Speichern')}
          </Button>
        </>
      }
    >
      <div className="tabs docsettings__tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" className="tabs__tab" aria-selected={current === k} onClick={() => setCurrent(k)}>
            {l}
          </button>
        ))}
      </div>
      <div className="dialog__body docsettings">
        {current === 'general' && (
          <div className="form-grid">
            <label className="field form-grid__full">
              <span className="field__label">{t('Titel')}</span>
              <input className="input" value={m.document.title} onChange={(e) => setDoc({ title: e.target.value })} />
            </label>
            <label className="field form-grid__full">
              <span className="field__label">{t('Untertitel')}</span>
              <input className="input" value={m.document.subtitle ?? ''} onChange={(e) => setDoc({ subtitle: e.target.value })} />
            </label>
            <label className="field form-grid__full">
              <span className="field__label">{t('Autorinnen und Autoren')}</span>
              <input
                className="input"
                value={m.document.authors.join(', ')}
                onChange={(e) => setDoc({ authors: e.target.value.split(',').map((s) => s.trimStart()) })}
                placeholder={t('Mehrere durch Komma trennen')}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('Version')}</span>
              <input className="input" value={m.document.version ?? ''} onChange={(e) => setDoc({ version: e.target.value })} placeholder={t('z. B. 1.0')} />
            </label>
            <label className="field">
              <span className="field__label">{t('Datum')}</span>
              <input className="input" value={m.document.date ?? ''} onChange={(e) => setDoc({ date: e.target.value })} placeholder={t('leer = heutiges Datum')} />
            </label>
            <label className="field">
              <span className="field__label">{t('Sprache')}</span>
              <select className="select" value={m.document.lang} onChange={(e) => setDoc({ lang: e.target.value })}>
                {langs().map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <span className="field__hint">{t('Steuert Silbentrennung und Anführungszeichen.')}</span>
            </label>
            <div className="field">
              <span className="field__label">{t('Dokumenttyp')}</span>
              <div className="docsettings__kind">{isMarkdoc ? t('Markdoc → PDF und HTML5') : 'Typst → PDF'}</div>
            </div>
            <label className="field form-grid__full">
              <span className="field__label">{t('Beschreibung')}</span>
              <textarea className="textarea" rows={2} value={m.document.description ?? ''} onChange={(e) => setDoc({ description: e.target.value })} />
            </label>
            {isMarkdoc && (
              <div className="form-grid__full">
                <SwitchRow
                  title={t('PDF erzeugen')}
                  description={t('Übersetzung mit Typst in ein druckfertiges PDF.')}
                  checked={m.pdf.enabled}
                  onChange={(enabled) => setPdf({ enabled })}
                />
                <SwitchRow
                  title={t('HTML5 erzeugen')}
                  description={t('Statische Website mit Suche und Navigation.')}
                  checked={m.html.enabled}
                  onChange={(enabled) => setHtml({ enabled })}
                />
              </div>
            )}
          </div>
        )}

        {current === 'pdf' && (
          <div className="form-grid">
            {isMarkdoc ? (
              <label className="field form-grid__full">
                <span className="field__label">{t('Layout-Vorlage')}</span>
                <select className="select" value={layoutKnown ? layout : '__custom'} onChange={(e) => setPdf({ template: e.target.value === '__custom' ? (typFiles[0] ?? 'theme/template.typ') : e.target.value })}>
                  {layoutOptions.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label} – {l.hint}
                    </option>
                  ))}
                  <option value="__custom">{t('Eigene Typst-Vorlage aus dem Dokument…')}</option>
                </select>
                {!layoutKnown && (
                  <input className="input" value={layout} onChange={(e) => setPdf({ template: e.target.value })} placeholder={t('theme/template.typ oder @preview/paket:1.0.0')} />
                )}
                <span className="field__hint">
                  <RichText text={t('Eigene Vorlagen exportieren eine Funktion `ts-document(title, …, body)` und können die Elemente überschreiben.')} />
                </span>
              </label>
            ) : (
              <label className="field form-grid__full">
                <span className="field__label">{t('Hauptdatei')}</span>
                <select className="select" value={m.typst.entry} onChange={(e) => setM({ ...m, typst: { entry: e.target.value } })}>
                  {typFiles.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field form-grid__full">
              <span className="field__label">{t('PDF-Standard')}</span>
              <select className="select" value={m.pdf.standard ?? ''} onChange={(e) => setPdf({ standard: e.target.value })}>
                {standards().map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {isMarkdoc && (
              <>
                <div className="form-grid__full">
                  <SwitchRow title={t('Titelseite')} checked={opt('cover', !isReport)} onChange={(v) => setOpt('cover', v)} />
                  <SwitchRow title={t('Inhaltsverzeichnis')} checked={opt('toc', !isReport)} onChange={(v) => setOpt('toc', v)} />
                  <SwitchRow title={t('Nummerierte Überschriften')} checked={opt('numbering', true)} onChange={(v) => setOpt('numbering', v)} />
                  <SwitchRow title={t('Jedes Kapitel auf neuer Seite')} checked={opt('chapter-pagebreak', !isReport)} onChange={(v) => setOpt('chapter-pagebreak', v)} />
                  {isReport && <SwitchRow title={t('Serifenschrift')} checked={opt('serif', true)} onChange={(v) => setOpt('serif', v)} />}
                </div>
                <label className="field">
                  <span className="field__label">{t('Akzentfarbe')}</span>
                  <div className="color-field">
                    <input type="color" value={String(opt('accent', isReport ? '#b45309' : isArc42 ? '#4f46e5' : '#2563eb'))} onChange={(e) => setOpt('accent', e.target.value)} />
                    <input className="input" value={String(opt('accent', ''))} onChange={(e) => setOpt('accent', e.target.value)} placeholder="#2563eb" />
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">{t('Papierformat')}</span>
                  <select className="select" value={String(opt('paper', 'a4'))} onChange={(e) => setOpt('paper', e.target.value)}>
                    <option value="a4">A4</option>
                    <option value="a5">A5</option>
                    <option value="us-letter">US Letter</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{t('Logo')}</span>
                  <select className="select" value={String(opt('logo', ''))} onChange={(e) => setOpt('logo', e.target.value)}>
                    <option value="">{t('Kein Logo')}</option>
                    {images.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{t('Organisation')}</span>
                  <input className="input" value={String(opt('organization', ''))} onChange={(e) => setOpt('organization', e.target.value)} />
                </label>
                <label className="field">
                  <span className="field__label">{t('Klassifizierung')}</span>
                  <input className="input" value={String(opt('classification', ''))} onChange={(e) => setOpt('classification', e.target.value)} placeholder={t('z. B. Intern')} />
                </label>
                <label className="field">
                  <span className="field__label">{t('Dokumentart')}</span>
                  <input className="input" value={String(opt('doctype', ''))} onChange={(e) => setOpt('doctype', e.target.value)} placeholder={t('z. B. Handbuch')} />
                </label>
                {isArc42 && (
                  <>
                    <label className="field">
                      <span className="field__label">{t('System')}</span>
                      <input className="input" value={String(opt('system', ''))} onChange={(e) => setOpt('system', e.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field__label">{t('Status')}</span>
                      <input className="input" value={String(opt('status', ''))} onChange={(e) => setOpt('status', e.target.value)} placeholder={t('z. B. Entwurf')} />
                    </label>
                  </>
                )}
                {isReport && (
                  <label className="field form-grid__full">
                    <span className="field__label">{t('Zusammenfassung')}</span>
                    <textarea className="textarea" rows={3} value={String(opt('abstract', ''))} onChange={(e) => setOpt('abstract', e.target.value)} />
                  </label>
                )}
              </>
            )}
          </div>
        )}

        {current === 'html' && isMarkdoc && (
          <div className="form-grid">
            <div className="form-grid__full">
              <SwitchRow title={t('HTML5 erzeugen')} checked={m.html.enabled} onChange={(enabled) => setHtml({ enabled })} />
              <SwitchRow
                title={t('PDF beilegen')}
                description={t('Das PDF liegt im Paket und ist über die Kopfzeile erreichbar.')}
                checked={m.html.include_pdf}
                onChange={(include_pdf) => setHtml({ include_pdf })}
              />
              <SwitchRow
                title={t('Startseite mit Kapitelübersicht')}
                description={t('Titelbereich mit Lesedauer und Direktlinks zu allen Kapiteln; die Seite index wird dazu als Einleitung verwendet.')}
                checked={m.html.landing !== false}
                onChange={(landing) => setHtml({ landing })}
              />
            </div>
            <label className="field">
              <span className="field__label">{t('Akzentfarbe')}</span>
              <div className="color-field">
                <input type="color" value={m.html.accent || '#2c5fd4'} onChange={(e) => setHtml({ accent: e.target.value })} />
                <input className="input" value={m.html.accent ?? ''} onChange={(e) => setHtml({ accent: e.target.value })} placeholder={t('Standard')} />
              </div>
            </label>
            <label className="field">
              <span className="field__label">{t('Logo')}</span>
              <select className="select" value={m.html.logo ?? ''} onChange={(e) => setHtml({ logo: e.target.value })}>
                <option value="">{t('Kein Logo')}</option>
                {images.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field form-grid__full">
              <span className="field__label">{t('Fußzeile')}</span>
              <input className="input" value={m.html.footer ?? ''} onChange={(e) => setHtml({ footer: e.target.value })} placeholder={t('© 2026 Firma GmbH')} />
            </label>
            <label className="field form-grid__full">
              <span className="field__label">{t('Link zum Repository')}</span>
              <input className="input" value={m.html.repo ?? ''} onChange={(e) => setHtml({ repo: e.target.value })} placeholder="https://github.com/…" />
            </label>
          </div>
        )}

        {current === 'variables' && (
          <div className="vars">
            <p className="subtle">
              {isMarkdoc ? (
                <RichText text={t('Variablen stehen in allen Seiten als `{% $name %}` zur Verfügung, z. B. für Produktnamen oder Versionen.')} />
              ) : (
                <RichText text={t('Variablen stehen in Typst über `sys.inputs.name` zur Verfügung.')} />
              )}
            </p>
            <div className="vars__list">
              {vars.map(([k, v], i) => (
                <div key={i} className="vars__row">
                  <input
                    className="input input--sm mono"
                    value={k}
                    placeholder="name"
                    onChange={(e) => setVars(vars.map((x, j) => (j === i ? [e.target.value.replace(/[^\w-]/g, ''), x[1]] : x)))}
                  />
                  <input className="input input--sm" value={v} placeholder={t('Wert')} onChange={(e) => setVars(vars.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
                  <Button variant="ghost" size="sm" iconOnly aria-label={t('Variable entfernen')} onClick={() => setVars(vars.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="sm" icon={<Plus />} onClick={() => setVars([...vars, ['', '']])}>
              {t('Variable hinzufügen')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
