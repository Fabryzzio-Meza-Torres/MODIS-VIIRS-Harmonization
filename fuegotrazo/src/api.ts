import type { WeekRow } from './lib/aggregate.ts'
import { ApiError, activityContract, type ActivityRow } from './lib/forecast.ts'

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'https://modis-viirs-harmonization-production.up.railway.app'
export const SERIES_START = '2000-11-06'
export const SERIES_END_EXCL = '2026-07-27'

export interface Region { region_id: string; name: string; bbox: [number, number, number, number] }
type Page<T> = { metadata: any; data: T[]; pagination: { next_offset: number | null } }

const cache = new Map<string, Promise<any>>()
export function getJSON<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(path, API_BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const key = url.toString()
  if (!cache.has(key)) {
    const p = fetch(key, { headers: { Accept: 'application/json' } }).then(async (r) => {
      if (!r.ok) throw new Error(`La API respondió ${r.status} en ${path}`)
      return r.json()
    })
    p.catch(() => cache.delete(key)) // allow retry after a failure
    cache.set(key, p)
  }
  return cache.get(key)!
}

export async function getAllPages<T>(path: string, params: Record<string, string | number>) {
  const rows: T[] = []
  let offset: number | null = 0, metadata: any = null
  while (offset !== null) {
    const page: Page<T> = await getJSON(path, { ...params, limit: 1000, offset })
    metadata = page.metadata; rows.push(...page.data); offset = page.pagination.next_offset
  }
  return { rows, metadata }
}

export const fetchRegions = () => getJSON<{ data: Region[] }>('/v1/regions').then((r) => r.data)
export const fetchGeometry = () => getJSON<GeoJSON.FeatureCollection>('/v1/regions/geometry')
export const fetchMetadata = () => getJSON<{ series: any; forecast: any }>('/v1/empirical/metadata')
export const fetchValidation = () => getJSON<any>('/v1/validation')
export const fetchSeries = (regionId: string | null, start: string, endExcl: string) =>
  getAllPages<WeekRow>('/v1/empirical/series', {
    start, end: endExcl, week_selection: 'overlap', ...(regionId ? { region_id: regionId } : {}),
  })

/** Fire-risk endpoints: never cached, abortable, errors keep the service's own code (detail.code). */
async function riskGet<T>(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, API_BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal, cache: 'no-store' })
  if (!r.ok) {
    let code: string | null = null
    try { const b = await r.json(); code = b?.detail?.code ?? (typeof b?.detail === 'string' ? b.detail : null) } catch { /* body is not JSON */ }
    throw new ApiError(r.status, code, `La API respondió ${r.status}${code ? ` (${code})` : ''}`)
  }
  return r.json()
}

export interface ActivityMeta {
  method_version: string; snapshot_id: string; issued_at: string; valid_until: string; refresh_required: boolean
  status: string; available_target_weeks: string[]; lead_weeks: number[]; selected_model: string
  target_event: string; target_definition: string; supported_spatial_units: string[]
  physical_ignition_probability_verified: boolean; cumulative_twelve_week_risk: boolean
  province_probability_available: boolean; individual_uncertainty_intervals_available: boolean
  automatic_refresh_configured: boolean; NRT_last_acquisition_utc: string; weather_value_days_used: string[]
  NRT_SP_transfer_validated: boolean; NRT_type0_assumed: boolean; prospective_validation_complete: boolean
  evaluation_status: string; evaluation: { period: string; model: string; brier: number; rows: number; positive_frequency: number }[]
  calibration: { method: string; pooled_2024_2025_brier: { raw: number; calibrated: number }; observed_pooled_brier_improved: boolean }
  ui: { title_es: string; label_es: string; explanation_es: string; limits_es: string; scope_notice_es: string }
  scientific_sources: { title: string; url: string }[]
}
function checkedActivityMeta(meta: ActivityMeta): ActivityMeta {
  if (!activityContract(meta)) throw new ApiError(502, 'activity_contract_mismatch', 'El servicio no confirma el indicador ni la escala esperados.')
  return meta
}
export const fetchActivityMetadata = async (signal?: AbortSignal) =>
  checkedActivityMeta(await riskGet<ActivityMeta>('/v1/fire-activity/metadata', {}, signal))
export const fetchActivity = async (regionId: string, week: string, signal?: AbortSignal) => {
  const result = await riskGet<{ metadata: ActivityMeta; data: ActivityRow[] }>('/v1/fire-activity',
    { region_id: regionId, target_week_start: week }, signal)
  checkedActivityMeta(result.metadata)
  if (result.data.some((r) => r.region_id !== regionId || r.target_week_start !== week)) {
    throw new ApiError(502, 'activity_scope_mismatch', 'La respuesta no corresponde al departamento y la semana elegidos.')
  }
  return result
}
export const fetchActivityOutlook = async (regionId: string | null, signal?: AbortSignal) => {
  const result = await riskGet<{ metadata: ActivityMeta; data: ActivityRow[]; pagination: { next_offset: number | null } }>(
    '/v1/fire-activity/outlook', { ...(regionId ? { region_id: regionId } : {}), limit: 300 }, signal)
  checkedActivityMeta(result.metadata)
  if (regionId && result.data.some((r) => r.region_id !== regionId)) {
    throw new ApiError(502, 'activity_scope_mismatch', 'La respuesta pertenece a otro departamento.')
  }
  return result
}
