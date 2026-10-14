/// <reference types="vite/client" />
import type { Api } from '../../shared/api'

declare global {
  interface Window {
    api: Api
    windowEvents: {
      onMinimized: (cb: () => void) => () => void
      onRestored: (cb: () => void) => () => void
      onBlurred: (cb: () => void) => () => void
      onFocused: (cb: () => void) => () => void
    }
  }
}

export {}
