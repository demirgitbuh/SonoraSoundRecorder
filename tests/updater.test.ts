import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/ipc'
import { tempDir, testLogger } from './helpers'

const fetchMock = vi.fn<(url: string) => Promise<Response>>()

vi.mock('electron', () => ({
  net: { fetch: (url: string) => fetchMock(url) },
  shell: { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

const { UpdateService } = await import('../src/main/services/updater')

// Larger than a write stream buffer, so a failing disk is only noticed through the stream error.
const PACKAGE = new Uint8Array(256 * 1024).fill(7)
const DEB = 'sonora-sound-recorder_0.2.0_amd64.deb'

function release(): Response {
  return Response.json({
    tag_name: '0.2.0',
    name: 'Sonora Sound Recorder 0.2.0',
    body: 'notes',
    html_url: 'https://github.com/demirgitbuh/SonoraSoundRecorder/releases/tag/0.2.0',
    published_at: '2026-10-20T10:00:00Z',
    draft: false,
    prerelease: false,
    assets: [{ name: DEB, browser_download_url: `https://example.invalid/${DEB}`, size: PACKAGE.length }]
  })
}

describe('update service', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url) => (url.includes('/releases') ? release() : new Response(PACKAGE)))
  })
  afterEach(() => cleanup())

  const service = (downloadsDir: string): InstanceType<typeof UpdateService> =>
    new UpdateService({
      logger: testLogger(dir),
      currentVersion: '0.1.2',
      installKind: 'deb',
      arch: 'x64',
      isPackaged: true,
      downloadsDir: () => downloadsDir,
      isBusy: () => false,
      beforeInstall: async () => undefined,
      emit: (_s: UpdateStatus) => undefined
    })

  it('downloads the package for this installation type', async () => {
    const updates = service(dir)
    expect((await updates.check()).phase).toBe('available')
    const status = await updates.download(false)
    expect(status.phase).toBe('downloaded')
    expect(status.downloadedFile).toBe(join(dir, DEB))
    expect(readFileSync(join(dir, DEB)).equals(PACKAGE)).toBe(true)
  })

  it('checking again keeps a downloaded update', async () => {
    const updates = service(dir)
    await updates.check()
    await updates.download(false)
    const calls = fetchMock.mock.calls.length
    const status = await updates.check()
    expect(status.phase).toBe('downloaded')
    expect(status.downloadedFile).toBe(join(dir, DEB))
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('reports a download that cannot be written instead of waiting forever', async () => {
    const missing = join(dir, 'no-such-folder')
    const updates = service(missing)
    await updates.check()
    const status = await updates.download(false)
    expect(status.phase).toBe('error')
    expect(status.errorKey).toBe('updates.errorDownload')
    expect(existsSync(join(missing, `${DEB}.part`))).toBe(false)
  })
})
