import type { InstallKind } from '../../shared/types'

/** Pure helpers of the update service (no Electron imports, unit tested). */
export interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
  digest?: string | null
}

/** Package types that can replace themselves; every other type needs a user-driven upgrade. */
export function supportsAutoInstall(kind: InstallKind): boolean {
  return kind === 'nsis' || kind === 'appimage'
}

/** Release asset that matches the running package type and CPU architecture. */
export function pickAsset(assets: GithubAsset[], kind: InstallKind, arch: string): GithubAsset | null {
  const archName = arch === 'arm64' ? 'arm64' : 'x64'
  const patterns: Record<InstallKind, RegExp | null> = {
    nsis: new RegExp(`-Setup-${archName}\\.exe$`),
    portable: new RegExp(`-Portable-${archName}\\.exe$`),
    dmg: new RegExp(`-${archName}\\.dmg$`),
    appimage: arch === 'arm64' ? /-arm64\.AppImage$/ : /-x86_64\.AppImage$/,
    deb: arch === 'arm64' ? /_arm64\.deb$/ : /_amd64\.deb$/,
    dev: null
  }
  const re = patterns[kind]
  return re ? (assets.find((a) => re.test(a.name)) ?? null) : null
}
