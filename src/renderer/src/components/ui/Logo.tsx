import { useId } from 'react'
import { cn } from '@renderer/lib/cn'

// Marca do BC Backup redesenhada em vetor a partir do ícone oficial (build/brand/icone-original.png).
// A geometria sai de build/scripts/generate-icons.mjs (fullMarkParts / smallMarkParts): se o desenho
// mudar lá, copie os caminhos para cá. Dois desenhos, escolhidos pelo tamanho:
//   • < 40 px: glifo (nuvem branca/verde + seta), legível a 16–32 px;
//   • ≥ 40 px: marca completa (nuvem + banco de dados + seta).
// O quadrado é sempre preto, então a marca funciona igual nos temas claro e escuro.

/* Glifo (viewBox 32 × 32) */
const S_CLOUD =
  'M9.07 22.52A5.34 5.34 0 1 1 9.4 11.92A5.54 5.54 0 0 1 14.91 6.97L17.37 6.97A4.77 4.77 0 0 1 22.14 12A6.34 6.34 0 0 1 25.35 23.94'
const S_SHAFT = 'M10.69 22.94A6.57 6.51 0 0 0 21.03 17.63L21.03 17.54'
const S_HEAD = 'M16.89 17.6L21.03 12.03L25.17 17.6Z'

/* Marca completa (viewBox 64 × 64) */
const F_CLOUD =
  'M46.34 22.16C47.53 22.41 48.7 22.53 49.86 22.95C53.08 24.13 55.6 26.74 57.02 29.81C60.4 37.23 56.7 47.55 47.8 48.26L44.5 48.53L45.73 45.76A9.72 9.72 0 0 0 49.61 44.1C50.14 43.77 50.65 43.31 51.08 42.86C52.89 40.95 53.86 38.45 53.76 35.81C53.62 31.77 50.81 28.07 46.94 26.91C45.69 26.53 43.14 26.67 42.36 26.25C41.27 25.66 41.38 24.55 41.27 23.48C41.16 22.43 40.88 21.35 40.39 20.42C38.62 17.11 35.58 16.92 32.22 16.92C31.02 16.93 29.79 16.85 28.6 17.03C25.88 17.42 23.57 19.36 22.4 21.8C21.85 22.96 21.86 24.63 20.83 25.49C19.86 26.3 18.51 26 17.34 26.11C15.86 26.25 14.45 26.82 13.25 27.7C9.09 30.77 9.08 37.45 13.41 40.37C14.44 41.06 15.61 41.45 16.84 41.59C17.45 41.66 18.2 41.68 18.85 41.74L18.85 46.15C18.04 46.28 15.91 46.2 15.13 46.05C10.24 45.19 6.74 41.03 5.89 36.26C4.91 30.82 7.88 25.02 12.91 22.7C14.86 21.8 15.82 21.99 17.77 21.66C18.23 20.92 18.43 19.95 18.84 19.16C19.94 17.09 21.59 15.29 23.63 14.11C26.43 12.47 29.01 12.45 32.16 12.45C34.15 12.45 36.19 12.31 38.13 12.78C42.91 13.93 45.48 17.52 46.34 22.16Z'
const F_ARROW =
  'M43.31 38.41L40.82 38.41Q39.9 38.41 40.44 37.71L44.98 31.81Q45.58 31 46.17 31.81L50.66 37.71Q51.21 38.41 50.29 38.41L47.93 38.41C47.91 39.01 47.9 39.62 47.87 40.2C47.81 41.08 47.68 41.96 47.48 42.83C46.63 46.4 44.05 49.39 40.66 50.78C37.78 51.96 34.3 51.55 31.91 49.51C31.39 49.07 29.99 47.81 30.14 47.12C30.52 46.78 31.11 47.12 31.56 47.21C32.72 47.46 33.88 47.66 35.08 47.59C39.84 47.33 43.83 43.35 43.31 38.41Z'
const F_DISC_3 = 'M20.31 40.3A10.12 3.14 0 0 0 40.55 40.3L40.55 46.36A10.12 3.14 0 0 1 20.31 46.36Z'
const F_DISC_2 = 'M20.31 34.03A10.12 3.14 0 0 0 40.55 34.03L40.55 39.11A10.12 3.14 0 0 1 20.31 39.11Z'
const F_DISC_1 = 'M20.31 28.89A10.12 3.14 0 0 0 40.55 28.89L40.55 32.95A10.12 3.14 0 0 1 20.31 32.95Z'

/** Contorno branco interno de 1 px de tela (lembra a borda branca do ícone oficial). */
function Ring({ box, rx, size }: { box: number; rx: number; size: number }) {
  const w = Math.max(box / size, box / 128)
  return (
    <rect
      x={w / 2}
      y={w / 2}
      width={box - w}
      height={box - w}
      rx={rx - w / 2}
      stroke="#fff"
      strokeOpacity=".16"
      strokeWidth={w}
    />
  )
}

function Glyph({ p, size }: { p: string; size: number }) {
  return (
    <>
      <defs>
        <linearGradient id={`${p}-bg`} x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B2119" />
          <stop offset=".55" stopColor="#030806" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <linearGradient id={`${p}-m`} x1="0" y1="5" x2="0" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14F6C8" />
          <stop offset="1" stopColor="#00A97A" />
        </linearGradient>
        <linearGradient id={`${p}-a`} x1="0" y1="11" x2="0" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3CF8D6" />
          <stop offset="1" stopColor="#00CF98" />
        </linearGradient>
        <clipPath id={`${p}-l`}>
          <rect width="15.46" height="32" />
        </clipPath>
        <clipPath id={`${p}-r`}>
          <rect x="15.46" width="16.54" height="32" />
        </clipPath>
        <mask id={`${p}-k`} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <rect width="32" height="32" fill="#fff" />
          <g stroke="#000" strokeLinejoin="round">
            <path d={S_SHAFT} strokeWidth="6.71" />
            <path d={S_HEAD} fill="#000" strokeWidth="3.54" />
          </g>
        </mask>
      </defs>
      <rect width="32" height="32" rx="6.5" fill={`url(#${p}-bg)`} />
      <Ring box={32} rx={6.5} size={size} />
      <g strokeWidth="3.43" strokeLinejoin="round" mask={`url(#${p}-k)`}>
        <path d={S_CLOUD} stroke="#fff" clipPath={`url(#${p}-l)`} />
        <path d={S_CLOUD} stroke={`url(#${p}-m)`} clipPath={`url(#${p}-r)`} />
      </g>
      <g stroke={`url(#${p}-a)`} strokeLinejoin="round">
        <path d={S_SHAFT} strokeWidth="3.57" />
        <path d={S_HEAD} fill={`url(#${p}-a)`} strokeWidth="0.4" />
      </g>
    </>
  )
}

function FullMark({ p, size }: { p: string; size: number }) {
  const span = { x1: '20.31', y1: '0', x2: '40.55', y2: '0', gradientUnits: 'userSpaceOnUse' } as const
  return (
    <>
      <defs>
        <linearGradient id={`${p}-bg`} x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B2119" />
          <stop offset=".5" stopColor="#020806" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <radialGradient id={`${p}-gl`} cx="32" cy="36" r="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00D9A0" stopOpacity=".16" />
          <stop offset="1" stopColor="#00D9A0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}-w`} x1="5.55" y1="0" x2="20.69" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E2E6E4" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <linearGradient
          id={`${p}-m`}
          x1="35.84"
          y1="12.5"
          x2="49.91"
          y2="48.74"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#14F6C8" />
          <stop offset=".42" stopColor="#00E4AC" />
          <stop offset=".72" stopColor="#00BF89" />
          <stop offset="1" stopColor="#007A4F" />
        </linearGradient>
        <radialGradient id={`${p}-a`} cx="39.09" cy="50.64" r="17.85" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00A271" />
          <stop offset=".42" stopColor="#00D49B" />
          <stop offset=".75" stopColor="#03F2C0" />
          <stop offset="1" stopColor="#3CF8D6" />
        </radialGradient>
        <linearGradient id={`${p}-t`} {...span}>
          <stop offset="0" stopColor="#fff" />
          <stop offset=".6" stopColor="#F1F4F3" />
          <stop offset="1" stopColor="#DDF6EC" />
        </linearGradient>
        <linearGradient id={`${p}-d1`} {...span}>
          <stop offset="0" stopColor="#22E0A8" />
          <stop offset=".2" stopColor="#05A26F" />
          <stop offset=".48" stopColor="#022E1D" />
          <stop offset=".78" stopColor="#03482A" />
          <stop offset="1" stopColor="#04C47C" />
        </linearGradient>
        <linearGradient id={`${p}-d2`} {...span}>
          <stop offset="0" stopColor="#fff" />
          <stop offset=".35" stopColor="#EEF2F0" />
          <stop offset=".6" stopColor="#A2CBBB" />
          <stop offset=".85" stopColor="#11B283" />
          <stop offset="1" stopColor="#05432A" />
        </linearGradient>
        <clipPath id={`${p}-l`}>
          <rect width="30.97" height="64" />
        </clipPath>
        <clipPath id={`${p}-r`}>
          <rect x="30.97" width="33.03" height="64" />
        </clipPath>
        <mask id={`${p}-k`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={F_ARROW} fill="#000" stroke="#000" strokeWidth="1.95" strokeLinejoin="round" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="13" fill={`url(#${p}-bg)`} />
      <rect width="64" height="64" rx="13" fill={`url(#${p}-gl)`} />
      <Ring box={64} rx={13} size={size} />
      <g mask={`url(#${p}-k)`}>
        <path d={F_CLOUD} fill={`url(#${p}-w)`} clipPath={`url(#${p}-l)`} />
        <path d={F_CLOUD} fill={`url(#${p}-m)`} clipPath={`url(#${p}-r)`} />
        <path d={F_DISC_3} fill={`url(#${p}-d2)`} />
        <path d={F_DISC_2} fill={`url(#${p}-d2)`} />
        <path d={F_DISC_1} fill={`url(#${p}-d1)`} />
        <ellipse cx="30.43" cy="28.89" rx="10.12" ry="3.14" fill={`url(#${p}-t)`} />
      </g>
      <path d={F_ARROW} fill={`url(#${p}-a)`} />
    </>
  )
}

/** Ícone da marca: quadrado preto com a nuvem branca/verde, o banco de dados e a seta. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  const p = `bc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const full = size >= 40
  const box = full ? 64 : 32
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      fill="none"
      aria-hidden
      className={cn('shrink-0', className)}
    >
      {full ? <FullMark p={p} size={size} /> : <Glyph p={p} size={size} />}
    </svg>
  )
}

/** Wordmark: ícone + "BC" 600 + "Backup" 400 (cores do tema: funciona no claro e no escuro). */
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
