import { useEffect, useRef } from 'react'
import { liveData } from '../audio/live'
import type { MeterValue } from '../audio/live'
import { useT } from '../i18n'

function cssVar(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

/** Sizes a canvas to its box at device pixel ratio; returns the CSS size. */
function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width))
  const h = Math.max(1, Math.round(rect.height))
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  return { w, h, dpr }
}

/**
 * Mirrored live waveform drawn from the real capture data of a session. When nothing is being
 * captured a calm flat line is shown — there is never synthetic or random data.
 */
export function LiveWaveform({ sessionId, active, recording, label }: { sessionId: string; active: boolean; recording: boolean; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const data = liveData(sessionId)
    const buf = new Float32Array(1200)
    let raf = 0
    let colors = { wave: '#36454f', dim: 'rgba(54,69,79,.28)', grid: 'rgba(54,69,79,.08)', rec: '#c93c3c' }
    let frame = 0
    const draw = (): void => {
      if (frame++ % 30 === 0) {
        colors = {
          wave: cssVar(canvas, '--wave', colors.wave),
          dim: cssVar(canvas, '--wave-dim', colors.dim),
          grid: cssVar(canvas, '--wave-grid', colors.grid),
          rec: cssVar(canvas, '--rec', colors.rec)
        }
      }
      const { w, h, dpr } = fitCanvas(canvas)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const mid = h / 2
      ctx.fillStyle = colors.grid
      ctx.fillRect(0, Math.round(mid), w, 1)
      const bar = 3
      const gap = 2
      const count = Math.floor(w / (bar + gap))
      const n = active ? data.recent(count, buf) : 0
      const offset = w - n * (bar + gap)
      const maxH = mid - 6
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, buf[i]!)
        // Perceptual scaling so speech is readable without exaggerating noise.
        const amp = Math.max(1, Math.pow(v, 0.62) * maxH)
        const x = offset + i * (bar + gap)
        const age = (n - i) / n
        ctx.fillStyle = recording ? colors.wave : colors.dim
        ctx.globalAlpha = recording ? 0.35 + 0.65 * (1 - age * 0.6) : 0.9
        ctx.beginPath()
        ctx.roundRect(x, mid - amp, bar, amp * 2, 1.5)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      if (active && recording) {
        ctx.fillStyle = colors.rec
        ctx.fillRect(w - 2, 8, 2, h - 16)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [sessionId, active, recording])
  return <canvas ref={ref} className="live-wave" role="img" aria-label={label} />
}

const MIN_DB = -60

function norm(v: number): number {
  if (v <= 0) return 0
  const db = 20 * Math.log10(v)
  return Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB))
}

function MeterRow({ name, pick, sessionId, active }: { name: string; pick: 'mic' | 'system' | 'mix'; sessionId: string; active: boolean }) {
  const t = useT()
  const fill = useRef<HTMLDivElement>(null)
  const rms = useRef<HTMLDivElement>(null)
  const hold = useRef<HTMLDivElement>(null)
  const clip = useRef<HTMLSpanElement>(null)
  const db = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const data = liveData(sessionId)
    let raf = 0
    let lastText = ''
    const tick = (): void => {
      const m: MeterValue = data[pick]
      const now = performance.now()
      const stale = !active || now - data.updatedAt > 400
      const peak = stale ? 0 : m.peak
      if (fill.current) fill.current.style.transform = `scaleX(${norm(peak)})`
      if (rms.current) rms.current.style.transform = `scaleX(${stale ? 0 : norm(m.rms)})`
      if (hold.current) {
        const track = hold.current.parentElement
        const width = track ? track.clientWidth : 0
        hold.current.style.transform = `translateX(${Math.max(0, norm(stale ? 0 : m.hold) * width - 2)}px)`
      }
      const clipping = active && now - m.clipAt < 1500 && m.clipAt > 0
      if (clip.current && clip.current.classList.contains('on') !== clipping) clip.current.classList.toggle('on', clipping)
      if (db.current) {
        const text = peak > 0 ? `${Math.max(MIN_DB, 20 * Math.log10(peak)).toFixed(0)} dB` : '−∞'
        if (text !== lastText) {
          db.current.textContent = text
          lastText = text
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
}

/** Separate level meters for microphone and system audio (and the mix when both are used). */
export function LevelMeters({ sessionId, mic, system, active }: { sessionId: string; mic: boolean; system: boolean; active: boolean }) {
  const t = useT()
  return (
    <div className="stack" style={{ gap: 10 }} aria-label={t('record.levels')} role="group">
      {mic && <MeterRow name={t('source.mic')} pick="mic" sessionId={sessionId} active={active} />}
      {system && <MeterRow name={t('source.system')} pick="system" sessionId={sessionId} active={active} />}
      {mic && system && <MeterRow name={t('source.mix')} pick="mix" sessionId={sessionId} active={active} />}
    </div>
  )
}
