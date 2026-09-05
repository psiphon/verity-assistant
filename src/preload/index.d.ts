import type { VerityApi } from './index'

declare global {
  interface Window {
    verity: VerityApi
  }
}
