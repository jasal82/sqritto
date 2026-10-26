import { FileCode2, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DocKind } from '../lib/types';

export function KindIcon({ kind, className }: { kind: DocKind; className?: string }) {
  return kind === 'typst' ? (
    <FileCode2 className={['kind-icon kind-icon--typst', className].filter(Boolean).join(' ')} aria-hidden />
  ) : (
    <FileText className={['kind-icon kind-icon--markdoc', className].filter(Boolean).join(' ')} aria-hidden />
  );
}

export function kindLabel(kind: DocKind): string {
  return kind === 'typst' ? 'Typst' : 'Markdoc';
}

/** Stellt `Code` in Beschreibungstexten als <code> dar. */
export function RichText({ text }: { text: string }): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : p));
}
