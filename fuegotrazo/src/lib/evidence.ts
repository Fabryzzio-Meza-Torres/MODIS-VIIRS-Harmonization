/** Read-only historical evidence. Association is not incident attribution. */
import { API_BASE } from '../api'

export interface Witness {
  instrument: 'MODIS' | 'VIIRS'; platform: string; timestamp_utc: string
  registry_object_id: number; registry_date: string; registry_longitude: number; registry_latitude: number
  satellite_longitude: number; satellite_latitude: number; distance_projected_km: number; distance_geodesic_km: number
  calendar_day_difference: number; source_member: string; source_row: number
}
export interface EvidenceCase {
  id: string; year: number; date_start: string; date_end: string; departments: string[]
  registry_object_ids: number[]; registry_locations: number; reference_codes: string[]; source_labels: string[]
  match_status: 'both' | 'modis' | 'viirs' | 'none'; matches: Witness[]
}
export interface EvidenceSummary {
  source_url: string; catalog_references: number; catalog_status_counts: Record<string, number>
  years: { year: number; file: string; compressed_file: string; sha256: string; bytes: number; references: number }[]
  associations: { instrument: string; origin: string; radius_km: number; calendar_day_half_window: number; date_shift_days: number; incident_references: number; with_satellite_record: number; association_fraction: number }[]
  live_source_verification: { sample_rows: number; checked_at: string }
  source_snapshot: { rows: number; downloaded_at_utc: string; csv_sha256: string }
  case_study: { report_source: string; ANA_source: string; primary_counts_by_platform: Record<string, number>; primary_min_distance_m: number; document_hashes: { file: string; sha256: string }[] }
}
export const evidenceURL = (file: string) => new URL('/visor/validation-data/' + file, API_BASE).toString()
export async function fetchEvidenceSummary(signal?: AbortSignal): Promise<EvidenceSummary> {
  const response = await fetch(evidenceURL('summary.json'), { signal })
  if (!response.ok) throw new Error('No se pudo verificar el catálogo de evidencia.')
  return response.json()
}
export function matchingExamples(records: EvidenceCase[]): EvidenceCase[] {
  return records.filter((r) => r.matches.length > 0 && ['both', 'modis', 'viirs'].includes(r.match_status))
}
export async function fetchEvidenceYear(entry: EvidenceSummary['years'][number], signal?: AbortSignal): Promise<{ year: number; data: EvidenceCase[] }> {
  const compressed = 'DecompressionStream' in globalThis && !!entry.compressed_file
  const response = await fetch(evidenceURL(compressed ? entry.compressed_file : entry.file), { signal })
  if (!response.ok) throw new Error('No se pudieron cargar los ejemplos de ese año.')
  let raw = await response.arrayBuffer()
  if (compressed) raw = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', raw)
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  if (hash !== entry.sha256 || raw.byteLength !== entry.bytes) throw new Error('El archivo no coincide con la evidencia versionada.')
  const result = JSON.parse(new TextDecoder().decode(raw)) as { year: number; data: EvidenceCase[] }
  if (result.year !== entry.year || result.data.length !== entry.references) throw new Error('El archivo corresponde a otra partición del catálogo.')
  return { year: result.year, data: matchingExamples(result.data) }
}
export function officialRecordURL(source: string, ids: number[]): string {
  const url = new URL(source + '/query')
  if (url.protocol !== 'https:' || url.hostname !== 'geoservidorperu.minam.gob.pe') throw new Error('Fuente oficial no reconocida.')
  url.search = new URLSearchParams({ objectIds: ids.join(','), outFields: 'OBJECTID_1,COD_EMERGE,FEC_EMERGE,FTE_INF,ORIGEN,NOMBDEP', returnGeometry: 'true', outSR: '4326', f: 'pjson' }).toString()
  return url.toString()
}
