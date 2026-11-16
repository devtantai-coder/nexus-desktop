import type React from 'react'
import { useEffect, useState } from 'react'
import { CalendarClock, Pause, Play, Plus, Trash2 } from 'lucide-react'
import type { AgentMode, PermissionMode } from '@nexus/shared'
import { useAppStore } from '../kernel'
import { Button, Dialog, Field, Input, Select } from '../components/ui'
import { makeSchedule, readSchedules, tickSchedules, writeSchedules } from '../lib/schedules'
import type { Schedule } from '../lib/schedules'

const PRESETS = [15, 60, 360, 1440]

export function ScheduledPage(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const [list, setList] = useState<Schedule[]>([])
  const [dialog, setDialog] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [every, setEvery] = useState(60)
  const [mode, setMode] = useState<AgentMode>('agent')
  const [permission, setPermission] = useState<PermissionMode>('workspace-write')

  useEffect(() => {
    void readSchedules().then(setList)
  }, [])

  const save = async (next: Schedule[]): Promise<void> => {
    setList(next)
    await writeSchedules(next)
  }

  const add = async (): Promise<void> => {
    if (!prompt.trim()) return
    const schedule = makeSchedule({
      prompt: prompt.trim(),
      everyMinutes: every,
      projectId: activeProjectId,
      mode,
      permissionMode: permission,
    })
    await save([schedule, ...list])
    setDialog(false)
    setPrompt('')
    toast({ level: 'success', title: 'Đã tạo lịch' })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="drag-region flex h-[52px] shrink-0 items-center justify-between px-4">
        <h1 className="text-[14px] font-medium text-[var(--text)]">Scheduled</h1>
        <button
          type="button"
          onClick={() => setDialog(true)}
          className="no-drag flex h-7 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-[13px] text-[var(--accent-contrast)] transition-opacity hover:opacity-90"
        >
          <Plus size={14} />
          New task
        </button>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="text-[28px]">🕗</span>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">Schedule a task</h2>
            <p className="max-w-[380px] text-[13px] leading-5 text-[var(--text-faint)]">
              NEXUS can take care of ongoing tasks so you don’t have to.
            </p>
            <button
              type="button"
              onClick={() => setDialog(true)}
              className="mt-1 flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 text-[13px] text-[var(--accent-contrast)]"
            >
              <Plus size={14} />
              New task
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[736px]">
            {list.map((schedule) => (
              <div
                key={schedule.id}
                className="group mb-1.5 flex items-center gap-3 rounded-[12.5px] border border-[var(--border)] px-3 py-2.5"
              >
                <CalendarClock size={16} className="shrink-0 text-[var(--text-faint)]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-[var(--text)]">{schedule.title}</div>
                  <div className="mt-0.5 truncate text-[12.5px] text-[var(--text-faint)]">
                    every {schedule.everyMinutes}m · next{' '}
                    {new Date(schedule.nextRunAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={schedule.enabled ? 'Pause' : 'Resume'}
                  onClick={() =>
                    void save(
                      list.map((item) =>
                        item.id === schedule.id ? { ...item, enabled: !item.enabled } : item,
                      ),
                    )
                  }
                  className="icon-btn-sm"
                >
                  {schedule.enabled ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  type="button"
                  aria-label="Run now"
                  onClick={() => void tickSchedules().then(() => save(list))}
                  className="icon-btn-sm"
                >
                  <Play size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Delete schedule"
                  onClick={() => void save(list.filter((item) => item.id !== schedule.id))}
                  className="icon-btn-sm opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="New scheduled task"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void add()}>
              Create
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Prompt">
            <Input
              autoFocus
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Kiểm tra CI và báo lỗi mới"
            />
          </Field>
          <Field label="Repeat every">
            <Select
              value={String(every)}
              options={PRESETS.map((minutes) => ({
                value: String(minutes),
                label: minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`,
              }))}
              onValueChange={(value: string) => setEvery(Number(value))}
              ariaLabel="Repeat every"
            />
          </Field>
          <Field label="Mode">
            <Select
              value={mode}
              options={[
                { value: 'agent', label: 'Agent' },
                { value: 'plan', label: 'Plan' },
                { value: 'review', label: 'Review' },
              ]}
              onValueChange={(value: string) => setMode(value as AgentMode)}
              ariaLabel="Mode"
            />
          </Field>
          <Field label="Permissions">
            <Select
              value={permission}
              options={[
                { value: 'read-only', label: 'Read only' },
                { value: 'workspace-write', label: 'Workspace write' },
                { value: 'unrestricted', label: 'Full access' },
              ]}
              onValueChange={(value: string) => setPermission(value as PermissionMode)}
              ariaLabel="Permissions"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  )
}
