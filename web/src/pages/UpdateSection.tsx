// Updates der lokalen App: Bereich in den Einstellungen, Fortschritt während der
// Installation und Hinweis auf eine neue Version (siehe lib/update.ts).

import { CheckCircle2, Download, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { date, dateTime, fileSize } from '../lib/format';
import { t } from '../lib/i18n';
import { toast, useApp, useToasts } from '../lib/store';
import { isBusy, useUpdate } from '../lib/update';
import { Button, confirm, Dialog, SwitchRow } from '../ui';

/** Versionshinweise von GitHub (Markdown): Überschriften und Listenpunkte genügen hier. */
function ReleaseNotes({ text }: { text: string }) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  return (
    <div className="update__notes">
      {lines.map((line, i) => {
        // Fett und Links als reinen Text zeigen.
        const plain = line.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        const heading = /^#+\s+(.*)/.exec(plain);
        if (heading) return <strong key={i}>{heading[1]}</strong>;
        const item = /^\s*[*-]\s+(.*)/.exec(plain);
        return item ? (
          <span key={i} className="update__item">
            {item[1]}
          </span>
        ) : (
          <span key={i}>{plain}</span>
        );
      })}
    </div>
  );
}

export function UpdateSection() {
  const { status: u, checking, check, install } = useUpdate();
  const { settings, update } = useApp();
  if (!u?.enabled) return null;
  const busy = isBusy(u);
  const skipped = !!u.latest && settings.skippedVersion === u.latest;

  const startInstall = async () => {
    const ok = await confirm({
      title: t('Sqritto {version} installieren', { version: u.latest ?? '' }),
      description: t('Sqritto wird für das Update beendet und startet danach von selbst neu. Deine Dokumente bleiben, wie sie sind.'),
      confirm: t('Jetzt aktualisieren'),
    });
    if (!ok) return;
    try {
      await install();
    } catch (e) {
      toast.error(t('Update nicht möglich'), e);
    }
  };

  return (
    <section className="settings__section update" id="settings-updates">
      <h3>{t('Updates')}</h3>
      <div className="settings__row">
        <span className="update__current">
          <strong>Sqritto {u.current}</strong>
          <small>
            {u.checkedAt ? t('Zuletzt geprüft: {time}', { time: dateTime(Date.parse(u.checkedAt)) }) : t('Noch nicht nach Updates gesucht')}
          </small>
        </span>
        <Button
          size="sm"
          icon={<RefreshCw />}
          loading={checking}
          disabled={busy}
          onClick={() => void check().catch((e) => toast.error(t('Prüfung fehlgeschlagen'), e))}
        >
          {t('Jetzt prüfen')}
        </Button>
      </div>
      {u.checkError && (
        <p className="update__message update__message--warning">
          <TriangleAlert /> {u.checkError}
        </p>
      )}
      {!u.checkError && u.latest && !u.available && (
        <p className="update__message update__message--ok">
          <CheckCircle2 /> {t('Sqritto ist auf dem neuesten Stand.')}
        </p>
      )}
      {u.available && u.latest && (
        <div className="update__card">
          <div className="update__head">
            <span className="badge badge--accent">
              <Download /> {t('Neue Version {version}', { version: u.latest })}
            </span>
            {u.publishedAt && <span className="update__date">{t('veröffentlicht am {date}', { date: date(Date.parse(u.publishedAt)) })}</span>}
          </div>
          {u.notes && <ReleaseNotes text={u.notes} />}
          {u.phase === 'failed' && (
            <p className="update__message update__message--error">
              <TriangleAlert /> {t('Das Update ist fehlgeschlagen: {error} Die bisherige Version ist unverändert.', { error: u.error })}
            </p>
          )}
          <p className="settings__note">
            {u.canInstall ? t('{note} Download: {size}.', { note: u.installNote, size: fileSize(u.downloadSize) }) : u.installNote}
          </p>
          <div className="update__actions">
            {u.canInstall && (
              <Button variant="primary" icon={<Download />} disabled={busy} onClick={() => void startInstall()}>
                {u.phase === 'failed' ? t('Erneut versuchen') : t('Jetzt aktualisieren')}
              </Button>
            )}
            {u.releaseUrl && (
              <Button
                variant={u.canInstall ? 'secondary' : 'primary'}
                icon={<ExternalLink />}
                onClick={() => window.open(u.releaseUrl, '_blank', 'noopener')}
              >
                {u.canInstall ? t('Auf GitHub ansehen') : t('Zum Download auf GitHub')}
              </Button>
            )}
            {!skipped && (
              <Button variant="ghost" disabled={busy} onClick={() => update({ skippedVersion: u.latest ?? '' })}>
                {t('Diese Version überspringen')}
              </Button>
            )}
          </div>
          {skipped && (
            <p className="settings__note">
              {t('An diese Version wird nicht mehr erinnert.')}{' '}
              <button type="button" className="update__link" onClick={() => update({ skippedVersion: '' })}>
                {t('Wieder erinnern')}
              </button>
            </p>
          )}
        </div>
      )}
      <SwitchRow
        title={t('Automatisch nach Updates suchen')}
        description={t('Sqritto fragt beim Start und danach täglich bei GitHub nach der neuesten Version. Dabei werden keine Daten aus deinen Dokumenten übertragen.')}
        checked={settings.updateCheck}
        onChange={(updateCheck) => update({ updateCheck })}
      />
    </section>
  );
}

/** Fortschritt während der Installation bis zum Neustart (auf jeder Seite). */
export function UpdateProgress() {
  const { status: u, down, from } = useUpdate();
  const restarting = from !== null && (u?.phase === 'restarting' || down);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!restarting) return;
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [restarting]);
  const open = from !== null && (isBusy(u) || down);
  return (
    <Dialog open={open} onOpenChange={() => undefined} locked title={t('Update auf Sqritto {version}', { version: u?.latest ?? '' })}>
      <div className="dialog__body update-progress" aria-live="polite">
        {u?.phase === 'downloading' && !down && (
          <>
            <p>{t('Die neue Version wird heruntergeladen und geprüft …')}</p>
            <div className="update-progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
              <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
            </div>
            <small>{t('{percent} % von {size}', { percent: Math.round(u.progress * 100), size: fileSize(u.downloadSize) })}</small>
          </>
        )}
        {u?.phase === 'installing' && !down && (
          <p className="update-progress__step">
            <span className="spinner" /> {t('Wird installiert …')}
          </p>
        )}
        {restarting && (
          <p className="update-progress__step">
            <span className="spinner" />{' '}
            {seconds > 120
              ? t('Sqritto wurde beendet, meldet sich aber noch nicht zurück. Falls es nicht von selbst startet, bitte Sqritto neu starten.')
              : t('Sqritto wird neu gestartet – gleich geht es mit der neuen Version weiter.')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Version, auf die schon hingewiesen wurde – der Hinweis kommt einmal pro Programmstart. */
let announced = '';

/**
 * Weist auf eine neue Version hin, sofern sie nicht übersprungen wurde. Liefert, ob es
 * eine gibt (für den Punkt am Einstellungsknopf).
 */
export function useUpdateNotice(onShow: () => void): boolean {
  const u = useUpdate((s) => s.status);
  const skipped = useApp((s) => s.settings.skippedVersion);
  const latest = u?.enabled && u.available ? u.latest : null;
  const pending = !!latest && skipped !== latest;
  const show = useRef(onShow);
  show.current = onShow;
  useEffect(() => {
    if (!pending || !latest || announced === latest) return;
    announced = latest;
    useToasts.getState().push({
      kind: 'info',
      title: t('Sqritto {version} ist verfügbar', { version: latest }),
      description: t('Installiert ist Version {current}.', { current: u?.current ?? '' }),
      action: { label: t('Ansehen'), run: () => show.current() },
      duration: 0,
    });
  }, [pending, latest, u?.current]);
  return pending;
}
