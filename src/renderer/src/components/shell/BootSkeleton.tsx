import type { ParsedRoute } from '@shared/routes'
import { Card } from '@renderer/components/ui/Card'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { Page } from './Page'

/**
 * Esqueleto enquanto os dados iniciais chegam do main: mesma geometria da tela real
 * (sem salto de layout) e só aparece após ~150 ms, para não piscar em carregamentos rápidos.
 */
export function BootSkeleton({ route }: { route: ParsedRoute }) {
  return (
    <Page className="animate-[fade-in_240ms_var(--ease-out)_150ms_both]">
      <div role="status" aria-live="polite" className="sr-only">
        Carregando…
      </div>
      <div className="mb-6 flex items-end justify-between gap-6" aria-hidden>
        <div className="flex flex-col gap-2.5 pt-1">
          <Skeleton className="h-[22px] w-40" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>
      {route.name === 'dashboard' ? (
        <div className="flex flex-col gap-4" aria-hidden>
          <Card className="flex items-start gap-4 rounded-xl p-6">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex flex-1 flex-col gap-3 pt-1">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-3.5 w-96 max-w-full" />
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4 @[44rem]:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="flex flex-col gap-3 p-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-28" />
              </Card>
            ))}
          </div>
          <Card className="h-[260px]" />
        </div>
      ) : route.name === 'routines' || route.name === 'history' ? (
        <div aria-hidden>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Skeleton className="h-8 w-[320px] rounded-md" />
            <Skeleton className="h-8 w-[300px] rounded-md" />
          </div>
          <Card className="divide-y divide-border overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex h-[72px] items-center gap-4 px-5">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton
                    className={['h-3.5 w-44', 'h-3.5 w-36', 'h-3.5 w-52', 'h-3.5 w-40', 'h-3.5 w-48'][i]}
                  />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      ) : (
        <Card className="flex flex-col gap-4 p-5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-80 max-w-full" />
            </div>
          ))}
        </Card>
      )}
    </Page>
  )
}
