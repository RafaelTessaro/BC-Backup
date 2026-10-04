import { Download, FolderOpen, Monitor, Moon, Sun, Upload } from 'lucide-react'
import { useState } from 'react'
import type { AppSettings } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { NumberStepper } from '@renderer/components/ui/NumberStepper'
import { PathText } from '@renderer/components/ui/PathText'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { bc, errorMessage } from '@renderer/lib/bc'
import { refreshRoutines, updateSettings, useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'
import { SettingsGroup, SettingsRow } from './SettingsRow'

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'Claro', icon: Sun },
  { value: 'dark' as const, label: 'Escuro', icon: Moon },
  { value: 'system' as const, label: 'Sistema', icon: Monitor }
]

function TextSetting({
  id,
  value,
  placeholder,
  onCommit
}: {
  id: string
  value: string
  placeholder?: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      id={id}
      className="w-[260px]"
      value={draft ?? value}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() !== value) onCommit(draft.trim())
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function osName(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'sistema'
  return 'Windows'
}

export function GeneralTab() {
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  if (!settings) return null
  const os = osName(info?.platform ?? 'win32')

  const save = (patch: Partial<Omit<AppSettings, 'smtp'>>): void => {
    updateSettings(patch).catch((err) => notify.error('Não foi possível salvar', { description: errorMessage(err) }))
  }

  const saveText = (patch: Partial<Omit<AppSettings, 'smtp'>>): void => {
    updateSettings(patch)
      .then(() => notify.success('Configuração salva', { duration: 2500 }))
      .catch((err) => notify.error('Não foi possível salvar', { description: errorMessage(err) }))
  }

  const exportConfig = async (): Promise<void> => {
    setBusy('export')
    try {
      const r = await bc.settings.exportConfig()
      if (!r.canceled) (r.ok === false ? notify.error : notify.success)(r.ok === false ? 'Falha ao exportar' : 'Configurações exportadas', { description: r.message })
    } catch (err) {
      notify.error('Falha ao exportar', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const importConfig = async (): Promise<void> => {
    setBusy('import')
    try {
      const r = await bc.settings.importConfig()
      if (!r.canceled) {
        if (r.ok === false) notify.error('Falha ao importar', { description: r.message })
        else {
          notify.success('Configurações importadas', { description: r.message })
          await refreshRoutines()
        }
      }
    } catch (err) {
      notify.error('Falha ao importar', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="Sistema">
        <SettingsRow
          label={`Iniciar com o ${os}`}
          description="O BC Backup abre na área de notificação ao ligar o computador, para os agendamentos rodarem."
          htmlFor="launch"
        >
          <Switch id="launch" checked={settings.launchAtLogin} onCheckedChange={(v) => save({ launchAtLogin: v })} />
        </SettingsRow>
        <SettingsRow
          label="Ao fechar a janela"
          description={
            settings.closeToTray
              ? 'O aplicativo continua rodando perto do relógio.'
              : 'Fechando o aplicativo, os backups agendados não rodam.'
          }
          htmlFor="close"
        >
          <Select
            id="close"
            className="w-[240px]"
            value={settings.closeToTray ? 'tray' : 'quit'}
            onChange={(v) => save({ closeToTray: v === 'tray' })}
            options={[
              { value: 'tray', label: 'Minimizar para a bandeja' },
              { value: 'quit', label: 'Encerrar o BC Backup' }
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label={`Notificações do ${os}`}
          description="Avisar quando um backup terminar, principalmente se houver avisos ou falhas."
          htmlFor="notif"
        >
          <Switch
            id="notif"
            checked={settings.desktopNotifications}
            onCheckedChange={(v) => save({ desktopNotifications: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Aparência">
        <SettingsRow label="Tema" description="Sistema acompanha o modo claro ou escuro do computador.">
          <Segmented
            label="Tema"
            value={settings.theme}
            onChange={(v) => save({ theme: v })}
            options={THEME_OPTIONS}
            className="w-[300px]"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Identificação" description="Aparece no assunto e no texto dos e-mails enviados aos seus clientes.">
        <SettingsRow label="Nome do cliente" description="Quem é dono destes arquivos." htmlFor="client">
          <TextSetting
            id="client"
            value={settings.clientName}
            placeholder="Ex.: Padaria Pão Quente"
            onCommit={(v) => saveText({ clientName: v })}
          />
        </SettingsRow>
        <SettingsRow label="Apelido do computador" description="Ajuda a saber de qual máquina veio o aviso." htmlFor="alias">
          <TextSetting
            id="alias"
            value={settings.computerAlias}
            placeholder={info?.hostname ?? 'Ex.: Recepção'}
            onCommit={(v) => saveText({ computerAlias: v })}
          />
        </SettingsRow>
        <SettingsRow label="Nome da empresa" description="Assina os e-mails — use o nome da sua empresa de TI." htmlFor="company">
          <TextSetting
            id="company"
            value={settings.companyName}
            placeholder="Ex.: BC Informática"
            onCommit={(v) => saveText({ companyName: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Dados">
        <SettingsRow
          label="Guardar histórico por"
          description="Execuções mais antigas saem do histórico. Os backups nos destinos não são afetados."
          htmlFor="history-days"
        >
          <NumberStepper
            id="history-days"
            label="Dias de histórico"
            value={settings.historyDays}
            min={7}
            max={3650}
            step={30}
            suffix="dias"
            onChange={(v) => save({ historyDays: v })}
          />
        </SettingsRow>
        {info && (
          <SettingsRow label="Pasta de logs" stack>
            <div className="flex w-full min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1 rounded-md bg-surface-hover px-2.5 py-1.5">
                <PathText path={info.logsPath} className="text-fg-muted" />
              </div>
              <Button icon={FolderOpen} onClick={() => void bc.app.openPath(info.logsPath)}>
                Abrir pasta
              </Button>
            </div>
          </SettingsRow>
        )}
        <SettingsRow
          label="Levar para outro computador"
          description="Exporta rotinas e configurações para um arquivo .json. Senhas nunca são exportadas."
        >
          <Button icon={Upload} loading={busy === 'import'} onClick={() => void importConfig()}>
            Importar…
          </Button>
          <Button icon={Download} loading={busy === 'export'} onClick={() => void exportConfig()}>
            Exportar…
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  )
}
