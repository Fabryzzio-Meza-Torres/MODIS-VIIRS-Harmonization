import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan, PHASE_META } from './plan.ts'
import { phases, rollup, weekly, monthKey, type WeekRow } from './aggregate.ts'
import { summarize } from './summary.ts'

// Aug and Sep are the peak: Jun, Jul preparación; Oct cierre; the rest baja.
const share = Array(12).fill(0.02); share[7] = 0.3; share[8] = 0.3
const ph = phases(share)

test('plan: one block per phase, dates never in the past, today when already inside the phase', () => {
  const t = buildPlan(ph, '2026-08-20') // we are inside the high season
  const alta = t.filter((x) => x.phase === 'alta')
  assert.equal(alta.length, PHASE_META.alta.tips.length)
  assert.ok(alta.every((x) => x.due === '2026-08-20'))
  assert.ok(t.every((x) => x.due >= '2026-08-20'))
  assert.deepEqual([...new Set(t.map((x) => x.phase))].sort(), ['alta', 'baja', 'cierre', 'preparacion'])
  assert.equal(t.find((x) => x.phase === 'cierre')!.due, '2026-10-01')
  assert.equal(t.find((x) => x.phase === 'baja')!.due, '2026-11-01') // Oct is cierre, so low season starts in Nov
})

test('plan: wraps to next year, sorted by date, owners stay blank, ids unique', () => {
  const t = buildPlan(ph, '2026-11-15') // inside baja; the next preparation block starts in June 2027
  assert.equal(t.find((x) => x.phase === 'preparacion')!.due, '2027-06-01')
  assert.equal(t.find((x) => x.phase === 'alta')!.due, '2027-08-01')
  assert.deepEqual(t.map((x) => x.due), [...t.map((x) => x.due)].sort())
  assert.ok(t.every((x) => x.owner === '' && x.status === 'Pendiente'))
  assert.equal(new Set(t.map((x) => x.id)).size, t.length)
})

test('plan: phases that do not occur produce no tasks', () => {
  const flat = phases(Array(12).fill(1 / 12)) // uniform activity: no month stands out
  assert.deepEqual([...new Set(buildPlan(flat, '2026-03-10').map((x) => x.phase))], ['baja'])
})

const row = (w: string, i: 'MODIS' | 'VIIRS', h: number | null): WeekRow => ({ week_start_utc: w, instrument: i, platform: null, raw_count: h, harmonized_count: h,
  lower_bound: null, upper_bound: null, coverage_status: 'unknown', estimation_status: h == null ? 'unavailable' : 'estimated' })

test('summary: total, change vs previous period of equal length, peak month, coverage', () => {
  const rows = [row('2019-03-04', 'MODIS', 10), row('2020-03-02', 'MODIS', 10), row('2021-09-06', 'MODIS', 30), row('2022-09-05', 'MODIS', 30), row('2022-10-03', 'MODIS', null)]
  const w = weekly(rows)
  const s = summarize(rollup(w, (k) => k.slice(0, 4)), rollup(w, monthKey), w, 'MODIS', 2021, 2022)
  assert.equal(s.total, 60); assert.equal(s.prior, 20); assert.equal(s.priorStart, 2019)
  assert.equal(s.change, 2) // +200 %
  assert.equal(s.peak, 8) // September
  assert.deepEqual([s.estimated, s.weeks], [2, 3]) // the null week is a week without estimate, not a zero
  const early = summarize(rollup(w, (k) => k.slice(0, 4)), rollup(w, monthKey), w, 'MODIS', 2001, 2005)
  assert.equal(early.priorStart, null); assert.equal(early.change, null)
})
