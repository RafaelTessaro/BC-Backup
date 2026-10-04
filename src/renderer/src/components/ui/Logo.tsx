import { useId } from 'react'
import { cn } from '@renderer/lib/cn'

/** Ícone da marca (§2): squircle cobalto com seta circular + check. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={`bc-g-${id}`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5674FF" />
          <stop offset="1" stopColor="#2843D6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#bc-g-${id})`} />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="#fff" strokeOpacity=".14" />
      <g stroke="#fff" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 16a8 8 0 1 0 8-8 8.67 8.67 0 0 0-5.99 2.44L8 12.44" />
        <path d="M8 8v4.44h4.44" />
        <path d="M12.75 16.25l2.25 2.25 4.25-4.5" />
      </g>
    </svg>
  )
}

/** Wordmark (§2): ícone + "BC" 600 + "Backup" 400 muted. */
export function Wordmark({ size = 15, className }: { size?: number; className?: string }) {
  const icon = Math.round(size * 1.6)
  return (
    <span className={cn('inline-flex items-center', className)} style={{ gap: Math.round(size * 0.53) }}>
      <BrandMark size={icon} />
      <span className="leading-none tracking-[-0.02em] whitespace-nowrap" style={{ fontSize: size }}>
        <span className="font-semibold text-fg">BC</span>{' '}
        <span className="font-normal text-fg-muted">Backup</span>
      </span>
    </span>
  )
}
