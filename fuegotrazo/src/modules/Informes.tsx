import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchOutlook, fetchRiskMetadata } from '../api'
import { fetchEventsMeta, fetchEventsTotal } from '../events'
import { eventDepartment } from '../lib/departments'
import { phases } from '../lib/aggregate'
import { outcome, percent1, validity } from '../lib/forecast'
import { PHASE_META } from '../lib/plan'
import { summarize } from '../lib/summary'
import { useApp, useAsync, useSeries } from '../state'
import { axis, Card, COLORS, downloadCSV, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, MONTHS, MONTHS_LONG, PageHeader, shiftDay, Stat, tooltipStyle, Unavailable, weekLabel } from '../ui'


function Pronostico({ region }: { region: string | null }) {
  const meta = useAsync(fetchRiskMetadata, [])
  const ok = !!meta.data && validity(meta.data).ok
  const out = useAsync((s) => (ok && region ? fetchOutlook(region, s) : Promise.resolve(null)), [ok, region])
  if (!region) return <Empty>El pronóstico es regional: elige un departamento para incluirlo en el informe.</Empty>
  if (meta.loading || out.loading) return <Loading label="Consultando el pronóstico…" />
  if (meta.error || out.error || !meta.data || !ok || !out.data) return <Unavailable>El servicio no respondió o la emisión no está vigente.</Unavailable>
  return (
    <>
      <p className="mb-3 max-w-[80ch] text-sm text-muted">Experimental · emisión {fmt.lima(meta.data.issued_at)} · vigente hasta {fmt.lima(meta.data.valid_until)}. Probabilidad estimada de un nuevo episodio detectado en cualquier lugar del departamento durante cada semana (no acumulada). No indica territorio quemado, gravedad ni ubicación; la ignición física no está verificada.</p>
      <table className="w-full max-w-xl text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">Plazo</th><th className="font-normal">Semana (lunes a domingo, Lima)</th><th className="text-right font-normal">Probabilidad</th></tr></thead>
        <tbody>{[...out.data.data].sort((a, b) => a.lead_weeks - b.lead_weeks).map((r) => { const o = outcome(r); return (
          <tr key={r.target_week_start} className="border-t border-line"><td className="py-1 font-mono">{r.lead_weeks}</td><td>{weekLabel(r.target_week_start, r.target_week_end_exclusive)}</td><td className="text-right font-mono">{o.available ? percent1(o.percent) : 'No disponible'}</td></tr>) })}</tbody>
      </table>
    </>
  )
}

export default function Informes() {
  const { filters, regionName, meta } = useApp()
  const { region, y0, y1, indicator } = filters
  const { months, years, weeks, loading, error, retry } = useSeries(region)
  const S = useMemo(() => summarize(years, months, weeks, indicator, y0, y1), [years, months, weeks, indicator, y0, y1])
  const ph = useMemo(() => phases(S.share), [S.share])
  const territory = regionName(region)
  const annual = years.filter((y) => +y.key >= y0 && +y.key <= y1).map((y) => ({ key: y.key, v: y[indicator] }))
  const season = S.share.map((s, m) => ({ label: MONTHS[m], s, phase: ph[m] }))

  const evMeta = useAsync(fetchEventsMeta, [])
  const tMax = evMeta.data?.t_max.slice(0, 10)
  const evTotal = useAsync((sig) => (tMax ? fetchEventsTotal({ start: shiftDay(tMax, -364), end: tMax, department: eventDepartment(region) }, sig) : Promise.resolve(null)), [tMax, region])

  const csv = () => downloadCSV(`informe_${region ?? 'peru'}_mensual.csv`, months.map((m) => ({
    mes: m.key, semanas: m.weeks, promedio_armonizado: m.combined, modis_armonizado: m.MODIS, viirs_armonizado: m.VIIRS,
    territorio: regionName(region), method_version: meta?.series.method_version, source_snapshot_id: meta?.series.source_snapshot_id,
  })))

  return (
    <>
      <div className="print:hidden"><PageHeader title="Informe territorial" subtitle="Resumen imprimible del territorio elegido con datos reales de las dos APIs. Usa «Imprimir» y elige «Guardar como PDF»." /></div>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button onClick={() => window.print()} className="rounded-md bg-fire px-3 py-1.5 text-xs font-semibold text-base">Imprimir o guardar PDF</button>
        <button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">Serie mensual (CSV)</button>
      </div>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <article className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold">Informe territorial · {territory}</h1>
            <p className="mt-1 text-sm text-muted">Generado el {fmt.date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()))} · periodo {y0}–{y1} · {INDICATOR_LABEL[indicator]}</p>
          </header>

          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total del periodo" value={fmt.n(S.total)} hint={fmt.full(S.total)} />
            <Stat label="Variación vs. periodo anterior" value={S.change == null ? '—' : `${S.change > 0 ? '+' : ''}${fmt.pct(S.change)}`} hint={S.priorStart == null ? 'Sin periodo anterior disponible' : `${S.priorStart}–${y0 - 1}`} />
            <Stat label="Mes de mayor actividad" value={S.peak < 0 ? '—' : MONTHS_LONG[S.peak]} hint={S.peak < 0 ? undefined : `${fmt.pct(S.share[S.peak])} del total anual medio`} />
            <Stat label="Semanas con estimación" value={`${S.estimated} / ${S.weeks}`} hint="Semana sin estimación ≠ cero" />
          </section>

          <Card title="Actividad armonizada por año" subtitle="Datos armonizados de la API de series. No son un número verificado de incendios ni corrigen la cobertura.">
            {annual.length === 0 ? <Empty>Sin datos.</Empty> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={annual} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="key" {...axis} /><YAxis {...axis} tickFormatter={fmt.n} width={48} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => (v == null ? 'sin estimación' : fmt.full(v as number))} />
                  <Bar isAnimationActive={false} dataKey="v" name={INDICATOR_LABEL[indicator]} fill="#3A6E9E" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Estacionalidad y fases" subtitle="Porcentaje de la actividad anual media que cae en cada mes. Color = fase orientativa (temporada alta: al menos 1,5 veces la participación uniforme).">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={season} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={(v) => `${Math.round(v * 100)} %`} width={44} />
                <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v, _n, p) => [fmt.pct(v as number), PHASE_META[(p.payload as { phase: keyof typeof PHASE_META }).phase].label]} />
                <Bar isAnimationActive={false} dataKey="s" name="Participación" radius={[3, 3, 0, 0]}>{season.map((d, i) => <Cell key={i} fill={PHASE_META[d.phase].bg === '#17334D' ? '#3A6E9E' : PHASE_META[d.phase].bg} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Pronóstico experimental de nuevos episodios de fuego"><Pronostico region={region} /></Card>

          <Card title="Eventos históricos" subtitle="De la API de eventos: agrupaciones de detecciones, no incendios confirmados.">
            {evMeta.error || evTotal.error ? <ErrorBox error={(evMeta.error ?? evTotal.error)!} retry={evTotal.retry} />
              : evTotal.loading || evTotal.data == null || !tMax ? <Loading label="Consultando eventos…" />
              : <p className="max-w-[80ch] text-sm">Eventos que coinciden con el último año de cobertura ({fmt.date(shiftDay(tMax, -364))} a {fmt.date(tMax)}, UTC) en {region ? `el departamento (${regionName(region)})` : 'todo el Perú'}: <span className="font-mono">{evTotal.data.toLocaleString('es-PE')}</span>. La cobertura llega hasta el {fmt.date(tMax)}; no son incendios activos hoy.</p>}
          </Card>

          <Card title="Fuentes y límites">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>API de series y pronósticos: método {meta?.series.method_version ?? '—'}, datos hasta {meta ? fmt.date(meta.series.last_week_end) : '—'}, snapshot {meta ? String(meta.series.source_snapshot_id).slice(0, 12) : '—'}…</li>
              <li>API de eventos históricos: procesamiento estándar (SP) de FIRMS; el tipo y la confianza de un evento son del procesamiento, no una confirmación oficial.</li>
              <li>Series: semanas UTC. Eventos: fechas UTC. Pronóstico: semanas en hora de Lima. Cada servicio es independiente y sus fechas no se mezclan.</li>
              <li>Este informe no sustituye los avisos oficiales de SENAMHI e INDECI.</li>
            </ul>
          </Card>
        </article>
      )}
    </>
  )
}
