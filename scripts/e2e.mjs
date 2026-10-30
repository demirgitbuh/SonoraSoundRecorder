// End-to-end test of the real app (unpackaged build) under a virtual display on CI.
// A fake audio input feeds the recorder, so recording, saving and the mini panel shortcuts run
// for real. Screenshots of every screen are written to e2e-screenshots/ for review, and any
// renderer error fails the run.
import { _electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electronPath = require('electron')
const shots = join(root, 'e2e-screenshots')
mkdirSync(shots, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'sonora-e2e-'))
const errors = []
let shotIndex = 0

function log(message) {
  console.log(`▸ ${message}`)
}

const watched = new WeakSet()
function watch(page) {
  if (watched.has(page)) return
  watched.add(page)
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console ${page.url().includes('#mini') ? 'mini' : 'main'}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
}

async function launch() {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [root, '--no-sandbox', '--disable-audio-output', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: { ...process.env, SONORA_USER_DATA: userData },
    timeout: 90_000
  })
  app.on('window', watch)
  const page = await app.firstWindow()
  watch(page)
  await page.waitForSelector('.app', { timeout: 60_000 })
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.webContents.getURL().includes('#mini')) {
        w.setSize(1380, 880)
        w.center()
      }
    }
  })
  return { app, page }
}

async function shot(page, name) {
  await page.waitForTimeout(450)
  shotIndex++
  await page.screenshot({ path: join(shots, `${String(shotIndex).padStart(2, '0')}-${name}.png`) })
}

async function invoke(page, channel, ...args) {
  return page.evaluate(
    async ([c, a]) => {
      const res = await window.sonora.invoke(c, ...a)
      if (!res.ok) throw new Error(`${c}: ${res.errorKey}`)
      return res.value
    },
    [channel, args]
  )
}

async function settings(page) {
  return (await invoke(page, 'app:bootstrap')).settings
}

async function sendToMain(app, channel, payload) {
  await app.evaluate(
    ({ BrowserWindow }, [c, p]) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('#mini')) w.webContents.send(c, p)
    },
    [channel, payload]
  )
}

async function nav(page, label) {
  await page.locator('.sidebar .nav-item', { hasText: label }).first().click()
}

async function stageState(page, state, timeout = 15_000) {
  await page.waitForSelector(`.stage-card.state-${state}`, { timeout })
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

async function closeApp(app) {
  await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 20_000))])
  try {
    app.process().kill('SIGKILL')
  } catch {
    // Already gone.
  }
}

async function run() {
  // ------------------------------------------------------------------- first start
  log('first start: onboarding')
  let { app, page } = await launch()
  await page.waitForSelector('.onboarding')
  await shot(page, 'onboarding-language')
  await page.locator('button.language-option[lang="tr"]').click()
  await page.locator('.onb-next').click()
  await page.waitForSelector('text=02 / 06')
  await shot(page, 'onboarding-folder')
  await page.locator('.onb-next').click()
  await page.waitForSelector('text=03 / 06')
  await shot(page, 'onboarding-permissions')
  await page.locator('.onb-next').click()
  await page.waitForSelector('text=04 / 06')
  await shot(page, 'onboarding-source')
  await page.locator('.onb-next').click()
  await page.waitForSelector('text=05 / 06')
  await shot(page, 'onboarding-shortcuts')
  await page.locator('.onb-next').click()
  await page.waitForSelector('text=06 / 06')
  assert(await page.locator('.onb-next').isDisabled(), 'finish needs the terms to be accepted')
  await page.locator('.onb-legal input[type="checkbox"]').check()
  await shot(page, 'onboarding-summary')
  await page.locator('.onb-legal .link-btn').first().click()
  await page.waitForSelector('.legal-doc')
  await shot(page, 'onboarding-terms')
  await page.keyboard.press('Escape')
  await page.locator('.onb-next').click()
  await page.waitForSelector('.record-page', { timeout: 20_000 })

  // ------------------------------------------------------------------- recorder
  log('recorder: localized session, idle screen')
  const tab = await page.locator('.session-tab-btn').first().textContent()
  assert(tab?.includes('Oturum 1'), `session name is localized (got "${tab}")`)
  const s0 = await settings(page)
  assert(s0.legal.acceptedVersion, 'terms accepted during onboarding')
  await invoke(page, 'settings:update', { theme: 'dark', updates: { checkOnStartup: false } })
  await page.waitForTimeout(300)
  await shot(page, 'record-idle-dark')

  log('recorder: record with keyboard shortcuts')
  await page.locator('.stage').click()
  await page.keyboard.press('KeyK')
  await stageState(page, 'recording')
  await page.waitForTimeout(2500)
  await page.keyboard.press('KeyL')
  await page.waitForTimeout(600)
  await shot(page, 'record-recording')
  await page.keyboard.press('Space')
  await stageState(page, 'paused')
  await shot(page, 'record-paused')
  await page.keyboard.press('Space')
  await stageState(page, 'recording')
  await page.waitForTimeout(800)
  await page.keyboard.press('KeyK')
  await page.waitForSelector('.editor-page', { timeout: 20_000 })
  await page.waitForTimeout(800)
  await shot(page, 'editor-preview')
  await page.getByRole('button', { name: 'Kaydı kaydet' }).click()
  await page.waitForSelector('.record-page', { timeout: 30_000 })
  // A finished take leaves a clean screen: clock at zero, no old capture details.
  await page.waitForSelector('.serif-clock[aria-label="00:00:00"]', { timeout: 10_000 })
  assert((await page.locator('.capture-info').count()) === 0, 'capture details are cleared after the take')

  log('archive: saved recording')
  await nav(page, 'Arşiv')
  await page.waitForSelector('.rec-item', { timeout: 15_000 })
  await shot(page, 'archive-list')
  await page.locator('.rec-item .rec-main').first().click()
  await page.waitForSelector('.detail-panel')
  await shot(page, 'archive-detail')

  log('recorder: side panel collapse, cards and resize')
  await nav(page, 'Kayıt')
  await page.waitForSelector('.record-page')
  await page.getByRole('button', { name: 'Paneli gizle' }).click()
  await page.waitForTimeout(400)
  await shot(page, 'record-panel-hidden')
  assert((await settings(page)).layout.sidePanelCollapsed === true, 'collapsed panel is stored')
  await page.getByRole('button', { name: 'Paneli göster' }).click()
  await page.waitForTimeout(400)
  await page.locator('.side-card-toggle').first().click()
  await page.waitForTimeout(400)
  await shot(page, 'record-card-collapsed')
  await page.locator('.side-card-toggle').first().click()
  const handle = await page.locator('.panel-resizer').boundingBox()
  assert(handle, 'resize handle is visible')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 60)
  await page.mouse.down()
  await page.mouse.move(handle.x - 90, handle.y + 60, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const width = (await settings(page)).layout.sidePanelWidth
  assert(width > 360, `panel width is stored after dragging (got ${width})`)
  await shot(page, 'record-panel-wide')

  log('mini panel: shortcuts while it has focus')
  const miniPromise = app.waitForEvent('window', { predicate: (p) => p.url().includes('#mini'), timeout: 20_000 })
  await invoke(page, 'window:mini', true)
  const mini = await miniPromise
  watch(mini)
  await mini.waitForSelector('.mini')
  await mini.waitForTimeout(500)
  await shot(mini, 'mini-idle')
  await mini.locator('.mini-body').click()
  await mini.keyboard.press('KeyK')
  await stageState(page, 'recording')
  await mini.waitForTimeout(1800)
  await shot(mini, 'mini-recording')
  await mini.keyboard.press('Space')
  await stageState(page, 'paused')
  await mini.keyboard.press('Space')
  await stageState(page, 'recording')
  await mini.keyboard.press('KeyK')
  await page.waitForSelector('.editor-page', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Kaydı at' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydı at' }).click()
  await page.waitForSelector('.record-page', { timeout: 15_000 })

  log('mini panel: option off keeps the panel from reacting')
  await invoke(page, 'settings:update', { shortcuts: { miniPanel: false } })
  await mini.waitForTimeout(400)
  await mini.keyboard.press('KeyK')
  await mini.waitForTimeout(1500)
  assert((await page.locator('.stage-card.state-ready').count()) === 1, 'mini panel ignores keys when the option is off')
  await invoke(page, 'settings:update', { shortcuts: { miniPanel: true } })
  await invoke(page, 'window:mini', false)

  log('settings, about and legal')
  await nav(page, 'Ayarlar')
  await page.waitForSelector('.settings-page')
  await shot(page, 'settings-general')
  await page.locator('.settings-nav-item', { hasText: 'Kısayollar' }).click()
  await page.waitForTimeout(300)
  await shot(page, 'settings-shortcuts')
  await page.locator('.settings-nav-item', { hasText: 'Hakkında' }).click()
  await page.waitForSelector('.about-hero')
  await shot(page, 'settings-about')
  await page.getByRole('button', { name: 'Oku' }).first().click()
  await page.waitForSelector('.legal-doc')
  await shot(page, 'legal-terms')
  await page.keyboard.press('Escape')

  log('developer page')
  await invoke(page, 'settings:update', { developer: { enabled: true } })
  await nav(page, 'Geliştirici')
  await page.waitForSelector('.dev-card', { timeout: 15_000 })
  await page.waitForTimeout(1200)
  await shot(page, 'developer-overview')
  await page.getByRole('tab', { name: 'Canlı günlük' }).click()
  await page.waitForTimeout(500)
  await shot(page, 'developer-logs')
  await invoke(page, 'settings:update', { developer: { enabled: false } })
  await page.waitForSelector('.settings-page')

  log('update dialog')
  await nav(page, 'Kayıt')
  await page.waitForSelector('.record-page')
  const status = {
    phase: 'available',
    currentVersion: '0.2.0',
    installKind: 'nsis',
    autoInstall: true,
    release: {
      version: '0.3.0',
      tag: '0.3.0',
      name: 'Sonora Sound Recorder 0.3.0',
      notes: '## Yenilikler\n- Daha hızlı arşiv\n- Daha sakin dalga formu\n\n## Düzeltmeler\n- Mini panel kısayolları',
      publishedAt: '2026-11-20T10:00:00.000Z',
      url: 'https://github.com/demirgitbuh/SonoraSoundRecorder/releases'
    },
    progress: null,
    downloadedFile: null,
    installAfterDownload: false,
    errorKey: null,
    errorDetail: null,
    checkedAt: new Date().toISOString()
  }
  await sendToMain(app, 'update:status', status)
  await page.waitForSelector('.update-hero')
  await shot(page, 'update-available')
  await sendToMain(app, 'update:status', { ...status, phase: 'downloading', progress: { percent: 46, transferred: 72_000_000, total: 156_000_000 } })
  await page.waitForTimeout(400)
  await shot(page, 'update-downloading')
  await page.keyboard.press('Escape')

  log('legal consent for an existing user')
  await invoke(page, 'settings:update', { legal: { acceptedVersion: null, acceptedAt: null } })
  await page.waitForSelector('.legal-scroll')
  await shot(page, 'legal-consent')
  await page.getByRole('button', { name: 'Kabul et' }).click()
  await page.waitForTimeout(400)
  assert((await settings(page)).legal.acceptedVersion, 'consent is stored')

  log('themes and languages')
  await invoke(page, 'settings:update', { theme: 'light' })
  await page.waitForTimeout(500)
  await shot(page, 'record-idle-light')
  await nav(page, 'Arşiv')
  await page.waitForSelector('.rec-item')
  await shot(page, 'archive-light')
  await nav(page, 'Kayıt')
  await invoke(page, 'settings:update', { language: 'ru' })
  await page.waitForTimeout(500)
  const ruTab = await page.locator('.session-tab-btn').first().textContent()
  assert(ruTab?.includes('Сеанс 1'), `session name follows the language (got "${ruTab}")`)
  await shot(page, 'record-ru')
  await invoke(page, 'settings:update', { language: 'en' })
  await page.waitForTimeout(500)
  await shot(page, 'record-en')
  await invoke(page, 'settings:update', { language: 'tr', theme: 'dark' })
  await page.waitForTimeout(400)
  await closeApp(app)

  // ------------------------------------------------------------------- second start
  log('second start: everything persisted')
  ;({ app, page } = await launch())
  await page.waitForSelector('.record-page', { timeout: 30_000 })
  assert((await page.locator('.legal-scroll').count()) === 0, 'no consent dialog after acceptance')
  const s1 = await settings(page)
  assert(s1.layout.sidePanelWidth === width, 'panel width survives a restart')
  assert(s1.sessions[0].name === 'Oturum 1', 'session name survives a restart')
  await shot(page, 'relaunch-record')
  await nav(page, 'Arşiv')
  await page.waitForSelector('.rec-item', { timeout: 15_000 })
  await closeApp(app)
}

let failed = false
try {
  await run()
} catch (err) {
  failed = true
  console.error(err)
}

const logDir = join(userData, 'logs')
if (existsSync(logDir)) {
  for (const f of readdirSync(logDir)) {
    const lines = readFileSync(join(logDir, f), 'utf8').split('\n').filter((l) => l.includes('[ERROR]'))
    if (lines.length) console.log(`main process errors in ${f}:\n${lines.join('\n')}`)
  }
}
if (errors.length) {
  failed = true
  console.error(`renderer errors:\n${errors.join('\n')}`)
}
console.log(failed ? 'E2E FAILED' : `E2E passed, ${shotIndex} screenshots`)
process.exit(failed ? 1 : 0)
