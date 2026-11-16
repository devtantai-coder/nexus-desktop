import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import type {
  AgentMode,
  AppInfo,
  ApprovalRequest,
  Language,
  PermissionMode,
  TranslationKey,
} from '@nexus/shared'
import { translations } from '@nexus/shared'
import { api } from '../lib/api'

export type RouteName =
  | 'home'
  | 'chat'
  | 'scheduled'
  | 'plugins'
  | 'projects'
  | 'harness'
  | 'agents'
  | 'sessions'
  | 'history'
  | 'settings'
  | 'models'

export interface Route {
  name: RouteName
  sessionId?: string
  projectId?: string
  section?: string
}

export interface ToastItem {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  body?: string
}

export interface LoopTick {
  iteration: number
  toolCalls: number
  elapsedMs: number
  contextTokens: number
}

export interface LiveMessage {
  messageId: string
  sessionId: string
  content: string
  reasoning: string
  startedAt: number
}

export type ThemeMode = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'comfortable'

interface AppState {
  ready: boolean
  info: AppInfo | null
  settings: Record<string, unknown>
  theme: ThemeMode
  accent: string | null
  fontSize: number
  density: Density
  language: Language
  route: Route
  activeProjectId: string | null
  activeSessionId: string | null
  activeTaskId: string | null
  sidebarCollapsed: boolean
  sidebarWidth: number
  composerFocusAt: number
  renameRequestId: string | null
  toasts: ToastItem[]
  approvals: ApprovalRequest[]
  live: Record<string, LiveMessage>
  steerQueue: Record<string, number>
  loopTicks: Record<string, LoopTick>
  sendingSessionId: string | null
  setApprovals: (approvals: ApprovalRequest[]) => void
  init: () => Promise<void>
  setTheme: (theme: ThemeMode) => void
  setAccent: (accent: string | null) => void
  setFontSize: (size: number) => void
  setDensity: (density: Density) => void
  setLanguage: (language: Language) => void
  setSetting: (key: string, value: unknown) => void
  navigate: (route: Route) => void
  openSession: (sessionId: string, projectId?: string) => void
  /** Tab đang mở (thanh tab kiểu Codex). */
  openTabs: string[]
  closeTab: (sessionId: string) => void
  setActiveProject: (projectId: string | null) => void
  setActiveTask: (taskId: string | null) => void
  setSidebarWidth: (width: number) => void
  toggleSidebar: () => void
  focusComposer: () => void
  /** Prompt của lượt vừa hoàn nguyên, dùng cho `/redo`. */
  undonePrompt: string | null
  setUndonePrompt: (prompt: string | null) => void
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  /** Yêu cầu nhét văn bản vào composer, ví dụ khi chọn lệnh trong bảng lệnh. */
  draftRequest: { text: string; at: number } | null
  setDraftRequest: (text: string) => void
  requestRename: (sessionId: string) => void
  clearRenameRequest: () => void
  toast: (toast: Omit<ToastItem, 'id'> & { id?: string }) => void
  dismissToast: (id: string) => void
  pushApproval: (approval: ApprovalRequest) => void
  removeApproval: (id: string) => void
  startLive: (messageId: string, sessionId: string) => void
  appendLive: (messageId: string, delta: string, kind: 'text' | 'reasoning') => void
  finishLive: (messageId: string, content?: string) => void
  clearLive: (messageId: string) => void
  bumpSteer: (taskId: string, delta: number) => void
  clearSteer: (taskId: string) => void
  setSendingSession: (sessionId: string | null) => void
  setLoopTick: (taskId: string, tick: LoopTick) => void
  clearLoopTick: (taskId: string) => void
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min

let mediaQuery: MediaQueryList | null = null

function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyAppearance(state: {
  theme: ThemeMode
  accent: string | null
  fontSize: number
  density: Density
}): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(state.theme)
  root.dataset.density = state.density
  root.style.setProperty('--font-size-base', `${state.fontSize}px`)
  root.style.removeProperty('--accent')
  root.style.removeProperty('--accent-soft')
  root.style.removeProperty('--accent-contrast')
}

let settingsTimer: NodeJS.Timeout | null = null
const pendingSettings = new Map<string, unknown>()

function persistSetting(key: string, value: unknown): void {
  pendingSettings.set(key, value)
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    const entries = [...pendingSettings.entries()]
    pendingSettings.clear()
    for (const [entryKey, entryValue] of entries) {
      void api.settings.set(entryKey, entryValue).catch(() => undefined)
    }
  }, 250)
}

type LiveFlushSet = (partial: Partial<AppState>) => void
type LiveFlushGet = () => AppState
interface PendingLive {
  sessionId: string
  content: string
  reasoning: string
}
const pendingLive = new Map<string, PendingLive>()
let liveFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushPendingLive(set: LiveFlushSet, get: LiveFlushGet): void {
  if (liveFlushTimer) {
    clearTimeout(liveFlushTimer)
    liveFlushTimer = null
  }
  if (pendingLive.size === 0) return
  const next = { ...get().live }
  for (const [messageId, pending] of pendingLive) {
    const current = next[messageId]
    if (current) {
      next[messageId] = {
        ...current,
        content: current.content + pending.content,
        reasoning: current.reasoning + pending.reasoning,
      }
    } else {
      next[messageId] = {
        messageId,
        sessionId: pending.sessionId,
        content: pending.content,
        reasoning: pending.reasoning,
        startedAt: Date.now(),
      }
    }
  }
  pendingLive.clear()
  set({ live: next })
}

function queueLiveFlush(set: LiveFlushSet, get: LiveFlushGet): void {
  if (liveFlushTimer) return
  liveFlushTimer = setTimeout(() => {
    liveFlushTimer = null
    flushPendingLive(set, get)
  }, 16)
}

export function createAppStore(): UseBoundStore<StoreApi<AppState>> {
  return create<AppState>((set, get) => ({
    ready: false,
    info: null,
    settings: {},
    theme: 'light',
    accent: null,
    fontSize: 16,
    density: 'comfortable',
    language: 'vi',
    route: { name: 'home' },
    activeProjectId: null,
    activeSessionId: null,
    activeTaskId: null,
    sidebarCollapsed: false,
    openTabs: [],
    sidebarWidth: 340,
    paletteOpen: false,
    draftRequest: null,
    composerFocusAt: 0,
    renameRequestId: null,
    toasts: [],
    approvals: [],
    live: {},
    steerQueue: {},
    loopTicks: {},
    sendingSessionId: null,

    setApprovals: (approvals) => set({ approvals }),

    async init() {
      try {
        const [info, settings] = await Promise.all([api.app.info(), api.settings.all()])
        const theme = (settings['appearance.theme'] as ThemeMode) ?? 'light'
        const accent = null
        const fontSize = Number(settings['appearance.fontSize'] ?? 16)
        const density = (settings['appearance.density'] as Density) ?? 'comfortable'
        const language = (settings['language.locale'] as Language) ?? 'vi'
        // Giá trị lưu cũ dưới 260px là từ bản dock hẹp — bỏ qua, dùng mặc định rộng hơn.
        const savedWidth = Number(settings['panels.sidebarWidth'] ?? 0)
        const sidebarWidth = savedWidth >= 260 ? clamp(savedWidth, 260, 420) : 340
        const sidebarCollapsed = Boolean(settings['panels.sidebarCollapsed'] ?? false)
        const activeProjectId =
          typeof settings['workspace.activeProjectId'] === 'string'
            ? (settings['workspace.activeProjectId'] as string)
            : null
        set({
          ready: true,
          info,
          settings,
          theme,
          accent,
          fontSize,
          density,
          language,
          sidebarWidth,
          sidebarCollapsed,
          activeProjectId,
        })
        applyAppearance({ theme, accent, fontSize, density })
        if (mediaQuery) mediaQuery.removeEventListener('change', onMediaChange)
        mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        mediaQuery.addEventListener('change', onMediaChange)
      } catch {
        set({ ready: true })
      }
    },

    setTheme(theme) {
      set({ theme })
      applyAppearance({ ...get(), theme })
      persistSetting('appearance.theme', theme)
      void api.app.setNativeTheme(theme).catch(() => undefined)
      void api.settings.set('appearance.theme', theme).catch(() => undefined)
    },
    setAccent(accent) {
      set({ accent })
      applyAppearance({ ...get(), accent })
      void api.settings.set('appearance.accent', accent).catch(() => undefined)
    },
    setFontSize(fontSize) {
      const value = clamp(fontSize, 12, 18)
      set({ fontSize: value })
      applyAppearance({ ...get(), fontSize: value })
      persistSetting('appearance.fontSize', value)
    },
    setDensity(density) {
      set({ density })
      applyAppearance({ ...get(), density })
      void api.settings.set('appearance.density', density).catch(() => undefined)
    },
    setLanguage(language) {
      set({ language })
      document.documentElement.lang = language
      void api.settings.set('language.locale', language).catch(() => undefined)
    },
    setSetting(key, value) {
      set({ settings: { ...get().settings, [key]: value } })
      persistSetting(key, value)
    },
    navigate(route) {
      set({ route })
    },
    openSession(sessionId, projectId) {
      set((state) => ({
        activeSessionId: sessionId,
        ...(projectId ? { activeProjectId: projectId } : {}),
        openTabs: state.openTabs.includes(sessionId)
          ? state.openTabs
          : [...state.openTabs, sessionId].slice(-8),
        route: { name: 'chat', sessionId },
      }))
      if (projectId) persistSetting('workspace.activeProjectId', projectId)
    },
    closeTab(sessionId) {
      set((state) => {
        const openTabs = state.openTabs.filter((id) => id !== sessionId)
        const stillOpen = state.route.name === 'chat' && state.route.sessionId === sessionId
        const nextId = openTabs[openTabs.length - 1]
        return {
          openTabs,
          ...(stillOpen
            ? nextId
              ? { activeSessionId: nextId, route: { name: 'chat' as const, sessionId: nextId } }
              : { activeSessionId: null, route: { name: 'home' as const } }
            : {}),
        }
      })
    },
    setActiveProject(projectId) {
      set({ activeProjectId: projectId })
      persistSetting('workspace.activeProjectId', projectId)
    },
    setActiveTask(taskId) {
      set({ activeTaskId: taskId })
    },
    setSidebarWidth(width) {
      const value = clamp(width, 260, 420)
      set({ sidebarWidth: value })
      persistSetting('panels.sidebarWidth', value)
    },
    toggleSidebar() {
      const collapsed = !get().sidebarCollapsed
      set({ sidebarCollapsed: collapsed })
      void api.settings.set('panels.sidebarCollapsed', collapsed).catch(() => undefined)
    },
    focusComposer() {
      set({ composerFocusAt: Date.now() })
    },
    undonePrompt: null,
    setUndonePrompt(prompt) {
      set({ undonePrompt: prompt })
    },
    setPaletteOpen(paletteOpen) {
      set({ paletteOpen })
    },
    setDraftRequest(text) {
      set({ draftRequest: { text, at: Date.now() }, paletteOpen: false })
    },
    requestRename(sessionId) {
      set({ renameRequestId: sessionId })
    },
    clearRenameRequest() {
      set({ renameRequestId: null })
    },
    toast(toast) {
      const id = toast.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
      set({ toasts: [...get().toasts, { ...toast, id }].slice(-5) })
      const ttl = toast.level === 'error' ? 9000 : 5000
      setTimeout(() => get().dismissToast(id), ttl)
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
    },
    pushApproval(approval) {
      if (get().approvals.some((entry) => entry.id === approval.id)) return
      set({ approvals: [...get().approvals, approval] })
    },
    removeApproval(id) {
      set({ approvals: get().approvals.filter((entry) => entry.id !== id) })
    },
    startLive(messageId, sessionId) {
      pendingLive.delete(messageId)
      set({
        live: {
          ...get().live,
          [messageId]: { messageId, sessionId, content: '', reasoning: '', startedAt: Date.now() },
        },
      })
    },
    appendLive(messageId, delta, kind) {
      const current = get().live[messageId]
      if (!current) {
        set({
          live: {
            ...get().live,
            [messageId]: {
              messageId,
              sessionId: '',
              content: '',
              reasoning: '',
              startedAt: Date.now(),
            },
          },
        })
      }
      const sessionId = get().live[messageId]?.sessionId ?? ''
      let pending = pendingLive.get(messageId)
      if (!pending) {
        pending = { sessionId, content: '', reasoning: '' }
        pendingLive.set(messageId, pending)
      }
      if (kind === 'text') pending.content += delta
      else pending.reasoning += delta
      queueLiveFlush(set, get)
    },
    finishLive(messageId, content) {
      flushPendingLive(set, get)
      const current = get().live[messageId]
      if (!current) return
      set({
        live: {
          ...get().live,
          [messageId]: { ...current, content: content ?? current.content },
        },
      })
    },
    clearLive(messageId) {
      pendingLive.delete(messageId)
      const next = { ...get().live }
      delete next[messageId]
      set({ live: next })
    },
    bumpSteer(taskId, delta) {
      const current = get().steerQueue[taskId] ?? 0
      const next = Math.max(0, current + delta)
      const steerQueue = { ...get().steerQueue }
      if (next === 0) delete steerQueue[taskId]
      else steerQueue[taskId] = next
      set({ steerQueue })
    },
    setSendingSession(sessionId) {
      set({ sendingSessionId: sessionId })
    },
    setLoopTick(taskId, tick) {
      set({ loopTicks: { ...get().loopTicks, [taskId]: tick } })
    },
    clearLoopTick(taskId) {
      const loopTicks = { ...get().loopTicks }
      delete loopTicks[taskId]
      set({ loopTicks })
    },
    clearSteer(taskId) {
      const steerQueue = { ...get().steerQueue }
      delete steerQueue[taskId]
      set({ steerQueue })
    },
  }))
}

export const useAppStore = createAppStore()

function onMediaChange(): void {
  applyAppearance(useAppStore.getState())
}

export function useT(): (key: TranslationKey) => string {
  const language = useAppStore((state) => state.language)
  return (key: TranslationKey) => translations[language][key] ?? key
}

export function translate(language: Language, key: TranslationKey, fallback?: string): string {
  return translations[language][key] ?? fallback ?? key
}

export type { AgentMode, PermissionMode }
