import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { eventTypeLabel } from '../events'
import { locale, t } from '../i18n'
import { per1000km2, summarize } from '../lib/provinceStats'
import type { ProvinceData } from '../provinceData'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, monthShort, Select, Stat, tooltipStyle } from '../ui'

const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))
const one = fmt.one
const num = (v: number) => v.toLocaleString(locale())
const field = 'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
const typeLabel = eventTypeLabel
const bucketLabel = (key: string) => (key.length === 7 ? `${monthShort()[+key.slice(5) - 1]} ${key.slice(2, 4)}` : `${+key.slice(8)} ${monthShort()[+key.slice(5, 7) - 1].toLowerCase()}`)

export default function ProvincePanel({ pd, regionName, selectedProvince, onSelectProvince }: {
  pd: ProvinceData; regionName: string; selectedProvince: string | null; onSelectProvince: (id: string | null) => void
}) {
  const { range, q, rows, assigned, provs, coverage, metric } = pd
  const province = provs.find((p) => p.id === selectedProvince) ?? null
  const inProv = province ? assigned.byProvince.get(province.id) ?? [] : []
  const assignedTotal = rows.reduce((s, r) => s + r.events, 0)
  const sum = useMemo(() => (province && range ? summarize(inProv, range) : null), [province, inProv, range])
  const top = useMemo(() => [...inProv].sort((a, b) => b.n_det - a.n_det || a.event_id - b.event_id).slice(0, 10), [inProv])
  const byType = sum ? Object.entries(sum.byType).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ t: typeLabel(code), n })) : []
  const partial = pd.ready && !q.complete
  const exact = pd.ready && q.complete // rates, shares and the ranking are only offered for a complete download
  const listed = exact ? rows : [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es')) // partial: alphabetical, never ranked
  const progress = q.total ? Math.min(100, Math.round((q.loaded / q.total) * 100)) : 0

  return (
    <div className="space-y-5">
      <Card title={province ? `${t('Provincia de', 'Province of')} ${titled(province.name)} · ${regionName}` : `${t('Provincias de', 'Provinces of')} ${regionName}`}
        subtitle={t('Datos reales de la API de eventos: cada evento se asigna a la provincia que contiene su punto representativo. La API de series publica solo departamentos, así que no hay datos armonizados ni pronóstico por provincia.', 'Real data from the events API: each event is assigned to the province that contains its representative point. The series API publishes departments only, so there is no harmonized data or forecast per province.')}
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">{t('Desde (UTC)', 'From (UTC)')}
              <input type="date" className={field} value={range?.start ?? ''} min={coverage?.min} max={coverage?.max}
                onChange={(e) => e.target.value && range && pd.setRange({ start: e.target.value, end: range.end })} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">{t('Hasta (UTC, incluido)', 'To (UTC, inclusive)')}
              <input type="date" className={field} value={range?.end ?? ''} min={coverage?.min} max={coverage?.max}
                onChange={(e) => e.target.value && range && pd.setRange({ start: range.start, end: e.target.value })} /></label>
            {!province && <Select label={t('Colorear por', 'Color by')} value={metric} onChange={pd.setMetric} options={[{ value: 'density', label: t('Eventos por 1 000 km²', 'Events per 1,000 km²') }, { value: 'count', label: t('Número de eventos', 'Number of events') }]} />}
          </div>
        }>
        {pd.rangeError && <p role="alert" className="mb-3 text-sm text-danger">{pd.rangeError}</p>}
        {q.loading && (
          <div className="mb-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('Eventos descargados', 'Events downloaded')}>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-sky transition-[width]" style={{ width: `${progress}%` }} /></div>
            {q.total != null && <p className="mt-1 text-xs text-muted">{num(q.loaded)} {t('de', 'of')} {num(q.total)} {t('eventos', 'events')}</p>}
          </div>
        )}
        {q.error && <ErrorBox error={q.error} />}
        {partial && (
          <p role="alert" className="mb-3 rounded-md border border-amber/60 bg-amber/10 p-3 text-sm">
            {t('Descarga parcial: se cargaron', 'Partial download: loaded')} {num(q.loaded)} {t('de', 'of')} {q.total != null ? num(q.total) : ''} {t('eventos (tope de 20 000). Las cifras son un', 'events (cap of 20,000). The figures are a')} <b>{t('mínimo', 'minimum')}</b>{t(': no se colorea ni se ordena el mapa. Acorta el periodo para obtener cifras completas.', ': the map is neither colored nor ranked. Shorten the period to get complete figures.')}
          </p>
        )}
        {pd.ready && (
          <p className="mb-4 max-w-[90ch] text-xs text-muted">
            {t('Periodo', 'Period')} {fmt.date(range!.start)} {t('a', 'to')} {fmt.date(range!.end)} (UTC). {t('La API devolvió', 'The API returned')} <span className="font-mono text-ink">{num(q.total!)}</span> {t('eventos que coinciden con el periodo en el rectángulo del departamento:', 'events matching the period in the department rectangle:')}
            {' '}<span className="font-mono text-ink">{num(assignedTotal)}</span> {t('caen dentro de sus provincias y', 'fall inside its provinces and')} <span className="font-mono text-ink">{num(assigned.outside.length)}</span> {t('fuera (territorio vecino o bordes simplificados).', 'outside (neighboring territory or simplified borders).')}
            {assignedTotal + assigned.outside.length !== q.loaded && ` ${t('¡La conciliación no cuadra!', 'The reconciliation does not add up!')}`}
          </p>
        )}

        {!pd.ready && !q.error && !pd.rangeError ? <Loading label={t('Descargando eventos', 'Downloading events')} />
          : !province ? (
            pd.ready && (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3 font-normal">{t('Provincia', 'Province')}</th><th className="pr-3 font-normal">{t('Capital', 'Capital')}</th><th className="pr-3 text-right font-normal">{exact ? t('Eventos', 'Events') : t('Eventos (mínimo)', 'Events (minimum)')}</th>{exact && <th className="pr-3 text-right font-normal">{t('Por 1 000 km²', 'Per 1,000 km²')}</th>}{exact && <th className="pr-3 text-right font-normal">{t('% del dpto.', '% of dept.')}</th>}<th className="text-right font-normal">{t('Área (km²)', 'Area (km²)')}</th></tr></thead>
                    <tbody>{listed.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-1.5 pr-3"><button className="text-left text-sky underline" onClick={() => onSelectProvince(r.id)}>{titled(r.name)}</button></td>
                        <td className="pr-3">{(() => { const c = provs.find((p) => p.id === r.id)?.capital; return c ? <>{titled(c.name)} <span className="text-xs text-muted">{titled(c.kind)}</span></> : <span className="text-muted">—</span> })()}</td>
                        <td className="pr-3 text-right font-mono">{num(r.events)}</td>
                        {exact && <td className="pr-3 text-right font-mono">{one(r.per1000)}</td>}
                        {exact && <td className="pr-3 text-right font-mono">{fmt.pct(r.share)}</td>}
                        <td className="text-right font-mono text-muted">{num(Math.round(r.areaKm2))}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 26)}>
                  <BarChart data={listed.map((r) => ({ ...r, v: exact && metric === 'density' ? r.per1000 : r.events, n: titled(r.name) }))} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                    <XAxis type="number" {...axis} tickFormatter={(v) => one(v)} />
                    <YAxis type="category" dataKey="n" width={96} {...axis} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => one(v as number)} />
                    <Bar isAnimationActive={false} dataKey="v" name={exact && metric === 'density' ? t('Eventos por 1 000 km²', 'Events per 1,000 km²') : t('Eventos', 'Events')} fill="#F97316" radius={[0, 4, 4, 0]} onClick={(d) => onSelectProvince((d as unknown as { id: string }).id)} style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          ) : sum && pd.ready && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-muted">
                  {t('Capital', 'Capital')}: <span className="text-ink">{province.capital ? `${titled(province.capital.name)} (${titled(province.capital.kind)})` : t('sin dato en la fuente', 'not in the source')}</span>
                  {' · '}{t('Área del polígono (límites 2016, no oficial)', 'Polygon area (2016 boundaries, unofficial)')}: <span className="font-mono text-ink">{num(Math.round(province.areaKm2))} km²</span>
                </p>
                <button onClick={() => onSelectProvince(null)} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">{t('← Todas las provincias', '← All provinces')}</button>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label={t('Eventos', 'Events')} value={num(sum.events)} hint={partial ? t('Mínimo (descarga parcial)', 'Minimum (partial download)') : t('que coinciden con el periodo', 'matching the period')} />
                <Stat label={t('% del departamento', '% of the department')} value={exact ? fmt.pct(assignedTotal ? sum.events / assignedTotal : 0) : '—'} hint={exact ? `${t('de', 'of')} ${num(assignedTotal)} ${t('dentro de sus provincias', 'inside its provinces')}` : t('solo con descarga completa', 'only with a complete download')} />
                <Stat label={t('Por 1 000 km²', 'Per 1,000 km²')} value={exact ? one(per1000km2(sum.events, province.areaKm2)) : '—'} hint={exact ? t('sobre el área del polígono', 'over the polygon area') : t('solo con descarga completa', 'only with a complete download')} />
                <Stat label={t('Detecciones', 'Detections')} value={num(sum.modis + sum.viirs)} hint={`MODIS ${num(sum.modis)} · VIIRS ${num(sum.viirs)}`} />
                <Stat label={t('FRP total', 'Total FRP')} value={`${one(sum.frpTotal)} MW`} hint={`${t('máximo de un evento', 'maximum of one event')} ${one(sum.frpMax)} MW`} />
              </div>
              {sum.events === 0 ? <Empty>{t('La API no devolvió eventos dentro de esta provincia en el periodo. Eso no demuestra que no hubiera fuego.', 'The API returned no events inside this province in the period. That does not prove there was no fire.')}</Empty> : (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div>
                    <h3 className="mb-1 text-sm font-medium">{sum.bucketKind === 'day' ? t('Eventos por día de inicio (UTC)', 'Events per start day (UTC)') : t('Eventos por mes de inicio (UTC)', 'Events per start month (UTC)')}</h3>
                    <p className="mb-2 text-xs text-muted">{sum.bucketKind === 'day' ? t('Un cero es un día sin eventos iniciados.', 'A zero is a day with no events started.') : t('Un cero es un mes sin eventos iniciados.', 'A zero is a month with no events started.')}{sum.beforePeriod > 0 && ` ${t(`Además, ${num(sum.beforePeriod)} empezaron antes del periodo y siguen activos dentro de él.`, `In addition, ${num(sum.beforePeriod)} started before the period and are still active within it.`)}`}</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={sum.buckets} margin={{ right: 8 }}>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="key" {...axis} tickFormatter={bucketLabel} minTickGap={24} />
                        <YAxis {...axis} allowDecimals={false} width={36} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} labelFormatter={(k) => bucketLabel(k as string)} formatter={(v) => [fmt.full(v as number), t('Eventos', 'Events')]} />
                        <Bar isAnimationActive={false} dataKey="n" fill="#3A6E9E" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-medium">{t('Por tipo de evento', 'By event type')}</h3>
                    <p className="mb-2 text-xs text-muted">{t('Clasificación del procesamiento de la API de eventos, no confirmación oficial.', 'Classification from the events API processing, not an official confirmation.')}</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={byType} layout="vertical" margin={{ left: 4, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                        <XAxis type="number" {...axis} allowDecimals={false} />
                        <YAxis type="category" dataKey="t" width={112} {...axis} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => [fmt.full(v as number), t('Eventos', 'Events')]} />
                        <Bar isAnimationActive={false} dataKey="n" radius={[0, 4, 4, 0]}>{byType.map((_, i) => <Cell key={i} fill="#F97316" />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {top.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="mb-2 text-sm font-medium">{t(`Los ${top.length} eventos con más detecciones`, `The ${top.length} events with the most detections`)}</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted"><tr>{[t('Evento', 'Event'), t('Tipo', 'Type'), t('Inicio (UTC)', 'Start (UTC)'), t('Detecciones', 'Detections'), t('FRP total (MW)', 'Total FRP (MW)')].map((h) => <th key={h} className="py-1 pr-4 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{top.map((e) => (
                      <tr key={e.event_id} className="border-t border-line"><td className="py-1.5 pr-4 font-mono">#{e.event_id}</td><td className="pr-4">{typeLabel(e.event_type)}</td><td className="pr-4 text-xs">{fmt.utc(e.t_start)}</td><td className="pr-4 font-mono">{e.n_det}</td><td className="font-mono">{one(e.frp_total)}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
      </Card>
      <p className="max-w-[90ch] text-xs text-muted">
        {t('Método: un evento cuenta en la provincia que contiene su punto central y en ninguna otra; los eventos que cruzan un límite se cuentan una sola vez. Los límites son de 2016, simplificados, y pueden diferir de los vigentes; un evento cerca del borde puede caer en la provincia vecina. «Por 1 000 km²» divide entre el área geodésica del mismo polígono. Las fechas son UTC y el «hasta» es inclusivo. Un evento coincide con el periodo si se solapa con él.', 'Method: an event counts in the province that contains its central point and in no other; events that cross a boundary are counted only once. The boundaries are from 2016, simplified, and may differ from the current ones; an event near the edge may fall in the neighboring province. “Per 1,000 km²” divides by the geodesic area of the same polygon. Dates are UTC and “to” is inclusive. An event matches the period if it overlaps it.')}
      </p>
    </div>
  )
}
