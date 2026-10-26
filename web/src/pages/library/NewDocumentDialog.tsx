import * as RDialog from '@radix-ui/react-dialog';
import {
  BookOpen,
  Briefcase,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Globe,
  Layers,
  Mail,
  NotebookPen,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { toast, useApp } from '../../lib/store';
import type { DocSummary, TemplateInfo, UniverseTemplate } from '../../lib/types';
import { Button, confirm, Switch } from '../../ui';
import { KindIcon, kindLabel } from '../common';
import { TemplateThumb } from './LibraryPage';

// Die Kategorien liefert der Server in der Sprache der Oberfläche.
const CATEGORY_ORDER = [t('Leer'), t('Dokumentation'), t('Berichte'), t('Korrespondenz'), t('Geschäftlich'), t('Eigene Vorlagen')];

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  [t('Leer')]: <FilePlus2 />,
  [t('Dokumentation')]: <BookOpen />,
  [t('Berichte')]: <NotebookPen />,
  [t('Korrespondenz')]: <Mail />,
  [t('Geschäftlich')]: <Briefcase />,
  [t('Eigene Vorlagen')]: <Star />,
};

type Selection = { type: 'builtin'; template: TemplateInfo } | { type: 'universe'; template: UniverseTemplate };

export function NewDocumentDialog({
  open,
  onOpenChange,
  templates,
  initialTemplate,
  onCreated,
  onTemplatesChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: TemplateInfo[];
  initialTemplate?: string;
  onCreated: (doc: DocSummary) => void;
  onTemplatesChanged: () => void;
}) {
  const { info, settings } = useApp();
  const [category, setCategory] = useState<string>('all');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState<string | null>(null);
  const [git, setGit] = useState(settings.gitByDefault);
  const [busy, setBusy] = useState(false);
  const [universe, setUniverse] = useState<UniverseTemplate[] | null>(null);
  const [uQuery, setUQuery] = useState('');
  const [uError, setUError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBusy(false);
    setGit(settings.gitByDefault);
    setLocation(null);
    const t = templates.find((x) => x.id === initialTemplate) ?? templates.find((x) => x.id === 'techdoc') ?? templates[0];
    setSelection(t ? { type: 'builtin', template: t } : null);
    setCategory(initialTemplate && t ? t.category : 'all');
    window.setTimeout(() => titleRef.current?.focus(), 60);
  }, [open, initialTemplate, templates, settings.gitByDefault]);

  // Typst Universe durchsuchen (verzögert)
  useEffect(() => {
    if (category !== 'universe' || !open) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      setUError(null);
      api
        .universe(uQuery, undefined, ctrl.signal)
        .then(setUniverse)
        .catch((e) => {
          if (e?.name !== 'AbortError') setUError(e.message ?? String(e));
        });
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [category, uQuery, open]);

  const categories = useMemo(() => {
    const set = new Set(templates.map((t) => t.category));
    return [...set].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }, [templates]);

  const shown = useMemo(() => {
    const rank = (c: string) => {
      const i = CATEGORY_ORDER.indexOf(c);
      return i < 0 ? 99 : i;
    };
    const list = category === 'all' ? [...templates] : templates.filter((t) => t.category === category);
    return list.sort((a, b) => rank(a.category) - rank(b.category) || a.order - b.order || a.name.localeCompare(b.name));
  }, [templates, category]);

  const create = async () => {
    if (!selection || !title.trim()) {
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const template =
        selection.type === 'builtin' ? selection.template.id : `universe:@preview/${selection.template.name}:${selection.template.version}`;
      const doc = await api.createDocument({ title: title.trim(), template, location, git });
      onOpenChange(false);
      toast.success(t('Dokument angelegt'), doc.path);
      onCreated(doc);
    } catch (e) {
      toast.error(t('Dokument konnte nicht angelegt werden'), e);
    } finally {
      setBusy(false);
    }
  };

  const chooseLocation = async () => {
    try {
      const r = await api.pickFolder();
      if (r.path) setLocation(r.path);
    } catch (e) {
      toast.error(t('Ordnerauswahl nicht möglich'), e);
    }
  };

  const deleteUserTemplate = async (tpl: TemplateInfo) => {
    if (!(await confirm({ title: t('Vorlage „{name}“ löschen?', { name: tpl.name }), confirm: t('Löschen'), danger: true }))) return;
    try {
      await api.deleteTemplate(tpl.id);
      onTemplatesChanged();
      setSelection(null);
    } catch (e) {
      toast.error(t('Löschen fehlgeschlagen'), e);
    }
  };

  const sel = selection;
  const selKind = sel?.type === 'builtin' ? sel.template.kind : 'typst';
  const selOutputs = sel?.type === 'builtin' ? sel.template.outputs : ['pdf'];

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content
          className="dialog dialog--wide newdoc"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            titleRef.current?.focus();
          }}
        >
          <aside className="newdoc__nav" aria-label={t('Kategorien')}>
            <RDialog.Title className="newdoc__title">{t('Neues Dokument')}</RDialog.Title>
            <nav className="newdoc__cats">
              <CatButton active={category === 'all'} icon={<Layers />} onClick={() => setCategory('all')} count={templates.length}>
                {t('Alle Vorlagen')}
              </CatButton>
              {categories.map((c) => (
                <CatButton
                  key={c}
                  active={category === c}
                  icon={CATEGORY_ICON[c] ?? <FileCode2 />}
                  onClick={() => setCategory(c)}
                  count={templates.filter((t) => t.category === c).length}
                >
                  {c}
                </CatButton>
              ))}
              <div className="newdoc__sep" />
              <CatButton active={category === 'universe'} icon={<Globe />} onClick={() => setCategory('universe')}>
                Typst Universe
              </CatButton>
            </nav>
            <p className="newdoc__hint">
              {t('Markdoc-Dokumente erzeugen PDF und HTML5. Typst-Dokumente erzeugen PDF mit voller Kontrolle über das Layout.')}
            </p>
          </aside>

          <section className="newdoc__gallery" aria-label={t('Vorlagen')}>
            {category === 'universe' ? (
              <>
                <div className="newdoc__gallery-head">
                  <div className="input-wrap" style={{ flex: 1 }}>
                    <Search />
                    <input
                      className="input"
                      placeholder={t('Vorlagen in Typst Universe suchen, z. B. letter, invoice, thesis')}
                      value={uQuery}
                      onChange={(e) => setUQuery(e.target.value)}
                    />
                  </div>
                </div>
                {uError ? (
                  <div className="newdoc__notice">{t('Typst Universe ist nicht erreichbar: {error}', { error: uError })}</div>
                ) : universe === null ? (
                  <div className="tpl-grid">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="tpl-card">
                        <div className="tpl-card__thumb skeleton" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="tpl-grid">
                    {universe.map((u) => (
                      <button
                        key={u.name}
                        type="button"
                        className="tpl-card"
                        aria-pressed={sel?.type === 'universe' && sel.template.name === u.name}
                        onClick={() => setSelection({ type: 'universe', template: u })}
                        onDoubleClick={create}
                      >
                        <div className="tpl-card__thumb">
                          <TemplateThumb src={api.universeThumbnail(u)} />
                        </div>
                        <span className="tpl-card__name">{u.name}</span>
                        <span className="tpl-card__desc">{u.description}</span>
                      </button>
                    ))}
                    {universe.length === 0 && <div className="newdoc__notice">{t('Keine Vorlagen gefunden.')}</div>}
                  </div>
                )}
              </>
            ) : (
              <div className="tpl-grid">
                {shown.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tpl-card"
                    aria-pressed={sel?.type === 'builtin' && sel.template.id === t.id}
                    onClick={() => setSelection({ type: 'builtin', template: t })}
                    onDoubleClick={create}
                  >
                    <div className="tpl-card__thumb">
                      <TemplateThumb id={t.id} />
                    </div>
                    <span className="tpl-card__name">{t.name}</span>
                    <span className="tpl-card__meta">
                      <KindIcon kind={t.kind} /> {kindLabel(t.kind)}
                      <span aria-hidden>·</span>
                      {t.outputs.map((o) => o.toUpperCase()).join(' + ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="newdoc__details" aria-label={t('Details')}>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" iconOnly className="newdoc__close" aria-label={t('Schließen')}>
                <X />
              </Button>
            </RDialog.Close>
            {sel ? (
              <>
                <div className="newdoc__sel">
                  <span className="newdoc__eyebrow">{sel.type === 'universe' ? 'Typst Universe' : sel.template.category}</span>
                  <h3>{sel.type === 'universe' ? sel.template.name : sel.template.name}</h3>
                  <p>{sel.template.description}</p>
                  <div className="newdoc__badges">
                    <span className="badge badge--accent">
                      <KindIcon kind={selKind} /> {kindLabel(selKind)}
                    </span>
                    {selOutputs.map((o) => (
                      <span key={o} className="badge badge--outline">
                        {o.toUpperCase()}
                      </span>
                    ))}
                    {sel.type === 'universe' && <span className="badge">v{sel.template.version}</span>}
                  </div>
                  {sel.type === 'universe' && (
                    <p className="newdoc__note">
                      {t('Wird beim Anlegen aus dem Internet geladen und danach lokal zwischengespeichert. Autor: {author}.', {
                        author: sel.template.authors.join(', ') || t('unbekannt'),
                      })}
                    </p>
                  )}
                  {sel.type === 'builtin' && sel.template.source === 'user' && (
                    <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={() => deleteUserTemplate(sel.template)}>
                      {t('Vorlage löschen')}
                    </Button>
                  )}
                </div>

                <form
                  className="newdoc__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <label className="field">
                    <span className="field__label">{t('Titel')}</span>
                    <input
                      ref={titleRef}
                      className="input"
                      value={title}
                      placeholder={
                        selKind === 'typst' && sel.type === 'builtin' && sel.template.category === t('Korrespondenz')
                          ? t('z. B. Kündigung Mietvertrag')
                          : t('z. B. Systemhandbuch')
                      }
                      onChange={(e) => setTitle(e.target.value)}
                      required
                    />
                  </label>
                  <div className="field">
                    <span className="field__label">{t('Speicherort')}</span>
                    <div className="newdoc__location">
                      <FolderOpen />
                      <span className="truncate" title={location ?? info?.workspace}>
                        {location ?? info?.workspace ?? t('Arbeitsbereich')}
                      </span>
                      {info?.mode === 'local' && (
                        <Button size="sm" variant="ghost" onClick={chooseLocation}>
                          {t('Ändern…')}
                        </Button>
                      )}
                    </div>
                    {location && (
                      <button type="button" className="newdoc__reset" onClick={() => setLocation(null)}>
                        {t('Zurück zum Arbeitsbereich')}
                      </button>
                    )}
                  </div>
                  <label className="newdoc__git">
                    <span>
                      <strong>{t('Versionsverwaltung (Git)')}</strong>
                      <small>{t('Legt ein Git-Repository an und speichert die erste Version.')}</small>
                    </span>
                    <Switch checked={git} onChange={setGit} />
                  </label>
                  <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!title.trim()} className="newdoc__create">
                    {t('Dokument erstellen')}
                  </Button>
                </form>
              </>
            ) : (
              <div className="newdoc__empty">{t('Wähle links eine Vorlage aus.')}</div>
            )}
          </aside>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function CatButton({
  active,
  icon,
  children,
  onClick,
  count,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button type="button" className="newdoc__cat" aria-current={active ? 'true' : undefined} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {count !== undefined && <span className="newdoc__count">{count}</span>}
    </button>
  );
}
