/**
 * Re-export of the cordis runtime for the core package.
 *
 * Core plugins are written against `@nexus/cordis` so they stay usable outside this
 * package (tests, the renderer kernel) without pulling in the Electron stack.
 */
export {
  Container,
  createContainer,
  definePlugin,
  type Context,
  type Disposable,
  type Listener,
  type Plugin,
} from '@nexus/cordis'

/** Legacy event bus used by core services (single-direction: emit only). */
export { EventBus } from '../events.ts'

/** Well-known service names, so plugins never rely on stringly-typed typos. */
export const Services = {
  events: 'nexus.events',
  store: 'nexus.store',
  secrets: 'nexus.secrets',
  providers: 'nexus.providers',
  mcp: 'nexus.mcp',
  workspaces: 'nexus.workspaces',
  processes: 'nexus.processes',
  tools: 'nexus.tools',
  agent: 'nexus.agent',
  lsp: 'nexus.lsp',
  retrieval: 'nexus.retrieval',
  terminals: 'nexus.terminals',
  watcher: 'nexus.watcher',
  core: 'nexus.core',
} as const
