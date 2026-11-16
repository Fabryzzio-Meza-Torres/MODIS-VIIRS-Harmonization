/** Pure helpers for provinces and capitals (source: juaneladio/peru-geojson, MPL-2.0, boundaries from 2016). */
type Ring = number[][]
type Poly = Ring[]
export interface Capital { name: string; kind: string; lon: number; lat: number }
export interface Province {
  id: string; name: string; department: string; regionId: string | null
  polygons: Poly[]; bbox: [number, number, number, number]; capital: Capital | null
  /** Geodesic area of the (2016, simplified) polygons, km². Not an official figure. */
  areaKm2: number
}
interface Feat { properties: Record<string, any>; geometry: { type: string; coordinates: any } }

export const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim()
/** Translate source settlement categories at display time; keep geographic names and source data intact. */
export function settlementKindLabel(kind: string, lang: 'en' | 'es' = 'en'): string {
  const labels: Record<string, { en: string; es: string }> = {
    CIUDAD: { en: 'City', es: 'Ciudad' },
    PUEBLO: { en: 'Village', es: 'Pueblo' },
    VILLA: { en: 'Town', es: 'Villa' },
  }
  return labels[strip(kind)]?.[lang] ?? (lang === 'es' ? 'Centro poblado' : 'Settlement')
}
const polysOf = (g: Feat['geometry']): Poly[] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)

const R_KM = 6371.0088 // mean Earth radius
/** Spherical polygon area (Chamberlain–Duquette): |Σ (λ2−λ1)(2 + sin φ1 + sin φ2)| · R² / 2, in km². */
export function ringAreaKm2(ring: Ring): number {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]
    s += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180))
  }
  return Math.abs((s * R_KM * R_KM) / 2)
}
/** Outer ring minus holes, summed over the polygons of a MultiPolygon. */
export const polygonsAreaKm2 = (polys: Poly[]) =>
  polys.reduce((t, p) => t + ringAreaKm2(p[0]) - p.slice(1).reduce((h, r) => h + ringAreaKm2(r), 0), 0)

function inRing(x: number, y: number, ring: Ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
/** Ray casting; holes (inner rings) are respected. */
export const pointInPolygons = (lon: number, lat: number, polys: Poly[]) =>
  polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)))
export const pointInProvince = (lon: number, lat: number, p: Province) =>
  lon >= p.bbox[0] && lon <= p.bbox[2] && lat >= p.bbox[1] && lat <= p.bbox[3] && pointInPolygons(lon, lat, p.polygons)

/**
 * The source splits some provinces into fragments that share an id but carry typos in the name
 * (e.g. "PUIRA", "VICTOR FAFARDO"): group by id and keep the name of the largest fragment.
 * Capitals are joined by point-in-polygon because two of them spell the province name differently.
 */
export function buildProvinces(provinces: { features: Feat[] }, capitals: { features: Feat[] }, regionIdByName: Record<string, string>): Province[] {
  const byId = new Map<string, { feats: Feat[] }>()
  for (const f of provinces.features) {
    const id = String(f.properties.FIRST_IDPR)
    byId.set(id, { feats: [...(byId.get(id)?.feats ?? []), f] })
  }
  const out: Province[] = [...byId.entries()].map(([id, { feats }]) => {
    const polygons = feats.flatMap((f) => polysOf(f.geometry))
    const main = [...feats].sort((a, b) => b.properties.ha - a.properties.ha)[0]
    const pts = polygons.flatMap((p) => p[0])
    const department = strip(main.properties.FIRST_NOMB)
    return {
      id, name: main.properties.NOMBPROV, department, regionId: regionIdByName[department] ?? null, polygons, capital: null,
      areaKm2: polygonsAreaKm2(polygons),
      bbox: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
    }
  })
  for (const c of capitals.features) {
    const [lon, lat] = c.geometry.coordinates as number[]
    const prov = out.find((p) => !p.capital && pointInProvince(lon, lat, p))
    if (prov) prov.capital = { name: c.properties.CAPITAL, kind: c.properties.NOMCAT02, lon, lat }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Union bounding box "minLon,minLat,maxLon,maxLat" (4 decimals) of a set of provinces. */
export const unionBbox = (provs: Province[]): string | null =>
  provs.length
    ? [Math.min(...provs.map((p) => p.bbox[0])), Math.min(...provs.map((p) => p.bbox[1])), Math.max(...provs.map((p) => p.bbox[2])), Math.max(...provs.map((p) => p.bbox[3]))]
      .map((n, i) => (i < 2 ? Math.floor(n * 1e4) / 1e4 : Math.ceil(n * 1e4) / 1e4)).join(',') // rounded outwards: never cuts a province
    : null

/**
 * Each item goes to AT MOST ONE province: the first, in the given order, whose polygon contains its point.
 * Items inside none go to `outside` (neighbouring territory inside the bbox, or gaps of the simplified borders).
 * Invariant (tested): Σ byProvince + outside = items.length.
 */
export function assignToProvinces<T extends { lon: number; lat: number }>(items: T[], provinces: Province[]) {
  const byProvince = new Map<string, T[]>(provinces.map((p) => [p.id, []]))
  const outside: T[] = []
  for (const it of items) {
    const hit = provinces.find((p) => pointInProvince(it.lon, it.lat, p))
    if (hit) byProvince.get(hit.id)!.push(it)
    else outside.push(it)
  }
  return { byProvince, outside }
}
