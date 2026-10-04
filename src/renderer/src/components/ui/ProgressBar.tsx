import { cn } from '@renderer/lib/cn'

interface ProgressBarProps {
  /** 0–100; undefined = indeterminado. */
  value?: number
  size?: 'sm' | 'md'
  tone?: 'accent' | 'success' | 'warning' | 'danger'
  className?: string
  label?: string
}

const FILL = {
  accent: 'bg-accent',
  success: 'bg-success-bar',
  warning: 'bg-warning-bar',
  danger: 'bg-danger-bar'
}

/** ProgressBar (§8): 6 px (8 no drawer), trilho surface-hover, radius-xs; largura 400 ms linear. */
export function ProgressBar({ value, size = 'sm', tone = 'accent', className, label }: ProgressBarProps) {
  const indeterminate = value === undefined
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      className={cn(
        'relative w-full overflow-hidden rounded-xs bg-surface-hover',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className
      )}
    >
      {indeterminate ? (
        <div
          className={cn('absolute inset-y-0 left-0 w-[30%] rounded-xs animate-indeterminate', FILL[tone])}
        />
      ) : (
        <div
          className={cn('h-full rounded-xs transition-[width] duration-[400ms] ease-linear', FILL[tone])}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  )
}
