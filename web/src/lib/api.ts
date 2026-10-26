import type {
  AppInfo,
  BranchInfo,
  CommitFile,
  CommitInfo,
  CompileResult,
  ComponentDef,
  DocDetail,
  DocSummary,
  ElementPreview,
  ElementPreviewRequest,
  FileNode,
  JumpTarget,
  Manifest,
  RepoStatus,
  TemplateInfo,
  UniverseTemplate,
  UpdateStatus,
} from './types';
import { t } from './i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal };
  if (body instanceof FormData) init.body = body;
  else if (typeof body === 'string') {
    init.body = body;
    init.headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = res.statusText || t('Fehler {status}', { status: res.status });
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

const get = <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const put = <T>(url: string, body?: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);

const d = (id: string) => `/api/documents/${encodeURIComponent(id)}`;
const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  info: () => get<AppInfo>('/api/info'),
  settings: () => get<Record<string, unknown>>('/api/settings'),
  saveSettings: (s: unknown) => put<Record<string, unknown>>('/api/settings', s),
  fonts: () => get<string[]>('/api/fonts'),
  update: {
    status: () => get<UpdateStatus>('/api/update'),
    check: () => post<UpdateStatus>('/api/update/check'),
    install: () => post<UpdateStatus>('/api/update/install'),
  },
  pickFolder: () => post<{ path: string | null }>('/api/system/pick-folder'),
  reveal: (id: string, path?: string) => post('/api/system/reveal', { id, path }),
  revealFile: (path: string) => post('/api/system/reveal-file', { path }),
  saveExport: (id: string, format: 'pdf' | 'html' | 'typst') =>
    post<{ path?: string; cancelled?: boolean }>(`/api/documents/${encodeURIComponent(id)}/export/${format}/save`),
  openPdf: (id: string) => post<{ path: string }>(`/api/documents/${encodeURIComponent(id)}/export/pdf/open`),
  formatMarkdoc: (source: string) => post<{ text: string }>('/api/format', { source }),

  templates: () => get<TemplateInfo[]>('/api/templates'),
  templateThumbnail: (id: string) => `/api/templates/${encodeURIComponent(id)}/thumbnail`,
  saveTemplate: (docId: string, name: string, description: string) =>
    post<{ id: string }>('/api/templates', { docId, name, description }),
  deleteTemplate: (id: string) => del(`/api/templates/${encodeURIComponent(id)}`),
  universe: (query: string, category?: string, signal?: AbortSignal) =>
    get<UniverseTemplate[]>(`/api/universe/templates${q({ q: query, category })}`, signal),
  universeThumbnail: (t: UniverseTemplate) =>
    `/api/universe/thumbnail/${encodeURIComponent(t.name)}/${encodeURIComponent(t.version)}`,

  documents: () => get<DocSummary[]>('/api/documents'),
  createDocument: (req: {
    title: string;
    template: string;
    location?: string | null;
    git: boolean;
    author?: string;
  }) => post<DocSummary>('/api/documents', req),
  importDocument: (path: string) => post<DocSummary>('/api/documents/import', { path }),
  document: (id: string) => get<DocDetail>(d(id)),
  deleteDocument: (id: string, files: boolean) => del(`${d(id)}${q({ files })}`),
  duplicateDocument: (id: string) => post<DocSummary>(`${d(id)}/duplicate`),
  patchManifest: (id: string, patch: unknown) => put<Manifest>(`${d(id)}/manifest`, patch),
  components: (id: string) => get<{ components: ComponentDef[]; errors: string[] }>(`${d(id)}/components`),
  createComponent: (id: string, name: string, from?: string) =>
    post<{ path: string }>(`${d(id)}/components`, { name, from }),
  elementPreview: (id: string, name: string, req: ElementPreviewRequest) =>
    post<ElementPreview>(`${d(id)}/components/${encodeURIComponent(name)}/preview`, req),

  tree: (id: string) => get<FileNode[]>(`${d(id)}/tree`),
  readFile: (id: string, path: string) => get<string>(`${d(id)}/file${q({ path })}`),
  writeFile: (id: string, path: string, content: string) => put(`${d(id)}/file${q({ path })}`, content),
  rawUrl: (id: string, path: string) => `${d(id)}/raw/${path.split('/').map(encodeURIComponent).join('/')}`,
  fileOp: (id: string, op: { action: 'create' | 'mkdir' | 'rename' | 'delete'; path: string; to?: string; content?: string }) =>
    post(`${d(id)}/files`, op),
  upload: (id: string, files: File[], dir = 'assets') => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    return request<{ files: string[] }>('POST', `${d(id)}/upload${q({ dir })}`, fd);
  },

  compile: (id: string) => post<CompileResult>(`${d(id)}/compile`),
  pageUrl: (id: string, index: number, hash: string) => `${d(id)}/pages/${index}.svg?v=${hash}`,
  pagePngUrl: (id: string, index: number, scale = 2, hash?: string) =>
    `${d(id)}/pages/${index}.png?scale=${scale}${hash ? `&v=${hash}` : ''}`,
  exportUrl: (id: string, format: 'pdf' | 'html' | 'typst', inline = false) =>
    `${d(id)}/export/${format}${inline ? '?inline=true' : ''}`,
  jump: (id: string, page: number, x: number, y: number) => post<JumpTarget | null>(`${d(id)}/jump`, { page, x, y }),
  cursor: (id: string, path: string, line: number, column: number) =>
    post<{ page: number; x: number; y: number }[]>(`${d(id)}/cursor`, { path, line, column }),
  complete: (id: string, path: string, text: string, offset: number, explicit: boolean) =>
    post<{ from: number; items: { label: string; apply?: string | null; detail?: string | null; kind: string }[] } | null>(
      `${d(id)}/complete`,
      { path, text, offset, explicit },
    ),
  watch: (id: string) => post(`${d(id)}/watch`),
  unwatch: (id: string) => del(`${d(id)}/watch`),
  previewUrl: (id: string, slug?: string) => `/preview/${encodeURIComponent(id)}/${slug ? `${slug}.html` : ''}`,

  git: {
    status: (id: string) => get<RepoStatus>(`${d(id)}/git/status`),
    init: (id: string, name?: string, email?: string) => post(`${d(id)}/git/init`, { name, email }),
    commit: (id: string, message: string, paths?: string[]) => post<CommitInfo>(`${d(id)}/git/commit`, { message, paths }),
    log: (id: string, limit = 200, path?: string) => get<CommitInfo[]>(`${d(id)}/git/log${q({ limit, path })}`),
    commitFiles: (id: string, sha: string) => get<{ commit: CommitInfo; files: CommitFile[] }>(`${d(id)}/git/commits/${sha}`),
    diff: (id: string, path: string, commit?: string) => get<{ old: string; new: string }>(`${d(id)}/git/diff${q({ path, commit })}`),
    discard: (id: string, path: string) => post(`${d(id)}/git/discard`, { path }),
    restore: (id: string, commit: string, path?: string) => post(`${d(id)}/git/restore`, { commit, path }),
    branches: (id: string) => get<BranchInfo[]>(`${d(id)}/git/branches`),
    createBranch: (id: string, name: string, checkout: boolean) => post(`${d(id)}/git/branches`, { name, checkout }),
    checkout: (id: string, name: string) => post(`${d(id)}/git/checkout`, { name }),
    setRemote: (id: string, url: string) => post(`${d(id)}/git/remote`, { url }),
    push: (id: string) => post<{ output: string }>(`${d(id)}/git/push`),
    pull: (id: string) => post<{ output: string }>(`${d(id)}/git/pull`),
    fetch: (id: string) => post<{ output: string }>(`${d(id)}/git/fetch`),
    setIdentity: (id: string, name: string, email: string) => post(`${d(id)}/git/identity`, { name, email }),
  },
};

/** Lädt eine Datei herunter und meldet Fehler sauber zurück. */
export async function download(url: string, fallbackName: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignorieren */
    }
    throw new ApiError(msg, res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="([^"]+)"/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement('a');
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}
