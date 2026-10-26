import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { t } from '../../lib/i18n';
import { IconButton } from '../../ui';
import { reveal, setPanels, useEditor } from './store';

export function ProblemsPanel() {
  const result = useEditor((s) => s.result);
  const diags = result?.diagnostics ?? [];
  return (
    <section className="problems" aria-label={t('Probleme')}>
      <div className="problems__head">
        <strong>{t('Probleme')}</strong>
        <span className="problems__count">{diags.length}</span>
        <span className="spacer" />
        <IconButton label={t('Schließen')} keys="Mod J" onClick={() => setPanels({ problems: false })}>
          <X />
        </IconButton>
      </div>
      <div className="problems__list">
        {diags.length === 0 ? (
          <div className="problems__empty">
            <CheckCircle2 /> {t('Keine Probleme gefunden.')}
          </div>
        ) : (
          diags.map((d, i) => (
            <button
              key={i}
              type="button"
              className={`problem problem--${d.severity}`}
              onClick={() => d.path && void reveal(d.path, d.line ?? undefined, d.column ?? undefined)}
            >
              {d.severity === 'error' ? <CircleAlert /> : d.severity === 'warning' ? <TriangleAlert /> : <Info />}
              <span className="problem__text">
                <span className="problem__msg">{d.message}</span>
                {d.hints.length > 0 && <span className="problem__hints">{d.hints.join(' · ')}</span>}
              </span>
              <span className="problem__loc">
                {d.path}
                {d.line ? `:${d.line}` : ''}
                <small>{d.source === 'typst' ? 'Typst' : d.source === 'markdoc' ? 'Markdoc' : 'Sqritto'}</small>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
