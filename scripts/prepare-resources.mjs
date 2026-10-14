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
