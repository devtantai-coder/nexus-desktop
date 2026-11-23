import type React from 'react'
import { useState } from 'react'
import { ShieldAlert, Terminal } from 'lucide-react'
import { api, useAppStore, useT } from '../kernel'
import { Badge, Button, Dialog } from './ui'

export function ApprovalDialog(): React.JSX.Element {
  const t = useT()
  const approvals = useAppStore((state) => state.approvals)
  const removeApproval = useAppStore((state) => state.removeApproval)
  const toast = useAppStore((state) => state.toast)
  const [busy, setBusy] = useState(false)

  const approval = approvals[0]

  const resolve = async (approved: boolean, alwaysAllow = false): Promise<void> => {
    if (!approval) return
    setBusy(true)
    try {
      await api.agent.approve(approval.id, approved, alwaysAllow)
      removeApproval(approval.id)
    } catch (error) {
      toast({ level: 'error', title: 'Không phản hồi được', body: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(approval)}
      onOpenChange={(open) => {
        if (!open) void resolve(false)
      }}
      title="Agent yêu cầu phê duyệt"
      description={approval ? approval.reason : undefined}
      width={560}
      footer={
        approval ? (
          <>
            <Button variant="ghost" onClick={() => void resolve(false)} loading={busy}>
              {t('action.reject')}
            </Button>
            <Button variant="secondary" onClick={() => void resolve(true, true)} loading={busy}>
              {t('action.alwaysAllow')}
            </Button>
            <Button variant="primary" onClick={() => void resolve(true)} loading={busy}>
              {t('action.allowOnce')}
            </Button>
          </>
        ) : null
      }
    >
      {approval ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert
              size={16}
              className={
                approval.risk === 'destructive' || approval.risk === 'exec'
                  ? 'text-[var(--warning)]'
                  : 'text-[var(--info)]'
              }
            />
            <span className="font-mono text-[13.5px]">{approval.toolName}</span>
            <Badge tone={approval.risk === 'destructive' ? 'danger' : 'warning'}>
              {approval.risk}
            </Badge>
          </div>

          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-2 text-[13px]">
            {approval.summary}
          </div>

          {approval.command ? (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
                Lệnh sẽ chạy
              </div>
              <pre className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-[12.5px]">
                {approval.command}
              </pre>
              {approval.cwd ? (
                <div className="mt-1 flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                  <Terminal size={10} />
                  {approval.cwd}
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
              Tham số
            </div>
            <pre className="max-h-[200px] overflow-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px]">
              {JSON.stringify(approval.input, null, 2).slice(0, 6000)}
            </pre>
          </div>

          {approvals.length > 1 ? (
            <p className="text-[12px] text-[var(--text-faint)]">
              Còn {approvals.length - 1} yêu cầu khác đang chờ.
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}
