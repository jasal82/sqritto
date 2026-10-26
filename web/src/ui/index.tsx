import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RSwitch from '@radix-ui/react-switch';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { t } from '../lib/i18n';
import { useToasts } from '../lib/store';
import { shortcut } from '../lib/format';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    iconOnly && 'btn--icon',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner btn__spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={450} skipDelayDuration={150}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tip({
  label,
  keys,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  keys?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {label}
          {keys && <Kbd keys={keys} />}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/** Icon-Schaltfläche mit Tooltip. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { label: string; keys?: string; tipSide?: 'top' | 'bottom' | 'left' | 'right' }
>(function IconButton({ label, keys, tipSide, variant = 'ghost', size = 'sm', ...rest }, ref) {
  return (
    <Tip label={label} keys={keys} side={tipSide}>
      <Button ref={ref} variant={variant} size={size} iconOnly aria-label={label} {...rest} />
    </Tip>
  );
});

export function Kbd({ keys }: { keys: string }) {
  return <kbd className="kbd">{shortcut(keys)}</kbd>;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size,
  className,
  initialFocus,
  locked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'wide';
  className?: string;
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Lässt sich nicht schließen (kein Schließen-Knopf, kein Escape, kein Klick daneben). */
  locked?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content
          className={['dialog', size && `dialog--${size}`, className].filter(Boolean).join(' ')}
          onOpenAutoFocus={(e) => {
            if (initialFocus?.current) {
              e.preventDefault();
              initialFocus.current.focus();
              return;
            }
            // Erstes Eingabefeld statt des Schließen-Knopfs fokussieren
            const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '.dialog__body input:not([type=hidden]):not([type=checkbox]):not([type=color]), .dialog__body textarea, .dialog__body select',
            );
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
          aria-describedby={description ? undefined : undefined}
          onEscapeKeyDown={locked ? (e) => e.preventDefault() : undefined}
          onPointerDownOutside={locked ? (e) => e.preventDefault() : undefined}
          onInteractOutside={locked ? (e) => e.preventDefault() : undefined}
        >
          <div className="dialog__header">
            <div>
              <RDialog.Title className="dialog__title">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="dialog__desc">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{typeof title === 'string' ? title : ''}</RDialog.Description>
              )}
            </div>
            {!locked && (
              <RDialog.Close asChild>
                <Button variant="ghost" size="sm" iconOnly className="dialog__close" aria-label={t('Schließen')}>
                  <X />
                </Button>
              </RDialog.Close>
            )}
          </div>
          {children}
          {footer && <div className="dialog__footer">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Bestätigungsdialog als Promise. */
type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
};

let confirmImpl: ((o: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirm(o: ConfirmOptions): Promise<boolean> {
  return confirmImpl ? confirmImpl(o) : Promise.resolve(window.confirm(o.title));
}

export function ConfirmHost() {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmImpl = (o) => new Promise<boolean>((resolve) => setState({ ...o, resolve }));
    return () => {
      confirmImpl = null;
    };
  }, []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      description={state?.description}
      initialFocus={ok}
      footer={
        <>
          <Button onClick={() => close(false)}>{state?.cancel ?? t('Abbrechen')}</Button>
          <Button ref={ok} variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirm ?? 'OK'}
          </Button>
        </>
      }
    />
  );
}

/** Eingabedialog als Promise (z. B. für Dateinamen). */
type PromptOptions = {
  title: string;
  description?: ReactNode;
  label?: string;
  value?: string;
  placeholder?: string;
  confirm?: string;
  validate?: (v: string) => string | null;
  selectBase?: boolean;
};

let promptImpl: ((o: PromptOptions) => Promise<string | null>) | null = null;

export function prompt(o: PromptOptions): Promise<string | null> {
  return promptImpl ? promptImpl(o) : Promise.resolve(window.prompt(o.title, o.value ?? ''));
}

export function PromptHost() {
  const [state, setState] = useState<(PromptOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    promptImpl = (o) =>
      new Promise((resolve) => {
        setValue(o.value ?? '');
        setState({ ...o, resolve });
      });
    return () => {
      promptImpl = null;
    };
  }, []);
  const error = state?.validate && value.trim() ? state.validate(value.trim()) : null;
  const close = (v: string | null) => {
    state?.resolve(v);
    setState(null);
  };
  const submit = () => {
    if (!value.trim() || error) return;
    close(value.trim());
  };
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => !o && close(null)}
      title={state?.title ?? ''}
      description={state?.description}
      initialFocus={input}
      footer={
        <>
          <Button onClick={() => close(null)}>{t('Abbrechen')}</Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim() || !!error}>
            {state?.confirm ?? 'OK'}
          </Button>
        </>
      }
    >
      <div className="dialog__body">
        <label className="field">
          {state?.label && <span className="field__label">{state.label}</span>}
          <input
            ref={input}
            className="input"
            value={value}
            placeholder={state?.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              if (state?.selectBase) {
                const v = e.target.value;
                const dot = v.lastIndexOf('.');
                const slash = v.lastIndexOf('/');
                e.target.setSelectionRange(slash + 1, dot > slash ? dot : v.length);
              } else e.target.select();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {error && <span className="field__error">{error}</span>}
        </label>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({
  children,
  align = 'end',
  side = 'bottom',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <RMenu.Portal>
      <RMenu.Content className={['menu', className].filter(Boolean).join(' ')} align={align} side={side} sideOffset={6} collisionPadding={8}>
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({
  icon,
  children,
  keys,
  danger,
  description,
  onSelect,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  keys?: string;
  danger?: boolean;
  description?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <RMenu.Item
      className={['menu__item', danger && 'menu__item--danger', description && 'menu__item--tall'].filter(Boolean).join(' ')}
      onSelect={onSelect}
      disabled={disabled}
    >
      {icon}
      {description ? (
        <span className="menu__desc">
          <span>{children}</span>
          <small>{description}</small>
        </span>
      ) : (
        children
      )}
      {keys && <span className="menu__shortcut">{shortcut(keys)}</span>}
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="menu__sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="menu__label">{children}</RMenu.Label>;
}

// ---------------------------------------------------------------------------
// Schalter, Segmente
// ---------------------------------------------------------------------------

export function Switch({
  checked,
  onChange,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <RSwitch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled}>
      <RSwitch.Thumb className="switch__thumb" />
    </RSwitch.Root>
  );
}

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch-row">
      <span className="switch-row__text">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean; title?: string }[];
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="segmented__item"
          aria-pressed={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="region" aria-label={t('Benachrichtigungen')} aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast toast--${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'}>
          {item.kind === 'success' ? (
            <CheckCircle2 className="toast__icon" />
          ) : item.kind === 'error' ? (
            <AlertCircle className="toast__icon" />
          ) : (
            <Info className="toast__icon" />
          )}
          <div className="toast__body">
            <div className="toast__title">{item.title}</div>
            {item.description && <div className="toast__desc">{item.description}</div>}
            {item.action && (
              <Button
                size="sm"
                className="toast__action"
                onClick={() => {
                  item.action!.run();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </Button>
            )}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('Schließen')} onClick={() => dismiss(item.id)}>
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sonstiges
// ---------------------------------------------------------------------------

export function Empty({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {children && <div className="empty__text">{children}</div>}
      {actions && <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>{actions}</div>}
    </div>
  );
}

/**
 * Logo: ein übergroßes S, ausgespart aus einem abgerundeten Quadrat
 * (Negativraum – durch das S scheint der Hintergrund).
 */
export function Logo({ size = 26 }: { size?: number }) {
  const mask = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <mask id={mask}>
        <rect width="64" height="64" rx="14" fill="#fff" />
        <path d={LOGO_S} fill="none" stroke="#000" strokeWidth="11" />
      </mask>
      <rect width="64" height="64" rx="14" fill="#e0532b" mask={`url(#${mask})`} />
    </svg>
  );
}

const LOGO_S =
  'M50.1 5C44.6 -0 35.2 -2 23.8 -0.4C9.5 1.6 1 9.6 2.4 19.3C3.8 29.7 13.7 31.4 27.4 31.9C41.3 32.5 51.4 34.4 52.9 44.8C54.3 54.7 45.8 62.2 31.9 64.1C20 65.8 10 63.2 3.6 57L-3.6 50';

/** Zieht mit der Maus eine Breite (für Seitenleisten und geteilte Ansichten). */
export function Resizer({
  onResize,
  onDoubleClick,
  side = 'right',
  label,
}: {
  onResize: (delta: number) => void;
  onDoubleClick?: () => void;
  side?: 'left' | 'right';
  label: string;
}) {
  const start = useRef<number | null>(null);
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(side === 'right' ? -16 : 16);
        if (e.key === 'ArrowRight') onResize(side === 'right' ? 16 : -16);
      }}
      onPointerDown={(e) => {
        start.current = e.clientX;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add('is-resizing');
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const d = e.clientX - start.current;
        start.current = e.clientX;
        onResize(side === 'right' ? d : -d);
      }}
      onPointerUp={(e) => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.classList.remove('is-resizing');
      }}
    />
  );
}
