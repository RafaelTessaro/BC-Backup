import type { LucideIcon } from 'lucide-react'
import { DropdownMenu as M } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

export const MenuRoot = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({
  children,
  align = 'end',
  className,
  side = 'bottom'
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          'no-drag z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-surface-raised p-1 shadow-pop',
          'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          className
        )}
        onCloseAutoFocus={(e) => {
          // Esc/fechar devolve o foco ao gatilho (Radix). Se um item já levou o foco para outro
          // lugar (dialog, campo com autofoco), não o roubamos de volta.
          const a = document.activeElement
          if (a && a !== document.body) e.preventDefault()
        }}
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  danger,
  disabled,
  hint
}: {
  icon?: LucideIcon
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-sm px-2 text-small outline-none select-none',
        'data-[disabled]:opacity-45',
        danger
          ? 'text-danger data-[highlighted]:bg-danger-soft'
          : 'text-fg data-[highlighted]:bg-surface-hover'
      )}
    >
      {Icon && (
        <Icon
          className={cn('size-4 shrink-0', danger ? 'text-danger' : 'text-fg-subtle')}
          strokeWidth={1.75}
        />
      )}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="ml-3 text-caption text-fg-subtle">{hint}</span>}
    </M.Item>
  )
}

export function MenuSeparator() {
  return <M.Separator className="-mx-1 my-1 h-px bg-border" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-caption font-medium text-fg-subtle">{children}</M.Label>
}
