import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Cloud,
  CloudOff,
  Command,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FileDown,
  FolderOpen,
  GitBranch,
  Loader2,
  PanelRight,
  Settings2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { exportDocument, openPdf } from '../../lib/exporting';
import { isDesktop, titleBarMouseDown } from '../../lib/desktop';
import { t } from '../../lib/i18n';
import { WindowControls } from '../../ui/WindowControls';
import { navigate, routes } from '../../lib/router';
import { toast, useApp } from '../../lib/store';
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, prompt, Tip } from '../../ui';
import { KindIcon } from '../common';
import { hasUnsaved, refreshManifest, saveAndCompile, saveNow, setPanels, useEditor } from './store';
import { useGit } from './GitPanel';

export function EditorHeader({
  onOpenSettings,
  onPalette,
}: {
  onOpenSettings: (tab?: string) => void;
  onPalette: () => void;
}) {
  const { id, detail, manifest, saveState, saveError, compiling, result, panels } = useEditor();
  const info = useApp((s) => s.info);
  const git = useGit();
  const [exporting, setExporting] = useState<string | null>(null);
  const title = manifest?.document.title ?? detail?.summary.title ?? '';
  const kind = manifest?.document.kind ?? detail?.summary.kind ?? 'markdoc';
  const htmlEnabled = kind === 'markdoc' && !!manifest?.html.enabled;
  const pdfEnabled = kind === 'typst' || !!manifest?.pdf.enabled;

  useEffect(() => {
    if (id) void git.refresh(id);
  }, [id, result?.version]);

  const back = async () => {
    if (hasUnsaved()) await saveNow();
    navigate(routes.library());
  };

  const runExport = async (format: 'pdf' | 'html' | 'typst') => {
    setExporting(format);
    try {
      await saveNow();
      await exportDocument(id, format, title);
    } finally {
      setExporting(null);
    }
  };

  const errors = result?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = result?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
  const changes = git.status?.initialized ? git.status.changes.length : 0;

  return (
    <header className="ed-header" onMouseDown={titleBarMouseDown}>
      <div className="ed-header__left">
        <IconButton label={t('Zur Übersicht')} onClick={back} size="md">
          <ArrowLeft />
        </IconButton>
        <div className="ed-header__doc">
          <KindIcon kind={kind} className="ed-header__kind" />
          <TitleEditor id={id} title={title} />
        </div>
        <SaveIndicator state={saveState} error={saveError} />
      </div>

      <div className="ed-header__right">
        <Tip label={errors ? t('Probleme anzeigen') : t('Übersetzungsstatus')} keys="Mod J">
          <button
            type="button"
            className={`ed-status ${compiling ? 'is-busy' : errors ? 'is-error' : warnings ? 'is-warning' : 'is-ok'}`}
            onClick={() => setPanels({ problems: !panels.problems })}
          >
            {compiling ? (
              <>
                <Loader2 className="spin" /> {t('Übersetze…')}
              </>
            ) : errors ? (
              <>
                <CircleAlert /> {errors === 1 ? t('1 Fehler') : t('{n} Fehler', { n: errors })}
              </>
            ) : warnings ? (
              <>
                <TriangleAlert /> {warnings === 1 ? t('1 Warnung') : t('{n} Warnungen', { n: warnings })}
              </>
            ) : result ? (
              <>
                <Check /> {t('Aktuell')}
              </>
            ) : (
              <>
                <Loader2 className="spin" /> {t('Lade…')}
              </>
            )}
          </button>
        </Tip>

        <Tip label={t('Versionen')} keys="Mod Shift G">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={panels.git}
            icon={<GitBranch />}
            onClick={() => setPanels({ git: !panels.git })}
            className="ed-git-btn"
          >
            {git.status?.initialized ? git.status.branch ?? 'main' : t('Versionen')}
            {changes > 0 && <span className="ed-git-btn__count">{changes}</span>}
          </Button>
        </Tip>

        <div className="ed-header__sep" />

        <IconButton label={t('Befehle')} keys="Mod K" onClick={onPalette}>
          <Command />
        </IconButton>
        <IconButton label={t('Vorschau')} keys="Mod \" aria-pressed={panels.preview} onClick={() => setPanels({ preview: !panels.preview })}>
          <PanelRight />
        </IconButton>

        <div className="btn-group">
          <Button
            variant="primary"
            size="sm"
            icon={exporting === 'pdf' ? undefined : <FileDown />}
            loading={exporting === 'pdf'}
            onClick={() => runExport(pdfEnabled ? 'pdf' : 'html')}
            disabled={!!exporting}
          >
            {pdfEnabled ? 'PDF' : 'HTML'}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="primary" size="sm" iconOnly aria-label={t('Weitere Exportformate')} disabled={!!exporting} style={{ width: 26 }}>
                {exporting && exporting !== 'pdf' ? <span className="spinner btn__spinner" /> : <ChevronDown />}
              </Button>
            </MenuTrigger>
            <MenuContent>
              {pdfEnabled && (
                <MenuItem icon={<Download />} description={t('Druckfertiges PDF')} onSelect={() => runExport('pdf')}>
                  {isDesktop ? t('PDF speichern…') : t('PDF herunterladen')}
                </MenuItem>
              )}
              {pdfEnabled && (
                <MenuItem
                  icon={<ExternalLink />}
                  description={isDesktop ? t('Im Standardprogramm für PDF') : t('Im PDF-Betrachter des Browsers')}
                  onSelect={async () => {
                    await saveNow();
                    await openPdf(id);
                  }}
                >
                  {isDesktop ? t('PDF öffnen') : t('PDF in neuem Tab öffnen')}
                </MenuItem>
              )}
              {htmlEnabled && (
                <MenuItem icon={<FileArchive />} description={t('Statische Website mit Suche und Navigation (ZIP)')} onSelect={() => runExport('html')}>
                  {isDesktop ? t('HTML5-Paket speichern…') : t('HTML5-Paket herunterladen')}
                </MenuItem>
              )}
              {kind === 'markdoc' && pdfEnabled && (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<FileCode2 />} description={t('Erzeugter Typst-Code zum Nachvollziehen')} onSelect={() => runExport('typst')}>
                    {t('Typst-Quelle exportieren')}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        </div>

        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" iconOnly aria-label={t('Weitere Aktionen')}>
              <ChevronDown />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Settings2 />} onSelect={() => onOpenSettings('general')}>
              {t('Dokumenteinstellungen')}
            </MenuItem>
            {info?.mode === 'local' && (
              <MenuItem icon={<FolderOpen />} onSelect={() => void api.reveal(id)}>
                {t('Ordner im Explorer zeigen')}
              </MenuItem>
            )}
            <MenuItem
              icon={<Bookmark />}
              onSelect={async () => {
                const name = await prompt({ title: t('Als Vorlage speichern'), label: t('Name der Vorlage'), value: title, confirm: t('Speichern') });
                if (!name) return;
                try {
                  await saveNow();
                  await api.saveTemplate(id, name, manifest?.document.description ?? '');
                  toast.success(t('Vorlage gespeichert'), t('„{name}“ ist jetzt unter „Neues Dokument“ verfügbar.', { name }));
                } catch (e) {
                  toast.error(t('Vorlage konnte nicht gespeichert werden'), e);
                }
              }}
            >
              {t('Als Vorlage speichern')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Check />} keys="Mod S" onSelect={() => void saveAndCompile()}>
              {t('Speichern und neu übersetzen')}
            </MenuItem>
          </MenuContent>
        </Menu>
        <WindowControls />
      </div>
    </header>
  );
}

function SaveIndicator({ state, error }: { state: string; error: string | null }) {
  if (state === 'error')
    return (
      <Tip label={error ?? t('Speichern fehlgeschlagen')}>
        <span className="ed-save is-error">
          <CloudOff /> {t('Nicht gespeichert')}
        </span>
      </Tip>
    );
  if (state === 'saving' || state === 'dirty')
    return (
      <span className="ed-save is-busy">
        <Cloud /> {t('Speichert…')}
      </span>
    );
  return (
    <span className="ed-save">
      <Cloud /> {t('Gespeichert')}
    </span>
  );
}

function TitleEditor({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = async () => {
    setEditing(false);
    const v = value.trim();
    if (!v || v === title) {
      setValue(title);
      return;
    }
    try {
      await api.patchManifest(id, { document: { title: v } });
      await refreshManifest();
      document.title = `${v} – Sqritto`;
      void useEditor.getState();
    } catch (e) {
      toast.error(t('Titel konnte nicht geändert werden'), e);
    }
  };
  if (editing) {
    return (
      <input
        ref={input}
        className="ed-title-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') {
            setValue(title);
            setEditing(false);
          }
        }}
        aria-label={t('Dokumenttitel')}
      />
    );
  }
  return (
    <Tip label={t('Titel ändern')}>
      <button type="button" className="ed-title" onClick={() => setEditing(true)}>
        {title || t('Unbenannt')}
      </button>
    </Tip>
  );
}
