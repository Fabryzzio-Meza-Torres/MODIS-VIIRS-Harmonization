import { t, locale, getLang } from '../i18n'
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchActivityOutlook, fetchActivityMetadata } from '../api'
import { fetchEventsMeta, fetchEventsTotal } from '../events'
import { eventDepartment } from '../lib/departments'
import { phases } from '../lib/aggregate'
import { outcome, percent1, validity } from '../lib/forecast'
import { phaseText, PHASE_META } from '../lib/plan'
import { summarize } from '../lib/summary'
import { useApp, useAsync, useSeries } from '../state'
import { axis, Card, COLORS, downloadCSV, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, monthShort, monthLong, PageHeader, shiftDay, Stat, tooltipStyle, Unavailable, weekLabel } from '../ui'


function Pronostico({ region }: { region: string | null }) {
  const meta = useAsync(fetchActivityMetadata, [])
  const ok = !!meta.data && validity(meta.data).ok
  const out = useAsync((s) => (ok && region ? fetchActivityOutlook(region, s) : Promise.resolve(null)), [ok, region])
  if (!region) return <Empty>{t("El pronóstico es regional: elige un departamento para incluirlo en el informe.", "The forecast is regional: choose a department to include it in the report.")}</Empty>
  if (meta.loading || out.loading) return <Loading label={t('Consultando el pronóstico…', 'Loading the forecast…')} />
  if (meta.error || out.error || !meta.data || !ok || !out.data) return <Unavailable>{t("El servicio no respondió o la emisión no está vigente.", "The service did not respond or the issue is no longer current.")}</Unavailable>
  return (
    <>
      <p className="mb-3 max-w-[80ch] text-sm text-muted">{t('Experimental · emisión ', 'Experimental · issued ')}{fmt.lima(meta.data.issued_at)}{t(' · vigente hasta ', ' · valid until ')}{fmt.lima(meta.data.valid_until)}{t(". Probabilidad estimada de al menos una detección compatible con fuego en cualquier lugar del departamento durante cada semana (no acumulada). No indica territorio quemado, gravedad ni ubicación; no se estima una ignición física confirmada.", ". Estimated probability of at least one detection compatible with fire anywhere in the department during each week (not cumulative). It does not indicate burned area, severity or location; it does not estimate a confirmed physical ignition.")}</p>
      <table className="w-full max-w-xl text-sm">
        <thead className="text-left text-xs text-muted"><tr><th className="py-1 font-normal">{t('Plazo', 'Lead time')}</th><th className="font-normal">{t('Semana (lunes a domingo, Lima)', 'Week (Monday to Sunday, Lima)')}</th><th className="text-right font-normal">{t('Probabilidad', 'Probability')}</th></tr></thead>
        <tbody>{[...out.data.data].sort((a, b) => a.lead_weeks - b.lead_weeks).map((r) => { const o = outcome(r); return (
          <tr key={r.target_week_start} className="border-t border-line"><td className="py-1 font-mono">{r.lead_weeks}</td><td>{weekLabel(r.target_week_start, r.target_week_end_exclusive)}</td><td className="text-right font-mono">{o.available ? percent1(o.percent, locale()) : t('No disponible', 'Not available')}</td></tr>) })}</tbody>
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
  const season = S.share.map((s, m) => ({ label: monthShort()[m], s, phase: ph[m] }))

  const evMeta = useAsync(fetchEventsMeta, [])
  const tMax = evMeta.data?.t_max.slice(0, 10)
  const evTotal = useAsync((sig) => (tMax ? fetchEventsTotal({ start: shiftDay(tMax, -364), end: tMax, department: eventDepartment(region) }, sig) : Promise.resolve(null)), [tMax, region])

  const csv = () => downloadCSV(`${t('informe', 'report')}_${region ?? 'peru'}_${t('mensual', 'monthly')}.csv`, months.map((m) => ({
    month: m.key, weeks: m.weeks, harmonized_average: m.combined, modis_harmonized: m.MODIS, viirs_harmonized: m.VIIRS,
    territory: regionName(region), method_version: meta?.series.method_version, source_snapshot_id: meta?.series.source_snapshot_id,
  })))

  return (
    <>
      <div className="print:hidden"><PageHeader title={t('Informe territorial', 'Territorial report')} subtitle={t('Resumen imprimible del territorio elegido con datos reales de las dos APIs. Usa «Imprimir» y elige «Guardar como PDF».', 'Printable summary of the chosen territory with real data from both APIs. Use “Print” and choose “Save as PDF”.')} /></div>
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button onClick={() => window.print()} className="rounded-md bg-fire px-3 py-1.5 text-xs font-semibold text-base">{t('Imprimir o guardar PDF', 'Print or save as PDF')}</button>
        <button onClick={csv} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('Serie mensual (CSV)', 'Monthly series (CSV)')}</button>
      </div>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <article className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold">{t('Informe territorial', 'Territorial report')} · {territory}</h1>
            <p className="mt-1 text-sm text-muted">{t('Generado el', 'Generated on')} {fmt.date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()))} · {t('periodo', 'period')} {y0}–{y1} · {INDICATOR_LABEL[indicator]}</p>
          </header>

          <section aria-label={t('Resumen', 'Summary')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('Total del periodo', 'Period total')} value={fmt.n(S.total)} hint={fmt.full(S.total)} />
            <Stat label={t('Variación vs. periodo anterior', 'Change vs. previous period')} value={S.change == null ? '—' : `${S.change > 0 ? '+' : ''}${fmt.pct(S.change)}`} hint={S.priorStart == null ? t('Sin periodo anterior disponible', 'No previous period available') : `${S.priorStart}–${y0 - 1}`} />
            <Stat label={t('Mes de mayor actividad', 'Most active month')} value={S.peak < 0 ? '—' : monthLong()[S.peak]} hint={S.peak < 0 ? undefined : `${fmt.pct(S.share[S.peak])} ${t('del total anual medio', 'of the mean annual total')}`} />
            <Stat label={t('Semanas con estimación', 'Weeks with an estimate')} value={`${S.estimated} / ${S.weeks}`} hint={t('Semana sin estimación ≠ cero', 'A week without an estimate ≠ zero')} />
          </section>

          <Card title={t('Actividad armonizada por año', 'Harmonized activity per year')} subtitle={t('Datos armonizados de la API de series. No son un número verificado de incendios ni corrigen la cobertura.', 'Harmonized data from the series API. They are not a verified number of fires and do not correct for coverage.')}>
            {annual.length === 0 ? <Empty>{t('Sin datos.', 'No data.')}</Empty> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={annual} margin={{ right: 12 }}>
                  <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="key" {...axis} /><YAxis {...axis} tickFormatter={fmt.n} width={48} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => (v == null ? t('sin estimación', 'no estimate') : fmt.full(v as number))} />
                  <Bar isAnimationActive={false} dataKey="v" name={INDICATOR_LABEL[indicator]} fill="#3A6E9E" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title={t('Estacionalidad y fases', 'Seasonality and phases')} subtitle={t('Porcentaje de la actividad anual media que cae en cada mes. Color = fase orientativa (temporada alta: al menos 1,5 veces la participación uniforme).', 'Percentage of the mean annual activity that falls in each month. Color = indicative phase (high season: at least 1.5 times the uniform share).')}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={season} margin={{ right: 12 }}>
                <CartesianGrid vertical={false} stroke={COLORS.grid} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={(v) => `${Math.round(v * 100)} %`} width={44} />
                <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v, _n, p) => [fmt.pct(v as number), phaseText((p.payload as { phase: keyof typeof PHASE_META }).phase, getLang()).label]} />
                <Bar isAnimationActive={false} dataKey="s" name={t('Participación', 'Share')} radius={[3, 3, 0, 0]}>{season.map((d, i) => <Cell key={i} fill={PHASE_META[d.phase].bg === '#17334D' ? '#3A6E9E' : PHASE_META[d.phase].bg} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title={t('Pronóstico experimental de nuevos episodios de fuego', 'Experimental forecast of new fire episodes')}><Pronostico region={region} /></Card>

          <Card title={t('Eventos históricos', 'Historical events')} subtitle={t('De la API de eventos: agrupaciones de detecciones, no incendios confirmados.', 'From the events API: groupings of detections, not confirmed fires.')}>
            {evMeta.error || evTotal.error ? <ErrorBox error={(evMeta.error ?? evTotal.error)!} retry={evTotal.retry} />
              : evTotal.loading || evTotal.data == null || !tMax ? <Loading label={t('Consultando eventos…', 'Querying events…')} />
              : <p className="max-w-[80ch] text-sm">{t('Eventos que coinciden con el último año de cobertura', 'Events matching the last year of coverage')} ({fmt.date(shiftDay(tMax, -364))} {t('a', 'to')} {fmt.date(tMax)}, UTC) {t('en', 'in')} {region ? `${t('el departamento', 'the department')} (${regionName(region)})` : t('todo el Perú', 'all of Peru')}: <span className="font-mono">{evTotal.data.toLocaleString(locale())}</span>. {t('La cobertura llega hasta el', 'Coverage extends to')} {fmt.date(tMax)}; {t('no son incendios activos hoy.', 'these are not fires active today.')}</p>}
          </Card>

          <Card title={t('Fuentes y límites', 'Sources and limits')}>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>{t('API de series y pronósticos: método', 'Series and forecast API: method')} {meta?.series.method_version ?? '—'}, {t('datos hasta', 'data through')} {meta ? fmt.date(meta.series.last_week_end) : '—'}, snapshot {meta ? String(meta.series.source_snapshot_id).slice(0, 12) : '—'}…</li>
              <li>{t('API de eventos históricos: procesamiento estándar (SP) de FIRMS; el tipo y la confianza de un evento son del procesamiento, no una confirmación oficial.', 'Historical events API: FIRMS standard processing (SP); the type and confidence of an event come from the processing, not from an official confirmation.')}</li>
              <li>{t('Series: semanas UTC. Eventos: fechas UTC. Pronóstico: semanas en hora de Lima. Cada servicio es independiente y sus fechas no se mezclan.', 'Series: UTC weeks. Events: UTC dates. Forecast: weeks in Lima time. Each service is independent and their dates are not mixed.')}</li>
              <li>{t('Este informe no sustituye los avisos oficiales de SENAMHI e INDECI.', 'This report does not replace the official warnings of SENAMHI and INDECI.')}</li>
            </ul>
          </Card>
        </article>
      )}
    </>
  )
}
