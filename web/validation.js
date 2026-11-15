/* Historical evidence only. Does not infer attribution or future ignition truth. */
const $ = (id) => document.getElementById(id);
const root = $('validacion');
const folder = new URL('./validation-data/', import.meta.url);
const integer = new Intl.NumberFormat('es-PE');
const percent = (value) => `${(100 * value).toFixed(1)} %`;
const statusNames = {both: 'Coincide con ambos', modis: 'Solo MODIS', viirs: 'Solo VIIRS', none: 'Sin coincidencia'};
const pageSize = 12;
let summary, records = [], filtered = [], page = 0, requestId = 0, controller;

function element(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function link(text, url) {
  const a = element('a', text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a;
}
function row(parent, values, heading = false) {
  const tr = element('tr');
  values.forEach((value, index) => {
    const cell = element(heading && index === 0 ? 'th' : 'td');
    if (value instanceof Node) cell.append(value); else cell.textContent = value;
    if (heading && index === 0) cell.scope = 'row';
    tr.append(cell);
  }); parent.append(tr);
}
function officialURL(ids) {
  const url = new URL(`${summary.source_url}/query`);
  Object.entries({objectIds: ids.join(','), outFields: 'OBJECTID_1,ID_RHI,COD_EMERGE,FEC_EMERGE,FTE_INF,ORIGEN,NOMBDEP',
    returnGeometry: 'true', outSR: 4326, f: 'pjson'}).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}
function calendarDate(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-PE', {timeZone: 'America/Lima'});
}
async function fetchJSON(url, {signal, expectedHash, compressed = false} = {}) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(`No se pudo cargar la evidencia (HTTP ${response.status}).`);
  let bytes = await response.arrayBuffer();
  if (compressed) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = await new Response(stream).arrayBuffer();
  }
  if (expectedHash) {
    if (!globalThis.crypto?.subtle) throw new Error('La verificación requiere abrir la página mediante HTTPS o localhost.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedHash) throw new Error('La evidencia no coincide con su huella de integridad. Recarga la página.');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function association(instrument, {origin = 'INDECI', radius = 5, days = 3, shift = 0} = {}) {
  return summary.associations.find((r) => r.instrument === instrument && r.origin === origin &&
    r.radius_km === radius && r.calendar_day_half_window === days && r.date_shift_days === shift);
}
function renderSummary() {
  $('validation-scope').textContent = `${integer.format(summary.catalog_references)} referencias atribuidas a INDECI, entre el 7 de enero de 2013 y el 31 de diciembre de 2025. Criterio principal: hasta 5 km y ±3 días del calendario local. Se utiliza una plataforma por instrumento y semana, igual que en la serie publicada.`;
  for (const instrument of ['MODIS', 'VIIRS']) {
    const main = association(instrument);
    const mainValue = element('span', `${integer.format(main.with_satellite_record)} / ${integer.format(main.incident_references)} · `);
    mainValue.append(element('span', percent(main.association_fraction), 'validation-percent'));
    row($('validation-primary'), [instrument,
      mainValue,
      percent(association(instrument, {shift: -28}).association_fraction),
      percent(association(instrument, {shift: 28}).association_fraction)], true);
  }
  for (const [radius, days] of [[5, 3], [10, 3], [25, 7]]) {
    row($('validation-sensitivity'), [`${radius} km / ±${days} días`, ...['MODIS', 'VIIRS'].map((instrument) =>
      percent(association(instrument, {radius, days}).association_fraction))], true);
  }
  for (const origin of ['MINAM', 'ORORATECH']) {
    const modis = association('MODIS', {origin}); const viirs = association('VIIRS', {origin});
    row($('validation-origins'), [origin, integer.format(modis.incident_references), percent(modis.association_fraction), percent(viirs.association_fraction)], true);
  }
  for (const [period, label] of [['development', '2013–2021'], ['validation', '2022–2023'], ['final', '2024–2025']]) {
    row($('validation-correlations'), [label, ...['MODIS', 'VIIRS'].map((instrument) =>
      summary.correlations.find((r) => r.period === period && r.instrument === instrument && r.variable === 'harmonized_count').spearman.toFixed(3))], true);
  }
  const periods = [...new Set(summary.model_evaluation.map((r) => r.period))];
  for (const period of periods) {
    row($('validation-model'), [String(period).includes('2026') ? '2026 · enero–julio' : String(period),
      ...['lgbm_without_harmonization', 'climatology'].map((model) => summary.model_evaluation.find((r) => r.period === period && r.model === model).brier.toFixed(4))], true);
  }
  const s = summary.source_snapshot;
  const provenance = $('validation-provenance');
  provenance.append(element('span', `Snapshot oficial: ${new Date(s.downloaded_at_utc).toLocaleDateString('es-PE', {timeZone: 'America/Lima'})}. ${integer.format(s.rows)} filas originales; ${integer.format(summary.registry_audit.incident_references)} referencias elegibles de tres orígenes. Se verificaron todos los IDs al descargar el archivo y se contrastaron de nuevo ${summary.live_source_verification.sample_rows} registros de distintos años con el servicio oficial al preparar este catálogo. La muestra reciente no verifica en vivo cada fila. `));
  provenance.append(element('span', `SHA-256 del archivo fuente: ${s.csv_sha256}`, 'validation-source-hash'));
  $('validation-official-source').href = `${summary.source_url}?f=pjson`;
  for (const year of [...summary.years].sort((a, b) => b.year - a.year)) {
    const option = element('option', `${year.year} · ${integer.format(year.references)} referencias`);
    option.value = year.year; $('validation-year').append(option);
  }
  for (const name of summary.departments) {
    const option = element('option', name); option.value = name; $('validation-department').append(option);
  }
  renderCaseStudy();
}
function renderCaseStudy() {
  const data = summary.case_study; const container = $('validation-curimana');
  container.append(element('p', 'El reporte complementario COEN–INDECI n.º 2027, publicado el 6 de septiembre de 2019, documenta un incendio en Dos de Mayo, Curimaná, Ucayali. El intervalo analizado es del 31 de agosto, 17:30, al 2 de septiembre, 02:00, en horario de Lima.'));
  container.append(element('p', `En el criterio exploratorio de 2 km durante ese intervalo: ${data.primary_counts_by_platform.Aqua} detecciones Aqua/MODIS y ${data.primary_counts_by_platform['Suomi-NPP']} Suomi-NPP/VIIRS. La menor distancia a la referencia de localidad es ${(data.primary_min_distance_m / 1000).toFixed(2)} km. Los candidatos se verificaron contra los ZIP originales.`));
  container.append(element('p', 'La referencia geográfica proviene de vértices de ribera de ANA junto a la localidad, no de coordenadas del fuego. La proximidad es compatible en espacio y tiempo, pero no atribuye esas detecciones al incendio documentado ni demuestra una omisión de MODIS.'));
  const links = element('p');
  links.append(link('Reporte oficial COEN–INDECI', data.report_source), document.createTextNode(' · '),
    link('Copia verificada del reporte', new URL('documents/reporte_indeci_2027_2019.pdf', folder)), document.createTextNode(' · '),
    link('Documento geográfico ANA', data.ANA_source));
  container.append(links);
  for (const doc of data.document_hashes) container.append(element('p', `${doc.file} · SHA-256: ${doc.sha256}`, 'validation-source-hash'));
}
function addEvidence(parent, match) {
  const article = element('article'); article.append(element('h4', `${match.instrument} · ${match.platform}`));
  const definition = element('dl');
  const values = [
    ['Detección', `${new Date(match.timestamp_utc).toLocaleString('es-PE', {timeZone: 'America/Lima'})} · Lima`],
    ['Fecha del registro', calendarDate(match.registry_date)],
    ['Distancia LAEA', `${match.distance_projected_km.toFixed(2)} km`],
    ['Distancia WGS84', `${match.distance_geodesic_km.toFixed(2)} km`],
    ['Diferencia de días', String(match.calendar_day_difference)],
    ['Punto reportado', `${match.registry_latitude.toFixed(5)}, ${match.registry_longitude.toFixed(5)}`],
    ['Punto satelital', `${match.satellite_latitude.toFixed(5)}, ${match.satellite_longitude.toFixed(5)}`],
    ['Archivo FIRMS', match.source_member], ['Fila source_row', String(match.source_row)],
  ];
  for (const [term, value] of values) definition.append(element('dt', term), element('dd', value));
  article.append(definition);
  const sources = element('p'); sources.append(link(`Ver registro oficial ${match.registry_object_id}`, officialURL([match.registry_object_id])));
  article.append(sources); parent.append(article);
}
function renderCases() {
  const container = $('validation-cases'); container.replaceChildren();
  const start = page * pageSize; const current = filtered.slice(start, start + pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  $('validation-results').textContent = filtered.length ? `${integer.format(filtered.length)} referencias con estos filtros · mostrando ${start + 1}–${start + current.length}` : 'No hay referencias con estos filtros. Prueba otro año, departamento o resultado.';
  $('validation-page').textContent = `Página ${page + 1} de ${totalPages}`;
  $('validation-previous').disabled = page === 0; $('validation-next').disabled = page + 1 >= totalPages;
  for (const item of current) {
    const details = element('details', undefined, 'validation-case');
    const heading = element('summary');
    heading.append(element('span', calendarDate(item.date_start), 'validation-date'),
      element('span', item.departments.join(' / ') || 'Departamento no informado'),
      element('span', item.reference_codes.length ? `Código ${item.reference_codes.join(', ')}` : `ID ${item.registry_object_ids[0]} · sin código`, 'validation-code'),
      element('span', statusNames[item.match_status], `validation-result${item.match_status === 'none' ? ' no-match' : ''}`));
    details.append(heading);
    details.addEventListener('toggle', () => {
      if (!details.open || details.querySelector('.validation-case-body')) return;
      const body = element('div', undefined, 'validation-case-body');
      body.append(element('p', `Origen atribuido: INDECI. Fuente informada: ${item.source_labels.join(', ') || 'no informada'}. ${item.registry_locations} ubicación(es) del registro agrupadas en una referencia. Fechas reportadas: ${calendarDate(item.date_start)}–${calendarDate(item.date_end)}.`));
      const evidence = element('div', undefined, 'validation-evidence');
      item.matches.forEach((match) => addEvidence(evidence, match)); body.append(evidence);
      body.append(element('p', item.matches.length ? 'Se muestra la detección más cercana que cumple el criterio para cada instrumento, considerando las ubicaciones y fechas de esta referencia. La asociación no verifica que sea el mismo incendio.' : 'No se encontró una detección de las plataformas seleccionadas dentro de 5 km y ±3 días de ninguna ubicación reportada de esta referencia. Esto no demuestra que no hubiera fuego ni una omisión del sensor.'));
      const sources = element('p');
      sources.append(link('Consultar los puntos originales en MINAM', officialURL(item.registry_object_ids)), document.createTextNode(' · '),
        link('Ver punto de referencia en Google Maps', `https://www.google.com/maps/search/?api=1&query=${item.registry_latitude},${item.registry_longitude}`));
      body.append(sources, element('p', 'El punto reportado no equivale a una ubicación de ignición verificada. Las huellas de los archivos satelitales originales se incluyen en la descarga de metodología.', 'validation-small'));
      details.append(body);
    });
    container.append(details);
  }
}
function applyFilters() {
  const department = $('validation-department').value; const status = $('validation-status').value;
  const search = $('validation-search').value.trim().toLocaleLowerCase('es');
  filtered = records.filter((r) => (!department || r.departments.includes(department)) && (!status || r.match_status === status) &&
    (!search || `${r.id} ${r.reference_codes.join(' ')} ${r.registry_object_ids.join(' ')}`.toLocaleLowerCase('es').includes(search)));
  page = 0; renderCases();
}
async function loadYear() {
  const id = ++requestId; controller?.abort(); controller = new AbortController();
  $('validation-error').hidden = true; $('validation-apply').disabled = true;
  $('validation-download').hidden = true; $('validation-download').removeAttribute('href');
  root.setAttribute('aria-busy', 'true'); $('validation-cases').replaceChildren();
  $('validation-results').textContent = 'Cargando y verificando las referencias del año…';
  $('validation-previous').disabled = true; $('validation-next').disabled = true;
  records = []; filtered = [];
  try {
    const entry = summary.years.find((y) => String(y.year) === $('validation-year').value);
    const compressed = 'DecompressionStream' in globalThis && !!entry.compressed_file;
    const data = await fetchJSON(new URL(compressed ? entry.compressed_file : entry.file, folder),
      {signal: controller.signal, expectedHash: entry.sha256, compressed});
    if (id !== requestId) return;
    if (data.data.length !== entry.references) throw new Error('El número de referencias no coincide con el manifest.');
    records = data.data;
    $('validation-download').href = new URL(entry.file, folder);
    $('validation-download').hidden = false;
    applyFilters();
  } catch (error) {
    if (id !== requestId || error.name === 'AbortError') return;
    $('validation-error').textContent = `${error.message} Selecciona de nuevo el año para reintentar.`;
    $('validation-error').hidden = false; $('validation-results').textContent = 'Evidencia no disponible; no se muestran resultados sustitutos.';
    $('validation-download').hidden = true;
  } finally {
    if (id === requestId) { $('validation-apply').disabled = false; root.setAttribute('aria-busy', 'false'); }
  }
}
async function initialize() {
  if (!root) return;
  try {
    summary = await fetchJSON(new URL('summary.json', folder));
    renderSummary(); $('validation-content').hidden = false; $('validation-loading').hidden = true;
    $('validation-year').addEventListener('change', loadYear);
    $('validation-filters').addEventListener('submit', (event) => { event.preventDefault(); applyFilters(); });
    for (const id of ['validation-department', 'validation-status']) $(id).addEventListener('change', applyFilters);
    $('validation-previous').addEventListener('click', () => { page--; renderCases(); $('validation-results').scrollIntoView({block: 'nearest'}); });
    $('validation-next').addEventListener('click', () => { page++; renderCases(); $('validation-results').scrollIntoView({block: 'nearest'}); });
    await loadYear();
  } catch (error) {
    $('validation-loading').hidden = true; $('validation-error').hidden = false;
    $('validation-error').textContent = `${error.message} No se muestran cifras de ejemplo. Recarga la página para reintentar.`;
    root.setAttribute('aria-busy', 'false');
  }
}
initialize();
