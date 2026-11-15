const $ = (id) => document.getElementById(id);
const API = window.FIRE_SHIFT_API_BASE || location.origin;
const NS = 'http://www.w3.org/2000/svg';
const colors = {MODIS: '#fb923c', VIIRS: '#67d8f2'};
const number = new Intl.NumberFormat('es-PE', {maximumFractionDigits: 2});
const shortNumber = new Intl.NumberFormat('es-PE', {notation: 'compact', maximumFractionDigits: 1});
const dateLabel = (iso) => new Intl.DateTimeFormat('es-PE',
  {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(iso + 'T00:00:00Z'));
const titleCase = (s) => s.toLocaleLowerCase('es-PE').replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase('es-PE'));
let records = [], catalog = [], metadata = {}, controller, shown = 50, hoverIndex = -1;
let chartLayout = null, generation = 0;

function svg(tag, attributes = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function shiftDay(iso,days) {
  const value = new Date(iso + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
async function get(path, parameters = {}, signal) {
  const url = new URL(path, API);
  url.search = new URLSearchParams(parameters);
  const response = await fetch(url, {signal, headers: {Accept: 'application/json'}});
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 404) throw new Error('La ubicación no pertenece a los límites departamentales disponibles.');
    throw new Error('No pudimos consultar los datos. Comprueba el servicio y vuelve a intentarlo.');
  }
  return body;
}
function error(message = '') {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function setLoading(active) {
  $('compare').disabled = active;
  $('compare').textContent = active ? 'Consultando…' : 'Comparar';
  $('download').disabled = active || !records.length;
  $('chart-wrap').setAttribute('aria-busy', String(active));
}
function highlightMap() {
  const selected = $('region').value;
  document.querySelectorAll('#map path').forEach((p) => {
    const current = p.dataset.region === selected;
    p.classList.toggle('selected', current);
    p.setAttribute('aria-pressed', String(current));
  });
  const region = catalog.find((r) => r.region_id === selected);
  $('map-selection').textContent = region ? titleCase(region.name) : 'Todo el Perú';
}
async function compare(event) {
  if (event) event.preventDefault();
  if (!$('filters').reportValidity()) return;
  const start = $('from').value, end = $('to').value, region = $('region').value;
  if (start > end) { error('La fecha inicial debe ser anterior o igual a la fecha final.'); return; }
  if (controller) controller.abort();
  controller = new AbortController();
  const current = ++generation;
  setLoading(true); error(); highlightMap();
  try {
    const query = {start, end: shiftDay(end,1), week_selection: 'overlap', limit: 1000};
    if (region) query.region_id = region;
    let offset = 0, next = [];
    do {
      const page = await get('/v1/empirical/series', {...query, offset}, controller.signal);
      if (current !== generation) return;
      metadata = page.metadata;
      next.push(...page.data);
      offset = page.pagination.next_offset;
    } while (offset !== null);
    if (current !== generation) return;
    records = next; shown = 50; hoverIndex = -1;
    $('chart-title').textContent = metadata.region ? titleCase(metadata.region.name) : 'Todo el Perú';
    $('period').textContent = metadata.effective_week_start ?
      'Del ' + dateLabel(metadata.effective_week_start) + ' al ' + dateLabel(shiftDay(metadata.effective_end_exclusive,-1)) :
      'El período elegido no contiene semanas disponibles.';
    const state = new URLSearchParams({region_id: region, start, end});
    history.replaceState(null, '', '?' + state.toString());
    $('connection').textContent = 'Datos conectados';
    $('connection').classList.add('ready');
    $('download').disabled = !records.length;
    renderChart(); renderTable(); renderAvailability();
  } catch (e) {
    if (e.name !== 'AbortError') {
      error(e.message || 'No pudimos conectar con los datos. Vuelve a intentarlo.');
      $('connection').textContent = 'Revisar conexión';
      $('connection').classList.remove('ready');
    }
  } finally {
    if (current === generation) setLoading(false);
  }
}
function renderAvailability() {
  $('availability').replaceChildren();
  for (const instrument of ['MODIS', 'VIIRS']) {
    const values = records.filter((r) => r.instrument === instrument);
    const count = values.filter((r) => r.harmonized_count !== null).length;
    const item = document.createElement('span');
    item.textContent = instrument + ': ' + count + ' de ' + values.length + ' semanas con estimación';
    $('availability').append(item);
  }
}
function renderChart() {
  const node = $('chart'), width = Math.max(300, Math.round(node.clientWidth)), height = 330;
  node.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  node.replaceChildren(); $('tooltip').hidden = true;
  const field = $('raw').checked ? 'raw_count' : 'harmonized_count';
  const bands = $('bands').checked && !$('raw').checked;
  $('bands').disabled = $('raw').checked;
  const valid = records.filter((r) => r[field] !== null);
  $('empty').hidden = valid.length > 0;
  $('empty').textContent = records.length ?
    'No hay estimaciones disponibles para esta región y período. Prueba un rango más amplio; un hueco no significa cero incendios.' :
    'Elige un período dentro del histórico disponible.';
  if (!valid.length) {chartLayout = null; return;}
  const weeks = [...new Set(records.map((r) => r.week_start_utc))].sort();
  const times = weeks.map((s) => Date.parse(s + 'T00:00:00Z'));
  const left = 50, right = width - 12, top = 31, bottom = height - 44;
  const minTime = times[0], maxTime = times[times.length - 1];
  const maximum = Math.max(1, ...valid.map((r) => bands && r.upper_bound !== null ? r.upper_bound : r[field])) * 1.08;
  const x = (stamp) => maxTime === minTime ? (left + right) / 2 : left + (stamp - minTime) / (maxTime - minTime) * (right - left);
  const y = (value) => bottom - value / maximum * (bottom - top);
  node.append(svg('text', {x: left, y: 14, fill: '#a9bbce', 'font-size': 11},
    $('raw').checked ? 'Detecciones reportadas / semana' : 'Detecciones comparables / semana'));
  for (let i = 0; i <= 4; i++) {
    const value = maximum * i / 4, yy = y(value);
    node.append(svg('line', {x1: left, x2: right, y1: yy, y2: yy, stroke: '#344b62', 'stroke-width': .7}));
    node.append(svg('text', {x: left - 9, y: yy + 4, fill: '#a9bbce', 'font-size': 11, 'text-anchor': 'end'}, shortNumber.format(value)));
  }
  const tickCount = times.length === 1 ? 1 : width < 480 ? 3 : 5;
  for (let i = 0; i < tickCount; i++) {
    const index = tickCount === 1 ? 0 : Math.round(i / (tickCount - 1) * (times.length - 1));
    const label = new Intl.DateTimeFormat('es-PE', {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(new Date(times[index]));
    node.append(svg('text', {x: x(times[index]), y: height - 17, fill: '#a9bbce', 'font-size': 11,
      'text-anchor': i === 0 && tickCount > 1 ? 'start' : i === tickCount - 1 && tickCount > 1 ? 'end' : 'middle'}, label));
  }
  for (const instrument of ['MODIS', 'VIIRS']) {
    const values = records.filter((r) => r.instrument === instrument);
    let segment = [], path = '', drawing = false;
    const paintBand = () => {
      if (segment.length > 1) {
        const upper = segment.map((r) => [x(Date.parse(r.week_start_utc + 'T00:00:00Z')), y(r.upper_bound)]);
        const lower = [...segment].reverse().map((r) => [x(Date.parse(r.week_start_utc + 'T00:00:00Z')), y(r.lower_bound)]);
        node.append(svg('polygon', {points: [...upper, ...lower].map((p) => p.join(',')).join(' '), fill: colors[instrument], opacity: .13}));
      }
      segment = [];
    };
    for (const row of values) {
      if (row[field] === null) {drawing = false; paintBand(); continue;}
      const xx = x(Date.parse(row.week_start_utc + 'T00:00:00Z')), yy = y(row[field]);
      path += (drawing ? ' L ' : ' M ') + xx + ' ' + yy; drawing = true;
      if (bands && row.lower_bound !== null && row.upper_bound !== null) segment.push(row);
    }
    paintBand();
    node.append(svg('path', {d: path, fill: 'none', stroke: colors[instrument], 'stroke-width': 1.6, 'stroke-linejoin': 'round'}));
    if (values.filter((r) => r[field] !== null).length === 1) {
      const row = values.find((r) => r[field] !== null);
      node.append(svg('circle', {cx: x(Date.parse(row.week_start_utc + 'T00:00:00Z')), cy: y(row[field]), r: 3.5, fill: colors[instrument]}));
    }
  }
  chartLayout = {weeks, times, left, right, x, width, top, bottom};
  node.append(svg('line', {id: 'cursor', x1: left, x2: left, y1: top, y2: bottom,
    stroke: '#d9e9f5', 'stroke-width': .8, visibility: 'hidden'}));
}
function showWeek(index) {
  if (!chartLayout) return;
  hoverIndex = Math.max(0, Math.min(chartLayout.weeks.length - 1, index));
  const week = chartLayout.weeks[hoverIndex], xx = chartLayout.x(chartLayout.times[hoverIndex]);
  const cursor = $('cursor');cursor.setAttribute('x1', xx);cursor.setAttribute('x2', xx);cursor.setAttribute('visibility', 'visible');
  const tip = $('tooltip');tip.replaceChildren();
  const heading = document.createElement('strong');heading.textContent = 'Semana del ' + dateLabel(week);tip.append(heading);
  for (const row of records.filter((r) => r.week_start_utc === week)) {
    const line = document.createElement('p'), value = $('raw').checked ? row.raw_count : row.harmonized_count;
    line.textContent = row.instrument + ': ' + (value === null ? 'sin estimación' : number.format(value));
    line.style.color = colors[row.instrument];tip.append(line);
  }
  tip.hidden = false;
  tip.style.left = Math.max(8, Math.min(xx + 10, chartLayout.width - tip.offsetWidth - 4)) + 'px';
  $('chart-description').textContent = tip.textContent;
}
$('chart').addEventListener('pointermove', (event) => {
  if (!chartLayout) return;
  const rect = $('chart').getBoundingClientRect(), position = event.clientX - rect.left;
  const relative = (position - chartLayout.left) / (chartLayout.right - chartLayout.left);
  showWeek(Math.round(relative * (chartLayout.weeks.length - 1)));
});
$('chart').addEventListener('pointerleave', () => {
  $('tooltip').hidden = true;
  if ($('cursor')) $('cursor').setAttribute('visibility', 'hidden');
});
$('chart').addEventListener('keydown', (event) => {
  if (!chartLayout || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  showWeek(hoverIndex < 0 ? 0 : hoverIndex + (event.key === 'ArrowRight' ? 1 : -1));
});
function renderTable() {
  const body = $('table-body');body.replaceChildren();
  for (const row of records.slice(0, shown)) {
    const tr = document.createElement('tr');
    const cells = [row.week_start_utc, row.instrument, row.platform || '—',
      row.raw_count === null ? 'Sin dato' : number.format(row.raw_count),
      row.harmonized_count === null ? 'Sin estimación' : number.format(row.harmonized_count),
      row.estimation_status === 'estimated' ? 'Estimado' : 'No disponible'];
    for (const value of cells) {const td = document.createElement('td');td.textContent = value;tr.append(td);}
    body.append(tr);
  }
  $('more').hidden = shown >= records.length;
}
function mapPath(geometry, project) {
  const ringPath = (ring) => ring.map((p, i) => (i ? 'L' : 'M') + project(p).join(',')).join(' ') + 'Z';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).join(' ');
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap((p) => p.map(ringPath)).join(' ');
  if (geometry.type === 'GeometryCollection') return geometry.geometries.map((g) => mapPath(g, project)).join(' ');
  return '';
}
function renderMap(geo) {
  const bounds = catalog.map((r) => r.bbox);
  const west = Math.min(...bounds.map((b) => b[0])), east = Math.max(...bounds.map((b) => b[2]));
  const south = Math.min(...bounds.map((b) => b[1])), north = Math.max(...bounds.map((b) => b[3]));
  const scale = Math.min(248 / (east - west), 346 / (north - south));
  const project = (p) => [12 + (p[0] - west) * scale, 12 + (north - p[1]) * scale];
  const node = $('map');node.replaceChildren();
  for (const feature of geo.features) {
    const path = svg('path', {d: mapPath(feature.geometry, project), 'fill-rule': 'evenodd',
      role: 'button', tabindex: 0, 'aria-label': 'Seleccionar ' + titleCase(feature.properties.name),
      'data-region': feature.properties.region_id});
    path.append(svg('title', {}, titleCase(feature.properties.name)));
    const select = () => {$('region').value = feature.properties.region_id;compare();};
    path.addEventListener('click', select);
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();select();}
    });
    node.append(path);
  }
  highlightMap();
}
$('filters').addEventListener('submit', compare);
$('all-history').addEventListener('click', () => {$('from').value = '2000-11-06';$('to').value = '2026-07-26';compare();});
$('raw').addEventListener('change', renderChart);
$('bands').addEventListener('change', renderChart);
$('more').addEventListener('click', () => {shown += 50;renderTable();});
$('download').addEventListener('click', () => {
  const fields = ['week_start_utc', 'instrument', 'platform', 'raw_count', 'harmonized_count',
    'lower_bound', 'upper_bound', 'coverage_status', 'estimation_status'];
  const quote = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const region = metadata.region;
  const lines = [['region_id', 'region_name', ...fields,'method_version','source_snapshot_id','coverage_corrected'].join(',')];
  for (const row of records) lines.push([region ? region.region_id : 'PER', region ? region.name : 'PERU',
    ...fields.map((key) => row[key]),metadata.method_version,metadata.source_snapshot_id,metadata.coverage_corrected].map(quote).join(','));
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  const link = document.createElement('a');link.href = url;
  link.download = 'comparacion_' + (region ? region.region_id : 'PER') + '_' + metadata.requested_start + '_' + shiftDay(metadata.requested_end_exclusive,-1) + '.csv';
  link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('locate').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');button.disabled = true;
  $('location-status').textContent = 'Buscando departamento…';
  try {
    const result = await get('/v1/regions/locate',
      {latitude: $('latitude').value, longitude: $('longitude').value});
    $('region').value = result.region.region_id;
    $('location-status').textContent = titleCase(result.region.name) +
      (result.metadata.boundary_ambiguous ? '. Ubicación sobre un límite compartido.' : '. Ubicación encontrada.');
    await compare();
  } catch (e) {$('location-status').textContent = e.message;}
  finally {button.disabled = false;}
});
let resizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);resizeFrame = requestAnimationFrame(renderChart);
}).observe($('chart-wrap'));
async function init() {
  try {
    const [regions, geometry] = await Promise.all([get('/v1/regions'), get('/v1/regions/geometry')]);
    catalog = regions.data;
    $('region').replaceChildren(new Option('Todo el Perú', ''), ...catalog.map((r) => new Option(titleCase(r.name), r.region_id)));
    const query = new URLSearchParams(location.search), selected = query.get('region_id');
    $('region').value = selected !== null && (selected === '' || catalog.some((r) => r.region_id === selected)) ? selected : '08';
    for (const [key, element] of [['start', 'from'], ['end', 'to']]) {
      const value = query.get(key);
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) $(element).value = value;
    }
    $('region').disabled = false;$('all-history').disabled = false;renderMap(geometry);
    await compare();
  } catch (e) {
    error(e.message || 'No pudimos cargar los departamentos. Comprueba el servicio.');
    $('empty').textContent = 'Los datos no están disponibles. Puedes volver a cargar la página para reintentar.';
    $('chart-wrap').setAttribute('aria-busy', 'false');
    $('connection').textContent = 'Sin conexión';
  }
}
init();
