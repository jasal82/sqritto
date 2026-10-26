import * as RContext from '@radix-ui/react-context-menu';
import {
  ChevronRight,
  Copy,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Hash,
  ImageIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  FileJson,
  Palette,
  Wrench,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { basename, dirname, extname, isManifest, slugify } from '../../lib/format';
import { t } from '../../lib/i18n';
import { toast, useApp } from '../../lib/store';
import type { ComponentDef, FileNode, NavSection } from '../../lib/types';
import { Button, confirm, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, prompt } from '../../ui';
import { componentSnippet } from '../../editor/markdoc';
import { RichText } from '../common';
import { insertText } from '../../editor/commands';
import {
  compileNow,
  fileKind,
  getView,
  openElement,
  openFile,
  refreshComponents,
  refreshManifest,
  refreshTree,
  removed,
  renamed,
  reveal,
  useEditor,
} from './store';
import { viewTitle } from './ActivityBar';

export function Sidebar({ onOpenSettings }: { onOpenSettings: (tab: string) => void }) {
  const tab = useEditor((s) => s.sidebarTab);
  const kind = useEditor((s) => s.manifest?.document.kind ?? 'markdoc');
  const view = tab === 'elements' && kind !== 'markdoc' ? 'files' : tab;
  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <h2>{viewTitle(view)}</h2>
      </div>
      <div className="sidebar__body">
        {view === 'files' && (
          <>
            {kind === 'markdoc' && <PagesSection onOpenSettings={onOpenSettings} />}
            <FilesSection />
          </>
        )}
        {view === 'outline' && <OutlineSection />}
        {view === 'elements' && <ElementsSection />}
      </div>
    </div>
  );
}

function Section({ title, actions, children, defaultOpen = true }: { title: string; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="sb-section">
      <div className="sb-section__head">
        <button type="button" className="sb-section__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight className="sb-chevron" />
          {title}
        </button>
        <div className="sb-section__actions">{actions}</div>
      </div>
      {open && <div className="sb-section__body">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Seiten (Navigation) für Markdoc-Dokumente
// ---------------------------------------------------------------------------

type DragItem = { section: number; index: number } | null;

function PagesSection({ onOpenSettings }: { onOpenSettings: (tab: string) => void }) {
  const { manifest, result, active, tree, id } = useEditor();
  const [drag, setDrag] = useState<DragItem>(null);
  const [over, setOver] = useState<{ section: number; index: number } | null>(null);
  const content = manifest?.markdoc.content ?? 'content';

  const allPages = useMemo(() => {
    const out: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file' && /\.(mdoc|md)$/.test(n.path) && n.path.startsWith(`${content}/`)) {
          const rel = n.path.slice(content.length + 1);
          if (!rel.startsWith('partials/') && !rel.startsWith('_')) out.push(rel);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree, content]);

  // Navigation inkl. nicht zugeordneter Seiten
  const nav: NavSection[] = useMemo(() => {
    const sections = (manifest?.markdoc.nav ?? []).map((s) => ({ title: s.title, pages: s.pages.filter((p) => allPages.includes(p)) }));
    const used = new Set(sections.flatMap((s) => s.pages));
    const rest = allPages.filter((p) => !used.has(p));
    if (rest.length) sections.push({ title: sections.length ? t('Nicht zugeordnet') : null, pages: rest });
    return sections;
  }, [manifest, allPages]);

  const titleOf = (rel: string) => result?.outline.find((o) => o.path === `${content}/${rel}`)?.title ?? basename(rel).replace(/\.(mdoc|md)$/, '');

  const saveNav = async (next: NavSection[]) => {
    try {
      await api.patchManifest(id, {
        markdoc: { nav: next.filter((s) => s.pages.length || s.title).map((s) => ({ ...(s.title ? { title: s.title } : {}), pages: s.pages })) },
      });
      await refreshManifest();
      void compileNow();
    } catch (e) {
      toast.error(t('Navigation konnte nicht gespeichert werden'), e);
    }
  };

  const move = (from: { section: number; index: number }, to: { section: number; index: number }) => {
    const next = nav.map((s) => ({ ...s, pages: [...s.pages] }));
    const [item] = next[from.section].pages.splice(from.index, 1);
    let idx = to.index;
    if (from.section === to.section && from.index < to.index) idx--;
    next[to.section].pages.splice(idx, 0, item);
    void saveNav(next.map((s) => (s.title === t('Nicht zugeordnet') ? { ...s, title: t('Weitere Seiten') } : s)));
  };

  const addPage = async (section?: number) => {
    const title = await prompt({ title: t('Neue Seite'), label: t('Titel der Seite'), placeholder: t('z. B. Installation'), confirm: t('Anlegen') });
    if (!title) return;
    let file = `${slugify(title)}.mdoc`;
    let n = 2;
    while (allPages.includes(file)) file = `${slugify(title)}-${n++}.mdoc`;
    try {
      await api.fileOp(id, { action: 'create', path: `${content}/${file}`, content: `# ${title}\n\n` });
      const next = nav.map((s) => ({ ...s, pages: [...s.pages] }));
      const target = section ?? Math.max(0, next.length - 1);
      if (!next.length) next.push({ title: null, pages: [] });
      next[Math.min(target, next.length - 1)].pages.push(file);
      await saveNav(next);
      await refreshTree();
      await openFile(`${content}/${file}`, 3);
    } catch (e) {
      toast.error(t('Seite konnte nicht angelegt werden'), e);
    }
  };

  const addSection = async () => {
    const title = await prompt({ title: t('Neuer Abschnitt'), label: t('Name des Abschnitts'), placeholder: t('z. B. Referenz'), confirm: t('Anlegen') });
    if (!title) return;
    await saveNav([...nav, { title, pages: [] }]);
  };

  const renameSection = async (i: number) => {
    const title = await prompt({ title: t('Abschnitt umbenennen'), label: t('Name'), value: nav[i].title ?? '' });
    if (title === null) return;
    const next = nav.map((s, j) => (j === i ? { ...s, title } : s));
    await saveNav(next);
  };

  const removeSection = async (i: number) => {
    const next = nav.map((s) => ({ ...s, pages: [...s.pages] }));
    const [sec] = next.splice(i, 1);
    if (next.length) next[Math.max(0, i - 1)].pages.push(...sec.pages);
    else next.push({ title: null, pages: sec.pages });
    await saveNav(next);
  };

  return (
    <Section
      title={t('Seiten')}
      actions={
        <>
          <IconButton label={t('Neue Seite')} onClick={() => addPage()}>
            <FilePlus2 />
          </IconButton>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" iconOnly aria-label={t('Weitere Aktionen')}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<FolderPlus />} onSelect={addSection}>
                {t('Abschnitt hinzufügen')}
              </MenuItem>
              <MenuItem icon={<Wrench />} onSelect={() => onOpenSettings('variables')}>
                {t('Variablen bearbeiten')}
              </MenuItem>
            </MenuContent>
          </Menu>
        </>
      }
    >
      {nav.length === 0 && (
        <div className="sb-empty">
          {t('Noch keine Seiten.')}{' '}
          <button type="button" className="sb-link" onClick={() => addPage()}>
            {t('Erste Seite anlegen')}
          </button>
        </div>
      )}
      {nav.map((sec, si) => (
        <div
          key={si}
          className="sb-navsec"
          onDragOver={(e) => {
            if (drag && !sec.pages.length) {
              e.preventDefault();
              setOver({ section: si, index: 0 });
            }
          }}
          onDrop={(e) => {
            if (drag && !sec.pages.length) {
              e.preventDefault();
              move(drag, { section: si, index: 0 });
            }
            setDrag(null);
            setOver(null);
          }}
        >
          {sec.title && (
            <RContext.Root>
              <RContext.Trigger asChild>
                <div className="sb-navsec__title">
                  <span>{sec.title}</span>
                  <button
                    type="button"
                    className="sb-navsec__add"
                    aria-label={t('Seite zu {section} hinzufügen', { section: sec.title })}
                    onClick={() => addPage(si)}
                  >
                    <Plus />
                  </button>
                </div>
              </RContext.Trigger>
              <RContext.Portal>
                <RContext.Content className="menu">
                  <RContext.Item className="menu__item" onSelect={() => addPage(si)}>
                    <FilePlus2 /> {t('Neue Seite')}
                  </RContext.Item>
                  <RContext.Item className="menu__item" onSelect={() => renameSection(si)}>
                    <Pencil /> {t('Umbenennen')}
                  </RContext.Item>
                  <RContext.Separator className="menu__sep" />
                  <RContext.Item className="menu__item menu__item--danger" onSelect={() => removeSection(si)}>
                    <Trash2 /> {t('Abschnitt auflösen')}
                  </RContext.Item>
                </RContext.Content>
              </RContext.Portal>
            </RContext.Root>
          )}
          {sec.pages.map((p, pi) => {
            const path = `${content}/${p}`;
            const isOver = over && over.section === si && over.index === pi;
            return (
              <FileContextMenu key={p} path={path} kind="file">
                <div
                  className={`sb-page${active === path ? ' is-active' : ''}${isOver ? ' is-over' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDrag({ section: si, index: pi });
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > rect.top + rect.height / 2;
                    setOver({ section: si, index: pi + (after ? 1 : 0) });
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag && over) move(drag, over);
                    setDrag(null);
                    setOver(null);
                  }}
                  onClick={() => void openFile(path)}
                  title={path}
                >
                  <GripVertical className="sb-page__grip" />
                  <FileText className="sb-page__icon" />
                  <span className="sb-page__title">{titleOf(p)}</span>
                </div>
              </FileContextMenu>
            );
          })}
          {over && over.section === si && over.index === sec.pages.length && sec.pages.length > 0 && <div className="sb-drop-line" />}
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Dateibaum
// ---------------------------------------------------------------------------

function iconFor(path: string, isDir: boolean, open: boolean) {
  if (isDir) return open ? <FolderOpen className="fi fi--dir" /> : <Folder className="fi fi--dir" />;
  const kind = fileKind(path);
  const ext = extname(path);
  if (kind === 'markdoc') return <FileText className="fi fi--mdoc" />;
  if (kind === 'typst') return <FileCode2 className="fi fi--typ" />;
  if (kind === 'image') return <ImageIcon className="fi fi--img" />;
  if (ext === 'json' || ext === 'toml') return <FileJson className="fi fi--cfg" />;
  if (ext === 'css' || ext === 'html') return <Palette className="fi fi--web" />;
  return <File className="fi" />;
}

function FilesSection() {
  const { tree, id } = useEditor();
  const upload = useRef<HTMLInputElement>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const doUpload = async (files: File[], dir: string) => {
    try {
      const res = await api.upload(id, files, dir);
      await refreshTree();
      toast.success(res.files.length === 1 ? t('Datei hochgeladen') : t('{n} Dateien hochgeladen', { n: res.files.length }), res.files.join(', '));
    } catch (e) {
      toast.error(t('Hochladen fehlgeschlagen'), e);
    }
  };

  return (
    <Section
      title={t('Alle Dateien')}
      actions={
        <>
          <IconButton label={t('Neue Datei')} onClick={() => newFile('')}>
            <FilePlus2 />
          </IconButton>
          <IconButton label={t('Neuer Ordner')} onClick={() => newFolder('')}>
            <FolderPlus />
          </IconButton>
          <IconButton label={t('Dateien hochladen (nach assets/)')} onClick={() => upload.current?.click()}>
            <Upload />
          </IconButton>
          <input
            ref={upload}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void doUpload([...e.target.files], 'assets');
              e.target.value = '';
            }}
          />
        </>
      }
    >
      <div
        className={`sb-tree${dragTarget === '' ? ' is-drop' : ''}`}
        role="tree"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragTarget((t) => t ?? '');
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragTarget(null);
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            void doUpload([...e.dataTransfer.files], dragTarget || 'assets');
          }
          setDragTarget(null);
        }}
      >
        {tree.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} dragTarget={dragTarget} setDragTarget={setDragTarget} />
        ))}
      </div>
    </Section>
  );
}

function TreeNode({
  node,
  depth,
  dragTarget,
  setDragTarget,
}: {
  node: FileNode;
  depth: number;
  dragTarget: string | null;
  setDragTarget: (p: string | null) => void;
}) {
  const active = useEditor((s) => s.active);
  const dirty = useEditor((s) => s.dirty[node.path]);
  const [open, setOpen] = useState(() => depth === 0 && ['content', 'assets', 'components'].includes(node.name));
  const isDir = node.kind === 'dir';
  return (
    <>
      <FileContextMenu path={node.path} kind={node.kind}>
        <div
          role="treeitem"
          aria-expanded={isDir ? open : undefined}
          aria-selected={active === node.path}
          tabIndex={0}
          className={`sb-node${active === node.path ? ' is-active' : ''}${dragTarget === node.path ? ' is-drop' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => (isDir ? setOpen(!open) : void openFile(node.path))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') isDir ? setOpen(!open) : void openFile(node.path);
          }}
          onDragOver={(e) => {
            if (isDir && e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.stopPropagation();
              setDragTarget(node.path);
            }
          }}
          title={node.path}
        >
          {isDir ? <ChevronRight className={`sb-chevron${open ? ' is-open' : ''}`} /> : <span className="sb-chevron-space" />}
          {iconFor(node.path, isDir, open)}
          <span className="sb-node__name">{node.name}</span>
          {dirty && <span className="sb-node__dot" aria-label={t('Ungespeichert')} />}
        </div>
      </FileContextMenu>
      {isDir &&
        open &&
        node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} dragTarget={dragTarget} setDragTarget={setDragTarget} />)}
    </>
  );
}

async function newFile(dir: string) {
  const id = useEditor.getState().id;
  const name = await prompt({
    title: t('Neue Datei'),
    label: t('Dateiname'),
    placeholder: dir.startsWith('content') ? t('seite.mdoc') : t('datei.typ'),
    value: dir ? `${dir}/` : '',
    confirm: t('Anlegen'),
    validate: (v) => (/[<>:"|?*\\]/.test(v) ? t('Der Name enthält ungültige Zeichen.') : null),
  });
  if (!name) return;
  const path = name.replace(/^\/+/, '');
  const initial = /\.(mdoc|md)$/.test(path) ? `# ${basename(path).replace(/\.\w+$/, '')}\n\n` : '';
  try {
    await api.fileOp(id, { action: 'create', path, content: initial });
    await refreshTree();
    await openFile(path);
    void compileNow();
  } catch (e) {
    toast.error(t('Datei konnte nicht angelegt werden'), e);
  }
}

async function newFolder(dir: string) {
  const id = useEditor.getState().id;
  const name = await prompt({ title: t('Neuer Ordner'), label: t('Ordnername'), value: dir ? `${dir}/` : '', confirm: t('Anlegen') });
  if (!name) return;
  try {
    await api.fileOp(id, { action: 'mkdir', path: name.replace(/^\/+/, '') });
    await refreshTree();
  } catch (e) {
    toast.error(t('Ordner konnte nicht angelegt werden'), e);
  }
}

function FileContextMenu({ path, kind, children }: { path: string; kind: 'file' | 'dir'; children: ReactNode }) {
  const info = useApp((s) => s.info);
  const id = useEditor((s) => s.id);
  const dir = kind === 'dir' ? path : dirname(path);

  const rename = async () => {
    const to = await prompt({ title: t('Umbenennen'), label: t('Neuer Pfad'), value: path, selectBase: true, confirm: t('Umbenennen') });
    if (!to || to === path) return;
    try {
      await api.fileOp(id, { action: 'rename', path, to });
      renamed(path, to);
      // Navigation nachziehen
      const m = useEditor.getState().manifest;
      const content = m?.markdoc.content ?? 'content';
      if (m && path.startsWith(`${content}/`) && to.startsWith(`${content}/`)) {
        const a = path.slice(content.length + 1);
        const b = to.slice(content.length + 1);
        if (m.markdoc.nav.some((s) => s.pages.includes(a))) {
          await api.patchManifest(id, {
            markdoc: { nav: m.markdoc.nav.map((s) => ({ ...(s.title ? { title: s.title } : {}), pages: s.pages.map((p) => (p === a ? b : p)) })) },
          });
          await refreshManifest();
        }
      }
      await refreshTree();
      void compileNow();
    } catch (e) {
      toast.error(t('Umbenennen fehlgeschlagen'), e);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('„{name}“ löschen?', { name: basename(path) }),
      description: kind === 'dir' ? t('Der Ordner und sein Inhalt werden in den Papierkorb verschoben.') : t('Die Datei wird in den Papierkorb verschoben.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.fileOp(id, { action: 'delete', path });
      removed(path);
      await refreshTree();
      void compileNow();
    } catch (e) {
      toast.error(t('Löschen fehlgeschlagen'), e);
    }
  };

  const copyPath = () => {
    void navigator.clipboard.writeText(path);
    toast.success(t('Pfad kopiert'), path);
  };

  const insertReference = () => {
    const v = getView();
    const active = useEditor.getState().active;
    if (!v || !active) return;
    const flavor = fileKind(active);
    const rel = relativeTo(active, path);
    if (fileKind(path) === 'image') {
      insertText(v, flavor === 'typst' ? `#image("/${path}", width: 80%)` : `![${basename(path)}](${rel})`, true);
    } else if (fileKind(path) === 'markdoc') {
      insertText(v, `[\${Linktext}](${rel})`);
    } else {
      insertText(v, flavor === 'typst' ? `"/${path}"` : rel);
    }
  };

  return (
    <RContext.Root>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content className="menu">
          {kind === 'file' && (
            <RContext.Item className="menu__item" onSelect={insertReference}>
              <Hash /> {t('An Cursor einfügen')}
            </RContext.Item>
          )}
          <RContext.Item className="menu__item" onSelect={() => newFile(dir)}>
            <FilePlus2 /> {t('Neue Datei hier')}
          </RContext.Item>
          <RContext.Item className="menu__item" onSelect={() => newFolder(dir)}>
            <FolderPlus /> {t('Neuer Ordner hier')}
          </RContext.Item>
          <RContext.Separator className="menu__sep" />
          <RContext.Item className="menu__item" onSelect={rename}>
            <Pencil /> {t('Umbenennen / Verschieben')}
          </RContext.Item>
          <RContext.Item className="menu__item" onSelect={copyPath}>
            <Copy /> {t('Pfad kopieren')}
          </RContext.Item>
          {info?.mode === 'local' && (
            <RContext.Item className="menu__item" onSelect={() => void api.reveal(id, path)}>
              <FolderOpen /> {t('Im Explorer zeigen')}
            </RContext.Item>
          )}
          {!isManifest(path) && (
            <>
              <RContext.Separator className="menu__sep" />
              <RContext.Item className="menu__item menu__item--danger" onSelect={remove}>
                <Trash2 /> {t('Löschen')}
              </RContext.Item>
            </>
          )}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

function relativeTo(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

// ---------------------------------------------------------------------------
// Gliederung
// ---------------------------------------------------------------------------

function OutlineSection() {
  const { result, active, manifest } = useEditor();
  const [text, setText] = useState('');
  const isTypst = active ? fileKind(active) === 'typst' : false;

  // Für Typst-Dateien Überschriften direkt aus dem Text lesen.
  useMemo(() => {
    if (isTypst) {
      const v = getView();
      setText(v?.state.doc.toString() ?? '');
    }
  }, [isTypst, active, result?.version]);

  if (isTypst) {
    const headings = text
      .split('\n')
      .map((l, i) => ({ m: /^(=+)\s+(.*?)(\s*<[\w\-:.]+>)?\s*$/.exec(l), line: i + 1 }))
      .filter((x) => x.m)
      .map((x) => ({ level: x.m![1].length, text: x.m![2], line: x.line }));
    return (
      <Section title={t('Überschriften')}>
        {headings.length ? (
          headings.map((h, i) => (
            <button key={i} type="button" className={`sb-heading sb-heading--l${Math.min(h.level, 4)}`} onClick={() => void reveal(active!, h.line)}>
              {h.text}
            </button>
          ))
        ) : (
          <div className="sb-empty">{t('Keine Überschriften in dieser Datei.')}</div>
        )}
      </Section>
    );
  }

  const outline = result?.outline ?? [];
  if (!outline.length) return <div className="sb-empty">{t('Die Gliederung erscheint nach der ersten Übersetzung.')}</div>;
  return (
    <>
      {outline.map((page) => (
        <Section key={page.path} title={page.title} defaultOpen={page.path === active || outline.length < 4}>
          {page.headings
            .filter((h) => h.level <= 4)
            .map((h, i) => (
              <button
                key={i}
                type="button"
                className={`sb-heading sb-heading--l${h.level}`}
                onClick={() => void reveal(page.path, h.line ?? 1)}
                title={`${page.path}:${h.line}`}
              >
                {h.text}
              </button>
            ))}
          {!page.headings.length && <div className="sb-empty">{t('Keine Überschriften.')}</div>}
        </Section>
      ))}
      {manifest && <div className="sb-hint">{t('Klicke eine Überschrift an, um im Editor dorthin zu springen.')}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Elemente (Markdoc-Komponenten)
// ---------------------------------------------------------------------------

function ElementsSection() {
  const { components, id } = useEditor();
  const [openName, setOpenName] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ComponentDef[]>();
    const own = t('Eigene Elemente');
    for (const c of components) {
      const cat = c.source === 'local' ? own : (c.category ?? t('Weitere'));
      map.set(cat, [...(map.get(cat) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)));
  }, [components]);

  const create = async (from?: string) => {
    const name = await prompt({
      title: from ? t('„{name}“ anpassen', { name: from }) : t('Neues Element'),
      description: from
        ? t('Kopiert das eingebaute Element in dieses Dokument. Die Kopie hat Vorrang und kann frei angepasst werden.')
        : t('Legt ein eigenes Markdoc-Element mit HTML- und Typst-Vorlage an.'),
      label: t('Name (Kleinbuchstaben, Bindestriche)'),
      value: from ?? '',
      placeholder: t('z. B. hinweis'),
      confirm: t('Anlegen'),
      validate: (v) => (/^[a-z][a-z0-9-]*$/.test(v) ? null : t('Nur Kleinbuchstaben, Ziffern und Bindestriche; Beginn mit Buchstabe.')),
    });
    if (!name) return;
    try {
      await api.createComponent(id, name, from);
      await refreshTree();
      await refreshComponents();
      setOpenName(name);
      await openElement(name, 'settings');
      void compileNow();
      toast.success(t('Element angelegt'), t('Definition, HTML- und PDF-Vorlage bearbeitest du in der Element-Ansicht – mit Vorschau.'));
    } catch (e) {
      toast.error(t('Element konnte nicht angelegt werden'), e);
    }
  };

  return (
    <>
      <div className="sb-elements-head">
        <Button size="sm" icon={<Plus />} onClick={() => create()}>
          {t('Eigenes Element')}
        </Button>
      </div>
      {groups.map(([cat, list]) => (
        <Section key={cat} title={cat}>
          {list.map((c) => (
            <div key={c.name} className={`sb-el${openName === c.name ? ' is-open' : ''}`}>
              <button type="button" className="sb-el__head" onClick={() => setOpenName(openName === c.name ? null : c.name)}>
                <span className="sb-el__title">{c.title ?? c.name}</span>
                <code className="sb-el__tag">{c.name}</code>
              </button>
              {openName === c.name && (
                <div className="sb-el__body">
                  {c.description && (
                    <p>
                      <RichText text={c.description} />
                    </p>
                  )}
                  {Object.keys(c.attributes ?? {}).length > 0 && (
                    <dl className="sb-el__attrs">
                      {Object.entries(c.attributes).map(([k, a]) => (
                        <div key={k}>
                          <dt>
                            {k}
                            {a.required && <span title={t('Pflichtattribut')}>*</span>}
                          </dt>
                          <dd>
                            {a.description ?? a.type}
                            {a.matches?.length ? <small>{a.matches.join(' · ')}</small> : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="sb-el__actions">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        const v = getView();
                        if (v && useEditor.getState().active && fileKind(useEditor.getState().active!) === 'markdoc')
                          insertText(v, componentSnippet(c), !c.inline);
                        else toast.info(t('Öffne zuerst eine Markdoc-Seite.'));
                      }}
                    >
                      {t('Einfügen')}
                    </Button>
                    {c.source === 'builtin' ? (
                      <Button size="sm" onClick={() => create(c.name)}>
                        {t('Anpassen')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void openElement(c.name)}>
                        {t('Bearbeiten')}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}
