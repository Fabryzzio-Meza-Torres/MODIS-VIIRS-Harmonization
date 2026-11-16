import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { collectPages } from './lib/paging'
import type { Range } from './lib/provinceStats'

/** Same-origin proxy (netlify/functions/events.mts); the events API itself sends no CORS headers. */
export const EVENTS_BASE = '/api/events'
// Country bbox as echoed by the events API in `query.bbox` when only a department is sent.
export const PERU_BBOX = '-81.5,-18.5,-68.5,0.1'
export const PAGE_SIZE = 200
const EVENT_TYPES: Record<string, [string, string]> = {
  foco_aislado: ['Foco aislado', 'Isolated hotspot'], incendio: ['Incendio', 'Fire'], incendio_prolongado: ['Incendio prolongado', 'Prolonged fire'],
  quema_persistente: ['Quema persistente', 'Persistent burning'], foco_recurrente: ['Foco recurrente', 'Recurrent hotspot'],
}
/** Label for an event_type code; unknown codes are shown as sent by the service. */
export const eventTypeLabel = (code: string) => { const e = EVENT_TYPES[code]; return e ? t(e[0], e[1]) : code }
export const EVENT_TYPE_CODES = Object.keys(EVENT_TYPES)

export interface EventRow {
  event_id: number; t_start: string; t_end: string; duration_days: number
  lat: number; lon: number; lat_min: number; lat_max: number; lon_min: number; lon_max: number
  n_det: number; n_modis: number; n_viirs: number; passes_modis: number; passes_viirs: number
  frp_total: number; frp_max: number; satellites: string; department: string
  spread_km: number; may_split: boolean; may_merge: boolean; confidence: string; event_type: string
  active_days: number; foci_per_day: number
}
export interface Detection {
  det_id: number; t_utc: string; lat: number; lon: number; instrument: 'MODIS' | 'VIIRS'; satellite: string
  frp: number | null; confidence: string; daynight: string
}
export interface EventsMeta { built_at: string; n_events: string; n_detections: string; t_min: string; t_max: string; processing: string }
export interface EventQuery { start: string; end: string; department: string | null; bbox: string | null; eventType: string; minConfidence: string }

async function get<T>(path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(EVENTS_BASE + path, location.origin)
  for (const [k, v] of Object.entries(params)) if (v !== '') url.searchParams.set(k, String(v))
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!r.ok) {
    let detail = ''
    try { const b = await r.json(); detail = typeof b.detail === 'string' ? b.detail : b.error ?? '' } catch { /* not JSON */ }
    throw new Error(`${t('La API de eventos respondió', 'The events API responded')} ${r.status}${detail ? `: ${detail}` : ''}`)
  }
  return r.json()
}

export const fetchEventsMeta = (signal?: AbortSignal) => get<EventsMeta>('/meta', {}, signal)
export const fetchDepartments = (signal?: AbortSignal) => get<{ departments: string[] }>('/departments', {}, signal).then((d) => d.departments)
export const fetchEvent = (id: number, signal?: AbortSignal) => get<EventRow>(`/events/${id}`, {}, signal)
export const fetchDetections = (id: number, signal?: AbortSignal) => get<{ event_id: number; count: number; detections: Detection[] }>(`/events/${id}/detections`, {}, signal)

function page(q: EventQuery, offset: number, signal: AbortSignal) {
  return get<{ total: number; count: number; offset: number; events: EventRow[] }>('/events', {
    start: q.start, end: q.end, limit: PAGE_SIZE, offset,
    ...(q.bbox ? { bbox: q.bbox } : q.department ? { department: q.department } : { bbox: PERU_BBOX }),
    event_type: q.eventType, min_confidence: q.minConfidence,
  }, signal)
}

/** Only the `total` of a query (limit=1): enough for a count without downloading events. */
export const fetchEventsTotal = (q: { start: string; end: string; department: string | null }, signal?: AbortSignal) =>
  get<{ total: number }>('/events', { start: q.start, end: q.end, limit: 1, ...(q.department ? { department: q.department } : { bbox: PERU_BBOX }) }, signal).then((r) => r.total)

/** Server-side pagination; changing the query aborts the previous request and discards its result. */
export function useEventPages(q: EventQuery | null) {
  const [s, set] = useState<{ items: EventRow[]; total: number | null; loading: boolean; error?: Error }>({ items: [], total: null, loading: false })
  const ctl = useRef<AbortController | null>(null)
  const key = q ? JSON.stringify(q) : ''
  const run = useCallback((reset: boolean, from: number) => {
    if (!q) return
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    set((p) => ({ items: reset ? [] : p.items, total: reset ? null : p.total, loading: true }))
    page(q, from, c.signal).then(
      (r) => { if (!c.signal.aborted) set((p) => ({ items: reset ? r.events : [...p.items, ...r.events], total: r.total, loading: false })) },
      (error) => { if (!c.signal.aborted) set((p) => ({ ...p, loading: false, error })) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => { run(true, 0); return () => ctl.current?.abort() }, [run])
  return { ...s, loadMore: () => run(false, s.items.length), retry: () => run(true, 0) }
}

export interface DeptEvents {
  key: string // identifies the query these events belong to (never show events of another query)
  events: EventRow[]; total: number | null; loaded: number
  complete: boolean; loading: boolean; error?: Error
}
const EMPTY_EVENTS: DeptEvents = { key: '', events: [], total: null, loaded: 0, complete: false, loading: false }

/**
 * Every event overlapping `range` inside `bbox` (a department's province envelope), downloaded page by page
 * (1 000 per request, 4 in parallel, at most 20 pages). Cancels the previous download when the query changes.
 */
export function useDepartmentEvents(bbox: string | null, range: Range | null): DeptEvents {
  const key = bbox && range ? `${bbox}|${range.start}|${range.end}` : ''
  const [s, set] = useState<DeptEvents>(EMPTY_EVENTS)
  useEffect(() => {
    if (!key || !bbox || !range) { set(EMPTY_EVENTS); return }
    const ctl = new AbortController()
    set({ ...EMPTY_EVENTS, key, loading: true })
    collectPages<EventRow>(
      (offset, limit) => get<{ total: number; events: EventRow[] }>('/events', { start: range.start, end: range.end, bbox, limit, offset }, ctl.signal),
      { signal: ctl.signal, onProgress: (loaded, total) => set((p) => (p.key === key ? { ...p, loaded, total } : p)) },
    ).then(
      (r) => { if (!ctl.signal.aborted) set({ key, events: r.events, total: r.total, loaded: r.events.length, complete: r.complete, loading: false }) },
      (error) => { if (!ctl.signal.aborted) set({ ...EMPTY_EVENTS, key, loading: false, error }) },
    )
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return s.key === key ? s : { ...EMPTY_EVENTS, key, loading: !!key } // while the key changes, the old events are not shown
}
