import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Ensina o tailwind-merge sobre a escala tipográfica própria (text-body, text-small…),
// senão ele confunde tamanho de fonte com cor e descarta classes.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['display', 'title', 'section', 'body', 'small', 'caption', 'mono', 'stat', 'overline'] }
      ],
      shadow: [{ shadow: ['xs', 'card', 'pop', 'dialog'] }]
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
