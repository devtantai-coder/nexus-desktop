import type { AgentMode, PermissionMode } from '@nexus/shared'
import { api, queryClient, useAppStore } from '../kernel'

export interface Schedule {
  id: string
  title: string
  prompt: string
  projectId: string | null
  mode: AgentMode
  permissionMode: PermissionMode
  everyMinutes: number
  nextRunAt: number
  enabled: boolean
  lastRunAt?: number
}

const KEY = 'scheduled.tasks'

export async function readSchedules(): Promise<Schedule[]> {
  const all = (await api.settings.all()) as Record<string, unknown>
  const raw = all[KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is Schedule => Boolean(item) && typeof item === 'object')
}

export async function writeSchedules(list: Schedule[]): Promise<void> {
  await api.settings.set(KEY, list)
  await queryClient.invalidateQueries({ queryKey: ['scheduled.tasks'] })
}

export function makeSchedule(
  input: Partial<Schedule> & { prompt: string; everyMinutes: number },
): Schedule {
  return {
    id: crypto.randomUUID(),
    title: input.title?.trim() || input.prompt.slice(0, 60),
    prompt: input.prompt,
    projectId: input.projectId ?? null,
    mode: input.mode ?? 'agent',
    permissionMode: input.permissionMode ?? 'workspace-write',
    everyMinutes: input.everyMinutes,
    nextRunAt: Date.now() + input.everyMinutes * 60_000,
    enabled: true,
  }
}

async function runSchedule(schedule: Schedule): Promise<void> {
  const session = await api.sessions.create({
    projectId: schedule.projectId,
    mode: schedule.mode,
    permissionMode: schedule.permissionMode,
    title: schedule.title,
  })
  await api.agent.start({
    sessionId: session.id,
    prompt: schedule.prompt,
    mode: schedule.mode,
    permissionMode: schedule.permissionMode,
    ...(schedule.projectId ? { projectId: schedule.projectId } : {}),
  })
  await queryClient.invalidateQueries({ queryKey: ['sessions'] })
  useAppStore.getState().toast({ level: 'success', title: `Đã chạy: ${schedule.title}` })
}

/** Chạy các lịch đến hạn rồi dời nextRunAt. Gọi mỗi 30s từ App. */
export async function tickSchedules(): Promise<void> {
  const list = await readSchedules()
  const due = list.filter((item) => item.enabled && item.nextRunAt <= Date.now())
  if (!due.length) return
  const next = list.map((item) => {
    const hit = due.find((d) => d.id === item.id)
    return hit
      ? { ...item, lastRunAt: Date.now(), nextRunAt: Date.now() + item.everyMinutes * 60_000 }
      : item
  })
  await writeSchedules(next)
  for (const schedule of due) {
    try {
      await runSchedule(schedule)
    } catch (error) {
      useAppStore
        .getState()
        .toast({ level: 'error', title: `Lịch lỗi: ${schedule.title}`, body: (error as Error).message })
    }
  }
}
