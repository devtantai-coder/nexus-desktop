import { api, queryClient, useAppStore } from '../kernel'
import type { AgentMode } from '@nexus/shared'

export async function openProject(): Promise<void> {
  const store = useAppStore.getState()
  try {
    const picked = await api.projects.pick()
    const path = (picked as { path?: string } | null)?.path
    if (!path) return
    const project = await api.projects.open(path)
    store.setActiveProject(project.id)
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    store.navigate({ name: 'home' })
  } catch (error) {
    store.toast({ level: 'error', title: 'Không mở được dự án', body: (error as Error).message })
  }
}

export async function newSession(options?: {
  projectId?: string | null
  mode?: AgentMode
  title?: string
}): Promise<string | null> {
  const store = useAppStore.getState()
  try {
    const session = await api.sessions.create({
      projectId:
        options?.projectId ??
        (store.settings['app.standaloneChat'] === true ? null : (store.activeProjectId ?? null)),
      mode: options?.mode ?? (store.settings['agent.defaultMode'] as AgentMode) ?? 'agent',
      permissionMode:
        (store.settings['agent.permissionMode'] as
          'read-only' | 'workspace-write' | 'terminal-approval' | 'elevated' | 'unrestricted') ??
        'workspace-write',
      title: options?.title,
    })
    await queryClient.invalidateQueries({ queryKey: ['sessions'] })
    store.openSession(session.id, session.projectId)
    return session.id
  } catch (error) {
    store.toast({
      level: 'error',
      title: 'Không tạo được phiên',
      body: (error as Error).message,
    })
    return null
  }
}
