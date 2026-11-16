import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Container, EventBus, definePlugin } from '../index.ts'

test('loads plugins in dependency order', async () => {
  const order: string[] = []
  const container = new Container()

  container.plugin(
    definePlugin({
      name: 'b',
      inject: ['a'],
      apply(ctx) {
        order.push('b')
        assert.equal(ctx.peek('a.service') !== undefined, true)
      },
    }),
  )
  container.plugin(
    definePlugin({
      name: 'a',
      apply(ctx) {
        order.push('a')
        ctx.provide('a.service', { hello: () => 'a' })
      },
    }),
  )

  await container.loadAll()
  assert.deepEqual(order, ['a', 'b'])
  assert.deepEqual(container.providedServices.sort(), ['a.service'])
})

test('disposes effects in reverse order on unload', async () => {
  const container = new Container()
  const disposed: string[] = []

  container.plugin(
    definePlugin({
      name: 'p1',
      apply(ctx) {
        ctx.effect(() => disposed.push('first-effect'))
        return () => disposed.push('first-teardown')
      },
    }),
  )
  container.plugin(
    definePlugin({
      name: 'p2',
      inject: ['p1'],
      apply(ctx) {
        ctx.effect(() => disposed.push('second-effect'))
        return () => disposed.push('second-teardown')
      },
    }),
  )

  await container.loadAll()
  assert.deepEqual(container.loadedPlugins, ['p1', 'p2'])
  await container.unloadAll()
  assert.deepEqual(disposed, ['second-teardown', 'second-effect', 'first-teardown', 'first-effect'])
  assert.deepEqual(container.loadedPlugins, [])
})

test('services are removed when their provider unloads', async () => {
  const container = new Container()
  container.plugin(
    definePlugin({
      name: 'svc',
      apply(ctx) {
        ctx.provide('value', { n: 1 })
      },
    }),
  )
  await container.loadAll()
  assert.equal(container.get<{ n: number }>('value').n, 1)
  await container.unload('svc')
  assert.equal(container.getService('value'), undefined)
})

test('detects circular dependencies', async () => {
  const container = new Container()
  container.plugin(definePlugin({ name: 'x', inject: ['y'], apply() {} }))
  container.plugin(definePlugin({ name: 'y', inject: ['x'], apply() {} }))
  await assert.rejects(() => container.loadAll(), /circular/)
})

test('rejects duplicate plugin names and duplicate services', async () => {
  const container = new Container()
  const plugin = definePlugin({ name: 'dup', apply() {} })
  container.plugin(plugin)
  assert.throws(() => container.plugin(plugin), /already registered/)

  const c2 = new Container()
  c2.plugin(definePlugin({ name: 'one', apply: (ctx) => void ctx.provide('s', {}) }))
  c2.plugin(definePlugin({ name: 'two', apply: (ctx) => void ctx.provide('s', {}) }))
  await c2.load('one')
  await assert.rejects(() => c2.load('two'), /already provided/)
})

test('event bus delivers and unsubscribes', () => {
  const bus = new EventBus()
  const seen: unknown[] = []
  const off = bus.on('tick', (payload) => seen.push(payload))
  bus.emit('tick', 1)
  off()
  bus.emit('tick', 2)
  assert.deepEqual(seen, [1])
  assert.equal(bus.listenerCount('tick'), 0)
})

test('listener errors do not break other listeners', () => {
  const bus = new EventBus()
  const seen: unknown[] = []
  bus.on('evt', () => {
    throw new Error('boom')
  })
  bus.on('evt', (payload) => seen.push(payload))
  bus.emit('evt', 'ok')
  assert.deepEqual(seen, ['ok'])
})
