// Verifies a packaged build on the CI runner that produced it:
//  - required helper binaries, licenses and icons are inside the package,
//  - the bundled ffmpeg/ffprobe/whisper-cli actually run from the packaged location,
//  - every export codec works with the bundled ffmpeg,
//  - binaries match the target CPU architecture,
//  - distribution files (installer, portable, DMG, AppImage, DEB, update metadata) exist and
//    contain the binaries,
//  - optionally a real transcription smoke test (WHISPER_MODEL + JFK_WAV).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const platform = process.platform
const arch = process.env.TARGET_ARCH || process.arch
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const exe = (n) => (platform === 'win32' ? `${n}.exe` : n)

const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (err) {
    results.push({ name, ok: false, detail: err.message })
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  if (r.error) throw r.error
  return r
}

function findResources() {
  if (platform === 'win32') return join(dist, 'win-unpacked', 'resources')
  if (platform === 'linux') return join(dist, 'linux-unpacked', 'resources')
  for (const d of readdirSync(dist)) {
    if (!d.startsWith('mac')) continue
    const p = join(dist, d)
    if (!statSync(p).isDirectory()) continue
    const app = readdirSync(p).find((f) => f.endsWith('.app'))
    if (app) return join(p, app, 'Contents', 'Resources')
  }
  throw new Error('unpacked app not found')
}

const resources = findResources()
const bin = (n) => join(resources, 'bin', exe(n))

// ---------------------------------------------------------------- contents
check('package contents', () => {
  const required = [
    bin('ffmpeg'),
    bin('ffprobe'),
    bin('whisper-cli'),
    join(resources, 'app.asar'),
    join(resources, 'LICENSE.txt'),
    join(resources, 'THIRD_PARTY_NOTICES.md'),
    join(resources, 'licenses', 'FFmpeg-LICENSE.txt'),
    join(resources, 'licenses', 'whisper.cpp-LICENSE.txt'),
    join(resources, 'icons', 'app-256.png'),
    join(resources, 'icons', 'tray-16.png'),
    join(resources, 'icons', 'tray-32.png'),
    join(resources, 'icons', 'tray-recording-16.png'),
    join(resources, 'icons', 'tray-recording-32.png'),
    join(resources, 'icons', 'trayTemplate.png'),
    join(resources, 'icons', 'trayTemplate@2x.png')
  ]
  if (platform !== 'darwin') required.push(join(resources, 'app-update.yml'))
  const missing = required.filter((f) => !existsSync(f))
  assert(missing.length === 0, `missing: ${missing.join(', ')}`)
  assert(readFileSync(join(resources, 'LICENSE.txt'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'), 'LICENSE.txt is not GPL-3.0')
  return `${required.length} files`
})

check('update metadata points at GitHub', () => {
  if (platform === 'darwin') return 'not used on macOS (manual DMG upgrade)'
  const yml = readFileSync(join(resources, 'app-update.yml'), 'utf8')
  assert(/provider:\s*github/.test(yml) && /owner:\s*demirgitbuh/.test(yml) && /repo:\s*SonoraSoundRecorder/.test(yml), yml)
  return 'github demirgitbuh/SonoraSoundRecorder'
})

// ---------------------------------------------------------------- binaries run
check('ffmpeg runs and has the required encoders', () => {
  const r = run(bin('ffmpeg'), ['-hide_banner', '-encoders'])
  assert(r.status === 0, r.stderr)
  for (const enc of ['libmp3lame', 'libopus', 'flac', 'aac', 'pcm_s24le', 'pcm_f32le']) assert(r.stdout.includes(enc), `encoder ${enc} missing`)
  return run(bin('ffmpeg'), ['-version']).stdout.split('\n')[0]
})

check('ffprobe runs', () => {
  const r = run(bin('ffprobe'), ['-version'])
  assert(r.status === 0, r.stderr)
  return r.stdout.split('\n')[0]
})

check('whisper-cli runs', () => {
  const r = run(bin('whisper-cli'), ['-h'])
  assert(r.status === 0, `exit ${r.status}: ${r.stderr.slice(-500)}`)
  assert(/usage/i.test(r.stdout + r.stderr), 'no usage text')
  return 'usage printed'
})

const work = mkdtempSync(join(tmpdir(), 'sonora-verify-'))
check('every export format encodes with the bundled ffmpeg', () => {
  const cases = [
    ['wav', ['-c:a', 'pcm_s24le', '-f', 'wav'], 'pcm_s24le'],
    ['flac', ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-f', 'flac'], 'flac'],
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3'], 'mp3'],
    ['ogg', ['-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg'], 'opus'],
    ['m4a', ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'ipod'], 'aac']
  ]
  const ok = []
  for (const [ext, args, codec] of cases) {
    const out = join(work, `t.${ext}`)
    const r = run(bin('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-ac', '2', ...args, '-y', out])
    assert(r.status === 0, `${ext}: ${r.stderr}`)
    const p = run(bin('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out])
    assert(p.stdout.trim() === codec, `${ext}: codec ${p.stdout.trim()} != ${codec}`)
    ok.push(ext)
  }
  return ok.join(', ')
})

check('transcription smoke test', () => {
  const model = process.env.WHISPER_MODEL
  const wav = process.env.JFK_WAV
  if (!model || !wav || !existsSync(model) || !existsSync(wav)) return 'skipped (no model provided)'
  const outBase = join(work, 'jfk')
  const r = run(bin('whisper-cli'), ['-m', model, '-f', wav, '-l', 'en', '-t', '4', '-oj', '-of', outBase, '-ng'])
  assert(r.status === 0, `exit ${r.status}: ${r.stderr.slice(-800)}`)
  const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8'))
  const text = json.transcription.map((s) => s.text).join(' ').toLowerCase()
  assert(text.includes('country'), `unexpected transcript: ${text}`)
  return `“${text.trim().slice(0, 60)}…”`
})

// ---------------------------------------------------------------- architecture
function peMachine(file) {
  const buf = readFileSync(file)
  const off = buf.readUInt32LE(0x3c)
  return buf.readUInt16LE(off + 4)
}
check(`binaries are ${arch}`, () => {
  const files = [bin('ffmpeg'), bin('ffprobe'), bin('whisper-cli')]
  if (platform === 'win32') {
    for (const f of [...files, join(dirname(resources), 'Sonora Sound Recorder.exe')]) {
      assert(peMachine(f) === 0x8664, `${f} is not x64`)
    }
    return 'PE x86-64'
  }
  if (platform === 'darwin') {
    const want = arch === 'arm64' ? 'arm64' : 'x86_64'
    const main = join(dirname(resources), 'MacOS', 'Sonora Sound Recorder')
    for (const f of [...files, main]) {
      const archs = execFileSync('lipo', ['-archs', f], { encoding: 'utf8' }).trim()
      assert(archs.split(/\s+/).includes(want), `${f}: ${archs}`)
    }
    return want
  }
  for (const f of [...files, join(dirname(resources), 'sonora-sound-recorder')]) {
    const out = execFileSync('file', ['-L', f], { encoding: 'utf8' })
    assert(out.includes('x86-64'), out)
  }
  return 'ELF x86-64'
})

// ---------------------------------------------------------------- distributables
function artifact(re) {
  const f = readdirSync(dist).find((n) => re.test(n))
  assert(f, `missing artifact ${re}`)
  const p = join(dist, f)
  assert(statSync(p).size > 40 * 1024 * 1024, `${f} is suspiciously small`)
  return p
}

if (platform === 'win32') {
  check('Windows installer, portable and update metadata', () => {
    const setup = artifact(new RegExp(`^Sonora-Sound-Recorder-${version}-Setup-x64\\.exe$`))
    const portable = artifact(new RegExp(`^Sonora-Sound-Recorder-${version}-Portable-x64\\.exe$`))
    assert(existsSync(`${setup}.blockmap`), 'installer blockmap missing')
    const latest = readFileSync(join(dist, 'latest.yml'), 'utf8')
    assert(latest.includes(`version: ${version}`) && latest.includes(`Sonora-Sound-Recorder-${version}-Setup-x64.exe`) && latest.includes('sha512:'), latest)
    return `${setup.split(/[\\/]/).pop()}, ${portable.split(/[\\/]/).pop()}, latest.yml`
  })
}

if (platform === 'darwin') {
  check('DMG contains the app with its helper binaries', () => {
    const dmg = artifact(new RegExp(`^Sonora-Sound-Recorder-${version}-${arch}\\.dmg$`))
    const mount = mkdtempSync(join(tmpdir(), 'sonora-dmg-'))
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg])
    try {
      const app = join(mount, 'Sonora Sound Recorder.app')
      for (const n of ['ffmpeg', 'ffprobe', 'whisper-cli']) assert(existsSync(join(app, 'Contents', 'Resources', 'bin', n)), `${n} missing in DMG`)
      const v = run('codesign', ['--verify', '--deep', '--strict', app])
      assert(v.status === 0, `codesign verify failed: ${v.stderr}`)
      return `${dmg.split('/').pop()} (ad-hoc signed)`
    } finally {
      execFileSync('hdiutil', ['detach', mount, '-force'])
    }
  })
}

if (platform === 'linux') {
  check('AppImage contains the helper binaries', () => {
    const appimage = artifact(new RegExp(`^Sonora-Sound-Recorder-${version}-x86_64\\.AppImage$`))
    chmodSync(appimage, 0o755)
    const dir = mkdtempSync(join(tmpdir(), 'sonora-appimage-'))
    const r = run(appimage, ['--appimage-extract'], { cwd: dir })
    assert(r.status === 0, r.stderr)
    for (const n of ['ffmpeg', 'ffprobe', 'whisper-cli']) assert(existsSync(join(dir, 'squashfs-root', 'resources', 'bin', n)), `${n} missing in AppImage`)
    const latest = readFileSync(join(dist, 'latest-linux.yml'), 'utf8')
    assert(latest.includes(`version: ${version}`) && latest.includes(appimage.split('/').pop()), latest)
    rmSync(dir, { recursive: true, force: true })
    return appimage.split('/').pop()
  })
  check('DEB package metadata and contents', () => {
    const deb = artifact(new RegExp(`^sonora-sound-recorder_${version}_amd64\\.deb$`))
    const fields = execFileSync('dpkg-deb', ['-f', deb, 'Package', 'Version', 'Architecture'], { encoding: 'utf8' })
    assert(fields.includes('Package: sonora-sound-recorder') && fields.includes(`Version: ${version}`) && fields.includes('Architecture: amd64'), fields)
    const list = execFileSync('dpkg-deb', ['-c', deb], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const n of ['resources/bin/ffmpeg', 'resources/bin/ffprobe', 'resources/bin/whisper-cli', 'resources/LICENSE.txt']) assert(list.includes(n), `${n} missing in DEB`)
    return deb.split('/').pop()
  })
}

rmSync(work, { recursive: true, force: true })

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
if (failed > 0) {
  console.error(`${failed} package check(s) failed`)
  process.exit(1)
}
console.log(`All ${results.length} package checks passed for ${platform}-${arch}.`)
