import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { t } from '../lib/i18n';
import { useApp } from '../lib/store';
import type { Settings } from '../lib/types';
import { Dialog, Segmented, SwitchRow } from '../ui';
import { UpdateSection } from './UpdateSection';

export function SettingsDialog({
  open,
  onOpenChange,
  section,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Bereich, zu dem beim Öffnen gescrollt wird. */
  section?: 'updates';
}) {
  const { settings, update, setLanguage, info } = useApp();
  useEffect(() => {
    if (!open || !section) return;
    const timer = window.setTimeout(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' }), 50);
    return () => window.clearTimeout(timer);
  }, [open, section]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('Einstellungen')} description={t('Gelten für alle Dokumente auf diesem Gerät.')} size="md">
      <div className="dialog__body settings">
        <section className="settings__section">
          <h3>{t('Darstellung')}</h3>
          <div className="settings__row">
            <span>{t('Farbschema')}</span>
            <Segmented
              label={t('Farbschema')}
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'system', label: t('System'), icon: <Monitor /> },
                { value: 'light', label: t('Hell'), icon: <Sun /> },
                { value: 'dark', label: t('Dunkel'), icon: <Moon /> },
              ]}
            />
          </div>
          <div className="settings__row">
            <span>{t('Sprache')}</span>
            <select
              className="select input--sm"
              style={{ width: 200 }}
              aria-label={t('Sprache der Oberfläche')}
              value={settings.language}
              onChange={(e) => void setLanguage(e.target.value as Settings['language'])}
            >
              <option value="system">{t('Systemsprache')}</option>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
        </section>

        <section className="settings__section">
          <h3>{t('Editor')}</h3>
          <div className="settings__row">
            <span>{t('Schriftgröße')}</span>
            <select
              className="select input--sm"
              style={{ width: 120 }}
              value={settings.editorFontSize}
              onChange={(e) => update({ editorFontSize: Number(e.target.value) })}
            >
              {[12, 13, 14, 15, 16, 18, 20].map((s) => (
                <option key={s} value={s}>
                  {s} px
                </option>
              ))}
            </select>
          </div>
          <SwitchRow
            title={t('Zeilenumbruch')}
            description={t('Lange Zeilen im Editor umbrechen.')}
            checked={settings.wordWrap}
            onChange={(wordWrap) => update({ wordWrap })}
          />
          <SwitchRow title={t('Zeilennummern')} checked={settings.lineNumbers} onChange={(lineNumbers) => update({ lineNumbers })} />
        </section>

        <section className="settings__section">
          <h3>{t('Vorschau')}</h3>
          <SwitchRow
            title={t('Vorschau mitscrollen')}
            description={t('Die Vorschau folgt der Cursorposition im Editor.')}
            checked={settings.syncScroll}
            onChange={(syncScroll) => update({ syncScroll })}
          />
          <div className="settings__row">
            <span>{t('Aktualisierung nach')}</span>
            <select
              className="select input--sm"
              style={{ width: 160 }}
              value={settings.previewDelay}
              onChange={(e) => update({ previewDelay: Number(e.target.value) })}
            >
              <option value={150}>{t('150 ms (sofort)')}</option>
              <option value={350}>350 ms</option>
              <option value={700}>700 ms</option>
              <option value={1500}>{t('1,5 s')}</option>
            </select>
          </div>
        </section>

        <section className="settings__section">
          <h3>{t('Neue Dokumente')}</h3>
          <SwitchRow
            title={t('Versionsverwaltung standardmäßig aktivieren')}
            description={t('Neue Dokumente erhalten ein Git-Repository.')}
            checked={settings.gitByDefault}
            onChange={(gitByDefault) => update({ gitByDefault })}
          />
          {info && (
            <p className="settings__note">
              {info.gitIdentity
                ? t('Versionen werden als {name} <{email}> gespeichert (globale Git-Konfiguration).', {
                    name: info.gitIdentity[0],
                    email: info.gitIdentity[1],
                  })
                : t('Keine globale Git-Identität gefunden. Name und E-Mail können pro Dokument im Bereich „Versionen“ hinterlegt werden.')}
            </p>
          )}
        </section>

        <UpdateSection />

        {info && (
          <section className="settings__section settings__about">
            <h3>{t('Über Sqritto')}</h3>
            <dl>
              <dt>{t('Version')}</dt>
              <dd>
                {info.version} · Typst {info.typst}
              </dd>
              <dt>{t('Modus')}</dt>
              <dd>{info.mode === 'local' ? t('Lokale App') : t('Server')}</dd>
              <dt>{t('Arbeitsbereich')}</dt>
              <dd className="mono">{info.workspace}</dd>
              <dt>Git</dt>
              <dd>{info.gitCli ? t('installiert (Synchronisation verfügbar)') : t('nicht gefunden – lokale Versionen funktionieren trotzdem')}</dd>
            </dl>
          </section>
        )}
      </div>
    </Dialog>
  );
}
