import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog, nativeTheme, Notification, session } from 'electron'
import { EventBus, type NexusEvent, type NexusEventEnvelope } from '@nexus/shared'
import { logger } from './logger'
import { CoreClient } from './core-client'
import { registerIpc } from './ipc'
import { installMenu } from './menu'
import { createMainWindow, broadcast, allWindows, focusMainWindow } from './window'

const isDev = !app.isPackaged
let core: CoreClient | null = null
let events: EventBus | null = null
let notificationsEnabled = true
let shuttingDown = false

app.setName('NEXUS Desktop')
if (process.env.NEXUS_USER_DATA) {
  app.setPath('userData', process.env.NEXUS_USER_DATA)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
  bootstrap()
}

function bootstrap(): void {
  if (process.platform === 'win32') app.setAppUserModelId('com.nexus.desktop')

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!shuttingDown && allWindows().length === 0 && app.isReady()) createWindow()
  })

  app.on('before-quit', () => {
    shutdown()
  })

  process.on('uncaughtException', (error) => {
    if (error.message.includes('EPIPE')) return
    logger.error('uncaught exception', { message: error.message, stack: error.stack })
    if (app.isReady() && !shuttingDown) {
      dialog.showErrorBox(
        'NEXUS Desktop — unexpected error',
        `${error.message}\n\nLog: ${logger.path()}`,
      )
    }
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', reason instanceof Error ? reason.message : String(reason))
  })

  app
    .whenReady()
    .then(() => setup())
    .catch((error) => {
      logger.error('startup failed', error instanceof Error ? error.message : String(error))
      dialog.showErrorBox(
        'NEXUS Desktop — startup failed',
        `${error instanceof Error ? error.message : String(error)}\n\nLog: ${logger.path()}`,
      )
      app.quit()
    })
}

async function setup(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const databasePath = join(userDataPath, 'nexus.db')
  const bus = new EventBus()
  events = bus

  const client = new CoreClient({
    databasePath,
    userDataPath,
    version: app.getVersion(),
    isDev,
  })
  await client.start()
  core = client

  client.onEvent((event) => {
    bus.emit(event as NexusEvent)
  })

  try {
    const settings = await client.request<Record<string, unknown>>('settings.all')
    const theme = settings['appearance.theme']
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      nativeTheme.themeSource = theme
    }
    notificationsEnabled = settings['notifications.native'] !== false
    logger.info('core ready', { databasePath })
  } catch (error) {
    logger.warn('cannot load initial settings', {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  registerIpc({
    core: client,
    userDataPath,
    databasePath,
    isDev,
    onSettingChanged: (key, value) => {
      if (key === 'notifications.native') notificationsEnabled = value !== false
    },
    popoutWindow: (sessionId) => createWindow(sessionId),
  })

  installMenu(bus, isDev)
  installCsp(isDev)
  forwardEvents(bus)
  createWindow()

  logger.info('NEXUS Desktop ready', {
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    core: 'typescript',
  })
}

function createWindow(sessionId?: string): void {
  if (!events) return
  const iconPath = join(__dirname, '../renderer/icon.png')
  createMainWindow(
    {
      isDev,
      events,
      preloadPath: join(__dirname, '../preload/index.js'),
      ...(existsSync(iconPath) ? { iconPath } : {}),
    },
    { ...(sessionId ? { sessionId } : {}) },
  )
}

function forwardEvents(bus: EventBus): void {
  let seq = 0
  bus.on((event: NexusEvent) => {
    seq += 1
    const envelope: NexusEventEnvelope = {
      id: `${Date.now()}-${seq}`,
      seq,
      ts: Date.now(),
      event,
    }
    broadcast(envelope)
    if (event.type === 'notification') {
      const payload = event.payload as { title?: string; body?: string; level?: string }
      const focused = allWindows().some((win) => win.isFocused())
      if (notificationsEnabled && !focused && Notification.isSupported()) {
        const notification = new Notification({
          title: payload.title ?? 'NEXUS Desktop',
          body: payload.body ?? '',
          urgency: payload.level === 'error' ? 'critical' : 'normal',
        })
        notification.on('click', () => focusMainWindow())
        notification.show()
      }
    }
    if (event.type === 'app.ready') {
      logger.info('renderer ready')
    }
  })
}

function installCsp(dev: boolean): void {
  const csp = dev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*; worker-src 'self' blob:; object-src 'none'; base-uri 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
      },
    })
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications'])
    callback(allowed.has(permission))
  })
}

function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  try {
    core?.stop()
  } catch (error) {
    logger.warn('native core shutdown error', String(error))
  }
  logger.info('shutdown complete')
}
