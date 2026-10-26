import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate, routes } from '../../lib/router';
import { useServerEvents } from '../../lib/events';
import { t } from '../../lib/i18n';
import { isManifest } from '../../lib/format';
import { useApp } from '../../lib/store';
import { Button, Empty, Resizer } from '../../ui';
import {
  applyPrefs,
  compileNow,
  hasUnsaved,
  isElementTab,
  loadDocument,
  refreshComponents,
  refreshManifest,
  refreshTree,
  reloadFromDisk,
  saveAndCompile,
  setPanels,
  useEditor,
} from './store';
import { EditorHeader } from './EditorHeader';
import { Sidebar } from './Sidebar';
import { ActivityBar } from './ActivityBar';
import { EditorArea } from './EditorArea';
import { Preview } from './Preview';
import { StatusBar } from './StatusBar';
import { ProblemsPanel } from './ProblemsPanel';
import { GitPanel } from './GitPanel';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { DocSettingsDialog } from './DocSettingsDialog';
import { api } from '../../lib/api';

function usePersistentNumber(key: string, initial: number) {
  const [v, setV] = useState(() => {
    const s = Number(localStorage.getItem(key));
    return Number.isFinite(s) && s > 0 ? s : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* ignorieren */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export default function EditorPage({ id, initialFile }: { id: string; initialFile?: string }) {
  const { loadError, panels, detail } = useEditor();
  // Die Element-Ansicht bringt ihre eigene Vorschau mit.
  const elementActive = useEditor((s) => !!s.active && isElementTab(s.active));
  const settings = useApp((s) => s.settings);
  const [sidebarW, setSidebarW] = usePersistentNumber('sqritto-sidebar-w', 264);
  const [previewW, setPreviewW] = usePersistentNumber('sqritto-preview-w', Math.round(window.innerWidth * 0.42));
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [docSettings, setDocSettings] = useState<string | null>(null);

  useEffect(() => {
    void loadDocument(id, initialFile);
    return () => {
      void api.unwatch(id).catch(() => undefined);
    };
  }, [id, initialFile]);

  useEffect(() => {
    applyPrefs();
  }, [settings.lineNumbers, settings.wordWrap]);

  // Warnung bei ungespeicherten Änderungen
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) {
        void saveAndCompile();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void saveAndCompile();
      } else if (k === 'p' && !e.shiftKey) {
        e.preventDefault();
        setPalette('files');
      } else if ((k === 'p' && e.shiftKey) || (k === 'k' && !e.shiftKey)) {
        e.preventDefault();
        setPalette('commands');
      } else if (k === 'b' && e.shiftKey) {
        e.preventDefault();
        setPanels({ sidebar: !useEditor.getState().panels.sidebar });
      } else if (k === 'j') {
        e.preventDefault();
        setPanels({ problems: !useEditor.getState().panels.problems });
      } else if (k === 'g' && e.shiftKey) {
        e.preventDefault();
        setPanels({ git: !useEditor.getState().panels.git });
      } else if (k === '\\' || (k === 'v' && e.shiftKey && e.altKey)) {
        e.preventDefault();
        setPanels({ preview: !useEditor.getState().panels.preview });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Änderungen von außen (anderer Editor, git pull …)
  useServerEvents((e) => {
    if (e.type !== 'files-changed' || e.id !== id) return;
    void refreshTree();
    let recompile = false;
    for (const p of e.paths) {
      void reloadFromDisk(p);
      if (isManifest(p)) void refreshManifest();
      if (p.startsWith('components/')) void refreshComponents();
      recompile = true;
    }
    if (recompile) void compileNow();
  });

  if (loadError) {
    return (
      <div className="editor-error">
        <Empty
          icon={<AlertTriangle />}
          title={t('Dokument konnte nicht geöffnet werden')}
          actions={
            <Button icon={<ArrowLeft />} onClick={() => navigate(routes.library())}>
              {t('Zur Übersicht')}
            </Button>
          }
        >
          {loadError}
        </Empty>
      </div>
    );
  }

  return (
    <div className="editor" style={{ ['--editor-font-size' as string]: `${settings.editorFontSize}px` }}>
      <EditorHeader onOpenSettings={(tab) => setDocSettings(tab ?? 'general')} onPalette={() => setPalette('commands')} />
      <div className="editor__body">
        <ActivityBar onOpenSettings={() => setDocSettings('general')} />
        {panels.sidebar && (
          <>
            <div className="editor__sidebar" style={{ width: sidebarW }}>
              <Sidebar onOpenSettings={(tab) => setDocSettings(tab)} />
            </div>
            <Resizer
              label={t('Breite der Seitenleiste')}
              onResize={(d) => setSidebarW((w) => Math.max(200, Math.min(480, w + d)))}
              onDoubleClick={() => setSidebarW(264)}
            />
          </>
        )}
        <div className="editor__main">
          <EditorArea />
          {panels.problems && <ProblemsPanel />}
        </div>
        {panels.preview && detail && !elementActive && (
          <>
            <Resizer
              label={t('Breite der Vorschau')}
              side="left"
              onResize={(d) => setPreviewW((w) => Math.max(320, Math.min(window.innerWidth - 480, w + d)))}
              onDoubleClick={() => setPreviewW(Math.round(window.innerWidth * 0.42))}
            />
            <div className="editor__preview" style={{ width: previewW }}>
              <Preview />
            </div>
          </>
        )}
        {panels.git && <GitPanel onClose={() => setPanels({ git: false })} />}
      </div>
      <StatusBar />
      <CommandPalette mode={palette} onClose={() => setPalette(null)} onOpenSettings={(tab) => setDocSettings(tab ?? 'general')} />
      <DocSettingsDialog tab={docSettings} onClose={() => setDocSettings(null)} />
    </div>
  );
}
