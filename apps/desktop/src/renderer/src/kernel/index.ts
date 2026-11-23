import { Context } from 'cordis'
import { api } from '../lib/api'
import { queryClient } from '../lib/query'
import { useAppStore } from '../store/app-store'
import * as mcp from '../lib/mcp'

/**
 * Cordis kernel: every shared singleton the renderer needs is a service registered here, so new
 * features attach as plugins instead of importing module-level globals directly.
 */
export interface KernelServices {
  api: typeof api
  query: typeof queryClient
  store: typeof useAppStore
  mcp: typeof mcp
}

export const kernel = new Context() as Context & KernelServices

kernel.provide('api', api)
kernel.provide('query', queryClient)
kernel.provide('store', useAppStore)
kernel.provide('mcp', mcp)

/**
 * Các service của kernel cũng được re-export để feature chỉ cần một điểm vào duy nhất.
 * Nguồn định nghĩa vẫn là `lib/api`, `lib/query`, `store/app-store` (kernel provide nguyên bản).
 */
export { api } from '../lib/api'
export { queryClient, qk } from '../lib/query'
export { useAppStore, useT } from '../store/app-store'

export { realtimePlugin } from './plugin-realtime'
export { mcpPlugin } from './plugin-mcp'

if (typeof window !== 'undefined') {
  ;(window as unknown as { nexusKernel: unknown }).nexusKernel = kernel
}
