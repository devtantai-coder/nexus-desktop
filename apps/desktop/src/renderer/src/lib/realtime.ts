import { openProject } from './actions'
import { api } from './api'
import { queryClient, qk } from './query'
import { useAppStore } from '../store/app-store'

const treeTimers = new Map<string, NodeJS.Timeout>()
const taskTimers = new Map<string, NodeJS.Timeout>()
/** Nhiều task chạy cùng lúc: chỉ đổi mood terminal khi task cuối kết thúc. */
const runningTasks = new Set<string>()

function taskStarted(taskId: string, store: typeof useAppStore): void {
  runningTasks.add(taskId)
  store.getState().setPetMood('thinking')
}

function taskEnded(
  taskId: string,
  mood: 'success' | 'error' | 'idle',
  store: typeof useAppStore,
): void {
  runningTasks.delete(taskId)
  if (runningTasks.size === 0) store.getState().setPetMood(mood)
}

function scheduleTaskInvalidation(taskId: string): void {
  if (!taskId) return
  const existing = taskTimers.get(taskId)
  if (existing) clearTimeout(existing)
  taskTimers.set(
    taskId,
    setTimeout(() => {
      taskTimers.delete(taskId)
      void queryClient.invalidateQueries({ queryKey: qk.task(taskId) })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }, 150),
  )
}

function scheduleTreeInvalidation(projectId: string): void {
  const existing = treeTimers.get(projectId)
  if (existing) clearTimeout(existing)
  treeTimers.set(
    projectId,
    setTimeout(() => {
      treeTimers.delete(projectId)
      void queryClient.invalidateQueries({ queryKey: ['tree', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['file', projectId] })
    }, 400),
  )
}

export function installRealtime(): () => void {
  const store = useAppStore
  const off = window.nexus.onEvent((envelope) => {
    const event = envelope.event
    switch (event.type) {
      case 'agent.message.started':
        store.getState().startLive(event.payload.messageId, event.payload.sessionId)
        break
      case 'agent.text.delta':
        store.getState().appendLive(event.payload.messageId, event.payload.delta, 'text')
        break
      case 'agent.reasoning.delta':
        store.getState().appendLive(event.payload.messageId, event.payload.delta, 'reasoning')
        break
      case 'agent.delta':
        store
          .getState()
          .appendLivePair(event.payload.messageId, event.payload.text, event.payload.reasoning)
        break
      case 'agent.message.completed': {
        const live = store.getState().live[event.payload.messageId]
        store.getState().finishLive(event.payload.messageId, event.payload.content)
        // Payload có thể không có sessionId (message hoàn tất trước khi startLive) → fallback prefix.
        const sessionId =
          (event.payload as { sessionId?: string }).sessionId ?? live?.sessionId ?? ''
        if (sessionId) void queryClient.invalidateQueries({ queryKey: qk.messages(sessionId) })
        else void queryClient.invalidateQueries({ queryKey: ['messages'] })
        break
      }
      case 'agent.steer.queued':
        store.getState().bumpSteer(event.payload.taskId, 1)
        break
      case 'agent.steer.delivered':
        store.getState().bumpSteer(event.payload.taskId, -1)
        void queryClient.invalidateQueries({ queryKey: qk.messages(event.payload.sessionId) })
        break
      case 'agent.task.rewound': {
        void queryClient.invalidateQueries({ queryKey: ['changes'] })
        void queryClient.invalidateQueries({ queryKey: qk.messages(event.payload.sessionId) })
        void queryClient.invalidateQueries({ queryKey: ['git-status'] })
        void queryClient.invalidateQueries({ queryKey: ['git-log'] })
        break
      }
      case 'session.rewound': {
        void queryClient.invalidateQueries({ queryKey: qk.messages(event.payload.sessionId) })
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        void queryClient.invalidateQueries({ queryKey: ['changes'] })
        void queryClient.invalidateQueries({ queryKey: ['git-status'] })
        void queryClient.invalidateQueries({ queryKey: ['git-log'] })
        break
      }
      case 'agent.usage':
        void queryClient.invalidateQueries({ queryKey: ['session-stats'] })
        break
      case 'agent.loop.tick':
        store.getState().setLoopTick(event.payload.taskId, {
          iteration: event.payload.iteration,
          toolCalls: event.payload.toolCalls,
          elapsedMs: event.payload.elapsedMs,
          contextTokens: event.payload.contextTokens,
        })
        break
      case 'agent.context.compacted':
        void queryClient.invalidateQueries({
          queryKey: ['context-usage', event.payload.taskId],
        })
        store.getState().toast({
          level: 'info',
          title: 'Đã nén ngữ cảnh',
          body: 'Lịch sử cũ được rút gọn để tiếp tục tác vụ trong context window.',
        })
        break
      case 'app.core.restarted':
        void queryClient.invalidateQueries()
        store.getState().toast({
          level: 'info',
          title: 'Native core đã khôi phục',
          body: 'Tác vụ bị gián đoạn có thể được tiếp tục từ nút “Tiếp tục tác vụ”.',
        })
        break
      case 'agent.task.created':
        store.getState().setActiveTask(event.payload.task.id)
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        break
      case 'agent.task.queued':
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
        break
      case 'agent.task.started':
      case 'agent.state.changed':
      case 'agent.plan.created':
      case 'agent.step.started':
      case 'agent.step.completed':
      case 'agent.tool.started':
      case 'agent.tool.completed':
      case 'agent.tool.failed':
        scheduleTaskInvalidation(
          (event.payload as { taskId?: string }).taskId ??
            (event.payload as { call?: { taskId?: string } }).call?.taskId ??
            '',
        )
        if (event.type === 'agent.task.started') {
          const startedId =
            (event.payload as { taskId?: string }).taskId ??
            (event.payload as { task?: { id?: string } }).task?.id ??
            ''
          if (startedId) taskStarted(startedId, store)
          if (event.payload.sessionId) {
            void queryClient.invalidateQueries({
              queryKey: qk.messages(event.payload.sessionId),
            })
          }
        } else if (event.type === 'agent.state.changed') {
          if (event.payload.state === 'running') store.getState().setPetMood('thinking')
          else if (event.payload.state === 'failed') store.getState().setPetMood('error')
        }
        if (event.type === 'agent.tool.failed' && event.payload.call.error) {
          store.getState().toast({
            level: 'warning',
            title: `${event.payload.call.toolName} failed`,
            body: event.payload.call.error.message.slice(0, 300),
          })
        }
        break
      case 'agent.approval.required':
        store.getState().pushApproval(event.payload)
        if (store.getState().settings['app.notifyOnApproval'] !== false && !document.hasFocus()) {
          void api.app
            .notify('Cần bạn duyệt', event.payload.summary ?? 'Yêu cầu quyền mới', 'warning')
            .catch(() => undefined)
        }
        break
      case 'agent.approval.resolved':
        store.getState().removeApproval(event.payload.id)
        break
      case 'agent.task.completed': {
        const task = event.payload.task
        taskEnded(task.id, 'success', store)
        store.getState().clearLoopTick(task.id)
        store
          .getState()
          .setApprovals(
            store.getState().approvals.filter((approval) => approval.taskId !== task.id),
          )
        store.getState().toast({
          level: 'success',
          title: 'Tác vụ hoàn tất',
          body: task.title,
        })
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        void queryClient.invalidateQueries({ queryKey: qk.task(task.id) })
        void queryClient.invalidateQueries({ queryKey: qk.changes({ sessionId: task.sessionId }) })
        void queryClient.invalidateQueries({ queryKey: qk.messages(task.sessionId) })
        if (store.getState().activeTaskId === task.id) store.getState().setActiveTask(null)
        store.getState().clearSteer(task.id)
        // Thông báo OS khi cửa sổ không focus (như Codex), tôn trọng setting.
        if (store.getState().settings['app.notifyOnFinish'] !== false && !document.hasFocus()) {
          void api.app.notify('Tác vụ hoàn tất', task.title, 'success').catch(() => undefined)
        }
        break
      }
      case 'agent.task.failed': {
        taskEnded(event.payload.taskId, 'error', store)
        store.getState().clearSteer(event.payload.taskId)
        store.getState().clearLoopTick(event.payload.taskId)
        store.getState().toast({
          level: 'error',
          title: 'Tác vụ thất bại',
          body: event.payload.error.message.slice(0, 400),
        })
        store
          .getState()
          .setApprovals(
            store
              .getState()
              .approvals.filter((approval) => approval.taskId !== event.payload.taskId),
          )
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        break
      }
      case 'agent.task.cancelled': {
        taskEnded(event.payload.taskId, 'idle', store)
        store.getState().toast({ level: 'info', title: 'Đã huỷ tác vụ' })
        if (store.getState().activeTaskId === event.payload.taskId) {
          store.getState().setActiveTask(null)
        }
        store.getState().clearSteer(event.payload.taskId)
        store.getState().clearLoopTick(event.payload.taskId)
        break
      }
      case 'domain.selected':
        store.getState().setLastDomain({
          domainId: event.payload.domainId,
          confidence: event.payload.confidence,
        })
        break
      case 'workspace.file.changed':
        if (event.payload.projectId) scheduleTreeInvalidation(event.payload.projectId)
        break
      case 'git.status.changed':
        void queryClient.invalidateQueries({ queryKey: qk.gitStatus(event.payload.projectId) })
        void queryClient.invalidateQueries({ queryKey: qk.gitLog(event.payload.projectId) })
        break
      case 'terminal.output':
        window.dispatchEvent(new CustomEvent('nexus:terminal-output', { detail: event.payload }))
        break
      case 'terminal.exit':
        window.dispatchEvent(new CustomEvent('nexus:terminal-exit', { detail: event.payload }))
        break
      case 'provider.status':
        if (event.payload.status === 'error' && event.payload.detail) {
          store.getState().toast({
            level: 'warning',
            title: 'Lỗi nhà cung cấp AI',
            body: event.payload.detail.slice(0, 300),
          })
        }
        break
      case 'notification':
        store.getState().toast({
          level: event.payload.level,
          title: event.payload.title,
          body: event.payload.body,
          id: event.payload.id,
        })
        break
      case 'app.command':
        void handleCommand(event.payload.command)
        break
      default:
        break
    }
  })
  return () => {
    for (const timer of taskTimers.values()) clearTimeout(timer)
    taskTimers.clear()
    for (const timer of treeTimers.values()) clearTimeout(timer)
    treeTimers.clear()
    off()
  }
}

async function handleCommand(command: string): Promise<void> {
  const store = useAppStore.getState()
  if (command === 'new-task') {
    store.navigate({ name: 'home' })
    store.focusComposer()
  } else if (command === 'settings') {
    store.navigate({ name: 'settings' })
  } else if (command === 'toggle-sidebar') {
    store.toggleSidebar()
  } else if (command === 'palette' || command === 'search') {
    store.setPaletteOpen(true)
  } else if (command === 'open-project') {
    void openProject()
  }
}
