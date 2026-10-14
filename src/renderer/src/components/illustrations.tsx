/* Small hand-drawn style illustrations for empty states. They use theme colors only. */

export function EmptyArchiveArt() {
  return (
    <svg className="illustration" viewBox="0 0 160 110" aria-hidden="true">
      <rect x="18" y="26" width="124" height="70" rx="16" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <rect x="30" y="16" width="100" height="14" rx="7" fill="var(--surface-3)" />
      <g stroke="var(--text-faint)" strokeLinecap="round" strokeWidth="4">
        <line x1="46" y1="56" x2="46" y2="66" />
        <line x1="56" y1="48" x2="56" y2="74" />
        <line x1="66" y1="54" x2="66" y2="68" />
        <line x1="76" y1="44" x2="76" y2="78" />
        <line x1="86" y1="52" x2="86" y2="70" />
        <line x1="96" y1="58" x2="96" y2="64" />
        <line x1="106" y1="50" x2="106" y2="72" />
        <line x1="116" y1="56" x2="116" y2="66" />
      </g>
      <circle cx="132" cy="90" r="13" fill="var(--surface)" stroke="var(--border-strong)" />
      <path d="M127 90h10M132 85v10" stroke="var(--text-muted)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyTrashArt() {
  return (
    <svg className="illustration" viewBox="0 0 160 110" aria-hidden="true">
      <ellipse cx="80" cy="100" rx="44" ry="5" fill="var(--surface-3)" />
      <path d="M50 34h60l-6 60a8 8 0 0 1-8 7H64a8 8 0 0 1-8-7z" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <rect x="44" y="24" width="72" height="10" rx="5" fill="var(--surface-3)" />
      <path d="M68 24v-5a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v5" fill="none" stroke="var(--border-strong)" />
      <path d="M70 58l7 7 13-14" fill="none" stroke="var(--ok)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function EmptyFavoritesArt() {
  return (
    <svg className="illustration" viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="80" cy="56" r="40" fill="var(--surface-2)" stroke="var(--border-strong)" />
      <path
        d="M80 36l6.2 12.6 13.9 2-10 9.8 2.4 13.8L80 67.7l-12.5 6.5 2.4-13.8-10-9.8 13.9-2z"
        fill="var(--surface)"
        stroke="var(--text-muted)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="122" cy="26" r="4" fill="var(--text-faint)" />
      <circle cx="36" cy="88" r="3" fill="var(--text-faint)" />
    </svg>
  )
}

export function EmptySearchArt() {
  return (
    <svg className="illustration" viewBox="0 0 160 110" aria-hidden="true">
      <circle cx="70" cy="50" r="28" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M90 70l22 22" stroke="var(--text-muted)" strokeWidth="7" strokeLinecap="round" />
      <path d="M58 50h24" stroke="var(--text-faint)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  )
}
