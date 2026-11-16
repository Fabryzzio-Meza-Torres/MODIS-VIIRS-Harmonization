import { Component, type ReactNode } from 'react'
import type { Period } from './lib/aggregate'
import type { Indicator } from './state'

export const COLORS = { MODIS: '#FB923C', VIIRS: '#67D8F2', combined: '#FBBF24', raw: '#94A8BD', teal: '#14B8A6', grid: '#21405E', muted: '#94A8BD' }
export const INDICATOR_LABEL: Record<Indicator, string> = {
  combined: 'Datos armonizados (promedio MODIS y VIIRS)', MODIS: 'MODIS armonizado', VIIRS: 'VIIRS armonizado',
}
export const shiftDay = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}
/** "16 nov – 22 nov 2026" for a Monday-start week with exclusive end. */
export const weekLabel = (start: string, endExclusive: string) => `${fmt.short(start)} – ${fmt.date(shiftDay(endExclusive, -1))}`
export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
export const MONTHS_LONG = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export const monthLabel = (key: string) => `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`

const nf = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 })
const cf = new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 })
const pf = new Intl.NumberFormat('es-PE', { style: 'percent', maximumFractionDigits: 1 })
const df = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dl = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' })
const dutc = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
const dshort = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export const fmt = {
  n: (v: number | null | undefined) => (v == null ? '—' : Math.abs(v) >= 10000 ? cf.format(v) : nf.format(v)),
  full: (v: number | null | undefined) => (v == null ? '—' : nf.format(v)),
  d2: (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('es-PE', { maximumFractionDigits: 3 })),
  pct: (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : pf.format(v)),
  date: (iso: string) => df.format(new Date(iso + 'T00:00:00Z')),
  short: (iso: string) => dshort.format(new Date(iso + 'T00:00:00Z')),
  lima: (iso: string) => `${dl.format(new Date(iso))} (hora de Lima)`,
  utc: (iso: string) => `${dutc.format(new Date(iso))} UTC`,
}

export const pick = (p: Period, ind: Indicator): number | null => p[ind]

export function downloadCSV(name: string, rows: Record<string, unknown>[], header?: string) {
  const keys = Object.keys(rows[0] ?? {})
  const body = [keys.join(','), ...rows.map((r) => keys.map((k) => r[k] ?? '').join(','))].join('\n')
  const blob = new Blob([(header ? header + '\n' : '') + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export const tooltipStyle = {
  contentStyle: { background: '#10243B', border: '1px solid #21405E', borderRadius: 8, fontSize: 12, color: '#F4F7FB' },
  labelStyle: { color: '#94A8BD' }, itemStyle: { color: '#F4F7FB' },
}
export const axis = { stroke: '#94A8BD', fontSize: 11, tickLine: false, axisLine: { stroke: '#21405E' } } as const

export function Card({ title, subtitle, actions, children, className = '' }: {
  title?: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[1.0625rem] font-semibold text-balance">{title}</h2>}
            {subtitle && <p className="mt-1 max-w-[70ch] text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-xl font-medium">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">{subtitle}</p>
    </div>
  )
}

const field = 'max-w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
export function Select<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]
}) {
  return (
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-muted">
      {label}
      <select className={field} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
export function YearInput({ label, value, onChange, min = 2001, max = 2026 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input type="number" className={`${field} w-24 font-mono`} value={value} min={min} max={max}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (n >= min && n <= max) onChange(n) }} />
    </label>
  )
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </li>
      ))}
    </ul>
  )
}

export function Unavailable({ children, reasons }: { children: ReactNode; reasons?: string[] }) {
  return (
    <div role="status" className="rounded-lg border border-amber/60 bg-amber/10 p-4 text-sm">
      <h3 className="font-semibold text-amber">Pronóstico no disponible</h3>
      <div className="mt-1 max-w-[70ch] text-ink/90">{children}</div>
      {!!reasons?.length && <p className="mt-2 text-xs text-muted">Motivos informados por el servicio: <span className="font-mono">{reasons.join(', ')}</span></p>}
      <p className="mt-2 text-xs text-muted">No se muestra ningún porcentaje: la ausencia de pronóstico no equivale a 0 %.</p>
    </div>
  )
}

/** Quiet skeleton: no wording on screen (the label is for screen readers only). */
export const Loading = ({ label = 'Cargando' }: { label?: string }) => (
  <div role="status" aria-busy="true" className="space-y-3 py-1">
    <span className="sr-only">{label}</span>
    <div className="h-20 animate-pulse rounded-lg bg-surface/60" />
    <div className="h-20 animate-pulse rounded-lg bg-surface/40" />
  </div>
)
export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line px-4 text-center text-sm text-muted">{children}</div>
)
export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-sm">
      <p>{error.message || 'No pudimos consultar los datos.'} Comprueba tu conexión y vuelve a intentarlo.</p>
      {retry && <button onClick={retry} className="mt-2 rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">Reintentar</button>}
    </div>
  )
}

export class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    return this.state.error
      ? <Card title="Este módulo no pudo mostrarse"><ErrorBox error={this.state.error} /></Card>
      : this.props.children
  }
}

export const RAMP = ['#2A4F73', '#8A7A3F', '#FBBF24', '#FB923C', '#F97316', '#EF4444']
export const NO_DATA = '#21405E'
/** Quantile ramp over the positive values; breaks[i] is the lower edge of RAMP[i]. */
export function makeRamp(values: (number | null | undefined)[]) {
  const v = values.filter((x): x is number => x != null && x > 0).sort((a, b) => a - b)
  const breaks = RAMP.map((_, i) => (v.length ? v[Math.min(v.length - 1, Math.floor((i / RAMP.length) * v.length))] : 0))
  const color = (x: number | null | undefined) => {
    if (x == null) return NO_DATA
    let k = 0
    for (let i = 0; i < breaks.length; i++) if (x >= breaks[i]) k = i
    return RAMP[k]
  }
  return { color, breaks }
}
