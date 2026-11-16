import type {
  ApprovalRequest,
  Message,
  NexusErrorPayload,
  Task,
  TaskState,
  ToolCallRecord,
} from './types'

export type NexusEvent =
  | { type: 'agent.task.created'; payload: { task: Task } }
  | { type: 'agent.task.started'; payload: { taskId: string; sessionId?: string } }
  | { type: 'agent.task.queued'; payload: { taskId: string; sessionId: string; title?: string } }
  | { type: 'agent.state.changed'; payload: { taskId: string; state: TaskState } }
  | { type: 'agent.plan.created'; payload: { taskId: string; plan: Task['plan'] } }
  | { type: 'agent.step.started'; payload: { taskId: string; stepId: string; title: string } }
  | {
      type: 'agent.step.completed'
      payload: { taskId: string; stepId: string; state: 'completed' | 'failed' | 'skipped' }
    }
  | {
      type: 'agent.message.started'
      payload: { sessionId: string; messageId: string; role: 'assistant' }
    }
  | { type: 'agent.text.delta'; payload: { messageId: string; delta: string } }
  | { type: 'agent.reasoning.delta'; payload: { messageId: string; delta: string } }
  | { type: 'agent.message.completed'; payload: { messageId: string; content: string } }
  | { type: 'agent.tool.started'; payload: { call: ToolCallRecord } }
  | { type: 'agent.tool.completed'; payload: { call: ToolCallRecord } }
  | { type: 'agent.tool.failed'; payload: { call: ToolCallRecord } }
  | { type: 'agent.approval.required'; payload: ApprovalRequest }
  | { type: 'agent.approval.resolved'; payload: { id: string; approved: boolean } }
  | { type: 'agent.steer.queued'; payload: { taskId: string; prompt: string } }
  | { type: 'agent.stop.queued'; payload: { taskId: string } }
  | {
      type: 'agent.steer.delivered'
      payload: { taskId: string; sessionId: string; prompt: string; message?: Message }
    }
  | { type: 'agent.task.rewound'; payload: { taskId: string; sessionId: string; reverted: number } }
  | { type: 'agent.task.completed'; payload: { task: Task } }
  | { type: 'agent.task.failed'; payload: { taskId: string; error: NexusErrorPayload } }
  | { type: 'agent.task.cancelled'; payload: { taskId: string } }
  | { type: 'agent.usage'; payload: { taskId?: string; sessionId: string; messageId?: string } }
  | {
      type: 'agent.context.compacted'
      payload: { taskId: string; sessionId: string; messages: number }
    }
  | {
      type: 'agent.loop.tick'
      payload: {
        taskId: string
        sessionId: string
        iteration: number
        toolCalls: number
        elapsedMs: number
        contextTokens: number
      }
    }
  | {
      type: 'session.rewound'
      payload: { sessionId: string; messageId: string; removed: number; reverted: number }
    }
  | { type: 'workspace.file.changed'; payload: { projectId?: string; path: string; kind: string } }
  | { type: 'git.status.changed'; payload: { projectId: string } }
  | { type: 'terminal.output'; payload: { terminalId: string; data: string } }
  | { type: 'terminal.exit'; payload: { terminalId: string; exitCode: number } }
  | { type: 'terminal.list'; payload: { terminals: unknown[] } }
  | { type: 'provider.status'; payload: { providerId: string; status: string; detail?: string } }
  | { type: 'mcp.server.status'; payload: { serverId: string; status: string } }
  | {
      type: 'notification'
      payload: {
        id: string
        level: 'info' | 'success' | 'warning' | 'error'
        title: string
        body?: string
        sessionId?: string
        taskId?: string
      }
    }
  | { type: 'app.ready'; payload: { version: string } }
  | { type: 'app.core.restarted'; payload: Record<string, never> }
  | { type: 'app.command'; payload: { command: string } }

export type EventListener = (event: NexusEvent) => void

export interface NexusEventEnvelope {
  id: string
  seq: number
  ts: number
  event: NexusEvent
}

export class EventBus {
  private listeners = new Set<EventListener>()

  on(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: NexusEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* listener isolation */
      }
    }
  }
}
