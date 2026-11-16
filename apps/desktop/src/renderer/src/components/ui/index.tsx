import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import React, {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { useAppStore } from '../../kernel'

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

/** Hàng trong menu/popover: một chỗ duy nhất để đổi nhịp và bo góc. */
export const menuRow =
  'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-[var(--text)] transition-colors duration-150 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]'
/** Vỏ popover/menu nổi. */
export const popoverShell =
  'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-overlay)]'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'btn-solid text-[var(--accent-contrast)] border border-transparent hover:brightness-[1.06] active:brightness-100',
  secondary:
    'bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border-strong)] shadow-[var(--inset-highlight)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
  ghost:
    'bg-transparent text-[var(--text-muted)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:bg-[var(--bg-active)]',
  subtle:
    'bg-[var(--bg-surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
  danger:
    'bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)]/35 hover:bg-[var(--danger)]/15',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'xs' | 'sm' | 'md'
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  loading,
  icon,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  const sizes = {
    xs: 'h-[26px] px-2 text-[12.5px] gap-1 rounded-[var(--radius-sm)]',
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius)]',
    md: 'h-9 px-3.5 text-[13.5px] gap-2 rounded-[var(--radius)]',
  }
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius)] font-medium transition-[background-color,color,opacity,box-shadow,filter] duration-150 select-none whitespace-nowrap',
        'disabled:opacity-45 disabled:pointer-events-none',
        sizes[size],
        buttonStyles[variant],
        block && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  active,
  className,
  size = 16,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  active?: boolean
  size?: number
}): React.JSX.Element {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]',
          'transition-[background-color,color] duration-150 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:bg-[var(--bg-active)] disabled:opacity-40',
          active && 'bg-[var(--bg-active)] text-[var(--text)]',
          className,
        )}
        {...rest}
      >
        <span
          style={{ width: size, height: size }}
          className="inline-flex items-center justify-center"
        >
          {rest.children}
        </span>
      </button>
    </Tooltip>
  )
}

export const Input = React.forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[13px] transition-[border-color,box-shadow] duration-150',
          'placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)]',
          'focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-0',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      />
    )
  },
)

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-[12.5px] font-medium text-[var(--text)]">{label}</span>
      {children}
      {hint ? (
        <span className="block text-[11.5px] leading-snug text-[var(--text-muted)]">{hint}</span>
      ) : null}
    </label>
  )
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      aria-label={ariaLabel}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full border border-[var(--border-strong)] transition-colors',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-surface)]',
        disabled && 'opacity-50',
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block h-[14px] w-[14px] rounded-full bg-[var(--bg)] shadow transition-transform',
          checked ? 'translate-x-[17px] bg-[var(--accent-contrast)]' : 'translate-x-[2px]',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size = 'sm',
  className,
  ariaLabel,
}: {
  value?: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  size?: 'xs' | 'sm'
  className?: string
  ariaLabel?: string
}): React.JSX.Element {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center justify-between gap-1.5 whitespace-nowrap rounded-full border border-transparent text-[var(--text-faint)]',
          'hover:bg-[var(--bg-hover)] hover:border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-50',
          size === 'xs' ? 'h-7 px-2 text-[13px]' : 'h-7 px-2.5 text-[13px]',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? '—'} />
        <SelectPrimitive.Icon>
          <ChevronDown
            size={size === 'xs' ? 12 : 13}
            className="shrink-0 text-[var(--text-muted)]"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[80] max-h-[340px] min-w-[200px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 surface-raised"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex cursor-default select-none items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-[var(--bg-hover)] data-[disabled]:opacity-40"
              >
                <div className="min-w-0">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description ? (
                    <div className="truncate text-[12.5px] text-[var(--text-muted)]">
                      {option.description}
                    </div>
                  ) : null}
                </div>
                <SelectPrimitive.ItemIndicator>
                  <Check size={13} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

const TooltipContext = createContext(false)

export function TooltipProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipContext.Provider value={true}>{children}</TooltipContext.Provider>
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
}: {
  content: string
  children: React.JSX.Element
  side?: 'top' | 'bottom' | 'left' | 'right'
}): React.JSX.Element {
  const hasProvider = useContext(TooltipContext)
  if (!hasProvider) return children
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[90] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11.5px] text-[var(--text)] surface-raised"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  width?: number
}): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          style={{ width }}
          className="animate-pop fixed left-1/2 top-1/2 z-[75] max-h-[85vh] w-[calc(100vw-48px)] max-w-full -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)] surface-raised"
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[14.5px] font-semibold tracking-[-0.01em]">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Đóng"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
              >
                <X size={15} />
              </button>
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[calc(85vh-124px)] overflow-y-auto border-t border-[var(--border-subtle)] px-5 py-4">
            {children}
          </div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-inset)]/70 px-5 py-3">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'danger' | 'warning' | 'success'
}): React.JSX.Element {
  const tones: Record<string, string> = {
    neutral: 'text-[var(--text-muted)] bg-[var(--bg-surface)] border-[var(--border)]',
    danger: 'text-[var(--danger)] bg-[var(--danger-soft)] border-[var(--danger)]/25',
    warning: 'text-[var(--warning)] bg-[var(--warning-soft)] border-[var(--warning)]/25',
    success: 'text-[var(--success)] bg-[var(--success-soft)] border-[var(--success)]/25',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-xs)] border px-1.5 py-[1px] text-[11px] font-medium tracking-[0.01em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return <Loader2 size={size} className="animate-spin text-[var(--text-muted)]" />
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 py-16 text-center">
      <h2 className="text-[14px] font-medium leading-tight text-[var(--text)]">{title}</h2>
      {description ? (
        <p className="max-w-[360px] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useAppStore((state) => state.toasts)
  const dismissToast = useAppStore((state) => state.dismissToast)
  const tones: Record<string, string> = {
    info: 'text-[var(--text)]',
    success: 'text-[var(--success)]',
    warning: 'text-[var(--warning)]',
    error: 'text-[var(--danger)]',
  }
  const dots: Record<string, string> = {
    info: 'bg-[var(--text-faint)]',
    success: 'bg-[var(--success)]',
    warning: 'bg-[var(--warning)]',
    error: 'bg-[var(--danger)]',
  }
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[310px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-pop pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 surface-pop"
        >
          <span
            className={cn('mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full', dots[toast.level])}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className={cn('text-[12.5px] font-medium', tones[toast.level])}>{toast.title}</div>
            {toast.body ? (
              <div className="mt-0.5 break-words text-[12px] leading-relaxed text-[var(--text-muted)]">
                {toast.body}
              </div>
            ) : null}
          </div>
          <IconButton label="Đóng" className="-mr-1 h-6 w-6" onClick={() => dismissToast(toast.id)}>
            <X size={11} />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
