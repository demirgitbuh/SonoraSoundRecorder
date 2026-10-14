import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, ShareMenu, app, clipboard, dialog, ipcMain, shell } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { EngineSnapshot, InvokeArgs, InvokeChannel, InvokeResult, IpcEnvelope, PendingRun, RunMedia, SettingsImportPreview } from '../shared/ipc'
import type { MachineFieldKey, ParsedImport, SettingsPatch } from '../shared/settings'
import { SETTINGS_CATEGORIES, SettingsImportError, buildSettingsExport, mergeImported, parseSettingsExport } from '../shared/settings'
import { AUDIO_FORMATS, LOCALES, SHORTCUT_ACTIONS } from '../shared/types'
import type { Schedule, TrackKind } from '../shared/types'
import { scheduleSchema } from '../shared/library-schema'
import { APP_ORIGIN, MAX_VIRTUAL_WAV_DATA } from './protocol'
import { toLibraryError } from './services/audio-service'
import { LibraryError } from './services/library-store'
import { inspectModel } from './services/transcription'
import { RUN_ID_PATTERN } from './services/run-store'
import { isWritableDir, pathExists, freeSpace, writeFileAtomic } from './services/fs-utils'
import { autostartStatus, openPermissionSettings, permissionStatus, requestMicrophone } from './services/platform'
import type { AppContext } from './context'

const id = z.string().min(1).max(64)
const ids = z.array(id).max(5000)
const markers = z.array(z.object({ id: z.string().min(1).max(64), timeMs: z.number().min(0).max(1e10) })).max(10000)
const ranges = z
  .array(z.object({ startMs: z.number().min(0).max(1e10), endMs: z.number().min(0).max(1e10) }))
  .max(200)
const encoding = z.object({
  format: z.enum(AUDIO_FORMATS),
  sampleRate: z.number().int().min(8000).max(192000),
  channels: z.union([z.literal(1), z.literal(2)]),
  bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
  bitrateKbps: z.number().min(0).max(512),
  flacCompression: z.number().min(0).max(8)
})
const custom = encoding.omit({ format: true })
const track = z.enum(['mic', 'system', 'mix'])
const runId = z.string().regex(RUN_ID_PATTERN)
const pathString = z.string().min(1).max(4096)
const device = z.object({ label: z.string().max(512), nativeSampleRate: z.number().nullable(), nativeChannels: z.number().nullable() }).nullable()

const engineSnapshotSchema = z.object({
  sessions: z
    .array(
      z.object({
        id,
        name: z.string().max(60),
        state: z.enum(['ready', 'countdown', 'recording', 'paused', 'finalizing', 'preview', 'exporting', 'recoverable', 'error']),
        elapsedMs: z.number().min(0),
        capturesSystem: z.boolean()
      })
    )
    .max(16),
  selectedId: id.nullable(),
  unsavedPreviews: z.number().int().min(0)
})

function envelopeError(err: unknown): IpcEnvelope<never> {
  if (err instanceof SettingsImportError) return { ok: false, errorKey: err.reasonKey, detail: null }
  const e = toLibraryError(err)
  return { ok: false, errorKey: e.reasonKey, detail: e.message && e.message !== e.reasonKey ? e.message.slice(0, 500) : null }
}

export function registerIpc(ctx: AppContext): void {
  const { logger } = ctx
  const pendingImports = new Map<string, ParsedImport>()

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const url = event.senderFrame?.url ?? ''
    if (url.startsWith(`${APP_ORIGIN}/`)) return true
    const dev = process.env.ELECTRON_RENDERER_URL
    return !app.isPackaged && !!dev && url.startsWith(dev)
  }

  function handle<C extends InvokeChannel>(
    channel: C,
    schema: z.ZodTypeAny,
    fn: (event: IpcMainInvokeEvent, ...args: InvokeArgs<C>) => Promise<InvokeResult<C>> | InvokeResult<C>
  ): void {
    ipcMain.handle(channel, async (event, ...raw: unknown[]): Promise<IpcEnvelope<InvokeResult<C>>> => {
      if (!trusted(event)) return { ok: false, errorKey: 'errors.forbidden', detail: null }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        logger.warn('ipc', `rejected invalid arguments for ${channel}`)
        return { ok: false, errorKey: 'errors.invalidRequest', detail: null }
      }
      try {
        const value = await fn(event, ...(parsed.data as InvokeArgs<C>))
        return { ok: true, value }
      } catch (err) {
        if (!(err instanceof LibraryError)) logger.error('ipc', `${channel} failed`, err)
        return envelopeError(err)
      }
    })
  }

  const progressTask = (labelKey: string): { taskId: string; report: (f: number) => void } => {
    const taskId = randomUUID()
    let last = -1
    return {
      taskId,
      report: (f: number) => {
        const percent = Math.round(Math.min(1, Math.max(0, f)) * 100)
        if (percent === last) return
        last = percent
        ctx.windows.send('task:progress', { taskId, labelKey, percent })
      }
    }
  }

  const parentWindow = (event: IpcMainInvokeEvent): BrowserWindow | undefined => BrowserWindow.fromWebContents(event.sender) ?? undefined

  // -------------------------------------------------------------------------- app
  handle('app:bootstrap', z.tuple([]), () => ctx.bootstrap())
  handle('app:open-external', z.tuple([z.string().url().max(2048)]), async (_e, url) => {
    // Only links to the project and the model documentation are opened from the app.
    if (!/^https:\/\/(github\.com|huggingface\.co)\//.test(url)) throw new LibraryError('errors.forbidden')
    await shell.openExternal(url)
  })
  handle('app:quit', z.tuple([]), () => {
    void ctx.requestQuit()
  })

  // -------------------------------------------------------------------------- settings
  handle('settings:update', z.tuple([z.record(z.unknown())]), async (_e, patch) => {
    const p = { ...(patch as SettingsPatch) }
    // The model path can only be changed through the model picker, which validates the file.
    if (p.transcription && 'modelPath' in p.transcription) {
      p.transcription = { ...p.transcription }
      delete p.transcription.modelPath
    }
    const dir = p.files?.recordingsDir
    if (typeof dir === 'string') {
      await mkdir(dir, { recursive: true }).catch(() => undefined)
      if (!(await isWritableDir(dir))) throw new LibraryError('errors.folderNotWritable', dir)
    }
    if (p.language !== undefined && p.language !== null && !(LOCALES as readonly string[]).includes(p.language)) {
      throw new LibraryError('errors.invalidRequest')
    }
    return ctx.settings.update(p)
  })
  handle('settings:reset', z.tuple([z.union([z.enum(SETTINGS_CATEGORIES), z.literal('all')])]), (_e, category) =>
    ctx.settings.reset(category, ctx.systemTheme())
  )
  handle('settings:export', z.tuple([]), async (event) => {
    const res = await dialog.showSaveDialog(parentWindow(event)!, {
      title: ctx.t('settings.advanced.exportTitle'),
      defaultPath: `sonora-settings-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return null
    const file = buildSettingsExport(ctx.settings.value, app.getVersion(), new Date())
    await writeFileAtomic(res.filePath, JSON.stringify(file, null, 2))
    logger.info('settings', 'settings exported')
    return res.filePath
  })
  handle('settings:import-preview', z.tuple([]), async (event): Promise<SettingsImportPreview | null> => {
    const res = await dialog.showOpenDialog(parentWindow(event)!, {
      title: ctx.t('settings.advanced.importTitle'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const { readFile, stat } = await import('node:fs/promises')
    const s = await stat(res.filePaths[0]!)
    if (s.size > 2 * 1024 * 1024) throw new SettingsImportError('settings.import.errorTooLarge')
    const parsed = parseSettingsExport(await readFile(res.filePaths[0]!, 'utf8'))
    const token = randomUUID()
    pendingImports.set(token, parsed)
    const machineFields: SettingsImportPreview['machineFields'] = []
    for (const f of parsed.machineFields) {
      if (f.value === null) {
        machineFields.push({ key: f.key, value: null, valid: null, reasonKey: null })
        continue
      }
      if (f.key === 'files.recordingsDir') {
        const ok = await isWritableDir(f.value)
        machineFields.push({ key: f.key, value: f.value, valid: ok, reasonKey: ok ? null : 'settings.import.folderUnavailable' })
      } else if (f.key === 'transcription.modelPath') {
        const info = await inspectModel(f.value)
        machineFields.push({ key: f.key, value: f.value, valid: info.valid, reasonKey: info.valid ? null : (info.reasonKey ?? 'settings.import.modelUnavailable') })
      } else {
        // Device ids can only be checked by the renderer against the connected devices.
        machineFields.push({ key: f.key, value: f.value, valid: null, reasonKey: null })
      }
    }
    return { token, sourceVersion: parsed.sourceVersion, machineFields }
  })
  handle(
    'settings:import-apply',
    z.tuple([z.string().uuid(), z.array(z.enum(['files.recordingsDir', 'transcription.modelPath', 'audio.defaultMicDeviceId', 'sessions.devices']))]),
    async (_e, token, accepted) => {
      const parsed = pendingImports.get(token)
      if (!parsed) throw new SettingsImportError('settings.import.errorExpired')
      pendingImports.delete(token)
      const safe: MachineFieldKey[] = []
      for (const key of accepted) {
        if (key === 'files.recordingsDir') {
          if (parsed.imported.files.recordingsDir && (await isWritableDir(parsed.imported.files.recordingsDir))) safe.push(key)
        } else if (key === 'transcription.modelPath') {
          if (parsed.imported.transcription.modelPath && (await inspectModel(parsed.imported.transcription.modelPath)).valid) safe.push(key)
        } else {
          safe.push(key)
        }
      }
      const merged = mergeImported(ctx.settings.value, parsed.imported, safe)
      logger.info('settings', `imported settings (schema ${parsed.sourceVersion}); accepted machine fields: ${safe.join(',') || 'none'}`)
      return ctx.settings.replace(merged)
    }
  )
  handle('profiles:list', z.tuple([]), () => ctx.settings.profiles())
  handle('profiles:save', z.tuple([z.string().trim().min(1).max(60)]), (_e, name) => ctx.settings.saveProfile(name))
  handle('profiles:apply', z.tuple([id]), (_e, profileId) => {
    const s = ctx.settings.applyProfile(profileId)
    if (!s) throw new LibraryError('errors.profileNotFound')
    return s
  })
  handle('profiles:delete', z.tuple([id]), (_e, profileId) => ctx.settings.deleteProfile(profileId))

  // -------------------------------------------------------------------------- files & folders
  handle('dialog:choose-folder', z.tuple([pathString.nullable()]), async (event, initial) => {
    const res = await dialog.showOpenDialog(parentWindow(event)!, {
      title: ctx.t('files.chooseFolder'),
      defaultPath: initial ?? ctx.defaultRecordingsDir(),
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]!
  })
  handle('files:check-folder', z.tuple([pathString]), async (_e, dir) => {
    const exists = await pathExists(dir)
    return { path: dir, exists, writable: exists ? await isWritableDir(dir) : false, freeBytes: await freeSpace(dir) }
  })
  handle('files:move-recordings', z.tuple([pathString]), async (_e, dir) => {
    const task = progressTask('files.moveProgress')
    return ctx.audio.moveRecordings(dir, task.report)
  })
  handle('files:open-recordings-folder', z.tuple([]), async () => {
    const dir = ctx.settings.value.files.recordingsDir
    if (!dir) throw new LibraryError('errors.noRecordingsFolder')
    await mkdir(dir, { recursive: true })
    const err = await shell.openPath(dir)
    if (err) throw new LibraryError('errors.openFailed', err)
  })
  handle('files:free-space', z.tuple([pathString.nullable()]), async (_e, dir) => {
    const target = dir ?? ctx.settings.value.files.recordingsDir
    return target ? freeSpace(target) : null
  })
  handle('files:show', z.tuple([id]), (_e, recId) => {
    const rec = ctx.library.get(recId)
    shell.showItemInFolder(rec.filePath)
  })
  handle('files:copy-path', z.tuple([id]), (_e, recId) => {
    clipboard.writeText(ctx.library.get(recId).filePath)
  })
  handle('files:share', z.tuple([ids.min(1).max(50)]), async (event, recIds) => {
    if (process.platform !== 'darwin') return false
    const filePaths = recIds.map((r) => ctx.library.get(r).filePath)
    const menu = new ShareMenu({ filePaths })
    const win = parentWindow(event)
    menu.popup(win ? { window: win } : {})
    return true
  })

  // -------------------------------------------------------------------------- recording runs
  handle(
    'rec:begin',
    z.tuple([
      z.object({
        runId,
        sessionId: id,
        sessionName: z.string().max(60),
        sampleRate: z.number().int().min(8000).max(192000),
        channels: z.union([z.literal(1), z.literal(2)]),
        source: z.enum(['mic', 'system', 'both']),
        outputMode: z.enum(['combined', 'separate', 'both']),
        tracks: z.array(track).min(1).max(3),
        encoding,
        processing: z.object({ noiseSuppression: z.boolean(), echoCancellation: z.boolean(), autoGainControl: z.boolean() }),
        devices: z.object({ mic: device, system: device }),
        startedAt: z.string().datetime()
      })
    ]),
    async (_e, init) => {
      await ctx.runs.begin(init)
    }
  )
  handle(
    'rec:update',
    z.tuple([
      runId,
      z.object({
        state: z.enum(['recording', 'paused']).optional(),
        pauseReason: z.enum(['user', 'device-lost']).nullable().optional(),
        markers: markers.optional()
      })
    ]),
    (_e, rid, patch) => ctx.runs.update(rid, patch)
  )
  handle('rec:end', z.tuple([runId]), async (_e, rid) => {
    const res = await ctx.runs.end(rid)
    await ctx.broadcastRuns()
    return res
  })
  ipcMain.on('rec:chunk', (event, rid: unknown, trk: unknown, data: unknown) => {
    if (!trusted(event)) return
    if (typeof rid !== 'string' || !RUN_ID_PATTERN.test(rid)) return
    if (trk !== 'mic' && trk !== 'system' && trk !== 'mix') return
    let buffer: ArrayBuffer | null = null
    if (data instanceof ArrayBuffer) buffer = data
    else if (ArrayBuffer.isView(data)) buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    if (!buffer || buffer.byteLength > 16 * 1024 * 1024) return
    ctx.runs.write(rid, trk as TrackKind, buffer)
  })

  handle('runs:list', z.tuple([]), (): Promise<PendingRun[]> => ctx.runs.listPending())
  handle('runs:media', z.tuple([runId]), async (_e, rid): Promise<RunMedia[]> => {
    const m = await ctx.runs.readManifest(rid)
    if (!m || ctx.runs.isActive(rid)) throw new LibraryError('errors.runNotFound')
    const out: RunMedia[] = []
    for (const t of m.tracks) {
      const frames = await ctx.runs.trackFrames(rid, t, m.channels)
      if (frames * 4 * m.channels > MAX_VIRTUAL_WAV_DATA && !(await pathExists(ctx.runs.proxyPath(rid, t)))) {
        const task = progressTask('preview.preparing')
        const tmp = `${ctx.runs.proxyPath(rid, t)}.partial.ogg`
        await ctx.ffmpeg.run(
          ['-f', 'f32le', '-ar', String(m.sampleRate), '-ac', String(m.channels), '-i', ctx.runs.trackPath(rid, t), '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', '-y', tmp],
          { totalMs: (frames / m.sampleRate) * 1000, onProgress: task.report }
        )
        const { rename } = await import('node:fs/promises')
        await rename(tmp, ctx.runs.proxyPath(rid, t))
      }
      out.push({ track: t, url: `sonora-media://run/${rid}/${t}` })
    }
    return out
  })
  handle('runs:peaks', z.tuple([runId, track]), (_e, rid, t) => ctx.runs.peaks(rid, t))
  handle(
    'runs:save',
    z.tuple([
      runId,
      z.object({
        name: z.string().max(400).nullable(),
        encoding,
        keep: ranges.nullable(),
        saveMode: z.enum(['edited-only', 'original-and-edited']),
        markers,
        normalize: z.boolean()
      })
    ]),
    async (_e, rid, req) => {
      const task = progressTask('save.progress')
      const recs = await ctx.audio.saveRun(rid, req, task.report)
      await ctx.broadcastRuns()
      return recs
    }
  )
  handle('runs:discard', z.tuple([runId]), async (_e, rid) => {
    await ctx.runs.discard(rid)
    await ctx.broadcastRuns()
  })

  // -------------------------------------------------------------------------- library
  handle('library:get', z.tuple([]), () => ctx.library.snapshot())
  handle('library:refresh', z.tuple([]), async () => {
    await ctx.library.checkMissing()
    return ctx.library.snapshot()
  })
  handle('library:rename', z.tuple([id, z.string().min(1).max(400)]), (_e, recId, name) => ctx.library.rename(recId, name))
  handle(
    'library:update-meta',
    z.tuple([
      id,
      z.object({
        favorite: z.boolean().optional(),
        note: z.string().max(20000).optional(),
        folderId: id.nullable().optional(),
        tagIds: z.array(id).max(200).optional(),
        markers: markers.optional()
      })
    ]),
    (_e, recId, patch) => {
      if (patch.folderId && !ctx.library.folderExists(patch.folderId)) throw new LibraryError('errors.folderNotFound')
      if (patch.tagIds) patch.tagIds = patch.tagIds.filter((t) => ctx.library.tagExists(t))
      return ctx.library.patch(recId, patch)
    }
  )
  handle(
    'library:bulk',
    z.tuple([
      ids.min(1),
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('trash') }),
        z.object({ kind: z.literal('move'), folderId: id.nullable() }),
        z.object({ kind: z.literal('tag'), tagId: id, add: z.boolean() }),
        z.object({ kind: z.literal('favorite'), value: z.boolean() })
      ])
    ]),
    async (_e, recIds, action) => {
      if (action.kind === 'trash') return ctx.library.trash(recIds)
      const results = recIds.map((recId) => {
        const rec = ctx.library.find(recId)
        if (!rec) return { id: recId, name: recId, ok: false, errorKey: 'errors.recordingNotFound' }
        try {
          if (action.kind === 'move') {
            if (action.folderId && !ctx.library.folderExists(action.folderId)) throw new LibraryError('errors.folderNotFound')
            ctx.library.patch(recId, { folderId: action.folderId })
          } else if (action.kind === 'tag') {
            if (!ctx.library.tagExists(action.tagId)) throw new LibraryError('errors.tagNotFound')
            const tagIds = action.add ? [...new Set([...rec.tagIds, action.tagId])] : rec.tagIds.filter((t) => t !== action.tagId)
            ctx.library.patch(recId, { tagIds })
          } else {
            ctx.library.patch(recId, { favorite: action.value })
          }
          return { id: recId, name: rec.name, ok: true }
        } catch (err) {
          const e = toLibraryError(err)
          return { id: recId, name: rec.name, ok: false, errorKey: e.reasonKey }
        }
      })
      return { results }
    }
  )
  handle(
    'library:export',
    z.tuple([
      ids.min(1),
      z.object({ format: z.union([z.enum(AUDIO_FORMATS), z.literal('original')]), profile: z.enum(['high', 'standard', 'compact', 'custom']), custom, normalize: z.boolean() })
    ]),
    async (event, recIds, req) => {
      const res = await dialog.showOpenDialog(parentWindow(event)!, {
        title: ctx.t('export.chooseFolder'),
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || res.filePaths.length === 0) return null
      const task = progressTask('export.progress')
      return ctx.audio.exportRecordings(recIds, req, res.filePaths[0]!, task.report)
    }
  )
  handle('library:import', z.tuple([z.array(pathString).max(500).nullable()]), async (event, paths) => {
    let list = paths
    if (!list) {
      const res = await dialog.showOpenDialog(parentWindow(event)!, {
        title: ctx.t('archive.import'),
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: ctx.t('archive.importFilter'), extensions: ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a'] },
          { name: '*', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.filePaths.length === 0) return null
      list = res.filePaths
    }
    const task = progressTask('archive.importProgress')
    return ctx.audio.importFiles(list, task.report)
  })
  handle('library:peaks', z.tuple([id]), async (_e, recId) => {
    const cached = await ctx.library.readPeaks(recId)
    if (cached) return cached
    const rec = ctx.library.get(recId)
    if (!(await pathExists(rec.filePath))) return null
    const { peaks } = await ctx.ffmpeg.decodePeaks(rec.filePath)
    await ctx.library.writePeaks(recId, peaks)
    return peaks
  })
  handle('library:media-url', z.tuple([id]), (_e, recId) => {
    const rec = ctx.library.get(recId)
    return `sonora-media://rec/${rec.id}?v=${encodeURIComponent(rec.updatedAt)}`
  })
  handle(
    'library:apply-edit',
    z.tuple([id, z.object({ keep: ranges.min(1), mode: z.enum(['copy', 'replace']), markers })]),
    async (_e, recId, req) => {
      const task = progressTask('edit.progress')
      return ctx.audio.applyEdit(recId, req, task.report)
    }
  )
  handle('library:restore', z.tuple([ids.min(1)]), (_e, recIds) => ctx.library.restore(recIds))
  handle('library:delete-forever', z.tuple([ids.min(1)]), (_e, recIds) => ctx.library.deleteForever(recIds))
  handle('library:empty-trash', z.tuple([]), () => ctx.library.emptyTrash())
  handle('library:locate', z.tuple([id]), async (event, recId) => {
    const rec = ctx.library.get(recId)
    const res = await dialog.showOpenDialog(parentWindow(event)!, {
      title: ctx.t('archive.locate'),
      defaultPath: rec.filePath,
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const probe = await ctx.ffmpeg.probe(res.filePaths[0]!)
    if (!probe.audio) throw new LibraryError('errors.unsupportedFile')
    return ctx.library.relink(recId, res.filePaths[0]!)
  })
  handle('library:folder-create', z.tuple([z.string().min(1).max(80)]), (_e, name) => ctx.library.createFolder(name))
  handle('library:folder-rename', z.tuple([id, z.string().min(1).max(80)]), (_e, fid, name) => ctx.library.renameFolder(fid, name))
  handle('library:folder-delete', z.tuple([id]), (_e, fid) => ctx.library.deleteFolder(fid))
  handle('library:tag-create', z.tuple([z.string().min(1).max(40)]), (_e, name) => ctx.library.createTag(name))
  handle('library:tag-rename', z.tuple([id, z.string().min(1).max(40)]), (_e, tid, name) => ctx.library.renameTag(tid, name))
  handle('library:tag-delete', z.tuple([id]), (_e, tid) => ctx.library.deleteTag(tid))
  handle('library:search-transcripts', z.tuple([z.string().max(200)]), (_e, text) => ctx.library.searchTranscripts(text))

  // -------------------------------------------------------------------------- transcription
  handle('transcript:get', z.tuple([id]), (_e, recId) => ctx.library.readTranscript(recId))
  handle('transcribe:start', z.tuple([id]), (_e, recId) => ctx.transcription.start(recId))
  handle('transcribe:cancel', z.tuple([z.string().uuid()]), (_e, jobId) => ctx.transcription.cancel(jobId))
  handle('transcribe:jobs', z.tuple([]), () => ctx.transcription.list())
  handle('transcribe:choose-model', z.tuple([]), async (event) => {
    const current = ctx.settings.value.transcription.modelPath
    const res = await dialog.showOpenDialog(parentWindow(event)!, {
      title: ctx.t('transcription.chooseModel'),
      defaultPath: current ?? app.getPath('downloads'),
      properties: ['openFile'],
      filters: [
        { name: 'whisper.cpp GGML (.bin)', extensions: ['bin'] },
        { name: '*', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const info = await inspectModel(res.filePaths[0]!)
    if (info.valid) {
      ctx.settings.update({ transcription: { modelPath: info.path } })
      logger.info('transcribe', `model selected: ${basename(info.path)} (${info.family ?? 'unknown'})`)
    }
    return info
  })
  handle('transcribe:model-info', z.tuple([]), async () => {
    const p = ctx.settings.value.transcription.modelPath
    return p ? inspectModel(p) : null
  })

  // -------------------------------------------------------------------------- shortcuts
  const bindings = z.object(Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a, z.string().min(1).max(64)])) as Record<(typeof SHORTCUT_ACTIONS)[number], z.ZodString>)
  handle('shortcuts:apply', z.tuple([bindings, z.enum(['global', 'app'])]), (_e, b, scope) => {
    // The settings listener re-registers the shortcuts synchronously.
    ctx.settings.update({ shortcuts: { bindings: b, scope } })
    return ctx.shortcuts.status()
  })
  handle('shortcuts:suspend', z.tuple([z.boolean()]), (_e, suspended) => ctx.shortcuts.setSuspended(suspended))
  handle('shortcuts:status', z.tuple([]), () => ctx.shortcuts.status())

  // -------------------------------------------------------------------------- permissions & platform
  handle('permissions:status', z.tuple([]), () => permissionStatus())
  handle('permissions:request-mic', z.tuple([]), () => requestMicrophone())
  handle('permissions:open-settings', z.tuple([z.enum(['microphone', 'screen'])]), (_e, kind) => openPermissionSettings(kind))
  handle('autostart:status', z.tuple([]), () => autostartStatus())

  // -------------------------------------------------------------------------- updates
  handle('update:check', z.tuple([]), () => ctx.updates.check())
  handle('update:download', z.tuple([z.boolean()]), (_e, installAfter) => ctx.updates.download(installAfter))
  handle('update:install', z.tuple([]), () => ctx.updates.install())
  handle('update:status', z.tuple([]), () => ctx.updates.current)
  handle('update:open-download', z.tuple([]), () => ctx.updates.openDownloaded())

  // -------------------------------------------------------------------------- notifications & logs
  handle(
    'notify',
    z.tuple([
      z.object({
        kind: z.enum(['info', 'success', 'warning', 'error']),
        titleKey: z.string().max(120),
        bodyKey: z.string().max(120).optional(),
        params: z.record(z.union([z.string().max(500), z.number()])).optional(),
        detail: z.string().max(500).optional()
      })
    ]),
    (_e, req) => ctx.notify(req)
  )
  handle('logs:export', z.tuple([]), async (event) => {
    const res = await dialog.showSaveDialog(parentWindow(event)!, {
      title: ctx.t('settings.advanced.exportLogs'),
      defaultPath: `sonora-logs-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (res.canceled || !res.filePath) return null
    ctx.logger.exportTo(
      res.filePath,
      `Sonora Sound Recorder ${app.getVersion()} — ${process.platform} ${process.arch} ${process.getSystemVersion()} — exported ${new Date().toISOString()}`
    )
    return res.filePath
  })
  handle('logs:open-folder', z.tuple([]), async () => {
    await shell.openPath(ctx.logger.directory)
  })
  ipcMain.on('log:write', (event, level: unknown, scope: unknown, message: unknown) => {
    if (!trusted(event)) return
    if (level !== 'info' && level !== 'warn' && level !== 'error') return
    if (typeof scope !== 'string' || typeof message !== 'string') return
    ctx.logger.write(level, `renderer:${scope.slice(0, 30)}`, message.slice(0, 2000))
  })

  // -------------------------------------------------------------------------- schedules
  handle('schedules:list', z.tuple([]), () => ctx.schedules.value.schedules)
  handle('schedules:save', z.tuple([z.array(scheduleSchema).max(500)]), (_e, list) => {
    ctx.schedules.set({ schemaVersion: 1, schedules: list as Schedule[] })
    ctx.windows.send('schedules:changed', list as Schedule[])
    return list as Schedule[]
  })

  // -------------------------------------------------------------------------- windows & engine
  handle('window:mini', z.tuple([z.boolean()]), (_e, open) => {
    const res = ctx.windows.setMini(open)
    ctx.settings.update({ miniPanel: { open: res } })
    ctx.tray.refresh()
    return res
  })
  handle('window:show-main', z.tuple([z.enum(['record', 'archive', 'favorites', 'collections', 'trash', 'settings']).nullable()]), (_e, route) =>
    ctx.windows.showMain(route)
  )
  handle(
    'engine:dispatch',
    z.tuple([
      z.object({
        action: z.enum(['toggleRecord', 'togglePause', 'addMarker', 'stopAll', 'select']),
        sessionId: id.optional(),
        origin: z.enum(['shortcut', 'tray', 'mini', 'schedule'])
      })
    ]),
    (_e, cmd) => ctx.dispatch(cmd)
  )
  handle('engine:snapshot', z.tuple([]), () => ctx.engineSnapshot())
  ipcMain.on('engine:state', (event, snapshot: unknown) => {
    if (!trusted(event)) return
    const parsed = engineSnapshotSchema.safeParse(snapshot)
    if (parsed.success) ctx.setEngineSnapshot(parsed.data as EngineSnapshot)
  })
  ipcMain.on('engine:quit-ack', (event) => {
    if (trusted(event)) ctx.onQuitAck()
  })
  ipcMain.on('window:control', (event, action: unknown) => {
    if (!trusted(event)) return
    if (action === 'minimize' || action === 'maximize' || action === 'close') ctx.windows.windowControl(action)
  })
  ipcMain.on('app:ready', (event) => {
    if (trusted(event)) ctx.onRendererReady(BrowserWindow.fromWebContents(event.sender))
  })
}
