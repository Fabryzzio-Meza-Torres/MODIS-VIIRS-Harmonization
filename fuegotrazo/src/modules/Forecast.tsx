import { t, locale } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchActivity, fetchActivityMetadata, fetchActivityOutlook, type ActivityMeta } from '../api'
import { ApiError, difference1, outcome, percent1, periodStatus, validity, type ActivityRow } from '../lib/forecast'
import { useApp, useAsync } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, PageHeader, shiftDay, tooltipStyle, Unavailable, weekLabel } from '../ui'

function failure(error: Error): string {
  if (error instanceof ApiError && error.status === 503) return t("No hay una emisión vigente disponible. Hace falta que el servicio publique un nuevo pronóstico.", "No current issue is available. The service needs to publish a new forecast.")
  if (error instanceof ApiError && error.status === 404) return t("La región o la semana elegida no forman parte de esta emisión.", "The selected department or week is not part of this issue.")
  return t("No se pudo verificar el pronóstico. Reintenta la consulta; no se mostrará un porcentaje sustituto.", "The forecast could not be verified. Retry the request; no substitute percentage is shown.")
}

function Evaluation({ meta }: { meta: ActivityMeta }) {
  const periods = [...new Set(meta.evaluation.map((r) => r.period))]
  return (
    <details className="mt-5 border-t border-line pt-4 text-sm">
      <summary className="cursor-pointer font-medium">{t("Método, evaluación y límites", "Method, evaluation and limitations")}</summary>
      <div className="mt-4 max-w-[80ch] space-y-4 text-muted">
        <p>{t("El objetivo es al menos una detección elegible de NOAA-20 en todo el departamento durante siete días. El archivo histórico usa procesamiento estándar, tipo inferido 0 (presunto fuego de vegetación) y confianza nominal o alta. No es una verificación de incendios forestales.", "The target is at least one eligible NOAA-20 detection anywhere in the department during seven days. The historical archive uses standard processing, inferred type 0 (presumed vegetation fire) and nominal or high confidence. This does not verify wildfires.")}</p>
        <p>{t("El modelo se ajustó con 2018–2021, se seleccionó en 2022 y se calibró en 2023. Los resultados siguientes son retrospectivos: estos años ya se habían examinado en el proyecto. Aún falta comprobar el desempeño con semanas futuras.", "The model was fitted on 2018–2021, selected on 2022 and calibrated on 2023. These results are retrospective: these years had already been examined in the project. Performance on future weeks still needs to be checked.")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-2 text-left">{t("Error Brier · menor es mejor; no es un porcentaje de acierto", "Brier score · lower is better; this is not percentage accuracy")}</caption>
            <thead><tr className="border-b border-line text-ink"><th scope="col" className="py-2 pr-4">{t("Periodo", "Period")}</th><th scope="col" className="pr-4">{t("Modelo", "Model")}</th><th scope="col">{t("Climatología", "Climatology")}</th></tr></thead>
            <tbody>{periods.map((period) => {
              const model = meta.evaluation.find((r) => r.period === period && r.model === meta.selected_model)
              const baseline = meta.evaluation.find((r) => r.period === period && r.model === 'climatology')
              return <tr key={period} className="border-b border-line"><th scope="row" className="py-2 pr-4 font-normal">{period.includes('2026') ? t("2026 · enero–julio", "2026 · January–July") : period}</th><td className="pr-4">{model?.brier.toFixed(4) ?? t("No disponible", "Unavailable")}</td><td>{baseline?.brier.toFixed(4) ?? t("No disponible", "Unavailable")}</td></tr>
            })}</tbody>
          </table>
        </div>
        <p>{meta.calibration.observed_pooled_brier_improved ? t("Se evaluó una calibración por plazo, ajustada en 2023.", "Per-horizon calibration, fitted on 2023, was evaluated.") : t("La calibración no redujo el error Brier conjunto de 2024–2025.", "Calibration did not reduce pooled 2024–2025 Brier score.")}{t(' No se ha demostrado que cada porcentaje futuro exacto sea fiable.', ' The reliability of each exact future percentage has not been demonstrated.')}</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>{t("La detección puede incluir quemas agrícolas y anomalías mal clasificadas. No mide daños, superficie quemada ni el inicio físico de un incendio.", "Detections may include agricultural burning and misclassified anomalies. They do not measure damage, burned area or physical ignition.")}</li>
          <li>{t("La cobertura de observación no está corregida por completo: nubes y horarios de paso pueden impedir detectar fuego.", "Observation coverage is not fully corrected: clouds and overpass times can prevent fire detection.")}</li>
          <li>{t("Las señales recientes NRT no incluyen un tipo de fuego confirmado; su transferencia al modelo entrenado con el archivo estándar aún no está validada.", "Recent NRT signals do not include a confirmed fire type; transfer to the model trained on the standard archive is not yet validated.")}</li>
          <li>{t("La meteorología representa un punto por departamento, no un promedio del territorio. Las semanas lejanas reflejan principalmente región y estación; no se usa un pronóstico meteorológico diario a 12 semanas.", "Weather represents one point per department, rather than a territorial average. Distant weeks mainly reflect location and season; no daily weather forecast extending 12 weeks is used.")}</li>
          <li>{t("La frecuencia histórica es descriptiva. La diferencia en puntos porcentuales no es una alerta ni una prueba de significación estadística.", "Historical frequency is descriptive. The difference in percentage points is neither an alert nor a statistical significance test.")}</li>
        </ul>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div><dt>{t("Método", "Method")}</dt><dd className="break-all text-ink">{meta.method_version}</dd></div>
          <div><dt>{t("Última adquisición NRT", "Latest NRT acquisition")}</dt><dd className="text-ink">{fmt.lima(meta.NRT_last_acquisition_utc)}</dd></div>
          <div><dt>{t("Día meteorológico utilizado", "Weather day used")}</dt><dd className="text-ink">{meta.weather_value_days_used.map((d) => fmt.date(d)).join(', ')}</dd></div>
          <div><dt>{t("Actualización e incertidumbre", "Updates and uncertainty")}</dt><dd className="text-ink">{t("Actualización manual; sin intervalos de incertidumbre individuales.", "Manual updates; no individual uncertainty intervals.")}</dd></div>
        </dl>
        <p className="flex flex-wrap gap-x-4 gap-y-2">{meta.scientific_sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-sky underline">{source.title.includes('limitations') ? t("Límites de FIRMS · NASA", "FIRMS limitations · NASA") : t("Producto VIIRS · NASA", "VIIRS product · NASA")}</a>)}<a href="#validacion" className="text-sky underline">{t("Validación y fuentes del proyecto", "Project validation and sources")}</a></p>
      </div>
    </details>
  )
}

function Result({ row, meta, name, now }: { row: ActivityRow; meta: ActivityMeta; name: string; now: number }) {
  const value = outcome(row)
  if (!value.available) return <Unavailable reasons={value.reasons}>{t("No hay una estimación respaldada para esta región y semana.", "No supported estimate is available for this department and week.")}</Unavailable>
  const history = row.historical_reference
  const period = periodStatus(row.target_week_start, row.target_week_end_exclusive, now)
  const periodLabel = { futura: t("Semana futura", "Future week"), en_curso: t("Semana en curso · pronóstico emitido previamente", "Current week · previously issued forecast"), pasada: t("Semana terminada · pronóstico emitido previamente", "Past week · previously issued forecast") }[period]
  return <>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-md bg-amber px-2.5 py-1 font-semibold text-base">Experimental</span>
      <span className="text-muted">{periodLabel}</span>
    </div>
    <p className="mt-3 max-w-[72ch] text-sm">{t(meta.ui.explanation_es, 'Estimated probability of at least one eligible satellite detection compatible with fire anywhere in this department during the selected week. This is not the probability of a verified physical ignition. No province or point probability is available.')}</p>
    <dl className="mt-5 grid gap-5 border-y border-line py-5 sm:grid-cols-3">
      <div><dt className="text-xs text-muted">{t("Estimación para esta semana", "Estimate for this week")}</dt><dd className="mt-1 text-3xl font-semibold tabular-nums" data-testid="activity-probability">{percent1(value.percent, locale())}</dd></div>
      <div><dt className="text-xs text-muted">{t("Frecuencia histórica comparable", "Comparable historical frequency")}</dt><dd className="mt-1 text-2xl tabular-nums">{percent1(history.frequency_percent, locale()) ?? t("No disponible", "Unavailable")}</dd><p className="mt-1 text-xs text-muted">{history.positive_weeks} {t('de', 'of')} {history.total_weeks} {t('semanas con registro', 'weeks with a record')}</p></div>
      <div><dt className="text-xs text-muted">{t("Diferencia frente al histórico", "Difference from historical frequency")}</dt><dd className="mt-1 text-2xl tabular-nums">{difference1(row.difference_from_historical_frequency_pp, locale())}</dd><p className="mt-1 text-xs text-muted">{t("pp = puntos porcentuales; no mide gravedad", "pp = percentage points; this does not measure severity")}</p></div>
    </dl>
    <p className="mt-3 max-w-[78ch] text-sm text-muted">{t('Basta una detección en cualquier lugar de ', 'One detection anywhere in ')}{name}{t(' para que la semana tenga actividad registrada. Por eso un porcentaje alto puede ser habitual en un departamento grande; no significa que esa proporción del territorio vaya a arder.', ' is enough for the week to have recorded activity. A high percentage can therefore be common in a large department; it does not mean that proportion of its territory will burn.')}</p>
    <p className="mt-3 text-xs text-muted">{t('Histórico: ', 'Historical reference: ')}{history.years.length ? history.years[0] + '–' + history.years[history.years.length - 1] : t('sin años comparables', 'no comparable years')}{t(', semanas cerradas de años anteriores a ±', ', completed weeks from earlier years within ±')}{history.seasonal_half_window_days}{t(' días de esta época. Es una frecuencia observada, sin corrección completa de cobertura.', ' seasonal days of this time of year. This is an observed frequency without complete coverage correction.')}</p>
    {!!row.features_outside_region_training_range.length && <p className="mt-4 rounded-md border border-line p-3 text-sm text-muted">{t('Algunas variables recientes están fuera del rango visto en el entrenamiento de ', 'Some recent variables fall outside the training range for ')}{name}{t('. La estimación requiere especial cautela.', '. Interpret the estimate with particular caution.')}</p>}
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
      <span>{t("Emisión:", "Issued:")}{fmt.lima(row.issued_at)}</span><span>{t("Vigente hasta:", "Valid until:")}{fmt.lima(meta.valid_until)}</span>
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
    <p className="mb-3 text-xs text-muted">{t("Barras: estimación del modelo · línea: frecuencia histórica comparable", "Bars: model estimate · line: comparable historical frequency")}</p>
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ right: 12 }} aria-label={t('Probabilidad y frecuencia histórica por semana', 'Weekly probability and historical frequency')}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis {...axis} domain={[0, 100]} width={48} tickFormatter={(v) => String(v) + ' %'} />
        <Tooltip {...tooltipStyle} labelFormatter={(_, payload) => { const row = payload?.[0]?.payload; return row ? weekLabel(row.week, row.end) : '' }} formatter={(v) => percent1(v as number, locale()) ?? t("No disponible", "Unavailable")} />
        <Bar dataKey="probability" name={t("Modelo", "Model")} isAnimationActive={false} radius={[3, 3, 0, 0]} onClick={(r) => onPick((r as unknown as { week: string }).week)} style={{ cursor: 'pointer' }}>
          {data.map((r) => <Cell key={r.week} fill={r.week === week ? '#FBBF24' : '#3A6E9E'} />)}
        </Bar>
        <Line dataKey="historical" name={t("Histórico", "Historical")} type="linear" stroke="#94A8BD" strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
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
    <PageHeader title={t("Probabilidad de actividad de fuego detectada", "Probability of detected fire activity")} subtitle={t('Estimación semanal para todo un departamento, con una referencia histórica de la misma época. Un indicador experimental de registros satelitales, no una alerta oficial.', 'Weekly estimate for a whole department, beside a historical reference for the same season. An experimental indicator of satellite records, not an official alert.')} />
    {filters.province && <p className="mb-4 rounded-md border border-line p-3 text-sm text-muted">{t("La selección provincial no modifica este cálculo. El pronóstico corresponde a todo el departamento; todavía no hay un modelo por provincia o punto.", "The province selection does not change this calculation. The forecast covers the whole department; a province or point model is not available.")}</p>}
    {metaQ.error ? <Unavailable>{failure(metaQ.error)} <button className="ml-2 text-sky underline" onClick={metaQ.retry}>{t("Reintentar", "Retry")}</button></Unavailable>
      : metaQ.loading || !meta ? <Loading label={t("Verificando la emisión y su alcance…", "Checking the issue and its scope…")} />
      : !valid?.ok ? <Unavailable>{t("La emisión ya no está vigente o requiere actualización. Hasta publicar una nueva no se muestran porcentajes.", "This issue has expired or requires an update. Percentages remain unavailable until a new issue is published.")}<button className="ml-2 text-sky underline" onClick={metaQ.retry}>{t("Consultar de nuevo", "Check again")}</button></Unavailable>
      : <div className="space-y-5">
        <Card title={t("Semana que quieres consultar", "Choose a target week")} subtitle={t("Cada opción es una semana completa, de lunes a domingo en hora de Lima. El plazo 12 es una semana concreta, no una probabilidad acumulada.", "Each option is a complete Monday-to-Sunday week in Lima time. Horizon 12 is one specific week, not a cumulative probability.")}>
          <div className="flex flex-wrap gap-2">{weeks.map((w, i) => <button key={w} aria-pressed={w === week} onClick={() => setPicked(w)} className={'rounded-md border px-3 py-2 text-sm ' + (w === week ? 'border-amber bg-amber text-base' : 'border-line bg-surface text-ink hover:border-sky')}>{fmt.short(w)}<span className="ml-2 text-xs opacity-80">{t("plazo", "lead")}{i + 1}</span></button>)}</div>
        </Card>
        <Card title={region && week ? name + ' · ' + weekLabel(week, shiftDay(week, 7)) : t("Elige un departamento", "Choose a department")}>
          {!region ? <Empty>{t("Selecciona un departamento en el filtro superior. No se calcula una probabilidad nacional sumando o promediando los departamentos.", "Select a department in the top filter. Department probabilities cannot be summed or averaged into a national probability.")}</Empty>
            : single.error ? <Unavailable>{failure(single.error)} <button className="ml-2 text-sky underline" onClick={single.retry}>{t("Reintentar", "Retry")}</button></Unavailable>
            : single.loading || !row ? <Loading label={t("Consultando la actividad estimada…", "Loading estimated activity…")} />
            : single.data?.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>{t("La emisión cambió durante la consulta.", "The issue changed during this request.")}<button className="text-sky underline" onClick={metaQ.retry}>{t("Actualizar emisión", "Refresh issue")}</button></Unavailable>
            : <Result row={row} meta={single.data.metadata} name={name} now={now} />}
        </Card>
        {region && <Card title={t('Las ', '') + weeks.length + t(' semanas de ', ' weeks for ') + name} subtitle={t("Cada semana tiene su propio porcentaje. La comparación histórica da contexto; no representa un intervalo de confianza ni una alerta.", "Each week has its own percentage. Historical frequency provides context; it is not a confidence interval or an alert.")}>
          {own.error ? <ErrorBox error={own.error} retry={own.retry} /> : own.loading || ownRows.length === 0 ? <Loading /> : own.data?.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>{t("Actualiza la emisión para comparar resultados de la misma versión.", "Refresh the issue to compare results from the same version.")}</Unavailable> : <WeeklyChart rows={ownRows} week={week ?? ''} onPick={setPicked} />}
        </Card>}
        <Card title={t("Comparar departamentos", "Compare departments")} subtitle={t("Orden alfabético. Estos porcentajes se refieren a territorios de tamaños distintos; no son un ranking de gravedad ni de daños.", "Alphabetical order. These percentages cover territories of different sizes; they do not rank severity or damage.")}>
          {all.error ? <ErrorBox error={all.error} retry={all.retry} /> : all.loading || !all.data ? <Loading />
            : all.data.metadata.snapshot_id !== meta.snapshot_id ? <Unavailable>{t("Actualiza la emisión antes de comparar.", "Refresh the issue before comparing.")}</Unavailable>
            : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left text-xs text-muted">{week ? weekLabel(week, shiftDay(week, 7)) : ''}{t(' · histórico observado en años anteriores', ' · historical observations from earlier years')}</caption>
              <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="py-2 pr-4">{t("Departamento", "Department")}</th><th scope="col" className="pr-4">{t("Estimación", "Estimate")}</th><th scope="col" className="pr-4">{t("Histórico", "Historical")}</th><th scope="col">{t("Diferencia", "Difference")}</th></tr></thead>
              <tbody>{comparison.map((r) => { const o = outcome(r); return <tr key={r.region_id} className="border-b border-line"><th scope="row" className="py-3 pr-4 text-left font-normal"><button className="text-sky underline" aria-current={r.region_id === region ? 'true' : undefined} onClick={() => setFilters({ region: r.region_id })}>{regionName(r.region_id)}</button></th><td className="whitespace-nowrap pr-4">{o.available ? percent1(o.percent, locale()) : t("No disponible", "Unavailable")}</td><td className="whitespace-nowrap pr-4">{percent1(r.historical_reference.frequency_percent, locale()) ?? t("No disponible", "Unavailable")}</td><td className="whitespace-nowrap">{difference1(r.difference_from_historical_frequency_pp, locale())}</td></tr> })}</tbody>
            </table></div>}
        </Card>
        <p className="max-w-[78ch] text-sm text-muted"><a href="#validacion" className="text-sky underline">{t("Explorar registros oficiales y las comprobaciones del proyecto", "Explore official records and project checks")}</a>{t(". El contraste histórico aporta contexto, pero no confirma los resultados de una semana futura.", ". The historical comparison provides context, but does not confirm the outcome of a future week.")}</p>
      </div>}
  </>
}
