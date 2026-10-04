import { Copy, FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { Wordmark } from '@renderer/components/ui/Logo'
import { bc } from '@renderer/lib/bc'
import { useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'
import { SettingsGroup, SettingsRow } from './SettingsRow'

const PLATFORM: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
  browser: 'Navegador (simulação)'
}

export function AboutTab() {
  const info = useApp((s) => s.info)
  if (!info) return null
  const details = `${info.name} ${info.version} · ${PLATFORM[info.platform] ?? info.platform} · ${info.hostname}`

  return (
    <div className="flex flex-col gap-8">
      <Card className="relative overflow-hidden rounded-xl px-8 py-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(60% 120% at 50% 0%, var(--accent-soft), transparent 70%)' }}
        />
        <div className="relative flex flex-col items-center gap-4 text-center">
          <Wordmark size={28} />
          <p className="max-w-[420px] text-small text-fg-muted">
            Backups automáticos para pastas, discos externos e servidores da rede — com retenção e aviso por e-mail.
          </p>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-surface-hover px-2.5 py-1 font-mono text-mono text-fg-muted">
              Versão {info.version}
            </span>
            <span className="rounded-full bg-surface-hover px-2.5 py-1 text-caption font-medium text-fg-muted">
              {PLATFORM[info.platform] ?? info.platform}
            </span>
          </div>
        </div>
      </Card>

      <SettingsGroup title="Informações">
        <SettingsRow label="Computador" description={info.hostname} />
        <SettingsRow label="Pasta de dados" description={<span className="font-mono text-mono">{info.dataPath}</span>}>
          <Button icon={FolderOpen} onClick={() => void bc.app.openPath(info.dataPath)}>
            Abrir
          </Button>
        </SettingsRow>
        <SettingsRow label="Pasta de logs" description={<span className="font-mono text-mono">{info.logsPath}</span>}>
          <Button icon={FolderOpen} onClick={() => void bc.app.openPath(info.logsPath)}>
            Abrir
          </Button>
        </SettingsRow>
        <SettingsRow label="Copiar detalhes da versão" description="Útil ao pedir suporte.">
          <Button
            icon={Copy}
            onClick={() =>
              navigator.clipboard
                .writeText(details)
                .then(() => notify.success('Detalhes copiados', { description: details }))
                .catch(() => notify.error('Não foi possível copiar'))
            }
          >
            Copiar
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <p className="px-1 text-center text-caption text-fg-subtle">
        Feito por BC · Brasil — construído com Electron, React e a fonte Geist.
      </p>
    </div>
  )
}
