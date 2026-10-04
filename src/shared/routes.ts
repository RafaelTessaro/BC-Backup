// Rotas da interface. O main usa estas strings no evento `navigate`
// (clique na bandeja, em notificações nativas, atalhos), e o renderer as interpreta.

export const ROUTES = {
  dashboard: '/painel',
  routines: '/rotinas',
  newRoutine: '/rotinas/nova',
  routine: (id: string) => `/rotinas/${id}`,
  history: '/historico',
  run: (runId: string) => `/historico/${runId}`,
  settings: '/configuracoes',
  settingsEmail: '/configuracoes/email',
  settingsAbout: '/configuracoes/sobre'
} as const

export type ParsedRoute =
  | { name: 'dashboard' }
  | { name: 'routines' }
  | { name: 'routine-new' }
  | { name: 'routine-edit'; id: string }
  | { name: 'history'; runId?: string }
  | { name: 'settings'; tab: 'geral' | 'email' | 'sobre' }

/** decodeURIComponent que não lança: "%" malformado (rota vinda de fora) fica como está. */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

export function parseRoute(path: string): ParsedRoute {
  const parts = path.replace(/^#/, '').split('/').filter(Boolean)
  switch (parts[0]) {
    case 'rotinas':
      if (parts[1] === 'nova') return { name: 'routine-new' }
      if (parts[1]) return { name: 'routine-edit', id: decodePart(parts[1]) }
      return { name: 'routines' }
    case 'historico':
      return { name: 'history', runId: parts[1] ? decodePart(parts[1]) : undefined }
    case 'configuracoes': {
      const tab = parts[1] === 'email' || parts[1] === 'sobre' ? parts[1] : 'geral'
      return { name: 'settings', tab }
    }
    default:
      return { name: 'dashboard' }
  }
}
