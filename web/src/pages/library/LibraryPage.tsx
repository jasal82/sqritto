import {
  ArrowDownWideNarrow,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileText,
  FolderInput,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  LayoutTemplate,
  Trash2,
  Unlink,
  Bookmark,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useServerEvents } from '../../lib/events';
import { relativeTime, dateTime } from '../../lib/format';
import { locale, t } from '../../lib/i18n';
import { navigate, routes } from '../../lib/router';
import { toast, useApp } from '../../lib/store';
import type { DocSummary, TemplateInfo } from '../../lib/types';
import {
  Button,
  confirm,
  Empty,
  IconButton,
  Kbd,
  Logo,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  prompt,
  Segmented,
  Tip,
} from '../../ui';
import { NewDocumentDialog } from './NewDocumentDialog';
import { WindowControls } from '../../ui/WindowControls';
import { titleBarMouseDown } from '../../lib/desktop';
import { SettingsDialog } from '../SettingsDialog';
import { useUpdateNotice } from '../UpdateSection';
import { KindIcon, kindLabel } from '../common';

type Filter = 'all' | 'markdoc' | 'typst';

const QUICK = ['leer-markdoc', 'leer-typst', 'brief-din5008', 'rechnung', 'bericht', 'techdoc'];

export function LibraryPage() {
  const { settings, update, info } = useApp();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'updates' | undefined>();
  const searchRef = useRef<HTMLInputElement>(null);
  const openUpdates = useCallback(() => {
    setSettingsSection('updates');
    setSettingsOpen(true);
  }, []);
  const updateAvailable = useUpdateNotice(openUpdates);

  const load = useCallback(async () => {
    try {
      setDocs(await api.documents());
    } catch (e) {
      toast.error(t('Dokumente konnten nicht geladen werden'), e);
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    document.title = 'Sqritto';
    void load();
    api.templates().then(setTemplates).catch(() => undefined);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useServerEvents((e) => {
    if (e.type === 'library-changed') void load();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openNew();
      }
      if ((mod && e.key.toLowerCase() === 'k') || (e.key === '/' && document.activeElement === document.body)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openNew = (template?: string) => {
    setNewTemplate(template);
    setNewOpen(true);
  };

  const visible = useMemo(() => {
    if (!docs) return [];
    const q = query.trim().toLowerCase();
    let list = docs.filter(
      (d) =>
        (filter === 'all' || d.kind === filter) &&
        (!q ||
          d.title.toLowerCase().includes(q) ||
          (d.subtitle ?? '').toLowerCase().includes(q) ||
          d.folder.toLowerCase().includes(q) ||
          d.authors.some((a) => a.toLowerCase().includes(q))),
    );
    const sort = settings.librarySort;
    list = [...list].sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title, locale())
        : sort === 'created'
          ? (b.created ?? '').localeCompare(a.created ?? '')
          : b.modified - a.modified,
    );
    return list;
  }, [docs, query, filter, settings.librarySort]);

  const quick = QUICK.map((id) => templates.find((t) => t.id === id)).filter((t): t is TemplateInfo => !!t);

  const importFolder = async () => {
    try {
      let path: string | null = null;
      if (info?.mode === 'local') {
        path = (await api.pickFolder()).path;
      } else {
        path = await prompt({ title: t('Ordner hinzufügen'), label: t('Pfad zum Dokumentordner'), placeholder: t('/pfad/zum/dokument') });
      }
      if (!path) return;
      const doc = await api.importDocument(path);
      toast.success(t('Dokument hinzugefügt'), doc.title);
      void load();
    } catch (e) {
      toast.error(t('Ordner konnte nicht hinzugefügt werden'), e);
    }
  };

  return (
    <div className="library">
      <header className="lib-header" onMouseDown={titleBarMouseDown}>
        <div className="lib-header__brand">
          <Logo size={28} />
          <span className="lib-header__name">Sqritto</span>
        </div>
        <div className="input-wrap lib-header__search">
          <Search />
          <input
            ref={searchRef}
            className="input"
            placeholder={t('Dokumente durchsuchen')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                e.currentTarget.blur();
              }
              if (e.key === 'Enter' && visible[0]) navigate(routes.editor(visible[0].id));
            }}
            aria-label={t('Dokumente durchsuchen')}
          />
          {!query && <Kbd keys="Mod K" />}
        </div>
        <div className="lib-header__actions">
          <IconButton
            label={updateAvailable ? t('Einstellungen · Update verfügbar') : t('Einstellungen')}
            onClick={() => (updateAvailable ? openUpdates() : setSettingsOpen(true))}
            size="md"
            className={updateAvailable ? 'has-dot' : undefined}
          >
            <Settings2 />
          </IconButton>
          <Tip label={info?.mode === 'local' ? t('Vorhandenen Ordner öffnen') : t('Ordner im Arbeitsbereich hinzufügen')}>
            <Button icon={<FolderInput />} onClick={importFolder}>
              {t('Öffnen')}
            </Button>
          </Tip>
          <Tip label={t('Neues Dokument')} keys="Mod N">
            <Button variant="primary" icon={<Plus />} onClick={() => openNew()}>
              {t('Neues Dokument')}
            </Button>
          </Tip>
        </div>
        <WindowControls />
      </header>

      <main className="lib-main">
        {quick.length > 0 && !query && (
          <section className="lib-quick" aria-labelledby="quick-title">
            <div className="lib-section-head">
              <h2 id="quick-title">{t('Neu beginnen')}</h2>
              <Button variant="ghost" size="sm" icon={<LayoutTemplate />} onClick={() => openNew()}>
                {t('Alle Vorlagen')}
              </Button>
            </div>
            <div className="lib-quick__row">
              {quick.map((t) => (
                <button key={t.id} type="button" className="quick-card" onClick={() => openNew(t.id)}>
                  <div className="quick-card__thumb">
                    <TemplateThumb id={t.id} />
                  </div>
                  <span className="quick-card__name">{t.name}</span>
                  <span className="quick-card__meta">
                    <KindIcon kind={t.kind} />
                    {t.outputs.map((o) => o.toUpperCase()).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="lib-docs" aria-labelledby="docs-title">
          <div className="lib-section-head">
            <h2 id="docs-title">
              {query ? t('Suchergebnisse') : t('Meine Dokumente')}
              {docs && <span className="lib-count">{visible.length}</span>}
            </h2>
            <div className="lib-toolbar">
              <Segmented<Filter>
                label={t('Dokumenttyp')}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: t('Alle') },
                  { value: 'markdoc', label: 'Markdoc' },
                  { value: 'typst', label: 'Typst' },
                ]}
              />
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" icon={<ArrowDownWideNarrow />}>
                    {settings.librarySort === 'name' ? t('Name') : settings.librarySort === 'created' ? t('Erstellt') : t('Zuletzt bearbeitet')}
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>{t('Sortieren nach')}</MenuLabel>
                  {(
                    [
                      ['modified', t('Zuletzt bearbeitet')],
                      ['created', t('Erstellungsdatum')],
                      ['name', t('Name')],
                    ] as const
                  ).map(([v, l]) => (
                    <MenuItem key={v} icon={settings.librarySort === v ? <Check /> : <span style={{ width: 16 }} />} onSelect={() => update({ librarySort: v })}>
                      {l}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
              <Segmented<'grid' | 'list'>
                label={t('Ansicht')}
                value={settings.libraryView}
                onChange={(v) => update({ libraryView: v })}
                options={[
                  { value: 'grid', label: <span className="sr-only">{t('Raster')}</span>, icon: <LayoutGrid />, title: t('Rasteransicht') },
                  { value: 'list', label: <span className="sr-only">{t('Liste')}</span>, icon: <List />, title: t('Listenansicht') },
                ]}
              />
            </div>
          </div>

          {docs === null ? (
            <div className="doc-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="doc-card doc-card--skeleton">
                  <div className="doc-card__thumb skeleton" />
                  <div className="skeleton" style={{ height: 14, width: '70%', marginTop: 12 }} />
                  <div className="skeleton" style={{ height: 11, width: '40%', marginTop: 8 }} />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            query || filter !== 'all' ? (
              <Empty icon={<Search />} title={t('Keine Treffer')}>
                {t('Kein Dokument passt zu „{query}“.', { query: query || kindLabel(filter as 'markdoc') })}
              </Empty>
            ) : (
              <Empty
                icon={<BookOpen />}
                title={t('Noch keine Dokumente')}
                actions={
                  <Button variant="primary" icon={<Plus />} onClick={() => openNew()}>
                    {t('Erstes Dokument anlegen')}
                  </Button>
                }
              >
                {info?.workspace
                  ? t('Lege ein neues Dokument aus einer Vorlage an. Alle Inhalte liegen als Markdoc- oder Typst-Quellen in einem Ordner unter {path} – bereit für Git.', {
                      path: info.workspace,
                    })
                  : t('Lege ein neues Dokument aus einer Vorlage an. Alle Inhalte liegen als Markdoc- oder Typst-Quellen in einem Ordner – bereit für Git.')}
              </Empty>
            )
          ) : settings.libraryView === 'grid' ? (
            <div className="doc-grid">
              {visible.map((d) => (
                <DocCard key={d.id} doc={d} onChanged={load} />
              ))}
            </div>
          ) : (
            <div className="doc-list" role="table" aria-label={t('Dokumente')}>
              <div className="doc-list__head" role="row">
                <span role="columnheader">{t('Titel')}</span>
                <span role="columnheader">{t('Typ')}</span>
                <span role="columnheader">{t('Ausgaben')}</span>
                <span role="columnheader">{t('Geändert')}</span>
                <span role="columnheader" />
              </div>
              {visible.map((d) => (
                <DocRow key={d.id} doc={d} onChanged={load} />
              ))}
            </div>
          )}
        </section>
      </main>

      <NewDocumentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        templates={templates}
        initialTemplate={newTemplate}
        onCreated={(doc) => navigate(routes.editor(doc.id))}
        onTemplatesChanged={() => api.templates().then(setTemplates)}
      />
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setSettingsSection(undefined);
        }}
      />
    </div>
  );
}

export function TemplateThumb({ id, src }: { id?: string; src?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const url = src ?? (id ? api.templateThumbnail(id) : '');
  return (
    <>
      {state !== 'ok' && <div className={state === 'loading' ? 'thumb-placeholder skeleton' : 'thumb-placeholder'}>{state === 'error' && <FileText />}</div>}
      <img
        src={url}
        alt=""
        loading="lazy"
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
        style={state === 'ok' ? undefined : { position: 'absolute', opacity: 0 }}
      />
    </>
  );
}

function useDocActions(doc: DocSummary, onChanged: () => void) {
  const { info } = useApp();
  return {
    open: () => navigate(routes.editor(doc.id)),
    reveal: info?.mode === 'local' ? () => void api.reveal(doc.id).catch((e) => toast.error(t('Ordner konnte nicht geöffnet werden'), e)) : undefined,
    duplicate: async () => {
      try {
        const copy = await api.duplicateDocument(doc.id);
        toast.success(t('Dokument dupliziert'), copy.title);
        onChanged();
      } catch (e) {
        toast.error(t('Duplizieren fehlgeschlagen'), e);
      }
    },
    saveTemplate: async () => {
      const name = await prompt({ title: t('Als Vorlage speichern'), label: t('Name der Vorlage'), value: doc.title, confirm: t('Speichern') });
      if (!name) return;
      try {
        await api.saveTemplate(doc.id, name, doc.description ?? '');
        toast.success(t('Vorlage gespeichert'), t('„{name}“ steht nun unter „Eigene Vorlagen“ bereit.', { name }));
      } catch (e) {
        toast.error(t('Vorlage konnte nicht gespeichert werden'), e);
      }
    },
    forget: doc.external
      ? async () => {
          if (
            !(await confirm({
              title: t('Aus der Bibliothek entfernen?'),
              description: t('Der Ordner bleibt unverändert auf dem Datenträger.'),
              confirm: t('Entfernen'),
            }))
          )
            return;
          try {
            await api.deleteDocument(doc.id, false);
            onChanged();
          } catch (e) {
            toast.error(t('Entfernen fehlgeschlagen'), e);
          }
        }
      : undefined,
    trash: async () => {
      const ok = await confirm({
        title: t('„{title}“ löschen?', { title: doc.title }),
        description: t('Der Dokumentordner wird mit allen Dateien und der Versionsgeschichte in den Papierkorb verschoben.'),
        confirm: t('In den Papierkorb'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteDocument(doc.id, true);
        toast.success(t('In den Papierkorb verschoben'), doc.title);
        onChanged();
      } catch (e) {
        toast.error(t('Löschen fehlgeschlagen'), e);
      }
    },
  };
}

function DocMenu({ doc, onChanged, trigger }: { doc: DocSummary; onChanged: () => void; trigger: React.ReactNode }) {
  const a = useDocActions(doc, onChanged);
  return (
    <Menu>
      <MenuTrigger asChild>{trigger}</MenuTrigger>
      <MenuContent>
        <MenuItem icon={<ExternalLink />} onSelect={a.open}>
          {t('Öffnen')}
        </MenuItem>
        {a.reveal && (
          <MenuItem icon={<FolderOpen />} onSelect={a.reveal}>
            {t('Im Explorer zeigen')}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Copy />} onSelect={a.duplicate}>
          {t('Duplizieren')}
        </MenuItem>
        <MenuItem icon={<Bookmark />} onSelect={a.saveTemplate}>
          {t('Als Vorlage speichern')}
        </MenuItem>
        <MenuSeparator />
        {a.forget && (
          <MenuItem icon={<Unlink />} onSelect={a.forget}>
            {t('Aus Bibliothek entfernen')}
          </MenuItem>
        )}
        <MenuItem icon={<Trash2 />} danger onSelect={a.trash}>
          {t('In den Papierkorb')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function DocCard({ doc, onChanged }: { doc: DocSummary; onChanged: () => void }) {
  return (
    <article className="doc-card">
      <a
        className="doc-card__link"
        href={routes.editor(doc.id)}
        onClick={(e) => {
          e.preventDefault();
          navigate(routes.editor(doc.id));
        }}
        aria-label={t('{title} öffnen', { title: doc.title })}
      />
      <div className="doc-card__thumb">
        {doc.thumbnail ? (
          <img src={doc.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="doc-card__nothumb">
            <KindIcon kind={doc.kind} />
            <span>{t('Noch keine Vorschau')}</span>
          </div>
        )}
        {doc.git && (
          <span className="doc-card__git" title={t('Versionsverwaltung aktiv')}>
            <GitBranch />
          </span>
        )}
      </div>
      <div className="doc-card__body">
        <div className="doc-card__title-row">
          <h3 className="doc-card__title" title={doc.title}>
            {doc.title}
          </h3>
          <DocMenu
            doc={doc}
            onChanged={onChanged}
            trigger={
              <Button variant="ghost" size="sm" iconOnly className="doc-card__menu" aria-label={t('Weitere Aktionen')}>
                <MoreHorizontal />
              </Button>
            }
          />
        </div>
        <div className="doc-card__meta">
          <span className="doc-card__kind">
            <KindIcon kind={doc.kind} /> {kindLabel(doc.kind)}
          </span>
          <span aria-hidden>·</span>
          <time title={dateTime(doc.modified)}>{relativeTime(doc.modified)}</time>
        </div>
        {doc.error && <div className="doc-card__error">{doc.error}</div>}
      </div>
    </article>
  );
}

function DocRow({ doc, onChanged }: { doc: DocSummary; onChanged: () => void }) {
  return (
    <div className="doc-row" role="row" onClick={() => navigate(routes.editor(doc.id))}>
      <span className="doc-row__title" role="cell">
        <span className="doc-row__thumb">{doc.thumbnail ? <img src={doc.thumbnail} alt="" loading="lazy" /> : <FileText />}</span>
        <span className="doc-row__text">
          <strong>{doc.title}</strong>
          <small title={doc.path}>{doc.path}</small>
        </span>
      </span>
      <span role="cell" className="doc-row__kind">
        <KindIcon kind={doc.kind} /> {kindLabel(doc.kind)}
        {doc.git && <GitBranch className="doc-row__git" aria-label="Git" />}
      </span>
      <span role="cell" className="doc-row__outputs">
        {doc.outputs.map((o) => (
          <span key={o} className="badge badge--outline">
            {o.toUpperCase()}
          </span>
        ))}
      </span>
      <span role="cell" className="subtle" title={dateTime(doc.modified)}>
        {relativeTime(doc.modified)}
      </span>
      <span role="cell" onClick={(e) => e.stopPropagation()}>
        <DocMenu
          doc={doc}
          onChanged={onChanged}
          trigger={
            <Button variant="ghost" size="sm" iconOnly aria-label={t('Weitere Aktionen')}>
              <MoreHorizontal />
            </Button>
          }
        />
      </span>
    </div>
  );
}

