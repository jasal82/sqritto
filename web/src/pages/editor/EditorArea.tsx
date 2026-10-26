import { EditorView } from '@codemirror/view';
import { Blocks, FileQuestion, FileText, ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { basename, fileSize, shortcut } from '../../lib/format';
import { t } from '../../lib/i18n';
import { toast } from '../../lib/store';
import { Empty } from '../../ui';
import { attachView, closeTab, elementName, fileKind, getView, isElementTab, openFile, refreshTree, tabOwns, useEditor } from './store';
import { ElementEditor } from './element/ElementEditor';
import { Toolbar } from './Toolbar';
import { image as insertImage } from '../../editor/commands';

export function EditorArea() {
  const { tabs, active, dirty } = useEditor();
  const kind = active ? fileKind(active) : null;
  const isDirty = (tab: string) => (isElementTab(tab) ? Object.keys(dirty).some((p) => tabOwns(tab, p)) : !!dirty[tab]);
  const label = (tab: string) => (isElementTab(tab) ? elementName(tab) : basename(tab));
  return (
    <div className="ed-area">
      <div className="ed-tabs" role="tablist" aria-label={t('Geöffnete Dateien')}>
        {tabs.map((tab) => (
          <div
            key={tab}
            role="tab"
            aria-selected={tab === active}
            className={`ed-tab${isElementTab(tab) ? ' ed-tab--element' : ''}`}
            title={isElementTab(tab) ? t('Element „{name}“', { name: elementName(tab) }) : tab}
            onClick={() => void openFile(tab)}
            onAuxClick={(e) => e.button === 1 && closeTab(tab)}
          >
            {isElementTab(tab) && <Blocks className="ed-tab__icon" aria-hidden />}
            <span className="ed-tab__name">{label(tab)}</span>
            {isDirty(tab) ? (
              <span className="ed-tab__dot" aria-label={t('Ungespeichert')} />
            ) : (
              <button
                type="button"
                className="ed-tab__close"
                aria-label={t('{name} schließen', { name: label(tab) })}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab);
                }}
              >
                <X />
              </button>
            )}
          </div>
        ))}
      </div>
      {(kind === 'markdoc' || kind === 'typst') && <Toolbar flavor={kind} />}
      {kind === 'element' ? (
        <ElementEditor key={active} name={elementName(active!)} />
      ) : (
      <div className="ed-surface">
        <CodeView hidden={!active || kind === 'image' || kind === 'binary'} />
        {active && kind === 'image' && <ImageView path={active} />}
        {active && kind === 'binary' && (
          <Empty icon={<FileQuestion />} title={basename(active)}>
            {t('Diese Datei kann im Editor nicht bearbeitet werden.')}
          </Empty>
        )}
        {!active && (
          <Empty icon={<FileText />} title={t('Keine Datei geöffnet')}>
            {t('Wähle links eine Seite oder Datei aus oder drücke {keys} für die Schnellauswahl.', { keys: shortcut('Mod+P') })}
          </Empty>
        )}
      </div>
      )}
    </div>
  );
}

export function CodeView({ hidden }: { hidden: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({ parent: host.current });
    attachView(view);
    return () => {
      attachView(null);
      view.destroy();
    };
  }, []);

  // Bilder per Drag & Drop oder Einfügen hochladen und einbinden
  const uploadAndInsert = async (files: File[]) => {
    const st = useEditor.getState();
    const flavor = st.active ? fileKind(st.active) : null;
    if (flavor !== 'markdoc' && flavor !== 'typst') return;
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(svg|png|jpe?g|gif|webp)$/i.test(f.name));
    if (!images.length) return;
    try {
      const res = await api.upload(st.id, images, 'assets');
      void refreshTree();
      const v = getView();
      if (!v) return;
      for (const p of res.files) {
        const rel = flavor === 'markdoc' ? relFrom(st.active!, p) : `/${p}`;
        insertImage(v, flavor, rel);
      }
      toast.success(res.files.length === 1 ? t('Bild eingefügt') : t('{n} Bilder eingefügt', { n: res.files.length }), res.files.join(', '));
    } catch (e) {
      toast.error(t('Hochladen fehlgeschlagen'), e);
    }
  };

  return (
    <div
      ref={host}
      className={`ed-code${dragOver ? ' is-dragover' : ''}`}
      hidden={hidden}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void uploadAndInsert([...e.dataTransfer.files]);
        }
      }}
      onPaste={(e) => {
        const files = [...e.clipboardData.files];
        if (files.length) {
          e.preventDefault();
          void uploadAndInsert(files);
        }
      }}
    />
  );
}

export function relFrom(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

function ImageView({ path }: { path: string }) {
  const id = useEditor((s) => s.id);
  const [meta, setMeta] = useState<{ w: number; h: number } | null>(null);
  const node = findNode(useEditor.getState().tree, path);
  return (
    <div className="ed-image">
      <div className="ed-image__canvas">
        <img src={api.rawUrl(id, path)} alt={basename(path)} onLoad={(e) => setMeta({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      </div>
      <div className="ed-image__info">
        <ImageIcon />
        <span>{path}</span>
        {meta && (
          <span>
            {meta.w} × {meta.h} px
          </span>
        )}
        {node && <span>{fileSize(node.size)}</span>}
      </div>
    </div>
  );
}

function findNode(nodes: import('../../lib/types').FileNode[], path: string): import('../../lib/types').FileNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const f = findNode(n.children, path);
      if (f) return f;
    }
  }
  return null;
}
