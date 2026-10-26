import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CloudCog,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { MergeView } from '@codemirror/merge';
import { api } from '../../lib/api';
import { dateTime, relativeTime, basename } from '../../lib/format';
import { t } from '../../lib/i18n';
import { toast, useApp } from '../../lib/store';
import type { BranchInfo, CommitFile, CommitInfo, FileChange, RepoStatus } from '../../lib/types';
import { Button, confirm, Dialog, Empty, IconButton, Kbd, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, prompt } from '../../ui';
import { editorTheme, highlight } from '../../editor/theme';
import { markdown } from '@codemirror/lang-markdown';
import { typstStreamLanguage } from '../../editor/typst';
import { compileNow, refreshTree, reloadFromDisk, saveNow, useEditor } from './store';

// ---------------------------------------------------------------------------
// Git-Zustand
// ---------------------------------------------------------------------------

interface GitState {
  status: RepoStatus | null;
  loading: boolean;
  refresh(id: string): Promise<void>;
}

let refreshTimer: number | undefined;

export const useGit = create<GitState>((set) => ({
  status: null,
  loading: false,
  async refresh(id) {
    window.clearTimeout(refreshTimer);
    await new Promise<void>((r) => (refreshTimer = window.setTimeout(r, 250)));
    set({ loading: true });
    try {
      set({ status: await api.git.status(id) });
    } catch {
      set({ status: null });
    } finally {
      set({ loading: false });
    }
  },
}));

// Kürzel wie bei git status (englisch: A, M, D, R).
const statusLabels = (): Record<string, { short: string; label: string }> => ({
  added: { short: t('N'), label: t('Neu') },
  modified: { short: t('G'), label: t('Geändert') },
  deleted: { short: t('E'), label: t('Entfernt') },
  renamed: { short: t('U'), label: t('Umbenannt') },
  conflicted: { short: '!', label: t('Konflikt') },
});

async function afterRepoChange(id: string) {
  await refreshTree();
  for (const t of useEditor.getState().tabs) await reloadFromDisk(t);
  void compileNow();
  void useGit.getState().refresh(id);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function GitPanel({ onClose }: { onClose: () => void }) {
  const id = useEditor((s) => s.id);
  const { status, refresh, loading } = useGit();
  const [tab, setTab] = useState<'changes' | 'history' | 'sync'>('changes');
  const [diff, setDiff] = useState<{ path: string; commit?: string } | null>(null);

  useEffect(() => {
    void saveNow().then(() => refresh(id));
  }, [id]);

  return (
    <aside className="gitpanel" aria-label={t('Versionen')}>
      <div className="gitpanel__head">
        <History />
        <strong>{t('Versionen')}</strong>
        <span className="spacer" />
        {status?.initialized && <BranchMenu status={status} />}
        <IconButton label={t('Aktualisieren')} onClick={() => void refresh(id)} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} />
        </IconButton>
        <IconButton label={t('Schließen')} onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {!status ? (
        <div className="gitpanel__loading">
          <span className="spinner" />
        </div>
      ) : !status.initialized ? (
        <InitView id={id} status={status} />
      ) : (
        <>
          <div className="tabs gitpanel__tabs" role="tablist">
            <button role="tab" className="tabs__tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
              {t('Änderungen')}
              {status.changes.length > 0 && <span className="tabs__count">{status.changes.length}</span>}
            </button>
            <button role="tab" className="tabs__tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
              {t('Verlauf')}
            </button>
            <button role="tab" className="tabs__tab" aria-selected={tab === 'sync'} onClick={() => setTab('sync')}>
              {t('Synchronisieren')}
              {(status.ahead > 0 || status.behind > 0) && <span className="tabs__count">{status.ahead + status.behind}</span>}
            </button>
          </div>
          {tab === 'changes' && <ChangesView id={id} status={status} onDiff={(p) => setDiff({ path: p })} />}
          {tab === 'history' && <HistoryView id={id} onDiff={(path, commit) => setDiff({ path, commit })} />}
          {tab === 'sync' && <SyncView id={id} status={status} />}
        </>
      )}
      <DiffDialog id={id} target={diff} onClose={() => setDiff(null)} />
    </aside>
  );
}

function InitView({ id, status }: { id: string; status: RepoStatus }) {
  const info = useApp((s) => s.info);
  const [name, setName] = useState(info?.gitIdentity?.[0] ?? info?.author ?? '');
  const [email, setEmail] = useState(info?.gitIdentity?.[1] ?? '');
  const [busy, setBusy] = useState(false);
  const needsIdentity = !info?.gitIdentity;
  const init = async () => {
    setBusy(true);
    try {
      await saveNow();
      await api.git.init(id, name || undefined, email || undefined);
      toast.success(t('Versionsverwaltung aktiviert'), t('Die erste Version wurde gespeichert.'));
      await afterRepoChange(id);
    } catch (e) {
      toast.error(t('Aktivieren fehlgeschlagen'), e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gitpanel__init">
      <Empty icon={<GitBranch />} title={t('Versionen sind noch nicht aktiviert')}>
        {t(
          'Mit der Versionsverwaltung speicherst du Zwischenstände deines Dokuments, vergleichst Änderungen und kannst jederzeit zu einer früheren Fassung zurückkehren. Technisch ist das ein Git-Repository im Dokumentordner.',
        )}
      </Empty>
      {needsIdentity && (
        <div className="gitpanel__identity">
          <label className="field">
            <span className="field__label">{t('Name')}</span>
            <input className="input input--sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{t('E-Mail')}</span>
            <input className="input input--sm" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('name@beispiel.de')} />
          </label>
        </div>
      )}
      <Button variant="primary" icon={<GitBranch />} loading={busy} onClick={init} disabled={needsIdentity && (!name || !email)}>
        {t('Versionsverwaltung aktivieren')}
      </Button>
      {!status.cliAvailable && <p className="gitpanel__hint">{t('Für die Synchronisation mit GitHub & Co. wird zusätzlich Git benötigt.')}</p>}
    </div>
  );
}

function BranchMenu({ status }: { status: RepoStatus }) {
  const id = useEditor((s) => s.id);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const load = () => api.git.branches(id).then(setBranches).catch(() => undefined);
  const checkout = async (name: string) => {
    try {
      await saveNow();
      await api.git.checkout(id, name);
      toast.success(t('Zweig „{name}“ aktiv', { name }));
      await afterRepoChange(id);
    } catch (e) {
      toast.error(t('Wechsel nicht möglich'), e);
    }
  };
  const createBranch = async () => {
    const name = await prompt({
      title: t('Neuer Zweig'),
      description: t('Ein Zweig ist eine eigene Entwicklungslinie, z. B. für eine Überarbeitung.'),
      label: t('Name'),
      placeholder: t('ueberarbeitung-kapitel-3'),
      confirm: t('Erstellen und wechseln'),
      validate: (v) => (/^[\w./-]+$/.test(v) && !v.includes('..') ? null : t('Nur Buchstaben, Ziffern, -, _, / und .')),
    });
    if (!name) return;
    try {
      await api.git.createBranch(id, name, true);
      toast.success(t('Zweig „{name}“ erstellt', { name }));
      await afterRepoChange(id);
    } catch (e) {
      toast.error(t('Zweig konnte nicht erstellt werden'), e);
    }
  };
  return (
    <Menu onOpenChange={(o) => o && void load()}>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" icon={<GitBranch />}>
          <span className="truncate" style={{ maxWidth: 110 }}>
            {status.branch}
          </span>
          <ChevronDown />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t('Zweige')}</MenuLabel>
        {branches.map((b) => (
          <MenuItem key={b.name} icon={b.current ? <Check /> : <span style={{ width: 16 }} />} onSelect={() => !b.current && void checkout(b.name)}>
            {b.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={createBranch}>
          {t('Neuer Zweig…')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ChangesView({ id, status, onDiff }: { id: string; status: RepoStatus; onDiff: (path: string) => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const changes = status.changes;
  const sel = selected ?? new Set(changes.map((c) => c.path));
  const labels = statusLabels();

  useEffect(() => setSelected(null), [status]);

  const commit = async () => {
    if (!message.trim()) {
      ta.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await saveNow();
      const all = sel.size === changes.length;
      const info = await api.git.commit(id, message.trim(), all ? undefined : [...sel]);
      toast.success(t('Version gespeichert'), `${info.short} · ${info.summary}`);
      setMessage('');
      void useGit.getState().refresh(id);
    } catch (e) {
      toast.error(t('Speichern der Version fehlgeschlagen'), e);
    } finally {
      setBusy(false);
    }
  };

  const discard = async (c: FileChange) => {
    const ok = await confirm({
      title: t('Änderungen an „{name}“ verwerfen?', { name: basename(c.path) }),
      description: c.status === 'added' ? t('Die neue Datei wird gelöscht.') : t('Die Datei wird auf den Stand der letzten Version zurückgesetzt.'),
      confirm: t('Verwerfen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await saveNow();
      await api.git.discard(id, c.path);
      await afterRepoChange(id);
    } catch (e) {
      toast.error(t('Verwerfen fehlgeschlagen'), e);
    }
  };

  return (
    <div className="gitpanel__changes">
      <div className="gitpanel__list">
        {changes.length === 0 ? (
          <div className="gitpanel__clean">
            <Check />
            <div>
              <strong>{t('Alles gespeichert')}</strong>
              <span>
                {t('Letzte Version: {summary} · {time}', {
                  summary: status.head?.summary ?? '',
                  time: status.head ? relativeTime(status.head.time * 1000) : '',
                })}
              </span>
            </div>
          </div>
        ) : (
          changes.map((c) => (
            <div key={c.path} className={`gitchange gitchange--${c.status}`}>
              <input
                type="checkbox"
                className="checkbox"
                checked={sel.has(c.path)}
                aria-label={t('{path} einbeziehen', { path: c.path })}
                onChange={(e) => {
                  const next = new Set(sel);
                  if (e.target.checked) next.add(c.path);
                  else next.delete(c.path);
                  setSelected(next);
                }}
              />
              <button type="button" className="gitchange__main" onClick={() => onDiff(c.path)} title={t('Änderungen ansehen')}>
                <span className="gitchange__name">{basename(c.path)}</span>
                <span className="gitchange__dir">{c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''}</span>
              </button>
              <IconButton label={t('Verwerfen')} onClick={() => discard(c)} className="gitchange__action">
                <Undo2 />
              </IconButton>
              <span className="gitchange__status" title={labels[c.status]?.label}>
                {labels[c.status]?.short ?? '?'}
              </span>
            </div>
          ))
        )}
      </div>
      {changes.length > 0 && (
        <div className="gitpanel__commit">
          <textarea
            ref={ta}
            className="textarea"
            placeholder={t('Was hat sich geändert? (z. B. „Kapitel Installation überarbeitet“)')}
            value={message}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void commit();
              }
            }}
          />
          <Button variant="primary" icon={<GitCommitHorizontal />} loading={busy} onClick={commit} disabled={sel.size === 0}>
            {sel.size !== changes.length ? t('Version speichern ({n})', { n: sel.size }) : t('Version speichern')}
          </Button>
          <div className="gitpanel__kbd">
            <Kbd keys="Mod Enter" />
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryView({ id, onDiff }: { id: string; onDiff: (path: string, commit: string) => void }) {
  const [log, setLog] = useState<CommitInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, CommitFile[]>>({});
  const status = useGit((s) => s.status);

  useEffect(() => {
    api.git.log(id, 300).then(setLog).catch(() => setLog([]));
  }, [id, status?.head?.id]);

  const toggle = async (c: CommitInfo) => {
    if (open === c.id) return setOpen(null);
    setOpen(c.id);
    if (!files[c.id]) {
      try {
        const res = await api.git.commitFiles(id, c.id);
        setFiles((f) => ({ ...f, [c.id]: res.files }));
      } catch {
        /* ignorieren */
      }
    }
  };

  const restore = async (c: CommitInfo, path?: string) => {
    const ok = await confirm({
      title: path ? t('„{name}“ wiederherstellen?', { name: basename(path) }) : t('Diese Version wiederherstellen?'),
      description: path
        ? t('Die Datei wird auf den Stand von „{summary}“ gesetzt.', { summary: c.summary })
        : t(
            'Alle Dateien werden auf den Stand von „{summary}“ ({date}) gesetzt. Die Wiederherstellung erscheint danach als Änderung, die du als neue Version speichern kannst – es geht nichts verloren.',
            { summary: c.summary, date: dateTime(c.time * 1000) },
          ),
      confirm: t('Wiederherstellen'),
    });
    if (!ok) return;
    try {
      await saveNow();
      await api.git.restore(id, c.id, path);
      toast.success(t('Wiederhergestellt'), t('Speichere eine neue Version, um den Stand festzuhalten.'));
      await afterRepoChange(id);
    } catch (e) {
      toast.error(t('Wiederherstellen fehlgeschlagen'), e);
    }
  };

  if (!log)
    return (
      <div className="gitpanel__loading">
        <span className="spinner" />
      </div>
    );
  if (!log.length) return <div className="gitpanel__empty">{t('Noch keine Versionen.')}</div>;
  return (
    <div className="gitpanel__history">
      {log.map((c, i) => (
        <div key={c.id} className={`gitcommit${open === c.id ? ' is-open' : ''}`}>
          <button type="button" className="gitcommit__head" onClick={() => void toggle(c)}>
            <span className={`gitcommit__dot${i === 0 ? ' is-head' : ''}`} />
            <span className="gitcommit__text">
              <span className="gitcommit__summary">{c.summary || t('(ohne Beschreibung)')}</span>
              <span className="gitcommit__meta">
                {c.author} · <time title={dateTime(c.time * 1000)}>{relativeTime(c.time * 1000)}</time> · <code>{c.short}</code>
              </span>
            </span>
          </button>
          {open === c.id && (
            <div className="gitcommit__body">
              {c.body && <p className="gitcommit__msg">{c.body}</p>}
              <div className="gitcommit__files">
                {(files[c.id] ?? []).map((f) => (
                  <div key={f.path} className="gitcommit__file">
                    <button type="button" onClick={() => onDiff(f.path, c.id)} title={t('Änderungen ansehen')}>
                      <GitCompare />
                      <span className="truncate">{f.path}</span>
                    </button>
                    <span className="gitcommit__stat">
                      <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
                    </span>
                    {f.status !== 'deleted' && (
                      <IconButton label={t('Nur diese Datei wiederherstellen')} onClick={() => void restore(c, f.path)}>
                        <RotateCcw />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>
              {i > 0 && (
                <Button size="sm" icon={<RotateCcw />} onClick={() => void restore(c)}>
                  {t('Diese Version wiederherstellen')}
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SyncView({ id, status }: { id: string; status: RepoStatus }) {
  const [url, setUrl] = useState(status.remote ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  useEffect(() => setUrl(status.remote ?? ''), [status.remote]);

  const run = async (what: 'push' | 'pull' | 'fetch') => {
    setBusy(what);
    try {
      await saveNow();
      const res = await api.git[what](id);
      setOutput(res.output || t('Fertig.'));
      toast.success(what === 'push' ? t('Hochgeladen') : what === 'pull' ? t('Aktualisiert') : t('Abgerufen'));
      await afterRepoChange(id);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
      toast.error(t('Synchronisation fehlgeschlagen'), e);
    } finally {
      setBusy(null);
    }
  };

  const saveRemote = async () => {
    try {
      await api.git.setRemote(id, url);
      toast.success(url ? t('Entferntes Repository gespeichert') : t('Entferntes Repository entfernt'));
      void useGit.getState().refresh(id);
    } catch (e) {
      toast.error(t('Speichern fehlgeschlagen'), e);
    }
  };

  return (
    <div className="gitpanel__sync">
      {!status.cliAvailable && (
        <div className="gitpanel__notice">{t('Für Hoch- und Herunterladen wird Git benötigt. Lokale Versionen funktionieren auch ohne.')}</div>
      )}
      <label className="field">
        <span className="field__label">{t('Entferntes Repository (origin)')}</span>
        <div className="gitpanel__remote">
          <input className="input input--sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('https://github.com/team/handbuch.git')} />
          <Button size="sm" onClick={saveRemote} disabled={url === (status.remote ?? '')}>
            {t('Speichern')}
          </Button>
        </div>
        <span className="field__hint">{t('Anmeldung erfolgt über die Git-Anmeldedaten dieses Rechners.')}</span>
      </label>
      {status.remote && (
        <>
          <div className="gitpanel__syncstate">
            <CloudCog />
            {status.upstream ? (
              <span>
                {status.ahead === 0 && status.behind === 0
                  ? t('Auf dem gleichen Stand wie {upstream}', { upstream: status.upstream })
                  : status.ahead === 1
                    ? t('1 Version zum Hochladen, {behind} zum Herunterladen', { behind: status.behind })
                    : t('{ahead} Versionen zum Hochladen, {behind} zum Herunterladen', { ahead: status.ahead, behind: status.behind })}
              </span>
            ) : (
              <span>{t('Noch nicht verbunden – zuerst hochladen.')}</span>
            )}
          </div>
          <div className="gitpanel__syncbtns">
            <Button icon={<ArrowDownToLine />} loading={busy === 'pull'} disabled={!!busy || !status.cliAvailable} onClick={() => run('pull')}>
              {t('Herunterladen')}
            </Button>
            <Button variant="primary" icon={<ArrowUpFromLine />} loading={busy === 'push'} disabled={!!busy || !status.cliAvailable} onClick={() => run('push')}>
              {t('Hochladen')}
            </Button>
          </div>
          <Button variant="ghost" size="sm" icon={<RefreshCw />} loading={busy === 'fetch'} disabled={!!busy || !status.cliAvailable} onClick={() => run('fetch')}>
            {t('Auf Änderungen prüfen')}
          </Button>
        </>
      )}
      {output && <pre className="gitpanel__output">{output}</pre>}
      {status.identity && (
        <p className="gitpanel__hint">
          {t('Versionen werden gespeichert als {name} <{email}>.', { name: status.identity[0], email: status.identity[1] })}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vergleichsansicht
// ---------------------------------------------------------------------------

function DiffDialog({ id, target, onClose }: { id: string; target: { path: string; commit?: string } | null; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ old: string; new: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!target) return;
    api.git
      .diff(id, target.path, target.commit)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, target?.path, target?.commit]);

  const lang = useMemo(() => {
    if (!target) return [];
    if (/\.(mdoc|md)$/.test(target.path)) return [markdown()];
    if (target.path.endsWith('.typ')) return [typstStreamLanguage];
    return [];
  }, [target?.path]);

  useEffect(() => {
    if (!data || !host.current) return;
    const ext = [editorTheme, highlight, EditorView.editable.of(false), EditorState.readOnly.of(true), EditorView.lineWrapping, ...lang];
    const mv = new MergeView({
      a: { doc: data.old, extensions: ext },
      b: { doc: data.new, extensions: ext },
      parent: host.current,
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true,
    });
    return () => mv.destroy();
  }, [data, lang]);

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target ? basename(target.path) : ''}
      description={
        target
          ? target.commit
            ? t('Änderungen in Version {commit} · {path}', { commit: target.commit.slice(0, 8), path: target.path })
            : t('Ungespeicherte Änderungen seit der letzten Version · {path}', { path: target.path })
          : ''
      }
      size="wide"
    >
      <div className="diff">
        <div className="diff__legend">
          <span>{t('Vorher')}</span>
          <span>{t('Nachher')}</span>
        </div>
        {error ? <div className="diff__error">{error}</div> : !data ? <div className="gitpanel__loading"><span className="spinner" /></div> : <div ref={host} className="diff__view" />}
      </div>
    </Dialog>
  );
}
