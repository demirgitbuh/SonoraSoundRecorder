import { memo, useEffect, useRef } from 'react'
import { liveData } from '../audio/live'
import { useApp } from '../stores/app'
import { useT } from '../i18n'

// ----------------------------------------------------------------------------- shared ticker
/*
 * One requestAnimationFrame loop drives every live visual. It only runs while something is
 * capturing and the window is visible: an idle or hidden recorder costs no drawing at all.
 */
type Job = (now: number) => void
const jobs = new Set<Job>()
let frame = 0
let windowVisible = true

function loop(now: number): void {
  frame = 0
  for (const job of jobs) job(now)
  schedule()
}

function schedule(): void {
  if (frame === 0 && windowVisible && jobs.size > 0) frame = requestAnimationFrame(loop)
}

function addJob(job: Job): () => void {
  jobs.add(job)
  schedule()
  return () => {
    jobs.delete(job)
    if (jobs.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

/** Called when the main window is hidden in the tray, minimized or shown again. */
export function setLiveVisible(visible: boolean): void {
  windowVisible = visible
  if (!visible && frame !== 0) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  schedule()
}

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

// ----------------------------------------------------------------------------- waveform

const BAR = 3
const GAP = 2

/**
 * Mirrored live waveform drawn from the real capture data of a session. It redraws only when
 * new audio arrived or the size or theme changed; without capture it shows a calm flat line.
 */
export const LiveWaveform = memo(function LiveWaveform({
  sessionId,
  active,
  recording,
  label
}: {
  sessionId: string
  active: boolean
  recording: boolean
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useApp((s) => `${s.settings?.theme}-${s.settings?.highContrast}`)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const data = liveData(sessionId)
    const buf = new Float32Array(1200)
    const colors = { wave: '#36454f', dim: 'rgba(54,69,79,.28)', grid: 'rgba(54,69,79,.08)', rec: '#c93c3c' }
    let w = 0
    let h = 0
    let fade: CanvasGradient | null = null
    let drawnWritten = -1
    let dirty = true

    // Runs from the ResizeObserver, i.e. after the theme attributes of this render are applied.
    const resize = (): void => {
      colors.wave = cssVar(canvas, '--wave', colors.wave)
      colors.dim = cssVar(canvas, '--wave-dim', colors.dim)
      colors.grid = cssVar(canvas, '--wave-grid', colors.grid)
      colors.rec = cssVar(canvas, '--rec', colors.rec)
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Older bars fade towards the left while recording.
      fade = ctx.createLinearGradient(0, 0, w, 0)
      fade.addColorStop(0, colors.dim)
      fade.addColorStop(0.55, colors.wave)
      fade.addColorStop(1, colors.wave)
      dirty = true
    }

    const draw = (): void => {
      if (w === 0 || (!dirty && data.written === drawnWritten)) return
      dirty = false
      drawnWritten = data.written
      ctx.clearRect(0, 0, w, h)
      const mid = h / 2
      ctx.fillStyle = colors.grid
      ctx.fillRect(0, Math.round(mid), w, 1)
      const count = Math.floor(w / (BAR + GAP))
      const n = active ? data.recent(count, buf) : 0
      if (n > 0) {
        const offset = w - n * (BAR + GAP)
        const maxH = mid - 6
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          // Perceptual scaling keeps speech readable without exaggerating noise.
          const amp = Math.max(1, Math.pow(Math.min(1, buf[i]!), 0.62) * maxH)
          ctx.roundRect(offset + i * (BAR + GAP), mid - amp, BAR, amp * 2, 1.5)
        }
        ctx.fillStyle = recording && fade ? fade : colors.dim
        ctx.fill()
      }
      if (active && recording) {
        ctx.fillStyle = colors.rec
        ctx.fillRect(w - 2, 8, 2, h - 16)
      }
    }

    const observer = new ResizeObserver(() => {
      resize()
      draw()
    })
    observer.observe(canvas)
    const stop = active ? addJob(draw) : null
    return () => {
      observer.disconnect()
      stop?.()
    }
  }, [sessionId, active, recording, theme])
  return <canvas ref={ref} className="live-wave" role="img" aria-label={label} />
})

// ----------------------------------------------------------------------------- meters

const MIN_DB = -60

function norm(v: number): number {
  if (v <= 0) return 0
  const db = 20 * Math.log10(v)
  return Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB))
}

const MeterRow = memo(function MeterRow({ name, pick, sessionId, active }: { name: string; pick: 'mic' | 'system' | 'mix'; sessionId: string; active: boolean }) {
  const t = useT()
  const fill = useRef<HTMLDivElement>(null)
  const rms = useRef<HTMLDivElement>(null)
  const hold = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLSpanElement>(null)
  const db = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const track = hold.current?.parentElement
    if (!fill.current || !rms.current || !hold.current || !clip.current || !db.current || !track) return
    const els = { fill: fill.current, rms: rms.current, hold: hold.current, clip: clip.current, db: db.current }
    const data = liveData(sessionId)
    let width = track.clientWidth
    let last = { peak: -1, rms: -1, hold: -1, clip: false, text: '' }

    const render = (peak: number, r: number, h: number, clipping: boolean): void => {
      const p = norm(peak)
      const q = norm(r)
      const k = norm(h)
      if (p !== last.peak) els.fill.style.transform = `scaleX(${p})`
      if (q !== last.rms) els.rms.style.transform = `scaleX(${q})`
      if (k !== last.hold) els.hold.style.transform = `translateX(${Math.max(0, k * width - 2)}px)`
      if (clipping !== last.clip) els.clip.classList.toggle('on', clipping)
      const text = peak > 0 ? `${Math.max(MIN_DB, 20 * Math.log10(peak)).toFixed(0)} dB` : '−∞'
      if (text !== last.text) els.db.textContent = text
      last = { peak: p, rms: q, hold: k, clip: clipping, text }
    }

    const observer = new ResizeObserver(() => {
      width = track.clientWidth
      last.hold = -1
    })
    observer.observe(track)

    if (!active) {
      render(0, 0, 0, false)
      return () => observer.disconnect()
    }
    const stop = addJob((now) => {
      const m = data[pick]
      const stale = now - data.updatedAt > 400
      render(stale ? 0 : m.peak, stale ? 0 : m.rms, stale ? 0 : m.hold, m.clipAt > 0 && now - m.clipAt < 1500)
    })
    return () => {
      observer.disconnect()
      stop()
    }
  }, [sessionId, pick, active])
  return (
    <div className="meter">
      <span className="meter-label truncate">{name}</span>
      <div className="meter-track" role="presentation">
        <div ref={fill} className="meter-fill" />
        <div ref={rms} className="meter-rms" />
        <div className="meter-scale" />
        <div ref={hold} className="meter-hold" />
      </div>
      <div className="row nowrap" style={{ gap: 6 }}>
        <span ref={db} className="meter-db tnum">
          −∞
        </span>
        <span ref={clip} className="clip" title={t('record.clipHint')}>
          {t('record.clip')}
        </span>
      </div>
    </div>
  )
})

/** Separate level meters for microphone and system audio (and the mix when both are used). */
export const LevelMeters = memo(function LevelMeters({ sessionId, mic, system, active }: { sessionId: string; mic: boolean; system: boolean; active: boolean }) {
  const t = useT()
  return (
    <div className="stack" style={{ gap: 10 }} aria-label={t('record.levels')} role="group">
      {mic && <MeterRow name={t('source.mic')} pick="mic" sessionId={sessionId} active={active} />}
      {system && <MeterRow name={t('source.system')} pick="system" sessionId={sessionId} active={active} />}
      {mic && system && <MeterRow name={t('source.mix')} pick="mix" sessionId={sessionId} active={active} />}
    </div>
  )
})
