import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EVENT_TYPE_LABEL, fetchDepartments, fetchDetections, fetchEvent, fetchEventsMeta, useEventPages, type Detection, type EventQuery, type EventRow } from '../events'
import { checkMapping, eventDepartment } from '../lib/departments'
import { pointInProvince, type Province } from '../lib/geo'
import { MAX_RANGE_DAYS } from '../lib/proxy-rules'
import PeruMap from '../PeruMap'
import { useApp, useAsync, useProvinces, useRegionTotals } from '../state'
import { useProvinceData } from '../provinceData'
import ProvincePanel from './ProvincePanel'
import { Card, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, PageHeader, Select, shiftDay } from '../ui'

type Layer = 'dept' | 'events'
const NO_VALUES: Record<string, number | null> = {} // stable reference: no re-render churn in the map
const field = 'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
const typeLabel = (t: string) => EVENT_TYPE_LABEL[t] ?? t
const days = (a: string, b: string) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5 + 1

const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))

function Provincias({ provinces, selected, onSelect, regionName }: { provinces: Province[]; selected: string | null; onSelect: (id: string | null) => void; regionName: string | null }) {
  if (!regionName) return <Card title="Provincias y ciudades"><Empty>Elige un departamento en el filtro superior para ver sus provincias y capitales.</Empty></Card>
  return (
    <Card title={`Provincias de ${regionName}`}
      subtitle="Cada provincia con su capital (ciudad, villa o pueblo). Elige una fila o un contorno del mapa. La API de series publica solo departamentos: no existe actividad armonizada por provincia, por eso aquí solo se ven límites, capitales y, en la capa de eventos, los eventos reales que caen dentro.">
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-left text-xs text-muted"><tr><th className="py-1 pr-4 font-normal">Provincia</th><th className="pr-4 font-normal">Capital</th><th className="font-normal">Tipo</th></tr></thead>
          <tbody>{provinces.map((p) => (
            <tr key={p.id} className={`border-t border-line ${p.id === selected ? 'bg-surface' : ''}`}>
              <td className="py-1.5 pr-4"><button className="text-left text-sky underline" aria-pressed={p.id === selected} onClick={() => onSelect(p.id === selected ? null : p.id)}>{titled(p.name)}</button></td>
              <td className="pr-4">{p.capital ? titled(p.capital.name) : <span className="text-muted">sin dato en la fuente</span>}</td>
              <td className="text-muted">{p.capital ? titled(p.capital.kind) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Límites y capitales: juaneladio/peru-geojson (licencia MPL-2.0), límites de 2016 simplificados. Pueden diferir de los vigentes y de los de las APIs; el nombre no lleva tildes porque la fuente no las incluye.</p>
    </Card>
  )
}

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>
)

function Detalle({ id, det }: { id: number; det: ReturnType<typeof useAsync<{ event_id: number; count: number; detections: Detection[] } | null>> }) {
  const ev = useAsync((s) => fetchEvent(id, s), [id])
  const e = ev.data
  const SHOWN = 60
  return (
    <Card title={`Evento ${id}`} subtitle="Un evento es una agrupación de detecciones cercanas en espacio y tiempo, construida por la API de eventos. No es una confirmación oficial.">
      {ev.error ? <ErrorBox error={ev.error} retry={ev.retry} /> : ev.loading || !e ? <Loading label="Cargando el evento…" /> : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Row k="Inicio">{fmt.utc(e.t_start)}</Row>
          <Row k="Fin">{fmt.utc(e.t_end)}</Row>
          <Row k="Duración">{e.duration_days.toLocaleString('es-PE', { maximumFractionDigits: 1 })} días · {e.active_days} con actividad</Row>
          <Row k="Departamento (según esa API)">{e.department}</Row>
          <Row k="Tipo (clasificación del procesamiento)">{typeLabel(e.event_type)}</Row>
          <Row k="Confianza del procesamiento">{e.confidence}</Row>
          <Row k="Detecciones">{e.n_det} · MODIS {e.n_modis} · VIIRS {e.n_viirs}</Row>
          <Row k="Satélites">{e.satellites.replaceAll(',', ', ')}</Row>
          <Row k="FRP total / máximo">{fmt.d2(e.frp_total)} / {fmt.d2(e.frp_max)} MW</Row>
          <Row k="Extensión">{fmt.d2(e.spread_km)} km</Row>
          <Row k="Punto representativo">{e.lat.toFixed(4)}, {e.lon.toFixed(4)}</Row>
          <Row k="Fusión y división">{[e.may_split && 'podría dividirse', e.may_merge && 'podría fusionarse'].filter(Boolean).join(' · ') || 'sin señales'}</Row>
        </dl>
      )}
      <h3 className="mb-2 mt-6 text-sm font-semibold">Detecciones individuales del evento</h3>
      {det.error ? <ErrorBox error={det.error} retry={det.retry} /> : det.loading || !det.data ? <Loading label="Cargando detecciones…" /> : (
        <>
          <p className="mb-2 text-xs text-muted">Cada fila es un píxel con fuego de un pase de satélite. En el mapa se dibujan como puntos pequeños; el punto grande es el centro del evento. Se muestran {Math.min(SHOWN, det.data.count)} de {det.data.count}.</p>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel text-left text-xs text-muted"><tr>{['Hora', 'Instrumento', 'Satélite', 'FRP (MW)', 'Confianza', 'Día/noche'].map((h) => <th key={h} className="py-1 pr-4 font-normal">{h}</th>)}</tr></thead>
              <tbody>{det.data.detections.slice(0, SHOWN).map((d) => (
                <tr key={d.det_id} className="border-t border-line"><td className="py-1 pr-4 text-xs">{fmt.utc(d.t_utc)}</td><td className="pr-4">{d.instrument}</td><td className="pr-4">{d.satellite}</td><td className="pr-4 font-mono">{d.frp ?? '—'}</td><td className="pr-4">{d.confidence}</td><td>{d.daynight === 'D' ? 'Día' : d.daynight === 'N' ? 'Noche' : d.daynight}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}

function Eventos() {
  const { filters, setFilters, regionName } = useApp()
  const { region } = filters
  const { provinces } = useProvinces()
  const regionProvinces = useMemo(() => provinces.filter((p) => p.regionId === region), [provinces, region])
  const province = provinces.find((p) => p.id === filters.province) ?? null
  const meta = useAsync(fetchEventsMeta, [])
  const depts = useAsync(fetchDepartments, [])
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [eventType, setEventType] = useState('')
  const [minConfidence, setMinConfidence] = useState('')
  const [sel, setSel] = useState<number | null>(null)

  const tMin = meta.data?.t_min.slice(0, 10), tMax = meta.data?.t_max.slice(0, 10)
  useEffect(() => { if (tMax && !range) setRange({ start: shiftDay(tMax, -6), end: tMax }) }, [tMax, range])

  const dept = eventDepartment(region)
  const mapping = depts.data ? checkMapping(depts.data) : null
  const mappingBroken = !province && !!region && (!dept || (!!mapping && mapping.missingInService.includes(dept)))
  const rangeError = !range ? null : range.start > range.end ? 'La fecha inicial debe ser anterior o igual a la final.'
    : days(range.start, range.end) > MAX_RANGE_DAYS ? `El rango máximo es de ${MAX_RANGE_DAYS} días, para no descargar el histórico completo.` : null
  const query: EventQuery | null = range && !rangeError && !mappingBroken && depts.data ? { ...range, department: province ? null : dept, bbox: province ? province.bbox.map((n) => +n.toFixed(4)).join(',') : null, eventType, minConfidence } : null
  const pages = useEventPages(query)
  // A province is queried by its bounding box; only events whose point falls inside its polygon are shown.
  const visible = useMemo(() => (province ? pages.items.filter((e) => pointInProvince(e.lon, e.lat, province)) : pages.items), [pages.items, province])
  const queryKey = JSON.stringify(query)
  useEffect(() => setSel(null), [queryKey])
  const det = useAsync((s) => (sel ? fetchDetections(sel, s) : Promise.resolve(null)), [sel])
  const select = (id: number) => setSel(id)

  return (
    <div className="space-y-5">
      <Card title="Eventos que coinciden con el periodo consultado"
        subtitle="La API devuelve los eventos cuyas fechas se solapan con el periodo: un evento que empezó antes puede aparecer. No son «incendios iniciados» en estas fechas. Fechas en UTC y fin inclusivo.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">Desde (UTC)
            <input type="date" className={field} value={range?.start ?? ''} min={tMin} max={tMax} onChange={(e) => e.target.value && setRange({ start: e.target.value, end: range?.end ?? e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">Hasta (UTC, incluido)
            <input type="date" className={field} value={range?.end ?? ''} min={tMin} max={tMax} onChange={(e) => e.target.value && setRange({ start: range?.start ?? e.target.value, end: e.target.value })} /></label>
          <Select label="Tipo de evento" value={eventType} onChange={setEventType} options={[{ value: '', label: 'Todos' }, ...Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
          <Select label="Confianza mínima" value={minConfidence} onChange={setMinConfidence} options={[{ value: '', label: 'Cualquiera' }, { value: 'media', label: 'Media o alta' }, { value: 'alta', label: 'Alta' }]} />
          <Select label="Provincia" value={filters.province ?? ''} onChange={(v) => setFilters({ province: v || null })}
            options={[{ value: '', label: region ? 'Todo el departamento' : 'Elige un departamento' }, ...regionProvinces.map((p) => ({ value: p.id, label: titled(p.name) }))]} />
          <div className="text-xs text-muted">Territorio<div className="mt-1.5 text-sm text-ink">{province ? `Provincia de ${titled(province.name)} (${regionName(region)})` : region ? `${regionName(region)} → «${dept ?? '?'}» en esa API` : 'Todo el Perú'}</div></div>
          {province ? <button className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line" onClick={() => setFilters({ province: null })}>Ver todo el departamento</button>
            : region && <button className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line" onClick={() => setFilters({ region: null })}>Ver todo el Perú</button>}
        </div>
        {rangeError && <p role="alert" className="mt-3 text-sm text-danger">{rangeError}</p>}
        {mappingBroken && <p role="alert" className="mt-3 text-sm text-danger">No hay una correspondencia verificada entre este departamento y la lista de la API de eventos; no se consulta para evitar mezclar territorios.</p>}
        <p className="mt-3 max-w-[80ch] text-xs text-muted">
          {meta.error ? 'No se pudo consultar la cobertura de la API de eventos.' : meta.data
            ? <>Cobertura de los datos históricos: {fmt.date(meta.data.t_min.slice(0, 10))} a {fmt.date(meta.data.t_max.slice(0, 10))} (UTC), {Number(meta.data.n_events).toLocaleString('es-PE')} eventos y {Number(meta.data.n_detections).toLocaleString('es-PE')} detecciones del producto estándar. No son incendios activos hoy. El tipo y la confianza vienen del procesamiento de esa API; no son confirmación oficial ni la confianza del pronóstico. Sus límites departamentales no coinciden necesariamente con los de la API de series.</>
            : null}
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="Mapa de eventos" subtitle="Cada punto es un evento (centro de sus detecciones). Elige uno en el mapa o en la lista para ver sus detecciones.">
          {pages.error ? <ErrorBox error={pages.error} retry={pages.retry} /> : (
            <PeruMap values={NO_VALUES} selected={region} onSelect={(id) => setFilters({ region: id === region ? null : id })} label="Eventos"
              events={visible} selectedEvent={sel} onSelectEvent={select} detections={det.data?.detections}
              provinces={region ? regionProvinces : undefined} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })} />
          )}
        </Card>
        <Card title="Lista de eventos"
          subtitle={pages.total == null ? undefined : `Se cargaron ${pages.items.length.toLocaleString('es-PE')} de ${pages.total.toLocaleString('es-PE')} eventos${province ? ` del rectángulo que envuelve la provincia; ${visible.length.toLocaleString('es-PE')} caen dentro de sus límites` : ''}${pages.items.length < pages.total ? '; el resto no está en pantalla' : ''}.`}
          actions={pages.items.length < (pages.total ?? 0) ? <button disabled={pages.loading} onClick={pages.loadMore} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line disabled:opacity-50">{pages.loading ? 'Cargando…' : 'Cargar más'}</button> : undefined}>
          {pages.error ? <ErrorBox error={pages.error} retry={pages.retry} />
            : !query ? <Empty>Ajusta el periodo o el territorio para consultar.</Empty>
            : pages.loading && pages.items.length === 0 ? <Loading label="Consultando eventos…" />
            : visible.length === 0 && pages.items.length < (pages.total ?? 0) ? <Empty>Ninguno de los eventos cargados cae dentro de la provincia; usa «Cargar más» para revisar el resto.</Empty>
            : visible.length === 0 ? <Empty>La API no devolvió eventos para este periodo y territorio. Eso no demuestra que no hubiera fuego.</Empty> : (
              <ul className="max-h-[480px] space-y-1 overflow-auto pr-1">
                {visible.map((e: EventRow) => (
                  <li key={e.event_id}>
                    <button onClick={() => select(e.event_id)} aria-pressed={sel === e.event_id}
                      className={`w-full rounded-md px-3 py-2 text-left text-xs hover:bg-surface ${sel === e.event_id ? 'bg-surface outline outline-1 outline-teal' : ''}`}>
                      <span className="font-mono text-sm text-ink">#{e.event_id}</span>
                      <span className="ml-2 text-muted">{typeLabel(e.event_type)} · {e.department}</span>
                      <span className="mt-0.5 block text-muted">{fmt.utc(e.t_start)} → {fmt.utc(e.t_end)}</span>
                      <span className="block text-muted">{e.n_det} detecciones (MODIS {e.n_modis} · VIIRS {e.n_viirs}) · confianza {e.confidence}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      </div>
      <Provincias provinces={regionProvinces} selected={filters.province} onSelect={(id) => setFilters({ province: id })} regionName={region ? regionName(region) : null} />
      {sel && <Detalle id={sel} det={det} />}
    </div>
  )
}

/** Harmonized choropleth by department with the province drill-down; mounted only on this layer so events are not downloaded otherwise. */
function Calor() {
  const { filters, setFilters, regionName } = useApp()
  const { region, y0, y1, indicator } = filters
  const reg = useRegionTotals()
  const pd = useProvinceData(region)
  const select = (id: string | null) => setFilters({ region: id === region ? null : id })
  const legend = useMemo(() => ({
    title: `${pd.metric === 'density' ? 'Eventos por 1 000 km²' : 'Eventos'}${pd.range ? ` · ${pd.range.start} a ${pd.range.end}` : ''} (API de eventos)`,
    format: pd.metric === 'density' ? (v: number) => v.toLocaleString('es-PE', { maximumFractionDigits: 1 }) : (v: number) => fmt.full(v),
  }), [pd.metric, pd.range])
  return (
    <div className="space-y-5">
      <Card title={region ? `Datos armonizados · ${y0}–${y1} · ${regionName(region)}` : `Datos armonizados · ${y0}–${y1}`}
        subtitle={`${INDICATOR_LABEL[indicator]}. Haz clic en un departamento para ver sus provincias y capitales y, en una provincia, sus datos. Las estimaciones no son un número verificado de incendios.`}
        className={reg.loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
        {reg.error ? <ErrorBox error={reg.error} retry={reg.retry} /> : (
          <PeruMap values={reg.totals ?? NO_VALUES} label={INDICATOR_LABEL[indicator]} selected={region} onSelect={select} regionName={regionName}
            provinces={pd.provs} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })}
            provinceValues={pd.values} provinceLegend={legend} />
        )}
      </Card>
      {region && <ProvincePanel pd={pd} regionName={regionName(region)} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })} />}
    </div>
  )
}

export default function Mapa() {
  const [layer, setLayer] = useState<Layer>('dept')
  const layers = useMemo(() => [['dept', 'Conteos comparables por departamento'], ['events', 'Eventos históricos']] as const, [])

  return (
    <>
      <PageHeader title="Mapa de calor y zonas prioritarias"
        subtitle="Dos fuentes distintas: conteos comparables estimados por departamento (API de series) y eventos históricos con sus detecciones (API de eventos)." />
      <div role="radiogroup" aria-label="Capa del mapa" className="mb-4 inline-flex rounded-lg border border-line bg-panel p-1 text-sm">
        {layers.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={layer === v} onClick={() => setLayer(v)}
            className={`rounded-md px-3 py-1.5 ${layer === v ? 'bg-surface text-ink' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {layer === 'events' ? <Eventos /> : <Calor />}
    </>
  )
}
