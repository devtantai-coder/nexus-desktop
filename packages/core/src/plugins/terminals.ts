import { TerminalManager } from '../terminal.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/** Terminals plugin: PTY-backed shell sessions surfaced in the terminal panel. */
export const terminalsPlugin: Plugin = definePlugin({
  name: 'nexus.terminals',
  description: 'PTY terminal sessions',
  inject: ['nexus.events'],
  apply(ctx) {
    const terminals = new TerminalManager(ctx.get(Services.events))
    ctx.provide(Services.terminals, terminals)
    return () => {
      terminals.disposeAll()
    }
  },
})
