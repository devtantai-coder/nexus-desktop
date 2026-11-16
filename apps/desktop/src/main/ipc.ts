import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Notification,
  powerSaveBlocker,
  shell,
} from 'electron'
import {
  IPC_CHANNELS,
  NexusError,
  errorPayload,
  ipcSchemas,
  redactSecrets,
  type Attachment,
  type IpcChannel,
  type RpcResult,
} from '@nexus/shared'
import { logger } from './logger'

let preventSleepId: number | null = null
import type { CoreClient } from './core-client'

export interface IpcDeps {
  core: CoreClient
  userDataPath: string
  databasePath: string
  isDev: boolean
  onSettingChanged?: (key: string, value: unknown) => void
  popoutWindow?: (sessionId: string) => void
}

type Handler = (input: any, event: Electron.IpcMainInvokeEvent) => Promise<unknown> | unknown

const MAX_ATTACHMENT_TEXT = 400_000
const MAX_ATTACHMENT_IMAGE = 4_000_000

function sanitizeFileName(name: string): string {
  return name.replace(/[\r\n\t]/g, ' ').slice(0, 200)
}

export function registerIpc(deps: IpcDeps): void {
  const local: Partial<Record<IpcChannel, Handler>> = {
    'app.info': () => ({
      name: 'NEXUS Desktop',
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      arch: process.arch,
      userDataPath: deps.userDataPath,
      databasePath: deps.databasePath,
      encryptionAvailable: true,
      isDev: deps.isDev,
    }),
    'app.openExternal': async ({ url }) => {
      if (!/^https?:\/\//i.test(url)) {
        throw new NexusError('E_VALIDATION', 'Only http(s) links can be opened')
      }
      await shell.openExternal(url)
    },
    'app.showItemInFolder': ({ path }) => {
      shell.showItemInFolder(path)
    },
    'app.openLogs': async () => {
      const path = logger.path()
      await shell.showItemInFolder(path)
      return path
    },
    'app.logs': ({ limit }) => logger.tail(limit ?? 400),
    'app.setNativeTheme': ({ theme }) => {
      nativeTheme.themeSource = theme
    },
    'app.setPreventSleep': ({ enabled }) => {
      if (enabled && preventSleepId === null) {
        preventSleepId = powerSaveBlocker.start('prevent-app-suspension')
      } else if (!enabled && preventSleepId !== null) {
        powerSaveBlocker.stop(preventSleepId)
        preventSleepId = null
      }
    },
    'app.notify': ({ title, body, level }) => {
      if (!Notification.isSupported()) return
      new Notification({
        title: sanitizeFileName(title),
        body: body ? redactSecrets(body).slice(0, 500) : undefined,
        urgency: level === 'error' ? 'critical' : level === 'warning' ? 'normal' : 'low',
      }).show()
    },

    'window.popout': ({ sessionId }, event) => {
      const source = BrowserWindow.fromWebContents(event.sender)
      if (!source) return
      deps.popoutWindow?.(sessionId)
    },
    'window.minimize': (_input, event) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize()
    },
    'window.toggleMaximize': (_input, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { maximized: false }
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return { maximized: win.isMaximized() }
    },
    'window.close': (_input, event) => {
      BrowserWindow.fromWebContents(event.sender)?.close()
    },
    'window.state': (_input, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return { maximized: win?.isMaximized() ?? false, focused: win?.isFocused() ?? false }
    },

    'project.pick': async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      const selected = result.filePaths[0]
      if (result.canceled || !selected) return null
      return deps.core.request('project.open', { path: selected })
    },

    'workspace.pickFiles': async ({ kind }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters:
          kind === 'image'
            ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
            : undefined,
      })
      if (result.canceled) return []
      const attachments: Attachment[] = []
      for (const filePath of result.filePaths.slice(0, 10)) {
        const stat = await fs.stat(filePath)
        const name = basename(filePath)
        if (stat.size > (kind === 'image' ? MAX_ATTACHMENT_IMAGE : MAX_ATTACHMENT_TEXT)) continue
        if (kind === 'image') {
          const ext = name.split('.').pop()?.toLowerCase() ?? 'png'
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
          const buffer = await fs.readFile(filePath)
          attachments.push({
            name,
            path: filePath,
            kind: 'image',
            mimeType,
            base64: buffer.toString('base64'),
          })
          continue
        }
        const content = await fs.readFile(filePath, 'utf8').catch(() => '')
        attachments.push({ name, path: filePath, kind: 'file', content })
      }
      return attachments
    },
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, rawInput): Promise<RpcResult<unknown>> => {
      const senderUrl = event.senderFrame?.url ?? ''
      if (!isTrustedSender(senderUrl, deps.isDev)) {
        return { ok: false, error: { code: 'E_PERMISSION', message: 'Untrusted IPC sender' } }
      }
      const schema = ipcSchemas[channel]
      const parsed = schema.safeParse(rawInput)
      if (!parsed.success) {
        const message = parsed.error.issues
          .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
          .join('; ')
        return { ok: false, error: { code: 'E_VALIDATION', message: `Invalid input: ${message}` } }
      }
      const input = parsed.data as any
      try {
        const handler = local[channel]
        const data = handler
          ? await handler(input, event)
          : await deps.core.request(channel, input ?? {})
        if (channel === 'settings.set') {
          deps.onSettingChanged?.(input.key, input.value)
        }
        return { ok: true, data }
      } catch (error) {
        const payload = errorPayload(error)
        if (payload.code === 'E_INTERNAL' || payload.code === 'E_FS') {
          logger.warn(`ipc ${channel} failed`, payload)
        }
        return { ok: false, error: payload }
      }
    })
  }
}

function isTrustedSender(url: string, isDev: boolean): boolean {
  if (!url) return false
  if (isDev && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url)) return true
  if (url.startsWith('file://')) {
    try {
      const { pathname } = new URL(url)
      return pathname.endsWith('/renderer/index.html')
    } catch {
      return false
    }
  }
  return false
}
