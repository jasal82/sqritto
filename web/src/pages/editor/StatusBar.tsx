import { CircleAlert, GitBranch, TriangleAlert } from 'lucide-react';
import { locale, t } from '../../lib/i18n';
import { setPanels, useEditor, fileKind } from './store';
import { useGit } from './GitPanel';

export function StatusBar() {
  const { result, cursor, words, active, panels, compiling } = useEditor();
  const git = useGit((s) => s.status);
  const errors = result?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = result?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0;
  const kind = active ? fileKind(active) : null;
  return (
    <footer className="statusbar">
      <button type="button" className="statusbar__item statusbar__btn" onClick={() => setPanels({ problems: !panels.problems })}>
        <CircleAlert className={errors ? 'is-error' : ''} /> {errors}
        <TriangleAlert className={warnings ? 'is-warning' : ''} /> {warnings}
      </button>
      {git?.initialized && (
        <button type="button" className="statusbar__item statusbar__btn" onClick={() => setPanels({ git: !panels.git })}>
          <GitBranch /> {git.branch}
          {git.changes.length > 0 && (
            <span>· {git.changes.length === 1 ? t('1 Änderung') : t('{n} Änderungen', { n: git.changes.length })}</span>
          )}
          {git.ahead > 0 && <span>↑{git.ahead}</span>}
          {git.behind > 0 && <span>↓{git.behind}</span>}
        </button>
      )}
      <span className="statusbar__item">
        {compiling
          ? t('Übersetze…')
          : result
            ? result.pages.length === 1
              ? t('1 Seite · {ms} ms', { ms: result.durationMs })
              : t('{n} Seiten · {ms} ms', { n: result.pages.length, ms: result.durationMs })
            : ''}
      </span>
      <span className="spacer" />
      {active && (
        <>
          <span className="statusbar__item">
            {cursor.selected > 0
              ? t('Zeile {line}, Spalte {col} ({n} ausgewählt)', { line: cursor.line, col: cursor.col, n: cursor.selected })
              : t('Zeile {line}, Spalte {col}', { line: cursor.line, col: cursor.col })}
          </span>
          {(kind === 'markdoc' || kind === 'typst') && (
            <span className="statusbar__item">{words === 1 ? t('1 Wort') : t('{n} Wörter', { n: words.toLocaleString(locale()) })}</span>
          )}
          <span className="statusbar__item">
            {kind === 'markdoc' ? 'Markdoc' : kind === 'typst' ? 'Typst' : kind === 'image' ? t('Bild') : kind === 'element' ? t('Element') : t('Text')}
          </span>
          <span className="statusbar__item">UTF-8</span>
        </>
      )}
    </footer>
  );
}
