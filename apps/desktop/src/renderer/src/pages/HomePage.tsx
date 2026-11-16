import type React from 'react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentMode, Attachment, PermissionMode } from '@nexus/shared'
import { api, queryClient, qk, useAppStore } from '../kernel'
import { Composer } from '../components/composer/Composer'
import { Blossom } from '../components/ui/Blossom'

const SUGGESTIONS = [
  'Explain this codebase',
  'Find and fix a bug',
  'Write tests for the core module',
  'Review uncommitted changes',
]

export function HomePage(): React.JSX.Element {
  const toast = useAppStore((state) => state.toast)
  const activeProjectId = useAppStore((state) => state.activeProjectId)
  const setActiveProject = useAppStore((state) => state.setActiveProject)
  const navigate = useAppStore((state) => state.navigate)
  const settings = useAppStore((state) => state.settings)
  const focusComposerAt = useAppStore((state) => state.composerFocusAt)

  const [pending, setPending] = useState<string | null>(null)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const { data: projects = [] } = useQuery({
    queryKey: qk.projects,
    queryFn: () => api.projects.list(),
    staleTime: 60_000,
  })
  const currentProject = projects.find((project) => project.id === activeProjectId) ?? null
  const draftRequest = useAppStore((state) => state.draftRequest)
  useEffect(() => {
    if (draftRequest) setPending(draftRequest.text)
  }, [draftRequest])
  const { data: models = [] } = useQuery({ queryKey: qk.models, queryFn: () => api.models.list() })
  const defaultModel = models.find((model) => model.isDefault)

  const start = async (
    prompt: string,
    attachments: Attachment[],
    mode: AgentMode,
  ): Promise<void> => {
    const permissionMode = (settings['agent.permissionMode'] as PermissionMode) ?? 'workspace-write'
    try {
      const session = await api.sessions.create({
        projectId: activeProjectId,
        mode,
        permissionMode,
        title: prompt.slice(0, 60) || 'Hội thoại mới',
        ...(defaultModel
          ? {
              providerId: defaultModel.providerId,
              modelId: defaultModel.modelId,
              modelVariant: defaultModel.variant ?? '',
            }
          : {}),
      })
      useAppStore.setState({ activeSessionId: session.id })
      navigate({ name: 'chat', sessionId: session.id })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      const result = await api.agent.start({
        sessionId: session.id,
        prompt: prompt || 'Bắt đầu làm việc với dự án này.',
        mode,
        permissionMode,
        ...(defaultModel
          ? { providerId: defaultModel.providerId, modelId: defaultModel.modelId }
          : {}),
        ...(activeProjectId ? { projectId: activeProjectId } : {}),
        ...(attachments.length ? { attachments } : {}),
      })
      useAppStore.getState().setActiveTask(result.taskId)
    } catch (error) {
      toast({ level: 'error', title: 'Không bắt đầu được tác vụ', body: (error as Error).message })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="group/home-composer-layout relative flex min-h-0 w-full flex-1 flex-col pt-6">
          <div className="relative flex min-h-0 flex-1 items-end justify-center pb-24">
            <div className="flex w-full justify-center px-8">
              <div className="relative mx-auto flex w-[min(100%,736px)] min-w-0 flex-col items-center gap-6">
                <Blossom className="size-14 text-[var(--text)] opacity-25 select-none" />
                <h1 className="heading-xl whitespace-pre-wrap text-center text-[var(--text)] select-none [--color:var(--text)]">
                  {currentProject ? (
                    <>
                      What should we work on in{' '}
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={projectPickerOpen}
                        onClick={() => setProjectPickerOpen((open) => !open)}
                        className="relative inline-block cursor-pointer align-baseline underline decoration-[var(--text-faint)] decoration-dotted underline-offset-4 hover:text-[var(--text-muted)]"
                      >
                        {currentProject.name}?
                        {projectPickerOpen ? (
                          <>
                            <button
                              type="button"
                              aria-label="Close project picker"
                              className="fixed inset-0 z-30 cursor-default"
                              onClick={() => setProjectPickerOpen(false)}
                            />
                            <span
                              role="dialog"
                              aria-label="Choose project"
                              className="absolute left-1/2 top-full z-40 mt-2 w-[240px] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 text-left text-[13.5px] shadow-[var(--shadow-menu)]"
                            >
                              {projects.map((project) => (
                                <button
                                  key={project.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveProject(project.id)
                                    setProjectPickerOpen(false)
                                  }}
                                  className="menu-row-codex"
                                >
                                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                                </button>
                              ))}
                            </span>
                          </>
                        ) : null}
                      </button>
                    </>
                  ) : (
                    'Xin chào! Bạn có thể làm gì?'
                  )}
                </h1>
              </div>
            </div>
          </div>
          <div className="relative z-20 mx-auto -mt-16 w-full max-w-[736px] px-8 pb-4">
            <Composer
              hero
              draft={pending ?? undefined}
              onSubmitPrompt={(prompt, attachments, mode) => void start(prompt, attachments, mode)}
              defaultMode={(settings['agent.defaultMode'] as AgentMode) ?? 'agent'}
              defaultPermission={
                (settings['agent.permissionMode'] as PermissionMode) ?? 'workspace-write'
              }
              autoFocusKey={focusComposerAt}
              placeholder="Do anything"
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 px-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setPending(suggestion)}
                  className="rounded-full px-3 py-1.5 text-[13px] leading-[18px] text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
