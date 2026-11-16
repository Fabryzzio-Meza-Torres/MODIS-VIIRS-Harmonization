import { useMemo } from 'react'
import { locale, t } from '../i18n'
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend as RLegend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { summarize } from '../lib/summary'
import PeruMap from '../PeruMap'
import { useProvinceData } from '../provinceData'
import ProvincePanel from './ProvincePanel'
import { useApp, useRegionTotals, useSeries } from '../state'
import { axis, Card, COLORS, downloadCSV, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, monthLabel, monthLong, PageHeader, pick, Stat, tooltipStyle } from '../ui'

const NO_VALUES: Record<string, number | null> = {} // stable reference: no re-render churn in the map

export default function Panorama() {
  const { filters, setFilters, regionName, meta } = useApp()
  const { region, y0, y1, indicator } = filters
  const { months, years, weeks, loading, error, retry } = useSeries(region)
  const reg = useRegionTotals()
  const pd = useProvinceData(region)
  const legend = useMemo(() => ({
    title: `${pd.metric === 'density' ? t('Eventos por 1 000 km²', 'Events per 1,000 km²') : t('Eventos', 'Events')}${pd.range ? ` · ${pd.range.start} ${t('a', 'to')} ${pd.range.end}` : ''} (${t('API de eventos', 'events API')})`,
    format: pd.metric === 'density' ? (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 }) : (v: number) => fmt.full(v),
  }), [pd.metric, pd.range])

  const inPeriod = (key: string, a = y0, b = y1) => +key.slice(0, 4) >= a && +key.slice(0, 4) <= b
  const S = useMemo(() => summarize(years, months, weeks, indicator, y0, y1), [years, months, weeks, indicator, y0, y1])
  const { total, change, share, peak, estimated } = S
  const n = y1 - y0 + 1
  const priorHint =
    S.priorStart == null ? t('Sin periodo anterior disponible', 'No previous period available')
    : S.prior == null ? indicator === 'VIIRS' ? t('VIIRS no observaba en el periodo anterior', 'VIIRS was not observing in the previous period') : t('El registro no observaba en el periodo anterior', 'The record was not observing in the previous period')
    : `${y0 - n}–${y0 - 1}`
  const wk = { length: S.weeks }

  const recent = months.filter((m) => inPeriod(m.key)).slice(-36)
  const top = Object.entries(reg.totals ?? {})
    .filter((e): e is [string, number] => e[1] != null)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, v]) => ({ id, name: regionName(id), v }))

  const select = (id: string | null) => setFilters({ region: id === region ? null : id })
  const csv = () => downloadCSV(`fuegotrazo_monthly_${region ?? 'peru'}.csv`, months.map((m) => ({
    month: m.key, weeks: m.weeks, average_comparable_count: m.combined, modis_comparable_count: m.MODIS, viirs_comparable_count: m.VIIRS,
    territory: regionName(region),
    method_version: meta?.series.method_version, source_snapshot_id: meta?.series.source_snapshot_id,
  })))

  return (
    <>
      <aside className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 text-sm">
        <div><h2 className="font-medium">{t('¿Qué relaciona estas detecciones con registros de incendios?', 'How do these detections relate to fire records?')}</h2><p className="mt-1 text-xs text-muted">{t('Explora ejemplos documentados, sus fuentes oficiales y los criterios de comparación.', 'Explore documented examples, official sources and comparison criteria.')}</p></div>
        <a href="#validacion" className="shrink-0 text-sky underline">{t('Ver validación y fuentes', 'View validation and sources')}</a>
      </aside>
      <PageHeader title={t('Panorama de actividad del fuego', 'Fire activity overview')}
        subtitle={`${regionName(region)} · ${y0}–${y1} · ${INDICATOR_LABEL[indicator]}. ${t('Explora cómo se distribuye la actividad térmica en el territorio y a lo largo del tiempo.', 'Explore thermal activity across the territory and over time.')}`} />
      <div className="space-y-5">
        {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('Total del periodo', 'Period total')} value={fmt.n(total)} hint={`${fmt.full(total)} · ${t('unidades de la escala común', 'common-scale units')}`} />
            <Stat label={t('Variación vs. periodo anterior', 'Change vs. previous period')} value={change == null ? '—' : `${change > 0 ? '+' : ''}${fmt.pct(change)}`} hint={priorHint} />
            <Stat label={t('Mes de mayor actividad', 'Most active month')} value={peak < 0 ? '—' : monthLong()[peak]} hint={peak < 0 ? undefined : `${fmt.pct(share[peak])} ${t('del total anual medio', 'of the mean annual total')}`} />
            <Stat label={t('Semanas con estimación', 'Weeks with an estimate')} value={`${estimated} / ${wk.length}`} hint={t('Semana sin estimación ≠ cero', 'A week without an estimate ≠ zero')} />
          </div>
        )}

          <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
            <Card title={region ? `${t('Actividad por departamento', 'Activity by department')} · ${regionName(region)}` : t('Actividad por departamento', 'Activity by department')}
              subtitle={t('Haz clic en un departamento para ver sus provincias y, en una provincia, sus datos. Esc o las migas del mapa suben un nivel.', 'Click a department to see its provinces and, on a province, its data. Esc or the map breadcrumbs go up one level.')}
              className={reg.loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
              {reg.error ? <ErrorBox error={reg.error} retry={reg.retry} /> : (
                <PeruMap values={reg.totals ?? NO_VALUES} label={INDICATOR_LABEL[indicator]} selected={region} onSelect={select} regionName={regionName}
                  provinces={pd.provs} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })}
                  provinceValues={pd.values} provinceLegend={legend} />
              )}
            </Card>
            <Card title={t('Mayor actividad por departamento', 'Most active departments')} subtitle={`Top 10 · ${y0}–${y1}`}>
              {top.length === 0 ? (reg.loading ? <Loading /> : <Empty>{t('Sin estimaciones para este periodo.', 'No estimates for this period.')}</Empty>) : (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                    <XAxis type="number" {...axis} tickFormatter={fmt.n} />
                    <YAxis type="category" dataKey="name" width={100} {...axis} />
                    <Tooltip {...tooltipStyle} formatter={(v) => fmt.full(v as number)} cursor={{ fill: '#17334D' }} />
                    <Bar isAnimationActive={false} dataKey="v" name={INDICATOR_LABEL[indicator]} radius={[0, 4, 4, 0]} onClick={(d) => select((d as unknown as { id: string }).id)} style={{ cursor: 'pointer' }}>
                      {top.map((r) => <Cell key={r.id} fill={r.id === region ? COLORS.teal : '#F97316'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

        {region && <ProvincePanel pd={pd} regionName={regionName(region)} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })} />}

        {!error && (loading ? <Loading /> : (
          <Card title={t('Evolución mensual', 'Monthly evolution')} subtitle={`${t('Últimos 36 meses del periodo', 'Last 36 months of the period')} · ${regionName(region)}. ${t('Los huecos son meses sin estimación, no ceros.', 'Gaps are months without an estimate, not zeros.')}`}
            actions={<button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('Serie mensual (CSV)', 'Monthly series (CSV)')}</button>}>
            {recent.length === 0 ? <Empty>{t('El periodo elegido no contiene meses disponibles.', 'The chosen period contains no available months.')}</Empty> : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={recent} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} stroke={COLORS.grid} />
                  <XAxis dataKey="key" {...axis} tickFormatter={monthLabel} minTickGap={28} />
                  <YAxis {...axis} tickFormatter={fmt.n} width={48} />
                  <Tooltip {...tooltipStyle} labelFormatter={(k) => `${monthLabel(k as string)}${(k as string) >= '2026-07' ? ` (${t('parcial', 'partial')})` : ''}`} formatter={(v) => fmt.full(v as number)} />
                  <RLegend wrapperStyle={{ fontSize: 12 }} />
                  <Area isAnimationActive={false} dataKey="combined" name={t('Promedio armonizado', 'Harmonized average')} stroke={COLORS.combined} fill={COLORS.combined} fillOpacity={0.12} connectNulls={false} dot={false} />
                  <Line isAnimationActive={false} dataKey="MODIS" name={INDICATOR_LABEL.MODIS} stroke={COLORS.MODIS} dot={false} strokeWidth={2} connectNulls={false} />
                  <Line isAnimationActive={false} dataKey="VIIRS" name={INDICATOR_LABEL.VIIRS} stroke={COLORS.VIIRS} dot={false} strokeWidth={2} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        ))}
      </div>
    </>
  )
}
