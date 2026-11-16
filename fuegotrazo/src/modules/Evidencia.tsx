import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../api'
import { evidenceURL, fetchEvidenceSummary, fetchEvidenceYear, officialRecordURL, type EvidenceCase, type EvidenceSummary, type Witness } from '../lib/evidence'
import { strip } from '../lib/geo'
import { useApp, useAsync } from '../state'
import { Card, Empty, ErrorBox, fmt, Loading, PageHeader, Select } from '../ui'

const PAGE_SIZE = 10
const pct = (n: number) => (100 * n).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' %'
const RESULT = { both: 'MODIS y VIIRS', modis: 'MODIS', viirs: 'VIIRS', none: '' }

function WitnessDetail({ value, source }: { value: Witness; source: string }) {
  const rows = [['Detección · hora de Lima', fmt.lima(value.timestamp_utc)], ['Fecha del registro', fmt.date(value.registry_date)],
    ['Distancia al punto reportado', value.distance_geodesic_km.toFixed(2) + ' km · WGS84'],
    ['Diferencia de fecha', String(value.calendar_day_difference) + ' días'],
    ['Punto reportado · latitud, longitud', value.registry_latitude.toFixed(5) + ', ' + value.registry_longitude.toFixed(5)],
    ['Detección · latitud, longitud', value.satellite_latitude.toFixed(5) + ', ' + value.satellite_longitude.toFixed(5)]]
  return <div>
    <h4 className="mb-3 text-sm font-semibold">{value.instrument} · {value.platform}</h4>
    <dl className="space-y-2 text-xs">{rows.map(([term, text]) => <div key={term}><dt className="text-muted">{term}</dt><dd className="break-words text-ink">{text}</dd></div>)}</dl>
    <a href={officialRecordURL(source, [value.registry_object_id])} className="mt-3 inline-block text-sm text-sky underline" target="_blank" rel="noreferrer">Consultar registro oficial {value.registry_object_id}</a>
    <p className="mt-2 break-all text-xs text-muted">Archivo FIRMS: {value.source_member} · source_row {value.source_row}</p>
  </div>
}
function Example({ item, source }: { item: EvidenceCase; source: string }) {
  return <details className="border-b border-line py-4" data-testid="evidence-example">
    <summary className="cursor-pointer list-inside text-sm">
      <span className="font-medium">{item.departments.join(' / ')} · {fmt.date(item.date_start)}</span>
      <span className="ml-3 inline-block text-xs text-sky">{RESULT[item.match_status]}</span>
      <span className="mt-1 block pl-4 text-xs text-muted">{item.reference_codes.length ? 'Código ' + item.reference_codes.join(', ') : 'Registro ' + item.registry_object_ids[0]}</span>
    </summary>
    <div className="mt-4 pl-4">
      <p className="mb-4 max-w-[75ch] text-sm text-muted">Registro atribuido a INDECI · fuente informada: {item.source_labels.join(', ')}. {item.registry_locations} ubicación(es) agrupadas en una referencia. El punto reportado puede representar el lugar de reporte o un área afectada, no la ubicación exacta de ignición.</p>
      <div className="grid gap-6 sm:grid-cols-2">{item.matches.map((m) => <WitnessDetail key={m.instrument} value={m} source={source} />)}</div>
      <p className="mt-4 max-w-[75ch] text-xs text-muted">Se muestra la detección más cercana que satisface el criterio para cada instrumento. La proximidad en espacio y tiempo no demuestra que sea el mismo incendio.</p>
    </div>
  </details>
}
function AssociationTable({ summary }: { summary: EvidenceSummary }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <caption className="mb-3 text-left text-xs text-muted">Perú · referencias atribuidas a INDECI · 5 km y ±3 días · 2013–2025</caption>
    <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="py-2 pr-4">Instrumento</th><th scope="col" className="pr-4">Coincidencias / referencias</th><th scope="col" className="pr-4">Fecha 28 días antes</th><th scope="col">Fecha 28 días después</th></tr></thead>
    <tbody>{['MODIS', 'VIIRS'].map((instrument) => {
      const find = (shift: number) => summary.associations.find((r) => r.instrument === instrument && r.origin === 'INDECI' && r.radius_km === 5 && r.date_shift_days === shift)!
      const main = find(0)
      return <tr key={instrument} className="border-b border-line"><th scope="row" className="py-3 pr-4 font-medium">{instrument}</th><td className="pr-4">{fmt.full(main.with_satellite_record)} / {fmt.full(main.incident_references)} · <span className="whitespace-nowrap">{pct(main.association_fraction)}</span></td><td className="whitespace-nowrap pr-4">{pct(find(-28).association_fraction)}</td><td className="whitespace-nowrap">{pct(find(28).association_fraction)}</td></tr>
    })}</tbody>
  </table></div>
}

export default function Evidencia() {
  const { filters, regionName } = useApp()
  const summaryQ = useAsync(fetchEvidenceSummary, [])
  const summary = summaryQ.data
  const [selectedYear, setYear] = useState('')
  const [instrument, setInstrument] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const years = [...(summary?.years ?? [])].sort((a, b) => b.year - a.year)
  const year = selectedYear || String(years[0]?.year ?? '')
  const entry = summary?.years.find((y) => String(y.year) === year)
  const yearQ = useAsync((signal) => entry ? fetchEvidenceYear(entry, signal) : Promise.resolve(null), [year, entry?.sha256])
  const ready = yearQ.data?.year === Number(year) && !yearQ.loading ? yearQ.data.data : []
  const examples = useMemo(() => ready.filter((r) =>
    (!filters.region || r.departments.some((name) => strip(name) === strip(regionName(filters.region)))) &&
    (instrument === 'all' || r.match_status === instrument) &&
    (!search.trim() || (r.id + ' ' + r.reference_codes.join(' ') + ' ' + r.registry_object_ids.join(' ')).toLowerCase().includes(search.trim().toLowerCase()))),
  [ready, filters.region, regionName, instrument, search])
  useEffect(() => setPage(0), [year, instrument, search, filters.region])
  const lastPage = Math.max(0, Math.ceil(examples.length / PAGE_SIZE) - 1)
  const shownPage = Math.min(page, lastPage)
  const shown = examples.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE)
  return <>
    <PageHeader title="Validación y fuentes" subtitle="Registros oficiales, detecciones satelitales y criterios que puedes comprobar. El contraste histórico y la evaluación del pronóstico responden preguntas distintas." />
    {summaryQ.error ? <ErrorBox error={summaryQ.error} retry={summaryQ.retry} /> : !summary ? <Loading label="Verificando las fuentes y el catálogo…" /> : <div className="space-y-5">
      <Card title="Coincidencias históricas con registros oficiales" subtitle="Asociación entre lugar y fecha del registro y detecciones cercanas. No representa una tasa de acierto del pronóstico ni una atribución confirmada del incendio.">
        <AssociationTable summary={summary} />
        <p className="mt-4 max-w-[78ch] text-sm text-muted">Se fijó una misma regla: hasta 5 km del punto reportado y ±3 días completos del calendario local. En los controles se conserva el lugar y se desplaza la fecha 28 días. Son comparaciones descriptivas; los controles no son periodos demostrados libres de fuego. Los instrumentos pueden coincidir con una misma referencia, por lo que sus conteos no se suman.</p>
      </Card>
      <Card title="Ejemplos con coincidencia documentada" subtitle={(summary.catalog_status_counts.both + summary.catalog_status_counts.modis + summary.catalog_status_counts.viirs).toLocaleString('es-PE') + ' referencias con coincidencia en el periodo completo. Esta galería muestra ejemplos de asociación, no una muestra para estimar precisión.'}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Select label="Año del catálogo" value={year} onChange={setYear} options={years.map((y) => ({ value: String(y.year), label: String(y.year) }))} />
          <Select label="Coincidencia" value={instrument} onChange={setInstrument} options={[{ value: 'all', label: 'Todas las coincidencias' }, { value: 'both', label: 'MODIS y VIIRS' }, { value: 'modis', label: 'Solo MODIS' }, { value: 'viirs', label: 'Solo VIIRS' }]} />
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">Código o ID oficial<input value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink" type="search" maxLength={100} placeholder="Buscar una referencia" /></label>
        </div>
        <p className="mb-3 text-xs text-muted">Departamento: {regionName(filters.region)} · el filtro superior cambia los ejemplos; la tabla global de asociación conserva su periodo completo.</p>
        {yearQ.error ? <ErrorBox error={yearQ.error} retry={yearQ.retry} /> : yearQ.loading || !yearQ.data || yearQ.data.year !== Number(year) ? <Loading label="Verificando la integridad de los ejemplos…" />
          : shown.length === 0 ? <Empty>No hay ejemplos publicados para esta selección. Prueba otro año o departamento.</Empty>
          : <><p role="status" aria-live="polite" className="text-xs text-muted">{examples.length.toLocaleString('es-PE')} ejemplos con estos filtros · página {shownPage + 1} de {lastPage + 1}</p><div>{shown.map((item) => <Example key={item.id} item={item} source={summary.source_url} />)}</div>
            <div className="mt-4 flex items-center justify-center gap-4"><button className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>Anterior</button><span className="text-xs text-muted">{shownPage + 1} / {lastPage + 1}</span><button className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40" disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)}>Siguiente</button></div></>}
      </Card>
      <Card title="Un incendio documentado: Dos de Mayo, Curimaná · 2019">
        <p className="max-w-[78ch] text-sm">El reporte COEN–INDECI n.º 2027 documenta un incendio entre el 31 de agosto y el 2 de septiembre de 2019. En el criterio exploratorio de 2 km durante el intervalo reportado se encontraron {summary.case_study.primary_counts_by_platform['Suomi-NPP']} detecciones Suomi-NPP/VIIRS; la más próxima, a {(summary.case_study.primary_min_distance_m / 1000).toFixed(2)} km de la referencia de localidad.</p>
        <p className="mt-3 max-w-[78ch] text-sm text-muted">La referencia procede de vértices de ribera de ANA junto al centro poblado. No es un perímetro ni una coordenada verificada del fuego. El resultado es compatible en espacio y tiempo; no atribuye esas detecciones al incendio documentado.</p>
        <p className="mt-4 flex flex-wrap gap-4 text-sm"><a className="text-sky underline" href={summary.case_study.report_source} target="_blank" rel="noreferrer">Reporte oficial COEN–INDECI</a><a className="text-sky underline" href={evidenceURL('documents/reporte_indeci_2027_2019.pdf')} target="_blank" rel="noreferrer">Copia con hash verificado</a><a className="text-sky underline" href={summary.case_study.ANA_source} target="_blank" rel="noreferrer">Referencia geográfica ANA</a></p>
      </Card>
      <Card title="Qué valida este contraste y qué queda pendiente">
        <ul className="max-w-[78ch] list-disc space-y-3 pl-5 text-sm text-muted"><li>Permite localizar asociaciones históricas con registros atribuidos a INDECI. Una referencia agrupada no equivale necesariamente a un incendio físico independiente.</li><li>La independencia del registro respecto de imágenes y alertas satelitales no está establecida. Las fuentes pueden compartir información.</li><li>La armonización compara respuestas de instrumentos. La correlación con registros no demuestra por sí sola que su escala sea correcta.</li><li>El pronóstico actual tiene una evaluación retrospectiva separada. Esta galería no confirma el resultado de una semana futura.</li></ul>
        <p className="mt-4 text-sm"><a href="#pronostico" className="text-sky underline">Consultar el pronóstico, su referencia histórica y su evaluación</a></p>
        <details className="mt-5 border-t border-line pt-4 text-sm"><summary className="cursor-pointer font-medium">Procedencia e integridad de los datos</summary><div className="mt-3 max-w-[85ch] space-y-3 text-xs text-muted"><p>Snapshot oficial MINAM: {summary.source_snapshot.rows.toLocaleString('es-PE')} filas; descarga {fmt.lima(summary.source_snapshot.downloaded_at_utc)}. Al preparar el catálogo se cotejaron {summary.live_source_verification.sample_rows} registros, uno por año, con el servicio oficial. Es una comprobación muestral, no una revisión en vivo de todas las filas.</p><p className="break-all">SHA-256 del archivo fuente: {summary.source_snapshot.csv_sha256}</p><p>La descarga anual se verifica mediante SHA-256 antes de mostrar los ejemplos. Se conserva el análisis completo para auditoría; la galería selecciona las referencias con asociación.</p><p className="flex flex-wrap gap-4"><a className="text-sky underline" href={summary.source_url + '?f=pjson'} target="_blank" rel="noreferrer">Servicio oficial MINAM</a><a className="text-sky underline" href="https://github.com/Fabryzzio-Meza-Torres/MODIS-VIIRS-Harmonization/blob/main/docs/WEB_VALIDATION.md" target="_blank" rel="noreferrer">Metodología y reproducción</a><a className="text-sky underline" href={API_BASE + '/docs'} target="_blank" rel="noreferrer">API y versiones</a></p></div></details>
      </Card>
    </div>}
  </>
}
