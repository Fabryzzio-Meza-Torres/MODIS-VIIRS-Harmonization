export interface RiskRow {
  region_id: string; region_name: string; issued_at: string
  target_week_start: string; target_week_end_exclusive: string; lead_weeks: number
  probability: number | null; probability_percent: number | null
  estimation_status: 'estimated' | 'unavailable'; quality_status: string
  unavailable_reasons: string[]; features_outside_region_training_range: string[]
  target_period_status?: string // not in the current contract; used only if the service starts sending it
}

/** One decimal, never more precision than the model deserves. Returns null when there is no number. */
export function percent1(p: number | null | undefined): string | null {
  if (p == null || !Number.isFinite(p)) return null
  return `${p.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

export type Validity = { ok: true } | { ok: false; reason: 'refresh_required' | 'expired' | 'invalid_valid_until' }
/** The snapshot is usable only while it is inside valid_until and the service does not ask for a refresh. */
export function validity(meta: { valid_until?: string; refresh_required?: boolean }, now = Date.now()): Validity {
  if (meta.refresh_required) return { ok: false, reason: 'refresh_required' }
  const until = Date.parse(meta.valid_until ?? '')
  if (!Number.isFinite(until)) return { ok: false, reason: 'invalid_valid_until' }
  return now > until ? { ok: false, reason: 'expired' } : { ok: true }
}

export type Outcome = { available: true; percent: number } | { available: false; reasons: string[] }
/** Unavailable unless the service says "estimated" AND sends a number. Never converts to 0. */
export function outcome(row: RiskRow | undefined): Outcome {
  if (!row) return { available: false, reasons: [] }
  if (row.estimation_status !== 'estimated' || row.probability_percent == null) return { available: false, reasons: row.unavailable_reasons ?? [] }
  return { available: true, percent: row.probability_percent }
}

const lima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' })
export type Period = 'futura' | 'en_curso' | 'pasada'
/** Derived from dates only (America/Lima). The service does not send target_period_status today. */
export function periodStatus(weekStart: string, weekEndExclusive: string, now = Date.now()): Period {
  const today = lima.format(new Date(now))
  return today < weekStart ? 'futura' : today < weekEndExclusive ? 'en_curso' : 'pasada'
}

export class ApiError extends Error {
  status: number
  code: string | null
  constructor(status: number, code: string | null, message: string) { super(message); this.status = status; this.code = code }
}
