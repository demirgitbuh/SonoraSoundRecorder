/// <reference types="vite/client" />
import type { SonoraBridge } from '../../shared/ipc'

declare global {
  interface Window {
    sonora: SonoraBridge
  }
}

export {}
