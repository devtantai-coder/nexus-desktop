/**
 * @nexus/cordis — a small, dependency-free service container / plugin runtime in the
 * style of cordis: plugins are plain objects with an `apply(ctx)` entry point, services
 * are registered into the container progressively, and every side effect is collected
 * into a disposal scope so a plugin can be unloaded cleanly.
 *
 * Design goals (chosen to fit how NEXUS already works):
 *  - No decorators, no reflection, no proxies: explicit `ctx.provide` / `ctx.inject`.
 *  - Deterministic ordering: plugins are applied in registration order, and teardown
 *    runs in reverse order.
 *  - Zero runtime dependencies and no Node-only APIs, so the same code runs in the
 *    Electron main process *and* in the renderer.
 */

/** Anything disposable: a function, or an object with a `dispose()` method. */
export type Disposable = (() => void) | { dispose(): void }

export type Awaitable<T> = T | Promise<T>

/**
 * A plugin is a plain object. `apply` is called once when the plugin is loaded and may
 * return a teardown function (or an object with `dispose`) that runs on unload.
 */
export interface Plugin<T = unknown> {
  /** Unique, dotted identifier, e.g. `nexus.store`. */
  name: string
  /** Human readable description, shown in diagnostics. */
  description?: string
  /** Plugins that must be applied before this one. */
  inject?: string[]
  /** Plugin configuration passed in at load time. */
  config?: T
  apply(ctx: Context, config: T): Awaitable<void | Disposable>
}

export interface Context {
  /** The container this context belongs to. */
  root: Container
  /** Events bus scoped to this container. */
  events: EventBus
  /** Register a service value; returns its disposer. */
  provide<T extends object>(name: string, value: T): () => void
  /** Look a service up; throws if it is not registered. */
  get<T extends object>(name: string): T
  /** Look a service up, returning `undefined` when missing. */
  peek<T extends object>(name: string): T | undefined
  /** Register a disposer that runs when this plugin is unloaded. */
  effect(fn: () => void): void
  /** Register an async-safe disposer. */
  effectAsync(fn: () => Awaitable<void>): void
  /** Service names available at the moment `apply` runs. */
  provides: string[]
}

/* ------------------------------------------------------------------ event bus */

export type Listener<T = any> = (payload: T) => void

/** Minimal typed-capable event bus, intentionally tiny. */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>()

  on<T = any>(type: string, listener: Listener<T>): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener as Listener)
    return () => {
      set.delete(listener as Listener)
    }
  }

  once<T = any>(type: string, listener: Listener<T>): () => void {
    const off = this.on<T>(type, (payload) => {
      off()
      listener(payload)
    })
    return off
  }

  emit<T = any>(type: string, payload?: T): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(payload)
      } catch (error) {
        reportListenerError(type, error)
      }
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  clear(): void {
    this.listeners.clear()
  }
}

function reportListenerError(type: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  globalThis.process?.stderr?.write(`cordis: event listener for "${type}" failed: ${message}\n`)
}

/* ------------------------------------------------------------------ container */

class DisposalScope {
  private items: Array<() => Awaitable<void>> = []

  add(fn: () => Awaitable<void>): void {
    this.items.push(fn)
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = []
    for (const fn of this.items.reverse()) {
      try {
        await fn()
      } catch (error) {
        errors.push(error)
      }
    }
    this.items = []
    if (errors.length > 0) throw errors[0]
  }

  get size(): number {
    return this.items.length
  }
}

interface LoadedPlugin {
  plugin: Plugin
  scope: DisposalScope
}

export class Container {
  readonly events = new EventBus()
  private readonly plugins = new Map<string, Plugin>()
  private readonly loaded = new Map<string, LoadedPlugin>()
  private readonly order: string[] = []
  private readonly services = new Map<string, object>()

  /** Register a plugin without loading it. Duplicate names throw. */
  plugin(plugin: Plugin): this {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`cordis: plugin "${plugin.name}" already registered`)
    }
    this.plugins.set(plugin.name, plugin)
    return this
  }

  /** Register many plugins at once. */
  registerAll(plugins: Plugin[]): this {
    for (const plugin of plugins) this.plugin(plugin)
    return this
  }

  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /**
   * Attach configuration to an already registered plugin. Plugins are declared as
   * static singletons, so instance-specific values (paths, versions) are injected here
   * instead of being baked into the module.
   */
  pluginConfig<T>(name: string, config: T): this {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`cordis: plugin "${name}" is not registered`)
    plugin.config = config
    return this
  }

  /** Apply every registered plugin, honouring `inject` ordering. */
  async loadAll(): Promise<void> {
    for (const name of this.resolveOrder()) await this.load(name)
  }

  async load(name: string): Promise<void> {
    if (this.loaded.has(name)) return
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`cordis: plugin "${name}" is not registered`)
    for (const dep of plugin.inject ?? []) {
      if (!this.plugins.has(dep)) {
        throw new Error(`cordis: plugin "${name}" requires missing plugin "${dep}"`)
      }
      await this.load(dep)
    }

    const scope = new DisposalScope()

    const ctx: Context = {
      root: this,
      events: this.events,
      provides: [...this.services.keys()],
      provide: <T extends object>(serviceName: string, value: T) => {
        if (this.services.has(serviceName)) {
          throw new Error(`cordis: service "${serviceName}" already provided`)
        }
        this.services.set(serviceName, value)
        scope.add(() => {
          this.services.delete(serviceName)
        })
        return () => {
          this.services.delete(serviceName)
        }
      },
      get: <T extends object>(serviceName: string): T => {
        const value = this.services.get(serviceName)
        if (!value) throw new Error(`cordis: service "${serviceName}" is not available`)
        return value as T
      },
      peek: <T extends object>(serviceName: string): T | undefined =>
        this.services.get(serviceName) as T | undefined,
      effect: (fn: () => void) => scope.add(fn),
      effectAsync: (fn: () => Awaitable<void>) => scope.add(fn),
    }

    const result = await plugin.apply(ctx, plugin.config as never)
    if (typeof result === 'function') scope.add(result as () => Awaitable<void>)
    else if (result && typeof (result as { dispose?: unknown }).dispose === 'function') {
      scope.add(() => (result as { dispose(): void }).dispose())
    }

    this.loaded.set(name, { plugin, scope })
    this.order.push(name)
  }

  /** Unload a single plugin (and, implicitly, whatever it provided). */
  async unload(name: string): Promise<void> {
    const entry = this.loaded.get(name)
    if (!entry) return
    this.loaded.delete(name)
    const index = this.order.indexOf(name)
    if (index >= 0) this.order.splice(index, 1)
    await entry.scope.dispose()
  }

  /** Unload everything in reverse load order. */
  async unloadAll(): Promise<void> {
    for (const name of [...this.order].reverse()) await this.unload(name)
    this.services.clear()
    this.events.clear()
  }

  get<T extends object>(name: string): T {
    const value = this.services.get(name)
    if (!value) throw new Error(`cordis: service "${name}" is not available`)
    return value as T
  }

  getService<T extends object>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }

  /** Names of loaded plugins, in load order. */
  get loadedPlugins(): string[] {
    return [...this.order]
  }

  /** Names of currently registered services. */
  get providedServices(): string[] {
    return [...this.services.keys()]
  }

  private resolveOrder(): string[] {
    const result: string[] = []
    const seen = new Set<string>()
    const visiting = new Set<string>()

    const visit = (name: string): void => {
      if (seen.has(name)) return
      if (visiting.has(name)) {
        throw new Error(`cordis: circular plugin dependency involving "${name}"`)
      }
      const plugin = this.plugins.get(name)
      if (!plugin) throw new Error(`cordis: plugin "${name}" is not registered`)
      visiting.add(name)
      for (const dep of plugin.inject ?? []) visit(dep)
      visiting.delete(name)
      seen.add(name)
      result.push(name)
    }

    for (const name of this.plugins.keys()) visit(name)
    return result
  }
}

export function createContainer(): Container {
  return new Container()
}

export function definePlugin<T = unknown>(plugin: Plugin<T>): Plugin<T> {
  return plugin
}
