// Downloads the pinned FFmpeg and FFprobe builds for the current runner (or TARGET_ARCH) from the
// eugeneware/ffmpeg-static release, verifies every file against a pinned SHA-256 digest, and
// places them in vendor/bin/<os>-<arch>. License texts go to vendor/licenses.
// The builds are GPL-licensed FFmpeg with libmp3lame, libopus, FLAC and the native AAC encoder.
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const RELEASE = 'b6.1.1'
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`

const DIGESTS = {
  'ffmpeg-darwin-arm64.gz': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
  'ffmpeg-darwin-x64.gz': '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106',
  'ffmpeg-linux-x64.gz': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  'ffmpeg-win32-x64.gz': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'ffprobe-darwin-arm64.gz': 'd986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be',
  'ffprobe-darwin-x64.gz': 'd4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186',
  'ffprobe-linux-x64.gz': '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067',
  'ffprobe-win32-x64.gz': 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
  'darwin-arm64.LICENSE.gz': '5995e6d7b7fdb371505351fce50b9d6fd4d051f69d3468ed4dd4cbfc14a5b916',
  'darwin-arm64.README.gz': '527d4ea64a17e81a72ab57103b3817ee224261b5c07844d5a99af40758315154',
  'darwin-x64.LICENSE.gz': '07bfe0aa59feabb64665dde54683d4bcfa6901d1b9eb70219ee3d6ce5c5b51a2',
  'darwin-x64.README.gz': '63f983e795802452bdb02bd77c27f3dded90a63eec20d1f3e47220823aa8d1b2',
  'linux-x64.LICENSE.gz': 'e6f01cb10f21032b80e78a1b0bd13d6c387d6f18eed9a37f99ea35d7e3f7bb7a',
  'linux-x64.README.gz': 'ef9ccbfae3fccc2be1c0face637afb885edc2dfd13901e07ad8541ecc21bd76c',
  'win32-x64.LICENSE.gz': 'd751d40ef8ba97bf46964ae203bf88e7c0027b5459946ac758403c1bb032523f',
  'win32-x64.README.gz': '9910569b1b42c01b91dd03b85abc8472a15b5aa31188e41e9654ae08cc179d07'
}

const OS_NAME = { win32: 'win', darwin: 'mac', linux: 'linux' }

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const platform = process.platform
const arch = process.env.TARGET_ARCH || process.arch
const key = `${platform}-${arch}`
if (!DIGESTS[`ffmpeg-${key}.gz`]) {
  console.error(`No pinned FFmpeg build for ${key}`)
  process.exit(1)
}

async function download(name) {
  const url = `${BASE}/${name}`
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const digest = createHash('sha256').update(buf).digest('hex')
      if (digest !== DIGESTS[name]) throw new Error(`SHA-256 mismatch for ${name}: ${digest}`)
      return gunzipSync(buf)
    } catch (err) {
      if (attempt === 4 || String(err.message).startsWith('SHA-256')) throw err
      console.warn(`retrying ${name}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
}

const binDir = join(root, 'vendor', 'bin', `${OS_NAME[platform]}-${arch}`)
const licDir = join(root, 'vendor', 'licenses')
mkdirSync(binDir, { recursive: true })
mkdirSync(licDir, { recursive: true })

for (const tool of ['ffmpeg', 'ffprobe']) {
  const data = await download(`${tool}-${key}.gz`)
  const target = join(binDir, platform === 'win32' ? `${tool}.exe` : tool)
  writeFileSync(target, data)
  if (platform !== 'win32') chmodSync(target, 0o755)
  console.log(`${tool} -> ${target} (${(data.length / 1048576).toFixed(1)} MB, sha256 verified)`)
}
writeFileSync(join(licDir, 'FFmpeg-LICENSE.txt'), await download(`${key}.LICENSE.gz`))
writeFileSync(join(licDir, 'FFmpeg-BUILD-README.txt'), await download(`${key}.README.gz`))
writeFileSync(
  join(licDir, 'FFmpeg-SOURCE.txt'),
  [
    'FFmpeg is distributed with Sonora Sound Recorder under the GNU General Public License.',
    `Binaries: https://github.com/eugeneware/ffmpeg-static/releases/tag/${RELEASE}`,
    'Source code: https://ffmpeg.org/download.html (the build README lists the exact version and configuration).',
    ''
  ].join('\n')
)
console.log('licenses -> vendor/licenses')
