import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AtSign,
  Check,
  ChevronDown,
  FolderPlus,
  Image as ImageIcon,
  Paperclip,
  Shield,
  Square,
  X,
} from 'lucide-react'
import type {
  AgentMode,
  Attachment,
  Message,
  ModelReasoningEffort,
  PermissionMode,
} from '@nexus/shared'
import { api, queryClient, qk, useAppStore, useT } from '../../kernel'
import { newSession } from '../../lib/actions'
import { listCommands, parseSlash, runSlash } from '../../lib/slash'
import { Select, Spinner, cn, menuRow, popoverShell } from '../ui'
import { IconPlus, IconPermission, IconProject, IconSend } from '../ui/codex-icons'

export interface ComposerProps {
  sessionId?: string
  defaultMode?: AgentMode
  defaultPermission?: PermissionMode
  runningTaskId?: string | null
  placeholder?: string
  autoFocusKey?: number
  draft?: string
  draftKey?: number
  onSubmitPrompt?: (prompt: string, attachments: Attachment[], mode: AgentMode) => void
  onSent?: (result: { taskId: string; messageId?: string; queued?: boolean }) => void
  compact?: boolean
  hero?: boolean
}

const PERMISSION_LABEL: Record<string, string> = {
  'read-only': 'chỉ đọc',
  'workspace-write': 'ghi dự án',
  'terminal-approval': 'duyệt lệnh',
  elevated: 'nâng cao',
  unrestricted: 'toàn quyền',
}

async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (file.size > 4_000_000) return null
  if (file.type.startsWith('image/')) {
    const buffer = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    return {
      name: file.name || 'image.png',
      kind: 'image',
      mimeType: file.type || 'image/png',
      base64,
    }
  }
  if (file.size > 400_000) return null
  const content = await file.text()
  return { name: file.name, kind: 'file', content }
}

export function Composer({
  sessionId,
  defaultMode,
  defaultPermission,
  runningTaskId,
  placeholder,
  autoFocusKey,
  draft,
  draftKey,
  onSubmitPrompt,
  onSent,
  compact,
  hero,
}: ComposerProps): React.JSX.Element {
  const t = useT()
  const toast = useAppStore((state) => state.toast)
  const settings = useAppStore((state) => state.settings)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusOpen, setPlusOpen] = useState(false)
  const [fallbackMode] = useState<AgentMode>(
    defaultMode ?? (settings['agent.defaultMode'] as AgentMode) ?? 'agent',
  )
  const [fallbackPermission] = useState<PermissionMode>(
    defaultPermission ?? (settings['agent.permissionMode'] as PermissionMode) ?? 'workspace-write',
  )
  const [modeOverride, setModeOverride] = useState<AgentMode | null>(null)
  const [permissionOverride, setPermissionOverride] = useState<PermissionMode | null>(null)
  const [menu, setMenu] = useState<'mode' | 'permission' | 'effort' | 'project' | null>(null)
  const [sending, setSending] = useState(false)
  const [mentionItems, setMentionItems] = useState<string[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { data: session } = useQuery({
    queryKey: qk.session(sessionId ?? 'none'),
    queryFn: () => api.sessions.get(sessionId as string),
    enabled: Boolean(sessionId),
  })
  // Reactive so /agent và /model đổi xong là thấy ngay trong composer.
  const mode = session?.mode ?? modeOverride ?? fallbackMode
  const permission = session?.permissionMode ?? permissionOverride ?? fallbackPermission
  const projectContextId = session?.projectId ?? activeProjectId ?? null
  const { data: projects = [] } = useQuery({ queryKey: qk.projects, queryFn: () => api.projects.list(), staleTime: 60_000 })
  const currentProject = projects.find((project) => project.id === projectContextId) ?? null
  const { data: gitStatus } = useQuery({
    queryKey: ['composer-git', projectContextId ?? 'none'],
    queryFn: () => api.git.status(projectContextId as string),
    enabled: Boolean(projectContextId),
    retry: false,
    staleTime: 60_000,
  })
  const isGitRepo = Boolean(gitStatus)
  const initRepo = async (): Promise<void> => {
    if (!projectContextId) return
    try {
      const targetId = sessionId ?? (await newSession({ projectId: projectContextId }))
      if (!targetId) return
      await api.agent.start({
        sessionId: targetId,
        prompt: 'Khởi tạo git repository cho dự án này (git init) và commit đầu tiên.',
        mode: 'agent',
        permissionMode: permission,
      })
      await queryClient.invalidateQueries({ queryKey: ['composer-git', projectContextId] })
      toast({ level: 'info', title: 'Đang tạo git repository' })
    } catch (error) {
      toast({ level: 'error', title: 'Không tạo được repository', body: (error as Error).message })
    }
  }
  const { data: customCommands = [] } = useQuery({
    queryKey: ['commands', projectContextId ?? 'global'],
    queryFn: () => api.commands.list(projectContextId ?? undefined),
    staleTime: 30_000,
  })
  // Cho phép khoảng trắng thừa phía trước (dán/nhỡ tay) nhưng không bật menu giữa câu.
  const slashToken = value.trimStart()
  const plainText = settings['composer.plainText'] === true
  const slashActive =
    !plainText &&
    slashToken.startsWith('/') &&
    !/\s/.test(slashToken) &&
    value.trim() !== '' &&
    slashDismissed !== value
  const slashItems = slashActive ? listCommands(customCommands, slashToken.slice(1)) : []
  const slashCursor = slashItems.length ? Math.min(slashIndex, slashItems.length - 1) : 0
  const { data: models = [] } = useQuery({ queryKey: qk.models, queryFn: () => api.models.list() })
  const defaultModel = models.find((entry) => entry.isDefault)
  const currentModel = session
    ? (models.find(
        (entry) =>
          entry.providerId === session.providerId &&
          entry.modelId === session.modelId &&
          (entry.variant ?? '') === (session.modelVariant ?? ''),
      ) ??
      models.find(
        (entry) => entry.providerId === session.providerId && entry.modelId === session.modelId,
      ) ??
      defaultModel)
    : defaultModel
  const setPermission = async (next: PermissionMode): Promise<void> => {
    setMenu(null)
    setPermissionOverride(next)
    if (sessionId) {
      await api.sessions.update(sessionId, { permissionMode: next })
      await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
    }
  }

  const setMode = async (next: AgentMode): Promise<void> => {
    setMenu(null)
    setModeOverride(next)
    if (sessionId) {
      await api.sessions.update(sessionId, { mode: next })
      await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
    }
  }

  const setEffort = async (next: ModelReasoningEffort): Promise<void> => {
    setMenu(null)
    if (!currentModel) return
    try {
      await api.models.save({
        id: currentModel.id,
        providerId: currentModel.providerId,
        modelId: currentModel.modelId,
        reasoningEffort: next,
        variant: currentModel.variant ?? '',
      })
      await queryClient.invalidateQueries({ queryKey: qk.models })
    } catch (error) {
      toast({ level: 'error', title: 'Không đổi được effort', body: (error as Error).message })
    }
  }

  const chooseModel = async (
    providerId: string,
    modelId: string,
    modelVariant = '',
  ): Promise<void> => {
    try {
      if (sessionId) {
        await api.sessions.update(sessionId, {
          ...(providerId ? { providerId } : {}),
          modelId,
          modelVariant,
        })
        await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      } else {
        const target = models.find(
          (entry) =>
            entry.providerId === providerId &&
            entry.modelId === modelId &&
            (entry.variant ?? '') === modelVariant,
        )
        if (!target) return
        await api.models.setDefault(target.id)
        await queryClient.invalidateQueries({ queryKey: qk.models })
      }
    } catch (error) {
      toast({ level: 'error', title: 'Không đổi được model', body: (error as Error).message })
    }
  }

  useEffect(() => {
    if (autoFocusKey) textareaRef.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    if (hero) textareaRef.current?.focus()
  }, [hero])

  useEffect(() => {
    if (draft !== undefined) setValue(draft)
  }, [draft, draftKey])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, hero ? 240 : compact ? 180 : 320)}px`
  }, [value, compact, hero])

  const send = useCallback(
    async (prompt: string, overrideMode?: AgentMode): Promise<void> => {
      const nextMode = overrideMode ?? mode
      if (onSubmitPrompt) {
        onSubmitPrompt(prompt, [], nextMode)
        return
      }
      setSending(true)
      try {
        const targetSession =
          sessionId ??
          (await newSession({
            projectId: activeProjectId,
            mode: nextMode,
            title: prompt.slice(0, 60) || 'Hội thoại mới',
          }))
        if (!targetSession) return
        useAppStore.getState().setSendingSession(targetSession)
        const result = await api.agent.start({
          sessionId: targetSession,
          prompt,
          mode: nextMode,
          permissionMode: permission,
          ...(projectContextId ? { projectId: projectContextId } : {}),
        })
        onSent?.(result)
      } catch (error) {
        toast({ level: 'error', title: 'Không gửi được yêu cầu', body: (error as Error).message })
      } finally {
        setSending(false)
        useAppStore.getState().setSendingSession(null)
      }
    },
    [activeProjectId, mode, onSent, onSubmitPrompt, permission, projectContextId, sessionId, toast],
  )

  const runCommand = useCallback(
    (name: string, input: string): Promise<boolean> =>
      runSlash(name, input, {
        sessionId,
        projectId: projectContextId,
        taskId: runningTaskId,
        mode,
        running: Boolean(runningTaskId),
        custom: customCommands,
        send,
        setDraft: setValue,
      }),
    [customCommands, mode, projectContextId, runningTaskId, send, sessionId],
  )

  // ponytail: chưa có bộ chọn dự án toàn cục -> lấy dự án đầu tiên khi store trống.
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    enabled: !activeProjectId,
  })
  const mentionProjectId = activeProjectId ?? projectsQuery.data?.[0]?.id ?? null
  // @tệp trong prompt: đọc nội dung và đính kèm để agent không phải gọi tool đọc lại.
  const mentionAttachments = useCallback(
    async (text: string): Promise<Attachment[]> => {
      if (!mentionProjectId) return []
      const projectId = mentionProjectId
      const paths = [
        ...new Set(
          [...text.matchAll(/@([^\s@]+)/g)].map((match) => match[1] ?? '').filter(Boolean),
        ),
      ]
      const picked: Attachment[] = []
      for (const path of paths.slice(0, 5)) {
        try {
          const file = await api.workspace.readFile(projectId, path)
          picked.push({ kind: 'file', name: path, path, content: file.content })
        } catch {
          // Đường dẫn gõ sai thì bỏ qua, prompt vẫn giữ nguyên văn bản.
        }
      }
      return picked
    },
    [mentionProjectId],
  )

  // settings đọc trực tiếp trong submit; giữ deps cũ để tránh vòng lặp useCallback.
  const submit = useCallback(async (): Promise<void> => {
    const prompt = value.trim()
    if ((!prompt && attachments.length === 0) || sending) return
    const attachedPaths = new Set(attachments.map((entry) => entry.path).filter(Boolean))
    const mentioned = (await mentionAttachments(prompt)).filter(
      (entry) => !attachedPaths.has(entry.path),
    )
    const allAttachments = [...attachments, ...mentioned]
    const slash = allAttachments.length > attachments.length ? null : parseSlash(prompt)
    if (slash && (await runCommand(slash.name, slash.input))) {
      setValue('')
      setAttachments([])
      return
    }
    if (runningTaskId && sessionId && !onSubmitPrompt) {
      if (!prompt || attachments.length) {
        toast({
          level: 'info',
          title: 'Không thể đính kèm khi đang chạy',
          body: 'Huỷ tác vụ hiện tại rồi gửi lại kèm tệp.',
        })
        return
      }
      if (settings['composer.busySend'] === 'interrupt') {
        await api.agent.cancel(runningTaskId).catch(() => undefined)
        await send(prompt, mode)
        setValue('')
        return
      }
      setSending(true)
      try {
        const result = await api.agent.steer(runningTaskId, prompt)
        if (!result.queued) {
          toast({
            level: 'info',
            title: 'Tác vụ vừa kết thúc',
            body: 'Gửi lại để bắt đầu tác vụ mới.',
          })
          return
        }
        setValue('')
      } catch (error) {
        toast({ level: 'error', title: 'Không gửi được', body: (error as Error).message })
      } finally {
        setSending(false)
      }
      return
    }
    if (onSubmitPrompt) {
      onSubmitPrompt(prompt, allAttachments, mode)
      setValue('')
      setAttachments([])
      return
    }
    setSending(true)
    try {
      const targetSession =
        sessionId ??
        (await newSession({
          projectId: activeProjectId,
          mode,
          title: prompt.slice(0, 60) || 'Hội thoại mới',
        }))
      if (!targetSession) return
      // Show the prompt immediately; the refetch replaces it a moment later.
      useAppStore.getState().setSendingSession(targetSession)
      queryClient.setQueryData(qk.messages(targetSession), (previous: Message[] = []) => [
        ...previous,
        {
          id: `optimistic-${Date.now()}`,
          sessionId: targetSession,
          role: 'user',
          content: prompt || '(chỉ là tệp đính kèm)',
          createdAt: Date.now(),
          status: 'complete',
        } as Message,
      ])
      const result = await api.agent.start({
        sessionId: targetSession,
        prompt: prompt || '(chỉ là tệp đính kèm)',
        mode,
        permissionMode: permission,
        ...(projectContextId ? { projectId: projectContextId } : {}),
        ...(allAttachments.length ? { attachments: allAttachments } : {}),
      })
      setValue('')
      setAttachments([])
      onSent?.(result)
    } catch (error) {
      toast({ level: 'error', title: 'Không gửi được yêu cầu', body: (error as Error).message })
    } finally {
      setSending(false)
      useAppStore.getState().setSendingSession(null)
    }
  }, [
    activeProjectId,
    attachments,
    mentionAttachments,
    mode,
    onSent,
    onSubmitPrompt,
    permission,
    projectContextId,
    runCommand,
    runningTaskId,
    send,
    sending,
    sessionId,
    settings,
    toast,
    value,
  ])

  useEffect(() => {
    if (!plusOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPlusOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plusOpen])

  const addWorkspace = async (): Promise<void> => {
    const picked = await api.projects.pick()
    if (!picked) return
    useAppStore.getState().setActiveProject(picked.id)
    await queryClient.invalidateQueries({ queryKey: qk.projects })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    toast({ level: 'success', title: `Workspace hiện tại: ${picked.name}` })
  }

  const attach = async (kind: 'file' | 'image'): Promise<void> => {
    try {
      const files = await api.workspace.pickFiles(kind)
      setAttachments((current) => [...current, ...files].slice(0, 10))
    } catch (error) {
      toast({ level: 'error', title: 'Không đính kèm được', body: (error as Error).message })
    }
  }

  const addFiles = async (files: File[]): Promise<void> => {
    const converted: Attachment[] = []
    for (const file of files) {
      const attachment = await fileToAttachment(file)
      if (attachment) converted.push(attachment)
    }
    if (converted.length) setAttachments((current) => [...current, ...converted].slice(0, 10))
  }

  // @tệp: gợi ý đường dẫn từ dự án đang mở.
  const mentionQuery = useMemo(() => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value)
    return match && mentionProjectId ? (match[1] ?? '') : null
  }, [value, mentionProjectId])
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionItems([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api.workspace
        .searchFiles(mentionProjectId as string, mentionQuery, 8)
        .then((results) => {
          if (cancelled) return
          setMentionItems(results.map((result) => result.path))
          setMentionIndex(0)
        })
        .catch(() => {
          if (!cancelled) setMentionItems([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [mentionQuery, mentionProjectId])

  const acceptMention = (path: string): void => {
    setValue((current) => current.replace(/@([^\s@]*)$/, `@${path} `))
    setMentionItems([])
    textareaRef.current?.focus()
  }

  const riskyPermission = permission === 'elevated' || permission === 'unrestricted'

  const canSend = Boolean(value.trim()) || attachments.length > 0

  return (
    <div
      className={cn(
        // Card bo 22px, --elevation-composer, nền gần-trắng — đúng composer Codex.
        'composer-card relative flex flex-col overflow-hidden transition-shadow duration-150',
        dragging && 'ring-4 ring-[var(--info-soft)]',
        hero && 'min-h-[98px]',
      )}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void addFiles([...event.dataTransfer.files].slice(0, 10))
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-xl)] bg-[var(--bg-elevated)]/85 text-[13px] text-[var(--text-muted)] backdrop-blur-sm">
          Thả tệp để đính kèm
        </div>
      ) : null}

      {projectContextId ? (
        <div className="composer-action-bar flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2 text-[13px] font-[430] text-[var(--text)]">
              <IconProject size={14} className="shrink-0 text-[var(--text-faint)]" />
              <span className="truncate">{currentProject?.name ?? 'Project'}</span>
            </span>
            <button
              type="button"
              aria-label="Don't work in a project"
              title="Don't work in a project"
              onClick={() => {
                useAppStore.getState().setActiveProject(null)
              }}
              className="icon-btn-sm"
            >
              <X size={13} />
            </button>
          </div>
          {!isGitRepo ? (
            <button
              type="button"
              onClick={() => void initRepo()}
              className="flex h-7 shrink-0 items-center rounded-full px-2 text-[13px] font-[430] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              Create git repository
            </button>
          ) : null}
        </div>
      ) : null}

      {mentionItems.length ? (
        <div
          role="listbox"
          aria-label="Tệp"
          className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-[240px] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1 surface-raised"
        >
          {mentionItems.map((path, index) => (
            <button
              key={path}
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              onMouseEnter={() => setMentionIndex(index)}
              onClick={() => acceptMention(path)}
              className={cn(
                'flex w-full items-center rounded-[var(--radius-sm)] px-2 py-1 text-left font-mono text-[11.5px]',
                index === mentionIndex ? 'bg-[var(--bg-hover)]' : '',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{path}</span>
            </button>
          ))}
        </div>
      ) : null}

      {slashItems.length ? (
        <div
          role="listbox"
          aria-label="Lệnh"
          className={cn(
            'absolute bottom-full left-0 right-0 z-30 mb-1 max-h-[260px] overflow-y-auto',
            popoverShell,
            '',
          )}
        >
          {slashItems.map((item, index) => (
            <button
              key={item.name}
              type="button"
              role="option"
              aria-selected={index === slashCursor}
              onMouseEnter={() => setSlashIndex(index)}
              onClick={() => {
                if (item.args) {
                  setValue(`/${item.name} `)
                  setSlashIndex(0)
                  textareaRef.current?.focus()
                  return
                }
                setValue('')
                void runCommand(item.name, '')
                textareaRef.current?.focus()
              }}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left',
                index === slashCursor ? 'bg-[var(--bg-hover)]' : '',
              )}
            >
              <span className="shrink-0 font-mono text-[12.5px]">/{item.name}</span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-faint)]">
                {item.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          // Xoá hết thì bỏ trạng thái đã đóng menu, gõ lại "/" vẫn mở.
          if (event.target.value === '') setSlashDismissed(null)
          // Gõ thêm thì con trỏ menu quay về mục đầu, tránh chọn nhầm mục của truy vấn trước.
          setSlashIndex(0)
        }}
        onPaste={(event) => {
          const files = [...event.clipboardData.items]
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file))
          if (files.length) {
            event.preventDefault()
            void addFiles(files)
          }
        }}
        onKeyDown={(event) => {
          if (mentionItems.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setMentionIndex((index) => (index + step + mentionItems.length) % mentionItems.length)
              return
            }
            if (event.key === 'Tab' || event.key === 'Enter') {
              event.preventDefault()
              const path = mentionItems[mentionIndex]
              if (path) acceptMention(path)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionItems([])
              return
            }
          }
          if (slashItems.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setSlashIndex((index) => (index + step + slashItems.length) % slashItems.length)
              return
            }
            const item = slashItems[slashCursor]
            if (item && (event.key === 'Tab' || event.key === 'Enter')) {
              event.preventDefault()
              if (item.args) {
                setValue(`/${item.name} `)
                setSlashIndex(0)
                return
              }
              setValue('')
              void runCommand(item.name, '')
              return
            }
          }
          if (event.key === 'Escape' && slashActive) {
            setSlashDismissed(value)
            return
          }
          const modEnter = event.metaKey || event.ctrlKey
          const enterSends = settings['composer.enterSends'] !== false
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            (enterSends ? !event.shiftKey && !modEnter : modEnter)
          ) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={1}
        placeholder={
          runningTaskId
            ? 'Điều hướng tác vụ đang chạy…'
            : (placeholder ?? t('composer.placeholder'))
        }
        className={cn(
          'block w-full resize-none bg-transparent outline-none placeholder:text-[var(--text-faint)]',
          'text-[15px] leading-[1.5]',
          hero ? 'min-h-[46px] px-3.5 pb-1 pt-3' : 'min-h-[40px] px-3.5 pb-1.5 pt-2.5',
        )}
      />

      {attachments.length ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="inline-flex items-center gap-1 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11.5px]"
            >
              <span className="max-w-[200px] truncate">{attachment.name}</span>
              <button
                type="button"
                aria-label="Bỏ đính kèm"
                className="text-[var(--text-faint)] hover:text-[var(--text)]"
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 items-center justify-between gap-1.5 px-2 pb-2 pt-1 text-[13px] text-[var(--text-faint)]">
        <div className="relative">
          <button
            type="button"
            aria-label="Choose project"
            onClick={() => setMenu((current) => (current === 'project' ? null : 'project'))}
            className="flex h-7 max-w-[224px] shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-[13px] leading-[18px] text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <IconProject size={14} className="shrink-0" />
            <span className="truncate">{currentProject?.name ?? 'Choose project'}</span>
          </button>
          {menu === 'project' ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenu(null)}
              />
              <div role="menu" className="absolute bottom-full left-0 z-40 mb-1 max-h-[260px] w-[240px] overflow-y-auto rounded-[12.5px] border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-overlay)]">
                {(projects ?? []).map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setMenu(null)
                      useAppStore.getState().setActiveProject(project.id)
                    }}
                    className={menuRow}
                  >
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {projectContextId === project.id ? <Check size={13} /> : null}
                  </button>
                ))}
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null)
                    void addWorkspace()
                  }}
                  className={menuRow}
                >
                  <FolderPlus size={13} />
                  Add folder…
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label="Add files and more"
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen((open) => !open)}
            className="icon-btn-sm"
          >
            <IconPlus size={16} />
          </button>
          {plusOpen ? (
            <>
              <button
                type="button"
                aria-label="Đóng menu thêm"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setPlusOpen(false)}
              />
              <div
                role="menu"
                aria-label="Thêm ngữ cảnh"
                className={cn('absolute bottom-full left-0 z-40 mb-1 w-[220px]', popoverShell)}
              >
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen(false)
                    void attach('file')
                  }}
                  className={menuRow}
                >
                  <Paperclip size={13} />
                  Đính kèm tệp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen(false)
                    void attach('image')
                  }}
                  className={menuRow}
                >
                  <ImageIcon size={13} />
                  Đính kèm ảnh
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen(false)
                    setValue((current) => (current ? `${current} @` : '@'))
                    textareaRef.current?.focus()
                  }}
                  className={menuRow}
                >
                  <AtSign size={13} />
                  Trỏ tới tệp trong dự án
                </button>
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <button
                  type="button"
                  onClick={() => {
                    setPlusOpen(false)
                    void addWorkspace()
                  }}
                  className={menuRow}
                >
                  <FolderPlus size={13} />
                  Thêm workspace
                </button>
              </div>
            </>
          ) : null}
        </div>
        <div className="relative hidden sm:block">
          <button
            type="button"
            aria-label="Change mode"
            onClick={() => setMenu((current) => (current === 'mode' ? null : 'mode'))}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-[13px] leading-[18px] text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
          >
            <span className="capitalize">{mode}</span>
            <ChevronDown size={13} />
          </button>
          {menu === 'mode' ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenu(null)}
              />
              <div role="menu" className={cn('absolute bottom-full left-0 z-40 mb-1 w-[180px]', popoverShell)}>
                {(['agent', 'plan', 'ask', 'code', 'review', 'debug'] as AgentMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void setMode(item)}
                    className={menuRow}
                  >
                    <span className="flex-1 capitalize">{item}</span>
                    {mode === item ? <Check size={13} /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            aria-label="Change permissions"
            onClick={() => setMenu((current) => (current === 'permission' ? null : 'permission'))}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-[13px] leading-[18px] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-hover)]',
              riskyPermission
                ? 'text-[var(--warning)] hover:text-[var(--warning)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {riskyPermission ? (
              <Shield size={13} className="shrink-0 stroke-[1.8]" />
            ) : (
              <IconPermission size={13} className="shrink-0" />
            )}
            {PERMISSION_LABEL[permission] ?? permission}
            <ChevronDown size={13} />
          </button>
          {menu === 'permission' ? (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenu(null)}
              />
              <div role="menu" className={cn('absolute bottom-full left-0 z-40 mb-1 w-[240px]', popoverShell)}>
                {(Object.keys(PERMISSION_LABEL) as PermissionMode[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => void setPermission(item)}
                    className={menuRow}
                  >
                    <span className="flex-1">{PERMISSION_LABEL[item]}</span>
                    {permission === item ? <Check size={13} /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex-1" />

        <Select
          value={currentModel?.id ?? ''}
          options={models.map((entry) => ({
            value: entry.id,
            label: entry.displayName || entry.modelId,
          }))}
          onValueChange={(id: string) => {
            const target = models.find((entry) => entry.id === id)
            if (target) void chooseModel(target.providerId, target.modelId, target.variant ?? '')
          }}
          className="max-w-[224px]"
          aria-label={t('nav.models')}
        />

        {currentModel ? (
          <div className="relative">
            <button
              type="button"
              aria-label="Select effort"
              onClick={() => setMenu((current) => (current === 'effort' ? null : 'effort'))}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-transparent px-2 text-[13px] leading-[18px] text-[var(--text-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <span className="capitalize">{currentModel.reasoningEffort}</span>
              <ChevronDown size={13} />
            </button>
            {menu === 'effort' ? (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenu(null)}
                />
                <div role="menu" className={cn('absolute bottom-full right-0 z-40 mb-1 w-[180px]', popoverShell)}>
                  {(['off', 'minimal', 'low', 'medium', 'high'] as ModelReasoningEffort[]).map(
                    (item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void setEffort(item)}
                        className={menuRow}
                      >
                        <span className="flex-1 capitalize">{item}</span>
                        {currentModel.reasoningEffort === item ? <Check size={13} /> : null}
                      </button>
                    ),
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {runningTaskId ? (
          <button
            type="button"
            onClick={() => void api.agent.cancel(runningTaskId)}
            aria-label={t('action.stop')}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text)] transition-colors hover:bg-[var(--bg-active)]"
          >
            <Square size={11} className="fill-current" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void submit()}
          aria-label={t('action.send')}
          disabled={!canSend || sending}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--composer-primary)] text-[var(--text-on-composer-primary)] transition-[filter,transform,opacity] duration-150',
            canSend && !sending
              ? 'hover:brightness-[0.93] active:scale-95'
              : 'opacity-40',
          )}
        >
          {sending ? <Spinner size={13} /> : <IconSend size={16} />}
        </button>
      </div>
    </div>
  )
}
