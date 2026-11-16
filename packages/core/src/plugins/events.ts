import { EventBus } from '../events.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

export interface EventsConfig {
  bus: EventBus
}

/**
 * Events plugin: provides the core `EventBus` (the one with a `setSink` hook that the
 * Electron main process uses to forward events to the renderer).
 *
 * The cordis container has its own generic bus for plugin-internal messaging; the domain
 * bus is separate because it carries typed NEXUS events and a single sink.
 */
export const eventsPlugin: Plugin<EventsConfig> = definePlugin<EventsConfig>({
  name: 'nexus.events',
  description: 'Core event bus (agent/workspace/git/terminal events)',
  apply(ctx, config) {
    ctx.provide(Services.events, config.bus)
  },
})
