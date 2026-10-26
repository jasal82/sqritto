// Formular für die Definition eines Elements (component.json).

import { ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { t } from '../../../lib/i18n';
import type { ComponentAttribute } from '../../../lib/types';
import { Button, IconButton, Segmented, Switch, Tip } from '../../../ui';
import { elementDir, ensureLoaded, getText, languageFor, setFileText, useEditor } from '../store';
import { MiniEditor } from './MiniEditor';
import { ATTR_TYPES, snippetFromDefinition, type ElementJson } from './util';
import { ElementCode } from './ElementEditor';

type Attr = ComponentAttribute;

export function ElementSettings({ name }: { name: string }) {
  const path = `${elementDir(name)}/component.json`;
  useEditor((s) => s.editTick);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [loaded, setLoaded] = useState(() => getText(path) !== undefined);
  useEffect(() => {
    void ensureLoaded(path).then(setLoaded);
  }, [path]);

  const text = getText(path);
  let def: ElementJson | null = null;
  let error: string | null = null;
  if (text !== undefined) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) def = v as ElementJson;
      else error = t('Die Definition muss ein JSON-Objekt sein.');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  if (!loaded || text === undefined) return <div className="el-settings__loading">{t('Definition wird geladen …')}</div>;

  const showJson = mode === 'json' || !def;
  return (
    <div className="el-settings">
      <div className="el-settings__bar">
        <Segmented
          label={t('Darstellung der Definition')}
          value={showJson ? 'json' : 'form'}
          onChange={(v) => setMode(v)}
          options={[
            { value: 'form', label: t('Formular'), disabled: !def },
            { value: 'json', label: 'JSON' },
          ]}
        />
        <span className="el-settings__file">component.json</span>
      </div>
      {error && (
        <div className="el-banner el-banner--error" role="alert">
          <strong>{t('Die Definition ist kein gültiges JSON.')}</strong>{' '}
          {t('{error}. Das Formular ist wieder verfügbar, sobald der Fehler behoben ist.', { error })}
        </div>
      )}
      {showJson ? <ElementCode name={name} file="component.json" /> : <DefinitionForm name={name} path={path} def={def!} />}
    </div>
  );
}

function DefinitionForm({ name, path, def }: { name: string; path: string; def: ElementJson }) {
  const components = useEditor((s) => s.components);
  const uid = useId();
  const categories = useMemo(
    () => [...new Set(components.map((c) => c.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [components],
  );

  /** Felder setzen; `undefined` entfernt ein Feld. Reihenfolge bleibt erhalten. */
  const update = (patch: Partial<ElementJson>) => {
    const next: ElementJson = { ...def };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete next[k];
      else next[k] = v;
    }
    setFileText(path, `${JSON.stringify(next, null, 2)}\n`);
  };

  const markdoc = useMemo(() => languageFor('content/__element__.mdoc'), []);
  const snippetHint = t(
    'Wird beim Einfügen über die Seitenleiste, die Befehlspalette und die Vervollständigung verwendet. {placeholder} markiert Stellen, die nach dem Einfügen nacheinander angesprungen werden.',
  ).split('{placeholder}');

  return (
    <div className="el-form">
      <section className="el-form__section">
        <h3>{t('Allgemein')}</h3>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">{t('Titel')}</span>
            <input className="input" value={def.title ?? ''} placeholder={name} onChange={(e) => update({ title: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">{t('Kategorie')}</span>
            <input
              className="input"
              list={`${uid}-cat`}
              value={def.category ?? ''}
              placeholder={t('z. B. Hervorhebung')}
              onChange={(e) => update({ category: e.target.value })}
            />
            <datalist id={`${uid}-cat`}>
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field form-grid__full">
            <span className="field__label">{t('Beschreibung')}</span>
            <textarea
              className="textarea"
              rows={2}
              value={def.description ?? ''}
              placeholder={t('Wofür ist das Element gedacht? Wird in der Seitenleiste und bei der Vervollständigung angezeigt.')}
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>
        </div>
      </section>

      <section className="el-form__section">
        <h3>{t('Verhalten')}</h3>
        <div className="el-form__rows">
          <div className="el-row">
            <div className="el-row__text">
              <strong>{t('Art')}</strong>
              <span>{t('Blockelemente stehen in eigenen Absätzen, Inline-Elemente im Fließtext.')}</span>
            </div>
            <Segmented
              label={t('Art des Elements')}
              value={def.inline ? 'inline' : 'block'}
              onChange={(v) => update({ inline: v === 'inline' ? true : undefined })}
              options={[
                { value: 'block', label: t('Block') },
                { value: 'inline', label: t('Inline') },
              ]}
            />
          </div>
          <label className="el-row">
            <span className="el-row__text">
              <strong>{t('Ohne Inhalt')}</strong>
              <span>{t('Selbstschließend, z. B. {tag} – nur Attribute, kein Inhalt.', { tag: '{% name /%}' })}</span>
            </span>
            <Switch checked={!!def.selfClosing} onChange={(v) => update({ selfClosing: v || undefined })} />
          </label>
          <label className="el-row">
            <span className="el-row__text">
              <strong>{t('Im PDF ausgeben')}</strong>
              <span>{t('Ausgeschaltet erscheint das Element nur in der Website.')}</span>
            </span>
            <Switch checked={def.pdf !== false} onChange={(v) => update({ pdf: v ? undefined : false })} />
          </label>
        </div>
      </section>

      <section className="el-form__section">
        <div className="el-form__head">
          <h3>{t('Attribute')}</h3>
          <Button
            size="sm"
            icon={<Plus />}
            onClick={() => {
              const attrs = def.attributes ?? {};
              const base = t('attribut');
              let n = base;
              for (let i = 2; n in attrs; i++) n = `${base}${i}`;
              update({ attributes: { ...attrs, [n]: { type: 'String' } } });
            }}
          >
            {t('Attribut')}
          </Button>
        </div>
        <AttributeList attributes={def.attributes ?? {}} onChange={(attributes) => update({ attributes })} />
      </section>

      <section className="el-form__section">
        <div className="el-form__head">
          <h3>{t('Einfüge-Vorlage')}</h3>
          <Tip label={t('Ersetzt die Vorlage durch eine aus den Attributen erzeugte')}>
            <Button size="sm" icon={<RefreshCw />} onClick={() => update({ snippet: snippetFromDefinition(name, def) })}>
              {t('Aus Attributen erzeugen')}
            </Button>
          </Tip>
        </div>
        <p className="el-form__hint">
          {snippetHint[0]}
          <code>{'${'}{t('Text')}{'}'}</code>
          {snippetHint[1]}
        </p>
        <MiniEditor
          label={t('Einfüge-Vorlage')}
          value={def.snippet ?? ''}
          placeholder={snippetFromDefinition(name, def)}
          onChange={(v) => update({ snippet: v })}
          extensions={markdoc}
        />
      </section>

      <details className="el-form__section el-form__advanced">
        <summary>
          <ChevronRight className="el-form__chevron" />
          {t('Erweitert')}
        </summary>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">{t('Typst-Funktion')}</span>
            <input
              className="input mono"
              value={def.typst ?? ''}
              placeholder={`ts-${name}`}
              onChange={(e) => update({ typst: e.target.value.trim() })}
            />
            <span className="field__hint">{t('Name der Funktion in der PDF-Vorlage.')}</span>
          </label>
          <label className="field">
            <span className="field__label">{t('Nur innerhalb von')}</span>
            <input
              className="input mono"
              value={(def.parents ?? []).join(', ')}
              placeholder={t('z. B. tabs')}
              onChange={(e) =>
                update({
                  parents: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
            <span className="field__hint">{t('Erlaubte umgebende Elemente, durch Komma getrennt.')}</span>
          </label>
          <label className="field">
            <span className="field__label">{t('Kind-Elemente sammeln')}</span>
            <input className="input mono" value={def.collect ?? ''} placeholder={t('z. B. card')} onChange={(e) => update({ collect: e.target.value.trim() })} />
            <span className="field__hint">{t('Kinder dieses Typs werden der Typst-Funktion einzeln übergeben.')}</span>
          </label>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attribute
// ---------------------------------------------------------------------------

function AttributeList({ attributes, onChange }: { attributes: Record<string, Attr>; onChange: (a: Record<string, Attr>) => void }) {
  const entries = Object.entries(attributes);
  if (!entries.length) {
    return <div className="el-empty">{t('Noch keine Attribute. Attribute werden im Tag gesetzt, z. B. {% name titel="…" %}.')}</div>;
  }
  const replace = (index: number, key: string, attr: Attr | null) => {
    const next: [string, Attr][] = [];
    entries.forEach(([k, a], i) => {
      if (i !== index) next.push([k, a]);
      else if (attr) next.push([key, attr]);
    });
    onChange(Object.fromEntries(next));
  };
  return (
    <div className="el-attrs">
      {entries.map(([key, attr], i) => (
        <AttributeCard
          key={i}
          name={key}
          attr={attr}
          taken={entries.filter((_, j) => j !== i).map(([k]) => k)}
          onChange={(k, a) => replace(i, k, a)}
          onRemove={() => replace(i, key, null)}
        />
      ))}
    </div>
  );
}

function AttributeCard({
  name,
  attr,
  taken,
  onChange,
  onRemove,
}: {
  name: string;
  attr: Attr;
  taken: string[];
  onChange: (name: string, attr: Attr) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => setDraft(name), [name]);
  const type = attr.type ?? 'String';
  const set = (patch: Partial<Attr>) => {
    const next: Attr = { ...attr, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined || v === false || v === '') delete (next as Record<string, unknown>)[k];
    onChange(name, next);
  };
  const commitName = () => {
    const v = draft.trim();
    if (v === name) return setNameError(null);
    if (!/^[a-zA-Z_][\w-]*$/.test(v)) return setNameError(t('Nur Buchstaben, Ziffern, _ und -; Beginn mit Buchstabe.'));
    if (taken.includes(v)) return setNameError(t('Dieser Name ist schon vergeben.'));
    setNameError(null);
    onChange(v, attr);
  };
  const kind = attr.link ? 'link' : attr.asset ? 'asset' : 'text';

  return (
    <div className="el-attr">
      <div className="el-attr__head">
        <input
          className={`input input--sm mono el-attr__name${nameError ? ' is-invalid' : ''}`}
          value={draft}
          aria-label={t('Name des Attributs')}
          aria-invalid={!!nameError}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
        />
        <select
          className="select input--sm el-attr__type"
          aria-label={t('Typ')}
          value={type}
          onChange={(e) => set({ type: e.target.value as Attr['type'], default: undefined, matches: undefined, link: undefined, asset: undefined })}
        >
          {ATTR_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="el-attr__req">
          <Switch checked={!!attr.required} onChange={(v) => set({ required: v })} />
          {t('Pflicht')}
        </label>
        <IconButton label={t('Attribut entfernen')} icon={<Trash2 />} onClick={onRemove} />
      </div>
      {nameError && <span className="field__error">{nameError}</span>}
      <div className="el-attr__grid">
        <label className="field el-attr__desc">
          <span className="field__label">{t('Beschreibung')}</span>
          <input className="input input--sm" value={attr.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <DefaultField type={type} value={attr.default} matches={attr.matches} onChange={(v) => set({ default: v })} />
        {(type === 'String' || type === 'Number') && (
          <label className="field">
            <span className="field__label">{t('Erlaubte Werte')}</span>
            <ListInput
              value={attr.matches}
              numeric={type === 'Number'}
              placeholder={t('beliebig')}
              onChange={(v) => set({ matches: v })}
            />
          </label>
        )}
        {type === 'String' && (
          <label className="field">
            <span className="field__label">{t('Bedeutung')}</span>
            <select
              className="select input--sm"
              value={kind}
              onChange={(e) => set({ link: e.target.value === 'link' || undefined, asset: e.target.value === 'asset' || undefined })}
            >
              <option value="text">{t('Text')}</option>
              <option value="link">{t('Verweis (Seite, Anker, URL)')}</option>
              <option value="asset">{t('Datei im Dokument')}</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

function DefaultField({
  type,
  value,
  matches,
  onChange,
}: {
  type: NonNullable<Attr['type']>;
  value: unknown;
  matches?: unknown[];
  onChange: (v: unknown) => void;
}) {
  const label = <span className="field__label">{t('Standardwert')}</span>;
  if (type === 'Boolean') {
    return (
      <label className="field">
        {label}
        <select
          className="select input--sm"
          value={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        >
          <option value="">–</option>
          <option value="true">{t('Ja')}</option>
          <option value="false">{t('Nein')}</option>
        </select>
      </label>
    );
  }
  if (matches?.length) {
    return (
      <label className="field">
        {label}
        <select
          className="select input--sm"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : type === 'Number' ? Number(e.target.value) : e.target.value)}
        >
          <option value="">–</option>
          {matches.map((m) => (
            <option key={String(m)} value={String(m)}>
              {String(m)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (type === 'Number') {
    return (
      <label className="field">
        {label}
        <input
          className="input input--sm"
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }
  if (type === 'Array' || type === 'Object') return <JsonDefault value={value} onChange={onChange} />;
  return (
    <label className="field">
      {label}
      <input className="input input--sm" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} />
    </label>
  );
}

function JsonDefault({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = useState(value === undefined ? '' : JSON.stringify(value));
  const [error, setError] = useState(false);
  useEffect(() => setDraft(value === undefined ? '' : JSON.stringify(value)), [value]);
  return (
    <label className="field">
      <span className="field__label">{t('Standardwert (JSON)')}</span>
      <input
        className={`input input--sm mono${error ? ' is-invalid' : ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!draft.trim()) {
            setError(false);
            return onChange(undefined);
          }
          try {
            onChange(JSON.parse(draft));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      />
    </label>
  );
}

/** Kommagetrennte Liste (z. B. erlaubte Werte), bearbeitbar wie Text. */
function ListInput({
  value,
  numeric,
  placeholder,
  onChange,
}: {
  value?: unknown[];
  numeric?: boolean;
  placeholder?: string;
  onChange: (v: unknown[] | undefined) => void;
}) {
  const text = (value ?? []).map(String).join(', ');
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    const items = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (numeric && !Number.isNaN(Number(s)) ? Number(s) : s));
    onChange(items.length ? items : undefined);
  };
  return (
    <input
      className="input input--sm"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}
