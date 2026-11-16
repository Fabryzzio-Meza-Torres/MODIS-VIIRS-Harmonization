import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchActivity, fetchActivityMetadata, fetchActivityOutlook, type ActivityMeta } from '../api'
import { ApiError, difference1, outcome, percent1, periodStatus, validity, type ActivityRow } from '../lib/forecast'
import { useApp, useAsync } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, PageHeader, shiftDay, tooltipStyle, Unavailable, weekLabel } from '../ui'

function failure(error: Error): string {
  if (error instanceof ApiError && error.status === 503) return 'No hay una emisión vigente disponible. Hace falta que el servicio publique un nuevo pronóstico.'
  if (error instanceof ApiError && error.status === 404) return 'La región o la semana elegida no forman parte de esta emisión.'
  return 'No se pudo verificar el pronóstico. Reintenta la consulta; no se mostrará un porcentaje sustituto.'
}

function Evaluation({ meta }: { meta: ActivityMeta }) {
  const periods = [...new Set(meta.evaluation.map((r) => r.period))]
  return (
    <details className="mt-5 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer font-medium">Método, evaluación y límites</summary>
      <div className="mt-4 max-w-[80ch] space-y-4 text-muted">
        <p>El objetivo es al menos una detección elegible de NOAA-20 en todo el departamento durante siete días. El archivo histórico usa procesamiento estándar, tipo inferido 0 (presunto fuego de vegetación) y confianza nominal o alta. No es una verificación de incendios forestales.</p>
        <p>El modelo se ajustó con 2018–2021, se seleccionó en 2022 y se calibró en 2023. Los resultados siguientes son retrospectivos: estos años ya se habían examinado en el proyecto. Aún falta comprobar el desempeño con semanas futuras.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-2 text-left">Error Brier · menor es mejor; no es un porcentaje de acierto</caption>
            <thead><tr className="border-b border-line text-ink"><th scope="col" className="py-2 pr-4">Periodo</th><th scope="col" className="pr-4">Modelo</th><th scope="col">Climatología</th></tr></thead>
            <tbody>{periods.map((period) => {
              const model = meta.evaluation.find((r) => r.period === period && r.model === meta.selected_model)
              const baseline = meta.evaluation.find((r) => r.period === period && r.model === 'climatology')
              return <tr key={period} className="border-b border-line"><th scope="row" className="py-2 pr-4 font-normal">{period.includes('2026') ? '2026 · enero–julio' : period}</th><td className="pr-4">{model?.brier.toFixed(4) ?? 'No disponible'}</td><td>{baseline?.brier.toFixed(4) ?? 'No disponible'}</td></tr>
            })}</tbody>
          </table>
        </div>
        <p>{meta.calibration.observed_pooled_brier_improved ? 'Se evaluó una calibración por plazo, ajustada en 2023.' : 'La calibración no redujo el error Brier conjunto de 2024–2025.'} No se ha demostrado que cada porcentaje futuro exacto sea fiable.</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>La detección puede incluir quemas agrícolas y anomalías mal clasificadas. No mide daños, superficie quemada ni el inicio físico de un incendio.</li>
          <li>La cobertura de observación no está corregida por completo: nubes y horarios de paso pueden impedir detectar fuego.</li>
          <li>Las señales recientes NRT no incluyen un tipo de fuego confirmado; su transferencia al modelo entrenado con el archivo estándar aún no está validada.</li>
          <li>La meteorología representa un punto por departamento, no un promedio del territorio. Las semanas lejanas reflejan principalmente región y estación; no se usa un pronóstico meteorológico diario a 12 semanas.</li>
          <li>La frecuencia histórica es descriptiva. La diferencia en puntos porcentuales no es una alerta ni una prueba de significación estadística.</li>
        </ul>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt>Método</dt><dd className="break-all text-ink">{meta.method_version}</dd></div>
          <div><dt>Última adquisición NRT</dt><dd className="text-ink">{fmt.lima(meta.NRT_last_acquisition_utc)}</dd></div>
          <div><dt>Día meteorológico utilizado</dt><dd className="text-ink">{meta.weather_value_days_used.map((d) => fmt.date(d)).join(', ')}</dd></div>
          <div><dt>Actualización e incertidumbre</dt><dd className="text-ink">Actualización manual; sin intervalos de incertidumbre individuales.</dd></div>
        </dl>
        <p className="flex flex-wrap gap-x-4 gap-y-2">{meta.scientific_sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-sky underline">{source.title.includes('limitations') ? 'Límites de FIRMS · NASA' : 'Producto VIIRS · NASA'}</a>)}<a href="#validacion" className="text-sky underline">Validación y fuentes del proyecto</a></p>
      </div>
    </details>
  )
}

function Result({ row, meta, name, now }: { row: ActivityRow; meta: ActivityMeta; name: string; now: number }) {
  const value = outcome(row)
  if (!value.available) return <Unavailable reasons={value.reasons}>No hay una estimación respaldada para esta región y semana.</Unavailable>
  const history = row.historical_reference
  const period = periodStatus(row.target_week_start, row.target_week_end_exclusive, now)
  const periodLabel = { futura: 'Semana futura', en_curso: 'Semana en curso · pronóstico emitido previamente', pasada: 'Semana terminada · pronóstico emitido previamente' }[period]
  return <>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-md bg-amber px-2.5 py-1 font-semibold text-base">Experimental</span>
      <span className="text-muted">{periodLabel}</span>
    </div>
    <p className="mt-3 max-w-[72ch] text-sm">{meta.ui.explanation_es}</p>
    <dl className="mt-5 grid gap-5 border-y border-line py-5 sm:grid-cols-3">
      <div><dt className="text-xs text-muted">Estimación para esta semana</dt><dd className="mt-1 text-3xl font-semibold tabular-nums" data-testid="activity-probability">{percent1(value.percent)}</dd></div>
      <div><dt className="text-xs text-muted">Frecuencia histórica comparable</dt><dd className="mt-1 text-2xl tabular-nums">{percent1(history.frequency_percent) ?? 'No disponible'}</dd><p className="mt-1 text-xs text-muted">{history.positive_weeks} de {history.total_weeks} semanas con registro</p></div>
      <div><dt className="text-xs text-muted">Diferencia frente al histórico</dt><dd className="mt-1 text-2xl tabular-nums">{difference1(row.difference_from_historical_frequency_pp)}</dd><p className="mt-1 text-xs text-muted">pp = puntos porcentuales; no mide gravedad</p></div>
    </dl>
    <p className="mt-3 max-w-[78ch] text-sm text-muted">Basta una detección en cualquier lugar de {name} para que la semana tenga actividad registrada. Por eso un porcentaje alto puede ser habitual en un departamento grande; no significa que esa proporción del territorio vaya a arder.</p>
    <p className="mt-3 text-xs text-muted">Histórico: {history.years.length ? history.years[0] + '–' + history.years[history.years.length - 1] : 'sin años comparables'}, semanas cerradas de años anteriores a ±{history.seasonal_half_window_days} días de esta época. Es una frecuencia observada, sin corrección completa de cobertura.</p>
    {!!row.features_outside_region_training_range.length && <p className="mt-4 rounded-md border border-line p-3 text-sm text-muted">Algunas variables recientes están fuera del rango visto en el entrenamiento de {name}. La estimación requiere especial cautela.</p>}
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
      <span>Emisión: {fmt.lima(row.issued_at)}</span><span>Vigente hasta: {fmt.lima(meta.valid_until)}</span>
    </div>
    <Evaluation meta={meta} />
  </>
}

function WeeklyChart({ rows, week, onPick }: { rows: ActivityRow[]; week: string; onPick: (w: string) => void }) {
  const data = [...rows].sort((a, b) => a.lead_weeks - b.lead_weeks).map((r) => ({
    week: r.target_week_start, label: fmt.short(r.target_week_start), end: r.target_week_end_exclusive,
    probability: outcome(r).available ? r.probability_percent : null, historical: r.historical_reference.frequency_percent,
  }))
  return <>
    <p className="mb-3 text-xs text-muted">Barras: estimación del modelo · línea: frecuencia histórica comparable</p>
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ right: 12 }} aria-label="Probabilidad y frecuencia histórica por semana">
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis {...axis} domain={[0, 100]} width={48} tickFormatter={(v) => String(v) + ' %'} />
        <Tooltip {...tooltipStyle} labelFormatter={(_, payload) => { const row = payload?.[0]?.payload; return row ? weekLabel(row.week, row.end) : '' }} formatter={(v) => percent1(v as number) ?? 'No disponible'} />
        <Bar dataKey="probability" name="Modelo" isAnimationActive={false} radius={[3, 3, 0, 0]} onClick={(r) => onPick((r as unknown as { week: string }).week)} style={{ cursor: 'pointer' }}>
          {data.map((r) => <Cell key={r.week} fill={r.week === week ? '#FBBF24' : '#3A6E9E'} />)}
        </Bar>
        <Line dataKey="historical" name="Histórico" type="linear" stroke="#94A8BD" strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  </>
}

export default function Pronostico() {
  const { filters, regionName, setFilters } = useApp()
  const region = filters.region
  const metaQ = useAsync(fetchActivityMetadata, [])
  const meta = metaQ.data
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (!meta) return
    const delay = Date.parse(meta.valid_until) - Date.now()
    if (delay <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(delay + 5, 2147483647))
    return () => clearTimeout(timer)
  }, [meta?.valid_until])
  const valid = meta ? validity(meta, now) : null
  const usable = !!meta && !!valid?.ok && !metaQ.loading && !metaQ.error
  const weeks = meta?.available_target_weeks ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const week = picked && weeks.includes(picked) ? picked : weeks[0] ?? null
  const single = useAsync((signal) => usable && region && week ? fetchActivity(region, week, signal) : Promise.resolve(null), [usable, region, week, meta?.snapshot_id])
  const own = useAsync((signal) => usable && region ? fetchActivityOutlook(region, signal) : Promise.resolve(null), [usable, region, meta?.snapshot_id])
  const all = useAsync((signal) => usable ? fetchActivityOutlook(null, signal) : Promise.resolve(null), [usable, meta?.snapshot_id])
  const row = single.data?.data.find((r) => r.region_id === region && r.target_week_start === week)
  const ownRows = own.data?.data.filter((r) => r.region_id === region) ?? []
  const comparison = useMemo(() => (all.data?.data ?? []).filter((r) => r.target_week_start === week)
    .sort((a, b) => regionName(a.region_id).localeCompare(regionName(b.region_id), 'es')), [all.data, week, regionName])
  const name = regionName(region)
  return <>
    <PageHeader title="Probabilidad de actividad de fuego detectada" subtitle="Estimación semanal para todo un departamento, con una referencia histórica de la misma época. Un indicador experimental de registros satelitales, no una alerta oficial." />
    {filters.province && <p className="mb-4 rounded-md border border-line p-3 text-sm text-muted">La selección provincial no modifica este cálculo. El pronóstico corresponde a todo el departamento; todavía no hay un modelo por provincia o punto.</p>}
    {metaQ.error ? <Unavailable>{failure(metaQ.error)} <button className="ml-2 text-sky underline" onClick={metaQ.retry}>Reintentar</button></Unavailable>
      : metaQ.loading || !meta ? <Loading label="Verificando la emisión y su alcance…" />
      : !valid?.ok ? <Unavailable>La emisión ya no está vigente o requiere actualización. Hasta publicar una nueva no se muestran porcentajes. <button className="ml-2 text-sky underline" onClick={metaQ.retry}>Consultar de nuevo</button></Unavailable>
      : <div className="space-y-5">
        <Card title="Semana que quieres consultar" subtitle="Cada opción es una semana completa, de lunes a domingo en hora de Lima. El plazo 12 es una semana concreta, no una probabilidad acumulada.">
          <div className="flex flex-wrap gap-2">{weeks.map((w, i) => <button key={w} aria-pressed={w === week} onClick={() => setPicked(w)} className={'rounded-md border px-3 py-2 text-sm ' + (w === week ? 'border-amber bg-amber text-base' : 'border-line bg-surface text-ink hover:border-sky')}>{fmt.short(w)}<span className="ml-2 text-xs opacity-80">plazo {i + 1}</span></button>)}</div>
        </Card>
        <Card title={region && week ? name + ' · ' + weekLabel(week, shiftDay(week, 7)) : 'Elige un departamento'}>
          {!region ? <Empty>Selecciona un departamento en el filtro superior. No se calcula una probabilidad nacional sumando o promediando los departamentos.</Empty>
            : single.error ? <Unavailable>{failure(single.error)} <button className="ml-2 text-sky underline" onClick={single.retry}>Reintentar</button></Unavailable>
            : single.loading || !row ? <Loading label="Consultando la actividad estimada…" />
            : single.data?.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>La emisión cambió durante la consulta. <button className="text-sky underline" onClick={metaQ.retry}>Actualizar emisión</button></Unavailable>
            : <Result row={row} meta={single.data.metadata} name={name} now={now} />}
        </Card>
        {region && <Card title={'Las ' + weeks.length + ' semanas de ' + name} subtitle="Cada semana tiene su propio porcentaje. La comparación histórica da contexto; no representa un intervalo de confianza ni una alerta.">
          {own.error ? <ErrorBox error={own.error} retry={own.retry} /> : own.loading || ownRows.length === 0 ? <Loading /> : own.data?.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>Actualiza la emisión para comparar resultados de la misma versión.</Unavailable> : <WeeklyChart rows={ownRows} week={week ?? ''} onPick={setPicked} />}
        </Card>}
        <Card title="Comparar departamentos" subtitle="Orden alfabético. Estos porcentajes se refieren a territorios de tamaños distintos; no son un ranking de gravedad ni de daños.">
          {all.error ? <ErrorBox error={all.error} retry={all.retry} /> : all.loading || !all.data ? <Loading />
            : all.data.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>Actualiza la emisión antes de comparar.</Unavailable>
            : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left text-xs text-muted">{week ? weekLabel(week, shiftDay(week, 7)) : ''} · histórico observado en años anteriores</caption>
              <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="py-2 pr-4">Departamento</th><th scope="col" className="pr-4">Estimación</th><th scope="col" className="pr-4">Histórico</th><th scope="col">Diferencia</th></tr></thead>
              <tbody>{comparison.map((r) => { const o = outcome(r); return <tr key={r.region_id} className="border-b border-line"><th scope="row" className="py-3 pr-4 text-left font-normal"><button className="text-sky underline" aria-current={r.region_id === region ? 'true' : undefined} onClick={() => setFilters({ region: r.region_id })}>{regionName(r.region_id)}</button></th><td className="whitespace-nowrap pr-4">{o.available ? percent1(o.percent) : 'No disponible'}</td><td className="whitespace-nowrap pr-4">{percent1(r.historical_reference.frequency_percent) ?? 'No disponible'}</td><td className="whitespace-nowrap">{difference1(r.difference_from_historical_frequency_pp)}</td></tr> })}</tbody>
            </table></div>}
        </Card>
        <p className="max-w-[78ch] text-sm text-muted"><a href="#validacion" className="text-sky underline">Explorar registros oficiales y las comprobaciones del proyecto</a>. El contraste histórico aporta contexto, pero no confirma los resultados de una semana futura.</p>
      </div>}
  </>
}
