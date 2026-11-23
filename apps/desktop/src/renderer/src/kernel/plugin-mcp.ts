import type { NexusEventEnvelope } from '@nexus/shared'
import { queryClient, qk } from '../lib/query'

/**
 * MCP plugin: native core báo trạng thái server qua event, plugin này giữ cho danh sách
 * server/tool trong UI luôn khớp mà không phải poll.
 */
export const mcpPlugin = {
  name: 'nexus.mcp',
  apply(): () => void {
    if (!window.nexus) return () => undefined
    return window.nexus.onEvent((envelope: NexusEventEnvelope) => {
      if (envelope.event.type !== 'mcp.server.status') return
      void queryClient.invalidateQueries({ queryKey: qk.mcpServers })
      void queryClient.invalidateQueries({ queryKey: qk.mcpTools() })
    })
  },
}
