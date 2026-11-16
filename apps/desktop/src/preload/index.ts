import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL, WINDOW_STATE_CHANNEL } from '@nexus/shared/constants'
import type { IpcChannel, RpcResult } from '@nexus/shared'

const invoke = async (channel: IpcChannel, input?: unknown): Promise<unknown> => {
  const result = (await ipcRenderer.invoke(channel, input)) as RpcResult<unknown>
  if (!result || typeof result !== 'object') {
    throw new Error(`Invalid IPC response for ${channel}`)
  }
  if (!result.ok) {
    const error = new Error(result.error?.message ?? `Request failed: ${channel}`)
    ;(error as Error & { code?: string }).code = result.error?.code ?? 'E_INTERNAL'
    throw error
  }
  return result.data
}

const bridge = {
  platform: process.platform,
  invoke,
  onEvent: (listener: (envelope: unknown) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, envelope: unknown): void =>
      listener(envelope)
    ipcRenderer.on(EVENT_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, wrapped)
  },
  onWindowState: (
    listener: (state: { maximized: boolean; focused: boolean }) => void,
  ): (() => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      state: { maximized: boolean; focused: boolean },
    ): void => listener(state)
    ipcRenderer.on(WINDOW_STATE_CHANNEL, wrapped)
    return () => ipcRenderer.removeListener(WINDOW_STATE_CHANNEL, wrapped)
  },
}

contextBridge.exposeInMainWorld('nexus', bridge)
