import type { Store } from './store.ts'
import { runProcess, trim, utf8Prefix } from './util.ts'

export type Json = any

export const loadHooks = (store: Store): Json => {
  const value = store.settingGet('agent.hooks', {})
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export interface MatchingHook {
  command?: unknown
  matcher?: unknown
  timeoutMs?: unknown
}

export const matchingHooks = (hooks: Json, event: string, toolName: string): MatchingHook[] => {
  const result: MatchingHook[] = []
  const list = hooks?.[event]
  if (!Array.isArray(list)) return result
  for (const hook of list as Json[]) {
    if (hook === null || typeof hook !== 'object') continue
    const command = typeof hook['command'] === 'string' ? hook['command'] : ''
    if (trim(command) === '') continue
    const matcher = typeof hook['matcher'] === 'string' ? hook['matcher'] : ''
    let matches = matcher === ''
    if (!matches) {
      try {
        matches = new RegExp(matcher, 'i').test(toolName)
      } catch {
        matches = matcher === toolName
      }
    }
    if (matches) result.push(hook as MatchingHook)
  }
  return result
}

export interface HookResult {
  ran: boolean
  code: number
  output: string
  timedOut: boolean
}

const settingIntLike = (value: Json, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

export const runHook = async (
  hook: MatchingHook,
  cwd: string,
  event: string,
  toolName: string,
  args: Json,
  taskId: string,
  sessionId: string,
  projectId: string,
): Promise<HookResult> => {
  const command = typeof hook['command'] === 'string' ? hook['command'] : ''
  if (trim(command) === '') return { ran: false, code: 0, output: '', timedOut: false }
  const timeout = Math.min(Math.max(settingIntLike(hook['timeoutMs'], 30000), 1000), 300000)
  const env = [
    `NEXUS_HOOK_EVENT=${event}`,
    `NEXUS_TOOL_NAME=${toolName}`,
    `NEXUS_TOOL_ARGS=${utf8Prefix(JSON.stringify(args ?? {}), 16000)}`,
    `NEXUS_TASK_ID=${taskId}`,
    `NEXUS_SESSION_ID=${sessionId}`,
    `NEXUS_PROJECT_ID=${projectId}`,
  ]
  const executed = await runProcess(['/bin/bash', '-lc', trim(command)], cwd, timeout, env)
  const out = executed.out
  const err = executed.err
  return {
    ran: true,
    code: executed.code,
    timedOut: executed.timedOut,
    output: trim(out + (err === '' ? '' : `\n${err}`)),
  }
}
