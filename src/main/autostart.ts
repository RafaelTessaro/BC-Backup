// Iniciar com o sistema (guia §4). Windows/macOS: setLoginItemSettings com "--hidden";
// Linux: ~/.config/autostart/bc-backup.desktop. Em dev (não empacotado) nunca registra nada,
// para não colocar o electron de node_modules na inicialização.

import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { log } from './logger'

export const HIDDEN_FLAG = '--hidden'

/** Portable (electron-builder) roda de uma pasta temporária: o caminho estável vem da env. */
const exePath = () => process.env.PORTABLE_EXECUTABLE_FILE ?? process.env.APPIMAGE ?? process.execPath

const linuxDesktopFile = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'bc-backup.desktop')

export async function setAutoStart(enabled: boolean): Promise<void> {
  if (!app.isPackaged) return
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: exePath(), args: [HIDDEN_FLAG] })
    } else if (process.platform === 'darwin') {
      // SMAppService (macOS 13+); `openAsHidden` não existe mais — usamos wasOpenedAtLogin.
      app.setLoginItemSettings({ openAtLogin: enabled })
    } else if (enabled) {
      const exec = `"${exePath().replace(/(["`$\\])/g, '\\$1')}" ${HIDDEN_FLAG}`
      await mkdir(dirname(linuxDesktopFile()), { recursive: true })
      await writeFile(
        linuxDesktopFile(),
        [
          '[Desktop Entry]',
          'Type=Application',
          'Name=BC Backup',
          'Comment=Backups agendados do BC Backup',
          `Exec=${exec}`,
          'Icon=bc-backup',
          'X-GNOME-Autostart-enabled=true',
          'X-GNOME-Autostart-Delay=10',
          'Terminal=false',
          ''
        ].join('\n')
      )
    } else {
      await rm(linuxDesktopFile(), { force: true })
    }
  } catch (e) {
    log.warn('Falha ao configurar a inicialização com o sistema', e)
  }
}

export function getAutoStart(): { enabled: boolean; blockedByUser: boolean } {
  if (process.platform === 'win32') {
    const s = app.getLoginItemSettings({ path: exePath(), args: [HIDDEN_FLAG] })
    return { enabled: s.openAtLogin, blockedByUser: s.openAtLogin && !s.executableWillLaunchAtLogin }
  }
  if (process.platform === 'darwin') {
    const s = app.getLoginItemSettings()
    return { enabled: s.openAtLogin, blockedByUser: s.status === 'requires-approval' }
  }
  return { enabled: existsSync(linuxDesktopFile()), blockedByUser: false }
}

/** Iniciado pela inicialização do sistema (ou com --hidden): não mostra a janela. */
export function startedHidden(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true
  if (process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin
    } catch {
      return false
    }
  }
  return false
}
