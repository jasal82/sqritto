import { t } from '../lib/i18n';
import { ownWindowControls, useWindowState, windowCommand } from '../lib/desktop';

/** Fensterknöpfe im Stil von Windows 11 (nur im nativen App-Fenster). */
export function WindowControls() {
  const maximized = useWindowState((s) => s.maximized);
  if (!ownWindowControls) return null;
  return (
    <div className="winctl" data-no-drag>
      <button type="button" className="winctl__btn" aria-label={t('Minimieren')} title={t('Minimieren')} onClick={() => windowCommand('minimize')}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        type="button"
        className="winctl__btn"
        aria-label={maximized ? t('Verkleinern') : t('Maximieren')}
        title={maximized ? t('Verkleinern') : t('Maximieren')}
        onClick={() => windowCommand('maximize')}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M2.5 2.5V1.2c0-.4.3-.7.7-.7h5.6c.4 0 .7.3.7.7v5.6c0 .4-.3.7-.7.7H7.5" />
            <rect x="0.5" y="2.5" width="7" height="7" rx="0.7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden>
            <rect x="0.5" y="0.5" width="9" height="9" rx="0.8" />
          </svg>
        )}
      </button>
      <button type="button" className="winctl__btn winctl__btn--close" aria-label={t('Schließen')} title={t('Schließen')} onClick={() => windowCommand('close')}>
        <svg viewBox="0 0 10 10" aria-hidden>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
