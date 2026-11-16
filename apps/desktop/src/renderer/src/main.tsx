import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient, useAppStore } from './kernel'
import { App } from './App'
import { kernel, mcpPlugin, realtimePlugin } from './kernel'
import './styles/globals.css'

function UnsupportedEnvironment(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg)] px-6 text-[var(--text)]">
      <div className="max-w-[420px] space-y-3 text-center">
        <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent)] text-[14.5px] font-bold text-[var(--accent-contrast)]">
          N
        </div>
        <h1 className="text-[17.5px] font-medium">Cần chạy NEXUS Desktop</h1>
        <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">
          Giao diện này chỉ hoạt động trong ứng dụng Electron vì cần truy cập agent, terminal, git
          và tệp thật trên máy. Không có dữ liệu minh hoạ hay chế độ xem trước.
        </p>
        <p className="text-[13px] text-[var(--text-faint)]">
          Chạy <code className="font-mono">pnpm dev</code> từ thư mục dự án để mở ứng dụng.
        </p>
      </div>
    </div>
  )
}

async function boot(): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('Root element missing')
  if (!window.nexus) {
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)')
      .matches
      ? 'dark'
      : 'light'
    createRoot(container).render(
      <React.StrictMode>
        <UnsupportedEnvironment />
      </React.StrictMode>,
    )
    return
  }
  await useAppStore.getState().init()
  const popout = new URLSearchParams(window.location.search).get('session')
  if (popout) {
    useAppStore.getState().openSession(popout)
    useAppStore.setState({ sidebarCollapsed: true })
  }
  kernel.plugin(realtimePlugin)
  kernel.plugin(mcpPlugin)
  createRoot(container).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  )
}

void boot()
