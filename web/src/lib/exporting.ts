import { api, download } from './api';
import { isDesktop } from './desktop';
import { t } from './i18n';
import { toast, useToasts } from './store';

export type ExportFormat = 'pdf' | 'html' | 'typst';

const EXT: Record<ExportFormat, string> = { pdf: 'pdf', html: 'zip', typst: 'typ' };

/**
 * Exportiert ein Dokument. Im App-Fenster mit nativem „Speichern unter“,
 * im Browser als Download.
 */
export async function exportDocument(id: string, format: ExportFormat, title: string): Promise<void> {
  try {
    if (isDesktop) {
      const res = await api.saveExport(id, format);
      if (res.cancelled || !res.path) return;
      const path = res.path;
      useToasts.getState().push({
        kind: 'success',
        title: t('Export gespeichert'),
        description: path,
        action: { label: t('Im Ordner zeigen'), run: () => void api.revealFile(path) },
        duration: 7000,
      });
      return;
    }
    const name = await download(api.exportUrl(id, format), `${title}.${EXT[format]}`);
    toast.success(t('Export abgeschlossen'), name);
  } catch (e) {
    toast.error(t('Export fehlgeschlagen'), e);
  }
}

/** PDF anzeigen: im App-Fenster mit dem Standardprogramm, sonst in neuem Tab. */
export async function openPdf(id: string): Promise<void> {
  try {
    if (isDesktop) await api.openPdf(id);
    else window.open(api.exportUrl(id, 'pdf', true), '_blank', 'noopener');
  } catch (e) {
    toast.error(t('PDF konnte nicht geöffnet werden'), e);
  }
}
