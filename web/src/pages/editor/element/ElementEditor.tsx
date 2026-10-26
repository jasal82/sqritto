// Element-Ansicht: ein eigenes Markdoc-Element mit Definition (Formular),
// HTML- und Typst-Vorlage, Stil und Skript – samt Live-Vorschau daneben.

import { Blocks, Braces, File, FileText, Globe, PanelRightClose, PanelRightOpen, Palette, Plus, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { t } from '../../../lib/i18n';
import { toast } from '../../../lib/store';
import { IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Resizer, Tip } from '../../../ui';
import { CodeView } from '../EditorArea';
import {
  elementDir,
  elementFiles,
  ensureLoaded,
  getText,
  getView,
  gotoLine,
  refreshTree,
  showFile,
  takeReveal,
  useEditor,
} from '../store';
import { ElementPreview } from './ElementPreview';
import { ElementSettings } from './ElementSettings';
import { classesIn, KNOWN_FILES, sectionInfo, typstCall, typstFunction, typstSkeleton, type ElementJson } from './util';
import { TEMPLATE_VALUES } from '../../../editor/mustache';

const ICONS: Record<string, ReactNode> = {
  'template.html': <Globe />,
  'template.typ': <FileText />,
  'style.css': <Palette />,
  'script.js': <Braces />,
};

function usePersistent<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignorieren */
    }
  }, [key, v]);
  return [v, setV] as const;
}

function readDef(name: string): ElementJson | null {
  try {
    const v = JSON.parse(getText(`${elementDir(name)}/component.json`) ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ElementJson) : null;
  } catch {
    return null;
  }
}

export function ElementEditor({ name }: { name: string }) {
  const tree = useEditor((s) => s.tree);
  const dirty = useEditor((s) => s.dirty);
  useEditor((s) => s.editTick);
  const section = useEditor((s) => s.elementSection[name] ?? 'settings');
  const [previewOpen, setPreviewOpen] = usePersistent('sqritto-element-preview', true);
  const [previewW, setPreviewW] = usePersistent('sqritto-element-preview-w', 440);
  const dir = elementDir(name);
  const files = elementFiles(tree, name);
  const fileKey = files.join('|');

  // Alle Dateien des Elements laden, damit Vorschau und Formular den
  // aktuellen (auch ungespeicherten) Stand kennen.
  useEffect(() => {
    for (const f of files) if (/\.(json|html|typ|css|js)$/.test(f)) void ensureLoaded(`${dir}/${f}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, fileKey]);

  const def = readDef(name);
  const title = def?.title || name;
  const known = KNOWN_FILES.filter((k) => files.includes(k.file));
  const missing = KNOWN_FILES.filter((k) => !files.includes(k.file));
  const others = files.filter((f) => f !== 'component.json' && !KNOWN_FILES.some((k) => k.file === f));
  const setSection = (s: string) => useEditor.setState((st) => ({ elementSection: { ...st.elementSection, [name]: s } }));
  const isDirty = (file: string) => !!dirty[`${dir}/${file}`];

  const addFile = async (file: string) => {
    const info = sectionInfo(file);
    if (!info) return;
    const content = file === 'template.typ' && def ? typstSkeleton(name, def) : info.template(name);
    try {
      await api.fileOp(useEditor.getState().id, { action: 'create', path: `${dir}/${file}`, content });
      await refreshTree();
      setSection(file);
    } catch (e) {
      toast.error(t('Datei konnte nicht angelegt werden'), e);
    }
  };

  // Gelöschte Datei: zurück zu den Einstellungen
  const current = section !== 'settings' && !files.includes(section) && files.length ? 'settings' : section;

  return (
    <div className="el-editor">
      <div className="el-editor__head">
        <div className="el-editor__title">
          <span className="el-editor__icon" aria-hidden>
            <Blocks />
          </span>
          <div>
            <strong>{title}</strong>
            <span>
              <code>{`{% ${name} %}`}</code> · {t('Eigenes Element')}
            </span>
          </div>
        </div>
        <div className="el-editor__tabs" role="tablist" aria-label={t('Bereiche des Elements')}>
          <SectionTab active={current === 'settings'} dirty={isDirty('component.json')} icon={<SlidersHorizontal />} onClick={() => setSection('settings')}>
            {t('Einstellungen')}
          </SectionTab>
          {known.map((k) => (
            <SectionTab
              key={k.file}
              active={current === k.file}
              dirty={isDirty(k.file)}
              icon={ICONS[k.file]}
              title={`${k.file} – ${k.description}`}
              onClick={() => setSection(k.file)}
            >
              {k.label}
            </SectionTab>
          ))}
          {others.map((f) => (
            <SectionTab key={f} active={current === f} dirty={isDirty(f)} icon={<File />} onClick={() => setSection(f)}>
              {f}
            </SectionTab>
          ))}
          {missing.length > 0 && (
            <Menu>
              <Tip label={t('Datei hinzufügen')}>
                <MenuTrigger asChild>
                  <button type="button" className="el-tab el-tab--add" aria-label={t('Datei hinzufügen')}>
                    <Plus />
                  </button>
                </MenuTrigger>
              </Tip>
              <MenuContent align="start">
                <MenuLabel>{t('Datei hinzufügen')}</MenuLabel>
                {missing.map((m) => (
                  <MenuItem key={m.file} icon={ICONS[m.file]} description={`${m.file} – ${m.description}`} onSelect={() => void addFile(m.file)}>
                    {m.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>
        <IconButton
          label={previewOpen ? t('Vorschau ausblenden') : t('Vorschau einblenden')}
          icon={previewOpen ? <PanelRightClose /> : <PanelRightOpen />}
          onClick={() => setPreviewOpen(!previewOpen)}
        />
      </div>
      <div className="el-editor__body">
        <div className="el-editor__main">
          {current === 'settings' ? <ElementSettings name={name} /> : <ElementCode name={name} file={current} hints />}
        </div>
        {previewOpen && (
          <>
            <Resizer
              label={t('Breite der Vorschau')}
              side="left"
              onResize={(d) => setPreviewW((w) => Math.max(300, Math.min(window.innerWidth - 520, w + d)))}
              onDoubleClick={() => setPreviewW(440)}
            />
            <div className="el-editor__preview" style={{ width: previewW }}>
              <ElementPreview name={name} section={current} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTab({
  active,
  dirty,
  icon,
  title,
  onClick,
  children,
}: {
  active: boolean;
  dirty: boolean;
  icon: ReactNode;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="tab" aria-selected={active} className="el-tab" title={title} onClick={onClick}>
      {icon}
      <span>{children}</span>
      {dirty && <span className="el-tab__dot" aria-label={t('Ungespeichert')} />}
    </button>
  );
}

/** Code einer Element-Datei im Haupteditor (mit Hinweisleiste). */
export function ElementCode({ name, file, hints }: { name: string; file: string; hints?: boolean }) {
  const path = `${elementDir(name)}/${file}`;
  useEffect(() => {
    void showFile(path).then((ok) => {
      const r = ok ? takeReveal(path) : null;
      if (r) gotoLine(r.line, r.col);
    });
  }, [path]);
  return (
    <div className="el-code">
      {hints && <HintBar name={name} file={file} />}
      <div className="el-code__editor">
        <CodeView hidden={false} />
      </div>
    </div>
  );
}

/** Einfügen an der Cursorposition des Haupteditors. */
function insert(text: string) {
  const v = getView();
  if (!v) return;
  v.dispatch(v.state.replaceSelection(text));
  v.focus();
}

function Chip({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="el-chip" title={title} onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </button>
  );
}

function HintBar({ name, file }: { name: string; file: string }) {
  useEditor((s) => s.editTick);
  const def = readDef(name) ?? {};
  const attrs = Object.keys(def.attributes ?? {});
  if (file === 'template.html') {
    return (
      <div className="el-hints">
        <span className="el-hints__label">{t('Platzhalter')}</span>
        {attrs.map((a) => (
          <Chip key={a} title={def.attributes?.[a]?.description ?? t('Attribut')} onClick={() => insert(`{{${a}}}`)}>
            {`{{${a}}}`}
          </Chip>
        ))}
        {TEMPLATE_VALUES.map((v) => (
          <Chip key={v.name} title={v.info} onClick={() => insert(v.name === 'children' ? '{{{children}}}' : `{{${v.name}}}`)}>
            {v.name === 'children' ? '{{{children}}}' : `{{${v.name}}}`}
          </Chip>
        ))}
        <Tip
          label={
            <span className="el-hints__help">
              {t('{{#name}}…{{/name}} nur wenn gesetzt · {{^name}}…{{/name}} wenn leer · {{#name=wert}}…{{/name=wert}} bei bestimmtem Wert')}
            </span>
          }
        >
          <span className="el-hints__more">{t('Abschnitte?')}</span>
        </Tip>
      </div>
    );
  }
  if (file === 'template.typ') {
    const fn = typstFunction(name, def);
    const text = getText(`${elementDir(name)}/template.typ`) ?? '';
    const defined = new RegExp(`#let\\s+${fn.replace(/[-]/g, '\\-')}\\s*\\(`).test(text);
    const [missingBefore, missingAfter] = t('Funktion {fn} fehlt.').split('{fn}');
    return (
      <div className="el-hints">
        <span className="el-hints__label">{t('Aufruf im PDF')}</span>
        <code className="el-hints__code">{typstCall(name, def)}</code>
        {!defined && (
          <span className="el-hints__warn">
            {missingBefore}
            <code>{fn}</code>
            {missingAfter}
            <Chip onClick={() => insert(typstSkeleton(name, def).replace(/^#import[^\n]*\n\n/, text.includes('ts-theme') ? '' : '$&'))}>
              {t('Grundgerüst einfügen')}
            </Chip>
          </span>
        )}
      </div>
    );
  }
  if (file === 'style.css') {
    const classes = classesIn(getText(`${elementDir(name)}/template.html`) ?? '');
    return (
      <div className="el-hints">
        <span className="el-hints__label">{t('Klassen der HTML-Vorlage')}</span>
        {classes.length ? (
          classes.map((c) => (
            <Chip key={c} onClick={() => insert(`.${c} {\n  \n}\n`)}>
              .{c}
            </Chip>
          ))
        ) : (
          <span className="el-hints__muted">{t('keine')}</span>
        )}
        <span className="el-hints__muted">· {t('Farben der Website: {vars}', { vars: 'var(--ts-accent), var(--ts-border), var(--ts-fg)' })}</span>
      </div>
    );
  }
  if (file === 'script.js') {
    return (
      <div className="el-hints">
        <span className="el-hints__muted">{t('Läuft in der HTML-Ausgabe nach dem Laden der Seite – für alle Vorkommen des Elements.')}</span>
      </div>
    );
  }
  return null;
}
