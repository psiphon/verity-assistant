import { ElectronAPI } from '@electron-toolkit/preload'
import type { VerityApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    verity: VerityApi
  }
}
