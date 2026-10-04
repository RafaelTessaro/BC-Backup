import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'

interface State {
  error: Error | null
}

/** Evita tela em branco se uma tela quebrar: mostra a falha e permite tentar de novo. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[BC Backup] Erro na interface:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 px-8 py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <TriangleAlert className="size-6" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="text-section font-semibold text-fg">Algo deu errado nesta tela</h2>
          <p className="mt-1 text-small text-fg-muted">
            Seus backups continuam funcionando normalmente. Tente abrir a tela de novo.
          </p>
          <p className="mt-3 font-mono text-mono break-words text-fg-subtle" data-selectable>
            {this.state.error.message}
          </p>
        </div>
        <Button icon={RotateCcw} onClick={() => this.setState({ error: null })}>
          Tentar de novo
        </Button>
      </div>
    )
  }
}
