import { useMemo, useState } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Legend as RLegend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fetchSeries, SERIES_END_EXCL, SERIES_START } from '../api'
import { rollup, weekly, yearKey } from '../lib/aggregate'
import { useApp, useAsync, useSeries } from '../state'
import { axis, Card, COLORS, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, MONTHS, PageHeader, pick, Select, tooltipStyle } from '../ui'

const PALETTE = ['#FB923C', '#67D8F2', '#14B8A6', '#FBBF24']
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * q, lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo)
}

function Evolucion() {
  const { filters, regionName } = useApp()
  const { region, indicator } = filters
  const { years, loading, error, retry } = useSeries(region)
  const [lines, setLines] = useState(true)
  const data = years.filter((y) => y.key >= '2001').map((y) => ({ ...y, v: pick(y, indicator) }))
  return (
    <Card title="Evolución de la actividad" subtitle={`${regionName(region)} · ${INDICATOR_LABEL[indicator]} por año. 2026 es parcial (hasta el 26 de julio).`}
      actions={<label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} />Mostrar MODIS y VIIRS</label>}>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ right: 12 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="key" {...axis} interval={2} />
            <YAxis {...axis} tickFormatter={fmt.n} width={52} />
            <Tooltip {...tooltipStyle} cursor={{ fill: '#17334D' }} labelFormatter={(k) => `${k}${k === '2026' ? ' (parcial)' : ''}`} formatter={(v) => (v == null ? 'sin estimación' : fmt.full(v as number))} />
            <RLegend wrapperStyle={{ fontSize: 12 }} />
            <Bar isAnimationActive={false} dataKey="v" name={INDICATOR_LABEL[indicator]} fill="#3A6E9E" radius={[3, 3, 0, 0]}>
              {data.map((d) => <Cell key={d.key} fill={d.key === '2026' ? '#2A4F73' : '#3A6E9E'} fillOpacity={d.key === '2026' ? 0.6 : 1} />)}
            </Bar>
            {lines && <Line isAnimationActive={false} dataKey="MODIS" name="MODIS armonizado" stroke={COLORS.MODIS} strokeWidth={2} dot={false} connectNulls={false} />}
            {lines && <Line isAnimationActive={false} dataKey="VIIRS" name="VIIRS armonizado" stroke={COLORS.VIIRS} strokeWidth={2} dot={false} connectNulls={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function Estacionalidad() {
  const { filters, regionName } = useApp()
  const { region, y0, y1, indicator } = filters
  const { months, loading, error, retry } = useSeries(region)
  const [picked, setPicked] = useState<number[]>([2024, 2025])
  const [next, setNext] = useState(2023)

  const data = useMemo(() => MONTHS.map((label, m) => {
    const at = (y: number) => { const p = months.find((x) => x.key === `${y}-${String(m + 1).padStart(2, '0')}`); return p ? pick(p, indicator) : null }
    const typical: number[] = []
    for (let y = y0; y <= y1; y++) { const v = at(y); if (v != null) typical.push(v) }
    typical.sort((a, b) => a - b)
    const p10 = quantile(typical, 0.1), p90 = quantile(typical, 0.9)
    const row: Record<string, unknown> = { label, band: p10 != null && p90 != null ? [p10, p90] : null, median: quantile(typical, 0.5) }
    for (const y of picked) row[`y${y}`] = at(y)
    return row
  }), [months, y0, y1, indicator, picked])

  return (
    <Card title="Estacionalidad" subtitle={`${regionName(region)} · actividad mensual de los años elegidos frente al patrón ${y0}–${y1} (banda p10–p90 y mediana).`}
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {picked.map((y, i) => (
            <button key={y} onClick={() => setPicked(picked.filter((p) => p !== y))} className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1" aria-label={`Quitar ${y}`}>
              <span className="inline-block size-2 rounded-full" style={{ background: PALETTE[i] }} />{y} ×
            </button>
          ))}
          {picked.length < 3 && (
            <>
              <input type="number" aria-label="Año a añadir" min={2001} max={2026} value={next} onChange={(e) => setNext(+e.target.value)} className="w-20 rounded-md border border-line bg-surface px-2 py-1 font-mono" />
              <button disabled={next < 2001 || next > 2026 || picked.includes(next)} onClick={() => setPicked([...picked, next])} className="rounded-md bg-surface px-2.5 py-1 hover:bg-line disabled:opacity-40">Añadir año</button>
            </>
          )}
        </div>
      }>
      {error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ right: 12 }}>
            <CartesianGrid vertical={false} stroke={COLORS.grid} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={fmt.n} width={52} />
            <Tooltip {...tooltipStyle} formatter={(v) => (Array.isArray(v) ? `${fmt.full(v[0])} – ${fmt.full(v[1])}` : v == null ? 'sin estimación' : fmt.full(v as number))} />
            <RLegend wrapperStyle={{ fontSize: 12 }} />
            <Area isAnimationActive={false} dataKey="band" name={`Rango típico p10–p90 (${y0}–${y1})`} stroke="none" fill="#94A8BD" fillOpacity={0.2} />
            <Line isAnimationActive={false} dataKey="median" name="Mediana" stroke="#94A8BD" strokeDasharray="4 4" dot={false} strokeWidth={1.5} />
            {picked.map((y, i) => <Line isAnimationActive={false} key={y} dataKey={`y${y}`} name={String(y)} stroke={PALETTE[i]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />)}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function Comparador() {
  const { filters, regions, regionName } = useApp()
  const { indicator, y0, y1 } = filters
  const [ids, setIds] = useState<string[]>([])
  const [index, setIndex] = useState<'total' | 'index'>('total')
  const { data, loading, error, retry } = useAsync(async () => {
    const out: Record<string, ReturnType<typeof rollup>> = {}
    await Promise.all(ids.map(async (id) => { out[id] = rollup(weekly((await fetchSeries(id, SERIES_START, SERIES_END_EXCL)).rows), yearKey) }))
    return out
  }, [ids.join(',')])

  const rows = useMemo(() => {
    if (!data) return []
    const base: Record<string, number | null> = {}
    for (const id of ids) {
      const v = (data[id] ?? []).filter((p) => +p.key >= y0 && +p.key <= y1).map((p) => pick(p, indicator)).filter((x): x is number => x != null)
      base[id] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    return Array.from({ length: 26 }, (_, i) => {
      const y = 2001 + i, row: Record<string, number | string | null> = { y }
      for (const id of ids) {
        const p = (data[id] ?? []).find((q) => +q.key === y), v = p ? pick(p, indicator) : null
        row[id] = v == null ? null : index === 'index' ? (base[id] ? (v / base[id]!) * 100 : null) : v
      }
      return row
    })
  }, [data, ids, indicator, index, y0, y1])

  return (
    <Card title="Comparador territorial" subtitle="Elige hasta tres departamentos. «Índice» pone en 100 el promedio anual del periodo del filtro para comparar la forma y no el tamaño."
      actions={
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Valores" value={index} onChange={setIndex} options={[{ value: 'total', label: 'Total anual' }, { value: 'index', label: `Índice (${y0}–${y1} = 100)` }]} />
          {ids.length < 3 && (
            <Select label="Añadir departamento" value="" onChange={(v) => v && setIds([...ids, v])}
              options={[{ value: '', label: 'Elegir…' }, ...regions.filter((r) => !ids.includes(r.region_id)).map((r) => ({ value: r.region_id, label: regionName(r.region_id) }))]} />
          )}
        </div>
      }>
      {ids.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {ids.map((id, i) => (
            <button key={id} onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={`Quitar ${regionName(id)}`} className="flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1">
              <span className="inline-block size-2 rounded-full" style={{ background: PALETTE[i] }} />{regionName(id)} ×
            </button>
          ))}
        </div>
      )}
      {ids.length === 0 ? <Empty>Añade un departamento para compararlo.</Empty>
        : error ? <ErrorBox error={error} retry={retry} /> : loading ? <Loading /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={rows} margin={{ right: 12 }}>
              <CartesianGrid vertical={false} stroke={COLORS.grid} />
              <XAxis dataKey="y" {...axis} interval={2} />
              <YAxis {...axis} tickFormatter={fmt.n} width={52} />
              <Tooltip {...tooltipStyle} formatter={(v) => (v == null ? 'sin estimación' : fmt.full(v as number))} />
              <RLegend wrapperStyle={{ fontSize: 12 }} />
              {ids.map((id, i) => <Line isAnimationActive={false} key={id} dataKey={id} name={regionName(id)} stroke={PALETTE[i]} strokeWidth={2} dot={false} connectNulls={false} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
    </Card>
  )
}

export default function Tendencias() {
  const { filters } = useApp()
  return (
    <>
      <PageHeader title="Tendencias históricas" subtitle={`Cómo ha cambiado la actividad térmica desde 2001. Indicador: ${INDICATOR_LABEL[filters.indicator].toLowerCase()}. MODIS cubre todo el periodo; VIIRS solo desde febrero de 2012.`} />
      <div className="space-y-5"><Evolucion /><Estacionalidad /><Comparador /></div>
    </>
  )
}
