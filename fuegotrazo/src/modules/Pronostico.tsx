import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchOutlook, fetchRisk, fetchRiskMetadata, type RiskMeta } from '../api'
import { locale, t } from '../i18n'
import { ApiError, outcome, percent1, periodStatus, validity, type RiskRow } from '../lib/forecast'
import { useApp, useAsync } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, PageHeader, shiftDay, tooltipStyle, Unavailable, weekLabel } from '../ui'

const periodLabel = (p: 'futura' | 'en_curso' | 'pasada') => ({ futura: t('Semana futura', 'Future week'), en_curso: t('Semana en curso', 'Current week'), pasada: t('Semana ya terminada', 'Week already over') })[p]
const serviceCode = (code: string): string | undefined => ({
  target_week_not_in_published_outlook: t('Esa semana no forma parte de la emisión publicada.', 'That week is not part of the published issue.'),
  target_week_must_start_on_monday: t('La semana objetivo debe comenzar en lunes.', 'The target week must start on a Monday.'),
  region_not_found: t('El servicio no reconoce ese departamento.', 'The service does not recognize that department.'),
} as Record<string, string>)[code]

/** Turns a failed request into the reason text of the "no disponible" card. */
function failure(e: Error): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return t(`El servicio informó que el pronóstico no está disponible en este momento (503${e.code ? `: ${e.code}` : ''}).`, `The service reported that the forecast is not available at the moment (503${e.code ? `: ${e.code}` : ''}).`)
    if (e.code && serviceCode(e.code)) return serviceCode(e.code)!
    return t(`El servicio respondió con un error (${e.status}${e.code ? `: ${e.code}` : ''}).`, `The service responded with an error (${e.status}${e.code ? `: ${e.code}` : ''}).`)
  }
  return t('No se pudo consultar el servicio de pronósticos. Revisa tu conexión e inténtalo de nuevo.', 'Could not reach the forecast service. Check your connection and try again.')
}

const Chip = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 rounded-md bg-surface px-3 py-1.5 text-xs">
    <span className="text-muted">{label}: </span><span className="text-ink">{children}</span>
  </div>
)

function Explicacion({ meta }: { meta: RiskMeta }) {
  return (
    <details className="group mt-5 rounded-lg bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">{t('Cómo interpretar este porcentaje', 'How to interpret this percentage')}</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
        <li>{t('La etiqueta representa un nuevo episodio detectado por satélite, no necesariamente una ignición física nueva.', 'The label represents a new episode detected by satellite, not necessarily a new physical ignition.')}</li>
        <li>{t('Puede incluir quemas, detecciones tardías o continuación de frentes.', 'It may include burns, late detections or the continuation of fire fronts.')}</li>
        <li>{t('El modelo depende principalmente de región y estacionalidad.', 'The model depends mainly on region and seasonality.')}</li>
        <li>{t('La evaluación mejora frente a climatología en 2025 y 2026, pero empata en 2024.', 'The evaluation improves on climatology in 2025 and 2026, but ties in 2024.')}</li>
        <li>{t('La calibración no mejoró la evaluación conjunta.', 'Calibration did not improve the joint evaluation.')}</li>
        <li>{t('Los porcentajes regionales pueden ser altos porque basta un episodio en cualquier lugar de todo el departamento.', 'Regional percentages can be high because a single episode anywhere in the whole department is enough.')}</li>
        <li>{t('No se ha demostrado la validez prospectiva de estos porcentajes con resultados futuros.', 'The prospective validity of these percentages has not been demonstrated with future results.')}</li>
      </ul>
      <h4 className="mt-4 text-xs font-semibold text-ink">{t('Lo que informa el servicio', 'What the service reports')}</h4>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs text-muted md:grid-cols-2">
        <div><dt>{t('Definición del objetivo (texto original)', 'Target definition (original text)')}</dt><dd className="text-ink">{meta.target_definition}</dd></div>
        <div><dt>{t('Modelo y método', 'Model and method')}</dt><dd className="font-mono text-ink">{meta.selected_model} · {meta.method_version}</dd></div>
        <div><dt>{t('Última detección NRT usada', 'Last NRT detection used')}</dt><dd className="text-ink">{fmt.utc(meta.NRT_last_acquisition_utc)}</dd></div>
        <div><dt>{t('Último día de clima usado', 'Last weather day used')}</dt><dd className="text-ink">{fmt.date(meta.weather_last_source_day)} · {t('un punto interior por departamento, no un promedio del área', 'one interior point per department, not an area average')}</dd></div>
        <div><dt>{t('Intervalos de incertidumbre por pronóstico', 'Uncertainty intervals per forecast')}</dt><dd className="text-ink">{meta.per_forecast_uncertainty_intervals_available ? t('Disponibles', 'Available') : t('No disponibles', 'Not available')}</dd></div>
        <div><dt>{t('Actualización', 'Refresh')}</dt><dd className="text-ink">{meta.automatic_refresh_configured ? t('Automática configurada', 'Automatic refresh configured') : t('Manual: la emisión solo cambia cuando el equipo la regenera', 'Manual: the issue only changes when the team regenerates it')}</dd></div>
      </dl>
      {!!meta.validation_notes?.length && (
        <>
          <h4 className="mt-4 text-xs font-semibold text-ink">{t('Notas de validación del servicio (texto original)', 'Service validation notes (original text)')}</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">{meta.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </details>
  )
}

function Resultado({ meta, row, regionName }: { meta: RiskMeta; row: RiskRow; regionName: string }) {
  const o = outcome(row)
  const pct = o.available ? percent1(o.percent, locale()) : null
  const status = row.target_period_status ?? periodLabel(periodStatus(row.target_week_start, row.target_week_end_exclusive))
  if (!o.available || !pct) {
    return <Unavailable reasons={o.available ? [] : o.reasons}>{t(`El servicio no entregó una probabilidad para ${regionName} en la semana ${weekLabel(row.target_week_start, row.target_week_end_exclusive)}.`, `The service did not deliver a probability for ${regionName} for the week ${weekLabel(row.target_week_start, row.target_week_end_exclusive)}.`)}</Unavailable>
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-amber px-3 py-1.5 text-xs font-semibold text-base">Experimental</span>
        <Chip label={t('Región', 'Region')}>{regionName}</Chip>
        <Chip label={t('Semana', 'Week')}>{weekLabel(row.target_week_start, row.target_week_end_exclusive)} · {t('lunes a domingo, hora de Lima', 'Monday to Sunday, Lima time')}</Chip>
        <Chip label={t('Plazo', 'Lead time')}>{t(`semana ${row.lead_weeks} de ${meta.lead_weeks.length}: esa semana concreta, no un riesgo acumulado`, `week ${row.lead_weeks} of ${meta.lead_weeks.length}: that specific week, not a cumulative risk`)}</Chip>
        <Chip label={t('Emisión', 'Issued')}>{fmt.lima(row.issued_at)}</Chip>
        <Chip label={t('Vigente hasta', 'Valid until')}>{fmt.lima(meta.valid_until)}</Chip>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,15rem)_1fr] md:items-center">
        <div className="rounded-lg bg-surface px-5 py-4">
          <div className="text-xs text-muted">{t('Probabilidad estimada de un nuevo episodio detectado', 'Estimated probability of a newly detected episode')}</div>
          <div className="mt-1 font-mono text-4xl font-medium" aria-label={`${t('Probabilidad estimada', 'Estimated probability')}: ${pct}`}>{pct}</div>
        </div>
        <div className="max-w-[70ch] space-y-2 text-sm">
          <p>{t('El modelo estima la posibilidad de detectar al menos un nuevo episodio de fuego en cualquier lugar de esta región durante la semana seleccionada.', 'The model estimates the chance of detecting at least one new fire episode anywhere in this region during the selected week.')}</p>
          <p className="text-muted">{t('No indica cuánto territorio se quemará, la gravedad del evento ni su ubicación exacta. La ignición física todavía no ha sido verificada.', 'It does not indicate how much territory will burn, the severity of the event or its exact location. Physical ignition has not yet been verified.')}</p>
          <p className="text-xs text-muted">{t('Calidad', 'Quality')}: {row.quality_status === 'experimental' ? t('experimental', 'experimental') : row.quality_status} · {t('Estimación', 'Estimate')}: {row.estimation_status === 'estimated' ? t('estimada', 'estimated') : row.estimation_status} · {status}</p>
        </div>
      </div>
      {!!row.features_outside_region_training_range?.length && (
        <p className="mt-4 rounded-md border border-line px-3 py-2 text-xs text-muted">
          {t('Variables de entrada fuera del rango visto en el entrenamiento de esta región', 'Input variables outside the range seen in this region\'s training')}: <span className="font-mono text-ink">{row.features_outside_region_training_range.join(', ')}</span>. {t('En esos casos el modelo extrapola.', 'In those cases the model extrapolates.')}
        </p>
      )}
      <Explicacion meta={meta} />
    </>
  )
}

function Serie({ region, rows, week, onPick }: { region: string; rows: RiskRow[]; week: string; onPick: (w: string) => void }) {
  const data = [...rows].sort((a, b) => a.lead_weeks - b.lead_weeks).map((r) => ({
    w: r.target_week_start, label: fmt.short(r.target_week_start), lead: r.lead_weeks, end: r.target_week_end_exclusive, p: outcome(r).available ? r.probability_percent : null,
  }))
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ right: 12 }} aria-label={`${t('Probabilidad por semana, región', 'Probability per week, region')} ${region}`}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v} %`} width={48} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }}
          labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `${t('Plazo', 'Lead time')} ${d.lead} · ${weekLabel(d.w, d.end)}` : '' }}
          formatter={(v) => (v == null ? t('No disponible', 'Not available') : percent1(v as number, locale()))} />
        <Bar isAnimationActive={false} dataKey="p" name={t('Probabilidad estimada', 'Estimated probability')} radius={[3, 3, 0, 0]} onClick={(d) => onPick((d as unknown as { w: string }).w)} style={{ cursor: 'pointer' }}>
          {data.map((d) => <Cell key={d.w} fill={d.w === week ? '#FBBF24' : '#3A6E9E'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function Pronostico() {
  const { filters, setFilters, regionName } = useApp()
  const region = filters.region
  const metaQ = useAsync(fetchRiskMetadata, [])
  const meta = metaQ.data
  const valid = meta ? validity(meta) : null
  const usable = !!meta && !!valid?.ok
  const weeks = meta?.available_target_weeks ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const week = picked && weeks.includes(picked) ? picked : weeks[0] ?? null // only weeks the service offers

  const single = useAsync((s) => (usable && region && week ? fetchRisk(region, week, s) : Promise.resolve(null)), [usable, region, week])
  const own = useAsync((s) => (usable && region ? fetchOutlook(region, s) : Promise.resolve(null)), [usable, region])
  const all = useAsync((s) => (usable ? fetchOutlook(null, s) : Promise.resolve(null)), [usable])

  const ranking = useMemo(() => (all.data?.data ?? []).filter((r) => r.target_week_start === week)
    .map((r) => ({ r, o: outcome(r) })).sort((a, b) => (b.o.available ? b.o.percent : -1) - (a.o.available ? a.o.percent : -1)), [all.data, week])
  const name = regionName(region)

  return (
    <>
      <PageHeader title={t('Pronóstico experimental de nuevos episodios de fuego', 'Experimental forecast of new fire episodes')}
        subtitle={t('Probabilidad regional, semana por semana, de un nuevo episodio de fuego detectado por satélite. Servicio independiente de las series y de los eventos; la actualización es manual.', 'Regional probability, week by week, of a new satellite-detected fire episode. A service independent of the series and the events; the refresh is manual.')} />
      {metaQ.error ? <Unavailable>{failure(metaQ.error)} <button className="ml-2 underline" onClick={metaQ.retry}>{t('Reintentar', 'Retry')}</button></Unavailable>
        : metaQ.loading || !meta ? <Loading label={t('Consultando la emisión vigente…', 'Fetching the current issue…')} />
        : !valid?.ok ? (
          <Unavailable>
            {valid?.reason === 'expired' ? <>{t('La emisión venció el', 'The issue expired on')} {fmt.lima(meta.valid_until)}. {t('No se conserva un pronóstico vencido ni se calcula uno alternativo; hace falta una nueva emisión del servicio.', 'An expired forecast is not kept and no alternative is computed; a new issue from the service is required.')}</>
              : valid?.reason === 'refresh_required' ? <>{t('El servicio indica que esta emisión necesita regenerarse (refresh_required). Hasta entonces no se muestran porcentajes.', 'The service indicates that this issue needs to be regenerated (refresh_required). Until then no percentages are shown.')}</>
              : <>{t('La emisión no informa una fecha de vigencia válida, así que no se puede confirmar que esté vigente.', 'The issue does not report a valid expiry date, so it cannot be confirmed as current.')}</>}
          </Unavailable>
        ) : (
          <div className="space-y-5">
            <Card title={t('Semana objetivo', 'Target week')}
              subtitle={t(`Solo las ${weeks.length} semanas que ofrece la emisión del ${fmt.lima(meta.issued_at)}. Cada fecha es el lunes de una semana completa en hora de Lima y el plazo 12 es esa semana, no el riesgo de doce semanas.`, `Only the ${weeks.length} weeks offered by the issue of ${fmt.lima(meta.issued_at)}. Each date is the Monday of a full week in Lima time, and lead time 12 is that week, not the risk over twelve weeks.`)}>
              <div role="group" aria-label={t('Semana objetivo', 'Target week')} className="flex flex-wrap gap-2">
                {weeks.map((w, i) => (
                  <button key={w} aria-pressed={w === week} onClick={() => setPicked(w)}
                    className={`rounded-md px-3 py-1.5 text-xs ${w === week ? 'bg-amber font-semibold text-base' : 'bg-surface text-muted hover:text-ink'}`}>
                    <span className="font-mono">{fmt.short(w)}</span><span className="ml-1.5 opacity-70">{t('plazo', 'lead')} {i + 1}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card title={region ? `${t('Resultado', 'Result')} · ${name}` : t('Resultado por departamento', 'Result by department')}>
              {!region ? <Empty>{t('Elige un departamento en el filtro superior para ver su pronóstico. Abajo puedes comparar todos para la semana seleccionada.', 'Choose a department in the top filter to see its forecast. Below you can compare all of them for the selected week.')}</Empty>
                : single.error ? <Unavailable>{failure(single.error)}</Unavailable>
                : single.loading || !single.data ? <Loading label={t('Consultando el pronóstico…', 'Fetching the forecast…')} />
                : single.data.data[0] ? <Resultado meta={single.data.metadata ?? meta} row={single.data.data[0]} regionName={name} />
                : <Unavailable>{t(`El servicio no devolvió ninguna fila para ${name} en esa semana.`, `The service returned no row for ${name} for that week.`)}</Unavailable>}
            </Card>

            {region && (
              <Card title={t(`Las ${weeks.length} semanas de ${name}`, `The ${weeks.length} weeks of ${name}`)} subtitle={t('Cada barra es una probabilidad distinta para esa semana; no se suman ni forman un riesgo acumulado. Selecciona una barra para cambiar de semana.', 'Each bar is a separate probability for that week; they are not added up nor form a cumulative risk. Select a bar to change week.')}>
                {own.error ? <ErrorBox error={own.error} retry={own.retry} /> : own.loading || !own.data ? <Loading /> : <Serie region={name} rows={own.data.data} week={week ?? ''} onPick={setPicked} />}
              </Card>
            )}

            <Card title={t('Departamentos para la semana seleccionada', 'Departments for the selected week')}
              subtitle={`${week ? weekLabel(week, shiftDay(week, 7)) : ''}. ${t('Cada porcentaje se refiere a todo el departamento: no señala un punto del territorio ni mide gravedad, y no es comparable en tamaño de área.', 'Each percentage refers to the whole department: it does not point to a place in the territory nor measure severity, and it is not comparable by area size.')}`}>
              {all.error ? <ErrorBox error={all.error} retry={all.retry} /> : all.loading || !all.data ? <Loading /> : ranking.length === 0 ? <Empty>{t('Sin filas para esta semana.', 'No rows for this week.')}</Empty> : (
                <ol className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
                  {ranking.map(({ r, o }) => (
                    <li key={r.region_id}>
                      <button onClick={() => setFilters({ region: r.region_id })} aria-current={r.region_id === region}
                        className={`grid w-full grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-surface ${r.region_id === region ? 'bg-surface' : ''}`}>
                        <span className="truncate">{regionName(r.region_id)}</span>
                        <span className="h-2 rounded-full bg-surface"><span className="block h-2 rounded-full bg-fire" style={{ width: o.available ? `${o.percent}%` : 0 }} /></span>
                        <span className="text-right font-mono text-xs">{o.available ? percent1(o.percent, locale()) : t('No disp.', 'N/A')}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        )}
    </>
  )
}
