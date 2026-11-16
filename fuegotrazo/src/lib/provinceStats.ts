import type { Province } from './geo.ts'

export interface EventLike {
  event_id: number; t_start: string; n_det: number; n_modis: number; n_viirs: number
  frp_total: number; frp_max: number; event_type: string; lon: number; lat: number
}
/** Inclusive UTC dates, as the events API documents them. */
export interface Range { start: string; end: string }

export type BucketKind = 'day' | 'month'
export interface Summary {
  events: number; modis: number; viirs: number; frpTotal: number; frpMax: number | null
  byType: Record<string, number>
  beforePeriod: number // events that started before the period but overlap it (the API returns overlaps)
  bucketKind: BucketKind
  buckets: { key: string; n: number }[] // by UTC date of event start; empty buckets are real zeros
}

const MS = 864e5
const day = (iso: string) => Date.parse(iso + 'T00:00:00Z')
export const spanDays = (r: Range) => (day(r.end) - day(r.start)) / MS + 1
export const bucketKind = (r: Range): BucketKind => (spanDays(r) <= 62 ? 'day' : 'month')

function keys(r: Range, kind: BucketKind): string[] {
  const out: string[] = []
  if (kind === 'day') {
    for (let t = day(r.start); t <= day(r.end); t += MS) out.push(new Date(t).toISOString().slice(0, 10))
  } else {
    let y = +r.start.slice(0, 4), m = +r.start.slice(5, 7)
    const ey = +r.end.slice(0, 4), em = +r.end.slice(5, 7)
    while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++ } }
  }
  return out
}

/**
 * Plain sums (no averages of averages). Invariant (tested): Σ buckets + beforePeriod = events.
 * An event is bucketed by the UTC date its first detection occurred.
 */
export function summarize(events: EventLike[], range: Range): Summary {
  const kind = bucketKind(range)
  const buckets = new Map(keys(range, kind).map((k) => [k, 0]))
  const byType: Record<string, number> = {}
  let modis = 0, viirs = 0, frpTotal = 0, frpMax: number | null = null, before = 0
  for (const e of events) {
    modis += e.n_modis; viirs += e.n_viirs; frpTotal += e.frp_total
    frpMax = frpMax == null ? e.frp_max : Math.max(frpMax, e.frp_max)
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1
    const date = e.t_start.slice(0, 10)
    if (date < range.start) before++
    else { const k = kind === 'day' ? date : date.slice(0, 7); buckets.set(k, (buckets.get(k) ?? 0) + 1) }
  }
  return { events: events.length, modis, viirs, frpTotal, frpMax, byType, beforePeriod: before, bucketKind: kind, buckets: [...buckets].map(([key, n]) => ({ key, n })) }
}

/** Events per 1 000 km² of the province polygon (same geometry that assigns the events). */
export const per1000km2 = (count: number, areaKm2: number): number | null => (areaKm2 > 0 ? count / (areaKm2 / 1000) : null)

export interface Row { id: string; name: string; events: number; areaKm2: number; per1000: number | null; share: number }
/** Ranking of the provinces of one department; `share` is of the events assigned to those provinces. */
export function rankProvinces(byProvince: Map<string, EventLike[]>, provinces: Province[]): Row[] {
  const assigned = [...byProvince.values()].reduce((t, v) => t + v.length, 0)
  return provinces
    .map((p) => { const n = byProvince.get(p.id)?.length ?? 0; return { id: p.id, name: p.name, events: n, areaKm2: p.areaKm2, per1000: per1000km2(n, p.areaKm2), share: assigned ? n / assigned : 0 } })
    .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, 'es'))
}
