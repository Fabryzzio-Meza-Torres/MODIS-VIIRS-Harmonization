/** Allow-list for the read-only proxy to the events API. Pure: no I/O. */
export const EVENTS_UPSTREAM = 'https://peru-fire-events-api-production.up.railway.app'
export const EVENT_TYPES = ['foco_aislado', 'incendio', 'incendio_prolongado', 'quema_persistente', 'foco_recurrente'] as const
export const MAX_RANGE_DAYS = 366
export const MAX_LIMIT = 1000

export type Built = { path: string; query: string; cache: 'none' | 'short' } | { error: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const INT = /^\d+$/
const day = (s: string) => (DATE.test(s) ? Date.parse(s + 'T00:00:00Z') : NaN)
const PARAMS = new Set(['start', 'end', 'department', 'bbox', 'min_confidence', 'min_det', 'event_type', 'format', 'limit', 'offset'])

function bboxOk(b: string) {
  const v = b.split(',').map(Number)
  return v.length === 4 && v.every(Number.isFinite) && v[0] < v[2] && v[1] < v[3] && v[0] >= -180 && v[2] <= 180 && v[1] >= -90 && v[3] <= 90
}

/** `sub` is the path after /api/events (e.g. "/events/123/detections"). */
export function buildUpstream(sub: string, params: URLSearchParams): Built {
  if (sub === '/health') return { path: '/health', query: '', cache: 'none' }
  if (sub === '/meta' || sub === '/departments') return { path: sub, query: '', cache: 'short' }

  const one = /^\/events\/(\d{1,9})(\/detections)?$/.exec(sub)
  if (one) {
    const q = new URLSearchParams()
    const fmt = params.get('format')
    if (one[2] && fmt) { if (fmt !== 'json' && fmt !== 'geojson') return { error: 'format' }; q.set('format', fmt) }
    return { path: sub, query: q.toString(), cache: 'short' }
  }

  if (sub !== '/events') return { error: 'route_not_allowed' }
  for (const k of params.keys()) if (!PARAMS.has(k)) return { error: `param_not_allowed:${k}` }

  const start = params.get('start') ?? '', end = params.get('end') ?? ''
  const a = day(start), b = day(end)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: 'invalid_dates' }
  if (a > b) return { error: 'start_after_end' }
  if ((b - a) / 864e5 + 1 > MAX_RANGE_DAYS) return { error: 'range_too_long' }

  const q = new URLSearchParams({ start, end })
  const dept = params.get('department'), bbox = params.get('bbox')
  if (!dept && !bbox) return { error: 'department_or_bbox_required' }
  if (dept) { if (!/^[\p{L} ]{2,40}$/u.test(dept)) return { error: 'department' }; q.set('department', dept) }
  if (bbox) { if (!bboxOk(bbox)) return { error: 'bbox' }; q.set('bbox', bbox) }

  const conf = params.get('min_confidence')
  if (conf) { if (!['baja', 'media', 'alta'].includes(conf)) return { error: 'min_confidence' }; q.set('min_confidence', conf) }
  const types = params.get('event_type')
  if (types) { if (!types.split(',').every((t) => (EVENT_TYPES as readonly string[]).includes(t))) return { error: 'event_type' }; q.set('event_type', types) }
  const minDet = params.get('min_det')
  if (minDet) { if (!INT.test(minDet) || +minDet < 1 || +minDet > 10000) return { error: 'min_det' }; q.set('min_det', minDet) }
  const fmt = params.get('format')
  if (fmt) { if (fmt !== 'json' && fmt !== 'geojson') return { error: 'format' }; q.set('format', fmt) }

  const limit = params.get('limit') ?? '200', offset = params.get('offset') ?? '0'
  if (!INT.test(limit) || +limit < 1 || +limit > MAX_LIMIT) return { error: 'limit' }
  if (!INT.test(offset) || +offset > 1_000_000) return { error: 'offset' }
  q.set('limit', limit); q.set('offset', offset)
  return { path: '/events', query: q.toString(), cache: 'short' }
}
