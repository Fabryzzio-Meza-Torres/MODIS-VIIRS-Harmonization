import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { fetchGeometry } from './api'
import { getLang, t } from './i18n'
import type { Detection, EventRow } from './events'
import type { Province } from './lib/geo'
import { settlementKindLabel } from './lib/geo'
import { COLORS, fmt, makeRamp, NO_DATA, RAMP } from './ui'

const PERU: L.LatLngBoundsLiteral = [[-18.5, -81.5], [0.1, -68.5]]
const ZERO = '#17334D' // a real zero (no events) is not "no data"
const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))

interface Props {
  /** Department values (harmonized series). */
  values: Record<string, number | null>
  label: string
  selected: string | null
  onSelect: (regionId: string | null) => void
  regionName?: (id: string) => string
  /** Provinces of the selected department: drawn with their capitals as soon as a department is selected. */
  provinces?: Province[]
  selectedProvince?: string | null
  onSelectProvince?: (id: string | null) => void
  /** Optional choropleth by province id (undefined = neutral). */
  provinceValues?: Record<string, number | null>
  provinceLegend?: { title: string; format: (n: number) => string }
  /** Events mode: departments are a quiet backdrop and events are drawn on top. */
  events?: EventRow[]
  selectedEvent?: number | null
  onSelectEvent?: (id: number) => void
  detections?: Detection[]
}

export default function PeruMap({ values, label, selected, onSelect, regionName, provinces, selectedProvince, onSelectProvince, provinceValues, provinceLegend, events, selectedEvent, onSelectEvent, detections }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | undefined>(undefined)
  const geo = useRef<L.GeoJSON | undefined>(undefined)
  const eventLayer = useRef<L.LayerGroup | undefined>(undefined)
  const pickLayer = useRef<L.LayerGroup | undefined>(undefined)
  const provGroup = useRef<L.LayerGroup | undefined>(undefined)
  const provRefs = useRef(new Map<string, { poly: L.GeoJSON; cap: L.CircleMarker | null }>())
  const lastFit = useRef('')
  // handlers and current selection live in refs so layers are never rebuilt just because a callback changed
  const cb = useRef({ onSelect, onSelectProvince, onSelectEvent, selectedProvince })
  cb.current = { onSelect, onSelectProvince, onSelectEvent, selectedProvince }
  const [ready, setReady] = useState(false)

  const provs = provinces ?? []
  const dim = selected != null || events !== undefined // departments only as a backdrop
  const deptRamp = useMemo(() => makeRamp(Object.values(values)), [values])
  const provRamp = useMemo(() => makeRamp(Object.values(provinceValues ?? {})), [provinceValues])

  // 1. Mount once. Selecting a territory never destroys the map.
  useEffect(() => {
    const m = L.map(host.current!, { preferCanvas: true, zoomSnap: 0.25, attributionControl: true })
    m.fitBounds(PERU)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize({ pan: false })) // layout changes without a window resize
    ro.observe(host.current!)
    let live = true
    fetchGeometry().then((fc) => {
      if (!live) return
      geo.current = L.geoJSON(fc, {
        style: { weight: 1, color: '#94A8BD', fillOpacity: 0.6 },
        onEachFeature: (f, layer) => {
          layer.bindTooltip('', { sticky: true })
          layer.on('click', () => cb.current.onSelect(f.properties.region_id))
        },
      }).addTo(m)
      setReady(true)
    })
    return () => { live = false; ro.disconnect(); m.remove() }
  }, [])

  // 2. Departments: harmonized choropleth, or a quiet backdrop once something is selected.
  useEffect(() => {
    if (!ready) return
    geo.current!.eachLayer((l) => {
      const layer = l as L.Path & { feature: GeoJSON.Feature }
      const id = layer.feature.properties!.region_id as string
      const v = values[id] ?? null
      const sel = id === selected
      layer.setStyle({
        fillColor: dim ? NO_DATA : deptRamp.color(v), fillOpacity: dim ? (sel ? 0.08 : 0.25) : 0.75,
        color: sel ? '#14B8A6' : '#94A8BD', weight: sel ? 3 : 0.8, dashArray: !dim && v == null ? '3' : undefined,
      })
      if (sel) layer.bringToFront()
      layer.getTooltip()?.setContent(`${titled(layer.feature.properties!.name)}${dim ? '' : ` · ${v == null ? t('sin estimación', 'no estimate') : fmt.full(v)} (${label})`}`)
    })
  }, [ready, values, selected, deptRamp, dim, label])

  // 3. Provinces of the selected department (built once per department).
  useEffect(() => {
    if (!ready) return
    provGroup.current?.remove()
    provRefs.current.clear()
    if (!provs.length) return
    const group = L.layerGroup()
    for (const p of provs) {
      const poly = L.geoJSON({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: p.polygons } } as GeoJSON.Feature)
        .bindTooltip('', { sticky: true })
        .on('click', () => cb.current.onSelectProvince?.(cb.current.selectedProvince === p.id ? null : p.id)).addTo(group)
      const cap = p.capital
        ? L.circleMarker([p.capital.lat, p.capital.lon], { radius: 3.5, weight: 1.5, color: '#F4F7FB', fillColor: '#38BDF8', fillOpacity: 1 })
          .on('click', () => cb.current.onSelectProvince?.(p.id)).addTo(group)
        : null
      provRefs.current.set(p.id, { poly, cap })
    }
    group.addTo(map.current!)
    provGroup.current = group
    eventLayer.current?.eachLayer((l) => (l as L.Path).bringToFront?.())
    pickLayer.current?.eachLayer((l) => (l as L.Path).bringToFront?.())
  }, [ready, provinces]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Province style: neutral, or choropleth; the selected one in amber.
  useEffect(() => {
    if (!ready) return
    for (const p of provs) {
      const r = provRefs.current.get(p.id)
      if (!r) continue
      const sel = p.id === selectedProvince
      const v = provinceValues ? provinceValues[p.id] ?? null : undefined
      const fill = v === undefined ? '#17334D' : v === null ? NO_DATA : v === 0 ? ZERO : provRamp.color(v)
      r.poly.setStyle({
        color: sel ? '#FBBF24' : '#67D8F2', weight: sel ? 3 : 1.2, fillColor: fill,
        fillOpacity: v === undefined ? (sel ? 0.3 : 0.18) : sel ? 0.9 : selectedProvince ? 0.45 : 0.75,
      })
      if (sel) r.poly.eachLayer((l) => (l as L.Path).bringToFront?.())
      const value = v === undefined || v === null || !provinceLegend ? '' : ` · ${provinceLegend.format(v)}`
      r.poly.getTooltip()?.setContent(`${titled(p.name)} · ${t('provincia', 'province')}${value}`)
      if (r.cap) {
        const text = `${titled(p.capital!.name)} · ${t('capital de', 'capital of')} ${titled(p.name)} (${settlementKindLabel(p.capital!.kind, getLang())})`
        r.cap.setRadius(sel ? 6 : 3.5).unbindTooltip().bindTooltip(text, { permanent: sel, direction: 'top', offset: [0, -6] })
        if (sel) r.cap.bringToFront()
      }
    }
  }, [ready, provinces, selectedProvince, provinceValues, provRamp, provinceLegend]) // eslint-disable-line react-hooks/exhaustive-deps

  // 5. Smooth framing of the current territory (country → department → province), only when that territory changes.
  useEffect(() => {
    if (!ready) return
    const key = `${selected}|${selectedProvince}|${provs.length}`
    if (key === lastFit.current) return
    lastFit.current = key
    const m = map.current!
    const sel = provs.find((p) => p.id === selectedProvince)
    let b: L.LatLngBoundsLiteral = PERU
    if (sel) b = [[sel.bbox[1], sel.bbox[0]], [sel.bbox[3], sel.bbox[2]]]
    else if (selected && provs.length) b = [[Math.min(...provs.map((p) => p.bbox[1])), Math.min(...provs.map((p) => p.bbox[0]))], [Math.max(...provs.map((p) => p.bbox[3])), Math.max(...provs.map((p) => p.bbox[2]))]]
    else if (selected) geo.current!.eachLayer((l) => { const ly = l as L.Polygon & { feature: GeoJSON.Feature }; if (ly.feature.properties!.region_id === selected) { const lb = ly.getBounds(); b = [[lb.getSouth(), lb.getWest()], [lb.getNorth(), lb.getEast()]] } })
    // reserve room for the breadcrumb (top) and the legend (bottom) so neither covers the territory
    m.fitBounds(b, { paddingTopLeft: [30, 54], paddingBottomRight: [30, 112], maxZoom: 11, animate: true, duration: 0.6 })
  }, [ready, selected, selectedProvince, provinces]) // eslint-disable-line react-hooks/exhaustive-deps

  // 6. Event representative points: one marker per event, not per detection.
  useEffect(() => {
    if (!ready) return
    eventLayer.current?.remove()
    if (!events?.length) return
    const group = L.layerGroup()
    for (const e of events) {
      L.circleMarker([e.lat, e.lon], { radius: 5, weight: 1, color: '#F4F7FB', fillColor: '#F97316', fillOpacity: 0.9 })
        .bindTooltip(`${t('Evento', 'Event')} ${e.event_id} · ${e.n_det} ${t('detecciones', 'detections')}`)
        .on('click', () => cb.current.onSelectEvent?.(e.event_id)).addTo(group)
    }
    group.addTo(map.current!)
    eventLayer.current = group
  }, [ready, events])

  // 7. Selected event: its bounding box and its individual detections (small dots by instrument).
  useEffect(() => {
    if (!ready) return
    pickLayer.current?.remove()
    const e = events?.find((x) => x.event_id === selectedEvent)
    if (!e) return
    const group = L.layerGroup()
    const pad = 0.003
    L.rectangle([[e.lat_min - pad, e.lon_min - pad], [e.lat_max + pad, e.lon_max + pad]], { color: '#14B8A6', weight: 1.5, dashArray: '4 3', fill: false }).addTo(group)
    L.circleMarker([e.lat, e.lon], { radius: 9, weight: 2.5, color: '#14B8A6', fill: false }).addTo(group)
    for (const d of detections ?? []) {
      L.circleMarker([d.lat, d.lon], { radius: 3, stroke: false, fillOpacity: 1, fillColor: d.instrument === 'MODIS' ? COLORS.MODIS : COLORS.VIIRS })
        .bindTooltip(`${d.instrument} · ${d.satellite} · ${fmt.utc(d.t_utc)}${d.frp != null ? ` · FRP ${d.frp} MW` : ''}`).addTo(group)
    }
    group.addTo(map.current!)
    pickLayer.current = group
    map.current!.flyToBounds([[e.lat_min, e.lon_min], [e.lat_max, e.lon_max]], { maxZoom: 12, padding: [60, 60], duration: 0.6 })
  }, [ready, events, selectedEvent, detections])

  const up = () => { if (selectedProvince) onSelectProvince?.(null); else if (selected) onSelect(null) }
  const selProv = provs.find((p) => p.id === selectedProvince)
  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === 'Escape') up() }}>
      <div ref={host} tabIndex={0} role="application" aria-label={`${t('Mapa del Perú', 'Map of Peru')}: ${label}. ${t('Escape sube un nivel.', 'Escape goes up one level.')}`} className="h-[420px] w-full rounded-lg border border-line md:h-[520px]" />
      {selected && (
        <nav aria-label={t('Territorio', 'Territory')} className="absolute left-14 top-3 z-[500] flex max-w-[calc(100%-4.5rem)] flex-wrap items-center gap-1 rounded-md border border-line bg-panel/90 px-2.5 py-1.5 text-xs backdrop-blur">
          <button onClick={() => onSelect(null)} className="text-sky hover:underline">{t('Perú', 'Peru')}</button>
          <span aria-hidden className="text-muted">›</span>
          {selProv ? <button onClick={() => onSelectProvince?.(null)} className="text-sky hover:underline">{regionName?.(selected) ?? selected}</button>
            : <span aria-current="page" className="text-ink">{regionName?.(selected) ?? selected}</span>}
          {selProv && <><span aria-hidden className="text-muted">›</span><span aria-current="page" className="text-ink">{titled(selProv.name)}</span></>}
        </nav>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-md border border-line bg-panel/90 px-3 py-2 text-xs backdrop-blur">
        {events !== undefined ? (
          <ul className="space-y-1 text-muted">
            <li className="flex items-center gap-2"><span className="inline-block size-3 rounded-full border border-ink bg-fire" />{t('Evento: punto representativo', 'Event: representative point')}</li>
            <li className="flex items-center gap-2"><span className="inline-block size-2 rounded-full" style={{ background: COLORS.MODIS }} />{t('Detección MODIS (evento elegido)', 'MODIS detection (chosen event)')}</li>
            <li className="flex items-center gap-2"><span className="inline-block size-2 rounded-full" style={{ background: COLORS.VIIRS }} />{t('Detección VIIRS (evento elegido)', 'VIIRS detection (chosen event)')}</li>
            {provs.length > 0 && <li className="flex items-center gap-2"><span className="inline-block size-3 rounded-sm border border-viirs" />{t('Provincia', 'Province')}</li>}
            {provs.length > 0 && <li className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full border border-ink bg-sky" />{t('Capital de provincia', 'Province capital')}</li>}
          </ul>
        ) : provs.length > 0 && provinceValues && provinceLegend ? (
          <>
            <div className="mb-1 text-muted">{provinceLegend.title}</div>
            <div className="flex"><div className="h-2.5 w-7" style={{ background: ZERO }} title={t('0: sin eventos', '0: no events')} />{RAMP.map((c, i) => <div key={c} className="h-2.5 w-7" style={{ background: c }} title={`≥ ${provinceLegend.format(provRamp.breaks[i])}`} />)}</div>
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted"><span>0</span><span>{provinceLegend.format(provRamp.breaks[RAMP.length - 1])}+</span></div>
            <div className="mt-1.5 flex items-center gap-1.5 text-muted"><span className="inline-block size-2.5 rounded-full border border-ink bg-sky" />{t('Capital de provincia', 'Province capital')}</div>
          </>
        ) : provs.length > 0 ? (
          <ul className="space-y-1 text-muted">
            <li className="flex items-center gap-2"><span className="inline-block size-3 rounded-sm border border-viirs" />{t('Provincia', 'Province')}</li>
            <li className="flex items-center gap-2"><span className="inline-block size-2.5 rounded-full border border-ink bg-sky" />{t('Capital de provincia', 'Province capital')}</li>
          </ul>
        ) : (
          <>
            <div className="mb-1 text-muted">{label}</div>
            <div className="flex">{RAMP.map((c, i) => <div key={c} className="h-2.5 w-7" style={{ background: c }} title={`≥ ${fmt.n(deptRamp.breaks[i])}`} />)}</div>
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted"><span>{fmt.n(deptRamp.breaks[0])}</span><span>{fmt.n(deptRamp.breaks[RAMP.length - 1])}+</span></div>
            <div className="mt-1.5 flex items-center gap-1.5 text-muted"><span className="inline-block h-2.5 w-3 border border-dashed border-muted" style={{ background: NO_DATA }} />{t('Sin estimación', 'No estimate')}</div>
          </>
        )}
      </div>
    </div>
  )
}
