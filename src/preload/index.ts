import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from '../shared/ipc'
import type { EventChannel, EventMap, InvokeChannel, SendChannel, SonoraBridge, WindowKind } from '../shared/ipc'

/**
 * The only bridge between the renderer and Electron. The renderer has no Node.js access; it can
 * call the whitelisted channels below, and every call is validated again in the main process.
 */
const invokeSet = new Set<string>(INVOKE_CHANNELS)
const sendSet = new Set<string>(SEND_CHANNELS)
const eventSet = new Set<string>(EVENT_CHANNELS)

const windowArg = process.argv.find((a) => a.startsWith('--sonora-window='))
const windowKind: WindowKind = windowArg?.endsWith('=mini') ? 'mini' : 'main'
const platform = (process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux') as SonoraBridge['platform']

const bridge: SonoraBridge = {
  invoke(channel: InvokeChannel, ...args: unknown[]) {
    if (!invokeSet.has(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  send(channel: SendChannel, ...args: unknown[]) {
    if (!sendSet.has(channel)) return
    ipcRenderer.send(channel, ...args)
  },
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void) {
    if (!eventSet.has(channel)) return () => undefined
    const wrapped = (_event: IpcRendererEvent, payload: EventMap[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  setZoomFactor(factor: number) {
    if (Number.isFinite(factor) && factor >= 0.5 && factor <= 3) webFrame.setZoomFactor(factor)
  },
  platform,
  windowKind
} as SonoraBridge

contextBridge.exposeInMainWorld('sonora', bridge)
