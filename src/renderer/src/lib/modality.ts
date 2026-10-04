// Modalidade de entrada (mouse × teclado). O Chrome marca como :focus-visible o foco que o Radix
// move por script (ex.: "Cancelar" num dialog aberto com o mouse), o que deixa anéis e Tooltips
// aparecendo para quem só usa o mouse. Guardamos o último tipo de interação em
// <html data-input="pointer|keyboard"> e usamos isso no CSS e no Tooltip. Teclado nunca perde nada.

export type InputModality = 'pointer' | 'keyboard'

let current: InputModality = 'keyboard'
let installed = false

export function inputModality(): InputModality {
  return current
}

function set(m: InputModality): void {
  if (current === m) return
  current = m
  document.documentElement.dataset.input = m
}

/**
 * Define a modalidade sem esperar uma interação (painel da bandeja: aberto quase sempre pelo mouse,
 * o foco inicial no botão principal não ganha anel; a primeira tecla o traz de volta).
 */
export function setInputModality(m: InputModality): void {
  set(m)
}

export function trackInputModality(): void {
  if (installed) return
  installed = true
  document.documentElement.dataset.input = current
  window.addEventListener('pointerdown', () => set('pointer'), true)
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') set('keyboard')
    },
    true
  )
}
