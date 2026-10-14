import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, ReactNode, SelectHTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck, ICON_STROKE, Info, TriangleAlert, X } from './icons'
import type { LucideIcon } from './icons'
import { useT } from '../i18n'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

export function Button({
  variant = 'secondary',
  size,
  icon: Icon,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'lg'; icon?: LucideIcon; block?: boolean }) {
  const cls = ['btn', variant !== 'secondary' ? `btn-${variant}` : '', size ? `btn-${size}` : '', block ? 'btn-block' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 15 : 17} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  small,
  className = '',
  size,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; small?: boolean; size?: number }) {
  return (
    <button type="button" className={`icon-btn ${small ? 'sm' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={size ?? (small ? 15 : 18)} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

export interface SegmentOption<T extends string | number> {
  value: T
  label: string
  icon?: LucideIcon
  disabled?: boolean
}

/** Radio group rendered as a segmented control; arrow keys move the selection. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (v: T) => void
  label: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const enabled = options.filter((o) => !o.disabled)
  const move = (dir: 1 | -1): void => {
    const idx = enabled.findIndex((o) => o.value === value)
    const next = enabled[(idx + dir + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.value)
    refs.current[options.indexOf(next)]?.focus()
  }
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const Icon = o.icon
        const checked = o.value === value
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            className="segmented-item"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(-1)
              }
            }}
          >
            {Icon && <Icon size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueText,
  disabled
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  label: string
  valueText?: string
  disabled?: boolean
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText}
      style={{ '--fill': fill } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function Select({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <select className="select" aria-label={label} {...rest}>
      {children}
    </select>
  )
}

export function Field({
  label,
  description,
  children,
  stacked,
  htmlFor
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  stacked?: boolean
  htmlFor?: string
}) {
  return (
    <div className={`field ${stacked ? 'stacked' : ''}`}>
      <div style={{ minWidth: 0 }}>
        {htmlFor ? (
          <label className="field-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <div className="field-label">{label}</div>
        )}
        {description && <div className="field-desc">{description}</div>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  )
}

export function Notice({
  kind = 'info',
  title,
  children,
  action
}: {
  kind?: 'info' | 'warning' | 'error' | 'success'
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  const Icon = kind === 'error' ? CircleAlert : kind === 'warning' ? TriangleAlert : kind === 'success' ? CircleCheck : Info
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />
      <div className="notice-body">
        {title && <div className="notice-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="keycaps">
      {keys.map((k, i) => (
        <kbd key={`${k}-${i}`} className="keycap">
          {k}
        </kbd>
      ))}
    </span>
  )
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Accessible modal: focus trap, Escape to close, focus restored on close. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  dismissable = true
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  dismissable?: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const auto = el.querySelector<HTMLElement>('[data-autofocus]')
      ;(auto ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus()
    }, 30)
    return () => {
      window.clearTimeout(timer)
      previous?.focus?.()
    }
  }, [open])

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && dismissable) onClose()
          }}
        >
          <motion.div
            ref={ref}
            className={`modal ${wide ? 'wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="modal-header">
              <h2 id={titleId}>{title}</h2>
              {dismissable && <IconButton icon={X} label={t('common.close')} small onClick={onClose} />}
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The Sonora mark: an S whose spine is a sound wave. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <rect x="64" y="64" width="896" height="896" rx="228" fill="#36454F" />
      <g fill="none" stroke="#F8F8FF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="84">
        <path d="M690 336C652 278 590 250 512 250C414 250 340 302 340 372C340 410 348 440 363 460" />
        <path d="M334 688C372 746 434 774 512 774C610 774 684 722 684 652C684 614 676 584 661 564" />
      </g>
      <g stroke="#F8F8FF" strokeLinecap="round" strokeWidth="34">
        <line x1="436" y1="446" x2="436" y2="526" />
        <line x1="474" y1="419" x2="474" y2="579" />
        <line x1="512" y1="392" x2="512" y2="632" />
        <line x1="550" y1="445" x2="550" y2="605" />
        <line x1="588" y1="498" x2="588" y2="578" />
      </g>
    </svg>
  )
}
