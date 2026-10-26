import {
  AtSign,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  ImagePlus,
  Italic,
  LayoutGrid,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  SeparatorHorizontal,
  Sigma,
  Square,
  SquareCode,
  Strikethrough,
  Superscript,
  Table2,
  TableOfContents,
  AlignLeft,
  Variable,
  type LucideIcon,
} from 'lucide-react';
import { createElement, useMemo, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import * as cmd from '../../editor/commands';
import { elementIcon } from '../../editor/elementIcons';
import { componentSnippet } from '../../editor/markdoc';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { toast } from '../../lib/store';
import { IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Button } from '../../ui';
import { getView, refreshTree, useEditor } from './store';
import { relFrom } from './EditorArea';
import { RichText } from '../common';

const typstSnippets = (): { label: string; description: string; icon: LucideIcon; text: string }[] => [
  { label: t('Abbildung'), description: t('Bild mit Beschriftung'), icon: ImageIcon, text: '#figure(\n  image("${/assets/bild.png}", width: 80%),\n  caption: [${Beschriftung}],\n) <${abb}>' },
  { label: t('Tabelle'), description: t('Tabelle mit Kopfzeile'), icon: Table2, text: '#table(\n  columns: 3,\n  table.header[*${A}*][*B*][*C*],\n  [1], [2], [3],\n)' },
  { label: t('Raster'), description: t('Zweispaltiges Layout'), icon: LayoutGrid, text: '#grid(\n  columns: (1fr, 1fr),\n  gutter: 1em,\n  [${Links}],\n  [Rechts],\n)' },
  { label: t('Box mit Rahmen'), description: t('Hervorgehobener Block'), icon: Square, text: '#block(fill: luma(245), inset: 10pt, radius: 4pt)[\n  ${Inhalt}\n]' },
  { label: t('Seitenumbruch'), description: '', icon: SeparatorHorizontal, text: '#pagebreak()' },
  { label: t('Inhaltsverzeichnis'), description: '', icon: TableOfContents, text: '#outline()' },
  { label: t('Fußnote'), description: '', icon: Superscript, text: '#footnote[${Text}]' },
  { label: t('Verweis'), description: t('Auf Label verweisen'), icon: AtSign, text: '@${label}' },
  { label: t('Variable'), description: t('let-Bindung'), icon: Variable, text: '#let ${name} = ${wert}' },
];

export function Toolbar({ flavor }: { flavor: cmd.Flavor }) {
  const components = useEditor((s) => s.components);
  const id = useEditor((s) => s.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const run = (fn: (v: EditorView) => unknown) => () => {
    const v = getView();
    if (v) fn(v);
  };
  const grouped = useMemo(() => {
    const map = new Map<string, typeof components>();
    for (const c of components) {
      if (c.parents?.length) continue; // Kind-Elemente (tab, step …) nicht einzeln anbieten
      const cat = c.category ?? t('Weitere');
      map.set(cat, [...(map.get(cat) ?? []), c]);
    }
    return [...map.entries()];
  }, [components]);

  const onImages = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const res = await api.upload(id, [...files], 'assets');
      void refreshTree();
      const v = getView();
      const active = useEditor.getState().active!;
      if (v) for (const p of res.files) cmd.image(v, flavor, flavor === 'markdoc' ? relFrom(active, p) : `/${p}`);
    } catch (e) {
      toast.error(t('Hochladen fehlgeschlagen'), e);
    }
  };

  const format = async () => {
    const v = getView();
    if (!v) return;
    try {
      const { text } = await api.formatMarkdoc(v.state.doc.toString());
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, userEvent: 'input.format' });
      toast.success(t('Dokument formatiert'));
    } catch (e) {
      toast.error(t('Formatieren nicht möglich'), e);
    }
  };

  return (
    <div className="ed-toolbar" role="toolbar" aria-label={t('Formatierung')}>
      <IconButton label={t('Überschrift 1')} tipSide="bottom" onClick={run((v) => cmd.heading(v, flavor, 1))}>
        <Heading1 />
      </IconButton>
      <IconButton label={t('Überschrift 2')} onClick={run((v) => cmd.heading(v, flavor, 2))}>
        <Heading2 />
      </IconButton>
      <IconButton label={t('Überschrift 3')} onClick={run((v) => cmd.heading(v, flavor, 3))}>
        <Heading3 />
      </IconButton>
      <span className="ed-toolbar__sep" />
      <IconButton label={t('Fett')} keys="Mod B" onClick={run((v) => cmd.bold(v, flavor))}>
        <Bold />
      </IconButton>
      <IconButton label={t('Kursiv')} keys="Mod I" onClick={run((v) => cmd.italic(v, flavor))}>
        <Italic />
      </IconButton>
      <IconButton label={t('Durchgestrichen')} onClick={run((v) => cmd.strike(v, flavor))}>
        <Strikethrough />
      </IconButton>
      <IconButton label={t('Code')} keys="Mod E" onClick={run((v) => cmd.inlineCode(v))}>
        <Code />
      </IconButton>
      <IconButton label={t('Link')} keys="Mod Shift K" onClick={run((v) => cmd.link(v, flavor))}>
        <Link2 />
      </IconButton>
      <span className="ed-toolbar__sep" />
      <IconButton label={t('Aufzählung')} onClick={run((v) => cmd.bulletList(v, flavor))}>
        <List />
      </IconButton>
      <IconButton label={t('Nummerierte Liste')} onClick={run((v) => cmd.orderedList(v, flavor))}>
        <ListOrdered />
      </IconButton>
      {flavor === 'markdoc' && (
        <IconButton label={t('Checkliste')} onClick={run((v) => cmd.taskList(v))}>
          <ListChecks />
        </IconButton>
      )}
      <IconButton label={t('Zitat')} onClick={run((v) => cmd.quote(v, flavor))}>
        <Quote />
      </IconButton>
      <span className="ed-toolbar__sep" />
      <IconButton label={t('Bild einfügen (hochladen)')} onClick={() => fileInput.current?.click()}>
        <ImagePlus />
      </IconButton>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,.svg"
        multiple
        hidden
        onChange={(e) => {
          void onImages(e.target.files);
          e.target.value = '';
        }}
      />
      <IconButton label={t('Tabelle')} onClick={run((v) => cmd.table(v, flavor))}>
        <Table2 />
      </IconButton>
      <IconButton label={t('Codeblock')} onClick={run((v) => cmd.codeBlock(v, flavor))}>
        <SquareCode />
      </IconButton>
      <IconButton label={t('Formel')} onClick={run((v) => cmd.math(v, flavor))}>
        <Sigma />
      </IconButton>
      <IconButton label={t('Trennlinie')} onClick={run((v) => cmd.hr(v, flavor))}>
        <Minus />
      </IconButton>
      <span className="ed-toolbar__sep" />
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" icon={<Plus />}>
            {t('Element')}
          </Button>
        </MenuTrigger>
        <MenuContent align="start" className="menu--elements">
          {flavor === 'markdoc'
            ? grouped.map(([cat, list], i) => (
                <div key={cat}>
                  {i > 0 && <MenuSeparator />}
                  <MenuLabel>{cat}</MenuLabel>
                  {list.map((c) => (
                    <MenuItem
                      key={c.name}
                      icon={createElement(elementIcon(c))}
                      description={c.description ? <RichText text={c.description} /> : undefined}
                      onSelect={() => {
                        const v = getView();
                        if (v) cmd.insertText(v, componentSnippet(c), !c.inline);
                      }}
                    >
                      {c.title ?? c.name}
                    </MenuItem>
                  ))}
                </div>
              ))
            : typstSnippets().map((s) => (
                <MenuItem
                  key={s.label}
                  icon={createElement(s.icon)}
                  description={s.description || undefined}
                  onSelect={() => {
                    const v = getView();
                    if (v) cmd.insertText(v, s.text, true);
                  }}
                >
                  {s.label}
                </MenuItem>
              ))}
        </MenuContent>
      </Menu>
      <span className="spacer" />
      {flavor === 'markdoc' && (
        <IconButton label={t('Markdoc formatieren')} onClick={format}>
          <AlignLeft />
        </IconButton>
      )}
    </div>
  );
}
