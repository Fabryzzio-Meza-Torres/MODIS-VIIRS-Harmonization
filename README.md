# MODIS-VIIRS-Harmonization · eventos de fuego de Perú

NASA Space Apps Challenge 2026 · Perú. Une las detecciones de fuego de MODIS (Terra, Aqua) y
VIIRS (Suomi NPP, NOAA-20, NOAA-21) de Perú, del 20 ene 2012 al 31 jul 2026, en **eventos de
fuego**. Los guarda en Postgres y los sirve con una API FastAPI. La consulta principal es
**región + periodo → eventos con su lat/lon**.

## Requisitos

- Python 3.11 o superior y PostgreSQL 14 o superior.
- Una MAP_KEY de FIRMS (gratis) en `.env` (ver `.env.example`).
- El ZIP de Suomi NPP de Perú descargado de FIRMS (`DL_FIRE_SV-C2_*.zip`); su ruta va en la
  variable `SNPP_ZIP`. MODIS, NOAA-20 y NOAA-21 se bajan por la API.
- Opcional: GPU NVIDIA con `cupy-cuda12x` para el índice en memoria.

## Replicar la base y la API

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                          # y pon tu MAP_KEY
createdb fires                                # tu usuario debe existir en Postgres
export SNPP_ZIP=/ruta/a/DL_FIRE_SV-C2_848901.zip

.venv/bin/python -m src.firms.download        # ~35 min (cuota de la API), reanudable
.venv/bin/python -m src.firms.archive         # ~1,5 min: tabla común, Perú, fuentes fijas
.venv/bin/python -m src.firms.events          # ~1 min: tabla de eventos
.venv/bin/python -m src.firms.load_postgres --dump   # Postgres + data/fires.dump

.venv/bin/uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

`data/` no va a git. Para usar una base ya construida: `createdb fires && pg_restore -d fires
fires.dump`. La API usa `DATABASE_URL` (por defecto `postgresql:///fires`). Documentación
interactiva en http://localhost:8000/docs. Colección de Postman con tests en
`postman/fires_api.postman_collection.json`.

## Consulta principal: región + periodo

```
GET /events?bbox=lon_min,lat_min,lon_max,lat_max&start=AAAA-MM-DD&end=AAAA-MM-DD
```

Devuelve los eventos **activos** en el periodo (sus fechas se cruzan con `start`–`end`, ambos
incluidos, en UTC) cuya caja toca la región. Usa los índices GiST de Postgres sobre la caja y el
periodo de cada evento.

```bash
curl "http://localhost:8000/events?bbox=-75.7,-11.5,-70.4,-7.2&start=2024-09-20&end=2024-09-26"
```

La región también se puede dar como `region=ucayali` (ver `/regions`) o `department=Ucayali`
(ver `/departments`). Filtros: `min_confidence` (baja, media, alta), `min_det`, `event_type`,
`limit`/`offset`, `format=geojson` y `engine=index` (índice en memoria; exige al menos una
detección dentro de la región y el periodo).

Cada evento trae, entre otros campos (extracto de una respuesta real):

```json
{
  "event_id": 656261,
  "t_start": "2024-08-09T18:01:00+00:00", "t_end": "2024-09-26T18:24:00+00:00",
  "duration_days": 48.0,
  "lat": -8.0288, "lon": -74.9668,
  "lat_min": -8.1142, "lat_max": -7.9571, "lon_min": -75.0436, "lon_max": -74.8761,
  "n_det": 3544, "n_modis": 252, "n_viirs": 3292, "frp_total": 54605.99,
  "department": "Ucayali", "confidence": "alta", "event_type": "quema_persistente",
  "active_days": 45, "foci_per_day": 3.0, "may_split": true
}
```

`lat`/`lon` es el centro del evento y `lat_min`…`lon_max` su caja. Los puntos del evento se
piden con `GET /events/{event_id}/detections`.

### Otros endpoints

| Endpoint | Devuelve |
|---|---|
| `GET /events/near?lat&lon&radius_km&start&end` | eventos con detecciones a ≤ radio del punto |
| `GET /events/nearest?lat&lon&t&k` | k eventos más cercanos en espacio-tiempo |
| `GET /events/{id}`, `/events/{id}/detections` | ficha y detecciones de un evento |
| `GET /event-types`, `/regions`, `/departments` | valores posibles de los filtros |
| `GET /static-sources?bbox` | fuentes fijas excluidas (volcanes, gas, industria) |
| `GET /health`, `/meta`, `/index`, `POST /index/rebuild` | estado y parámetros |

## Método, en breve

1. **Datos:** solo el producto estándar (SP) de FIRMS (Giglio et al., 2016; NASA FIRMS, 2026;
   Schroeder et al., 2014), `type 0` (vegetación), sin confianza baja, recortado al polígono de
   Perú (Natural Earth, s. f.) y asignado a departamentos (Runfola et al., 2020). Se excluyen
   fuentes fijas: celdas que FIRMS marcó como volcán, fuente fija o mar, celdas activas casi
   todo el año y un radio de 2,5 km alrededor de los volcanes.
2. **Eventos:** dos detecciones son del mismo evento si están a ≤ 1,25 km y ≤ 5 días. Se reducen
   a nodos de 0,5 km × día, un KD-tree (con el tiempo como tercer eje) encuentra los pares y cada
   componente conexa del grafo es un evento (Andela et al., 2022; Chen et al., 2022).
3. **Esqueleto de satélites:** el grafo se arma solo con Suomi NPP + MODIS, presentes todo el
   periodo. NOAA-20 (desde 2018) y NOAA-21 (desde 2023) se cuelgan del evento más cercano pero no
   unen eventos. Sin esto, los eventos de más de 30 días pasaban de 23 a 95 solo por sumar
   satélites.
4. **Calibración:** 1,25 km y 5 días es la combinación que mejor reproduce los fuegos de GlobFire
   en Perú 2013–2017 sin partirlos ni fundirlos (Artés et al., 2019; Artés Vivancos y
   San-Miguel-Ayanz, 2018).
5. **Tipo de evento:** `foco_aislado` (< 1 día, ≤ 2 km²) e `incendio` (≤ 22 días, el fuego más
   largo de GlobFire en Perú). Los más largos son `quema_persistente` (≥ 2 focos separados por
   día), `incendio_prolongado` (1 foco por día) o `foco_recurrente` (siempre en ≤ 5 km²).
6. **Proyección:** acimutal de Lambert de áreas iguales centrada en Perú (distorsión < 1 %).

Resultado: 795 540 eventos a partir de 1 958 951 detecciones. La base se contrastó con cifras
publicadas: focos de SERFOR en Ucayali en 48 horas (El Búho, 2024), el boletín del 12 de
septiembre de 2024 (Servicio Nacional de Meteorología e Hidrología del Perú [SENAMHI], 2024), el
récord de septiembre de 2024 (Cáceres, 2024), la emergencia del DS 097-2024-PCM (Presidencia del
Consejo de Ministros, 2024) y la actividad del volcán Ubinas (Instituto Geofísico del Perú,
2024).

## Referencias

Andela, N., Morton, D. C., Schroeder, W., Chen, Y., Brando, P. M., & Randerson, J. T. (2022).
Tracking and classifying Amazon fire events in near real time. *Science Advances, 8*(30),
eabd2713. https://doi.org/10.1126/sciadv.abd2713

Artés, T., Oom, D., de Rigo, D., Durrant, T. H., Maianti, P., Libertà, G., & San-Miguel-Ayanz, J.
(2019). A global wildfire dataset for the analysis of fire regimes and fire behaviour.
*Scientific Data, 6*, Artículo 296. https://doi.org/10.1038/s41597-019-0312-2

Artés Vivancos, T., & San-Miguel-Ayanz, J. (2018). *ESRI shapefiles in monthly resolution*
[Conjunto de datos]. En *Global wildfire database for GWIS*. PANGAEA.
https://doi.org/10.1594/PANGAEA.895898

Cáceres, Z. (2024). *Nota técnica: Incendios forestales en el Perú entre 2002 al 2024*.
MapBiomas Perú.
https://old-peru.mapbiomas.org/wp-content/uploads/sites/14/2024/11/Nota-tecnica_-Incendios-forestales-en-el-Peru-2002-2024-1.pdf

Chen, Y., Hantson, S., Andela, N., Coffield, S. R., Graff, C. A., Morton, D. C., Ott, L. E.,
Foufoula-Georgiou, E., Smyth, P., Goulden, M. L., & Randerson, J. T. (2022). California wildfire
spread derived using VIIRS satellite observations and an object-based tracking system.
*Scientific Data, 9*, Artículo 249. https://doi.org/10.1038/s41597-022-01343-0

El Búho. (2024, 27 de septiembre). *Amazonía peruana arde: Más de 7 000 focos de calor en 48
horas*. https://elbuho.pe/2024/09/amazonia-peruana-arde-mas-de-7-000-focos-de-calor-en-48-horas/

Giglio, L., Schroeder, W., & Justice, C. O. (2016). The collection 6 MODIS active fire detection
algorithm and fire products. *Remote Sensing of Environment, 178*, 31–41.
https://doi.org/10.1016/j.rse.2016.02.054

Instituto Geofísico del Perú. (2024). *Reporte vulcanológico diario, 1 de marzo de 2024*.
https://www.igp.gob.pe/servicios/centro-vulcanologico-nacional/sites/default/files/reportes-vulcanologicos/2024/REPORTE%20VULCANOLOGICO%20DIARIO%201%20DE%20MARZO%20DE%202024.pdf

NASA FIRMS. (2026). *Fire Information for Resource Management System: Detecciones MODIS C6.1 y
VIIRS 375 m, producto estándar* [Conjunto de datos]. NASA Earth Science Data and Information
System. Recuperado el 15 de noviembre de 2026, de https://firms.modaps.eosdis.nasa.gov/

Natural Earth. (s. f.). *Admin 0 – Countries, 1:10m* [Conjunto de datos]. Recuperado el 15 de
noviembre de 2026, de https://www.naturalearthdata.com/

Presidencia del Consejo de Ministros. (2024, 18 de septiembre). *Gobierno declara en emergencia
regiones de Amazonas, San Martín y Ucayali por presencia de incendios forestales* [Nota de prensa
sobre el Decreto Supremo N.° 097-2024-PCM]. Gob.pe.
https://www.gob.pe/institucion/presidencia/noticias/1024206-gobierno-declara-en-emergencia-regiones-de-amazonas-san-martin-y-ucayali-por-presencia-de-incendios-forestales

Runfola, D., Anderson, A., Baier, H., Crittenden, M., Dowker, E., Fuhrig, S., Goodman, S.,
Grimsley, G., Layko, R., Melville, G., Mulder, M., Oberman, R., Panganiban, J., Peck, A., Seitz,
L., Shea, S., Slevin, H., Youngerman, R., & Hobbs, L. (2020). geoBoundaries: A global database of
political administrative boundaries. *PLOS ONE, 15*(4), Artículo e0231866.
https://doi.org/10.1371/journal.pone.0231866

Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). The new VIIRS 375 m active fire
detection data product: Algorithm description and initial assessment. *Remote Sensing of
Environment, 143*, 85–96. https://doi.org/10.1016/j.rse.2013.12.008

Servicio Nacional de Meteorología e Hidrología del Perú. (2024, 12 de septiembre). [Boletín de
focos de calor y condiciones para incendios forestales, publicación de las 12:00 h].
https://www.senamhi.gob.pe/load/file/02256SENA-947.pdf
