import { useMemo, useState } from 'react'
import { t } from './i18n'
import { fetchEventsMeta, useDepartmentEvents } from './events'
import { assignToProvinces, unionBbox, type Province } from './lib/geo'
import { MAX_RANGE_DAYS } from './lib/proxy-rules'
import { rankProvinces, spanDays, type Range } from './lib/provinceStats'
import { useAsync, useProvinces } from './state'
import { shiftDay } from './ui'

const NONE: Province[] = []
export type Metric = 'density' | 'count'

/**
 * Everything the province drill-down needs, computed once per department: the provinces, the period, the events of
 * the whole department (one download) assigned to provinces, and the ranking. The map and the panel read the same object.
 */
export function useProvinceData(region: string | null) {
  const { provinces: all } = useProvinces()
  const provs = useMemo(() => (region ? all.filter((p) => p.regionId === region) : NONE), [all, region])
  const meta = useAsync(fetchEventsMeta, [])
  const coverage = meta.data ? { min: meta.data.t_min.slice(0, 10), max: meta.data.t_max.slice(0, 10) } : null
  const [custom, setCustom] = useState<Range | null>(null)
  const range: Range | null = custom ?? (coverage ? { start: shiftDay(coverage.max, -89), end: coverage.max } : null) // last 90 days of the coverage
  const rangeError = !range ? null : range.start > range.end ? t('La fecha inicial debe ser anterior o igual a la final.', 'The start date must be on or before the end date.')
    : spanDays(range) > MAX_RANGE_DAYS ? t(`El rango máximo es de ${MAX_RANGE_DAYS} días.`, `The maximum range is ${MAX_RANGE_DAYS} days.`) : null
  const bbox = useMemo(() => unionBbox(provs), [provs])
  const q = useDepartmentEvents(rangeError ? null : bbox, rangeError ? null : range)
  const assigned = useMemo(() => assignToProvinces(q.events, provs), [q.events, provs])
  const rows = useMemo(() => rankProvinces(assigned.byProvince, provs), [assigned, provs])
  const [metric, setMetric] = useState<Metric>('density')
  const ready = !!range && !rangeError && !q.loading && !q.error && q.total != null
  // the choropleth is shown only for a complete download: a partial one is a minimum, not something to rank
  const values = useMemo(
    () => (ready && q.complete ? Object.fromEntries(rows.map((r) => [r.id, metric === 'density' ? r.per1000 : r.events])) : undefined),
    [ready, q.complete, rows, metric],
  )
  return { provs, coverage, range, setRange: setCustom, rangeError, q, assigned, rows, metric, setMetric, ready, values }
}
export type ProvinceData = ReturnType<typeof useProvinceData>
