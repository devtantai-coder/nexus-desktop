import { api } from '../lib/api'
import { queryClient } from '../lib/query'
import { useAppStore } from '../store/app-store'
import * as mcp from '../lib/mcp'
import { createContainer } from '@nexus/cordis'
import { realtimePlugin } from './plugin-realtime'
import { mcpPlugin } from './plugin-mcp'

/**
 * Kernel services: plain object exposing shared singletons.
 */
export interface KernelServices {
  api: typeof api
  query: typeof queryClient
  store: typeof useAppStore
  mcp: typeof mcp
}

export const kernel: KernelServices = {
  api,
  query: queryClient,
  store: useAppStore,
  mcp,
}

export { api } from '../lib/api'
export { queryClient, qk } from '../lib/query'
export { useAppStore, useT } from '../store/app-store'

export const kernelContainer = createContainer()
kernelContainer.plugin(realtimePlugin as never)
kernelContainer.plugin(mcpPlugin as never)

export async function loadKernelPlugins(): Promise<void> {
  await kernelContainer.loadAll()
}

export { realtimePlugin } from './plugin-realtime'
export { mcpPlugin } from './plugin-mcp'

if (typeof window !== 'undefined') {
  ;(window as unknown as { nexusKernel: unknown }).nexusKernel = kernel
}
