import type { EventChannel, EventMap, InvokeArgs, InvokeChannel, InvokeResult, SendChannel, SendMap } from '../../shared/ipc'

/** Error raised for a failed IPC call; `key` is a translation key. */
export class AppError extends Error {
  constructor(
    public readonly key: string,
    public readonly detail: string | null = null
  ) {
    super(detail ?? key)
  }
}

const bridge = window.sonora

export async function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
  const res = await bridge.invoke(channel, ...args)
  if (!res.ok) throw new AppError(res.errorKey, res.detail)
  return res.value
}

export function send<C extends SendChannel>(channel: C, ...args: SendMap[C]): void {
  bridge.send(channel, ...args)
}

export function on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void {
  return bridge.on(channel, listener)
}

export const platform = bridge.platform
export const windowKind = bridge.windowKind
export const getPathForFile = (file: File): string => bridge.getPathForFile(file)
export const setZoomFactor = (f: number): void => bridge.setZoomFactor(f)

/** Writes a technical message to the log file (never audio or transcript content). */
export function log(level: 'info' | 'warn' | 'error', scope: string, message: string): void {
  send('log:write', level, scope, message)
}

export function errorKeyOf(err: unknown): { key: string; detail: string | null } {
  if (err instanceof AppError) return { key: err.key, detail: err.detail }
  return { key: 'errors.unexpected', detail: err instanceof Error ? err.message : String(err) }
}
