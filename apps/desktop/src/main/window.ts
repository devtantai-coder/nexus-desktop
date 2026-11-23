import { join } from 'node:path'
import { BrowserWindow, nativeTheme, shell, app } from 'electron'
import { EVENT_CHANNEL, WINDOW_STATE_CHANNEL } from '@nexus/shared'
import type { EventBus, NexusEventEnvelope } from '@nexus/shared'
import { logger } from './logger'

export interface WindowDeps {
  isDev: boolean
  events: EventBus
  iconPath?: string
  preloadPath: string
}

const windows = new Set<BrowserWindow>()

function isRendererUrl(url: string, isDev: boolean, devUrl?: string): boolean {
  if (isDev && devUrl && url.startsWith(devUrl)) return true
  if (url.startsWith('file://')) {
    try {
      return new URL(url).pathname.endsWith('/renderer/index.html')
    } catch {
      return false
    }
  }
  return false
}

export function allWindows(): BrowserWindow[] {
  return [...windows]
}

export function broadcast(event: NexusEventEnvelope): void {
  for (const win of windows) {
    if (win.isDestroyed()) continue
    win.webContents.send(EVENT_CHANNEL, event)
  }
}

export function createMainWindow(
  deps: WindowDeps,
  options: { sessionId?: string } = {},
): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    backgroundColor: dark ? '#0b0b0b' : '#ffffff',
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 18 } : undefined,
    ...(deps.iconPath ? { icon: deps.iconPath } : {}),
    webPreferences: {
      preload: deps.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      devTools: deps.isDev,
      additionalArguments: [],
    },
  })
  windows.add(win)
  win.on('closed', () => windows.delete(win))

  const sendState = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send(WINDOW_STATE_CHANNEL, {
      maximized: win.isMaximized(),
      focused: win.isFocused(),
    })
  }
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)
  win.on('enter-full-screen', sendState)
  win.on('leave-full-screen', sendState)
  win.on('focus', sendState)
  win.on('blur', sendState)

  let shown = false
  const showOnce = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
    win.focus()
    sendState()
  }
  win.once('ready-to-show', showOnce)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    const allowed = isRendererUrl(url, Boolean(deps.isDev && rendererUrl), rendererUrl)
    if (!allowed) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || details.exitCode === 0) {
      logger.info('renderer process closed', details)
    } else {
      logger.error('renderer process gone', details)
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const query = options.sessionId ? `?session=${encodeURIComponent(options.sessionId)}` : ''
  if (deps.isDev && rendererUrl) {
    void win.loadURL(`${rendererUrl}${query}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      ...(options.sessionId ? { search: query.slice(1) } : {}),
    })
  }

  win.webContents.once('did-finish-load', () => {
    // Giữ fallback show cho trường hợp ready-to-show không fire; showOnce chặn show 2 lần.
    showOnce()
    deps.events.emit({ type: 'app.ready', payload: { version: app.getVersion() } })
  })

  return win
}

export function focusMainWindow(): void {
  const existing = allWindows()[0]
  if (!existing) return
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
}
