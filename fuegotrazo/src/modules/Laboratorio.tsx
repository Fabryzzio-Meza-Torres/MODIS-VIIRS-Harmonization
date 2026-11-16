import { useMemo, useState, type ReactNode } from 'react'
import { Area, CartesianGrid, ComposedChart, Legend as RLegend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { fetchValidation } from '../api'
import { locale, t } from '../i18n'
import { agreement } from '../lib/aggregate'
import { useApp, useAsync, useSeries } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, monthLabel, PageHeader, Select, Stat, tooltipStyle } from '../ui'

const num = (s: unknown, d = 3) => (s == null || s === '' || !Number.isFinite(Number(s)) ? '—' : Number(s).toLocaleString(locale(), { maximumFractionDigits: d }))
const stat = (v: number) => (Number.isFinite(v) ? v.toLocaleString(locale(), { maximumFractionDigits: 3 }) : '—')

function AntesDespues() {
  const { filters, regionName } = useApp()
  const { years, loading, error, retry } = useSeries(filters.region)
  const data = years.filter((y) => y.key >= '2001').map((y) => ({ ...y, splice: y.key < '2012' ? y.MODIS_raw : y.VIIRS_raw }))
  const tip = { ...tooltipStyle, labelFormatter: (k: unknown) => `${k}${k === '2026' ? ` (${t('parcial', 'partial')})` : k === '2012' ? ` (${t('VIIRS desde febrero', 'VIIRS from February')})` : ''}`, formatter: (v: unknown) => (v == null ? t('sin estimación', 'no estimate') : fmt.full(v as number)) }
  return (
    <Card title={t('Antes y después de armonizar', 'Before and after harmonizing')} subtitle={t(`${regionName(filters.region)}. Izquierda: unión directa de conteos originales (MODIS hasta 2011, VIIRS desde 2012). Derecha: ambos instrumentos en la misma escala estadística.`, `${regionName(filters.region)}. Left: direct splice of original counts (MODIS through 2011, VIIRS from 2012). Right: both instruments on the same statistical scale.`)}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">{t('Unión directa de originales', 'Direct splice of originals')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="key" {...axis} interval={3} /><YAxis {...axis} tickFormatter={fmt.n} width={52} />
                <Tooltip {...tip} /><Line isAnimationActive={false} dataKey="splice" name={t('Detecciones originales (MODIS → VIIRS)', 'Original detections (MODIS → VIIRS)')} stroke={COLORS.raw} strokeWidth={2} dot={false} connectNulls={false} />
                <ReferenceLine x="2012" stroke="#FBBF24" strokeDasharray="3 3" label={{ value: t('cambio de sensor', 'sensor change'), fill: '#FBBF24', fontSize: 11, position: 'insideTopLeft' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">{t('Conteos comparables estimados', 'Estimated comparable counts')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="key" {...axis} interval={3} /><YAxis {...axis} tickFormatter={fmt.n} width={52} />
                <Tooltip {...tip} /><RLegend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} dataKey="MODIS" name="MODIS" stroke={COLORS.MODIS} strokeWidth={2} dot={false} connectNulls={false} />
                <Line isAnimationActive={false} dataKey="VIIRS" name="VIIRS" stroke={COLORS.VIIRS} strokeWidth={2} dot={false} connectNulls={false} />
                <Line isAnimationActive={false} dataKey="combined" name={t('Promedio MODIS y VIIRS', 'MODIS and VIIRS average')} stroke={COLORS.combined} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  )
}

function Comparacion() {
  const { filters, regionName } = useApp()
  const { weeks, months, loading, error, retry } = useSeries(filters.region)
  const [year, setYear] = useState('2024')
  const wk = weeks.filter((w) => w.key.startsWith(year))
  const ratio = months.filter((m) => m.key >= '2012-03' && m.MODIS_raw && m.VIIRS_raw && m.MODIS && m.VIIRS)
    .map((m) => ({ key: m.key, raw: m.VIIRS_raw! / m.MODIS_raw!, harmonized: m.VIIRS! / m.MODIS! }))
  const tip = { ...tooltipStyle, formatter: (v: unknown) => (v == null ? t('sin estimación', 'no estimate') : fmt.full(v as number)) }
  return (
    <Card title={t('Comparación original MODIS frente a VIIRS', 'Original MODIS versus VIIRS comparison')} subtitle={t(`${regionName(filters.region)}. Líneas continuas: conteo armonizado; discontinuas: detecciones originales. Cada instrumento mide con distinta sensibilidad; la armonización los lleva a la misma escala.`, `${regionName(filters.region)}. Solid lines: harmonized count; dashed: original detections. Each instrument measures with a different sensitivity; harmonization brings them to the same scale.`)}
      actions={<Select label={t('Año', 'Year')} value={year} onChange={setYear} options={Array.from({ length: 15 }, (_, i) => ({ value: String(2012 + i), label: String(2012 + i) }))} />}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium">{t('Semanas de', 'Weeks of')} {year}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={wk} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="key" {...axis} tickFormatter={(w: string) => monthLabel(w.slice(0, 7)).slice(0, 3)} minTickGap={24} />
                <YAxis {...axis} tickFormatter={fmt.n} width={52} />
                <Tooltip {...tip} labelFormatter={(w) => `${t('Semana del', 'Week of')} ${fmt.date(w as string)}`} /><RLegend wrapperStyle={{ fontSize: 12 }} />
                <Line isAnimationActive={false} dataKey="MODIS" name={`MODIS · ${t('conteo comparable estimado', 'estimated comparable count')}`} stroke={COLORS.MODIS} strokeWidth={2} dot={false} connectNulls={false} />
                <Line isAnimationActive={false} dataKey="VIIRS" name={`VIIRS · ${t('conteo comparable estimado', 'estimated comparable count')}`} stroke={COLORS.VIIRS} strokeWidth={2} dot={false} connectNulls={false} />
                <Line isAnimationActive={false} dataKey="MODIS_raw" name={`MODIS · ${t('detecciones originales', 'original detections')}`} stroke={COLORS.MODIS} strokeDasharray="4 3" dot={false} connectNulls={false} />
                <Line isAnimationActive={false} dataKey="VIIRS_raw" name={`VIIRS · ${t('detecciones originales', 'original detections')}`} stroke={COLORS.VIIRS} strokeDasharray="4 3" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">{t('Razón VIIRS / MODIS mensual', 'Monthly VIIRS / MODIS ratio')}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={ratio} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} />
                <XAxis dataKey="key" {...axis} tickFormatter={(k: string) => k.slice(0, 4)} minTickGap={32} />
                <YAxis {...axis} scale="log" domain={['auto', 'auto']} tickFormatter={(v) => String(+v.toFixed(2))} width={44} allowDataOverflow />
                <Tooltip {...tooltipStyle} labelFormatter={(k) => monthLabel(k as string)} formatter={(v) => (v as number).toFixed(2)} /><RLegend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={1} stroke="#94A8BD" strokeDasharray="3 3" />
                <Line isAnimationActive={false} dataKey="raw" name={t('Detecciones originales', 'Original detections')} stroke={COLORS.raw} strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} dataKey="harmonized" name={t('Conteos comparables estimados', 'Estimated comparable counts')} stroke={COLORS.combined} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Card>
  )
}

function Concordancia() {
  const { filters, regionName } = useApp()
  const { y0, y1 } = filters
  const { weeks, loading, error, retry } = useSeries(filters.region)
  const lo = Math.max(y0, 2012)
  const pairs = useMemo(() => weeks.filter((w) => +w.key.slice(0, 4) >= lo && +w.key.slice(0, 4) <= y1 && w.MODIS != null && w.VIIRS != null && w.MODIS > 0 && w.VIIRS > 0), [weeks, lo, y1])
  const harm = pairs.length > 2 ? agreement(pairs.map((p) => p.MODIS!), pairs.map((p) => p.VIIRS!)) : null
  const orig = pairs.length > 2 ? agreement(pairs.map((p) => p.MODIS_raw!), pairs.map((p) => p.VIIRS_raw!)) : null
  const pts = pairs.map((p) => ({ x: p.MODIS, y: p.VIIRS, w: p.key }))
  const all = pts.flatMap((p) => [p.x!, p.y!])
  const max = 10 ** Math.ceil(Math.log10(Math.max(1, ...all)))
  const min = 10 ** Math.floor(Math.log10(Math.min(max, ...all)))
  return (
    <Card title={t('Concordancia entre sensores', 'Agreement between sensors')} subtitle={t(`${regionName(filters.region)} · semanas ${lo}–${y1} con estimación de ambos instrumentos. Cada punto es una semana; la diagonal es el acuerdo perfecto. CCC es la concordancia de Lin; el sesgo es el de VIIRS respecto de MODIS.`, `${regionName(filters.region)} · weeks ${lo}–${y1} with an estimate from both instruments. Each point is a week; the diagonal is perfect agreement. CCC is Lin's concordance; the bias is that of VIIRS relative to MODIS.`)}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : !harm || !orig ? <Empty>{t('Se necesitan al menos 3 semanas con ambos instrumentos (desde febrero de 2012).', 'At least 3 weeks with both instruments are needed (from February 2012).')}</Empty> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ right: 16, bottom: 16, left: 4 }}>
              <CartesianGrid stroke={COLORS.grid} />
              <XAxis type="number" dataKey="x" name="MODIS" scale="log" domain={[min, max]} allowDataOverflow {...axis} tickFormatter={fmt.n} label={{ value: t('MODIS armonizado (semana)', 'MODIS harmonized (week)'), position: 'insideBottom', offset: -8, fill: '#94A8BD', fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="VIIRS" scale="log" domain={[min, max]} allowDataOverflow {...axis} tickFormatter={fmt.n} width={52} />
              <ZAxis range={[18, 18]} />
              <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3' }} formatter={(v) => fmt.full(v as number)} />
              <ReferenceLine segment={[{ x: min, y: min }, { x: max, y: max }]} stroke="#94A8BD" strokeDasharray="5 4" />
              <Scatter isAnimationActive={false} data={pts} fill={COLORS.combined} fillOpacity={0.55} />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('Conteos comparables estimados', 'Estimated comparable counts')}</h3>
              <div className="grid grid-cols-2 gap-2"><Stat label={t('CCC de Lin', 'Lin\'s CCC')} value={stat(harm.ccc)} /><Stat label="R²" value={stat(harm.r2)} /><Stat label={t('Sesgo relativo', 'Relative bias')} value={fmt.pct(harm.bias)} /><Stat label={t('Semanas', 'Weeks')} value={fmt.full(harm.n)} /></div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('Detecciones originales (para contraste)', 'Original detections (for contrast)')}</h3>
              <div className="grid grid-cols-2 gap-2"><Stat label={t('CCC de Lin', 'Lin\'s CCC')} value={stat(orig.ccc)} /><Stat label="R²" value={stat(orig.r2)} /><Stat label={t('Sesgo relativo', 'Relative bias')} value={fmt.pct(orig.bias)} /><Stat label={t('Semanas', 'Weeks')} value={fmt.full(orig.n)} /></div>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Incertidumbre() {
  const { filters, regionName } = useApp()
  const { weeks, loading, error, retry } = useSeries(filters.region)
  const both = (lo: number | null, hi: number | null) => (lo != null && hi != null ? [lo, hi] : null)
  const data = weeks.slice(-104).map((w) => ({ key: w.key, MODIS: w.MODIS, VIIRS: w.VIIRS, bandM: both(w.MODIS_lo, w.MODIS_hi), bandV: both(w.VIIRS_lo, w.VIIRS_hi) }))
  return (
    <Card title={t('Incertidumbre del factor de calibración', 'Calibration factor uncertainty')} subtitle={t(`${regionName(filters.region)} · últimas 104 semanas. Cada banda es la que entrega el servicio para ese instrumento (95 %) y refleja solo la incertidumbre del factor de calibración, no la incertidumbre total del conteo. Donde no hay banda, el servicio no la proporcionó.`, `${regionName(filters.region)} · last 104 weeks. Each band is the one the service delivers for that instrument (95 %) and reflects only the uncertainty of the calibration factor, not the total uncertainty of the count. Where there is no band, the service did not provide one.`)}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ right: 12 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="key" {...axis} tickFormatter={(k: string) => monthLabel(k.slice(0, 7))} minTickGap={40} />
            <YAxis {...axis} tickFormatter={fmt.n} width={52} />
            <Tooltip {...tooltipStyle} labelFormatter={(k) => `${t('Semana del', 'Week of')} ${fmt.date(k as string)}`} formatter={(v) => (Array.isArray(v) ? `${fmt.full(v[0])} – ${fmt.full(v[1])}` : v == null ? t('sin estimación', 'no estimate') : fmt.full(v as number))} />
            <RLegend wrapperStyle={{ fontSize: 12 }} />
            <Area isAnimationActive={false} dataKey="bandM" name={`MODIS · ${t('banda', 'band')} 95 %`} stroke="none" fill={COLORS.MODIS} fillOpacity={0.25} />
            <Area isAnimationActive={false} dataKey="bandV" name={`VIIRS · ${t('banda', 'band')} 95 %`} stroke="none" fill={COLORS.VIIRS} fillOpacity={0.25} />
            <Line isAnimationActive={false} dataKey="MODIS" name={`MODIS · ${t('conteo comparable estimado', 'estimated comparable count')}`} stroke={COLORS.MODIS} strokeWidth={2} dot={false} connectNulls={false} />
            <Line isAnimationActive={false} dataKey="VIIRS" name={`VIIRS · ${t('conteo comparable estimado', 'estimated comparable count')}`} stroke={COLORS.VIIRS} strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted"><tr>{head.map((h) => <th key={h} className="py-1 pr-4 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`py-1.5 pr-4 ${j > 1 ? 'font-mono' : ''}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Validacion() {
  const { meta } = useApp()
  const { data: v, loading, error, retry } = useAsync(fetchValidation, [])
  const s = meta?.series
  const calib = (rows: any[]) => rows.map((r) => [r.year ?? '—', `${r.split} · ${r.model === 'identity' ? t('sin calibrar', 'uncalibrated') : t('calibrado', 'calibrated')}`, num(r.pairs, 0), num(r.conditional_nll), num(r.conditional_allocation_mae), num(r.conditional_allocation_rmse)])
  return (
    <>
      <Card title={t('Validación', 'Validation')} subtitle={t('Resultados publicados por la API. Evalúan la asignación condicional de conteos pareados, no el conteo real de incendios.', 'Results published by the API. They evaluate the conditional allocation of paired counts, not the actual count of fires.')}>
        {error ? <ErrorBox error={error} retry={retry} /> : loading || !v ? <Loading label={t('Consultando la validación…', 'Fetching the validation…')} /> : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Stat label={t('Cobertura corregida', 'Coverage corrected')} value={v.coverage_corrected ? t('Sí', 'Yes') : t('No', 'No')} />
              <Stat label={t('Validación con incidentes en terreno', 'Validation with ground incidents')} value={v.ground_incident_validation_complete ? t('Completa', 'Complete') : t('Incompleta', 'Incomplete')} />
              <Stat label={t('Pronóstico por celdas (anterior) vs climatología', 'Cell forecast (previous) vs climatology')} value={v.forecast_not_uniformly_better_than_climatology ? t('No es uniformemente mejor', 'Not uniformly better') : t('Mejor', 'Better')} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('Calibración · validación externa temporal', 'Calibration · outer temporal validation')}</h3>
              <Table head={[t('Año', 'Year'), t('Partición', 'Split'), t('Pares', 'Pairs'), 'NLL', 'MAE', 'RMSE']} rows={calib(v.calibration_outer)} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('Calibración · prueba final', 'Calibration · final test')}</h3>
              <Table head={[t('Año', 'Year'), t('Partición', 'Split'), t('Pares', 'Pairs'), 'NLL', 'MAE', 'RMSE']} rows={calib(v.calibration_final)} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium">{t('Producto anterior de pronóstico por celdas · climatología frente a modelo', 'Previous cell-forecast product · climatology versus model')}</h3>
              <p className="mb-2 text-xs text-muted">{t('Corresponde a /v1/forecasts, un producto distinto del pronóstico regional de nuevos episodios; sus métricas no se aplican a ese otro.', 'This is /v1/forecasts, a product distinct from the regional forecast of new episodes; its metrics do not apply to that one.')}</p>
              <Table head={[t('Periodo', 'Period'), t('Partición', 'Split'), t('Modelo', 'Model'), 'AP', 'Brier', 'ROC-AUC', t('Captura top 5 %', 'Top 5 % capture')]}
                rows={v.forecast.map((r: any) => [r.period, r.split.replaceAll('_', ' '), r.model === 'climatology' ? t('Climatología', 'Climatology') : 'Gradient boosting', num(r.average_precision), num(r.brier_score, 4), num(r.roc_auc), num(r.top_5pct_capture)])} />
            </div>
          </div>
        )}
      </Card>
      <Card title={t('Método', 'Method')} subtitle={t('Metadatos del snapshot publicado.', 'Metadata of the published snapshot.')}>
        {!s ? <Loading /> : (
          <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
            {([
              [t('Versión del método', 'Method version'), s.method_version], [t('Referencia de escala', 'Scale reference'), s.reference], [t('Unidad de conteo', 'Count unit'), s.count_unit],
              [t('Incertidumbre', 'Uncertainty'), s.uncertainty_kind], [t('Fusión del índice combinado', 'Combined index fusion'), s.fusion_for_forecast], [t('Elección de plataforma', 'Platform choice'), s.platform_choice],
              ['Snapshot', String(s.source_snapshot_id).slice(0, 16) + '…'], [t('NRT incluido', 'NRT included'), s.NRT_included ? t('Sí', 'Yes') : t('No', 'No')],
              [t('Cobertura corregida', 'Coverage corrected'), s.coverage_corrected ? t('Sí', 'Yes') : t('No', 'No')], [t('Armonización física completa', 'Full physical harmonization'), s.complete_physical_harmonization ? t('Sí', 'Yes') : t('No', 'No')],
            ] as [string, string][]).map(([k, val]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5">{val}</dd></div>)}
          </dl>
        )}
      </Card>
    </>
  )
}

export default function Laboratorio() {
  return (
    <>
      <PageHeader title={t('Laboratorio de armonización satelital', 'Satellite harmonization lab')} subtitle={t('Explora, compara y evalúa los conteos de actividad térmica de MODIS y VIIRS en una escala común, con las métricas de validación publicadas.', 'Explore, compare and evaluate the MODIS and VIIRS thermal activity counts on a common scale, with the published validation metrics.')} />
      <div className="space-y-5"><AntesDespues /><Comparacion /><Concordancia /><Incertidumbre /><Validacion /></div>
    </>
  )
}
