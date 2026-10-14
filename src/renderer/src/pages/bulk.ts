import type { BulkResult } from '../../../shared/types'
import { useApp } from '../stores/app'

/**
 * Reports a per-item result: a success toast with the count, and a separate error toast that
 * names the items which failed and why. Partial failures are never hidden.
 */
export function reportBulk(res: BulkResult, okKey: string, failKey: string): void {
  const app = useApp.getState()
  const ok = res.results.filter((r) => r.ok)
  const failed = res.results.filter((r) => !r.ok)
  if (ok.length > 0) app.toast('success', okKey, { params: { count: ok.length } })
  if (failed.length > 0) {
    const first = failed[0]!
    app.toast('error', failKey, {
      params: { count: failed.length },
      bodyKey: first.errorKey,
      detail: failed
        .slice(0, 3)
        .map((f) => f.name)
        .join(', ') + (failed.length > 3 ? ` +${failed.length - 3}` : '')
    })
  }
}
