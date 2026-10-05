import { Check, ChevronDown } from 'lucide-react'
import { Select as S } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'
import { inputBase } from './Input'

export interface SelectOption<T extends string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

interface SelectProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SelectOption<T>[]
  id?: string
  className?: string
  placeholder?: string
  label?: string
  size?: 'sm' | 'md'
  icon?: ReactNode
}

/** Select (§8): igual Input + ChevronDown; lista em popover radius-lg sh-pop, itens 32 px. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  className,
  placeholder,
  label,
  size = 'md',
  icon
}: SelectProps<T>) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <S.Trigger
        id={id}
        aria-label={label}
        className={cn(
          inputBase,
          'inline-flex items-center justify-between gap-[8px] text-left data-[placeholder]:text-fg-subtle',
          size === 'sm' && 'h-[24px] text-small',
          'data-[state=open]:border-accent-edge',
          className
        )}
      >
        <span className="flex min-w-0 items-center gap-[8px] truncate">
          {icon}
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon asChild>
          <ChevronDown className="size-[16px] shrink-0 text-fg-subtle" strokeWidth={1.75} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            'no-drag z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-raised p-[4px] shadow-pop',
            'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out'
          )}
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className={cn(
                  'relative flex min-h-[28px] items-center gap-[8px] rounded-sm py-[5px] pr-[32px] pl-[8px] text-small text-fg outline-none select-none',
                  'data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45'
                )}
              >
                {o.icon}
                <div className="flex min-w-0 flex-col">
                  <S.ItemText>{o.label}</S.ItemText>
                  {o.description && <span className="text-caption text-fg-subtle">{o.description}</span>}
                </div>
                <S.ItemIndicator className="absolute right-[8px] inline-flex">
                  <Check className="size-[16px] text-accent-text" strokeWidth={2} />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
