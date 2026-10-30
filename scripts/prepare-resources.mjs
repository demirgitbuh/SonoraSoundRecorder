// Renders the PNG icons from the SVG sources in build/icon-src and copies the license text
// where electron-builder expects it. Runs in CI before packaging (no local build needed).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (name) => readFileSync(join(root, 'build', 'icon-src', name), 'utf8')

function render(svg, size, target) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng()
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, png)
  console.log(`icon ${size}px -> ${target.slice(root.length + 1)}`)
}

const icons = join(root, 'resources', 'icons')
const app = src('icon.svg')
const tray = src('tray.svg')
const trayRec = src('tray-recording.svg')
const template = src('tray-template.svg')

render(app, 1024, join(root, 'build', 'icon.png'))
render(app, 256, join(icons, 'app-256.png'))
render(tray, 16, join(icons, 'tray-16.png'))
render(tray, 32, join(icons, 'tray-32.png'))
render(trayRec, 16, join(icons, 'tray-recording-16.png'))
render(trayRec, 32, join(icons, 'tray-recording-32.png'))
render(template, 16, join(icons, 'trayTemplate.png'))
render(template, 32, join(icons, 'trayTemplate@2x.png'))

copyFileSync(join(root, 'LICENSE'), join(root, 'build', 'license.txt'))
console.log('license -> build/license.txt')

// ----------------------------------------------------------------------------- installer art
// The Windows installer shows a sidebar on its welcome/finish pages and a header on the other
// pages. electron-builder picks both up from build/ automatically. NSIS needs 24-bit BMP files.

const MARK = `
  <g fill="none" stroke="#F8F8FF" stroke-linecap="round" stroke-linejoin="round" stroke-width="84">
    <path d="M690 336C652 278 590 250 512 250C414 250 340 302 340 372C340 410 348 440 363 460"/>
    <path d="M334 688C372 746 434 774 512 774C610 774 684 722 684 652C684 614 676 584 661 564"/>
  </g>
  <g stroke="#F8F8FF" stroke-linecap="round" stroke-width="34">
    <line x1="436" y1="446" x2="436" y2="526"/><line x1="474" y1="419" x2="474" y2="579"/>
    <line x1="512" y1="392" x2="512" y2="632"/><line x1="550" y1="445" x2="550" y2="605"/>
    <line x1="588" y1="498" x2="588" y2="578"/>
  </g>`
const SHAPE = [0.18, 0.3, 0.46, 0.38, 0.6, 0.82, 0.64, 0.9, 1, 0.74, 0.52, 0.66, 0.88, 0.7, 0.44, 0.58, 0.8, 0.62, 0.4, 0.28, 0.5, 0.72]

function bars(x0, x1, mid, maxH, color, opacity) {
  const out = []
  const step = 6
  for (let i = 0, x = x0; x <= x1 - 3; i++, x += step) {
    const h = Math.max(2, SHAPE[i % SHAPE.length] * maxH)
    const fade = opacity * (0.45 + 0.55 * Math.sin((Math.PI * (x - x0)) / (x1 - x0)))
    out.push(`<rect x="${x}" y="${(mid - h / 2).toFixed(1)}" width="3" height="${h.toFixed(1)}" rx="1.5" fill="${color}" fill-opacity="${fade.toFixed(2)}"/>`)
  }
  return out.join('')
}

const sidebar = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.28" r="0.95">
      <stop offset="0" stop-color="#4A5C68"/>
      <stop offset="1" stop-color="#26323A"/>
    </radialGradient>
  </defs>
  <rect width="164" height="314" fill="url(#bg)"/>
  <g transform="translate(40 52) scale(0.08203125)">
    <rect x="64" y="64" width="896" height="896" rx="228" fill="#F8F8FF" fill-opacity="0.06" stroke="#F8F8FF" stroke-opacity="0.22" stroke-width="10"/>
    ${MARK}
  </g>
  ${bars(16, 148, 252, 46, '#F8F8FF', 0.5)}
</svg>`

const header = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#F8F8FF"/>
  ${bars(10, 96, 28.5, 26, '#36454F', 0.55)}
  <g transform="translate(104 8) scale(0.0400390625)">
    <rect x="64" y="64" width="896" height="896" rx="228" fill="#36454F"/>
    ${MARK}
  </g>
</svg>`

function writeBmp(svg, target) {
  const image = new Resvg(svg, { fitTo: { mode: 'original' } }).render()
  const { width, height } = image
  const rgba = image.pixels
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const size = 54 + rowSize * height
  const buf = Buffer.alloc(size)
  buf.write('BM', 0, 'ascii')
  buf.writeUInt32LE(size, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(rowSize * height, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * rowSize
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = rgba[i + 3] / 255
      const o = row + x * 3
      // Composited over white; the artwork itself is opaque.
      buf[o] = Math.round(rgba[i + 2] * a + 255 * (1 - a))
      buf[o + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a))
      buf[o + 2] = Math.round(rgba[i] * a + 255 * (1 - a))
    }
  }
  writeFileSync(target, buf)
  console.log(`installer art ${width}x${height} -> ${target.slice(root.length + 1)}`)
}

writeBmp(sidebar, join(root, 'build', 'installerSidebar.bmp'))
writeBmp(header, join(root, 'build', 'installerHeader.bmp'))
