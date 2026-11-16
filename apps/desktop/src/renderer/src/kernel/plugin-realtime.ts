import { installRealtime } from '../lib/realtime'

/**
 * Realtime bridge as a cordis plugin: the kernel owns the subscription lifetime, so the app can be
 * reloaded or partially torn down without leaking the event listener.
 */
export const realtimePlugin = {
  name: 'nexus.realtime',
  apply(): () => void {
    return installRealtime()
  },
}
