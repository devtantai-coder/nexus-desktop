import type React from 'react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { api, useAppStore } from './kernel'
import { CommandPalette } from './components/layout/CommandPalette'
import { Sidebar } from './components/layout/Sidebar'
import { TerminalPanel } from './components/layout/TerminalPanel'
import { TabStrip } from './components/layout/TabStrip'
import { ApplicationMenuBar } from './components/layout/ApplicationMenuBar'
import { Toasts, TooltipProvider, Spinner } from './components/ui'
import { ApprovalDialog } from './components/ApprovalDialog'
import { MiniPet } from './components/pets/MiniPet'
import { HomePage } from './pages/HomePage'
import { newSession } from './lib/actions'
import { tickSchedules } from './lib/schedules'

const DomainPage = lazy(() =>
  import('./pages/DomainPage').then((module) => ({ default: module.DomainPage })),
)
const ChatPage = lazy(() =>
  import('./pages/ChatPage').then((module) => ({ default: module.ChatPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const ScheduledPage = lazy(() =>
  import('./pages/ScheduledPage').then((module) => ({ default: module.ScheduledPage })),
)
const PluginsPage = lazy(() =>
  import('./pages/PluginsPage').then((module) => ({ default: module.PluginsPage })),
)

function usePreventSleep(): void {
  const enabled = useAppStore((state) => state.settings['app.preventSleep'] === true)
  useEffect(() => {
    void api.setPreventSleep(enabled)
  }, [enabled])
}

function useScheduleTicker(): void {
  useEffect(() => {
    void tickSchedules()
    const timer = setInterval(() => void tickSchedules(), 30_000)
    return () => clearInterval(timer)
  }, [])
}

function useGlobalShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const store = useAppStore.getState()
      const key = event.key.toLowerCase()
      if (key === 'n' && !event.shiftKey) {
        event.preventDefault()
        void newSession()
      } else if (key === ',') {
        event.preventDefault()
        store.navigate({ name: 'settings' })
      } else if (key === 'b') {
        event.preventDefault()
        store.toggleSidebar()
      } else if (
        key === 'p' &&
        event.shiftKey &&
        store.settings['app.popoutHotkey'] !== 'off' &&
        store.route.name === 'chat' &&
        store.route.sessionId
      ) {
        event.preventDefault()
        void api.popout(store.route.sessionId)
      } else if (key === 'j') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('nexus:toggle-bottom-panel'))
      } else if (key === 'k' || (key === 'p' && event.shiftKey)) {
        event.preventDefault()
        store.setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

function Page(): React.JSX.Element {
  const route = useAppStore((state) => state.route)
  switch (route.name) {
    case 'settings':
      return <SettingsPage />
    case 'home':
      return <HomePage />
    case 'domain':
      return <DomainPage />
    case 'scheduled':
      return <ScheduledPage />
    case 'plugins':
      return <PluginsPage />
    default:
      return <ChatPage />
  }
}

function SidebarResizer(): React.JSX.Element {
  const width = useAppStore((state) => state.sidebarWidth)
  const setWidth = useAppStore((state) => state.setSidebarWidth)
  const collapsed = useAppStore((state) => state.sidebarCollapsed)

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      const onMove = (moveEvent: MouseEvent): void => {
        setWidth(startWidth + (moveEvent.clientX - startX))
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setWidth, width],
  )

  if (collapsed) return <></>
  return (
    <div
      role="separator"
      aria-label="Resize sidebar"
      onMouseDown={onMouseDown}
      className="group relative z-20 -mr-[3px] w-[6px] shrink-0 cursor-col-resize"
    >
      <div className="absolute left-[2px] top-0 h-full w-px bg-transparent transition-colors group-hover:bg-[var(--border-strong)]" />
    </div>
  )
}

export function App(): React.JSX.Element {
  const ready = useAppStore((state) => state.ready)
  const [bottomOpen, setBottomOpen] = useState(false)
  const routeName = useAppStore((state) => state.route.name)
  useGlobalShortcuts()
  useScheduleTicker()
  usePreventSleep()

  useEffect(() => {
    const toggle = (): void => setBottomOpen((open) => !open)
    window.addEventListener('nexus:toggle-bottom-panel', toggle)
    return () => window.removeEventListener('nexus:toggle-bottom-panel', toggle)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg)]">
        <Spinner size={20} />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-[var(--bg)] text-[var(--text)]">
        <ApplicationMenuBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar railOnly={routeName === 'settings'} />
          {routeName === 'settings' ? null : <SidebarResizer />}
          <main className="main-panel flex min-w-0 flex-1 flex-col overflow-hidden">
            <TabStrip />
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              <div key={routeName} className="animate-fade-in h-full">
                <Page />
              </div>
            </Suspense>
            {bottomOpen ? <TerminalPanel onClose={() => setBottomOpen(false)} /> : null}
          </main>
        </div>
      </div>
      <CommandPalette />
      <ApprovalDialog />
      <Toasts />
      <MiniPet />
    </TooltipProvider>
  )
}
