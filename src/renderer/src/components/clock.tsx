import { memo } from 'react'
import { formatClock } from '../util/format'

/**
 * Recording clock in the serif display face. Instrument Serif has proportional figures, so each
 * digit sits in a fixed-width cell and the clock never shifts while it counts.
 */
export const SerifClock = memo(function SerifClock({ ms, className = '' }: { ms: number; className?: string }) {
  const text = formatClock(ms, true)
  return (
    <span className={`serif-clock ${className}`} role="timer" aria-label={text}>
      {Array.from(text, (ch, i) => (
        <span key={i} className={ch === ':' ? 'sc-sep' : 'sc-digit'} aria-hidden="true">
          {ch}
        </span>
      ))}
    </span>
  )
})
