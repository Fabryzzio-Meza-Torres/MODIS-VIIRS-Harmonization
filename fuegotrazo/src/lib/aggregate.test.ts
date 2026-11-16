import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekly, rollup, monthKey, seasonalShare, phases, agreement, type WeekRow } from './aggregate.ts'

const row = (w: string, i: 'MODIS' | 'VIIRS', h: number | null, raw: number | null = h): WeekRow => ({
  week_start_utc: w, instrument: i, platform: null, raw_count: raw, harmonized_count: h,
  lower_bound: h == null ? null : h * 0.9, upper_bound: h == null ? null : h * 1.1,
  coverage_status: 'unknown', estimation_status: h == null ? 'unavailable' : 'estimated' })

test('weekly: combined is the mean of available instruments; null VIIRS is not zero', () => {
  const w = weekly([row('2011-01-03', 'MODIS', 10), row('2011-01-03', 'VIIRS', null),
                    row('2013-01-07', 'MODIS', 10), row('2013-01-07', 'VIIRS', 30)])
  assert.equal(w[0].combined, 10); assert.equal(w[0].VIIRS, null)
  assert.equal(w[1].combined, 20)
})

test('rollup: sums by month, keeps null when every week is null', () => {
  const w = weekly([row('2011-01-03', 'MODIS', 1), row('2011-01-10', 'MODIS', 2),
                    row('2011-01-03', 'VIIRS', null), row('2011-01-10', 'VIIRS', null)])
  const [m] = rollup(w, monthKey)
  assert.equal(m.key, '2011-01'); assert.equal(m.MODIS, 3); assert.equal(m.VIIRS, null); assert.equal(m.weeks, 2)
})

test('seasonalShare sums to 1 over complete years', () => {
  const months = rollup(weekly([row('2015-03-02', 'MODIS', 3), row('2015-09-07', 'MODIS', 1)]), monthKey)
  const s = seasonalShare(months, 2015, 2015)
  assert.equal(s[2], 0.75); assert.equal(s[8], 0.25)
})

test('phases: peak months alta, two before preparacion, one after cierre', () => {
  const s = Array(12).fill(0.02); s[7] = 0.3; s[8] = 0.3  // Aug, Sep
  const p = phases(s)
  assert.deepEqual([p[5], p[6], p[7], p[8], p[9], p[0]], ['preparacion', 'preparacion', 'alta', 'alta', 'cierre', 'baja'])
})

test('agreement: identical series → ccc 1, r2 1, bias 0', () => {
  const a = agreement([1, 2, 3, 4], [1, 2, 3, 4])
  assert.equal(a.ccc, 1); assert.equal(a.r2, 1); assert.equal(a.bias, 0); assert.equal(a.n, 4)
})
