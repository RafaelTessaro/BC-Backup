import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { Slot } from 'radix-ui'
import { cn } from '@renderer/lib/cn'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-foreground font-semibold shadow-primary hover:bg-accent-hover active:bg-accent-hover',
  secondary:
    'bg-surface-raised text-fg border border-border-strong shadow-xs hover:bg-surface-hover active:bg-surface-hover',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-hover',
  danger:
    'bg-danger-soft text-danger border border-transparent hover:border-danger/30 active:border-danger/40',
  link: 'text-accent-text hover:underline underline-offset-4 decoration-accent-text/40 px-0! h-auto!'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 gap-1.5 rounded-sm text-caption',
  md: 'h-8 px-3 gap-1.5 rounded-md text-small',
  lg: 'h-10 px-4 gap-2 rounded-md text-body'
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-7 rounded-sm',
  md: 'size-8 rounded-md',
  lg: 'size-10 rounded-md'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading,
    asChild,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  const Comp = asChild ? Slot.Root : 'button'
  const iconCls = size === 'lg' ? 'size-4' : size === 'sm' ? 'size-3.5' : 'size-4'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,box-shadow,opacity] duration-[120ms] ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        SIZES[size],
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <LoaderCircle className={cn(iconCls, 'animate-spin-slow')} strokeWidth={1.75} aria-hidden />
          ) : Icon ? (
            <Icon className={iconCls} strokeWidth={1.75} aria-hidden />
          ) : null}
          {children}
          {IconRight && (
            <IconRight className={cn(iconCls, '-mr-0.5 opacity-80')} strokeWidth={1.75} aria-hidden />
          )}
        </>
      )}
    </Comp>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Obrigatório: vira Tooltip e aria-label. */
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  loading?: boolean
  shortcut?: ReactNode
}

/** Botão só com ícone: quadrado + Tooltip obrigatório (§8). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    variant = 'ghost',
    size = 'sm',
    tooltipSide = 'top',
    loading,
    className,
    shortcut,
    ...rest
  },
  ref
) {
  return (
    <Tooltip
      label={
        shortcut ? (
          <span className="flex items-center gap-2">
            {label}
            {shortcut}
          </span>
        ) : (
          label
        )
      }
      side={tooltipSide}
    >
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={rest.disabled || loading}
        className={cn(
          'inline-flex shrink-0 items-center justify-center transition-[background-color,border-color,color] duration-[120ms]',
          'disabled:pointer-events-none disabled:opacity-45',
          ICON_SIZES[size],
          VARIANTS[variant],
          className
        )}
        {...rest}
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin-slow" strokeWidth={1.75} aria-hidden />
        ) : (
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </Tooltip>
  )
})
