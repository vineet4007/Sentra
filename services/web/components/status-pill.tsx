type StatusPillProps = {
  label: string
  tone?: 'neutral' | 'good' | 'warn' | 'critical' | 'accent'
}

export function StatusPill({ label, tone = 'neutral' }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      <span className="status-pill__dot" />
      {label}
    </span>
  )
}
