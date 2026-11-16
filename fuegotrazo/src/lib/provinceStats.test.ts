import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bucketKind, per1000km2, rankProvinces, spanDays, summarize, type EventLike } from './provinceStats.ts'
import type { Province } from './geo.ts'

const ev = (id: number, t: string, o: Partial<EventLike> = {}): EventLike =>
  ({ event_id: id, t_start: t, n_det: 4, n_modis: 1, n_viirs: 3, frp_total: 10, frp_max: 4, event_type: 'incendio', lon: 0, lat: 0, ...o })

test('range: span and bucket kind (inclusive end)', () => {
  assert.equal(spanDays({ start: '2026-07-01', end: '2026-07-31' }), 31)
  assert.equal(spanDays({ start: '2026-07-01', end: '2026-07-01' }), 1)
  assert.equal(spanDays({ start: '2026-05-01', end: '2026-07-01' }), 62)
  assert.equal(bucketKind({ start: '2026-05-01', end: '2026-07-01' }), 'day') // 62 days: still daily
  assert.equal(bucketKind({ start: '2026-05-01', end: '2026-07-02' }), 'month') // 63 days: monthly
})

test('summarize: plain sums, conservation (buckets + before = events), UTC month edges', () => {
  const r = { start: '2024-09-01', end: '2024-11-30' } // 91 days → monthly
  const events = [
    ev(1, '2024-08-27T18:37:00+00:00'), // started before the period (API returns overlaps)
    ev(2, '2024-09-30T23:59:59+00:00', { n_modis: 0, n_viirs: 6, frp_total: 30.5, frp_max: 9, event_type: 'foco_aislado' }),
    ev(3, '2024-10-01T00:00:00+00:00', { frp_max: 12 }),
    ev(4, '2024-11-30T12:00:00+00:00'),
  ]
  const s = summarize(events, r)
  assert.equal(s.bucketKind, 'month')
  assert.deepEqual(s.buckets, [{ key: '2024-09', n: 1 }, { key: '2024-10', n: 1 }, { key: '2024-11', n: 1 }]) // Sep 30 23:59Z stays in Sep; Oct 1 00:00Z in Oct
  assert.equal(s.beforePeriod, 1)
  assert.equal(s.buckets.reduce((t, b) => t + b.n, 0) + s.beforePeriod, s.events)
  assert.equal(s.events, 4)
  assert.equal(s.modis, 1 + 0 + 1 + 1); assert.equal(s.viirs, 3 + 6 + 3 + 3)
  assert.equal(s.frpTotal, 10 + 30.5 + 10 + 10); assert.equal(s.frpMax, 12) // max of maxima, not an average
  assert.deepEqual(s.byType, { incendio: 3, foco_aislado: 1 })
})

test('summarize: daily buckets include real zeros; empty input is all zeros, frpMax null', () => {
  const s = summarize([ev(1, '2026-07-02T10:00:00+00:00')], { start: '2026-07-01', end: '2026-07-04' })
  assert.equal(s.bucketKind, 'day')
  assert.deepEqual(s.buckets.map((b) => b.n), [0, 1, 0, 0])
  const e = summarize([], { start: '2026-07-01', end: '2026-07-03' })
  assert.equal(e.events, 0); assert.equal(e.frpMax, null); assert.equal(e.frpTotal, 0)
})

test('density and ranking: events per 1 000 km², shares of the assigned total', () => {
  assert.equal(per1000km2(50, 2000), 25)
  assert.equal(per1000km2(5, 0), null)
  const provs = [{ id: 'a', name: 'A', areaKm2: 1000 }, { id: 'b', name: 'B', areaKm2: 4000 }, { id: 'c', name: 'C', areaKm2: 500 }] as Province[]
  const by = new Map<string, EventLike[]>([['a', [ev(1, '2026-01-01'), ev(2, '2026-01-01')]], ['b', [ev(3, '2026-01-01'), ev(4, '2026-01-01'), ev(5, '2026-01-01'), ev(6, '2026-01-01')]], ['c', []]])
  const rows = rankProvinces(by, provs)
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c'])
  assert.deepEqual(rows.map((r) => r.per1000), [1, 2, 0]) // B has more events but A is denser
  assert.equal(rows.reduce((t, r) => t + r.share, 0), 1)
  assert.equal(rows[0].share, 4 / 6)
})
