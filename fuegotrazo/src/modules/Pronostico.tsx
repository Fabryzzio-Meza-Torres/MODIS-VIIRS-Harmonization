import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchOutlook, fetchRisk, fetchRiskMetadata, type RiskMeta } from '../api'
import { ApiError, outcome, percent1, periodStatus, validity, type RiskRow } from '../lib/forecast'
import { useApp, useAsync } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, PageHeader, shiftDay, tooltipStyle, Unavailable, weekLabel } from '../ui'

const PERIOD_LABEL = { futura: 'Semana futura', en_curso: 'Semana en curso', pasada: 'Semana ya terminada' } as const
const SERVICE_CODES: Record<string, string> = {
  target_week_not_in_published_outlook: 'Esa semana no forma parte de la emisión publicada.',
  target_week_must_start_on_monday: 'La semana objetivo debe comenzar en lunes.',
  region_not_found: 'El servicio no reconoce ese departamento.',
}

/** Turns a failed request into the reason text of the "no disponible" card. */
function failure(e: Error): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return `El servicio informó que el pronóstico no está disponible en este momento (503${e.code ? `: ${e.code}` : ''}).`
    if (e.code && SERVICE_CODES[e.code]) return SERVICE_CODES[e.code]
    return `El servicio respondió con un error (${e.status}${e.code ? `: ${e.code}` : ''}).`
  }
  return 'No se pudo consultar el servicio de pronósticos. Revisa tu conexión e inténtalo de nuevo.'
}

const Chip = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0 rounded-md bg-surface px-3 py-1.5 text-xs">
    <span className="text-muted">{label}: </span><span className="text-ink">{children}</span>
  </div>
)

function Explicacion({ meta }: { meta: RiskMeta }) {
  return (
    <details className="group mt-5 rounded-lg bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">Cómo interpretar este porcentaje</summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
        <li>La etiqueta representa un nuevo episodio detectado por satélite, no necesariamente una ignición física nueva.</li>
        <li>Puede incluir quemas, detecciones tardías o continuación de frentes.</li>
        <li>El modelo depende principalmente de región y estacionalidad.</li>
        <li>La evaluación mejora frente a climatología en 2025 y 2026, pero empata en 2024.</li>
        <li>La calibración no mejoró la evaluación conjunta.</li>
        <li>Los porcentajes regionales pueden ser altos porque basta un episodio en cualquier lugar de todo el departamento.</li>
        <li>No se ha demostrado la validez prospectiva de estos porcentajes con resultados futuros.</li>
      </ul>
      <h4 className="mt-4 text-xs font-semibold text-ink">Lo que informa el servicio</h4>
      <dl className="mt-2 grid gap-x-6 gap-y-2 text-xs text-muted md:grid-cols-2">
        <div><dt>Definición del objetivo (texto original)</dt><dd className="text-ink">{meta.target_definition}</dd></div>
        <div><dt>Modelo y método</dt><dd className="font-mono text-ink">{meta.selected_model} · {meta.method_version}</dd></div>
        <div><dt>Última detección NRT usada</dt><dd className="text-ink">{fmt.utc(meta.NRT_last_acquisition_utc)}</dd></div>
        <div><dt>Último día de clima usado</dt><dd className="text-ink">{fmt.date(meta.weather_last_source_day)} · un punto interior por departamento, no un promedio del área</dd></div>
        <div><dt>Intervalos de incertidumbre por pronóstico</dt><dd className="text-ink">{meta.per_forecast_uncertainty_intervals_available ? 'Disponibles' : 'No disponibles'}</dd></div>
        <div><dt>Actualización</dt><dd className="text-ink">{meta.automatic_refresh_configured ? 'Automática configurada' : 'Manual: la emisión solo cambia cuando el equipo la regenera'}</dd></div>
      </dl>
      {!!meta.validation_notes?.length && (
        <>
          <h4 className="mt-4 text-xs font-semibold text-ink">Notas de validación del servicio (texto original)</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted">{meta.validation_notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </details>
  )
}

function Resultado({ meta, row, regionName }: { meta: RiskMeta; row: RiskRow; regionName: string }) {
  const o = outcome(row)
  const pct = o.available ? percent1(o.percent) : null
  const status = row.target_period_status ?? PERIOD_LABEL[periodStatus(row.target_week_start, row.target_week_end_exclusive)]
  if (!o.available || !pct) {
    return <Unavailable reasons={o.available ? [] : o.reasons}>El servicio no entregó una probabilidad para {regionName} en la semana {weekLabel(row.target_week_start, row.target_week_end_exclusive)}.</Unavailable>
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-amber px-3 py-1.5 text-xs font-semibold text-base">Experimental</span>
        <Chip label="Región">{regionName}</Chip>
        <Chip label="Semana">{weekLabel(row.target_week_start, row.target_week_end_exclusive)} · lunes a domingo, hora de Lima</Chip>
        <Chip label="Plazo">semana {row.lead_weeks} de {meta.lead_weeks.length}: esa semana concreta, no un riesgo acumulado</Chip>
        <Chip label="Emisión">{fmt.lima(row.issued_at)}</Chip>
        <Chip label="Vigente hasta">{fmt.lima(meta.valid_until)}</Chip>
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,15rem)_1fr] md:items-center">
        <div className="rounded-lg bg-surface px-5 py-4">
          <div className="text-xs text-muted">Probabilidad estimada de un nuevo episodio detectado</div>
          <div className="mt-1 font-mono text-4xl font-medium" aria-label={`Probabilidad estimada: ${pct}`}>{pct}</div>
        </div>
        <div className="max-w-[70ch] space-y-2 text-sm">
          <p>El modelo estima la posibilidad de detectar al menos un nuevo episodio de fuego en cualquier lugar de esta región durante la semana seleccionada.</p>
          <p className="text-muted">No indica cuánto territorio se quemará, la gravedad del evento ni su ubicación exacta. La ignición física todavía no ha sido verificada.</p>
          <p className="text-xs text-muted">Calidad: {row.quality_status === 'experimental' ? 'experimental' : row.quality_status} · Estimación: {row.estimation_status === 'estimated' ? 'estimada' : row.estimation_status} · {status}</p>
        </div>
      </div>
      {!!row.features_outside_region_training_range?.length && (
        <p className="mt-4 rounded-md border border-line px-3 py-2 text-xs text-muted">
          Variables de entrada fuera del rango visto en el entrenamiento de esta región: <span className="font-mono text-ink">{row.features_outside_region_training_range.join(', ')}</span>. En esos casos el modelo extrapola.
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
      <BarChart data={data} margin={{ right: 12 }} aria-label={`Probabilidad por semana, región ${region}`}>
        <CartesianGrid vertical={false} stroke={COLORS.grid} />
        <XAxis dataKey="label" {...axis} interval={0} angle={-30} textAnchor="end" height={48} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={(v) => `${v} %`} width={48} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }}
          labelFormatter={(_, p) => { const d = p?.[0]?.payload; return d ? `Plazo ${d.lead} · ${weekLabel(d.w, d.end)}` : '' }}
          formatter={(v) => (v == null ? 'No disponible' : percent1(v as number))} />
        <Bar isAnimationActive={false} dataKey="p" name="Probabilidad estimada" radius={[3, 3, 0, 0]} onClick={(d) => onPick((d as unknown as { w: string }).w)} style={{ cursor: 'pointer' }}>
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
      <PageHeader title="Pronóstico experimental de nuevos episodios de fuego"
        subtitle="Probabilidad regional, semana por semana, de un nuevo episodio de fuego detectado por satélite. Servicio independiente de las series y de los eventos; la actualización es manual." />
      {metaQ.error ? <Unavailable>{failure(metaQ.error)} <button className="ml-2 underline" onClick={metaQ.retry}>Reintentar</button></Unavailable>
        : metaQ.loading || !meta ? <Loading label="Consultando la emisión vigente…" />
        : !valid?.ok ? (
          <Unavailable>
            {valid?.reason === 'expired' ? <>La emisión venció el {fmt.lima(meta.valid_until)}. No se conserva un pronóstico vencido ni se calcula uno alternativo; hace falta una nueva emisión del servicio.</>
              : valid?.reason === 'refresh_required' ? <>El servicio indica que esta emisión necesita regenerarse (refresh_required). Hasta entonces no se muestran porcentajes.</>
              : <>La emisión no informa una fecha de vigencia válida, así que no se puede confirmar que esté vigente.</>}
          </Unavailable>
        ) : (
          <div className="space-y-5">
            <Card title="Semana objetivo"
              subtitle={`Solo las ${weeks.length} semanas que ofrece la emisión del ${fmt.lima(meta.issued_at)}. Cada fecha es el lunes de una semana completa en hora de Lima y el plazo 12 es esa semana, no el riesgo de doce semanas.`}>
              <div role="group" aria-label="Semana objetivo" className="flex flex-wrap gap-2">
                {weeks.map((w, i) => (
                  <button key={w} aria-pressed={w === week} onClick={() => setPicked(w)}
                    className={`rounded-md px-3 py-1.5 text-xs ${w === week ? 'bg-amber font-semibold text-base' : 'bg-surface text-muted hover:text-ink'}`}>
                    <span className="font-mono">{fmt.short(w)}</span><span className="ml-1.5 opacity-70">plazo {i + 1}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card title={region ? `Resultado · ${name}` : 'Resultado por departamento'}>
              {!region ? <Empty>Elige un departamento en el filtro superior para ver su pronóstico. Abajo puedes comparar todos para la semana seleccionada.</Empty>
                : single.error ? <Unavailable>{failure(single.error)}</Unavailable>
                : single.loading || !single.data ? <Loading label="Consultando el pronóstico…" />
                : single.data.data[0] ? <Resultado meta={single.data.metadata ?? meta} row={single.data.data[0]} regionName={name} />
                : <Unavailable>El servicio no devolvió ninguna fila para {name} en esa semana.</Unavailable>}
            </Card>

            {region && (
              <Card title={`Las ${weeks.length} semanas de ${name}`} subtitle="Cada barra es una probabilidad distinta para esa semana; no se suman ni forman un riesgo acumulado. Selecciona una barra para cambiar de semana.">
                {own.error ? <ErrorBox error={own.error} retry={own.retry} /> : own.loading || !own.data ? <Loading /> : <Serie region={name} rows={own.data.data} week={week ?? ''} onPick={setPicked} />}
              </Card>
            )}

            <Card title="Departamentos para la semana seleccionada"
              subtitle={`${week ? weekLabel(week, shiftDay(week, 7)) : ''}. Cada porcentaje se refiere a todo el departamento: no señala un punto del territorio ni mide gravedad, y no es comparable en tamaño de área.`}>
              {all.error ? <ErrorBox error={all.error} retry={all.retry} /> : all.loading || !all.data ? <Loading /> : ranking.length === 0 ? <Empty>Sin filas para esta semana.</Empty> : (
                <ol className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
                  {ranking.map(({ r, o }) => (
                    <li key={r.region_id}>
                      <button onClick={() => setFilters({ region: r.region_id })} aria-current={r.region_id === region}
                        className={`grid w-full grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-surface ${r.region_id === region ? 'bg-surface' : ''}`}>
                        <span className="truncate">{regionName(r.region_id)}</span>
                        <span className="h-2 rounded-full bg-surface"><span className="block h-2 rounded-full bg-fire" style={{ width: o.available ? `${o.percent}%` : 0 }} /></span>
                        <span className="text-right font-mono text-xs">{o.available ? percent1(o.percent) : 'No disp.'}</span>
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
