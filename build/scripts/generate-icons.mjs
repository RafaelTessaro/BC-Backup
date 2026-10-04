// Gera todos os ícones da marca BC Backup a partir do desenho vetorial
// (docs/research/02-design-system.md §2) e grava os arquivos versionados em build/ e resources/.
//
//   node build/scripts/generate-icons.mjs
//
// Rasteriza com o Chromium do Playwright (fundo transparente). Se o Chromium padrão do Playwright não
// estiver instalado, defina CHROMIUM_PATH (ex.: /opt/pw-browsers/chromium).
// Os .ico são montados aqui mesmo: tamanhos < 256 px em BMP 32 bits (compatível com tudo, inclusive
// NSIS e a bandeja do Windows) e 256 px em PNG (formato Vista+), como fazem os ícones do próprio Windows.

/* global document -- usado só dentro de page.evaluate (roda no Chromium) */
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BUILD = join(ROOT, 'build')
const RES = join(ROOT, 'resources')

/* ------------------------------------------------------------------ */
/* Desenho (unidades de 32 × 32, idênticas ao SVG do design system)     */
/* ------------------------------------------------------------------ */

const ARC = 'M8 16a8 8 0 1 0 8-8 8.67 8.67 0 0 0-5.99 2.44L8 12.44'
const HEAD = 'M8 8v4.44h4.44'
const CHECK = 'M12.75 16.25l2.25 2.25 4.25-4.5'

const BADGE = {
  running: '#4566FA',
  warning: '#F2B24C',
  error: '#E5484D'
}

/**
 * Marca (squircle + seta circular + check).
 * @param {object} o
 * @param {number} o.px        tamanho final em pixels (para calibrar a borda interna)
 * @param {boolean} [o.check]  desenhar o check (some na bandeja de 16 px)
 * @param {number} [o.stroke]  espessura do traço em unidades de 32
 * @param {number} [o.pad]     margem transparente em unidades de 32 (cada lado)
 * @param {boolean} [o.shadow] sombra suave (ícone grande no estilo macOS)
 * @param {string|null} [o.badge] cor do badge de status (canto inferior direito, com recorte)
 */
function markSvg({ px, check = true, stroke = 2.25, pad = 0, shadow = false, badge = null }) {
  const view = 32 + pad * 2
  const bodyPx = (px * 32) / view
  // Contorno interno branco 14 %: 1 unidade em tamanhos pequenos, ~4 px nos grandes.
  const bw = bodyPx <= 64 ? 1 : Math.max(0.12, (4 * 32) / bodyPx)
  const sheen = bodyPx >= 128
  const defs = [
    `<linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5674FF"/><stop offset="1" stop-color="#2843D6"/></linearGradient>`
  ]
  if (sheen) {
    defs.push(
      `<linearGradient id="s" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>`
    )
  }
  if (shadow) {
    defs.push(
      `<filter id="f" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy=".45" stdDeviation=".55" flood-color="#0B1A66" flood-opacity=".30"/></filter>`
    )
  }
  const bx = 26
  const by = 26
  if (badge) {
    defs.push(
      `<mask id="m" maskUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${view}" height="${view}"><rect x="${-pad}" y="${-pad}" width="${view}" height="${view}" fill="#fff"/><circle cx="${bx}" cy="${by}" r="8.5" fill="#000"/></mask>`
    )
  }
  const glyph = [
    `<g stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    `<path d="${ARC}"/>`,
    `<path d="${HEAD}"/>`,
    check ? `<path d="${CHECK}"/>` : '',
    `</g>`
  ].join('')
  const tile = [
    `<rect width="32" height="32" rx="8" fill="url(#g)"/>`,
    sheen ? `<rect width="32" height="32" rx="8" fill="url(#s)"/>` : '',
    `<rect x="${bw / 2}" y="${bw / 2}" width="${32 - bw}" height="${32 - bw}" rx="${8 - bw / 2}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="${bw}"/>`,
    glyph
  ].join('')
  const body = shadow ? `<g filter="url(#f)">${tile}</g>` : tile
  const masked = badge
    ? `<g mask="url(#m)">${body}</g><circle cx="${bx}" cy="${by}" r="6" fill="${badge}"/>`
    : body
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${view} ${view}" width="${px}" height="${px}" fill="none"><defs>${defs.join('')}</defs>${masked}</svg>`
}

/** Imagem "template" do macOS: só preto + alfa (o sistema pinta conforme o tema da barra de menus). */
function templateSvg({ px, check = true, badge = false }) {
  const stroke = 2.4
  const mask = badge
    ? `<defs><mask id="m" maskUnits="userSpaceOnUse" x="5" y="5" width="22" height="22"><rect x="5" y="5" width="22" height="22" fill="#fff"/><circle cx="23" cy="23" r="5.4" fill="#000"/></mask></defs>`
    : ''
  const glyph = `<g stroke="#000" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"${badge ? ' mask="url(#m)"' : ''}><path d="${ARC}"/><path d="${HEAD}"/>${check ? `<path d="${CHECK}"/>` : ''}</g>`
  const dot = badge ? `<circle cx="23" cy="23" r="3.6" fill="#000"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 6 20 20" width="${px}" height="${px}">${mask}${glyph}${dot}</svg>`
}

/** Marca para documentos (exatamente o SVG do design system, 32 × 32). */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" role="img" aria-label="BC Backup">
  <defs>
    <linearGradient id="bc-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5674FF"/>
      <stop offset="1" stop-color="#2843D6"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#bc-g)"/>
  <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="#fff" stroke-opacity=".14"/>
  <g stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="${ARC}"/>
    <path d="${HEAD}"/>
    <path d="${CHECK}"/>
  </g>
</svg>
`

/* ------------------------------------------------------------------ */
/* PNG → RGBA e codificador ICO                                        */
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

async function launch() {
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

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`
  )
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
}

function write(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  process.stdout.write(`  ${file.replace(ROOT + '/', '')} (${data.length} bytes)\n`)
}

/* ------------------------------------------------------------------ */
/* Wordmark                                                            */
/* ------------------------------------------------------------------ */

async function wordmarkSvg(page) {
  const fontFile = join(ROOT, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
  const font = readFileSync(fontFile).toString('base64')
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 32" width="${w * 2}" height="64" fill="none" role="img" aria-label="BC Backup">
  <style>
    @font-face { font-family: 'Geist'; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    .t { font-family: ${family}; font-size: ${fontSize}px; }
    .a { fill: #16171B; font-weight: 600; letter-spacing: -0.02em; }
    .b { fill: #4F5059; font-weight: 400; letter-spacing: -0.01em; }
    @media (prefers-color-scheme: dark) { .a { fill: #EDEDF0; } .b { fill: #A6A7B0; } }
  </style>
  <defs>
    <linearGradient id="bc-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5674FF"/>
      <stop offset="1" stop-color="#2843D6"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="url(#bc-g)"/>
  <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="#fff" stroke-opacity=".14"/>
  <g stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="${ARC}"/>
    <path d="${HEAD}"/>
    <path d="${CHECK}"/>
  </g>
  <text class="t" x="${textX}" y="23.4" xml:space="preserve"><tspan class="a">BC</tspan><tspan class="b"> Backup</tspan></text>
</svg>
`
}

/* ------------------------------------------------------------------ */
/* Imagens do instalador (NSIS assistido)                              */
/* ------------------------------------------------------------------ */

const geistFace = () => {
  const font = readFileSync(
    join(ROOT, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')
  ).toString('base64')
  return `@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')}`
}

/** Barra lateral das telas de boas-vindas/conclusão: 164 × 314. */
function sidebarHtml() {
  // Tudo centralizado na coluna de 164 px. O enquadramento do ícone é calculado no próprio navegador
  // (getBBox) para que a seta + o check fiquem visualmente no centro, e não só o quadro do SVG.
  const glyph = `<svg id="g" xmlns="http://www.w3.org/2000/svg" viewBox="6 6 20 20" width="84" height="84" fill="none"><g stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${ARC}"/><path d="${HEAD}"/><path d="${CHECK}"/></g></svg>`
  return `<!doctype html><style>${geistFace()}
  html,body{margin:0}
  .s{width:164px;height:314px;box-sizing:border-box;padding:56px 14px 0;position:relative;overflow:hidden;
     display:flex;flex-direction:column;align-items:center;text-align:center;
     background:linear-gradient(160deg,#5674FF 0%,#3254F0 45%,#2843D6 100%);font-family:Geist,sans-serif;color:#fff}
  .ring{position:absolute;left:50%;bottom:-120px;width:240px;height:240px;margin-left:-120px;border-radius:50%;border:28px solid rgba(255,255,255,.06)}
  #g{display:block;position:relative}
  .w{margin-top:24px;font-size:21px;letter-spacing:-.02em;line-height:1.1;position:relative}
  .w b{font-weight:600}.w span{font-weight:400;opacity:.8}
  .t{margin-top:10px;font-size:12px;line-height:1.45;opacity:.82;max-width:128px;position:relative}
  </style><div class="s"><div class="ring"></div>${glyph}<div class="w"><b>BC</b> <span>Backup</span></div><div class="t">Cópias automáticas dos seus arquivos, com aviso por e-mail.</div></div>
  <script>
    const svg = document.getElementById('g'), b = svg.querySelector('g').getBBox(), pad = 2.1
    const size = Math.max(b.width, b.height) + pad * 2, cx = b.x + b.width / 2, cy = b.y + b.height / 2
    svg.setAttribute('viewBox', [cx - size / 2, cy - size / 2, size, size].join(' '))
  </script>`
}

/** Cabeçalho das páginas internas (fica à direita, fundo branco): 150 × 57. */
function headerHtml() {
  const mark = markSvg({ px: 36 })
  return `<!doctype html><style>html,body{margin:0}.h{width:150px;height:57px;background:#fff;display:flex;align-items:center;justify-content:flex-end;padding-right:14px;box-sizing:border-box}</style><div class="h">${mark}</div>`
}

async function renderOpaque(page, html, width, height) {
  await page.setViewportSize({ width, height })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({ clip: { x: 0, y: 0, width, height } })
}

/* ------------------------------------------------------------------ */
/* Saídas                                                              */
/* ------------------------------------------------------------------ */

// Ícone do app no estilo macOS: corpo de 824 px num quadro de 1024 (margem para a sombra).
const MAC_PAD = (32 * (1024 / 824) - 32) / 2
// Windows: quase sem margem (o Explorer e a barra de tarefas já espaçam os ícones).
const winIcon = (size) => {
  if (size <= 20) return markSvg({ px: size, check: false, stroke: 2.75 })
  if (size <= 32) return markSvg({ px: size })
  return markSvg({ px: size, pad: 1 })
}
const trayIcon = (size, badge) =>
  markSvg({ px: size, check: false, stroke: size <= 20 ? 2.75 : 2.5, badge: badge ? BADGE[badge] : null })

async function main() {
  const browser = await launch()
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  process.stdout.write('BC Backup — gerando ícones\n')

  // build/: ícone do app (electron-builder usa icon.ico no Windows e icon.png no macOS/Linux)
  write(join(BUILD, 'icon.svg'), markSvg({ px: 1024, pad: MAC_PAD, shadow: true }) + '\n')
  write(join(BUILD, 'icon.png'), await render(page, markSvg({ px: 1024, pad: MAC_PAD, shadow: true }), 1024))
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  const icoImages = []
  for (const size of icoSizes) icoImages.push({ size, png: await render(page, winIcon(size), size) })
  write(join(BUILD, 'icon.ico'), encodeIco(icoImages))
  write(join(RES, 'icon.ico'), encodeIco(icoImages)) // ícone da janela no Windows (src/main/window.ts)
  // Instalador assistido (electron-builder procura estes nomes em build/ automaticamente).
  write(join(BUILD, 'installerSidebar.bmp'), encodeBmp24(await renderOpaque(page, sidebarHtml(), 164, 314)))
  write(join(BUILD, 'installerHeader.bmp'), encodeBmp24(await renderOpaque(page, headerHtml(), 150, 57)))

  // resources/: arquivos lidos em tempo de execução pelo processo principal
  write(join(RES, 'logo.svg'), LOGO_SVG)
  write(join(RES, 'wordmark.svg'), await wordmarkSvg(page))
  write(join(RES, 'icon.png'), await render(page, markSvg({ px: 512, pad: MAC_PAD, shadow: true }), 512))

  for (const state of [null, 'running', 'warning', 'error']) {
    const name = state ? `tray-${state}` : 'tray'
    const images = []
    for (const size of [16, 20, 24, 32])
      images.push({ size, png: await render(page, trayIcon(size, state), size) })
    write(join(RES, `${name}.png`), images.find((i) => i.size === 16).png)
    write(join(RES, `${name}@2x.png`), images.find((i) => i.size === 32).png)
    write(join(RES, `${name}.ico`), encodeIco(images))
  }

  // macOS: imagens template (preto + alfa) — o nome precisa terminar em "Template".
  // Sem cor: "em execução" = seta sem o check; "falha/avisos" = ponto no canto.
  for (const [name, opts] of [
    ['trayTemplate', {}],
    ['tray-runningTemplate', { check: false }],
    ['tray-errorTemplate', { badge: true }]
  ]) {
    write(join(RES, `${name}.png`), await render(page, templateSvg({ px: 16, ...opts }), 16))
    write(join(RES, `${name}@2x.png`), await render(page, templateSvg({ px: 32, ...opts }), 32))
  }

  await browser.close()
}

main().catch((e) => {
  process.stderr.write(`${e?.stack ?? e}\n`)
  process.exit(1)
})
