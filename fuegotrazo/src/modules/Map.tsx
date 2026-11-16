import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EVENT_TYPE_CODES, eventTypeLabel, fetchDepartments, fetchDetections, fetchEvent, fetchEventsMeta, useEventPages, type Detection, type EventQuery, type EventRow } from '../events'
import { getLang, locale, t } from '../i18n'
import { checkMapping, eventDepartment } from '../lib/departments'
import { pointInProvince, settlementKindLabel, type Province } from '../lib/geo'
import { MAX_RANGE_DAYS } from '../lib/proxy-rules'
import PeruMap from '../PeruMap'
import { useApp, useAsync, useProvinces, useRegionTotals } from '../state'
import { useProvinceData } from '../provinceData'
import ProvincePanel from './ProvincePanel'
import { Card, Empty, ErrorBox, fmt, INDICATOR_LABEL, Loading, PageHeader, Select, shiftDay } from '../ui'

type Layer = 'dept' | 'events'
const NO_VALUES: Record<string, number | null> = {} // stable reference: no re-render churn in the map
const field = 'rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
const typeLabel = eventTypeLabel
const days = (a: string, b: string) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5 + 1

const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))

function Provincias({ provinces, selected, onSelect, regionName }: { provinces: Province[]; selected: string | null; onSelect: (id: string | null) => void; regionName: string | null }) {
  if (!regionName) return <Card title={t('Provincias y ciudades', 'Provinces and cities')}><Empty>{t('Elige un departamento en el filtro superior para ver sus provincias y capitales.', 'Choose a department in the top filter to see its provinces and capitals.')}</Empty></Card>
  return (
    <Card title={`${t('Provincias de', 'Provinces of')} ${regionName}`}
      subtitle={t('Cada provincia con su capital (ciudad, villa o pueblo). Elige una fila o un contorno del mapa. La API de series publica solo departamentos: no existe actividad armonizada por provincia, por eso aquí solo se ven límites, capitales y, en la capa de eventos, los eventos reales que caen dentro.', 'Each province with its capital (city, town or village). Choose a row or an outline on the map. The series API publishes departments only: there is no harmonized activity per province, so here you only see boundaries, capitals and, in the events layer, the real events that fall inside.')}>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel text-left text-xs text-muted"><tr><th className="py-1 pr-4 font-normal">{t('Provincia', 'Province')}</th><th className="pr-4 font-normal">{t('Capital', 'Capital')}</th><th className="font-normal">{t('Tipo', 'Type')}</th></tr></thead>
          <tbody>{provinces.map((p) => (
            <tr key={p.id} className={`border-t border-line ${p.id === selected ? 'bg-surface' : ''}`}>
              <td className="py-1.5 pr-4"><button className="text-left text-sky underline" aria-pressed={p.id === selected} onClick={() => onSelect(p.id === selected ? null : p.id)}>{titled(p.name)}</button></td>
              <td className="pr-4">{p.capital ? titled(p.capital.name) : <span className="text-muted">{t('sin dato en la fuente', 'not in the source')}</span>}</td>
              <td className="text-muted">{p.capital ? settlementKindLabel(p.capital.kind, getLang()) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">{t('Límites y capitales: juaneladio/peru-geojson (licencia MPL-2.0), límites de 2016 simplificados. Pueden diferir de los vigentes y de los de las APIs; el nombre no lleva tildes porque la fuente no las incluye.', 'Boundaries and capitals: juaneladio/peru-geojson (MPL-2.0 license), simplified 2016 boundaries. They may differ from the current ones and from those of the APIs; names carry no accents because the source does not include them.')}</p>
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
    <Card title={`${t('Evento', 'Event')} ${id}`} subtitle={t('Un evento es una agrupación de detecciones cercanas en espacio y tiempo, construida por la API de eventos. No es una confirmación oficial.', 'An event is a grouping of detections close in space and time, built by the events API. It is not an official confirmation.')}>
      {ev.error ? <ErrorBox error={ev.error} retry={ev.retry} /> : ev.loading || !e ? <Loading label={t('Cargando el evento…', 'Loading the event…')} /> : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Row k={t('Inicio', 'Start')}>{fmt.utc(e.t_start)}</Row>
          <Row k={t('Fin', 'End')}>{fmt.utc(e.t_end)}</Row>
          <Row k={t('Duración', 'Duration')}>{e.duration_days.toLocaleString(locale(), { maximumFractionDigits: 1 })} {t('días', 'days')} · {e.active_days} {t('con actividad', 'with activity')}</Row>
          <Row k={t('Departamento (según esa API)', 'Department (per that API)')}>{e.department}</Row>
          <Row k={t('Tipo (clasificación del procesamiento)', 'Type (processing classification)')}>{typeLabel(e.event_type)}</Row>
          <Row k={t('Confianza del procesamiento', 'Processing confidence')}>{e.confidence}</Row>
          <Row k={t('Detecciones', 'Detections')}>{e.n_det} · MODIS {e.n_modis} · VIIRS {e.n_viirs}</Row>
          <Row k={t('Satélites', 'Satellites')}>{e.satellites.replaceAll(',', ', ')}</Row>
          <Row k={t('FRP total / máximo', 'FRP total / maximum')}>{fmt.d2(e.frp_total)} / {fmt.d2(e.frp_max)} MW</Row>
          <Row k={t('Extensión', 'Extent')}>{fmt.d2(e.spread_km)} km</Row>
          <Row k={t('Punto representativo', 'Representative point')}>{e.lat.toFixed(4)}, {e.lon.toFixed(4)}</Row>
          <Row k={t('Fusión y división', 'Merge and split')}>{[e.may_split && t('podría dividirse', 'may split'), e.may_merge && t('podría fusionarse', 'may merge')].filter(Boolean).join(' · ') || t('sin señales', 'no signals')}</Row>
        </dl>
      )}
      <h3 className="mb-2 mt-6 text-sm font-semibold">{t('Detecciones individuales del evento', 'Individual detections of the event')}</h3>
      {det.error ? <ErrorBox error={det.error} retry={det.retry} /> : det.loading || !det.data ? <Loading label={t('Cargando detecciones…', 'Loading detections…')} /> : (
        <>
          <p className="mb-2 text-xs text-muted">{t('Cada fila es un píxel con fuego de un pase de satélite. En el mapa se dibujan como puntos pequeños; el punto grande es el centro del evento. Se muestran', 'Each row is a fire pixel from a satellite pass. On the map they are drawn as small points; the large point is the center of the event. Showing')} {Math.min(SHOWN, det.data.count)} {t('de', 'of')} {det.data.count}.</p>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel text-left text-xs text-muted"><tr>{[t('Hora', 'Time'), t('Instrumento', 'Instrument'), t('Satélite', 'Satellite'), 'FRP (MW)', t('Confianza', 'Confidence'), t('Día/noche', 'Day/night')].map((h) => <th key={h} className="py-1 pr-4 font-normal">{h}</th>)}</tr></thead>
              <tbody>{det.data.detections.slice(0, SHOWN).map((d) => (
                <tr key={d.det_id} className="border-t border-line"><td className="py-1 pr-4 text-xs">{fmt.utc(d.t_utc)}</td><td className="pr-4">{d.instrument}</td><td className="pr-4">{d.satellite}</td><td className="pr-4 font-mono">{d.frp ?? '—'}</td><td className="pr-4">{d.confidence}</td><td>{d.daynight === 'D' ? t('Día', 'Day') : d.daynight === 'N' ? t('Noche', 'Night') : d.daynight}</td></tr>
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
  const rangeError = !range ? null : range.start > range.end ? t('La fecha inicial debe ser anterior o igual a la final.', 'The start date must be on or before the end date.')
    : days(range.start, range.end) > MAX_RANGE_DAYS ? t(`El rango máximo es de ${MAX_RANGE_DAYS} días, para no descargar el histórico completo.`, `The maximum range is ${MAX_RANGE_DAYS} days, to avoid downloading the whole history.`) : null
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
      <Card title={t('Eventos que coinciden con el periodo consultado', 'Events that match the queried period')}
        subtitle={t('La API devuelve los eventos cuyas fechas se solapan con el periodo: un evento que empezó antes puede aparecer. No son «incendios iniciados» en estas fechas. Fechas en UTC y fin inclusivo.', 'The API returns the events whose dates overlap the period: an event that started earlier may appear. They are not “fires started” on these dates. Dates in UTC, end inclusive.')}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">{t('Desde (UTC)', 'From (UTC)')}
            <input type="date" className={field} value={range?.start ?? ''} min={tMin} max={tMax} onChange={(e) => e.target.value && setRange({ start: e.target.value, end: range?.end ?? e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-xs text-muted">{t('Hasta (UTC, incluido)', 'To (UTC, inclusive)')}
            <input type="date" className={field} value={range?.end ?? ''} min={tMin} max={tMax} onChange={(e) => e.target.value && setRange({ start: range?.start ?? e.target.value, end: e.target.value })} /></label>
          <Select label={t('Tipo de evento', 'Event type')} value={eventType} onChange={setEventType} options={[{ value: '', label: t('Todos', 'All') }, ...EVENT_TYPE_CODES.map((value) => ({ value, label: eventTypeLabel(value) }))]} />
          <Select label={t('Confianza mínima', 'Minimum confidence')} value={minConfidence} onChange={setMinConfidence} options={[{ value: '', label: t('Cualquiera', 'Any') }, { value: 'media', label: t('Media o alta', 'Medium or high') }, { value: 'alta', label: t('Alta', 'High') }]} />
          <Select label={t('Provincia', 'Province')} value={filters.province ?? ''} onChange={(v) => setFilters({ province: v || null })}
            options={[{ value: '', label: region ? t('Todo el departamento', 'Whole department') : t('Elige un departamento', 'Choose a department') }, ...regionProvinces.map((p) => ({ value: p.id, label: titled(p.name) }))]} />
          <div className="text-xs text-muted">{t('Territorio', 'Territory')}<div className="mt-1.5 text-sm text-ink">{province ? `${t('Provincia de', 'Province of')} ${titled(province.name)} (${regionName(region)})` : region ? `${regionName(region)} → «${dept ?? '?'}» ${t('en esa API', 'in that API')}` : t('Todo el Perú', 'All of Peru')}</div></div>
          {province ? <button className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line" onClick={() => setFilters({ province: null })}>{t('Ver todo el departamento', 'View the whole department')}</button>
            : region && <button className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line" onClick={() => setFilters({ region: null })}>{t('Ver todo el Perú', 'View all of Peru')}</button>}
        </div>
        {rangeError && <p role="alert" className="mt-3 text-sm text-danger">{rangeError}</p>}
        {mappingBroken && <p role="alert" className="mt-3 text-sm text-danger">{t('No hay una correspondencia verificada entre este departamento y la lista de la API de eventos; no se consulta para evitar mezclar territorios.', 'There is no verified match between this department and the events API list; it is not queried, to avoid mixing territories.')}</p>}
        <p className="mt-3 max-w-[80ch] text-xs text-muted">
          {meta.error ? t('No se pudo consultar la cobertura de la API de eventos.', 'Could not fetch the events API coverage.') : meta.data
            ? <>{t('Cobertura de los datos históricos', 'Coverage of the historical data')}: {fmt.date(meta.data.t_min.slice(0, 10))} {t('a', 'to')} {fmt.date(meta.data.t_max.slice(0, 10))} (UTC), {Number(meta.data.n_events).toLocaleString(locale())} {t('eventos y', 'events and')} {Number(meta.data.n_detections).toLocaleString(locale())} {t('detecciones del producto estándar. No son incendios activos hoy. El tipo y la confianza vienen del procesamiento de esa API; no son confirmación oficial ni la confianza del pronóstico. Sus límites departamentales no coinciden necesariamente con los de la API de series.', 'detections of the standard product. They are not fires active today. The type and confidence come from that API\'s processing; they are neither an official confirmation nor the forecast confidence. Its department boundaries do not necessarily match those of the series API.')}</>
            : null}
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={t('Mapa de eventos', 'Events map')} subtitle={t('Cada punto es un evento (centro de sus detecciones). Elige uno en el mapa o en la lista para ver sus detecciones.', 'Each point is an event (the center of its detections). Choose one on the map or in the list to see its detections.')}>
          {pages.error ? <ErrorBox error={pages.error} retry={pages.retry} /> : (
            <PeruMap values={NO_VALUES} selected={region} onSelect={(id) => setFilters({ region: id === region ? null : id })} label={t('Eventos', 'Events')}
              events={visible} selectedEvent={sel} onSelectEvent={select} detections={det.data?.detections}
              provinces={region ? regionProvinces : undefined} selectedProvince={filters.province} onSelectProvince={(id) => setFilters({ province: id })} />
          )}
        </Card>
        <Card title={t('Lista de eventos', 'Event list')}
          subtitle={pages.total == null ? undefined : t(`Se cargaron ${pages.items.length.toLocaleString(locale())} de ${pages.total.toLocaleString(locale())} eventos${province ? ` del rectángulo que envuelve la provincia; ${visible.length.toLocaleString(locale())} caen dentro de sus límites` : ''}${pages.items.length < pages.total ? '; el resto no está en pantalla' : ''}.`, `Loaded ${pages.items.length.toLocaleString(locale())} of ${pages.total.toLocaleString(locale())} events${province ? ` from the rectangle that wraps the province; ${visible.length.toLocaleString(locale())} fall inside its boundaries` : ''}${pages.items.length < pages.total ? '; the rest is not on screen' : ''}.`)}
          actions={pages.items.length < (pages.total ?? 0) ? <button disabled={pages.loading} onClick={pages.loadMore} className="rounded-md bg-surface px-3 py-1.5 text-xs hover:bg-line disabled:opacity-50">{pages.loading ? t('Cargando…', 'Loading…') : t('Cargar más', 'Load more')}</button> : undefined}>
          {pages.error ? <ErrorBox error={pages.error} retry={pages.retry} />
            : !query ? <Empty>{t('Ajusta el periodo o el territorio para consultar.', 'Adjust the period or the territory to query.')}</Empty>
            : pages.loading && pages.items.length === 0 ? <Loading label={t('Consultando eventos…', 'Querying events…')} />
            : visible.length === 0 && pages.items.length < (pages.total ?? 0) ? <Empty>{t('Ninguno de los eventos cargados cae dentro de la provincia; usa «Cargar más» para revisar el resto.', 'None of the loaded events falls inside the province; use “Load more” to check the rest.')}</Empty>
            : visible.length === 0 ? <Empty>{t('La API no devolvió eventos para este periodo y territorio. Eso no demuestra que no hubiera fuego.', 'The API returned no events for this period and territory. That does not prove there was no fire.')}</Empty> : (
              <ul className="max-h-[480px] space-y-1 overflow-auto pr-1">
                {visible.map((e: EventRow) => (
                  <li key={e.event_id}>
                    <button onClick={() => select(e.event_id)} aria-pressed={sel === e.event_id}
                      className={`w-full rounded-md px-3 py-2 text-left text-xs hover:bg-surface ${sel === e.event_id ? 'bg-surface outline outline-1 outline-teal' : ''}`}>
                      <span className="font-mono text-sm text-ink">#{e.event_id}</span>
                      <span className="ml-2 text-muted">{typeLabel(e.event_type)} · {e.department}</span>
                      <span className="mt-0.5 block text-muted">{fmt.utc(e.t_start)} → {fmt.utc(e.t_end)}</span>
                      <span className="block text-muted">{e.n_det} {t('detecciones', 'detections')} (MODIS {e.n_modis} · VIIRS {e.n_viirs}) · {t('confianza', 'confidence')} {e.confidence}</span>
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
    title: `${pd.metric === 'density' ? t('Eventos por 1 000 km²', 'Events per 1,000 km²') : t('Eventos', 'Events')}${pd.range ? ` · ${pd.range.start} ${t('a', 'to')} ${pd.range.end}` : ''} (${t('API de eventos', 'events API')})`,
    format: pd.metric === 'density' ? (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 1 }) : (v: number) => fmt.full(v),
  }), [pd.metric, pd.range])
  return (
    <div className="space-y-5">
      <Card title={region ? `${t('Datos armonizados', 'Harmonized data')} · ${y0}–${y1} · ${regionName(region)}` : `${t('Datos armonizados', 'Harmonized data')} · ${y0}–${y1}`}
        subtitle={`${INDICATOR_LABEL[indicator]}. ${t('Haz clic en un departamento para ver sus provincias y capitales y, en una provincia, sus datos. Las estimaciones no son un número verificado de incendios.', 'Click a department to see its provinces and capitals and, on a province, its data. The estimates are not a verified number of fires.')}`}
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
  const layers = [['dept', t('Conteos comparables por departamento', 'Comparable counts by department')], ['events', t('Eventos históricos', 'Historical events')]] as const

  return (
    <>
      <PageHeader title={t('Mapa de calor y zonas prioritarias', 'Heat map and priority areas')}
        subtitle={t('Dos fuentes distintas: conteos comparables estimados por departamento (API de series) y eventos históricos con sus detecciones (API de eventos).', 'Two different sources: estimated comparable counts by department (series API) and historical events with their detections (events API).')} />
      <div role="radiogroup" aria-label={t('Capa del mapa', 'Map layer')} className="mb-4 inline-flex rounded-lg border border-line bg-panel p-1 text-sm">
        {layers.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={layer === v} onClick={() => setLayer(v)}
            className={`rounded-md px-3 py-1.5 ${layer === v ? 'bg-surface text-ink' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {layer === 'events' ? <Eventos /> : <Calor />}
    </>
  )
}
