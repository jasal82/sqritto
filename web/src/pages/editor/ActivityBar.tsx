// Aktivitätsleiste am linken Rand: wählt die Ansicht der Seitenleiste
// (Dateien, Gliederung, Elemente). Ein Klick auf die aktive Ansicht blendet
// die Seitenleiste aus und wieder ein.

import { Blocks, CircleAlert, Files, ListTree, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../lib/i18n';
import { Tip } from '../../ui';
import { setPanels, useEditor } from './store';

type View = 'files' | 'outline' | 'elements';

export function viewTitle(view: View): string {
  return { files: t('Dateien'), outline: t('Gliederung'), elements: t('Elemente') }[view];
}

export function ActivityBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const view = useEditor((s) => s.sidebarTab);
  const open = useEditor((s) => s.panels.sidebar);
  const problemsOpen = useEditor((s) => s.panels.problems);
  const kind = useEditor((s) => s.manifest?.document.kind ?? 'markdoc');
  const problems = useEditor((s) => s.result?.diagnostics.filter((d) => d.severity === 'error').length ?? 0);

  const select = (v: View) => {
    if (open && view === v) setPanels({ sidebar: false });
    else {
      useEditor.setState({ sidebarTab: v });
      setPanels({ sidebar: true });
    }
  };

  const views: { key: View; icon: ReactNode; keys?: string }[] = [
    { key: 'files', icon: <Files />, keys: 'Mod Shift B' },
    { key: 'outline', icon: <ListTree /> },
    ...(kind === 'markdoc' ? [{ key: 'elements' as View, icon: <Blocks /> }] : []),
  ];

  return (
    <nav className="activity" aria-label={t('Ansichten')}>
      <div className="activity__group" role="tablist" aria-orientation="vertical">
        {views.map((v) => (
          <Tip key={v.key} label={viewTitle(v.key)} keys={v.keys} side="right">
            <button
              type="button"
              role="tab"
              className="activity__btn"
              aria-label={viewTitle(v.key)}
              aria-selected={open && view === v.key}
              onClick={() => select(v.key)}
            >
              {v.icon}
            </button>
          </Tip>
        ))}
      </div>
      <div className="activity__group">
        <Tip label={t('Probleme')} keys="Mod J" side="right">
          <button
            type="button"
            className="activity__btn"
            aria-label={t('Probleme')}
            aria-pressed={problemsOpen}
            onClick={() => setPanels({ problems: !problemsOpen })}
          >
            <CircleAlert />
            {problems > 0 && <span className="activity__count">{problems > 99 ? '99+' : problems}</span>}
          </button>
        </Tip>
        <Tip label={t('Dokumenteinstellungen')} side="right">
          <button type="button" className="activity__btn" aria-label={t('Dokumenteinstellungen')} onClick={onOpenSettings}>
            <Settings2 />
          </button>
        </Tip>
      </div>
    </nav>
  );
}
