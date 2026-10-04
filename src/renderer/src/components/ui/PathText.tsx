import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { middleTruncate } from '@renderer/lib/format'
import { Tooltip } from './Tooltip'

let canvas: HTMLCanvasElement | null = null
function textWidth(text: string, font: string): number {
  canvas ??= document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * 7.2
  ctx.font = font
  return ctx.measureText(text).width
}

function fit(path: string, width: number, font: string): number {
  if (textWidth(path, font) <= width) return path.length
  let lo = 8
  let hi = path.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(middleTruncate(path, mid), font) <= width) lo = mid
    else hi = mid - 1
  }
  return lo
}

interface PathTextProps {
  path: string
  className?: string
  mono?: boolean
  /** Tooltip com o caminho completo (padrão: só quando truncado). */
  tooltip?: 'auto' | 'always' | 'never'
}

/**
 * Caminho com truncamento no meio ("C:\Clientes\…\NF-e 2026") que se ajusta à largura
 * disponível, com Tooltip do caminho completo. Use dentro de um contêiner com largura definida.
 */
export function PathText({ path, className, mono = true, tooltip = 'auto' }: PathTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [max, setMax] = useState<number>(path.length)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const width = el.clientWidth
      if (width <= 0) return
      const cs = getComputedStyle(el)
      // `font` (atalho) volta vazio quando há font-variant/feature personalizados — monte à mão.
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      setMax(fit(path, width - 1, font))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    void document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [path])

  const truncated = max < path.length
  const text = truncated ? middleTruncate(path, max) : path
  const show = tooltip === 'always' || (tooltip === 'auto' && truncated)
  return (
    <Tooltip label={show ? <span className="font-mono text-[11.5px]">{path}</span> : null} align="start">
      <span
        ref={ref}
        data-selectable
        className={cn(
          'block min-w-0 overflow-hidden whitespace-nowrap',
          mono && 'font-mono text-mono',
          className
        )}
      >
        {text}
      </span>
    </Tooltip>
  )
}
