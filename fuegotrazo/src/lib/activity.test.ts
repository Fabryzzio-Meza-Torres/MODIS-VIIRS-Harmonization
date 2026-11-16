import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVITY_EVENT, activityContract, difference1, outcome, validity, type RiskRow } from './forecast.ts'

const row: RiskRow = { region_id: '20', region_name: 'PIURA', issued_at: '2026-11-16T02:04:00Z',
  target_week_start: '2026-11-16', target_week_end_exclusive: '2026-11-23', lead_weeks: 1,
  probability: .991, probability_percent: 99.1, estimation_status: 'estimated', quality_status: 'experimental',
  unavailable_reasons: [], features_outside_region_training_range: [] }

test('activity contract accepts the observed event and department scope only', () => {
  const meta = { target_event: ACTIVITY_EVENT, supported_spatial_units: ['department'], physical_ignition_probability_verified: false }
  assert.equal(activityContract(meta), true)
  assert.equal(activityContract({ ...meta, target_event: 'new_physical_ignition' }), false)
  assert.equal(activityContract({ ...meta, supported_spatial_units: ['province'] }), false)
  assert.equal(activityContract({ ...meta, physical_ignition_probability_verified: true }), false)
  assert.equal(activityContract({}), false)
})

test('probability and percentage must be finite, bounded and consistent', () => {
  assert.equal(outcome(row).available, true)
  for (const values of [{ probability_percent: 9910 }, { probability_percent: NaN },
    { probability: null }, { probability_percent: 0 }, { probability: 1.1 }]) {
    assert.equal(outcome({ ...row, ...values }).available, false)
  }
  assert.equal(outcome({ ...row, probability: 0, probability_percent: 0 }).available, true)
})

test('a difference is in percentage points, not a relative risk ratio', () => {
  assert.match(difference1(-.8714), /^−0[.,]9 pp$/)
  assert.match(difference1(20), /^\+20[.,]0 pp$/)
  assert.match(difference1(-.001), /^0[.,]0 pp$/)
  assert.equal(difference1(null), 'No disponible')
})

test('the snapshot expires at the exact exclusive boundary', () => {
  const until = '2026-11-22T00:00:00-05:00'
  assert.deepEqual(validity({ valid_until: until }, Date.parse(until)), { ok: false, reason: 'expired' })
})
