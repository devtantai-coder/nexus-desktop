import type React from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, useAppStore } from '../kernel'
import { Badge, Button, Input } from '../components/ui'

type Row = Record<string, unknown>
const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])

export function DomainPage(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const [selected, setSelected] = useState('web')
  const [intentPrompt, setIntentPrompt] = useState('')
  const [intentBusy, setIntentBusy] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [result, setResult] = useState<Row | null>(null)
  const [plan, setPlan] = useState<Row | null>(null)
  const [approved, setApproved] = useState(false)
  const [installResults, setInstallResults] = useState<Row[]>([])
  const [events, setEvents] = useState<Row[]>([])

  const domains = useQuery({ queryKey: ['domain-list'], queryFn: () => api.domain.list() })
  const environment = useQuery({
    queryKey: ['domain-env'],
    queryFn: () => api.domain.environment(),
  })
  const tools = useQuery({ queryKey: ['domain-tools'], queryFn: () => api.domain.tools() })

  const domainRows = rows(domains.data)
  const toolRows = rows(tools.data).filter((tool) => str(tool['domain']) === selected)
  const env = (environment.data ?? {}) as Row

  const act = async (
    action: 'project.create' | 'build' | 'test' | 'simulate' | 'debug' | 'report',
    extra: Row = {},
  ): Promise<Row> => {
    const output = (await api.domain.action({ domainId: selected, action, ...extra })) as Row
    setResult(output)
    return output
  }

  const detectIntent = async (): Promise<void> => {
    const prompt = intentPrompt.trim()
    if (prompt === '' || intentBusy) return
    setIntentBusy(true)
    try {
      const matches = rows(await api.domain.intent(prompt))
      const top = matches[0]
      if (top === undefined) {
        toast({
          level: 'warning',
          title: 'Không nhận ra domain',
          body: 'Thử prompt cụ thể hơn (ví dụ: docker, cmake, torch…).',
        })
        return
      }
      setSelected(str(top['domainId']))
      setPlan(null)
      setResult(null)
      toast({
        level: 'info',
        title: `Domain: ${str(top['domainId'])} · confidence ${String(top['confidence'] ?? '')}`,
        body: Array.isArray(top['reasons']) ? (top['reasons'] as string[]).join(', ') : '',
      })
    } catch (error) {
      toast({ level: 'error', title: 'Detect lỗi', body: String((error as Error).message) })
    } finally {
      setIntentBusy(false)
    }
  }

  const createProject = async (): Promise<void> => {
    try {
      const output = await act(
        'project.create',
        projectName.trim() === '' ? {} : { name: projectName.trim() },
      )
      if (output['ok'] !== true) throw new Error(str(output['error']) || 'Không tạo được project')
      setProjectPath(str(output['path']))
      toast({ level: 'success', title: 'Đã tạo project', body: str(output['path']) })
    } catch (error) {
      toast({ level: 'error', title: 'Tạo project lỗi', body: String((error as Error).message) })
    }
  }

  const run = async (action: 'build' | 'test'): Promise<void> => {
    if (projectPath === '') {
      toast({
        level: 'warning',
        title: 'Chưa có project',
        body: 'Tạo project trước khi chạy build/test.',
      })
      return
    }
    try {
      const output = await act(action, { path: projectPath })
      toast({
        level: output['ok'] === true ? 'success' : 'error',
        title: action === 'build' ? 'Build' : 'Test',
        body: `exit ${String(output['exitCode'] ?? '-')} · ${String(output['durationMs'] ?? 0)} ms`,
      })
    } catch (error) {
      toast({ level: 'error', title: `${action} lỗi`, body: String((error as Error).message) })
    }
  }

  const loadPlan = async (): Promise<void> => {
    try {
      setPlan((await api.domain.dependency.plan(selected)) as Row)
    } catch (error) {
      toast({
        level: 'error',
        title: 'Không lập kế hoạch được',
        body: String((error as Error).message),
      })
    }
  }

  const installMissing = async (): Promise<void> => {
    const missing = rows(plan?.['items'])
      .filter((item) => item['available'] !== true)
      .map((item) => str(item['toolId']))
    if (missing.length === 0) {
      toast({ level: 'info', title: 'Không có tool thiếu' })
      return
    }
    try {
      const output = await api.domain.dependency.install(selected, missing, approved)
      setInstallResults(rows(output))
      setEvents(rows(await api.domain.dependency.events(20)))
      toast({ level: 'success', title: 'Đã xử lý yêu cầu cài đặt' })
    } catch (error) {
      toast({ level: 'error', title: 'Cài đặt lỗi', body: String((error as Error).message) })
    }
  }

  return (
    <div className="mx-auto h-full w-full max-w-[1180px] overflow-auto px-7 py-6">
      <header className="mb-4">
        <h1 className="text-[19px] font-semibold">Universal Workspace</h1>
        <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">
          Domain Explorer, dependency manager và build/test chạy bằng tool thật đã phát hiện được.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="Mô tả tác vụ"
          value={intentPrompt}
          onChange={(event) => setIntentPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void detectIntent()
          }}
          placeholder="Mô tả tác vụ: huấn luyện torch, sửa lỗi cmake, docker compose…"
          className="min-w-[260px] flex-1 text-[12px]"
        />
        <Button
          size="xs"
          variant="secondary"
          disabled={intentBusy}
          onClick={() => void detectIntent()}
        >
          {intentBusy ? 'Đang soi…' : 'Detect domain'}
        </Button>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-[13px] font-medium">Domain Explorer</h2>
        <div className="flex flex-wrap gap-2">
          {domainRows.map((domain) => {
            const id = str(domain['id'])
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelected(id)
                  setPlan(null)
                  setResult(null)
                }}
                aria-pressed={selected === id}
                className={`rounded-[var(--radius)] border px-3 py-2 text-left transition-colors ${
                  selected === id
                    ? 'border-[var(--accent)] bg-[var(--bg-hover)]'
                    : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="block text-[12.5px] font-medium">
                  {str(domain['label']) || id}
                </span>
                <span className="block text-[11px] text-[var(--text-faint)]">
                  {String(domain['toolCount'] ?? 0)} tools ·{' '}
                  {str(domain['description']).slice(0, 60)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-[var(--radius)] border border-[var(--border)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium">Environment</h2>
            <Button size="xs" variant="secondary" onClick={() => void environment.refetch()}>
              Làm mới
            </Button>
          </div>
          <div className="space-y-1 font-mono text-[11.5px] text-[var(--text-muted)]">
            <p>
              platform: {str(env['platform'])} · arch: {str(env['arch'])}
            </p>
            <p>
              node: {str(env['nodeVersion'])} · PATH: {rows(env['pathEntries']).length} mục
            </p>
            <p>shell: {str(env['shell']) || '—'}</p>
          </div>
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--border)] p-4">
          <h2 className="mb-3 text-[13px] font-medium">Tools · {selected}</h2>
          <div className="max-h-[190px] space-y-1.5 overflow-auto">
            {toolRows.length === 0 ? (
              <p className="text-[12px] text-[var(--text-faint)]">Domain này chưa khai báo tool.</p>
            ) : (
              toolRows.map((tool) => {
                const available = tool['availability'] === 'available'
                return (
                  <div key={str(tool['id'])} className="flex items-center justify-between gap-3">
                    <span className="truncate text-[12px]">
                      {str(tool['name'])}{' '}
                      <span className="font-mono text-[10.5px] text-[var(--text-faint)]">
                        {str(tool['executable'])}
                      </span>
                    </span>
                    <Badge tone={available ? 'success' : 'neutral'}>
                      {available ? str(tool['version']).slice(0, 28) || 'available' : 'missing'}
                    </Badge>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-[var(--radius)] border border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium">Dependency Manager</h2>
          <Button size="xs" variant="secondary" onClick={() => void loadPlan()}>
            Kiểm tra dependencies
          </Button>
        </div>
        {plan === null ? (
          <p className="text-[12px] text-[var(--text-faint)]">
            Chưa lập kế hoạch. Bấm “Kiểm tra dependencies”.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11.5px] text-[var(--text-muted)]">
              thiếu: {String((plan['missing'] as string[] | undefined)?.length ?? 0)} · không hỗ
              trợ: {String((plan['unsupported'] as string[] | undefined)?.length ?? 0)}
            </p>
            <div className="max-h-[170px] space-y-1 overflow-auto">
              {rows(plan['items']).map((item) => (
                <div key={str(item['toolId'])} className="flex justify-between gap-3 text-[11.5px]">
                  <span>{str(item['name'])}</span>
                  <span className="font-mono text-[var(--text-faint)]">
                    {item['available'] === true
                      ? 'có sẵn'
                      : item['requiresRoot'] === true
                        ? 'cần root'
                        : 'có thể cài'}
                  </span>
                </div>
              ))}
            </div>
            <label className="mt-3 flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              Tôi xác nhận cho phép cài dependency thuộc domain này
            </label>
            <div className="mt-2">
              <Button size="xs" variant="secondary" onClick={() => void installMissing()}>
                Cài tool thiếu
              </Button>
            </div>
            {installResults.length > 0 ? (
              <pre className="mt-3 max-h-[150px] overflow-auto rounded-[var(--radius)] bg-[var(--bg-inset)] p-2 text-[11px]">
                {installResults
                  .map(
                    (item) =>
                      `${str(item['toolId'])}: ${str(item['reason'] ?? (item['ok'] === true ? 'ok' : 'failed'))}${str(item['manualCommand']) ? ` → ${str(item['manualCommand'])}` : ''}`,
                  )
                  .join('\n')}
              </pre>
            ) : null}
            {events.length > 0 ? (
              <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                {events.length} bản ghi kiểm toán gần đây trong database.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="mt-5 rounded-[var(--radius)] border border-[var(--border)] p-4">
        <h2 className="mb-3 text-[13px] font-medium">Build &amp; Test · {selected}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Tên project"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="ten-project"
            className="w-[220px] text-[12px]"
          />
          <Button size="xs" variant="secondary" onClick={() => void createProject()}>
            Tạo project
          </Button>
          <Button size="xs" variant="secondary" onClick={() => void run('build')}>
            Build
          </Button>
          <Button size="xs" variant="secondary" onClick={() => void run('test')}>
            Test
          </Button>
        </div>
        {projectPath === '' ? null : (
          <p className="mt-2 break-all font-mono text-[11px] text-[var(--text-faint)]">
            {projectPath}
          </p>
        )}
        {result === null ? null : (
          <pre className="mt-3 max-h-[260px] overflow-auto rounded-[var(--radius)] bg-[var(--bg-inset)] p-3 text-[11px] leading-relaxed">
            {`ok=${String(result['ok'])} exit=${String(result['exitCode'] ?? '-')} passed=${String(result['passed'] ?? 0)} failed=${String(result['failed'] ?? 0)}\n${str(result['output'] ?? result['reason'] ?? '')}`}
          </pre>
        )}
      </section>
    </div>
  )
}
