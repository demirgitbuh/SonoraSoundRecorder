import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { Marker, TimeRange } from '../../../shared/types'
import { formatClock, formatPrecise } from '../util/format'

export const PEAKS_PER_SECOND = 50
const MS_PER_PEAK = 1000 / PEAKS_PER_SECOND

export interface WaveView {
  startMs: number
  endMs: number
}

interface Props {
  peaks: Uint8Array | null
  durationMs: number
  getPosition: () => number
  selection: TimeRange | null
  removed: TimeRange[]
  markers: Marker[]
  view: WaveView
  onSeek: (ms: number) => void
  onSelect: (range: TimeRange | null) => void
  onViewChange: (view: WaveView) => void
  onTogglePlay: () => void
  label: string
  valueText: (ms: number) => string
}

function css(el: Element, name: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback
}

export function clampView(view: WaveView, durationMs: number): WaveView {
  const minSpan = 500
  let span = Math.max(minSpan, Math.min(durationMs || minSpan, view.endMs - view.startMs))
  if (durationMs > 0) span = Math.min(span, durationMs)
  let start = Math.max(0, view.startMs)
  if (durationMs > 0 && start + span > durationMs) start = Math.max(0, durationMs - span)
  return { startMs: start, endMs: start + span }
}

/**
 * Static waveform for preview and editing, drawn from real peaks (one byte per 1/50 s).
 * The waveform layer is cached and only the playhead is redrawn while playing.
 */
export function WaveformEditor(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const dirty = useRef(true)
  const drag = useRef<{ x: number; ms: number; selecting: boolean; anchor: number } | null>(null)

  useEffect(() => {
    dirty.current = true
  }, [props.peaks, props.durationMs, props.selection, props.removed, props.markers, props.view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (!layerRef.current) layerRef.current = document.createElement('canvas')
    const layer = layerRef.current
    let raf = 0
    let lastPos = -1
    let lastW = 0
    let lastH = 0
    let lastTheme = ''

    const renderLayer = (w: number, h: number, dpr: number): void => {
      const p = propsRef.current
      layer.width = Math.round(w * dpr)
      layer.height = Math.round(h * dpr)
      const g = layer.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const wave = css(canvas, '--wave', '#36454f')
      const dim = css(canvas, '--wave-dim', 'rgba(54,69,79,.3)')
      const grid = css(canvas, '--wave-grid', 'rgba(54,69,79,.08)')
      const faint = css(canvas, '--text-faint', '#7d8890')
      const selFill = css(canvas, '--accent-soft-2', 'rgba(54,69,79,.12)')
      const err = css(canvas, '--err', '#c93c3c')
      const ruler = 18
      const top = ruler
      const height = h - ruler
      const mid = top + height / 2
      const span = Math.max(1, p.view.endMs - p.view.startMs)
      const msToX = (ms: number): number => ((ms - p.view.startMs) / span) * w

      // Ruler
      g.fillStyle = faint
      g.font = '10px Inter Variable, Inter, sans-serif'
      g.textBaseline = 'top'
      const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000]
      const stepMs = steps.find((s) => (s / span) * w >= 80) ?? 3600000
      const first = Math.ceil(p.view.startMs / stepMs) * stepMs
      for (let t = first; t <= p.view.endMs; t += stepMs) {
        const x = Math.round(msToX(t))
        g.fillStyle = grid
        g.fillRect(x, top, 1, height)
        g.fillStyle = faint
        g.fillText(stepMs < 1000 ? formatPrecise(t) : formatClock(t), x + 3, 3)
      }
      g.fillStyle = grid
      g.fillRect(0, Math.round(mid), w, 1)

      // Selection
      if (p.selection) {
        const a = msToX(p.selection.startMs)
        const b = msToX(p.selection.endMs)
        g.fillStyle = selFill
        g.fillRect(a, top, b - a, height)
      }

      // Waveform columns
      const peaks = p.peaks
      const maxH = height / 2 - 4
      if (peaks && peaks.length > 0) {
        const msPerPx = span / w
        for (let x = 0; x < w; x++) {
          const t0 = p.view.startMs + x * msPerPx
          const t1 = t0 + msPerPx
          if (t0 > p.durationMs) break
          const i0 = Math.floor(t0 / MS_PER_PEAK)
          const i1 = Math.max(i0 + 1, Math.ceil(t1 / MS_PER_PEAK))
          let v = 0
          for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i]! > v) v = peaks[i]!
          const amp = Math.max(0.75, Math.pow(v / 255, 0.62) * maxH)
          const center = t0 + msPerPx / 2
          const isRemoved = p.removed.some((r) => center >= r.startMs && center < r.endMs)
          g.fillStyle = isRemoved ? dim : wave
          g.fillRect(x, mid - amp, 1, amp * 2)
        }
      }

      // Removed regions: tint plus hatch so the state is visible without relying on color.
      for (const r of p.removed) {
        const a = Math.max(0, msToX(r.startMs))
        const b = Math.min(w, msToX(r.endMs))
        if (b <= a) continue
        g.save()
        g.beginPath()
        g.rect(a, top, b - a, height)
        g.clip()
        g.fillStyle = 'rgba(128,128,128,0.10)'
        g.fillRect(a, top, b - a, height)
        g.strokeStyle = err
        g.globalAlpha = 0.35
        g.lineWidth = 1
        for (let x = a - height; x < b; x += 9) {
          g.beginPath()
          g.moveTo(x, top + height)
          g.lineTo(x + height, top)
          g.stroke()
        }
        g.restore()
        g.fillStyle = err
        g.fillRect(a, top, 1.5, height)
        g.fillRect(b - 1.5, top, 1.5, height)
      }

      // Markers
      for (const m of p.markers) {
        const x = Math.round(msToX(m.timeMs))
        if (x < -4 || x > w + 4) continue
        g.fillStyle = faint
        for (let y = top; y < top + height; y += 6) g.fillRect(x, y, 1, 3)
        g.fillStyle = wave
        g.beginPath()
        g.moveTo(x, top)
        g.lineTo(x + 8, top + 4)
        g.lineTo(x, top + 8)
        g.closePath()
        g.fill()
      }
    }

    const frame = (): void => {
      const p = propsRef.current
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      const theme = document.documentElement.dataset.theme ?? ''
      const sizeChanged = w !== lastW || h !== lastH
      if (sizeChanged) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        lastW = w
        lastH = h
      }
      const pos = p.getPosition()
      if (dirty.current || sizeChanged || theme !== lastTheme) {
        renderLayer(w, h, dpr)
        dirty.current = false
        lastTheme = theme
        lastPos = -1
      }
      if (pos !== lastPos) {
        lastPos = pos
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(layer, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const span = Math.max(1, p.view.endMs - p.view.startMs)
        const x = ((pos - p.view.startMs) / span) * w
        if (x >= -2 && x <= w + 2) {
          ctx.fillStyle = css(canvas, '--rec', '#c93c3c')
          ctx.fillRect(Math.round(x) - 1, 18, 2, h - 18)
          ctx.beginPath()
          ctx.arc(Math.round(x), 18, 4.5, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const xToMs = (clientX: number): number => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const p = propsRef.current
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.min(p.durationMs, Math.max(0, p.view.startMs + frac * (p.view.endMs - p.view.startMs)))
  }

  const onMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    canvasRef.current?.focus()
    const ms = xToMs(e.clientX)
    const p = propsRef.current
    const anchor = e.shiftKey ? (p.selection ? p.selection.startMs : p.getPosition()) : ms
    drag.current = { x: e.clientX, ms, selecting: e.shiftKey, anchor }
    if (e.shiftKey) p.onSelect({ startMs: Math.min(anchor, ms), endMs: Math.max(anchor, ms) })
    const move = (ev: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      if (!d.selecting && Math.abs(ev.clientX - d.x) > 3) d.selecting = true
      if (d.selecting) {
        const cur = xToMs(ev.clientX)
        propsRef.current.onSelect({ startMs: Math.min(d.anchor, cur), endMs: Math.max(d.anchor, cur) })
      }
    }
    const up = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const d = drag.current
      drag.current = null
      if (d && !d.selecting) {
        propsRef.current.onSelect(null)
        propsRef.current.onSeek(xToMs(ev.clientX))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const zoomAround = (factor: number, centerMs: number): void => {
    const p = propsRef.current
    const span = p.view.endMs - p.view.startMs
    const nextSpan = span * factor
    const ratio = (centerMs - p.view.startMs) / span
    p.onViewChange(clampView({ startMs: centerMs - ratio * nextSpan, endMs: centerMs - ratio * nextSpan + nextSpan }, p.durationMs))
  }

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    const p = propsRef.current
    if (e.ctrlKey || e.metaKey) {
      zoomAround(e.deltaY > 0 ? 1.25 : 0.8, xToMs(e.clientX))
    } else {
      const span = p.view.endMs - p.view.startMs
      if (span >= p.durationMs) return
      const delta = ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / 600) * span
      p.onViewChange(clampView({ startMs: p.view.startMs + delta, endMs: p.view.endMs + delta }, p.durationMs))
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const p = propsRef.current
    const pos = p.getPosition()
    const seek = (ms: number): void => {
      e.preventDefault()
      p.onSeek(Math.min(p.durationMs, Math.max(0, ms)))
    }
    switch (e.key) {
      case ' ':
        e.preventDefault()
        p.onTogglePlay()
        break
      case 'ArrowLeft':
        seek(pos - (e.shiftKey ? 5000 : 1000))
        break
      case 'ArrowRight':
        seek(pos + (e.shiftKey ? 5000 : 1000))
        break
      case 'PageUp':
        seek(pos - 10000)
        break
      case 'PageDown':
        seek(pos + 10000)
        break
      case 'Home':
        seek(0)
        break
      case 'End':
        seek(p.durationMs)
        break
      case '[': {
        e.preventDefault()
        const end = p.selection ? p.selection.endMs : p.durationMs
        if (pos < end) p.onSelect({ startMs: pos, endMs: end })
        break
      }
      case ']': {
        e.preventDefault()
        const start = p.selection ? p.selection.startMs : 0
        if (pos > start) p.onSelect({ startMs: start, endMs: pos })
        break
      }
      case 'Escape':
        if (p.selection) {
          e.preventDefault()
          e.stopPropagation()
          p.onSelect(null)
        }
        break
      case '+':
      case '=':
        e.preventDefault()
        zoomAround(0.8, pos)
        break
      case '-':
        e.preventDefault()
        zoomAround(1.25, pos)
        break
    }
  }

  const pos = props.getPosition()
  return (
    <canvas
      ref={canvasRef}
      className="wave-editor"
      tabIndex={0}
      role="slider"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={Math.round(props.durationMs / 1000)}
      aria-valuenow={Math.round(pos / 1000)}
      aria-valuetext={props.valueText(pos)}
      data-shortcut-scope="local"
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    />
  )
}

/** Compact waveform thumbnail for archive rows, from stored peaks. */
export function MiniWave({ peaks, bars = 48 }: { peaks: Uint8Array | null; bars?: number }) {
  if (!peaks || peaks.length === 0) return <span className="mini-wave empty" aria-hidden="true" />
  const step = peaks.length / bars
  let d = ''
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(i * step)
    const b = Math.max(a + 1, Math.floor((i + 1) * step))
    let v = 0
    for (let j = a; j < b && j < peaks.length; j++) if (peaks[j]! > v) v = peaks[j]!
    const h = Math.max(0.6, Math.pow(v / 255, 0.62) * 9)
    const x = i * 2 + 1
    d += `M${x} ${10 - h}V${10 + h}`
  }
  return (
    <svg className="mini-wave" viewBox={`0 0 ${bars * 2} 20`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  )
}
