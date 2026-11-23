/// <reference types="vite/client" />

import type { NexusBridge } from '@nexus/shared'

declare global {
  interface Window {
    nexus: NexusBridge
  }
}

export {}
