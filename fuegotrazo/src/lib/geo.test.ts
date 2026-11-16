import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assignToProvinces, buildProvinces, pointInPolygons, pointInProvince, polygonsAreaKm2, ringAreaKm2, strip, unionBbox } from './geo.ts'
import { EVENT_DEPARTMENT } from './departments.ts'

const load = (f: string) => JSON.parse(readFileSync(new URL(`../../public/geo/${f}.geojson`, import.meta.url), 'utf8'))
const REGIONS: Record<string, string> = {}
for (const [id, name] of Object.entries(EVENT_DEPARTMENT)) REGIONS[strip(name === 'El Callao' ? 'Callao' : name)] = id
const provinces = buildProvinces(load('peru_provinces_simplified'), load('peru_province_capitals'), REGIONS)

test('point in polygon respects holes', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
  assert.equal(pointInPolygons(2, 2, [[square, hole]]), true)
  assert.equal(pointInPolygons(5, 5, [[square, hole]]), false)
  assert.equal(pointInPolygons(11, 5, [[square]]), false)
})

test('provinces: fragments merged by id, every province mapped to one of the 25 regions', () => {
  assert.equal(provinces.length, 195) // 197 features, 2 are typo-named fragments of Piura and Víctor Fajardo
  assert.equal(new Set(provinces.map((p) => p.id)).size, 195)
  assert.equal(provinces.filter((p) => !p.regionId).length, 0)
  assert.ok(provinces.find((p) => p.name === 'PIURA') && !provinces.find((p) => p.name === 'PUIRA'))
  assert.ok(provinces.find((p) => p.name === 'VICTOR FAJARDO') && !provinces.find((p) => p.name === 'VICTOR FAFARDO'))
  assert.equal(new Set(provinces.map((p) => p.regionId)).size, 25)
})

test('capitals: joined by location, each inside its own province; known city lands where expected', () => {
  const withCapital = provinces.filter((p) => p.capital)
  assert.ok(withCapital.length >= 190, `only ${withCapital.length} provinces have a capital`)
  for (const p of withCapital) assert.ok(pointInProvince(p.capital!.lon, p.capital!.lat, p), p.name)
  const cusco = provinces.find((p) => p.name === 'CUSCO' && p.regionId === '08')!
  assert.equal(cusco.capital?.name, 'CUSCO')
  // Plaza de Armas del Cusco is in the Cusco province; Lima's center is not.
  assert.equal(pointInProvince(-71.9675, -13.5164, cusco), true)
  assert.equal(pointInProvince(-77.0428, -12.0464, cusco), false)
  const lima = provinces.find((p) => p.name === 'LIMA')!
  assert.equal(pointInProvince(-77.0428, -12.0464, lima), true)
})

test('area: spherical polygon formula on a known box, holes subtracted, agrees with the source attribute', () => {
  const box = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
  const expected = 6371.0088 ** 2 * (Math.PI / 180) * (Math.sin(Math.PI / 180) - 0) // 1° of longitude × band 0°–1° of latitude
  assert.ok(Math.abs(ringAreaKm2(box) - expected) / expected < 1e-9)
  assert.ok(Math.abs(ringAreaKm2(box) - 12364) / 12364 < 0.005, `${ringAreaKm2(box)} km² for a 1°×1° box at the equator`)
  const hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]
  assert.ok(Math.abs(polygonsAreaKm2([[box, hole]]) - ringAreaKm2(box) * 0.75) / ringAreaKm2(box) < 0.01)
  // the file carries its own hectares per fragment: our independent geodesic area must agree for (almost) every province
  const ha = new Map<string, number>()
  for (const f of load('peru_provinces_simplified').features) ha.set(f.properties.FIRST_IDPR, (ha.get(f.properties.FIRST_IDPR) ?? 0) + f.properties.ha / 100)
  // measured on this file: 10 of 195 provinces differ >2 %, 1 differs >5 % (Yunguyo, 7.7 %); the source computes on the unsimplified polygon
  const rel = (p: (typeof provinces)[number]) => Math.abs(p.areaKm2 / ha.get(p.id)! - 1)
  assert.ok(provinces.every((p) => rel(p) < 0.10), 'a province differs more than 10 % from the source attribute')
  assert.ok(provinces.filter((p) => rel(p) > 0.03).length / provinces.length <= 0.05, 'more than 5 % of provinces differ over 3 %')
  assert.ok(provinces.every((p) => p.areaKm2 > 0))
})

test('assignment: at most one province per point, conservation, capitals fall in their own province', () => {
  const points = provinces.filter((p) => p.capital).map((p) => ({ lon: p.capital!.lon, lat: p.capital!.lat, id: p.id }))
  const far = [{ lon: -60, lat: -3, id: 'far' }, { lon: -90, lat: -10, id: 'sea' }]
  const { byProvince, outside } = assignToProvinces([...points, ...far], provinces)
  const assigned = [...byProvince.values()].reduce((t, v) => t + v.length, 0)
  assert.equal(assigned + outside.length, points.length + far.length) // conservation
  assert.deepEqual(outside.map((o) => o.id).sort(), ['far', 'sea'])
  const seen = new Set<string>()
  for (const [pid, items] of byProvince) for (const it of items) { assert.ok(!seen.has(it.id + it.lon), 'assigned twice'); seen.add(it.id + it.lon); assert.equal(it.id, pid, `capital of ${it.id} landed in ${pid}`) }
})

test('overlap: province polygons essentially do not overlap (grid sample over Peru)', () => {
  let inside = 0, multi = 0
  for (let lon = -81.4; lon <= -68.6; lon += 0.05) for (let lat = -18.4; lat <= 0.1; lat += 0.05) {
    const n = provinces.filter((p) => pointInProvince(lon, lat, p)).length
    if (n >= 1) inside++
    if (n >= 2) multi++
  }
  console.log(`# overlap sample: ${multi} of ${inside} grid points inside provinces fall in ≥2 provinces (${((multi / inside) * 100).toFixed(3)} %)`)
  assert.ok(multi / inside < 0.002, `${multi}/${inside}`)
})

test('unionBbox rounds outwards and contains every province box', () => {
  const dept = provinces.filter((p) => p.regionId === '08')
  const [a, b, c, d] = unionBbox(dept)!.split(',').map(Number)
  for (const p of dept) assert.ok(p.bbox[0] >= a && p.bbox[1] >= b && p.bbox[2] <= c && p.bbox[3] <= d)
  assert.equal(unionBbox([]), null)
})
