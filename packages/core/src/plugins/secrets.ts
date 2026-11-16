import { SecretStore } from '../secrets.ts'
import { definePlugin, Services, type Plugin } from './runtime.ts'

export interface SecretsConfig {
  userDataDir: string
}

/** Secrets plugin: AES-256-GCM key material for provider API keys. */
export const secretsPlugin: Plugin<SecretsConfig> = definePlugin<SecretsConfig>({
  name: 'nexus.secrets',
  description: 'Local AES-256-GCM key store for provider credentials',
  inject: ['nexus.store'],
  apply(ctx, config) {
    ctx.provide(Services.secrets, new SecretStore(config.userDataDir))
  },
})
