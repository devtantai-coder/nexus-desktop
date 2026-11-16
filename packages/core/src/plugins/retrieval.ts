import { RetrievalService } from '../retrieval.ts'
import type { Providers } from '../providers.ts'
import type { Store } from '../store.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

/** Retrieval plugin: semantic code search + embedding index. */
export const retrievalPlugin: Plugin = definePlugin({
  name: 'nexus.retrieval',
  description: 'Semantic code retrieval and embedding index',
  inject: ['nexus.store', 'nexus.providers', 'nexus.events'],
  apply(ctx) {
    const store = ctx.get<Store>(Services.store)
    const providers = ctx.get<Providers>(Services.providers)
    ctx.provide(Services.retrieval, new RetrievalService(store, ctx.get(Services.events), providers))
  },
})
