import type { JsonValue } from './types.ts'

export interface NexusEvent {
  type: string
  payload: unknown
}

export type EventSink = (event: NexusEvent) => void

/** Bus sự kiện một-chiều: lõi chỉ phát, không nhận. */
export class EventBus {
  private sink: EventSink | null = null
  private readonly listeners = new Set<EventSink>()

  setSink(sink: EventSink | null): void {
    this.sink = sink
  }

  on(listener: EventSink): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(type: string, payload: JsonValue = {}): void {
    if (!this.sink && this.listeners.size === 0) return
    const event: NexusEvent = { type, payload }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        process.stderr.write(
          `nexus-core: event listener failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
    }
    if (this.sink) {
      try {
        this.sink(event)
      } catch {
        // sink (renderer) lỗi không được phép phá vỡ lõi
      }
    }
  }
}
