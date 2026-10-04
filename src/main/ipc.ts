// Handlers IPC para TODOS os métodos de `BcApi` (src/shared/api.ts).
// Cada chamada valida o remetente (só a nossa interface) e os argumentos.

import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type WebFrameMain } from 'electron'
import { IPC_CHANNELS, type BcApi, type FileResult, type PickResult } from '@shared/api'
import type { AppSettings, ID, Routine } from '@shared/types'
import { buildExport, planImport } from './config-io'
import type { AppContext } from './context'
import { listDrives, diskSpace } from './drives'
import { estimateSize } from './engine/walk'
import { errMessage, pathExists } from './engine/fsutil'
import {
  asAbsPath,
  asBool,
  asFilters,
  asHistoryQuery,
  asId,
  asOptionalObject,
  asPathList,
  asRoutineForValidation,
  asRoutineInput,
  asSettingsPatch,
  asSmtpInput,
  asString,
  checkOpenablePath
} from './ipc-validate'
import { log } from './logger'
import { renderTestEmail } from './mail/template'
import { isSmtpConfigured, sendMail, smtpErrorMessage } from './mail/smtp'
import { isAppUrl } from './paths'
import { sealSecret } from './secrets'
import { computeStats } from './stats'
import { newId, type StoredRoutine } from './store'
import { isValidEmail, validateRoutine } from './validate'
import { applyTheme, getWindow, windowAction } from './window'

type A = BcApi
/** Canal → assinatura do método correspondente em BcApi (checado em tempo de compilação). */
interface HandlerMap {
  appInfo: A['app']['info']
  appOpenPath: A['app']['openPath']
  appShowInFolder: A['app']['showInFolder']
  appOpenExternal: A['app']['openExternal']
  appWindow: A['app']['window']
  appSetResolvedTheme: A['app']['setResolvedTheme']
  routinesList: A['routines']['list']
  routinesGet: A['routines']['get']
  routinesSave: A['routines']['save']
  routinesRemove: A['routines']['remove']
  routinesDuplicate: A['routines']['duplicate']
  routinesSetEnabled: A['routines']['setEnabled']
  routinesRunNow: A['routines']['runNow']
  routinesCancel: A['routines']['cancel']
  routinesNextRuns: A['routines']['nextRuns']
  routinesValidate: A['routines']['validate']
  runsList: A['runs']['list']
  runsGet: A['runs']['get']
  runsActive: A['runs']['active']
  runsClear: A['runs']['clear']
  settingsGet: A['settings']['get']
  settingsUpdate: A['settings']['update']
  settingsSaveSmtp: A['settings']['saveSmtp']
  settingsTestSmtp: A['settings']['testSmtp']
  settingsExport: A['settings']['exportConfig']
  settingsImport: A['settings']['importConfig']
  systemDrives: A['system']['drives']
  systemDiskSpace: A['system']['diskSpace']
  systemPickFolders: A['system']['pickFolders']
  systemPickFiles: A['system']['pickFiles']
  systemStats: A['system']['stats']
  systemEstimateSize: A['system']['estimateSize']
}

// Garante que todo canal de IPC_CHANNELS tem handler (e vice-versa).
type Missing = Exclude<keyof typeof IPC_CHANNELS, keyof HandlerMap>
const _allChannelsCovered: Missing extends never ? true : Missing = true
void _allChannelsCovered

type Handler<K extends keyof HandlerMap> = (
  ...args: unknown[]
) => Promise<Awaited<ReturnType<HandlerMap[K]>>> | Awaited<ReturnType<HandlerMap[K]>>

function trustedSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false
  if (frame.parent) return false // só o frame principal
  return isAppUrl(frame.url)
}

function handle<K extends keyof HandlerMap>(key: K, fn: Handler<K>): void {
  const channel = IPC_CHANNELS[key]
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (e, ...args: unknown[]) => {
    if (!trustedSender(e.senderFrame)) {
      log.warn(`IPC recusado de remetente não confiável: ${channel}`)
      throw new Error('Remetente não autorizado.')
    }
    try {
      return await fn(...args)
    } catch (err) {
      if (!(err instanceof Error && err.name === 'IpcArgError'))
        log.warn(`IPC ${channel} falhou:`, errMessage(err))
      // Sempre um Error simples: o renderer recebe "Error invoking remote method '<canal>': Error: <mensagem pt-BR>".
      throw new Error(errMessage(err), { cause: err })
    }
  })
}

function parentWindow(): BrowserWindow | undefined {
  return getWindow() ?? undefined
}

function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLocaleLowerCase('pt-BR')))
  let name = base
  for (let n = 2; taken.has(name.toLocaleLowerCase('pt-BR')); n++)
    name = `${base.replace(/ \(cópia(?: \d+)?\)$/, '')} (cópia ${n})`
  return name
}

function scheduleKey(r: Pick<Routine, 'schedule'>): string {
  return JSON.stringify(r.schedule)
}

export function registerIpc(ctx: AppContext): void {
  const { store, history, runner, scheduler } = ctx
  const getRoutineOrThrow = (id: ID): StoredRoutine => {
    const r = store.getRoutine(id)
    if (!r) throw new Error('Rotina não encontrada.')
    return r
  }

  /* ------------------------------ app ------------------------------ */
  handle('appInfo', () => ctx.info)
  handle('appOpenPath', async (p) => {
    // Só pastas e .zip: openPath num .exe/.bat/.lnk executaria o arquivo.
    const path = await checkOpenablePath(asAbsPath(p))
    const err = await shell.openPath(path)
    if (err) throw new Error(`Não foi possível abrir: ${err}`)
  })
  handle('appShowInFolder', async (p) => {
    const path = asAbsPath(p)
    if (!(await pathExists(path))) throw new Error(`Caminho não encontrado: ${path}`)
    shell.showItemInFolder(path)
  })
  handle('appOpenExternal', async (u) => {
    const url = asString(u, 'url', 4000)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Endereço inválido.')
    }
    if (parsed.protocol !== 'https:') throw new Error('Só é possível abrir endereços https.')
    await shell.openExternal(parsed.toString())
  })
  handle('appWindow', (a) => {
    if (a !== 'minimize' && a !== 'maximize' && a !== 'close') throw new Error('Ação de janela inválida.')
    windowAction(a)
  })
  handle('appSetResolvedTheme', (t) => {
    if (t !== 'light' && t !== 'dark') throw new Error('Tema inválido.')
    applyTheme(t)
  })

  /* ---------------------------- rotinas ---------------------------- */
  handle('routinesList', () => ctx.routinesWithLastRun())
  handle('routinesGet', (id) => {
    const r = store.getRoutine(asId(id))
    return r ? ctx.withLastRun(r) : null
  })
  handle('routinesSave', async (raw) => {
    const input = asRoutineInput(raw)
    const issues = await validateRoutine(asRoutineForValidation(raw), {
      existing: store.routines(),
      smtpConfigured: isSmtpConfigured(store.settings),
      checkFs: false
    })
    const error = issues.find((i) => i.level === 'error')
    if (error) throw new Error(error.message)
    const prev = store.getRoutine(input.id)
    const now = new Date().toISOString()
    const routine: StoredRoutine = { ...input, createdAt: prev?.createdAt ?? now, updatedAt: now }
    await store.upsertRoutine(routine)
    // Agenda nova/alterada ou rotina retomada: não dispara horários que já passaram.
    if (!prev || scheduleKey(prev) !== scheduleKey(routine) || (!prev.enabled && routine.enabled)) {
      store.setRoutineState(routine.id, { lastAttemptSlot: now })
    }
    ctx.routinesChanged()
    return ctx.withLastRun(routine)
  })
  handle('routinesRemove', async (id) => {
    const rid = asId(id)
    if (runner.isBusy(rid)) await runner.cancel(rid)
    const paused = store.state.data.pausedByTray
    if (paused?.includes(rid)) store.state.data.pausedByTray = paused.filter((x) => x !== rid)
    await store.removeRoutine(rid)
    ctx.routinesChanged()
  })
  handle('routinesDuplicate', async (id) => {
    const src = getRoutineOrThrow(asId(id))
    const now = new Date().toISOString()
    const copy: StoredRoutine = {
      ...structuredClone(src),
      id: newId(),
      name: uniqueName(
        `${src.name} (cópia)`,
        store.routines().map((r) => r.name)
      ).slice(0, 60),
      createdAt: now,
      updatedAt: now
    }
    copy.sources = copy.sources.map((s) => ({ ...s, id: newId() }))
    copy.destinations = copy.destinations.map((d) => ({ ...d, id: newId() }))
    await store.upsertRoutine(copy)
    store.setRoutineState(copy.id, { lastAttemptSlot: now })
    ctx.routinesChanged()
    return ctx.withLastRun(copy)
  })
  handle('routinesSetEnabled', async (id, enabled) => {
    const r = getRoutineOrThrow(asId(id))
    const on = asBool(enabled, 'enabled')
    const now = new Date().toISOString()
    const next: StoredRoutine = { ...r, enabled: on, updatedAt: now }
    await store.upsertRoutine(next)
    if (on && !r.enabled) store.setRoutineState(r.id, { lastAttemptSlot: now })
    const paused = store.state.data.pausedByTray
    if (on && paused?.includes(r.id)) {
      store.state.data.pausedByTray = paused.filter((x) => x !== r.id)
      void store.state.save().catch(() => {})
    }
    ctx.routinesChanged()
    return ctx.withLastRun(next)
  })
  handle('routinesRunNow', (id) => {
    const rid = asId(id)
    getRoutineOrThrow(rid)
    const res = runner.enqueue(rid, 'manual')
    if (!res) throw new Error('Rotina não encontrada.')
    ctx.refreshTray()
    return { runId: res.runId }
  })
  handle('routinesCancel', async (id) => {
    await runner.cancel(asId(id))
  })
  handle('routinesNextRuns', () => scheduler.nextRuns())
  handle('routinesValidate', (raw) =>
    validateRoutine(asRoutineForValidation(raw), {
      existing: store.routines(),
      smtpConfigured: isSmtpConfigured(store.settings),
      checkFs: true
    })
  )

  /* ---------------------------- histórico --------------------------- */
  handle('runsList', (q) => history.list(asHistoryQuery(q)))
  handle('runsGet', async (id) => {
    const rid = asId(id)
    return (await history.get(rid)) ?? runner.activeRecord(rid)
  })
  handle('runsActive', () => runner.active())
  handle('runsClear', async () => {
    await history.clear()
    ctx.routinesChanged()
  })

  /* -------------------------- configurações ------------------------- */
  handle('settingsGet', () => store.settings)
  handle('settingsUpdate', async (patch) => {
    const p = asSettingsPatch(patch)
    const prev = store.settings
    await store.updateSettings(p as Partial<AppSettings>)
    await ctx.settingsChanged(prev)
    return store.settings
  })
  handle('settingsSaveSmtp', async (raw) => {
    const input = asSmtpInput(raw)
    const { password, ...smtp } = input
    for (const e of [smtp.fromEmail, smtp.replyTo].filter(Boolean)) {
      if (!isValidEmail(e)) throw new Error(`E-mail inválido: ${e}`)
    }
    const prev = store.settings
    if (password !== undefined) await store.setSmtpPassword(password ? await sealSecret(password) : undefined)
    await store.updateSettings({ smtp: { ...smtp, hasPassword: !!store.config.data.secrets.smtpPassword } })
    await ctx.settingsChanged(prev)
    return store.settings
  })
  handle('settingsTestSmtp', async (raw) => {
    const obj = asOptionalObject(raw, 'teste')
    const to = typeof obj.to === 'string' ? obj.to.trim() : ''
    if (!isValidEmail(to)) return { ok: false, message: 'Informe um e-mail válido para receber o teste.' }
    const input = asSmtpInput(raw)
    const { password: typed, ...smtp } = input
    if (!smtp.host) return { ok: false, message: 'Informe o servidor SMTP.' }
    if (!smtp.fromEmail && !smtp.user) return { ok: false, message: 'Informe o e-mail do remetente.' }
    try {
      const password =
        typed !== undefined ? typed : store.settings.smtp.hasPassword ? await ctx.getSmtpPassword() : ''
      const security =
        smtp.security === 'ssl' ? 'SSL/TLS' : smtp.security === 'starttls' ? 'STARTTLS' : 'sem criptografia'
      const rendered = renderTestEmail({
        companyName: store.settings.companyName || 'BC Backup',
        hostname: ctx.hostname,
        appVersion: ctx.version,
        clientName: store.settings.clientName,
        computerAlias: store.settings.computerAlias,
        smtpServer: `${smtp.host}:${smtp.port} (${security})`,
        sentAt: new Date()
      })
      await sendMail(
        { ...smtp, timeoutSec: Math.min(smtp.timeoutSec || 30, 20) },
        password,
        { to: [to], ...rendered },
        { connectTimeoutMs: 15_000 }
      )
      return { ok: true, message: `E-mail de teste enviado para ${to}.` }
    } catch (e) {
      return { ok: false, message: smtpErrorMessage(e, smtp) }
    }
  })
  handle('settingsExport', async (): Promise<FileResult> => {
    const stamp = new Date().toISOString().slice(0, 10)
    const opts = {
      title: 'Exportar configurações',
      defaultPath: `bc-backup-configuracoes-${stamp}.json`,
      buttonLabel: 'Exportar',
      filters: [{ name: 'Configurações do BC Backup', extensions: ['json'] }]
    }
    const w = parentWindow()
    const res = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { canceled: true }
    try {
      const data = buildExport(store.settings, store.routines(), ctx.version)
      await writeFile(res.filePath, JSON.stringify(data, null, 2), 'utf8')
      return {
        canceled: false,
        ok: true,
        path: res.filePath,
        message: `Configurações exportadas (${data.routines.length} rotina(s)). A senha do e-mail não vai no arquivo.`
      }
    } catch (e) {
      return {
        canceled: false,
        ok: false,
        path: res.filePath,
        message: `Não foi possível salvar o arquivo: ${errMessage(e)}`
      }
    }
  })
  handle('settingsImport', async (): Promise<FileResult> => {
    const opts: OpenDialogOptions = {
      title: 'Importar configurações',
      buttonLabel: 'Importar',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Configurações do BC Backup', extensions: ['json'] }]
    }
    const w = parentWindow()
    const res = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    const file = res.filePaths[0]
    if (res.canceled || !file) return { canceled: true }
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
      const plan = planImport(raw, store.routines())
      const prev = store.settings
      const now = new Date().toISOString()
      for (const r of plan.routines) {
        await store.upsertRoutine(r)
        store.setRoutineState(r.id, { lastAttemptSlot: now })
      }
      if (plan.settings) {
        const keepPassword = !!store.config.data.secrets.smtpPassword
        await store.updateSettings({
          ...plan.settings,
          smtp: { ...plan.settings.smtp!, hasPassword: keepPassword }
        })
      }
      await ctx.settingsChanged(prev)
      ctx.routinesChanged()
      return {
        canceled: false,
        ok: true,
        path: file,
        message:
          `Importada(s) ${plan.routines.length} rotina(s)${plan.settings ? ' e as configurações' : ''}. ` +
          'A senha do e-mail não é exportada: digite-a em Configurações › E-mail.'
      }
    } catch (e) {
      const msg = e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : errMessage(e)
      return { canceled: false, ok: false, path: file, message: msg }
    }
  })

  /* ----------------------------- sistema ---------------------------- */
  handle('systemDrives', () => listDrives())
  handle('systemDiskSpace', (p) => diskSpace(asAbsPath(p)))
  handle('systemPickFolders', async (o): Promise<PickResult> => {
    const opts = asOptionalObject(o, 'opções')
    const multi = opts.multi === true
    const dialogOpts: OpenDialogOptions = {
      title:
        typeof opts.title === 'string' && opts.title
          ? opts.title
          : multi
            ? 'Escolher pastas'
            : 'Escolher pasta',
      buttonLabel: 'Selecionar',
      properties: [
        'openDirectory',
        'createDirectory',
        'dontAddToRecent',
        ...(multi ? (['multiSelections'] as const) : [])
      ]
    }
    const w = parentWindow()
    const res = w ? await dialog.showOpenDialog(w, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    return { canceled: res.canceled, paths: res.canceled ? [] : res.filePaths }
  })
  handle('systemPickFiles', async (o): Promise<PickResult> => {
    const opts = asOptionalObject(o, 'opções')
    const dialogOpts: OpenDialogOptions = {
      title: typeof opts.title === 'string' && opts.title ? opts.title : 'Escolher arquivos',
      buttonLabel: 'Selecionar',
      properties: ['openFile', 'multiSelections', 'dontAddToRecent']
    }
    const w = parentWindow()
    const res = w ? await dialog.showOpenDialog(w, dialogOpts) : await dialog.showOpenDialog(dialogOpts)
    return { canceled: res.canceled, paths: res.canceled ? [] : res.filePaths }
  })
  handle('systemStats', () => computeStats(store.routines(), history.records(), scheduler.nextRuns()))
  handle('systemEstimateSize', (sources, filters) =>
    estimateSize(asPathList(sources), asFilters(filters), 4000)
  )
}
