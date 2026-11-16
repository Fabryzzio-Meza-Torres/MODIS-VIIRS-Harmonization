import { t, locale } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../api'
import { evidenceURL, fetchEvidenceSummary, fetchEvidenceYear, officialRecordURL, type EvidenceCase, type EvidenceSummary, type Witness } from '../lib/evidence'
import { strip } from '../lib/geo'
import { useApp, useAsync } from '../state'
import { Card, Empty, ErrorBox, fmt, Loading, PageHeader, Select } from '../ui'

const PAGE_SIZE = 10
const pct = (n: number) => (100 * n).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' %'
const resultLabel = (status: EvidenceCase['match_status']) => ({ both: t('MODIS y VIIRS', 'MODIS and VIIRS'), modis: 'MODIS', viirs: 'VIIRS', none: '' })[status]

function WitnessDetail({ value, source }: { value: Witness; source: string }) {
  const rows = [[t("Detección · hora de Lima", "Detection · Lima time"), fmt.lima(value.timestamp_utc)], [t("Fecha del registro", "Record date"), fmt.date(value.registry_date)],
    [t("Distancia al punto reportado", "Distance to reported point"), value.distance_geodesic_km.toFixed(2) + ' km · WGS84'],
    [t("Diferencia de fecha", "Date difference"), String(value.calendar_day_difference) + t(' días', ' days')],
    [t("Punto reportado · latitud, longitud", "Reported point · latitude, longitude"), value.registry_latitude.toFixed(5) + ', ' + value.registry_longitude.toFixed(5)],
    [t("Detección · latitud, longitud", "Detection · latitude, longitude"), value.satellite_latitude.toFixed(5) + ', ' + value.satellite_longitude.toFixed(5)]]
  return <div>
    <h4 className="mb-3 text-sm font-semibold">{value.instrument} · {value.platform}</h4>
    <dl className="space-y-2 text-xs">{rows.map(([term, text]) => <div key={term}><dt className="text-muted">{term}</dt><dd className="break-words text-ink">{text}</dd></div>)}</dl>
    <a href={officialRecordURL(source, [value.registry_object_id])} className="mt-3 inline-block text-sm text-sky underline" target="_blank" rel="noreferrer">{t("Consultar registro oficial", "View official record")} {value.registry_object_id}</a>
    <p className="mt-2 break-all text-xs text-muted">{t("Archivo FIRMS:", "FIRMS file:")} {value.source_member} · {t('fila de origen', 'source row')} {value.source_row}</p>
  </div>
}
function Example({ item, source }: { item: EvidenceCase; source: string }) {
  return <details className="border-b border-line py-4" data-testid="evidence-example">
    <summary className="cursor-pointer list-inside text-sm">
      <span className="font-medium">{item.departments.join(' / ')} · {fmt.date(item.date_start)}</span>
      <span className="ml-3 inline-block text-xs text-sky">{resultLabel(item.match_status)}</span>
      <span className="mt-1 block pl-4 text-xs text-muted">{item.reference_codes.length ? t('Código ', 'Code ') + item.reference_codes.join(', ') : t('Registro ', 'Record ') + item.registry_object_ids[0]}</span>
    </summary>
    <div className="mt-4 pl-4">
      <p className="mb-4 max-w-[75ch] text-sm text-muted">{t('Registro atribuido a INDECI · fuente informada: ', 'Record attributed to INDECI · reported source: ')}{item.source_labels.join(', ')}. {item.registry_locations}{t(' ubicación(es) agrupadas en una referencia. El punto reportado puede representar el lugar de reporte o un área afectada, no la ubicación exacta de ignición.', ' location(s) grouped into one reference. The reported point may represent the reporting location or an affected area, rather than the exact ignition location.')}</p>
      <div className="grid gap-6 sm:grid-cols-2">{item.matches.map((m) => <WitnessDetail key={m.instrument} value={m} source={source} />)}</div>
      <p className="mt-4 max-w-[75ch] text-xs text-muted">{t("Se muestra la detección más cercana que satisface el criterio para cada instrumento. La proximidad en espacio y tiempo no demuestra que sea el mismo incendio.", "The closest detection satisfying the criterion is shown for each instrument. Proximity in space and time does not establish that it is the same fire.")}</p>
    </div>
  </details>
}
function AssociationTable({ summary }: { summary: EvidenceSummary }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <caption className="mb-3 text-left text-xs text-muted">{t("Perú · referencias atribuidas a INDECI · 5 km y ±3 días · 2013–2025", "Peru · references attributed to INDECI · 5 km and ±3 days · 2013–2025")}</caption>
    <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="py-2 pr-4">{t("Instrumento", "Instrument")}</th><th scope="col" className="pr-4">{t("Coincidencias / referencias", "Matches / references")}</th><th scope="col" className="pr-4">{t("Fecha 28 días antes", "Date shifted 28 days earlier")}</th><th scope="col">{t("Fecha 28 días después", "Date shifted 28 days later")}</th></tr></thead>
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
    <PageHeader title={t("Validación y fuentes", "Validation and sources")} subtitle={t("Registros oficiales, detecciones satelitales y criterios que puedes comprobar. El contraste histórico y la evaluación del pronóstico responden preguntas distintas.", "Official records, satellite detections and criteria you can check. Historical comparison and forecast evaluation answer different questions.")} />
    {summaryQ.error ? <ErrorBox error={summaryQ.error} retry={summaryQ.retry} /> : !summary ? <Loading label={t("Verificando las fuentes y el catálogo…", "Checking the sources and catalog…")} /> : <div className="space-y-5">
      <Card title={t("Coincidencias históricas con registros oficiales", "Historical matches with official records")} subtitle={t("Asociación entre lugar y fecha del registro y detecciones cercanas. No representa una tasa de acierto del pronóstico ni una atribución confirmada del incendio.", "Association between a record's location and date and nearby detections. This is neither forecast accuracy nor confirmed fire attribution.")}>
        <AssociationTable summary={summary} />
        <p className="mt-4 max-w-[78ch] text-sm text-muted">{t("Se fijó una misma regla: hasta 5 km del punto reportado y ±3 días completos del calendario local. En los controles se conserva el lugar y se desplaza la fecha 28 días. Son comparaciones descriptivas; los controles no son periodos demostrados libres de fuego. Los instrumentos pueden coincidir con una misma referencia, por lo que sus conteos no se suman.", "The same rule applies throughout: within 5 km of the reported point and ±3 complete local calendar days. Controls keep the location and shift the date by 28 days. These are descriptive comparisons; the controls are not periods proven free of fire. Instruments may match the same reference, so their counts are not added.")}</p>
      </Card>
      <Card title={t("Ejemplos con coincidencia documentada", "Examples with documented matches")} subtitle={(summary.catalog_status_counts.both + summary.catalog_status_counts.modis + summary.catalog_status_counts.viirs).toLocaleString(locale()) + t(' referencias con coincidencia en el periodo completo. Esta galería muestra ejemplos de asociación, no una muestra para estimar precisión.', ' references with a match across the full period. This gallery shows association examples, not a sample for estimating accuracy.')}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Select label={t("Año del catálogo", "Catalog year")} value={year} onChange={setYear} options={years.map((y) => ({ value: String(y.year), label: String(y.year) }))} />
          <Select label={t("Coincidencia", "Match")} value={instrument} onChange={setInstrument} options={[{ value: 'all', label: t("Todas las coincidencias", "All matches") }, { value: 'both', label: t('MODIS y VIIRS', 'MODIS and VIIRS') }, { value: 'modis', label: t("Solo MODIS", "MODIS only") }, { value: 'viirs', label: t("Solo VIIRS", "VIIRS only") }]} />
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">{t("Código o ID oficial", "Official code or ID")}<input value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink" type="search" maxLength={100} placeholder={t("Buscar una referencia", "Search for a reference")} /></label>
        </div>
        <p className="mb-3 text-xs text-muted">{t("Departamento:", "Department:")}{regionName(filters.region)}{t(' · el filtro superior cambia los ejemplos; la tabla global de asociación conserva su periodo completo.', ' · the top filter changes the examples; the global association table retains its full period.')}</p>
        {yearQ.error ? <ErrorBox error={yearQ.error} retry={yearQ.retry} /> : yearQ.loading || !yearQ.data || yearQ.data.year !== Number(year) ? <Loading label={t('Verificando la integridad de los ejemplos…', 'Checking example integrity…')} />
          : shown.length === 0 ? <Empty>{t("No hay ejemplos publicados para esta selección. Prueba otro año o departamento.", "No published examples are available for this selection. Try another year or department.")}</Empty>
          : <><p role="status" aria-live="polite" className="text-xs text-muted">{examples.length.toLocaleString(locale())}{t(' ejemplos con estos filtros · página ', ' examples with these filters · page ')}{shownPage + 1} {t('de', 'of')} {lastPage + 1}</p><div>{shown.map((item) => <Example key={item.id} item={item} source={summary.source_url} />)}</div>
            <div className="mt-4 flex items-center justify-center gap-4"><button className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>{t("Anterior", "Previous")}</button><span className="text-xs text-muted">{shownPage + 1} / {lastPage + 1}</span><button className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-40" disabled={shownPage === lastPage} onClick={() => setPage(shownPage + 1)}>{t("Siguiente", "Next")}</button></div></>}
      </Card>
      <Card title={t('Un incendio documentado: Dos de Mayo, Curimaná · 2019', 'A documented fire: Dos de Mayo, Curimaná · 2019')}>
        <p className="max-w-[78ch] text-sm">{t('El reporte COEN–INDECI n.º 2027 documenta un incendio entre el 31 de agosto y el 2 de septiembre de 2019. En el criterio exploratorio de 2 km durante el intervalo reportado se encontraron ', 'COEN–INDECI report no. 2027 documents a fire between 31 August and 2 September 2019. Using an exploratory 2 km criterion during the reported interval, the comparison found ')}{summary.case_study.primary_counts_by_platform['Suomi-NPP']}{t(' detecciones Suomi-NPP/VIIRS; la más próxima, a ', ' Suomi-NPP/VIIRS detections; the closest was ')}{(summary.case_study.primary_min_distance_m / 1000).toFixed(2)}{t(' km de la referencia de localidad.', ' km from the locality reference.')}</p>
        <p className="mt-3 max-w-[78ch] text-sm text-muted">{t("La referencia procede de vértices de ribera de ANA junto al centro poblado. No es un perímetro ni una coordenada verificada del fuego. El resultado es compatible en espacio y tiempo; no atribuye esas detecciones al incendio documentado.", "The reference comes from ANA riverbank vertices near the settlement. It is neither a fire perimeter nor a verified fire coordinate. The result is compatible in space and time; it does not attribute those detections to the documented fire.")}</p>
        <p className="mt-4 flex flex-wrap gap-4 text-sm"><a className="text-sky underline" href={summary.case_study.report_source} target="_blank" rel="noreferrer">{t("Reporte oficial COEN–INDECI", "Official COEN–INDECI report")}</a><a className="text-sky underline" href={evidenceURL('documents/indeci_report_2027_2019.pdf')} target="_blank" rel="noreferrer">{t("Copia con hash verificado", "Hash-verified copy")}</a><a className="text-sky underline" href={summary.case_study.ANA_source} target="_blank" rel="noreferrer">{t("Referencia geográfica ANA", "ANA geographic reference")}</a></p>
      </Card>
      <Card title={t('Qué valida este contraste y qué queda pendiente', 'What this comparison validates and what remains open')}>
        <ul className="max-w-[78ch] list-disc space-y-3 pl-5 text-sm text-muted"><li>{t("Permite localizar asociaciones históricas con registros atribuidos a INDECI. Una referencia agrupada no equivale necesariamente a un incendio físico independiente.", "This identifies historical associations with records attributed to INDECI. A grouped reference does not necessarily represent an independent physical fire.")}</li><li>{t("La independencia del registro respecto de imágenes y alertas satelitales no está establecida. Las fuentes pueden compartir información.", "Independence of the registry from satellite imagery and alerts is not established. Sources may share information.")}</li><li>{t("La armonización compara respuestas de instrumentos. La correlación con registros no demuestra por sí sola que su escala sea correcta.", "Harmonization compares instrument responses. Correlation with records alone does not establish that its scale is correct.")}</li><li>{t("El pronóstico actual tiene una evaluación retrospectiva separada. Esta galería no confirma el resultado de una semana futura.", "The current forecast has a separate retrospective evaluation. This gallery does not confirm the outcome of a future week.")}</li></ul>
        <p className="mt-4 text-sm"><a href="#pronostico" className="text-sky underline">{t("Consultar el pronóstico, su referencia histórica y su evaluación", "View the forecast, its historical reference and evaluation")}</a></p>
        <details className="mt-5 border-t border-line pt-4 text-sm"><summary className="cursor-pointer font-medium">{t("Procedencia e integridad de los datos", "Data provenance and integrity")}</summary><div className="mt-3 max-w-[85ch] space-y-3 text-xs text-muted"><p>{t("Snapshot oficial MINAM:", "Official MINAM snapshot:")}{summary.source_snapshot.rows.toLocaleString(locale())}{t(' filas; descarga ', ' rows; downloaded ')}{fmt.lima(summary.source_snapshot.downloaded_at_utc)}{t('. Al preparar el catálogo se cotejaron ', '. When preparing the catalog, the team compared ')}{summary.live_source_verification.sample_rows}{t(' registros, uno por año, con el servicio oficial. Es una comprobación muestral, no una revisión en vivo de todas las filas.', ' records, one per year, against the official service. This is a sample check, rather than a live review of every row.')}</p><p className="break-all">{t("SHA-256 del archivo fuente:", "Source file SHA-256:")}{summary.source_snapshot.csv_sha256}</p><p>{t("La descarga anual se verifica mediante SHA-256 antes de mostrar los ejemplos. Se conserva el análisis completo para auditoría; la galería selecciona las referencias con asociación.", "Each yearly download is verified using SHA-256 before examples are displayed. The complete analysis is retained for audit; the gallery selects references with an association.")}</p><p className="flex flex-wrap gap-4"><a className="text-sky underline" href={summary.source_url + '?f=pjson'} target="_blank" rel="noreferrer">{t("Servicio oficial MINAM", "Official MINAM service")}</a><a className="text-sky underline" href="https://github.com/Fabryzzio-Meza-Torres/MODIS-VIIRS-Harmonization/blob/main/docs/WEB_VALIDATION.md" target="_blank" rel="noreferrer">{t("Metodología y reproducción", "Methods and reproduction")}</a><a className="text-sky underline" href={API_BASE + '/docs'} target="_blank" rel="noreferrer">{t("API y versiones", "API and versions")}</a></p></div></details>
      </Card>
    </div>}
  </>
}
