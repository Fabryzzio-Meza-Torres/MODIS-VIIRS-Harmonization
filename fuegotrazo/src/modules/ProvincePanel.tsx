import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EVENT_TYPE_LABEL } from '../events'
import { per1000km2, summarize } from '../lib/provinceStats'
import type { ProvinceData } from '../provinceData'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, Loading, MONTHS, Select, Stat, tooltipStyle } from '../ui'

const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))
const one = (v: number | null) => (v == null ? '—' : v.toLocaleString('es-PE', { maximumFractionDigits: 1 }))
const field = 'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
const typeLabel = (t: string) => EVENT_TYPE_LABEL[t] ?? t
const bucketLabel = (key: string) => (key.length === 7 ? `${MONTHS[+key.slice(5) - 1]} ${key.slice(2, 4)}` : `${+key.slice(8)} ${MONTHS[+key.slice(5, 7) - 1].toLowerCase()}`)

export default function ProvincePanel({ pd, regionName, selectedProvince, onSelectProvince }: {
  pd: ProvinceData; regionName: string; selectedProvince: string | null; onSelectProvince: (id: string | null) => void
}) {
  const { range, q, rows, assigned, provs, coverage, metric } = pd
  const province = provs.find((p) => p.id === selectedProvince) ?? null
  const inProv = province ? assigned.byProvince.get(province.id) ?? [] : []
  const assignedTotal = rows.reduce((t, r) => t + r.events, 0)
  const sum = useMemo(() => (province && range ? summarize(inProv, range) : null), [province, inProv, range])
  const top = useMemo(() => [...inProv].sort((a, b) => b.n_det - a.n_det || a.event_id - b.event_id).slice(0, 10), [inProv])
  const byType = sum ? Object.entries(sum.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t: typeLabel(t), n })) : []
  const partial = pd.ready && !q.complete
  const exact = pd.ready && q.complete // rates, shares and the ranking are only offered for a complete download
  const listed = exact ? rows : [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es')) // partial: alphabetical, never ranked
  const progress = q.total ? Math.min(100, Math.round((q.loaded / q.total) * 100)) : 0

  return (
    <div className="space-y-5">
      <Card title={province ? `Provincia de ${titled(province.name)} · ${regionName}` : `Provincias de ${regionName}`}
        subtitle="Datos reales de la API de eventos: cada evento se asigna a la provincia que contiene su punto representativo. La API de series publica solo departamentos, así que no hay datos armonizados ni pronóstico por provincia."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">Desde (UTC)
              <input type="date" className={field} value={range?.start ?? ''} min={coverage?.min} max={coverage?.max}
                onChange={(e) => e.target.value && range && pd.setRange({ start: e.target.value, end: range.end })} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Hasta (UTC, incluido)
              <input type="date" className={field} value={range?.end ?? ''} min={coverage?.min} max={coverage?.max}
                onChange={(e) => e.target.value && range && pd.setRange({ start: range.start, end: e.target.value })} /></label>
            {!province && <Select label="Colorear por" value={metric} onChange={pd.setMetric} options={[{ value: 'density', label: 'Eventos por 1 000 km²' }, { value: 'count', label: 'Número de eventos' }]} />}
          </div>
        }>
        {pd.rangeError && <p role="alert" className="mb-3 text-sm text-danger">{pd.rangeError}</p>}
        {q.loading && (
          <div className="mb-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Eventos descargados">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-sky transition-[width]" style={{ width: `${progress}%` }} /></div>
            {q.total != null && <p className="mt-1 text-xs text-muted">{q.loaded.toLocaleString('es-PE')} de {q.total.toLocaleString('es-PE')} eventos</p>}
          </div>
        )}
        {q.error && <ErrorBox error={q.error} />}
        {partial && (
          <p role="alert" className="mb-3 rounded-md border border-amber/60 bg-amber/10 p-3 text-sm">
            Descarga parcial: se cargaron {q.loaded.toLocaleString('es-PE')} de {q.total?.toLocaleString('es-PE')} eventos (tope de 20 000). Las cifras son un <b>mínimo</b>: no se colorea ni se ordena el mapa. Acorta el periodo para obtener cifras completas.
          </p>
        )}
        {pd.ready && (
          <p className="mb-4 max-w-[90ch] text-xs text-muted">
            Periodo {fmt.date(range!.start)} a {fmt.date(range!.end)} (UTC). La API devolvió <span className="font-mono text-ink">{q.total!.toLocaleString('es-PE')}</span> eventos que coinciden con el periodo en el rectángulo del departamento:
            {' '}<span className="font-mono text-ink">{assignedTotal.toLocaleString('es-PE')}</span> caen dentro de sus provincias y <span className="font-mono text-ink">{assigned.outside.length.toLocaleString('es-PE')}</span> fuera (territorio vecino o bordes simplificados).
            {assignedTotal + assigned.outside.length !== q.loaded && ' ¡La conciliación no cuadra!'}
          </p>
        )}

        {!pd.ready && !q.error && !pd.rangeError ? <Loading label="Descargando eventos" />
          : !province ? (
            pd.ready && (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3 font-normal">Provincia</th><th className="pr-3 font-normal">Capital</th><th className="pr-3 text-right font-normal">{exact ? 'Eventos' : 'Eventos (mínimo)'}</th>{exact && <th className="pr-3 text-right font-normal">Por 1 000 km²</th>}{exact && <th className="pr-3 text-right font-normal">% del dpto.</th>}<th className="text-right font-normal">Área (km²)</th></tr></thead>
                    <tbody>{listed.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-1.5 pr-3"><button className="text-left text-sky underline" onClick={() => onSelectProvince(r.id)}>{titled(r.name)}</button></td>
                        <td className="pr-3">{(() => { const c = provs.find((p) => p.id === r.id)?.capital; return c ? <>{titled(c.name)} <span className="text-xs text-muted">{titled(c.kind)}</span></> : <span className="text-muted">—</span> })()}</td>
                        <td className="pr-3 text-right font-mono">{r.events.toLocaleString('es-PE')}</td>
                        {exact && <td className="pr-3 text-right font-mono">{one(r.per1000)}</td>}
                        {exact && <td className="pr-3 text-right font-mono">{fmt.pct(r.share)}</td>}
                        <td className="text-right font-mono text-muted">{Math.round(r.areaKm2).toLocaleString('es-PE')}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
                <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 26)}>
                  <BarChart data={listed.map((r) => ({ ...r, v: exact && metric === 'density' ? r.per1000 : r.events, n: titled(r.name) }))} layout="vertical" margin={{ left: 4, right: 16 }}>
                    <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                    <XAxis type="number" {...axis} tickFormatter={(v) => one(v)} />
                    <YAxis type="category" dataKey="n" width={96} {...axis} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => one(v as number)} />
                    <Bar isAnimationActive={false} dataKey="v" name={exact && metric === 'density' ? 'Eventos por 1 000 km²' : 'Eventos'} fill="#F97316" radius={[0, 4, 4, 0]} onClick={(d) => onSelectProvince((d as unknown as { id: string }).id)} style={{ cursor: 'pointer' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          ) : sum && pd.ready && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p className="text-muted">
                  Capital: <span className="text-ink">{province.capital ? `${titled(province.capital.name)} (${titled(province.capital.kind)})` : 'sin dato en la fuente'}</span>
                  {' · '}Área del polígono (límites 2016, no oficial): <span className="font-mono text-ink">{Math.round(province.areaKm2).toLocaleString('es-PE')} km²</span>
                </p>
                <button onClick={() => onSelectProvince(null)} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line">← Todas las provincias</button>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Eventos" value={sum.events.toLocaleString('es-PE')} hint={partial ? 'Mínimo (descarga parcial)' : 'que coinciden con el periodo'} />
                <Stat label="% del departamento" value={exact ? fmt.pct(assignedTotal ? sum.events / assignedTotal : 0) : '—'} hint={exact ? `de ${assignedTotal.toLocaleString('es-PE')} dentro de sus provincias` : 'solo con descarga completa'} />
                <Stat label="Por 1 000 km²" value={exact ? one(per1000km2(sum.events, province.areaKm2)) : '—'} hint={exact ? 'sobre el área del polígono' : 'solo con descarga completa'} />
                <Stat label="Detecciones" value={(sum.modis + sum.viirs).toLocaleString('es-PE')} hint={`MODIS ${sum.modis.toLocaleString('es-PE')} · VIIRS ${sum.viirs.toLocaleString('es-PE')}`} />
                <Stat label="FRP total" value={`${one(sum.frpTotal)} MW`} hint={`máximo de un evento ${one(sum.frpMax)} MW`} />
              </div>
              {sum.events === 0 ? <Empty>La API no devolvió eventos dentro de esta provincia en el periodo. Eso no demuestra que no hubiera fuego.</Empty> : (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                  <div>
                    <h3 className="mb-1 text-sm font-medium">Eventos por {sum.bucketKind === 'day' ? 'día' : 'mes'} de inicio (UTC)</h3>
                    <p className="mb-2 text-xs text-muted">Un cero es un {sum.bucketKind === 'day' ? 'día' : 'mes'} sin eventos iniciados.{sum.beforePeriod > 0 && ` Además, ${sum.beforePeriod.toLocaleString('es-PE')} empezaron antes del periodo y siguen activos dentro de él.`}</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={sum.buckets} margin={{ right: 8 }}>
                        <CartesianGrid vertical={false} stroke={COLORS.grid} />
                        <XAxis dataKey="key" {...axis} tickFormatter={bucketLabel} minTickGap={24} />
                        <YAxis {...axis} allowDecimals={false} width={36} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} labelFormatter={(k) => bucketLabel(k as string)} formatter={(v) => [fmt.full(v as number), 'Eventos']} />
                        <Bar isAnimationActive={false} dataKey="n" fill="#3A6E9E" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-medium">Por tipo de evento</h3>
                    <p className="mb-2 text-xs text-muted">Clasificación del procesamiento de la API de eventos, no confirmación oficial.</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={byType} layout="vertical" margin={{ left: 4, right: 16 }}>
                        <CartesianGrid horizontal={false} stroke={COLORS.grid} />
                        <XAxis type="number" {...axis} allowDecimals={false} />
                        <YAxis type="category" dataKey="t" width={112} {...axis} />
                        <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} formatter={(v) => [fmt.full(v as number), 'Eventos']} />
                        <Bar isAnimationActive={false} dataKey="n" radius={[0, 4, 4, 0]}>{byType.map((_, i) => <Cell key={i} fill="#F97316" />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              {top.length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="mb-2 text-sm font-medium">Los {top.length} eventos con más detecciones</h3>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted"><tr>{['Evento', 'Tipo', 'Inicio (UTC)', 'Detecciones', 'FRP total (MW)'].map((h) => <th key={h} className="py-1 pr-4 font-normal">{h}</th>)}</tr></thead>
                    <tbody>{top.map((e) => (
                      <tr key={e.event_id} className="border-t border-line"><td className="py-1.5 pr-4 font-mono">#{e.event_id}</td><td className="pr-4">{typeLabel(e.event_type)}</td><td className="pr-4 text-xs">{fmt.utc(e.t_start)}</td><td className="pr-4 font-mono">{e.n_det}</td><td className="font-mono">{one(e.frp_total)}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
      </Card>
      <p className="max-w-[90ch] text-xs text-muted">
        Método: un evento cuenta en la provincia que contiene su punto central y en ninguna otra; los eventos que cruzan un límite se cuentan una sola vez. Los límites son de 2016, simplificados, y pueden diferir de los vigentes; un evento cerca del borde puede caer en la provincia vecina.
        «Por 1 000 km²» divide entre el área geodésica del mismo polígono. Las fechas son UTC y el «hasta» es inclusivo. Un evento coincide con el periodo si se solapa con él.
      </p>
    </div>
  )
}
