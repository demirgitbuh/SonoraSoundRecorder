/** Turns release tags such as `0.1`, `v1.2` or `1.2.3-beta.1` into `major.minor.patch[-pre]`. */
export function normalizeVersion(tag: string): string | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(tag.trim())
  if (!m) return null
  const pre = m[4] ? `-${m[4]}` : ''
  return `${Number(m[1])}.${Number(m[2] ?? 0)}.${Number(m[3] ?? 0)}${pre}`
}

/** Returns a negative number when a < b, 0 when equal, positive when a > b. Pre-releases sort first. */
export function compareVersions(a: string, b: string): number {
  const na = normalizeVersion(a)
  const nb = normalizeVersion(b)
  if (!na || !nb) return 0
  const [coreA, preA] = na.split('-', 2) as [string, string | undefined]
  const [coreB, preB] = nb.split('-', 2) as [string, string | undefined]
  const pa = coreA.split('.').map(Number)
  const pb = coreB.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  if (preA && !preB) return -1
  if (!preA && preB) return 1
  if (preA && preB) return preA < preB ? -1 : preA > preB ? 1 : 0
  return 0
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
