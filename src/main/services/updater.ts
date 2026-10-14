import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { net, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ReleaseInfo, UpdateStatus } from '../../shared/ipc'
import type { InstallKind } from '../../shared/types'
import { compareVersions, isNewer, normalizeVersion } from '../../shared/version'
import type { Logger } from './logger'
import { pickAsset, supportsAutoInstall } from './update-utils'
import type { GithubAsset } from './update-utils'

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

export const REPO_OWNER = 'demirgitbuh'
export const REPO_NAME = 'SonoraSoundRecorder'

interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  html_url: string
  published_at: string | null
  draft: boolean
  prerelease: boolean
  assets: GithubAsset[]
}

interface Deps {
  logger: Logger
  currentVersion: string
  installKind: InstallKind
  arch: string
  isPackaged: boolean
  downloadsDir: () => string
  /** True while a recording, finalization or export is running. */
  isBusy: () => boolean
  /** Flushes settings and archive before the app quits for an update. */
  beforeInstall: () => Promise<void>
  /** Also offers pre-releases (developer option). */
  allowPrerelease?: () => boolean
  emit: (status: UpdateStatus) => void
}

/**
 * Checks GitHub Releases for a newer version and only downloads or installs after the user
 * asks for it. Installers (NSIS, AppImage) use electron-updater; portable, DMG and DEB packages
 * are downloaded and handed to the user, because they cannot upgrade themselves.
 */
export class UpdateService {
  private status: UpdateStatus
  private releaseAssets: GithubAsset[] = []
  private updaterWired = false

  constructor(private readonly deps: Deps) {
    this.status = {
      phase: 'idle',
      currentVersion: deps.currentVersion,
      installKind: deps.installKind,
      autoInstall: supportsAutoInstall(deps.installKind),
      release: null,
      progress: null,
      downloadedFile: null,
      installAfterDownload: false,
      errorKey: null,
      errorDetail: null,
      checkedAt: null
    }
  }

  get current(): UpdateStatus {
    return this.status
  }

  private set(patch: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...patch }
    this.deps.emit(this.status)
    return this.status
  }

  private fail(errorKey: string, err?: unknown): UpdateStatus {
    const detail = err instanceof Error ? err.message.slice(0, 300) : err ? String(err).slice(0, 300) : null
    this.deps.logger.error('update', errorKey, detail ?? undefined)
    return this.set({ phase: 'error', errorKey, errorDetail: detail, progress: null })
  }

  /**
   * Pre-releases are installed through the downloaded package, because the self-updating
   * installers only follow stable releases.
   */
  private usesAutoUpdater(version: string | null | undefined): boolean {
    return supportsAutoInstall(this.deps.installKind) && !!version && !version.includes('-')
  }

  private async fetchRelease(): Promise<GithubRelease | null> {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `SonoraSoundRecorder/${this.deps.currentVersion}`
    }
    if (!this.deps.allowPrerelease?.()) {
      const res = await net.fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, { headers })
      if (res.status === 404) return null
      if (!res.ok) throw new HttpError(res.status)
      return (await res.json()) as GithubRelease
    }
    const res = await net.fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`, { headers })
    if (res.status === 404) return null
    if (!res.ok) throw new HttpError(res.status)
    const list = ((await res.json()) as GithubRelease[]).filter((r) => !r.draft && normalizeVersion(r.tag_name))
    list.sort((a, b) => compareVersions(normalizeVersion(b.tag_name)!, normalizeVersion(a.tag_name)!))
    return list[0] ?? null
  }

  async check(): Promise<UpdateStatus> {
    if (this.status.phase === 'checking' || this.status.phase === 'downloading' || this.status.phase === 'installing') return this.status
    this.set({ phase: 'checking', errorKey: null, errorDetail: null })
    try {
      let data: GithubRelease | null
      try {
        data = await this.fetchRelease()
      } catch (err) {
        if (err instanceof HttpError) return this.fail('updates.errorHttp', `HTTP ${err.status}`)
        throw err
      }
      if (!data) {
        return this.set({ phase: 'not-available', release: null, checkedAt: new Date().toISOString() })
      }
      const version = normalizeVersion(data.tag_name)
      if (!version) return this.fail('updates.errorBadTag', data.tag_name)
      const release: ReleaseInfo = {
        version,
        tag: data.tag_name,
        name: data.name || data.tag_name,
        notes: (data.body ?? '').slice(0, 20000),
        publishedAt: data.published_at,
        url: data.html_url
      }
      this.releaseAssets = data.assets ?? []
      const newer = isNewer(version, this.deps.currentVersion)
      this.deps.logger.info('update', `latest release ${data.tag_name} (${version}); current ${this.deps.currentVersion}`)
      return this.set({
        phase: newer ? 'available' : 'not-available',
        release,
        autoInstall: this.usesAutoUpdater(version),
        checkedAt: new Date().toISOString(),
        downloadedFile: null,
        progress: null
      })
    } catch (err) {
      return this.fail('updates.errorNetwork', err)
    }
  }

  private wireAutoUpdater(): void {
    if (this.updaterWired) return
    this.updaterWired = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = {
      info: (m: unknown) => this.deps.logger.info('electron-updater', String(m)),
      warn: (m: unknown) => this.deps.logger.warn('electron-updater', String(m)),
      error: (m: unknown) => this.deps.logger.error('electron-updater', String(m)),
      debug: () => undefined
    }
    autoUpdater.on('download-progress', (p) => {
      this.set({ progress: { percent: p.percent, transferred: p.transferred, total: p.total } })
    })
  }

  /** Downloads the update. With `installAfter`, installs it as soon as it is safe to do so. */
  async download(installAfter: boolean): Promise<UpdateStatus> {
    const release = this.status.release
    if (!release || !isNewer(release.version, this.deps.currentVersion)) return this.fail('updates.errorNothingToDownload')
    if (!this.deps.isPackaged || this.deps.installKind === 'dev') return this.fail('updates.errorDevBuild')
    if (this.status.phase === 'downloading') return this.status
    this.set({ phase: 'downloading', progress: { percent: 0, transferred: 0, total: 0 }, installAfterDownload: installAfter, errorKey: null, errorDetail: null })
    try {
      if (this.usesAutoUpdater(release.version)) {
        this.wireAutoUpdater()
        const result = await autoUpdater.checkForUpdates()
        const found = result?.updateInfo?.version
        if (!found || normalizeVersion(found) !== release.version) {
          return this.fail('updates.errorMismatch', `metadata version ${found ?? 'none'} vs release ${release.version}`)
        }
        await autoUpdater.downloadUpdate()
        this.set({ phase: 'downloaded', progress: null })
      } else {
        const asset = pickAsset(this.releaseAssets, this.deps.installKind, this.deps.arch)
        if (!asset) return this.fail('updates.errorNoAsset')
        const file = await this.downloadAsset(asset)
        this.set({ phase: 'downloaded', progress: null, downloadedFile: file })
      }
    } catch (err) {
      return this.fail('updates.errorDownload', err)
    }
    if (installAfter) return this.install()
    return this.status
  }

  private async downloadAsset(asset: GithubAsset): Promise<string> {
    const target = join(this.deps.downloadsDir(), asset.name)
    const part = `${target}.part`
    const res = await net.fetch(asset.browser_download_url, {
      headers: { 'User-Agent': `SonoraSoundRecorder/${this.deps.currentVersion}` }
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || asset.size
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    let transferred = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        transferred += value.byteLength
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
        this.set({ progress: { percent: total ? (transferred / total) * 100 : 0, transferred, total } })
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    } catch (err) {
      out.destroy()
      await rm(part, { force: true })
      throw err
    }
    if (asset.size && transferred !== asset.size) {
      await rm(part, { force: true })
      throw new Error(`size mismatch: ${transferred} != ${asset.size}`)
    }
    const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null
    if (expected && hash.digest('hex') !== expected) {
      await rm(part, { force: true })
      throw new Error('sha256 mismatch')
    }
    await rm(target, { force: true })
    await rename(part, target)
    return target
  }

  /** Installs a downloaded update; deferred while recording or saving is in progress. */
  async install(): Promise<UpdateStatus> {
    if (this.status.phase !== 'downloaded' && this.status.phase !== 'waiting-for-idle') return this.status
    if (this.deps.isBusy()) {
      this.deps.logger.info('update', 'install deferred until recordings finish')
      return this.set({ phase: 'waiting-for-idle', installAfterDownload: true })
    }
    if (this.usesAutoUpdater(this.status.release?.version)) {
      this.set({ phase: 'installing' })
      await this.deps.beforeInstall()
      this.deps.logger.info('update', `installing ${this.status.release?.version}`)
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
      return this.status
    }
    await this.openDownloaded()
    return this.set({ phase: 'downloaded', installAfterDownload: false })
  }

  /** Opens the downloaded package so the user can complete a manual upgrade. */
  async openDownloaded(): Promise<void> {
    const file = this.status.downloadedFile
    if (!file) return
    if (this.deps.installKind === 'portable') {
      shell.showItemInFolder(file)
      return
    }
    const err = await shell.openPath(file)
    if (err) {
      this.deps.logger.warn('update', `could not open ${file}: ${err}`)
      shell.showItemInFolder(file)
    }
  }

  /** Called whenever recordings become idle, to run a deferred install. */
  onIdle(): void {
    if (this.status.phase === 'waiting-for-idle' && !this.deps.isBusy()) void this.install()
  }
}
