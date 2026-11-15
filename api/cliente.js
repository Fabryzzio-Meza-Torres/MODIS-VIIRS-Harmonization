// API REST: el mismo contrato sirve para JavaScript, React o Next.js.
export async function consultarSerie({ baseUrl, cellId, regionId, start, end, offset = 0,
                                       weekSelection = 'starts_within' }) {
  const url = new URL('/v1/empirical/series', baseUrl);
  const params = {start, end, offset, limit: 1000, week_selection: weekSelection};
  if (cellId) params.cell_id = cellId; // Sin celda: total nacional de Perú.
  if (regionId) params.region_id = regionId;
  url.search = new URLSearchParams(params);
  const response = await fetch(url, {headers: {Accept: 'application/json'}});
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.detail?.message ?? 'No se pudo consultar la serie');
    error.status = response.status;
    error.detail = payload.detail;
    throw error;
  }
  return payload; // Dos instrumentos; revisar coverage_corrected y las bandas de calibración.
}

export async function consultarPronostico({baseUrl, bbox, regionId, offset = 0}) {
  const url = new URL('/v1/forecasts', baseUrl);
  const params = {offset, limit: 1000};
  if (bbox) params.bbox = bbox.join(','); // [oeste, sur, este, norte].
  if (regionId) params.region_id = regionId;
  url.search = new URLSearchParams(params);
  const response = await fetch(url, {headers: {Accept: 'application/json'}});
  const payload = await response.json();
  if (!response.ok) throw new Error('No se pudo consultar el pronóstico');
  return payload; // record_probability es probabilidad de registro, no de ignición.
}

export async function localizarRegion({baseUrl, latitude, longitude}) {
  const url = new URL('/v1/regions/locate', baseUrl);
  url.search = new URLSearchParams({latitude, longitude});
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error('La ubicación no pertenece a los límites regionales disponibles.');
  return payload; // payload.region.region_id se utiliza en consultarSerie.
}
