// Gera todos os arquivos da marca BC Backup a partir do ícone oficial (build/brand/icone-original.png,
// 1254 × 1254, enviado pelo dono) e grava os arquivos versionados em build/ e resources/.
//
//   node build/scripts/generate-icons.mjs
//
// Rasteriza com o Chromium do Playwright. Se o Chromium padrão do Playwright não estiver instalado,
// defina CHROMIUM_PATH (ex.: CHROMIUM_PATH=/opt/pw-browsers/chromium).
//
// Três desenhos, escolhidos pelo tamanho final (como os "optical sizes" das fontes):
//   • arte oficial (PNG): ≥ 48 px. Recortada no contorno externo da borda branca (o PNG não tem
//     transparência: fora da borda é preto) e reduzida por média de área, com leve nitidez em 48/64 px.
//   • marca vetorial completa (nuvem + banco de dados + seta, sem o monograma): 40 px, Logo do app
//     (BrandMark ≥ 40 px), resources/logo.svg e wordmark. Traçada sobre a arte oficial (coordenadas
//     abaixo, no espaço de 1254 px do PNG).
//   • glifo pequeno (nuvem + seta, sem o banco de dados): ≤ 32 px no .ico, bandeja e BrandMark < 40 px.
// Os .ico são montados aqui mesmo: tamanhos < 256 px em BMP 32 bits (compatível com tudo, inclusive
// NSIS e a bandeja do Windows) e 256 px em PNG (formato Vista+), como fazem os ícones do próprio Windows.
// Exporta os desenhos (fullMarkSvg, smallMarkSvg…) para prévias; só gera arquivos quando executado.

/* global document -- usado só dentro de page.evaluate (roda no Chromium) */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BUILD = join(ROOT, 'build')
const RES = join(ROOT, 'resources')
const ORIGINAL = join(BUILD, 'brand/icone-original.png')

/* ------------------------------------------------------------------ */
/* Paleta da marca (amostrada do ícone oficial)                        */
/* ------------------------------------------------------------------ */

export const BRAND = {
  mintHighlight: '#3CF8D6', // brilho da ponta da seta
  mintLight: '#14F6C8', // topo da nuvem (metade verde)
  mint: '#00D9A0', // cor-chave da marca (acentos)
  mintMid: '#00B886',
  emerald: '#007A4F', // sombra da nuvem / base do banco de dados
  ink: '#000000', // fundo do quadrado
  inkGreen: '#0B2119', // topo do quadrado (brilho verde sutil)
  white: '#FFFFFF'
}

/** Badges de estado da bandeja (mesmos tons semânticos da interface). */
const BADGE = {
  running: '#2EE5B2', // acento (em execução)
  warning: '#F2B24C',
  error: '#E5484D'
}

/* ------------------------------------------------------------------ */
/* Geometria (espaço do PNG oficial: 1254 × 1254 px)                    */
/* ------------------------------------------------------------------ */

// Contorno da nuvem traçado sobre a arte oficial (curvas de Bézier com erro < 1,6 px). A ponta direita
// continua por baixo da seta: o recorte em volta da seta (máscara) faz o corte diagonal do original.
const CLOUD =
  'M894 378.6C916.1 383.2 937.7 385.4 959.2 393.3C1018.7 415 1065.3 463.2 1091.4 520.1C1154 657.1 1085.6 848 921 861L860 866L882.8 814.8A179.7 179.7 0 0 0 954.6 784.2C964.4 778 973.7 769.6 981.7 761.2C1015.1 725.9 1033 679.7 1031.3 631C1028.7 556.2 976.7 487.9 905.2 466.4C882 459.3 834.9 461.9 820.5 454.2C800.3 443.3 802.4 422.8 800.4 403C798.4 383.6 793.2 363.7 784 346.5C751.4 285.3 695.2 281.7 633 281.8C610.8 281.9 588.1 280.4 566.1 283.7C515.9 291 473.2 326.9 451.6 372C441.3 393.4 441.6 424.2 422.6 440.1C404.6 455.2 379.6 449.6 358 451.7C330.6 454.3 304.6 464.7 282.5 481C205.6 537.7 205.3 661.3 285.3 715.2C304.4 728 326 735.2 348.8 737.8C360 739 374 739.5 386 740.5L386 822C371 824.5 331.6 822.9 317.2 820.3C226.8 804.3 162 727.4 146.3 639.2C128.3 538.6 183.2 431.5 276.1 388.6C312.2 372 329.9 375.4 366 369.3C374.4 355.7 378.1 337.7 385.7 323.2C406.1 284.9 436.6 251.6 474.2 229.8C526 199.5 573.7 199.2 632 199.2C668.7 199.2 706.4 196.6 742.3 205.3C830.6 226.4 878.2 292.9 894 378.6Z'
/** A metade esquerda da nuvem é branca; a direita, verde (divisa vertical no topo). */
const SPLIT_X = 610
// Seta curva (traçada; ponta e cantos da cabeça arredondados).
const ARROW =
  'M838 679L792 679Q775 679 785 666L869 557Q880 542 891 557L974 666Q984 679 967 679L923.4 679C923 690 922.9 701.3 922.3 712C921.3 728.4 918.9 744.6 915.1 760.6C899.5 826.7 851.7 881.9 789.1 907.6C735.8 929.5 671.6 921.8 627.3 884.2C617.8 876.1 591.9 852.8 594.6 840C601.7 833.7 612.6 840 620.8 841.7C642.4 846.2 663.7 850 686 848.7C774 843.8 847.7 770.3 838 679Z'
/** Folga preta em volta da seta (cada lado). */
const ARROW_GAP = 18
// Banco de dados: três discos (elipses rx 187 × ry 58 centradas em x = 600).
const DB_X = 600
const DB_RX = 187
const DB_RY = 58
const DB_TOP_Y = 503
const DB_BANDS = [
  [503, 578],
  [598, 692],
  [714, 826]
]
/** Caixa do desenho sem o monograma: x 143…1115, y 199…922 → centro. */
const ART_CENTER = [629, 560.5]

// Glifo pequeno: linha de centro da nuvem como arcos de círculo (medidos na arte) + seta maior.
const CIRCLE_L = { cx: 370, cy: 598, r: 187 }
const CIRCLE_TL = { cx: 591, cy: 434, r: 194 }
const CIRCLE_TR = { cx: 677, cy: 407, r: 167 }
const CIRCLE_R = { cx: 852, cy: 638, r: 222 }
const SMALL = {
  cloudW: 120,
  arrowW: 125,
  gap: 55,
  headRound: 14,
  cloudEnd: 62, // ângulo (graus) em que a nuvem termina no círculo da direita
  // Seta maior que no original e afastada da nuvem: sem o banco de dados, ela ocupa o miolo e não se
  // funde com a bossa direita nos tamanhos pequenos.
  arrow: { cx: 575, cy: 612, rx: 230, ry: 228, t0: 125, headW: 290, headH: 195 },
  view: [69, -4, 1120] // recorte quadrado (x, y, lado) que vira o quadrado de 32 unidades
}

/* ------------------------------------------------------------------ */
/* Transformação de caminhos SVG (só comandos absolutos M L Q C A Z)   */
/* ------------------------------------------------------------------ */

const num = (v) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

/** Aplica x' = x·s + tx, y' = y·s + ty a um caminho. */
function xfPath(d, s, tx, ty) {
  const tokens = d.match(/[MLQCAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi)
  let out = ''
  let i = 0
  const n = () => Number(tokens[i++])
  const pt = () => `${num(n() * s + tx)} ${num(n() * s + ty)}`
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'Z') {
      out += 'Z'
      continue
    }
    const count = { M: 1, L: 1, Q: 2, C: 3 }[cmd]
    if (count) {
      out += cmd + Array.from({ length: count }, pt).join(' ')
    } else if (cmd === 'A') {
      const rx = n()
      const ry = n()
      const rot = n()
      const large = n()
      const sweep = n()
      out += `A${num(rx * s)} ${num(ry * s)} ${rot} ${large} ${sweep} ${pt()}`
    } else throw new Error(`comando de caminho não suportado: ${cmd}`)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Marca vetorial completa (viewBox 64 × 64)                           */
/* ------------------------------------------------------------------ */

const FULL_SCALE = 1.06 // o desenho ocupa ~82 % da largura do quadrado

/**
 * Quadrado preto com nuvem + banco de dados + seta. Coordenadas normalizadas para 64 unidades.
 * @param {object} o
 * @param {number} [o.px]    tamanho do <svg> em pixels
 * @param {string} [o.id]    prefixo dos ids (gradientes/máscaras)
 * @param {number} [o.ring]  opacidade do contorno branco interno (lembra a borda branca do original)
 */
export function fullMarkParts({ id = 'bcm', ring = 0.16, px = 64 } = {}) {
  const k = 64 / 1254
  const s = FULL_SCALE * k
  const tx = (627 - ART_CENTER[0] * FULL_SCALE) * k
  const ty = (627 - ART_CENTER[1] * FULL_SCALE) * k
  const X = (x) => num(x * s + tx)
  const Y = (y) => num(y * s + ty)
  const P = (d) => xfPath(d, s, tx, ty)
  const band = ([yt, yb]) =>
    `M${DB_X - DB_RX} ${yt}A${DB_RX} ${DB_RY} 0 0 0 ${DB_X + DB_RX} ${yt}L${DB_X + DB_RX} ${yb}A${DB_RX} ${DB_RY} 0 0 1 ${DB_X - DB_RX} ${yb}Z`
  const ringW = Math.max(64 / px, 0.5)
  const defs = [
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.inkGreen}"/><stop offset=".5" stop-color="#020806"/><stop offset="1" stop-color="#000"/></linearGradient>`,
    `<radialGradient id="${id}-gl" cx="32" cy="36" r="29" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.mint}" stop-opacity=".16"/><stop offset="1" stop-color="${BRAND.mint}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${id}-w" x1="${X(140)}" y1="0" x2="${X(420)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#E2E6E4"/><stop offset="1" stop-color="#fff"/></linearGradient>`,
    `<linearGradient id="${id}-m" x1="${X(700)}" y1="${Y(200)}" x2="${X(960)}" y2="${Y(870)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.mintLight}"/><stop offset=".42" stop-color="#00E4AC"/><stop offset=".72" stop-color="#00BF89"/><stop offset="1" stop-color="${BRAND.emerald}"/></linearGradient>`,
    `<radialGradient id="${id}-a" cx="${X(760)}" cy="${Y(905)}" r="${num(330 * s)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00A271"/><stop offset=".42" stop-color="#00D49B"/><stop offset=".75" stop-color="#03F2C0"/><stop offset="1" stop-color="${BRAND.mintHighlight}"/></radialGradient>`,
    `<linearGradient id="${id}-t" x1="${X(413)}" y1="0" x2="${X(787)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#F1F4F3"/><stop offset="1" stop-color="#DDF6EC"/></linearGradient>`,
    `<linearGradient id="${id}-d1" x1="${X(413)}" y1="0" x2="${X(787)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#22E0A8"/><stop offset=".2" stop-color="#05A26F"/><stop offset=".48" stop-color="#022E1D"/><stop offset=".78" stop-color="#03482A"/><stop offset="1" stop-color="#04C47C"/></linearGradient>`,
    `<linearGradient id="${id}-d2" x1="${X(413)}" y1="0" x2="${X(787)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#EEF2F0"/><stop offset=".6" stop-color="#A2CBBB"/><stop offset=".85" stop-color="#11B283"/><stop offset="1" stop-color="#05432A"/></linearGradient>`,
    `<clipPath id="${id}-l"><rect width="${X(SPLIT_X)}" height="64"/></clipPath>`,
    `<clipPath id="${id}-r"><rect x="${X(SPLIT_X)}" width="${num(64 - Number(X(SPLIT_X)))}" height="64"/></clipPath>`,
    `<mask id="${id}-k" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><path d="${P(ARROW)}" fill="#000" stroke="#000" stroke-width="${num(ARROW_GAP * 2 * s)}" stroke-linejoin="round"/></mask>`
  ]
  const tile = [
    `<rect width="64" height="64" rx="13" fill="url(#${id}-bg)"/>`,
    `<rect width="64" height="64" rx="13" fill="url(#${id}-gl)"/>`,
    ring
      ? `<rect x="${num(ringW / 2)}" y="${num(ringW / 2)}" width="${num(64 - ringW)}" height="${num(64 - ringW)}" rx="${num(13 - ringW / 2)}" fill="none" stroke="#fff" stroke-opacity="${ring}" stroke-width="${num(ringW)}"/>`
      : ''
  ].join('')
  const art = [
    `<g mask="url(#${id}-k)">`,
    `<path d="${P(CLOUD)}" fill="url(#${id}-w)" clip-path="url(#${id}-l)"/>`,
    `<path d="${P(CLOUD)}" fill="url(#${id}-m)" clip-path="url(#${id}-r)"/>`,
    `<path d="${P(band(DB_BANDS[2]))}" fill="url(#${id}-d2)"/>`,
    `<path d="${P(band(DB_BANDS[1]))}" fill="url(#${id}-d2)"/>`,
    `<path d="${P(band(DB_BANDS[0]))}" fill="url(#${id}-d1)"/>`,
    `<ellipse cx="${X(DB_X)}" cy="${Y(DB_TOP_Y)}" rx="${num(DB_RX * s)}" ry="${num(DB_RY * s)}" fill="url(#${id}-t)"/>`,
    `</g>`,
    `<path d="${P(ARROW)}" fill="url(#${id}-a)"/>`
  ].join('')
  return { defs: defs.join(''), body: tile + art }
}

export function fullMarkSvg({ px = 64, id = 'bcm', ring = 0.16, title = false } = {}) {
  const { defs, body } = fullMarkParts({ id, ring, px })
  const a11y = title ? ' role="img" aria-label="BC Backup"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${px}" height="${px}" fill="none"${a11y}><defs>${defs}</defs>${body}</svg>`
}

/* ------------------------------------------------------------------ */
/* Glifo pequeno (viewBox 32 × 32): nuvem + seta                       */
/* ------------------------------------------------------------------ */

const deg = (a) => (a * Math.PI) / 180
const onCircle = (c, a) => [c.cx + c.r * Math.cos(deg(a)), c.cy + c.r * Math.sin(deg(a))]

function intersectTop(p, q) {
  const dx = q.cx - p.cx
  const dy = q.cy - p.cy
  const d = Math.hypot(dx, dy)
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d)
  const h = Math.sqrt(p.r * p.r - a * a)
  const mx = p.cx + (a * dx) / d
  const my = p.cy + (a * dy) / d
  const s1 = [mx + (h * dy) / d, my - (h * dx) / d]
  const s2 = [mx - (h * dy) / d, my + (h * dx) / d]
  return s1[1] < s2[1] ? s1 : s2
}

/** Linha de centro da nuvem (espaço do PNG): ponta esquerda → bossa esquerda → topo → bossa direita. */
function cloudCenterline(endAngle) {
  const p = (q) => `${num(q[0])} ${num(q[1])}`
  const start = onCircle(CIRCLE_L, 85)
  const j1 = intersectTop(CIRCLE_L, CIRCLE_TL)
  const j2 = intersectTop(CIRCLE_TR, CIRCLE_R)
  const end = onCircle(CIRCLE_R, endAngle)
  const angle = (c, q) => Math.atan2(q[1] - c.cy, q[0] - c.cx)
  // Arco no sentido horário (sweep 1) de `from` até `q`; "large" quando passa de 180°.
  const arc = (c, from, q) => {
    const sweep = (((angle(c, q) - angle(c, from)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    return `A${c.r} ${c.r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(q)}`
  }
  const topL = [CIRCLE_TL.cx, CIRCLE_TL.cy - CIRCLE_TL.r]
  const topR = [CIRCLE_TR.cx, CIRCLE_TR.cy - CIRCLE_TR.r]
  return (
    `M${p(start)}${arc(CIRCLE_L, start, j1)}${arc(CIRCLE_TL, j1, topL)}` +
    `L${p(topR)}${arc(CIRCLE_TR, topR, j2)}${arc(CIRCLE_R, j2, end)}`
  )
}

function smallArrow(arrow) {
  const { cx, cy, rx, ry, t0, headW, headH } = arrow
  const p = (x, y) => `${num(x)} ${num(y)}`
  const tail = [cx + rx * Math.cos(deg(t0)), cy + ry * Math.sin(deg(t0))]
  const hx = cx + rx
  return {
    shaft: `M${p(...tail)}A${rx} ${ry} 0 0 0 ${p(hx, cy + 1)}L${p(hx, cy - 2)}`,
    head: `M${p(hx - headW / 2, cy)}L${p(hx, cy - headH)}L${p(hx + headW / 2, cy)}Z`
  }
}

/** Partes do glifo pequeno normalizadas para 32 unidades. */
function smallGeometry() {
  const [vx, vy, vs] = SMALL.view
  const s = 32 / vs
  const tx = -vx * s
  const ty = -vy * s
  const a = smallArrow(SMALL.arrow)
  return {
    s,
    X: (x) => num(x * s + tx),
    Y: (y) => num(y * s + ty),
    cloud: xfPath(cloudCenterline(SMALL.cloudEnd), s, tx, ty),
    shaft: xfPath(a.shaft, s, tx, ty),
    head: xfPath(a.head, s, tx, ty),
    cloudW: num(SMALL.cloudW * s),
    arrowW: num(SMALL.arrowW * s),
    gapShaft: num((SMALL.arrowW + SMALL.gap * 2) * s),
    gapHead: num((SMALL.gap * 2 + SMALL.headRound) * s),
    headRound: num(SMALL.headRound * s)
  }
}

/** Badge de estado (canto inferior direito) com anel transparente em volta. */
const BADGE_AT = { cx: 26, cy: 26, r: 5.5, cut: 7.5 }

/**
 * Glifo pequeno sobre o quadrado preto (ícone ≤ 32 px, bandeja, BrandMark < 40 px).
 * @param {object} o
 * @param {number} [o.px]
 * @param {string} [o.id]
 * @param {number} [o.ring]          opacidade do contorno branco interno
 * @param {string|null} [o.badge]    cor do badge de estado
 */
export function smallMarkParts({ id = 'bcs', ring = 0.16, px = 32, badge = null } = {}) {
  const g = smallGeometry()
  const ringW = Math.max(32 / px, 0.5)
  const r = 6.5
  const defs = [
    `<linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.inkGreen}"/><stop offset=".55" stop-color="#030806"/><stop offset="1" stop-color="#000"/></linearGradient>`,
    `<linearGradient id="${id}-m" x1="0" y1="5" x2="0" y2="25" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.mintLight}"/><stop offset="1" stop-color="#00A97A"/></linearGradient>`,
    `<linearGradient id="${id}-a" x1="0" y1="11" x2="0" y2="26" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${BRAND.mintHighlight}"/><stop offset="1" stop-color="#00CF98"/></linearGradient>`,
    `<clipPath id="${id}-l"><rect width="${g.X(SPLIT_X)}" height="32"/></clipPath>`,
    `<clipPath id="${id}-r"><rect x="${g.X(SPLIT_X)}" width="${num(32 - Number(g.X(SPLIT_X)))}" height="32"/></clipPath>`,
    `<mask id="${id}-k" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><g stroke="#000" stroke-linejoin="round"><path d="${g.shaft}" fill="none" stroke-width="${g.gapShaft}"/><path d="${g.head}" fill="#000" stroke-width="${g.gapHead}"/></g></mask>`
  ]
  if (badge) {
    defs.push(
      `<mask id="${id}-b" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><circle cx="${BADGE_AT.cx}" cy="${BADGE_AT.cy}" r="${BADGE_AT.cut}"/></mask>`
    )
  }
  const tile = [
    `<rect width="32" height="32" rx="${r}" fill="url(#${id}-bg)"/>`,
    ring
      ? `<rect x="${num(ringW / 2)}" y="${num(ringW / 2)}" width="${num(32 - ringW)}" height="${num(32 - ringW)}" rx="${num(r - ringW / 2)}" fill="none" stroke="#fff" stroke-opacity="${ring}" stroke-width="${num(ringW)}"/>`
      : ''
  ].join('')
  const cloud = [
    `<g fill="none" stroke-width="${g.cloudW}" stroke-linejoin="round" mask="url(#${id}-k)">`,
    `<path d="${g.cloud}" stroke="#fff" clip-path="url(#${id}-l)"/>`,
    `<path d="${g.cloud}" stroke="url(#${id}-m)" clip-path="url(#${id}-r)"/>`,
    `</g>`
  ].join('')
  const arrow = `<g stroke="url(#${id}-a)" stroke-linejoin="round"><path d="${g.shaft}" fill="none" stroke-width="${g.arrowW}"/><path d="${g.head}" fill="url(#${id}-a)" stroke-width="${g.headRound}"/></g>`
  const body = tile + cloud + arrow
  return {
    defs: defs.join(''),
    body: badge
      ? `<g mask="url(#${id}-b)">${body}</g><circle cx="${BADGE_AT.cx}" cy="${BADGE_AT.cy}" r="${BADGE_AT.r}" fill="${badge}"/>`
      : body
  }
}

export function smallMarkSvg({ px = 32, id = 'bcs', ring = 0.16, badge = null } = {}) {
  const { defs, body } = smallMarkParts({ id, ring, px, badge })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${px}" height="${px}" fill="none"><defs>${defs}</defs>${body}</svg>`
}

/**
 * Imagem "template" do macOS: só preto + alfa (o sistema pinta conforme a barra de menus).
 * idle = nuvem + seta · running = nuvem apagada (40 %) e seta cheia · warning = anel · error = ponto.
 */
export function templateSvg({ px = 16, state = 'idle' }) {
  const g = smallGeometry()
  const badge = state === 'warning' || state === 'error'
  // Recorte só do glifo (sem o quadrado), centrado: o glifo ocupa x 1.5…30.4, y 5.3…25.9.
  const view = '0.78 0.38 30.4 30.4'
  const defs = [
    `<mask id="k" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><g stroke="#000" stroke-linejoin="round"><path d="${g.shaft}" fill="none" stroke-width="${g.gapShaft}"/><path d="${g.head}" stroke-width="${g.gapHead}"/></g>${badge ? `<circle cx="26.5" cy="25.5" r="7.2"/>` : ''}</mask>`,
    badge
      ? `<mask id="b" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><circle cx="26.5" cy="25.5" r="7.2"/></mask>`
      : ''
  ].join('')
  const cloudW = num(Number(g.cloudW) * 1.08)
  const cloud = `<path d="${g.cloud}" fill="none" stroke="#000" stroke-width="${cloudW}" stroke-linejoin="round" mask="url(#k)"${state === 'running' ? ' stroke-opacity=".4"' : ''}/>`
  const arrow = `<g stroke="#000" stroke-linejoin="round"${badge ? ' mask="url(#b)"' : ''}><path d="${g.shaft}" fill="none" stroke-width="${g.arrowW}"/><path d="${g.head}" fill="#000" stroke-width="${g.headRound}"/></g>`
  const mark =
    state === 'error'
      ? `<circle cx="26.5" cy="25.5" r="4.8" fill="#000"/>`
      : state === 'warning'
        ? `<circle cx="26.5" cy="25.5" r="3.9" fill="none" stroke="#000" stroke-width="1.9"/>`
        : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${px}" height="${px}"><defs>${defs}</defs>${cloud}${arrow}${mark}</svg>`
}

/* ------------------------------------------------------------------ */
/* PNG: decodificador, codificador, máscara e redução                  */
/* ------------------------------------------------------------------ */

function decodePng(buf) {
  let off = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      colorType = data[9]
      if (depth !== 8 || (colorType !== 6 && colorType !== 2) || data[12] !== 0) {
        throw new Error(`PNG não suportado (profundidade ${depth}, tipo ${colorType})`)
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const row = px.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = src[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      row[x] = v & 0xff
    }
  }
  if (bpp === 4) return { width, height, rgba: px }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = px[i * 3]
    rgba[i * 4 + 1] = px[i * 3 + 1]
    rgba[i * 4 + 2] = px[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return { width, height, rgba }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const v of buf) c = CRC_TABLE[(c ^ v) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** PNG RGBA 8 bits (filtro escolhido por linha, como os otimizadores). */
function encodePng({ width: w, height: h, rgba }) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  const cand = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride)
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : null
    let bestSum = Infinity
    for (let f = 0; f < 5; f++) {
      let sum = 0
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4] : 0
        const b = prev ? prev[x] : 0
        const c = prev && x >= 4 ? prev[x - 4] : 0
        let p = 0
        if (f === 1) p = a
        else if (f === 2) p = b
        else if (f === 3) p = (a + b) >> 1
        else if (f === 4) {
          const q = a + b - c
          const pa = Math.abs(q - a)
          const pb = Math.abs(q - b)
          const pc = Math.abs(q - c)
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        const v = (row[x] - p) & 0xff
        cand[x] = v
        sum += v < 128 ? v : 256 - v
      }
      if (sum < bestSum) {
        bestSum = sum
        raw[y * (stride + 1)] = f
        cand.copy(raw, y * (stride + 1) + 1)
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Recorta a imagem num retângulo arredondado (alfa com supersampling 4 × 4 na borda). */
function maskRoundRect(img, { x0, y0, x1, y1, r }) {
  const { width: w, height: h, rgba } = img
  const out = Buffer.from(rgba)
  const inside = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
    const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x < x0 + r + 2 || x > x1 - r - 2 || y < y0 + r + 2 || y > y1 - r - 2
      if (!edge) continue
      let n = 0
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++
      const k = (y * w + x) * 4 + 3
      out[k] = Math.round((rgba[k] * n) / 16)
    }
  }
  return { width: w, height: h, rgba: out }
}

/**
 * Reduz por média de área (alfa pré-multiplicado) para dw × dh e cola em (ox, oy) de uma tela cw × ch.
 * `sharpen` aplica uma máscara de nitidez leve (3 × 3) — ajuda a arte a 48/64 px.
 */
function downscale(img, dw, dh, { cw = dw, ch = dh, ox = 0, oy = 0, sharpen = 0 } = {}) {
  const { width: sw, height: sh, rgba } = img
  const spans = (n, step, max) =>
    Array.from({ length: n }, (_, d) => {
      const a = d * step
      const b = (d + 1) * step
      const list = []
      for (let i = Math.floor(a); i < Math.min(max, Math.ceil(b)); i++) {
        const wgt = Math.min(b, i + 1) - Math.max(a, i)
        if (wgt > 0) list.push([i, wgt])
      }
      return list
    })
  const xs = spans(dw, sw / dw, sw)
  const ys = spans(dh, sh / dh, sh)
  let acc = new Float64Array(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (const [yy, wy] of ys[dy]) {
        for (const [xx, wx] of xs[dx]) {
          const k = (yy * sw + xx) * 4
          const wgt = wx * wy
          const al = (rgba[k + 3] / 255) * wgt
          r += rgba[k] * al
          g += rgba[k + 1] * al
          b += rgba[k + 2] * al
          a += al
          wsum += wgt
        }
      }
      const o = (dy * dw + dx) * 4
      acc[o] = r / wsum
      acc[o + 1] = g / wsum
      acc[o + 2] = b / wsum
      acc[o + 3] = a / wsum
    }
  }
  if (sharpen) {
    const sharp = new Float64Array(acc.length)
    const K = [1, 2, 1]
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        for (let c = 0; c < 4; c++) {
          let s = 0
          let ws = 0
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const xx = x + i
              const yy = y + j
              if (xx < 0 || yy < 0 || xx >= dw || yy >= dh) continue
              const wt = K[i + 1] * K[j + 1]
              s += acc[(yy * dw + xx) * 4 + c] * wt
              ws += wt
            }
          }
          const i0 = (y * dw + x) * 4 + c
          sharp[i0] = acc[i0] + sharpen * (acc[i0] - s / ws)
        }
      }
    }
    acc = sharp
  }
  const out = Buffer.alloc(cw * ch * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = (y * dw + x) * 4
      const a = Math.min(1, Math.max(0, acc[i + 3]))
      if (a <= 0.002) continue
      const o = ((y + oy) * cw + (x + ox)) * 4
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(255, Math.max(0, acc[i + c] / a)))
      out[o + 3] = Math.round(a * 255)
    }
  }
  return encodePng({ width: cw, height: ch, rgba: out })
}

/**
 * Arte oficial sem os cantos pretos. A borda branca encosta nas laterais do PNG e os cantos são arcos
 * de raio 254 px (medido: erro RMS 1,1 px); o recorte entra 1,25 px para não sobrar franja escura.
 */
function officialArt() {
  const src = decodePng(readFileSync(ORIGINAL))
  if (src.width !== src.height) throw new Error('o ícone oficial precisa ser quadrado')
  const k = src.width / 1254
  const inset = 1.25 * k
  return maskRoundRect(src, {
    x0: inset,
    y0: inset,
    x1: src.width - inset,
    y1: src.height - inset,
    r: 254 * k - inset
  })
}

/* ------------------------------------------------------------------ */
/* ICO e BMP                                                           */
/* ------------------------------------------------------------------ */

/** Entrada BMP 32 bits (BGRA de baixo para cima + máscara AND de 1 bit). */
function bmpEntry(png) {
  const { width: w, height: h, rgba } = decodePng(png)
  const maskStride = Math.ceil(w / 32) * 4
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(w, 4)
  header.writeInt32LE(h * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(w * h * 4 + maskStride * h, 20)
  const xor = Buffer.alloc(w * h * 4)
  const and = Buffer.alloc(maskStride * h)
  for (let y = 0; y < h; y++) {
    const dy = h - 1 - y
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = (dy * w + x) * 4
      xor[d] = rgba[s + 2]
      xor[d + 1] = rgba[s + 1]
      xor[d + 2] = rgba[s]
      xor[d + 3] = rgba[s + 3]
      if (rgba[s + 3] === 0) and[dy * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return Buffer.concat([header, xor, and])
}

function encodeIco(images) {
  const sorted = [...images].sort((a, b) => a.size - b.size)
  const payloads = sorted.map((img) => (img.size >= 256 ? img.png : bmpEntry(img.png)))
  const dir = Buffer.alloc(6 + 16 * sorted.length)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(sorted.length, 4)
  let offset = dir.length
  sorted.forEach((img, i) => {
    const e = 6 + i * 16
    dir[e] = img.size >= 256 ? 0 : img.size
    dir[e + 1] = img.size >= 256 ? 0 : img.size
    dir[e + 2] = 0
    dir[e + 3] = 0
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(payloads[i].length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += payloads[i].length
  })
  return Buffer.concat([dir, ...payloads])
}

/** BMP 24 bits (formato exigido pelas imagens do instalador NSIS). */
function encodeBmp24(png) {
  const { width: w, height: h, rgba } = decodePng(png)
  const stride = Math.ceil((w * 3) / 4) * 4
  const header = Buffer.alloc(54)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(54 + stride * h, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(w, 18)
  header.writeInt32LE(h, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(stride * h, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  const data = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * stride
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      data[row + x * 3] = rgba[s + 2]
      data[row + x * 3 + 1] = rgba[s + 1]
      data[row + x * 3 + 2] = rgba[s]
    }
  }
  return Buffer.concat([header, data])
}

/* ------------------------------------------------------------------ */
/* Rasterização                                                        */
/* ------------------------------------------------------------------ */

export async function launch() {
  const candidates = [process.env.CHROMIUM_PATH, undefined, '/opt/pw-browsers/chromium']
  let lastError
  for (const executablePath of candidates) {
    if (executablePath && !existsSync(executablePath)) continue
    try {
      return await chromium.launch(executablePath ? { executablePath } : {})
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

export async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`
  )
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

async function renderOpaque(page, html, width, height) {
  await page.setViewportSize({ width, height })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({ clip: { x: 0, y: 0, width, height } })
}

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  process.stdout.write(`  ${file.replace(ROOT + '/', '')} (${data.length} bytes)\n`)
}

/* ------------------------------------------------------------------ */
/* Wordmark (README e documentos)                                       */
/* ------------------------------------------------------------------ */

const fontBase64 = () =>
  readFileSync(
    join(ROOT, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
  ).toString('base64')

async function wordmarkSvg(page) {
  const font = fontBase64()
  const fontSize = 21
  const family = `'Geist', 'Geist Variable', 'Segoe UI Variable Display', 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`
  await page.setContent(
    `<!doctype html><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}</style><body>`
  )
  const width = await page.evaluate(
    async ({ fontSize }) => {
      await document.fonts.load(`600 ${fontSize}px Geist`)
      await document.fonts.load(`400 ${fontSize}px Geist`)
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.letterSpacing = `${-0.02 * fontSize}px`
      ctx.font = `600 ${fontSize}px Geist`
      const bc = ctx.measureText('BC').width
      ctx.letterSpacing = `${-0.01 * fontSize}px`
      ctx.font = `400 ${fontSize}px Geist`
      const rest = ctx.measureText(' Backup').width
      return bc + rest
    },
    { fontSize }
  )
  const textX = 42
  const w = Math.ceil(textX + width + 2)
  const { defs, body } = fullMarkParts({ id: 'bcw', px: 64 })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 32" width="${w * 2}" height="64" fill="none" role="img" aria-label="BC Backup">
  <style>
    @font-face { font-family: 'Geist'; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    .t { font-family: ${family}; font-size: ${fontSize}px; }
    .a { fill: #0B0F0D; font-weight: 600; letter-spacing: -0.02em; }
    .b { fill: #4F5059; font-weight: 400; letter-spacing: -0.01em; }
    @media (prefers-color-scheme: dark) { .a { fill: #EDEDF0; } .b { fill: #A6A7B0; } }
  </style>
  <defs>${defs}</defs>
  <g transform="scale(.5)">${body}</g>
  <text class="t" x="${textX}" y="23.4" xml:space="preserve"><tspan class="a">BC</tspan><tspan class="b"> Backup</tspan></text>
</svg>
`
}

/* ------------------------------------------------------------------ */
/* Imagens do instalador (NSIS assistido)                              */
/* ------------------------------------------------------------------ */

const geistFace = () =>
  `@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${fontBase64()}) format('woff2')}`

const INSTALLER_BG = `background:#030806;background-image:radial-gradient(120% 70% at 50% 34%,rgba(0,217,160,.20) 0%,rgba(0,217,160,.06) 45%,rgba(0,217,160,0) 72%),linear-gradient(180deg,#07130F 0%,#020504 100%)`

/** Barra lateral das telas de boas-vindas/conclusão: 164 × 314, tudo centrado na coluna. */
function sidebarHtml(iconDataUri) {
  return `<!doctype html><style>${geistFace()}
  html,body{margin:0}
  .s{width:164px;height:314px;box-sizing:border-box;position:relative;overflow:hidden;
     display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
     ${INSTALLER_BG};font-family:Geist,sans-serif;color:#fff;padding:0 12px 18px}
  .line{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,rgba(0,217,160,0),#00D9A0 50%,rgba(0,217,160,0))}
  img{display:block;width:88px;height:88px;filter:drop-shadow(0 6px 14px rgba(0,217,160,.22))}
  .w{margin-top:18px;font-size:21px;letter-spacing:-.02em;line-height:1}
  .w b{font-weight:600}.w span{font-weight:400;color:#C9D3CF}
  .t{margin-top:12px;font-size:11.5px;line-height:1.5;color:#9FB1AA;max-width:136px}
  </style><div class="s"><img src="${iconDataUri}" alt=""><div class="w"><b>BC</b> <span>Backup</span></div><div class="t">Cópias automáticas dos seus arquivos, com aviso por e-mail.</div><div class="line"></div></div>`
}

/** Cabeçalho das páginas internas (canto direito da faixa do topo): 150 × 57. */
function headerHtml(iconDataUri) {
  return `<!doctype html><style>${geistFace()}
  html,body{margin:0}
  .h{width:150px;height:57px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;
     ${INSTALLER_BG};font-family:Geist,sans-serif;color:#fff}
  img{display:block;width:32px;height:32px}
  .w{font-size:16px;letter-spacing:-.02em;line-height:1;white-space:nowrap}
  .w b{font-weight:600}.w span{font-weight:400;color:#C9D3CF}
  </style><div class="h"><img src="${iconDataUri}" alt=""><div class="w"><b>BC</b> <span>Backup</span></div></div>`
}

/* ------------------------------------------------------------------ */
/* Saídas                                                              */
/* ------------------------------------------------------------------ */

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** Ícone do Windows por tamanho: glifo ≤ 32, marca vetorial em 40, arte oficial ≥ 48. */
async function windowsIcon(page, art, size) {
  // Contorno branco a 50 %: imita a borda branca da arte oficial (que, reduzida, vira ~0,7 px).
  if (size <= 32) return render(page, smallMarkSvg({ px: size, ring: 0.5 }), size)
  if (size < 48) return render(page, fullMarkSvg({ px: size, ring: 0.5 }), size)
  const pad = Math.round(size * 0.02)
  return downscale(art, size - pad * 2, size - pad * 2, {
    cw: size,
    ch: size,
    ox: pad,
    oy: pad,
    sharpen: size <= 64 ? 0.35 : 0
  })
}

/** Ícone no estilo macOS (grade de 1024 com corpo de 824 px e sombra), também usado no Linux. */
function macIconSvg(artDataUri, size) {
  const body = (824 / 1024) * size
  const off = (size - body) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><filter id="f" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="${size * 0.01}" stdDeviation="${size * 0.012}" flood-color="#000" flood-opacity=".32"/></filter></defs><image href="${artDataUri}" x="${off}" y="${off}" width="${body}" height="${body}" filter="url(#f)"/></svg>`
}

async function main() {
  const browser = await launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  process.stdout.write('BC Backup — gerando ícones a partir de build/brand/icone-original.png\n')

  const art = officialArt()
  const artPng = encodePng(art)
  const artUri = `data:image/png;base64,${artPng.toString('base64')}`

  // build/: ícone do app (electron-builder usa icon.ico no Windows e icon.png no macOS/Linux)
  write(join(BUILD, 'icon.svg'), fullMarkSvg({ px: 1024, title: true }) + '\n')
  write(join(BUILD, 'icon.png'), await render(page, macIconSvg(artUri, 1024), 1024))
  const icoImages = []
  for (const size of ICO_SIZES) icoImages.push({ size, png: await windowsIcon(page, art, size) })
  const ico = encodeIco(icoImages)
  write(join(BUILD, 'icon.ico'), ico)
  write(join(RES, 'icon.ico'), ico) // ícone da janela no Windows (src/main/window.ts)

  // Instalador assistido (electron-builder procura estes nomes em build/ automaticamente).
  const sidebarIcon = `data:image/png;base64,${downscale(art, 176, 176).toString('base64')}`
  const headerIcon = `data:image/png;base64,${downscale(art, 64, 64).toString('base64')}`
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sidePage = await browser.newPage({ deviceScaleFactor: 1 })
  write(
    join(BUILD, 'installerSidebar.bmp'),
    encodeBmp24(await renderOpaque(sidePage, sidebarHtml(sidebarIcon), 164, 314))
  )
  write(
    join(BUILD, 'installerHeader.bmp'),
    encodeBmp24(await renderOpaque(sidePage, headerHtml(headerIcon), 150, 57))
  )
  await sidePage.close()

  // resources/: arquivos lidos em tempo de execução pelo processo principal
  write(join(RES, 'logo.svg'), fullMarkSvg({ px: 64, title: true }) + '\n')
  write(join(RES, 'wordmark.svg'), await wordmarkSvg(page))
  write(join(RES, 'icon.png'), await render(page, macIconSvg(artUri, 512), 512))

  // Bandeja (Windows/Linux): o quadrado preto garante leitura em barras claras e escuras.
  for (const state of [null, 'running', 'warning', 'error']) {
    const name = state ? `tray-${state}` : 'tray'
    const images = []
    for (const size of [16, 20, 24, 32]) {
      const svg = smallMarkSvg({ px: size, ring: 0.5, badge: state ? BADGE[state] : null })
      images.push({ size, png: await render(page, svg, size) })
    }
    write(join(RES, `${name}.png`), images.find((i) => i.size === 16).png)
    write(join(RES, `${name}@2x.png`), images.find((i) => i.size === 32).png)
    write(join(RES, `${name}.ico`), encodeIco(images))
  }

  // macOS: imagens template (preto + alfa) — o nome precisa terminar em "Template".
  for (const [name, state] of [
    ['trayTemplate', 'idle'],
    ['tray-runningTemplate', 'running'],
    ['tray-warningTemplate', 'warning'],
    ['tray-errorTemplate', 'error']
  ]) {
    write(join(RES, `${name}.png`), await render(page, templateSvg({ px: 16, state }), 16))
    write(join(RES, `${name}@2x.png`), await render(page, templateSvg({ px: 32, state }), 32))
  }

  await browser.close()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack ?? e}\n`)
    process.exit(1)
  })
}
