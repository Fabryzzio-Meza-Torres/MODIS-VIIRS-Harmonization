import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchMetadata, fetchRegions, fetchSeries, SERIES_END_EXCL, SERIES_START, type Region } from './api'
import { monthKey, rollup, weekly, yearKey, type Period } from './lib/aggregate'
import { pick } from './ui'
import { buildProvinces, strip, type Province } from './lib/geo'

export const ROUTES = ['panorama', 'calendario', 'mapa', 'tendencias', 'prevencion', 'pronostico', 'laboratorio', 'validacion', 'planes', 'apoyo', 'informes'] as const
export type Route = (typeof ROUTES)[number]
export type Indicator = 'combined' | 'MODIS' | 'VIIRS'
export interface Filters { region: string | null; province: string | null; y0: number; y1: number; indicator: Indicator }

const DEFAULTS: Filters = { region: null, province: null, y0: 2019, y1: 2025, indicator: 'combined' }
const INDICATORS: Indicator[] = ['combined', 'MODIS', 'VIIRS']

function parse(): { route: Route; filters: Filters } {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?')
  const q = new URLSearchParams(query)
  const route = (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'panorama'
  const y = (k: string, d: number) => { const n = parseInt(q.get(k) ?? '', 10); return Number.isFinite(n) ? n : d }
  const ind = q.get('ind') as Indicator
  const y0 = Math.max(2001, Math.min(2026, y('y0', DEFAULTS.y0)))
  const y1 = Math.max(y0, Math.min(2026, y('y1', DEFAULTS.y1)))
  return { route, filters: { region: q.get('region') || null, province: q.get('region') ? q.get('prov') || null : null, y0, y1, indicator: INDICATORS.includes(ind) ? ind : DEFAULTS.indicator } }
}

function write(route: Route, f: Filters) {
  const q = new URLSearchParams()
  if (f.region) q.set('region', f.region)
  if (f.region && f.province) q.set('prov', f.province)
  if (f.y0 !== DEFAULTS.y0) q.set('y0', String(f.y0))
  if (f.y1 !== DEFAULTS.y1) q.set('y1', String(f.y1))
  if (f.indicator !== DEFAULTS.indicator) q.set('ind', f.indicator)
  const s = q.toString()
  location.hash = s ? `${route}?${s}` : route
}

/** `fn` receives an AbortSignal that is aborted when deps change or the component unmounts. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data?: T; loading: boolean; error?: Error }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const ctl = new AbortController()
    set((p) => ({ data: p.data, loading: true }))
    fn(ctl.signal).then((data) => !ctl.signal.aborted && set({ data, loading: false }), (error) => !ctl.signal.aborted && set({ loading: false, error }))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...s, retry: () => setTick((t) => t + 1) }
}

type SeriesResult = { weeks: Period[]; months: Period[]; years: Period[] }
const seriesCache = new Map<string, SeriesResult>() // resolved histories, so revisiting a territory shows no loader

/** Full history of one territory (null = Perú), derived weekly → monthly → annual. */
export function useSeries(regionId: string | null) {
  const key = regionId ?? 'PE'
  const r = useAsync(async () => {
    const hit = seriesCache.get(key)
    if (hit) return { key, ...hit }
    const { rows } = await fetchSeries(regionId, SERIES_START, SERIES_END_EXCL)
    const weeks = weekly(rows)
    const res = { weeks, months: rollup(weeks, monthKey), years: rollup(weeks, yearKey) }
    seriesCache.set(key, res)
    return { key, ...res }
  }, [key])
  // never show another territory's data under this territory's title
  const ready = seriesCache.get(key) ?? (r.data && r.data.key === key ? r.data : undefined)
  return { weeks: ready?.weeks ?? [], months: ready?.months ?? [], years: ready?.years ?? [], loading: !ready && !r.error, error: ready ? undefined : r.error, retry: r.retry }
}

interface Ctx {
  route: Route; go: (r: Route) => void
  filters: Filters; setFilters: (p: Partial<Filters>) => void
  regions: Region[]; meta: { series: any; forecast: any } | undefined
  regionName: (id: string | null) => string
}
const AppCtx = createContext<Ctx | null>(null)
export const useApp = () => useContext(AppCtx)!

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(parse)
  useEffect(() => {
    const on = () => setState(parse())
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const regions = useAsync(fetchRegions, []).data ?? []
  const meta = useAsync(fetchMetadata, []).data
  const titled = (s: string) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'))
  const value: Ctx = {
    route: state.route, filters: state.filters, regions, meta,
    go: (r) => write(r, state.filters),
    setFilters: (p) => {
      const f = { ...state.filters, ...p }
      if (p.region !== undefined && p.region !== state.filters.region && p.province === undefined) f.province = null // a province belongs to one department
      f.y1 = Math.max(f.y0, f.y1)
      write(state.route, f)
    },
    regionName: (id) => (id ? titled(regions.find((r) => r.region_id === id)?.name ?? id) : 'Todo el Perú'),
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

/** Period total of the selected indicator for every department (weeks counted by their Monday). */
export function useRegionTotals() {
  const { regions, filters } = useApp()
  const { y0, y1, indicator } = filters
  const r = useAsync(async () => {
    const entries = await Promise.all(regions.map(async (reg) => {
      const { rows } = await fetchSeries(reg.region_id, `${y0}-01-01`, `${y1 + 1}-01-01`)
      let sum: number | null = null
      for (const p of weekly(rows)) {
        if (p.key < `${y0}-01-01` || p.key >= `${y1 + 1}-01-01`) continue
        const v = pick(p, indicator)
        if (v != null) sum = (sum ?? 0) + v
      }
      return [reg.region_id, sum] as const
    }))
    return Object.fromEntries(entries) as Record<string, number | null>
  }, [regions.length, y0, y1, indicator])
  return { totals: r.data, loading: r.loading, error: r.error, retry: r.retry }
}

// Provinces and capitals: static files in /public/geo (juaneladio/peru-geojson, MPL-2.0), fetched once.
let geoFiles: Promise<[any, any]> | null = null
const loadGeoFiles = () => (geoFiles ??= Promise.all(['peru_provincial_simple', 'peru_capital_provincia'].map((f) =>
  fetch(`/geo/${f}.geojson`).then((r) => { if (!r.ok) throw new Error(`No se pudo cargar ${f} (${r.status})`); return r.json() }))) as Promise<[any, any]>)

export function useProvinces() {
  const { regions } = useApp()
  const r = useAsync(async () => {
    const [prov, cap] = await loadGeoFiles()
    const byName: Record<string, string> = {}
    for (const reg of regions) byName[strip(reg.name)] = reg.region_id
    return buildProvinces(prov, cap, byName)
  }, [regions.length])
  return { provinces: (r.data ?? []) as Province[], loading: r.loading || regions.length === 0, error: r.error, retry: r.retry }
}
