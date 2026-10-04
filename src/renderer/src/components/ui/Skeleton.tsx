import { cn } from '@renderer/lib/cn'

/** Bloco de carregamento (pulsa suave; estático com movimento reduzido). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-sm bg-surface-hover', className)} />
}

/** Linhas de texto fantasmas, com a última mais curta. */
export function SkeletonLines({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
