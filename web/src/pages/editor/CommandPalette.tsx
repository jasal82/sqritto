import * as RDialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  Blocks,
  FileCode2,
  FileDown,
  FileText,
  GitBranch,
  Globe,
  Hash,
  Monitor,
  Moon,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  TriangleAlert,
  Variable,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { exportDocument } from '../../lib/exporting';
import { basename, shortcut } from '../../lib/format';
import { t } from '../../lib/i18n';
import { navigate, routes } from '../../lib/router';
import { useApp } from '../../lib/store';
import { componentSnippet } from '../../editor/markdoc';
import { insertText } from '../../editor/commands';
import { allFiles, fileKind, getView, openFile, reveal, saveAndCompile, saveNow, setPanels, useEditor } from './store';

export type PaletteMode = 'files' | 'commands';

interface Item {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keys?: string;
  group: string;
  run: () => void;
}

function score(text: string, query: string): number {
  if (!query) return 1;
  const s0 = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = s0.indexOf(q);
  if (idx >= 0) return 100 - idx + (idx === 0 ? 50 : 0);
  let ti = 0;
  let s = 0;
  for (const ch of q) {
    const f = s0.indexOf(ch, ti);
    if (f < 0) return 0;
    s += f === ti ? 3 : 1;
    ti = f + 1;
  }
  return s;
}

export function CommandPalette({
  mode,
  onClose,
  onOpenSettings,
}: {
  mode: PaletteMode | null;
  onClose: () => void;
  onOpenSettings: (tab?: string) => void;
}) {
  // Befehl erst ausführen, wenn die Palette vollständig geschlossen ist
  // (sonst kollidiert der Fokus mit einem neu geöffneten Dialog).
  const pending = useRef<(() => void) | null>(null);
  return (
    <RDialog.Root open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay palette-overlay" />
        <RDialog.Content
          className="palette"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const fn = pending.current;
            if (fn) {
              e.preventDefault();
              pending.current = null;
              window.setTimeout(fn, 0);
            }
          }}
        >
          <RDialog.Title className="sr-only">{t('Befehlspalette')}</RDialog.Title>
          {mode && (
            <PaletteBody
              initial={mode === 'commands' ? '>' : ''}
              onRun={(fn) => {
                pending.current = fn;
                onClose();
              }}
              onOpenSettings={onOpenSettings}
            />
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function PaletteBody({
  initial,
  onRun,
  onOpenSettings,
}: {
  initial: string;
  onRun: (fn: () => void) => void;
  onOpenSettings: (tab?: string) => void;
}) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { manifest, result, components, id, panels } = useEditor();
  const update = useApp((s) => s.update);
  const mode = 'open';

  const isCommands = query.startsWith('>');
  const q = (isCommands ? query.slice(1) : query).trim();

  const items: Item[] = useMemo(() => {
    if (!mode) return [];
    const kind = manifest?.document.kind ?? 'markdoc';
    const exp = (format: 'pdf' | 'html' | 'typst') => async () => {
      await saveNow();
      await exportDocument(id, format, manifest?.document.title ?? t('Dokument'));
    };
    if (isCommands) {
      const cmds: Item[] = [
        {
          id: 'save',
          label: t('Speichern und neu übersetzen'),
          icon: <RefreshCw />,
          keys: 'Mod S',
          group: t('Dokument'),
          run: () => void saveAndCompile(),
        },
        { id: 'pdf', label: t('PDF herunterladen'), icon: <FileDown />, group: t('Export'), run: exp('pdf') },
        ...(kind === 'markdoc' && manifest?.html.enabled
          ? [{ id: 'html', label: t('HTML5-Paket herunterladen'), icon: <Globe />, group: t('Export'), run: exp('html') }]
          : []),
        ...(kind === 'markdoc' ? [{ id: 'typst', label: t('Typst-Quelle exportieren'), icon: <FileCode2 />, group: t('Export'), run: exp('typst') }] : []),
        { id: 'prev-pdf', label: t('Vorschau: PDF'), icon: <FileText />, group: t('Ansicht'), run: () => useEditor.setState({ previewMode: 'pdf' }) },
        ...(kind === 'markdoc'
          ? [{ id: 'prev-html', label: t('Vorschau: HTML'), icon: <Globe />, group: t('Ansicht'), run: () => useEditor.setState({ previewMode: 'html' }) }]
          : []),
        {
          id: 'sidebar',
          label: panels.sidebar ? t('Seitenleiste ausblenden') : t('Seitenleiste einblenden'),
          icon: <PanelLeft />,
          keys: 'Mod Shift B',
          group: t('Ansicht'),
          run: () => setPanels({ sidebar: !panels.sidebar }),
        },
        {
          id: 'preview',
          label: panels.preview ? t('Vorschau ausblenden') : t('Vorschau einblenden'),
          icon: <PanelRight />,
          keys: 'Mod \\',
          group: t('Ansicht'),
          run: () => setPanels({ preview: !panels.preview }),
        },
        {
          id: 'problems',
          label: t('Probleme anzeigen'),
          icon: <TriangleAlert />,
          keys: 'Mod J',
          group: t('Ansicht'),
          run: () => setPanels({ problems: true }),
        },
        { id: 'git', label: t('Versionen öffnen'), icon: <GitBranch />, keys: 'Mod Shift G', group: t('Versionen'), run: () => setPanels({ git: true }) },
        { id: 'settings', label: t('Dokumenteinstellungen'), icon: <Settings2 />, group: t('Dokument'), run: () => onOpenSettings('general') },
        { id: 'pdfsettings', label: t('PDF-Einstellungen'), icon: <FileText />, group: t('Dokument'), run: () => onOpenSettings('pdf') },
        ...(kind === 'markdoc'
          ? [
              { id: 'htmlsettings', label: t('HTML-Einstellungen'), icon: <Globe />, group: t('Dokument'), run: () => onOpenSettings('html') },
              { id: 'vars', label: t('Variablen bearbeiten'), icon: <Variable />, group: t('Dokument'), run: () => onOpenSettings('variables') },
            ]
          : []),
        { id: 'light', label: t('Farbschema: Hell'), icon: <Sun />, group: t('Darstellung'), run: () => update({ theme: 'light' }) },
        { id: 'dark', label: t('Farbschema: Dunkel'), icon: <Moon />, group: t('Darstellung'), run: () => update({ theme: 'dark' }) },
        { id: 'system', label: t('Farbschema: System'), icon: <Monitor />, group: t('Darstellung'), run: () => update({ theme: 'system' }) },
        {
          id: 'back',
          label: t('Zur Übersicht'),
          icon: <ArrowLeft />,
          group: t('Navigation'),
          run: () => void saveNow().then(() => navigate(routes.library())),
        },
      ];
      const active = useEditor.getState().active;
      if (active && fileKind(active) === 'markdoc') {
        for (const c of components.filter((c) => !c.parents?.length)) {
          cmds.push({
            id: `el-${c.name}`,
            label: t('Element einfügen: {name}', { name: c.title ?? c.name }),
            hint: c.name,
            icon: <Blocks />,
            group: t('Einfügen'),
            run: () => {
              const v = getView();
              if (v) insertText(v, componentSnippet(c), !c.inline);
            },
          });
        }
      }
      return cmds;
    }
    // Dateien und Überschriften
    const titles = new Map((result?.outline ?? []).map((o) => [o.path, o.title]));
    const files: Item[] = allFiles().map((p) => ({
      id: p,
      label: titles.get(p) ?? basename(p),
      hint: p,
      icon: fileKind(p) === 'typst' ? <FileCode2 /> : <FileText />,
      group: t('Dateien'),
      run: () => void openFile(p),
    }));
    const headings: Item[] = (result?.outline ?? []).flatMap((o) =>
      o.headings
        .filter((h) => h.level >= 2 && h.level <= 3)
        .map((h) => ({
          id: `${o.path}#${h.id}`,
          label: h.text,
          hint: o.title,
          icon: <Hash />,
          group: t('Überschriften'),
          run: () => void reveal(o.path, h.line ?? 1),
        })),
    );
    return [...files, ...headings];
  }, [mode, isCommands, manifest, result, components, id, panels, onOpenSettings, update]);

  const filtered = useMemo(() => {
    return items
      .map((i) => ({ i, s: Math.max(score(i.label, q), score(i.hint ?? '', q) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.i);
  }, [items, q]);

  useEffect(() => setIndex(0), [q, isCommands]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const runItem = (it: Item | undefined) => {
    if (!it) return;
    onRun(it.run);
  };

  return (
    <>
          <div className="palette__input">
            <Search />
            <input
              autoFocus
              value={query}
              placeholder={isCommands ? t('Befehl suchen…') : t('Datei oder Überschrift suchen… (> für Befehle)')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(i + 1, filtered.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  runItem(filtered[index]);
                }
              }}
              aria-label={t('Suche')}
            />
          </div>
          <div className="palette__list" ref={listRef} role="listbox">
            {filtered.length === 0 && <div className="palette__empty">{t('Keine Treffer')}</div>}
            {filtered.map((it, i) => {
              const showGroup = i === 0 || filtered[i - 1].group !== it.group;
              return (
                <div key={it.id}>
                  {showGroup && <div className="palette__group">{it.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    data-index={i}
                    className="palette__item"
                    onMouseMove={() => setIndex(i)}
                    onClick={() => runItem(it)}
                  >
                    {it.icon}
                    <span className="palette__label">{it.label}</span>
                    {it.hint && <span className="palette__hint">{it.hint}</span>}
                    {it.keys && <span className="palette__keys">{shortcut(it.keys)}</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="palette__foot">
            <span>
              <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> {t('auswählen')}
            </span>
            <span>
              <kbd className="kbd">Enter</kbd> {t('ausführen')}
            </span>
            <span>
              <kbd className="kbd">&gt;</kbd> {t('Befehle')}
            </span>
          </div>
    </>
  );
}
