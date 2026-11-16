import type React from 'react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  ClipboardCopy,
  History,
  ExternalLink,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
import type { AgentMode, Message } from '@nexus/shared'
import { api, queryClient, qk, useAppStore, useT } from '../kernel'
import { newSession } from '../lib/actions'
import { FolderClosed } from 'lucide-react'
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Spinner,
  cn,
  menuRow,
  popoverShell,
} from '../components/ui'
import { Conversation } from '../components/chat/Conversation'
import { SessionStats } from '../components/chat/SessionStats'
import { WorkingLine } from '../components/chat/WorkingLine'
import { Composer } from '../components/composer/Composer'

export function ChatPage(): React.JSX.Element {
  const t = useT()
  const settings = useAppStore((state) => state.settings)
  const route = useAppStore((state) => state.route)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const sessionId = route.sessionId ?? activeSessionId
  const toast = useAppStore((state) => state.toast)
  const navigate = useAppStore((state) => state.navigate)
  const setActiveTask = useAppStore((state) => state.setActiveTask)
  const focusComposerAt = useAppStore((state) => state.composerFocusAt)
  const renameRequestId = useAppStore((state) => state.renameRequestId)
  const clearRenameRequest = useAppStore((state) => state.clearRenameRequest)
  const steerQueue = useAppStore((state) => state.steerQueue)
  const loopTicks = useAppStore((state) => state.loopTicks)
  const sendingSessionId = useAppStore((state) => state.sendingSessionId)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rewindTarget, setRewindTarget] = useState<Message | null>(null)
  const [outputsOpen, setOutputsOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftKey, setDraftKey] = useState(0)
  const draftRequest = useAppStore((state) => state.draftRequest)
  useEffect(() => {
    if (!draftRequest) return
    setDraft(draftRequest.text)
    setDraftKey(draftRequest.at)
  }, [draftRequest])

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: qk.session(sessionId ?? 'none'),
    queryFn: () => api.sessions.get(sessionId as string),
    enabled: Boolean(sessionId),
  })

  const { data: messages = [] } = useQuery({
    queryKey: qk.messages(sessionId ?? 'none'),
    queryFn: () => api.sessions.messages(sessionId as string),
    enabled: Boolean(sessionId),
  })

  const { data: tasks = [] } = useQuery({
    queryKey: qk.tasks({ sessionId: sessionId ?? undefined }),
    queryFn: () => api.tasks.list({ sessionId: sessionId ?? undefined, limit: 25 }),
    enabled: Boolean(sessionId),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!activeSessionId && sessionId) useAppStore.setState({ activeSessionId: sessionId })
    if (session?.projectId && session.projectId !== activeProjectId) {
      useAppStore.setState({ activeProjectId: session.projectId })
    }
  }, [activeProjectId, activeSessionId, session, sessionId])

  const runningTask = tasks.find((task) =>
    ['idle', 'planning', 'running', 'waiting_tool', 'waiting_approval', 'retrying'].includes(
      task.state,
    ),
  )
  const latestTask = runningTask ?? tasks[0]

  const { data: gitStatus } = useQuery({
    queryKey: ['git', session?.projectId ?? 'none'],
    queryFn: () => api.git.status(session?.projectId as string),
    enabled: Boolean(session?.projectId),
    staleTime: 30_000,
  })
  const { data: projectList = [] } = useQuery({
    queryKey: qk.projects,
    queryFn: () => api.projects.list(),
    staleTime: 60_000,
  })
  const projectName = projectList.find((entry) => entry.id === session?.projectId)?.name ?? null

  const { data: taskDetail } = useQuery({
    queryKey: qk.task(latestTask?.id ?? 'none'),
    queryFn: () => api.tasks.get(latestTask?.id as string),
    enabled: Boolean(latestTask?.id),
    refetchInterval: runningTask ? 2500 : false,
  })

  useEffect(() => {
    setActiveTask(latestTask?.id ?? null)
  }, [latestTask?.id, setActiveTask])

  useEffect(() => {
    if (!session || renameRequestId !== session.id) return
    setTitleDraft(session.title)
    setEditingTitle(true)
    clearRenameRequest()
  }, [clearRenameRequest, renameRequestId, session])

  const sendPrompt = async (prompt: string, modeOverride?: AgentMode): Promise<void> => {
    if (!sessionId || !session) return
    try {
      const result = await api.agent.start({
        sessionId,
        prompt,
        mode: modeOverride ?? session.mode,
        permissionMode: session.permissionMode,
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
      })
      setActiveTask(result.taskId)
      await queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) })
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      toast({ level: 'error', title: 'Không gửi được yêu cầu', body: (error as Error).message })
    }
  }

  const rewindToMessage = async (): Promise<void> => {
    if (!session || !rewindTarget) return
    try {
      const result = await api.sessions.rewind(session.id, rewindTarget.id)
      const state = useAppStore.getState()
      for (const [id, entry] of Object.entries(state.live)) {
        if (entry.sessionId === session.id) state.clearLive(id)
      }
      setActiveTask(null)
      await queryClient.invalidateQueries({ queryKey: qk.messages(session.id) })
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['changes'] })
      if (rewindTarget.role === 'user') {
        setDraft(rewindTarget.content)
        setDraftKey((key) => key + 1)
      }
      state.focusComposer()
      toast({
        level: 'success',
        title: 'Đã quay lại thời điểm đã chọn',
        body: `Đã xoá ${result.removed} tin nhắn, hoàn nguyên ${result.reverted} tệp.`,
      })
      setRewindTarget(null)
    } catch (error) {
      toast({ level: 'error', title: 'Không quay lại được', body: (error as Error).message })
    }
  }

  async function saveTitle(): Promise<void> {
    if (!session) return
    const title = titleDraft.trim()
    setEditingTitle(false)
    if (!title || title === session.title) return
    await api.sessions.update(session.id, { title }).catch(() => undefined)
    await queryClient.invalidateQueries({ queryKey: qk.session(session.id) })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  async function exportMarkdown(): Promise<void> {
    if (!session) return
    const { markdown } = await api.sessions.export(session.id)
    await navigator.clipboard.writeText(markdown)
    toast({ level: 'success', title: 'Đã sao chép hội thoại dạng Markdown' })
  }

  async function archiveSession(): Promise<void> {
    if (!session) return
    setMenuOpen(false)
    await api.sessions.update(session.id, { archived: true })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    useAppStore.setState({ activeSessionId: null })
    navigate({ name: 'sessions' })
  }

  async function togglePin(): Promise<void> {
    if (!session) return
    setMenuOpen(false)
    await api.sessions.update(session.id, { pinned: !session.pinned })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    await queryClient.invalidateQueries({ queryKey: qk.session(session.id) })
    toast({
      level: 'success',
      title: session.pinned ? 'Đã bỏ ghim phiên' : 'Đã ghim phiên',
    })
  }

  if (!sessionId) {
    return (
      <EmptyState
        title={t('empty.messages')}
        description="Tạo một tác vụ mới để bắt đầu làm việc với agent."
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => void newSession()}>
            {t('action.newTask')}
          </Button>
        }
      />
    )
  }

  if (sessionLoading || !session) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="drag-region flex h-[52px] shrink-0 items-center gap-2 px-3">
        <div className="no-drag flex min-w-0 items-center gap-2">
          {projectName ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">
              <FolderClosed size={11} />
              <span className="max-w-[150px] truncate">{projectName}</span>
              {gitStatus?.branch ? (
                <>
                  <span className="text-[var(--border-strong)]">/</span>
                  <span className="max-w-[110px] truncate font-mono text-[11px]">
                    {gitStatus.branch}
                  </span>
                </>
              ) : null}
            </span>
          ) : null}
          <div className="flex min-w-0 items-center gap-1.5">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveTitle()
                  if (event.key === 'Escape') setEditingTitle(false)
                }}
                className="h-7 min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2 text-[13.5px] outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(session.title)
                  setEditingTitle(true)
                }}
                className="min-w-0 truncate text-left text-[14px] font-medium tracking-[-0.005em] transition-colors hover:text-[var(--text-muted)]"
                title="Đổi tên phiên"
              >
                {session.title}
              </button>
            )}
            {session.pinned ? (
              <Pin size={11} className="shrink-0 text-[var(--brand-accent)]" />
            ) : null}
          </div>

          <div className="flex-1" />
          <button
            type="button"
            aria-label="Popout Window"
            onClick={() => void api.popout(session.id)}
            className="icon-btn-sm no-drag"
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            aria-label="Outputs"
            onClick={() => setOutputsOpen((open) => !open)}
            data-active={outputsOpen}
            className="no-drag flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            Outputs
            {taskDetail?.fileChanges.length ? (
              <span className="tabular-nums text-[11.5px]">{taskDetail.fileChanges.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label="Create an output"
            onClick={() => {
              setDraft('Tạo một artifact: ')
              useAppStore.getState().focusComposer()
            }}
            className="icon-btn-sm no-drag"
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            aria-label="Toggle summary"
            onClick={() => setSummaryOpen((open) => !open)}
            className="no-drag flex h-7 items-center rounded-full px-2.5 text-[13px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            Summary
          </button>

          {runningTask ? (
            <button
              type="button"
              onClick={() => void api.agent.cancel(runningTask.id)}
              title={t('action.stop')}
              className="no-drag flex h-7 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-2.5 text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <Square size={9} className="fill-current" />
              {t('action.stop')}
            </button>
          ) : null}

          <div className="no-drag relative">
            <IconButton label="Tuỳ chọn" onClick={() => setMenuOpen((value) => !value)}>
              <MoreHorizontal size={15} />
            </IconButton>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  aria-label="Đóng menu"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className={cn('absolute right-0 top-8 z-40 w-[190px]', popoverShell, '')}>
                  <button
                    type="button"
                    className={menuRow}
                    onClick={() => {
                      setMenuOpen(false)
                      void exportMarkdown()
                    }}
                  >
                    <ClipboardCopy size={13} /> Sao chép Markdown
                  </button>
                  <button type="button" className={menuRow} onClick={() => void togglePin()}>
                    {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    {session.pinned ? 'Bỏ ghim' : 'Ghim'}
                  </button>
                  <button type="button" className={menuRow} onClick={() => void archiveSession()}>
                    <Archive size={13} /> Lưu trữ
                  </button>
                  <button
                    type="button"
                    className={cn(menuRow, 'text-[var(--danger)] hover:bg-[var(--danger)]/10')}
                    onClick={() => {
                      setMenuOpen(false)
                      setConfirmDelete(true)
                    }}
                  >
                    <Trash2 size={13} /> Xoá
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Conversation
          sessionId={session.id}
          messages={messages}
          streamingEnabled={Boolean(runningTask)}
          task={latestTask ?? null}
          taskDetail={taskDetail ?? null}
          onEditPrompt={(prompt) => {
            setDraft(prompt)
            setDraftKey((key) => key + 1)
            useAppStore.getState().focusComposer()
          }}
          onRetry={(prompt) => void sendPrompt(prompt)}
          onRewind={(message) => setRewindTarget(message)}
        />

        {outputsOpen ? (
          <aside className="w-[260px] shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] px-3 py-3">
            <div className="mb-2 text-[13px] font-medium text-[var(--text-faint)]">Outputs</div>
            {(taskDetail?.fileChanges ?? []).length === 0 ? (
              <p className="text-[12.5px] text-[var(--text-faint)]">Chưa có tệp nào thay đổi.</p>
            ) : (
              (taskDetail?.fileChanges ?? []).map((change) => (
                <button
                  key={change.id}
                  type="button"
                  onClick={() => void api.app.showItemInFolder(change.path)}
                  className="mb-1 flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">
                    {change.path.split('/').pop()}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11.5px] text-[var(--success)]">
                    +{change.addedLines}
                  </span>
                  <span className="shrink-0 tabular-nums text-[11.5px] text-[var(--danger)]">
                    −{change.removedLines}
                  </span>
                </button>
              ))
            )}
            {summaryOpen ? (
              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <div className="mb-2 text-[13px] font-medium text-[var(--text-faint)]">Summary</div>
                {settings['composer.showUsage'] !== false ? (
                  <SessionStats sessionId={session.id} />
                ) : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      <div className="shrink-0 px-3 pb-4 pt-3">
        <div className="mx-auto w-full max-w-[736px]">
          <Composer
            sessionId={session.id}
            defaultMode={session.mode}
            defaultPermission={session.permissionMode}
            runningTaskId={runningTask?.id ?? null}
            autoFocusKey={focusComposerAt}
            draft={draft}
            draftKey={draftKey}
            onSent={() => {
              void queryClient.invalidateQueries({ queryKey: qk.messages(session.id) })
            }}
          />
          <SessionStats sessionId={session.id} />
          {!runningTask && sendingSessionId === session.id ? (
            <div className="flex items-center gap-2 pt-1.5 text-[11.5px] text-[var(--text-muted)]">
              <span className="working-dot shrink-0" />
              <span className="working-shimmer">Đang gửi…</span>
            </div>
          ) : null}
          {runningTask ? (
            <WorkingLine
              state={runningTask.state}
              stepTitle={taskDetail?.steps?.find((step) => step.state === 'running')?.title}
              toolName={taskDetail?.toolCalls?.find((call) => call.status === 'running')?.toolName}
              startedAt={runningTask.startedAt}
              queued={steerQueue[runningTask.id] ?? 0}
              iteration={loopTicks[runningTask.id]?.iteration}
              contextTokens={loopTicks[runningTask.id]?.contextTokens}
              steps={taskDetail?.steps ?? []}
              toolCalls={taskDetail?.toolCalls ?? []}
              fileChangeCount={taskDetail?.fileChanges.length ?? 0}
            />
          ) : null}
        </div>
      </div>

      <Dialog
        open={Boolean(rewindTarget)}
        onOpenChange={(open) => {
          if (!open) setRewindTarget(null)
        }}
        title="Quay lại thời điểm này?"
        description="Mọi tin nhắn phía sau sẽ bị xoá. Các thay đổi tệp của những tác vụ sau thời điểm này sẽ được hoàn nguyên. Không thể hoàn tác."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRewindTarget(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={<History size={13} />}
              onClick={() => void rewindToMessage()}
            >
              Quay lại
            </Button>
          </>
        }
      />

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Xoá phiên này?"
        description="Toàn bộ tin nhắn, tác vụ và thay đổi tệp của phiên sẽ bị xoá khỏi cơ sở dữ liệu. Không thể hoàn tác."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.sessions.remove(session.id).catch(() => undefined)
                setConfirmDelete(false)
                useAppStore.setState({ activeSessionId: null })
                await queryClient.invalidateQueries({ queryKey: ['sessions'] })
                navigate({ name: 'sessions' })
              }}
            >
              Xoá
            </Button>
          </>
        }
      />
    </div>
  )
}
