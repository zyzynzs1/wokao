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
    disguiseEvents: {
      onAutosave: (cb: (answers: Record<string, string>) => void) => () => void
      onFinished: (cb: (answers: Record<string, string>) => void) => () => void
      onAborted: (cb: () => void) => () => void
      onRequestStart: (cb: () => void) => () => void
      onError: (cb: (message: string) => void) => () => void
    }
  }
}

export {}
