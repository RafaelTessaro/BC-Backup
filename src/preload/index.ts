// Preload em sandbox (saída CJS): expõe `window.bc` (BcApi) com contextBridge.
// Cada método vira um ipcRenderer.invoke no canal correspondente de IPC_CHANNELS;
// cada `on.*` assina um evento de IPC_EVENTS e devolve a função para cancelar a assinatura.
// O renderer nunca recebe o ipcRenderer cru.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type BcApi } from '@shared/api'

type Channel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
type EventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

const invoke = <T>(channel: Channel, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: EventChannel, cb: (payload: T) => void): () => void {
  if (typeof cb !== 'function') throw new TypeError('callback inválido')
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: BcApi = {
  app: {
    info: () => invoke(IPC_CHANNELS.appInfo),
    openPath: (path) => invoke(IPC_CHANNELS.appOpenPath, path),
    showInFolder: (path) => invoke(IPC_CHANNELS.appShowInFolder, path),
    openExternal: (url) => invoke(IPC_CHANNELS.appOpenExternal, url),
    window: (action) => invoke(IPC_CHANNELS.appWindow, action),
    setResolvedTheme: (theme) => invoke(IPC_CHANNELS.appSetResolvedTheme, theme)
  },
  routines: {
    list: () => invoke(IPC_CHANNELS.routinesList),
    get: (id) => invoke(IPC_CHANNELS.routinesGet, id),
    save: (input) => invoke(IPC_CHANNELS.routinesSave, input),
    remove: (id) => invoke(IPC_CHANNELS.routinesRemove, id),
    duplicate: (id) => invoke(IPC_CHANNELS.routinesDuplicate, id),
    setEnabled: (id, enabled) => invoke(IPC_CHANNELS.routinesSetEnabled, id, enabled),
    runNow: (id) => invoke(IPC_CHANNELS.routinesRunNow, id),
    cancel: (id) => invoke(IPC_CHANNELS.routinesCancel, id),
    nextRuns: () => invoke(IPC_CHANNELS.routinesNextRuns),
    validate: (input) => invoke(IPC_CHANNELS.routinesValidate, input)
  },
  runs: {
    list: (query) => invoke(IPC_CHANNELS.runsList, query),
    get: (id) => invoke(IPC_CHANNELS.runsGet, id),
    active: () => invoke(IPC_CHANNELS.runsActive),
    clear: () => invoke(IPC_CHANNELS.runsClear)
  },
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet),
    update: (patch) => invoke(IPC_CHANNELS.settingsUpdate, patch),
    saveSmtp: (input) => invoke(IPC_CHANNELS.settingsSaveSmtp, input),
    testSmtp: (input) => invoke(IPC_CHANNELS.settingsTestSmtp, input),
    exportConfig: () => invoke(IPC_CHANNELS.settingsExport),
    importConfig: () => invoke(IPC_CHANNELS.settingsImport)
  },
  system: {
    drives: () => invoke(IPC_CHANNELS.systemDrives),
    diskSpace: (path) => invoke(IPC_CHANNELS.systemDiskSpace, path),
    pickFolders: (opts) => invoke(IPC_CHANNELS.systemPickFolders, opts),
    pickFiles: (opts) => invoke(IPC_CHANNELS.systemPickFiles, opts),
    stats: () => invoke(IPC_CHANNELS.systemStats),
    estimateSize: (sources, filters) => invoke(IPC_CHANNELS.systemEstimateSize, sources, filters),
    // File.path foi removido no Electron 32: o caminho vem do webUtils (só funciona no preload).
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
    inspectPaths: (paths) => invoke(IPC_CHANNELS.systemInspectPaths, paths),
    previewMove: (sources, filters, move) => invoke(IPC_CHANNELS.systemPreviewMove, sources, filters, move)
  },
  on: {
    progress: (cb) => subscribe(IPC_EVENTS.progress, cb),
    runFinished: (cb) => subscribe(IPC_EVENTS.runFinished, cb),
    routinesChanged: (cb) => subscribe(IPC_EVENTS.routinesChanged, () => cb()),
    settingsChanged: (cb) => subscribe(IPC_EVENTS.settingsChanged, cb),
    navigate: (cb) => subscribe(IPC_EVENTS.navigate, cb),
    trayShown: (cb) => subscribe(IPC_EVENTS.trayShown, () => cb())
  },
  tray: {
    openMain: (route) => invoke(IPC_CHANNELS.trayOpenMain, route),
    hide: (opts) => invoke(IPC_CHANNELS.trayHide, opts),
    setAllPaused: (paused) => invoke(IPC_CHANNELS.traySetAllPaused, paused),
    quit: () => invoke(IPC_CHANNELS.trayQuit)
  }
}

contextBridge.exposeInMainWorld('bc', api)
