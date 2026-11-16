import type { AgentMode, CustomCommand, PermissionMode } from '@nexus/shared'
import type { ModelReasoningEffort } from '@nexus/shared'
import { api, queryClient, qk, useAppStore } from '../kernel'
import { newSession } from './actions'
import { AGENT_MODES, BUILTIN_COMMANDS, expandTemplate, parseArgs } from './slash-parse'

export {
  AGENT_MODES,
  BUILTIN_COMMANDS,
  expandTemplate,
  listCommands,
  parseArgs,
  parseSlash,
  type SlashCommand,
} from './slash-parse'

export interface SlashContext {
  sessionId?: string
  projectId?: string | null
  taskId?: string | null
  mode: AgentMode
  running: boolean
  custom: CustomCommand[]
  send: (prompt: string, mode?: AgentMode) => Promise<void>
  setDraft: (text: string) => void
}

const DIFF_LIMIT = 24_000
const PERMISSION_MODES: Array<{ value: PermissionMode; label: string }> = [
  { value: 'read-only', label: 'chỉ đọc' },
  { value: 'workspace-write', label: 'ghi trong dự án' },
  { value: 'terminal-approval', label: 'duyệt từng lệnh' },
  { value: 'elevated', label: 'nâng cao' },
  { value: 'unrestricted', label: 'toàn quyền' },
]

function clipDiff(diff: string): string {
  return diff.length > DIFF_LIMIT
    ? `${diff.slice(0, DIFF_LIMIT)}\n… (diff bị cắt bớt, còn ${diff.length - DIFF_LIMIT} ký tự)`
    : diff
}

const AGENTS_INIT_PROMPT =
  'Khảo sát repo (cấu trúc, cách build, cách chạy test, quy ước code) rồi tạo hoặc cập nhật AGENTS.md ở gốc dự án: lệnh cài đặt, lệnh build, lệnh chạy test và cách chạy một test đơn lẻ, quy ước code, những việc không được làm. Không sửa tệp nào khác.'

const COMPACT_PROMPT =
  'Tóm tắt hội thoại này thành: quyết định đã chốt, tệp đã đổi, việc còn lại. Không sửa tệp.'

const invalidateConversation = async (sessionId: string): Promise<void> => {
  await queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) })
  await queryClient.invalidateQueries({ queryKey: ['tasks'] })
  await queryClient.invalidateQueries({ queryKey: ['changes'] })
}

// Tên lệnh theo Codex desktop được map về lệnh NEXUS tương ứng.
const ALIASES: Record<string, string> = {
  approvals: 'permissions',
  approval: 'approvals',
  skills: 'commands',
  prompts: 'commands',
}

export async function runSlash(
  rawName: string,
  input: string,
  ctx: SlashContext,
): Promise<boolean> {
  const name = ALIASES[rawName] ?? rawName
  const store = useAppStore.getState()
  const toast = store.toast
  const sessionId = ctx.sessionId
  const needsIdle = (): boolean => {
    if (!ctx.running) return true
    toast({ level: 'info', title: 'Đang chạy tác vụ', body: 'Dừng tác vụ hiện tại trước.' })
    return false
  }
  const send = async (prompt: string, overrideMode?: AgentMode): Promise<void> => {
    if (needsIdle()) await ctx.send(prompt, overrideMode)
  }
  const noSession = (): boolean => {
    toast({ level: 'info', title: 'Cần mở một phiên trước' })
    return true
  }

  switch (name) {
    case 'new':
      await newSession({ mode: ctx.mode })
      return true

    case 'undo': {
      if (!sessionId) return noSession()
      if (!needsIdle()) return true
      const messages = await api.sessions.messages(sessionId)
      const lastUser = messages.findLastIndex((message) => message.role === 'user')
      const undone = messages[lastUser]
      const target = messages[lastUser - 1]
      if (!undone || !target) {
        toast({ level: 'info', title: 'Không còn lượt nào để hoàn nguyên' })
        return true
      }
      const result = await api.sessions.rewind(sessionId, target.id)
      ctx.setDraft(undone.content)
      useAppStore.getState().setUndonePrompt(undone.content)
      store.focusComposer()
      await invalidateConversation(sessionId)
      toast({
        level: 'success',
        title: 'Đã hoàn nguyên lượt trước',
        body: `Xoá ${result.removed} tin nhắn, hoàn nguyên ${result.reverted} tệp.`,
      })
      return true
    }

    case 'fork': {
      if (!sessionId) return noSession()
      const copy = await api.sessions.duplicate(sessionId)
      store.openSession(copy.id, copy.projectId ?? undefined)
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      return true
    }

    // ponytail: core chưa có RPC nén context nên /compact chỉ gửi prompt tóm tắt;
    // đổi sang agent.compact khi core hỗ trợ.
    case 'compact':
      await send(input ? `${COMPACT_PROMPT}\n\n${input}` : COMPACT_PROMPT)
      return true

    case 'export': {
      if (!sessionId) return noSession()
      const { markdown } = await api.sessions.export(sessionId)
      await navigator.clipboard.writeText(markdown)
      toast({ level: 'success', title: 'Đã sao chép hội thoại dạng Markdown' })
      return true
    }

    case 'model': {
      const models = await api.models.list()
      const needle = input.trim().toLowerCase()
      const match = needle
        ? models.find(
            (entry) =>
              entry.modelId.toLowerCase().includes(needle) ||
              entry.displayName.toLowerCase().includes(needle),
          )
        : undefined
      if (!match) {
        const names = models.map((entry) => entry.displayName || entry.modelId).slice(0, 12)
        toast({
          level: 'info',
          title: input ? `Không thấy model "${input}"` : 'Chọn model',
          body: names.join(' · ') || 'Chưa cấu hình model nào.',
        })
        return true
      }
      if (sessionId) {
        await api.sessions.update(sessionId, {
          providerId: match.providerId,
          modelId: match.modelId,
          modelVariant: match.variant ?? '',
        })
        await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      } else {
        await api.models.setDefault(match.id)
        await queryClient.invalidateQueries({ queryKey: qk.models })
      }
      toast({ level: 'success', title: `Model: ${match.displayName || match.modelId}` })
      return true
    }

    case 'agent': {
      const requested = input.trim().toLowerCase() as AgentMode
      const next = AGENT_MODES.includes(requested)
        ? requested
        : AGENT_MODES[(AGENT_MODES.indexOf(ctx.mode) + 1) % AGENT_MODES.length]
      if (sessionId) {
        await api.sessions.update(sessionId, { mode: next })
        await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      } else {
        store.setSetting('agent.defaultMode', next)
      }
      toast({ level: 'success', title: `Chế độ: ${next}` })
      return true
    }

    case 'connect':
      store.navigate({ name: 'settings', section: 'models' })
      return true

    case 'mcp':
      store.navigate({ name: 'settings', section: 'mcp' })
      return true

    case 'reload':
      await queryClient.invalidateQueries()
      toast({ level: 'success', title: 'Đã nạp lại cấu hình' })
      return true

    case 'init':
      await send(input ? `${AGENTS_INIT_PROMPT}\n\nYêu cầu thêm: ${input}` : AGENTS_INIT_PROMPT)
      return true

    case 'plan': {
      if (sessionId) {
        await api.sessions.update(sessionId, { mode: 'plan' })
        await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      }
      await send(
        input
          ? `Lập kế hoạch chi tiết cho việc sau, chưa sửa mã: ${input}`
          : 'Lập kế hoạch cho công việc tiếp theo, chưa sửa mã.',
        'plan',
      )
      return true
    }

    case 'review': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      if (!needsIdle()) return true
      const { diff } = await api.git.diff(project)
      if (!diff.trim()) {
        toast({ level: 'info', title: 'Không có thay đổi chưa commit' })
        return true
      }
      await send(
        `Review các thay đổi chưa commit dưới đây. Nêu bug, rủi ro bảo mật và chỗ thiếu test; chỉ sửa khi tôi đồng ý.\n\n\`\`\`diff\n${clipDiff(diff)}\n\`\`\``,
      )
      return true
    }

    case 'fix':
      await send(
        input
          ? `Sửa lỗi sau rồi chạy lại phần kiểm tra liên quan: ${input}`
          : 'Tìm nguyên nhân lỗi gần nhất trong phiên này, sửa tối thiểu và chạy lại phần kiểm tra liên quan.',
      )
      return true

    case 'test':
      await send(
        input
          ? `Chạy test cho phạm vi "${input}", sửa lỗi nếu hỏng và báo lại kết quả.`
          : 'Chạy toàn bộ test của dự án, sửa lỗi nếu hỏng và báo lại kết quả.',
      )
      return true

    case 'commit': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const message = input.trim()
      if (!message) {
        toast({
          level: 'info',
          title: 'Thiếu message',
          body: 'Ví dụ: /commit fix: sửa kiểm tra token hết hạn',
        })
        return true
      }
      const status = await api.git.status(project)
      if (status.clean || status.files.length === 0) {
        toast({ level: 'info', title: 'Không có gì để commit' })
        return true
      }
      const paths = status.files.map((file) => file.path)
      await api.git.stage(project, paths)
      const { hash } = await api.git.commit(project, message, paths)
      await queryClient.invalidateQueries({ queryKey: qk.gitStatus(project) })
      await queryClient.invalidateQueries({ queryKey: qk.gitLog(project) })
      toast({
        level: 'success',
        title: `Đã commit ${hash.slice(0, 7)}`,
        body: `${paths.length} tệp`,
      })
      return true
    }

    case 'diff': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const { diff } = await api.git.diff(project)
      if (!diff.trim()) {
        toast({ level: 'info', title: 'Không có thay đổi chưa commit' })
        return true
      }
      await navigator.clipboard.writeText(diff)
      toast({
        level: 'success',
        title: 'Đã sao chép diff',
        body: `${diff.split('\n').length} dòng`,
      })
      return true
    }

    case 'status': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const status = await api.git.status(project)
      toast({
        level: 'info',
        title: status.isRepo ? `Nhánh ${status.branch || '(chưa có)'}` : 'Không phải git repo',
        body: status.clean
          ? 'Không có thay đổi'
          : `${status.files.length} tệp thay đổi · ahead ${status.ahead} · behind ${status.behind}`,
      })
      return true
    }

    case 'grep': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const query = input.trim()
      if (!query) {
        toast({ level: 'info', title: 'Cần mẫu tìm', body: 'Ví dụ: /grep TODO|FIXME' })
        return true
      }
      const hits = await api.workspace.searchCode(project, query, true, 30)
      toast({
        level: 'info',
        title: `${hits.length} kết quả`,
        body: hits
          .slice(0, 6)
          .map((hit) => `${hit.path}:${hit.line ?? 0} ${hit.preview ?? ''}`.trim())
          .join('\n'),
      })
      return true
    }

    case 'open': {
      const [target] = parseArgs(input)
      if (!target) {
        toast({ level: 'info', title: 'Cần đường dẫn', body: 'Ví dụ: /open src/main.ts' })
        return true
      }
      if (/^https?:\/\//i.test(target)) {
        await api.app.openExternal(target)
      } else {
        await api.app.showItemInFolder(target)
      }
      return true
    }

    case 'tasks': {
      if (!sessionId) return noSession()
      const tasks = await api.tasks.list({ sessionId, limit: 5 })
      toast({
        level: 'info',
        title: `${tasks.length} tác vụ gần nhất`,
        body: tasks.map((task) => `${task.state}: ${task.title}`).join('\n'),
      })
      return true
    }

    case 'usage': {
      const summary = await api.usage.summary(7)
      toast({
        level: 'info',
        title: `${summary.requests} request · ~$${summary.estimatedCostUsd.toFixed(4)} (7 ngày)`,
        body: `vào ${summary.inputTokens.toLocaleString('vi-VN')} · ra ${summary.outputTokens.toLocaleString('vi-VN')}`,
      })
      return true
    }

    case 'logs': {
      const limit = Number.parseInt(input.trim(), 10)
      const lines = await api.app.logs(Number.isFinite(limit) ? limit : 15)
      toast({
        level: 'info',
        title: `${lines.length} dòng log`,
        body: lines.slice(-8).join('\n'),
      })
      return true
    }

    case 'archive': {
      if (!sessionId) return noSession()
      await api.sessions.update(sessionId, { archived: true })
      await queryClient.invalidateQueries({ queryKey: qk.sessions() })
      toast({ level: 'success', title: 'Đã lưu trữ phiên' })
      return true
    }

    case 'pin': {
      if (!sessionId) return noSession()
      const session = await api.sessions.get(sessionId)
      await api.sessions.update(sessionId, { pinned: !session.pinned })
      await queryClient.invalidateQueries({ queryKey: qk.sessions() })
      await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      toast({ level: 'success', title: session.pinned ? 'Đã bỏ ghim' : 'Đã ghim phiên' })
      return true
    }

    case 'redo': {
      const undone = useAppStore.getState().undonePrompt
      if (!undone) {
        toast({ level: 'info', title: 'Không có lượt nào để gửi lại' })
        return true
      }
      useAppStore.getState().setUndonePrompt(null)
      await send(undone)
      return true
    }

    case 'rename': {
      if (!sessionId) return noSession()
      const title = input.trim()
      if (!title) {
        toast({ level: 'info', title: 'Cần tên mới', body: 'Ví dụ: /rename Sửa luồng OAuth' })
        return true
      }
      await api.sessions.update(sessionId, { title })
      await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      await queryClient.invalidateQueries({ queryKey: qk.sessions() })
      toast({ level: 'success', title: 'Đã đổi tên phiên' })
      return true
    }

    case 'stats': {
      if (!sessionId) return noSession()
      const stats = await api.stats.session(sessionId)
      const ttft = stats.ttftCount > 0 ? Math.round(stats.ttftMs / stats.ttftCount) : 0
      toast({
        level: 'info',
        title: `${stats.turns} lượt · ${(stats.inputTokens + stats.outputTokens).toLocaleString('vi-VN')} token`,
        body: `vào ${stats.inputTokens.toLocaleString('vi-VN')} · ra ${stats.outputTokens.toLocaleString('vi-VN')} · cache ${stats.cachedTokens.toLocaleString('vi-VN')} · TTFT TB ${ttft} ms`,
      })
      return true
    }

    case 'sync': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const fetched = await api.git.fetch(project)
      const pulled = await api.git.pull(project)
      await queryClient.invalidateQueries({ queryKey: qk.gitStatus(project) })
      await queryClient.invalidateQueries({ queryKey: qk.gitLog(project) })
      toast({
        level: 'success',
        title: 'Đã fetch và pull',
        body: (pulled || fetched).slice(0, 200),
      })
      return true
    }

    case 'push': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const output = await api.git.push(project)
      await queryClient.invalidateQueries({ queryKey: qk.gitStatus(project) })
      toast({ level: 'success', title: 'Đã push', body: output.slice(0, 200) })
      return true
    }

    case 'discard': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const paths = parseArgs(input)
      if (paths.length === 0) {
        toast({
          level: 'info',
          title: 'Cần đường dẫn cụ thể',
          body: 'Ví dụ: /discard src/app.ts. Lệnh này bỏ thay đổi và không hoàn tác được.',
        })
        return true
      }
      await api.git.discard(project, paths)
      await queryClient.invalidateQueries({ queryKey: qk.gitStatus(project) })
      toast({ level: 'success', title: `Đã bỏ thay đổi ${paths.length} tệp` })
      return true
    }

    case 'pause':
      if (!ctx.taskId) {
        toast({ level: 'info', title: 'Không có tác vụ đang chạy' })
        return true
      }
      {
        const result = await api.agent.stopAfterTurn(ctx.taskId)
        toast(
          result.stopped
            ? { level: 'info', title: 'Sẽ dừng sau khi hết lượt này' }
            : { level: 'info', title: 'Không đặt được', body: result.reason ?? '' },
        )
      }
      return true

    case 'approve':
    case 'deny': {
      const pending = useAppStore.getState().approvals[0]
      if (!pending) {
        toast({ level: 'info', title: 'Không có yêu cầu nào đang chờ' })
        return true
      }
      await api.agent.approve(pending.id, name === 'approve')
      useAppStore.getState().removeApproval(pending.id)
      toast({ level: 'info', title: name === 'approve' ? 'Đã cho phép' : 'Đã từ chối' })
      return true
    }

    case 'goal': {
      const session = ctx.sessionId
      if (!session) {
        toast({ level: 'info', title: 'Cần mở một phiên trước' })
        return true
      }
      const store = useAppStore.getState()
      const key = `goal.${session}`
      const arg = input.trim()
      if (!arg) {
        const goal = store.settings[key] as { objective?: string; rounds?: number } | undefined
        toast(
          goal?.objective
            ? {
                level: 'info',
                title: 'Mục tiêu hiện tại',
                body: `${goal.objective}${goal.rounds ? ` · ${goal.rounds} lượt` : ''}`,
              }
            : { level: 'info', title: 'Chưa có mục tiêu', body: 'Đặt bằng /goal <mục tiêu>' },
        )
        return true
      }
      if (['clear', 'xoá', 'xoa', 'done', 'xong'].includes(arg.toLowerCase())) {
        store.setSetting(key, null)
        toast({ level: 'success', title: 'Đã xoá mục tiêu' })
        return true
      }
      store.setSetting(key, { objective: arg, createdAt: Date.now(), rounds: 0 })
      toast({
        level: 'success',
        title: 'Đã đặt mục tiêu',
        body: 'Agent sẽ theo mục tiêu này qua các lượt và báo khi xong.',
      })
      return true
    }

    case 'sandbox': {
      const currentMode = sessionId
        ? (await api.sessions.get(sessionId)).permissionMode
        : ((useAppStore.getState().settings['agent.permissionMode'] as PermissionMode) ??
          'workspace-write')
      const wanted = input.trim()
      let mode: PermissionMode = currentMode as PermissionMode
      if (wanted) {
        const match = PERMISSION_MODES.find((entry) => entry.value === wanted)
        if (!match) {
          toast({
            level: 'info',
            title: 'Chế độ sandbox không hợp lệ',
            body: PERMISSION_MODES.map((entry) => entry.value).join(' · '),
          })
          return true
        }
        mode = match.value
        if (sessionId) {
          await api.sessions.update(sessionId, { permissionMode: mode })
          await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
        }
        useAppStore.getState().setSetting('agent.permissionMode', mode)
      }
      const policy = await api.agent.sandboxPolicy(mode)
      const inside = policy.rules.map((rule) => `${rule.risk}:${rule.inside}`).join(' ')
      const outside = policy.rules.map((rule) => `${rule.risk}:${rule.outside}`).join(' ')
      toast({
        level: 'info',
        title: `Sandbox: ${PERMISSION_MODES.find((entry) => entry.value === mode)?.label ?? mode}`,
        body: `trong dự án → ${inside}\nngoài dự án → ${outside}`,
      })
      return true
    }

    case 'permissions': {
      const wanted = input.trim()
      if (!wanted) {
        const current = sessionId
          ? ((await api.sessions.get(sessionId)).permissionMode as PermissionMode)
          : ((useAppStore.getState().settings['agent.permissionMode'] as PermissionMode) ??
            'workspace-write')
        toast({
          level: 'info',
          title: `Quyền hiện tại: ${PERMISSION_MODES.find((entry) => entry.value === current)?.label ?? current}`,
          body: PERMISSION_MODES.map((entry) => entry.value).join(' · '),
        })
        return true
      }
      const match = PERMISSION_MODES.find((entry) => entry.value === wanted)
      if (!match) {
        toast({
          level: 'info',
          title: 'Giá trị quyền không hợp lệ',
          body: PERMISSION_MODES.map((entry) => entry.value).join(' · '),
        })
        return true
      }
      if (sessionId) {
        await api.sessions.update(sessionId, { permissionMode: match.value })
        await queryClient.invalidateQueries({ queryKey: qk.session(sessionId) })
      }
      useAppStore.getState().setSetting('agent.permissionMode', match.value)
      toast({ level: 'success', title: `Quyền: ${match.label}` })
      return true
    }

    case 'tools': {
      const tools = await api.agent.tools()
      toast({
        level: 'info',
        title: `${tools.length} tool khả dụng`,
        body: tools.map((tool) => tool.name).join(' '),
      })
      return true
    }

    case 'find': {
      const query = input.trim()
      if (!query) {
        toast({ level: 'info', title: 'Cần từ khoá', body: 'Ví dụ: /find handleSubmit' })
        return true
      }
      const found = await api.search.global(query)
      toast({
        level: 'info',
        title: `${found.files.length} tệp · ${found.sessions.length} phiên · ${found.tasks.length} tác vụ`,
        body: found.files
          .slice(0, 5)
          .map((file) => `${file.path}${file.line ? `:${file.line}` : ''}`)
          .join('\n'),
      })
      return true
    }

    case 'log': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const limit = Number.parseInt(input.trim(), 10)
      try {
        const commits = await api.git.log(project, Number.isFinite(limit) ? limit : 5)
        toast({
          level: 'info',
          title: `${commits.length} commit gần nhất`,
          body: commits.map((commit) => `${commit.hash.slice(0, 7)} ${commit.subject}`).join('\n'),
        })
      } catch (error) {
        toast({ level: 'error', title: 'Không đọc được git log', body: (error as Error).message })
      }
      return true
    }

    case 'branch': {
      const project = ctx.projectId
      if (!project) {
        toast({ level: 'info', title: 'Cần mở một dự án trước' })
        return true
      }
      const wanted = input.trim()
      const branches = await api.git.branches(project)
      if (!wanted) {
        toast({
          level: 'info',
          title: `Nhánh hiện tại: ${branches.current ?? '(detached)'}`,
          body: branches.all.slice(0, 12).join(' · '),
        })
        return true
      }
      const create = !branches.all.includes(wanted)
      await api.git.checkout(project, wanted, create)
      await queryClient.invalidateQueries({ queryKey: qk.gitStatus(project) })
      await queryClient.invalidateQueries({ queryKey: qk.gitLog(project) })
      toast({
        level: 'success',
        title: create ? `Đã tạo và chuyển sang ${wanted}` : `Đã chuyển sang ${wanted}`,
      })
      return true
    }

    case 'stop':
      if (!ctx.taskId) {
        toast({ level: 'info', title: 'Không có tác vụ đang chạy' })
        return true
      }
      await api.agent.cancel(ctx.taskId)
      toast({ level: 'info', title: 'Đã yêu cầu dừng tác vụ' })
      return true

    case 'resume': {
      const active = await api.agent.active()
      const wanted = input.trim()
      const target = wanted
        ? active.find((task) => task.id === wanted)
        : (active.find((task) => ['failed', 'cancelled'].includes(task.state)) ?? active[0])
      if (!target) {
        toast({ level: 'info', title: 'Không có tác vụ để tiếp tục' })
        return true
      }
      await api.agent.resume(target.id)
      toast({ level: 'success', title: 'Đang tiếp tục tác vụ', body: target.title })
      return true
    }

    case 'context': {
      const taskId = ctx.taskId ?? (await api.agent.active())[0]?.id
      if (!taskId) {
        toast({ level: 'info', title: 'Chưa có tác vụ nào để đo context' })
        return true
      }
      const usage = await api.agent.contextUsage(taskId)
      toast({
        level: 'info',
        title: `Context ${usage.percent}%`,
        body: `${usage.totalTokens}/${usage.contextWindow} token · ${usage.messageCount} tin nhắn · ${usage.toolCount} tool`,
      })
      return true
    }

    case 'commands': {
      const names = ctx.custom.map((command) => `/${command.name}`)
      toast({
        level: 'info',
        title: `${names.length} lệnh riêng`,
        body: names.length ? names.join(' ') : 'Chưa có lệnh riêng trong .nexus/commands.',
      })
      return true
    }

    case 'agents': {
      toast({
        level: 'info',
        title: 'Agent modes',
        body: AGENT_MODES.join(' · '),
      })
      return true
    }

    case 'effort': {
      const wanted = input.trim() as ModelReasoningEffort
      const models = await api.models.list()
      const current = models.find((entry) => entry.isDefault) ?? models[0]
      if (!current) {
        toast({ level: 'info', title: 'Chưa có model' })
        return true
      }
      if (!wanted) {
        toast({
          level: 'info',
          title: `Effort hiện tại: ${current.reasoningEffort}`,
          body: 'off · minimal · low · medium · high',
        })
        return true
      }
      await api.models.save({
        id: current.id,
        providerId: current.providerId,
        modelId: current.modelId,
        reasoningEffort: wanted,
        variant: current.variant ?? '',
      })
      await queryClient.invalidateQueries({ queryKey: qk.models })
      toast({ level: 'success', title: `Effort: ${wanted}` })
      return true
    }

    case 'theme': {
      const next = store.theme === 'dark' ? 'light' : 'dark'
      store.setTheme(next)
      toast({ level: 'info', title: `Theme: ${next}` })
      return true
    }

    case 'quit': {
      window.close()
      return true
    }

    case 'help': {
      const names = [
        ...BUILTIN_COMMANDS.map((command) => `/${command.name}`),
        ...ctx.custom.map((command) => `/${command.name}`),
      ]
      toast({ level: 'info', title: `${names.length} lệnh`, body: names.join(' ') })
      return true
    }
  }

  const custom = ctx.custom.find((entry) => entry.name === name)
  if (custom) {
    await send(expandTemplate(custom.template, input))
    return true
  }
  return false
}
