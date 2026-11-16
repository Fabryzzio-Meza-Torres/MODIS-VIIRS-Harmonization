export interface RiskRow {
  region_id: string; region_name: string; issued_at: string
  target_week_start: string; target_week_end_exclusive: string; lead_weeks: number
  probability: number | null; probability_percent: number | null
  estimation_status: 'estimated' | 'unavailable'; quality_status: string
  unavailable_reasons: string[]; features_outside_region_training_range: string[]
  target_period_status?: string // not in the current contract; used only if the service starts sending it
}

export interface HistoricalReference {
  frequency_percent: number | null; positive_weeks: number; total_weeks: number; years: number[]
  seasonal_half_window_days: number; source: string; coverage_corrected: boolean
}
export interface ActivityRow extends RiskRow {
  historical_reference: HistoricalReference
  difference_from_historical_frequency_pp: number | null
}
export const ACTIVITY_EVENT = 'at_least_one_eligible_fire_detection_recorded'
export function activityContract(meta: { target_event?: string; supported_spatial_units?: string[]; physical_ignition_probability_verified?: boolean }): boolean {
  return meta.target_event === ACTIVITY_EVENT && meta.supported_spatial_units?.length === 1 &&
    meta.supported_spatial_units[0] === 'department' && meta.physical_ignition_probability_verified === false
}
export function difference1(value: number | null | undefined, locale = 'es-PE'): string {
  if (value == null || !Number.isFinite(value)) return locale.startsWith('es') ? 'No disponible' : 'Unavailable'
  const rounded = Math.round(value * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`
}

/** One decimal, never more precision than the model deserves. Returns null when there is no number. */
export function percent1(p: number | null | undefined, locale = 'es-PE'): string | null {
  if (p == null || !Number.isFinite(p)) return null
  return `${p.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
}

export type Validity = { ok: true } | { ok: false; reason: 'refresh_required' | 'expired' | 'invalid_valid_until' }
/** The snapshot is usable only while it is inside valid_until and the service does not ask for a refresh. */
export function validity(meta: { valid_until?: string; refresh_required?: boolean }, now = Date.now()): Validity {
  if (meta.refresh_required) return { ok: false, reason: 'refresh_required' }
  const until = Date.parse(meta.valid_until ?? '')
  if (!Number.isFinite(until)) return { ok: false, reason: 'invalid_valid_until' }
  return now >= until ? { ok: false, reason: 'expired' } : { ok: true }
}

export type Outcome = { available: true; percent: number } | { available: false; reasons: string[] }
/** Unavailable unless the service says "estimated" AND sends a number. Never converts to 0. */
export function outcome(row: RiskRow | undefined): Outcome {
  if (!row) return { available: false, reasons: [] }
  if (row.estimation_status !== 'estimated' || row.probability_percent == null) return { available: false, reasons: row.unavailable_reasons ?? [] }
  if (!Number.isFinite(row.probability_percent) || row.probability_percent < 0 || row.probability_percent > 100 ||
      row.probability == null || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1 ||
      Math.abs(row.probability * 100 - row.probability_percent) > 1e-6) {
    return { available: false, reasons: ['invalid_probability_contract'] }
  }
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
