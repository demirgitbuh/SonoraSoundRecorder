import { memo } from 'react'
import type { CSSProperties } from 'react'

/** Bar heights of the decorative wave, shaped like a spoken phrase (not random). */
const SHAPE = [0.18, 0.3, 0.46, 0.38, 0.6, 0.82, 0.64, 0.9, 1, 0.74, 0.52, 0.66, 0.88, 0.7, 0.44, 0.58, 0.8, 0.62, 0.4, 0.28, 0.5, 0.72, 0.56, 0.34, 0.24, 0.42, 0.3, 0.2]

/**
 * Decorative, CSS-animated sound wave used in onboarding and the update dialog. It is purely
 * ornamental (hidden from assistive technology) and stops with reduced motion.
 */
export const WaveArt = memo(function WaveArt({ bars = SHAPE.length, progress, className = '' }: { bars?: number; progress?: number; className?: string }) {
  const lit = progress === undefined ? bars : Math.round((Math.max(0, Math.min(100, progress)) / 100) * bars)
  return (
    <div className={`wave-art ${progress !== undefined ? 'has-progress' : ''} ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className={i < lit ? 'on' : ''}
          style={{ '--h': SHAPE[i % SHAPE.length], '--d': `${(i * 73) % 900}ms` } as CSSProperties}
        />
      ))}
    </div>
  )
})
