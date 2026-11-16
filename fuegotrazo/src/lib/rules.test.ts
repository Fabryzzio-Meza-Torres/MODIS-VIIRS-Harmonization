import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVENT_DEPARTMENT, checkMapping, eventDepartment, regionIdForEventDepartment } from './departments.ts'
import { buildUpstream, EVENTS_UPSTREAM } from './proxy-rules.ts'
import { outcome, percent1, periodStatus, validity, type RiskRow } from './forecast.ts'
import { readFileSync } from 'node:fs'
import { handle } from '../../netlify/functions/events.mts'

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
const SERIES_NAMES = ['AMAZONAS', 'ANCASH', 'APURIMAC', 'AREQUIPA', 'AYACUCHO', 'CAJAMARCA', 'CALLAO', 'CUSCO', 'HUANCAVELICA', 'HUANUCO', 'ICA', 'JUNIN', 'LA LIBERTAD', 'LAMBAYEQUE', 'LIMA', 'LORETO', 'MADRE DE DIOS', 'MOQUEGUA', 'PASCO', 'PIURA', 'PUNO', 'SAN MARTIN', 'TACNA', 'TUMBES', 'UCAYALI']

test('departments: 25 unique ids, same names as the series API except CALLAO ↔ El Callao', () => {
  const ids = Object.keys(EVENT_DEPARTMENT).sort()
  assert.equal(ids.length, 25); assert.equal(new Set(Object.values(EVENT_DEPARTMENT)).size, 25)
  ids.forEach((id, i) => {
    const same = strip(EVENT_DEPARTMENT[id]) === SERIES_NAMES[i]
    assert.equal(same, id !== '07', `${id} ${EVENT_DEPARTMENT[id]} vs ${SERIES_NAMES[i]}`)
  })
  assert.equal(eventDepartment('07'), 'El Callao'); assert.equal(eventDepartment(null), null)
  assert.equal(regionIdForEventDepartment('Huánuco'), '10')
  assert.deepEqual(checkMapping(Object.values(EVENT_DEPARTMENT)), { missingInService: [], unmapped: [] })
  assert.deepEqual(checkMapping(['Cusco', 'Narnia']).unmapped, ['Narnia'])
})

const P = (s: string) => new URLSearchParams(s)
test('proxy rules: only the documented routes', () => {
  assert.deepEqual(buildUpstream('/health', P('')), { path: '/health', query: '', cache: 'none' })
  assert.equal((buildUpstream('/events/668517/detections', P('')) as any).path, '/events/668517/detections')
  for (const bad of ['/static-sources', '/index/rebuild', '/events/near', '/events/abc', '/events/1/../x', '/regions', '//evil.com'])
    assert.ok('error' in buildUpstream(bad, P('')), bad)
})

test('proxy rules: /events params are validated, unknown params rejected', () => {
  const ok = buildUpstream('/events', P('start=2024-09-01&end=2024-09-07&department=Cusco&limit=500&offset=0')) as any
  assert.equal(ok.path, '/events'); assert.match(ok.query, /department=Cusco/); assert.match(ok.query, /limit=500/)
  const bad: Record<string, string> = {
    engine: 'start=2024-09-01&end=2024-09-02&department=Cusco&engine=index',
    range: 'start=2020-01-01&end=2024-01-01&department=Cusco',
    order: 'start=2024-09-07&end=2024-09-01&department=Cusco',
    nothing: 'start=2024-09-01&end=2024-09-02',
    limit: 'start=2024-09-01&end=2024-09-02&department=Cusco&limit=50000',
    dept: 'start=2024-09-01&end=2024-09-02&department=Cusco%27%3B--',
    type: 'start=2024-09-01&end=2024-09-02&department=Cusco&event_type=incendio,x',
    bbox: 'start=2024-09-01&end=2024-09-02&bbox=1,2,3',
    date: 'start=2024-9-1&end=2024-09-02&department=Cusco',
  }
  for (const [k, q] of Object.entries(bad)) assert.ok('error' in buildUpstream('/events', P(q)), k)
  assert.ok(!('error' in buildUpstream('/events', P('start=2024-09-01&end=2024-09-07&bbox=-81.5,-18.5,-68.5,0.1&event_type=incendio,foco_aislado&min_confidence=alta'))))
  assert.ok(!('error' in buildUpstream('/events', P('start=2024-09-01&end=2024-09-07&department=El%20Callao'))))
})

test('proxy handler: fixed upstream, no open proxy, clean error mapping', async () => {
  const calls: string[] = []
  const up = (status: number, body = '{"ok":true}') => (async (u: any) => { calls.push(String(u)); return new Response(body, { status }) }) as typeof fetch
  const r = await handle(new Request('https://site.test/api/events/events?start=2024-09-01&end=2024-09-02&department=Cusco&limit=2'), up(200))
  assert.equal(r.status, 200); assert.match(r.headers.get('cache-control')!, /max-age/)
  assert.ok(calls[0].startsWith(EVENTS_UPSTREAM + '/events?')); assert.equal(calls.length, 1)

  assert.equal((await handle(new Request('https://site.test/api/events/http://evil.com/x'), up(200))).status, 400)
  assert.equal((await handle(new Request('https://site.test/api/events/events?start=2024-09-01&end=2024-09-02&department=Cusco', { method: 'POST' }), up(200))).status, 405)
  assert.equal(calls.length, 1, 'rejected requests never reach upstream')
  assert.equal((await handle(new Request('https://site.test/api/events/events/1'), up(404, '{"detail":"Evento no encontrado"}'))).status, 404)
  assert.equal((await handle(new Request('https://site.test/api/events/meta'), up(500))).status, 502)
  assert.equal((await handle(new Request('https://site.test/api/events/meta'), (async () => { throw new Error('boom') }) as any)).status, 502)
})

const row = (o: Partial<RiskRow>): RiskRow => ({ region_id: '08', region_name: 'CUSCO', issued_at: '2026-11-15T20:39:33Z', target_week_start: '2026-11-16', target_week_end_exclusive: '2026-11-23',
  lead_weeks: 1, probability: 0.9766, probability_percent: 97.66537, estimation_status: 'estimated', quality_status: 'experimental', unavailable_reasons: [], features_outside_region_training_range: [], ...o })

test('forecast: one decimal; null never becomes 0 %', () => {
  assert.match(percent1(97.66537)!, /^97[.,]7 %$/); assert.match(percent1(0)!, /^0[.,]0 %$/)
  assert.equal(percent1(null), null); assert.equal(percent1(undefined), null); assert.equal(percent1(NaN), null)
  assert.deepEqual(outcome(row({})), { available: true, percent: 97.66537 })
  assert.deepEqual(outcome(row({ probability_percent: null, probability: null })), { available: false, reasons: [] })
  assert.deepEqual(outcome(row({ estimation_status: 'unavailable', unavailable_reasons: ['missing_features'] })), { available: false, reasons: ['missing_features'] })
  assert.equal(outcome(undefined).available, false)
})

test('forecast: expired or refresh-required snapshot is not usable', () => {
  const until = '2026-11-22T00:00:00-05:00', t = Date.parse(until)
  assert.deepEqual(validity({ valid_until: until, refresh_required: false }, t - 1), { ok: true })
  assert.deepEqual(validity({ valid_until: until, refresh_required: false }, t + 1), { ok: false, reason: 'expired' })
  assert.deepEqual(validity({ valid_until: until, refresh_required: true }, t - 1), { ok: false, reason: 'refresh_required' })
  assert.deepEqual(validity({ refresh_required: false }), { ok: false, reason: 'invalid_valid_until' })
})

test('forecast: period status uses the America/Lima calendar day', () => {
  const at = (iso: string) => Date.parse(iso)
  assert.equal(periodStatus('2026-11-16', '2026-11-23', at('2026-11-16T04:59:00Z')), 'futura') // Nov 15 23:59 in Lima
  assert.equal(periodStatus('2026-11-16', '2026-11-23', at('2026-11-16T05:00:00Z')), 'en_curso')
  assert.equal(periodStatus('2026-11-16', '2026-11-23', at('2026-11-23T05:00:00Z')), 'pasada')
})

test('netlify function route is a static literal (Netlify cannot evaluate expressions)', () => {
  const src = readFileSync(new URL('../../netlify/functions/events.mts', import.meta.url), 'utf8')
  assert.match(src, /export const config = \{ path: '\/api\/events\/\*' \}/)
})
