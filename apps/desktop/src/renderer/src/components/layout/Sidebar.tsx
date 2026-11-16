import type React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  FolderOpen,
  Plus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-react'
import {
  IconAddProject,
  IconExplore,
  IconHome,
  IconNewChat,
  IconPlugins,
  IconScheduled,
  IconSidebarCollapse,
} from '../ui/codex-icons'
import { openProject } from '../../lib/actions'
import type { Session } from '@nexus/shared'
import { api, queryClient, qk, useAppStore, useT } from '../../kernel'
import { newSession } from '../../lib/actions'
import { Button, Dialog, Input, menuRow, popoverShell } from '../ui'

const RUNNING = new Set([
  'idle',
  'planning',
  'running',
  'waiting_tool',
  'waiting_approval',
  'retrying',
])

function relativeTime(value: number): string {
  const minutes = Math.round((Date.now() - value) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}p`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.round(days / 7)}w`
}

function ThreadRow({
  session,
  active,
  running,
  archived,
  onOpen,
  onMenu,
}: {
  session: Session
  active: boolean
  running: boolean
  archived?: boolean
  onOpen: () => void
  onMenu: (rect: DOMRect) => void
}): React.JSX.Element {
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onOpen}
        title={session.title}
        data-active={active}
        className="nav-row w-full pr-14 text-left text-[var(--text-faint)] hover:text-[var(--text)]"
      >
        {running ? (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--brand-accent)]" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{session.title}</span>
        {session.pinned ? (
          <Pin size={11} className="shrink-0 text-[var(--text-faint)]" aria-label="Đã ghim" />
        ) : null}
        {archived ? <Archive size={11} className="shrink-0 text-[var(--text-faint)]" /> : null}
      </button>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] tabular-nums text-[var(--text-faint)] opacity-100 transition-opacity group-hover/row:opacity-0">
        {relativeTime(session.updatedAt)}
      </span>
      <button
        type="button"
        aria-label="Tuỳ chọn hội thoại"
        onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}
        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const t = useT()
  const collapsed = useAppStore((state) => state.sidebarCollapsed)
  const width = useAppStore((state) => state.sidebarWidth)
  const route = useAppStore((state) => state.route)
  const navigate = useAppStore((state) => state.navigate)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const requestRename = useAppStore((state) => state.requestRename)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const setActiveProject = useAppStore((state) => state.setActiveProject)
  const toast = useAppStore((state) => state.toast)
  const [showArchived, setShowArchived] = useState(false)
  const [rowMenu, setRowMenu] = useState<{ session: Session; x: number; y: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pinned: true,
    projects: true,
    recents: true,
  })
  const [wsMenu, setWsMenu] = useState<{ id: string; label: string; x: number; y: number } | null>(
    null,
  )
  const [renameWorkspace, setRenameWorkspace] = useState<{ id: string; name: string } | null>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: qk.sessions({ archived: false }),
    queryFn: () => api.sessions.list({ archived: false }),
  })
  const { data: archivedSessions = [] } = useQuery({
    queryKey: qk.sessions({ archived: true }),
    queryFn: () => api.sessions.list({ archived: true }),
    enabled: showArchived,
  })
  const { data: projects = [] } = useQuery({
    queryKey: qk.projects,
    queryFn: () => api.projects.list(),
  })
  const { data: tasks = [] } = useQuery({
    queryKey: qk.tasks({ limit: 50 }),
    queryFn: () => api.tasks.list({ limit: 50 }),
    refetchInterval: 5000,
  })

  const runningSessions = useMemo(
    () => new Set(tasks.filter((task) => RUNNING.has(task.state)).map((task) => task.sessionId)),
    [tasks],
  )

  const recents = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      }),
    [sessions],
  )

  const saveWorkspaceName = async (): Promise<void> => {
    if (!renameWorkspace) return
    const name = renameWorkspace.name.trim()
    if (name) await api.projects.update(renameWorkspace.id, { name })
    setRenameWorkspace(null)
    await queryClient.invalidateQueries({ queryKey: qk.projects })
  }

  const dropWorkspace = async (id: string): Promise<void> => {
    setWsMenu(null)
    if (!id) return
    await api.projects.remove(id)
    if (useAppStore.getState().activeProjectId === id) useAppStore.getState().setActiveProject(null)
    await queryClient.invalidateQueries({ queryKey: qk.projects })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const open = (session: Session): void => {
    useAppStore.getState().openSession(session.id, session.projectId)
  }

  const openMenuFor = (session: Session, rect: DOMRect): void => {
    setRowMenu({
      session,
      x: Math.max(8, Math.min(rect.right - 180, window.innerWidth - 190)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 180),
    })
  }

  const togglePin = async (session: Session): Promise<void> => {
    setRowMenu(null)
    await api.sessions
      .update(session.id, { pinned: !session.pinned })
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không đổi được ghim', body: error.message }),
      )
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    await queryClient.invalidateQueries({ queryKey: qk.session(session.id) })
  }

  const toggleArchive = async (session: Session): Promise<void> => {
    setRowMenu(null)
    await api.sessions
      .update(session.id, { archived: !session.archived })
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không lưu trữ được', body: error.message }),
      )
    if (!session.archived && activeSessionId === session.id) {
      useAppStore.setState({ activeSessionId: null })
      navigate({ name: 'home' })
    }
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const renameSession = (session: Session): void => {
    setRowMenu(null)
    useAppStore.getState().openSession(session.id, session.projectId)
    requestRename(session.id)
  }

  const removeSession = async (session: Session): Promise<void> => {
    await api.sessions
      .remove(session.id)
      .catch((error: Error) =>
        toast({ level: 'error', title: 'Không xoá được hội thoại', body: error.message }),
      )
    setConfirmDelete(null)
    if (activeSessionId === session.id) {
      useAppStore.setState({ activeSessionId: null })
      navigate({ name: 'home' })
    }
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  if (collapsed) return <></>

  const openSection = (id: string): boolean => openSections[id] !== false
  const toggleSection = (id: string): void =>
    setOpenSections((current) => ({ ...current, [id]: !openSection(id) }))

  const pinned = recents.filter((item) => item.pinned)
  const recent = recents.filter((item) => !item.pinned)

  return (
    <aside
      style={{ width }}
      className="flex min-h-0 shrink-0 flex-row overflow-hidden bg-[var(--bg-sidebar)]"
    >
      {/* ── Rail icon trái, 52px — giống Codex ─────────────────────────── */}
      <nav
        aria-label="App navigation"
        className="flex w-[52px] shrink-0 select-none flex-col items-center gap-1 px-2 pb-2 pt-2"
      >
        <button
          type="button"
          onClick={() => navigate({ name: 'home' })}
          aria-label="Home"
          title="Home"
          data-active={route.name === 'home'}
          className="rail-btn"
        >
          <IconHome size={19} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: 'scheduled' })}
          aria-label="Scheduled"
          title="Scheduled"
          data-active={route.name === 'scheduled'}
          className="rail-btn"
        >
          <IconScheduled size={19} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: 'plugins' })}
          aria-label="Plugins"
          title="Plugins"
          data-active={route.name === 'plugins'}
          className="rail-btn"
        >
          <IconPlugins size={19} />
        </button>
        <button
          type="button"
          onClick={() => navigate({ name: 'settings' })}
          aria-label="Explore"
          title="Explore"
          data-active={route.name === 'settings'}
          className="rail-btn"
        >
          <IconExplore size={19} />
        </button>
        <div className="min-h-0 flex-1" />
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="rail-btn"
        >
          <IconSidebarCollapse size={19} />
        </button>
      </nav>

      {/* ── Panel 340px: New chat + Pinned / Projects / Recents ───────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 pt-2">
          <button
            type="button"
            onClick={() => void newSession()}
            className="nav-row w-full font-[430] text-[var(--text)]"
          >
            <IconNewChat size={17} className="shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-left">New chat</span>
          </button>

          {pinned.length > 0 || route.name !== 'home' ? (
            <>
              <div className="nav-section-title group/section mt-1">
                <button
                  type="button"
                  role="button"
                  aria-expanded={openSection('pinned')}
                  onClick={() => toggleSection('pinned')}
                  className="-ms-1 flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-1 py-0.5 text-start"
                >
                  <span className="min-w-0 truncate">Pinned</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    aria-hidden
                    className={`shrink-0 transition-transform ${openSection('pinned') ? 'rotate-0' : '-rotate-90'}`}
                    fill="currentColor"
                  >
                    <path d="M15.3 7.7a1.1 1.1 0 0 0 0 1.6L9.5 15.1a1.1 1.1 0 0 1-1.6 0L2.3 9.3a1.1 1.1 0 0 1 1.6-1.6L9 12.8l5.7-5.1a1.1 1.1 0 0 1 .6 0z" />
                  </svg>
                </button>
              </div>
              {openSection('pinned')
                ? pinned.map((session) => (
                    <ThreadRow
                      key={session.id}
                      session={session}
                      active={activeSessionId === session.id && route.name !== 'home'}
                      running={runningSessions.has(session.id)}
                      onOpen={() => open(session)}
                      onMenu={(rect) => openMenuFor(session, rect)}
                    />
                  ))
                : null}
            </>
          ) : null}

          <div className="nav-section-title group/section mt-2">
            <button
              type="button"
              role="button"
              aria-expanded={openSection('projects')}
              onClick={() => toggleSection('projects')}
              className="-ms-1 flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-1 py-0.5 text-start"
            >
              <span className="min-w-0 truncate">Projects</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                aria-hidden
                className={`shrink-0 transition-transform ${openSection('projects') ? 'rotate-0' : '-rotate-90'}`}
                fill="currentColor"
              >
                <path d="M15.3 7.7a1.1 1.1 0 0 0 0 1.6L9.5 15.1a1.1 1.1 0 0 1-1.6 0L2.3 9.3a1.1 1.1 0 0 1 1.6-1.6L9 12.8l5.7-5.1a1.1 1.1 0 0 1 .6 0z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Add new project"
              onClick={() => void openProject()}
              className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover/section:opacity-100 focus-visible:opacity-100"
            >
              <IconAddProject size={14} />
            </button>
          </div>
          {openSection('projects') ? (
            projects.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[13px] text-[var(--text-faint)] opacity-60">
                No projects
              </p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveProject(project.id)
                      navigate({ name: 'home' })
                    }}
                    data-active={activeProjectId === project.id}
                    className="nav-row w-full pr-12 text-left"
                  >
                    <FolderOpen size={15} className="shrink-0 text-[var(--text-faint)]" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Tuỳ chọn dự án ${project.name}`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect()
                      setWsMenu({
                        id: project.id,
                        label: project.name,
                        x: rect.right - 200,
                        y: rect.bottom + 4,
                      })
                    }}
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-faint)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover/row:opacity-100"
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              ))
            )
          ) : null}

          <div className="nav-section-title group/section mt-2">
            <button
              type="button"
              role="button"
              aria-expanded={openSection('recents')}
              onClick={() => toggleSection('recents')}
              className="-ms-1 flex min-w-0 flex-1 items-center gap-1 rounded-[10px] px-1 py-0.5 text-start"
            >
              <span className="min-w-0 truncate">Recents</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                aria-hidden
                className={`shrink-0 transition-transform ${openSection('recents') ? 'rotate-0' : '-rotate-90'}`}
                fill="currentColor"
              >
                <path d="M15.3 7.7a1.1 1.1 0 0 0 0 1.6L9.5 15.1a1.1 1.1 0 0 1-1.6 0L2.3 9.3a1.1 1.1 0 0 1 1.6-1.6L9 12.8l5.7-5.1a1.1 1.1 0 0 1 .6 0z" />
              </svg>
            </button>
          </div>
          {openSection('recents') ? (
            recent.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[13px] text-[var(--text-faint)] opacity-60">
                No chats yet
              </p>
            ) : (
              recent.map((session) => (
                <ThreadRow
                  key={session.id}
                  session={session}
                  active={activeSessionId === session.id && route.name !== 'home'}
                  running={runningSessions.has(session.id)}
                  onOpen={() => open(session)}
                  onMenu={(rect) => openMenuFor(session, rect)}
                />
              ))
            )
          ) : null}

          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="nav-row mt-2 w-full text-left"
          >
            <Archive size={15} className="shrink-0 text-[var(--text-faint)]" />
            <span className="min-w-0 flex-1 truncate">
              {showArchived ? 'Ẩn lưu trữ' : 'Archived'}
            </span>
          </button>
          {showArchived
            ? archivedSessions.map((session) => (
                <ThreadRow
                  key={session.id}
                  session={session}
                  archived
                  active={false}
                  running={false}
                  onOpen={() => open(session)}
                  onMenu={(rect) => openMenuFor(session, rect)}
                />
              ))
            : null}
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] px-2 pb-2 pt-1.5">
          <button
            type="button"
            onClick={() => navigate({ name: 'settings' })}
            aria-label="Tài khoản"
            className="flex w-full items-center gap-2 rounded-[var(--radius)] px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-inset)] text-[12px] font-medium text-[var(--text-muted)]">
              N
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] leading-[18px] text-[var(--text)]">
                NEXUS
              </span>
              <span className="block truncate text-[11.5px] leading-[15px] text-[var(--text-faint)]">
                Local · Free
              </span>
            </span>
            <svg
              viewBox="0 0 16 16"
              width={12}
              height={12}
              fill="currentColor"
              aria-hidden
              className="shrink-0 text-[var(--text-faint)]"
            >
              <path d="M8 10.5 3.8 6.3l1-1L8 8.5l3.2-3.2 1 1z" />
            </svg>
          </button>
        </div>
      </div>

      {wsMenu ? (
        <>
          <button
            type="button"
            aria-label="Đóng menu workspace"
            className="fixed inset-0 z-[55] cursor-default"
            onClick={() => setWsMenu(null)}
          />
          <div
            style={{ left: wsMenu.x, top: wsMenu.y }}
            className={cnPopover('fixed z-[60] w-[200px]')}
          >
            <button
              type="button"
              onClick={() => {
                const id = wsMenu.id
                setWsMenu(null)
                void newSession({ projectId: id })
              }}
              className={menuRow}
            >
              <Plus size={13} />
              Hội thoại mới
            </button>
            <button
              type="button"
              onClick={() => {
                useAppStore.getState().setActiveProject(wsMenu.id)
                setWsMenu(null)
                toast({ level: 'success', title: `Workspace hiện tại: ${wsMenu.label}` })
              }}
              className={menuRow}
            >
              <FolderOpen size={13} />
              Dùng làm hiện tại
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameWorkspace({ id: wsMenu.id, name: wsMenu.label })
                setWsMenu(null)
              }}
              className={menuRow}
            >
              <Pencil size={13} />
              Đổi tên
            </button>
            <button
              type="button"
              onClick={() => void dropWorkspace(wsMenu.id)}
              className={cnPopover(menuRow, 'text-[var(--danger)] hover:bg-[var(--danger)]/10')}
            >
              <Trash2 size={13} />
              Xoá workspace
            </button>
          </div>
        </>
      ) : null}

      {renameWorkspace ? (
        <Dialog
          open
          title="Đổi tên workspace"
          onOpenChange={() => setRenameWorkspace(null)}
          footer={
            <>
              <Button onClick={() => setRenameWorkspace(null)}>Huỷ</Button>
              <Button variant="primary" onClick={() => void saveWorkspaceName()}>
                Lưu
              </Button>
            </>
          }
        >
          <Input
            autoFocus
            value={renameWorkspace.name}
            onChange={(event) =>
              setRenameWorkspace((current) =>
                current ? { ...current, name: event.target.value } : current,
              )
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveWorkspaceName()
            }}
          />
        </Dialog>
      ) : null}

      {rowMenu ? (
        <>
          <button
            type="button"
            aria-label="Đóng menu hội thoại"
            className="fixed inset-0 z-[55] cursor-default"
            onClick={() => setRowMenu(null)}
          />
          <div
            style={{ left: rowMenu.x, top: rowMenu.y }}
            className={cnPopover('fixed z-[60] w-[180px]')}
          >
            <button
              type="button"
              onClick={() => void togglePin(rowMenu.session)}
              className={menuRow}
            >
              {rowMenu.session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              {rowMenu.session.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
            </button>
            <button
              type="button"
              onClick={() => renameSession(rowMenu.session)}
              className={menuRow}
            >
              <Pencil size={13} />
              Đổi tên
            </button>
            <button
              type="button"
              onClick={() => void toggleArchive(rowMenu.session)}
              className={menuRow}
            >
              {rowMenu.session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {rowMenu.session.archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(rowMenu.session)
                setRowMenu(null)
              }}
              className={cnPopover(menuRow, 'text-[var(--danger)] hover:bg-[var(--danger)]/10')}
            >
              <Trash2 size={13} />
              Xoá
            </button>
          </div>
        </>
      ) : null}

      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null)
        }}
        title="Xoá hội thoại này?"
        description={
          confirmDelete
            ? `“${confirmDelete.title}” cùng toàn bộ tin nhắn, tác vụ và thay đổi tệp sẽ bị xoá. Không thể hoàn tác.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={() => {
                if (confirmDelete) void removeSession(confirmDelete)
              }}
            >
              Xoá
            </Button>
          </>
        }
      />
    </aside>
  )
}
function cnPopover(...parts: Array<string | undefined | false>): string {
  return [popoverShell, ...parts.filter(Boolean)].join(' ')
}
