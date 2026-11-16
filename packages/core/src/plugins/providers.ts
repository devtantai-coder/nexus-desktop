import { Providers } from '../providers.ts'
import type { SecretStore } from '../secrets.ts'
import type { Store } from '../store.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/** Providers plugin: LLM provider CRUD, key handling, discovery and health tests. */
export const providersPlugin: Plugin = definePlugin({
  name: 'nexus.providers',
  description: 'LLM provider registry, credentials and model discovery',
  inject: ['nexus.store', 'nexus.secrets', 'nexus.events'],
  apply(ctx) {
    const store = ctx.get<Store>(Services.store)
    const secrets = ctx.get<SecretStore>(Services.secrets)
    ctx.provide(Services.providers, new Providers(store, secrets, ctx.get(Services.events)))
  },
})
