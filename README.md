# MODIS-VIIRS-Harmonization · Peru fire events

NASA Space Apps Challenge 2026 · Peru. Merges the MODIS (Terra, Aqua) and VIIRS (Suomi NPP,
NOAA-20, NOAA-21) fire detections of Peru, from 20 Jan 2012 to 31 Jul 2026, into **fire
events**. They are stored in Postgres and served by a FastAPI API. The main query is
**region + period → events with their lat/lon**.

## Requirements

- Python 3.11 or later and PostgreSQL 14 or later.
- A FIRMS MAP_KEY (free) in `.env` (see `.env.example`).
- The Suomi NPP ZIP for Peru downloaded from FIRMS (`DL_FIRE_SV-C2_*.zip`); its path goes in
  the `SNPP_ZIP` variable. MODIS, NOAA-20 and NOAA-21 are downloaded through the API.
- Optional: an NVIDIA GPU with `cupy-cuda12x` for the in-memory index.

## Deploy with Docker Compose (recommended)

One command starts Postgres and the API. The first time, the API downloads the prebuilt
database (`fires.dump`, 132 MB) from
[Google Drive](https://drive.google.com/file/d/1k76VcDl7RQq5hpKhayTXl_3URC_kQIAl/view?usp=sharing),
checks its sha256, restores it and starts. Later runs use the database stored in the volume
and download nothing. No MAP_KEY and no pipeline run are needed.

```bash
POSTGRES_PASSWORD=a_password docker compose up -d --build
docker compose logs -f api        # ~3 min the first time: download + restore
```

The API is at `http://<server>:8000` (docs at `/docs`). Another port: `API_PORT=8080`.
The server needs about 2 GB of RAM (the API loads ~2 million points into its index).
To start from scratch: `docker compose down -v`.

**Without Docker**, on any Linux machine with PostgreSQL 14 or later, the same script does
everything:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
createdb fires
DATABASE_URL=postgresql:///fires PYTHON=.venv/bin/python bash deploy/bootstrap.sh
```

Variables of `deploy/bootstrap.sh`: `DATABASE_URL`, `PORT` (8000), `DUMP_URL` and
`DUMP_SHA256` (to use another copy of the database), `KEEP_DUMP=1` (keep the downloaded file).

Manual restore of the dump: `createdb fires && pg_restore --no-owner -d fires fires.dump`
(sha256 `5382be98a0221e528995f2d44470d03f0e2bcc2307bc0a61410744c745aa7e71`).

## Full option: rebuild the database from FIRMS

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                          # and add your MAP_KEY
createdb fires                                # your user must exist in Postgres
export SNPP_ZIP=/path/to/DL_FIRE_SV-C2_848901.zip

.venv/bin/python -m src.firms.download        # ~35 min (API quota), resumable
.venv/bin/python -m src.firms.archive         # ~1.5 min: common table, Peru, static sources
.venv/bin/python -m src.firms.events          # ~1 min: event table
.venv/bin/python -m src.firms.load_postgres --dump   # Postgres + data/fires.dump

.venv/bin/uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

`data/` is not in git (the dump is larger than GitHub's 100 MB per-file limit). The API uses
`DATABASE_URL` (default `postgresql:///fires`). Interactive documentation at
http://localhost:8000/docs. Postman collection with tests in
`postman/fires_api.postman_collection.json`.

## Main query: region + period

```
GET /events?bbox=lon_min,lat_min,lon_max,lat_max&start=YYYY-MM-DD&end=YYYY-MM-DD
```

Returns the events **active** in the period (their dates overlap `start`–`end`, both
included, in UTC) whose bounding box touches the region. It uses Postgres GiST indexes on the
box and the period of each event.

```bash
curl "http://localhost:8000/events?bbox=-75.7,-11.5,-70.4,-7.2&start=2024-09-20&end=2024-09-26"
```

The region can also be given as `region=ucayali` (see `/regions`) or `department=Ucayali`
(see `/departments`). Filters: `min_confidence` (`baja` low, `media` medium, `alta` high),
`min_det`, `event_type`, `limit`/`offset`, `format=geojson` and `engine=index` (in-memory index;
requires at least one detection inside the region and the period).

Each event includes, among other fields (excerpt from a real response):

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

`lat`/`lon` is the centre of the event and `lat_min`…`lon_max` its box. The event's points are
requested with `GET /events/{event_id}/detections`.

What each field means (`n_det`, `frp_total`, `spread_km`, `may_split`, `event_type`,
`hits`…): [`docs/event_fields.md`](docs/event_fields.md).

### Other endpoints

| Endpoint | Returns |
|---|---|
| `GET /events/near?lat&lon&radius_km&start&end` | events with detections within the radius of the point |
| `GET /events/nearest?lat&lon&t&k` | the k nearest events in space-time |
| `GET /events/{id}`, `/events/{id}/detections` | one event and its detections |
| `GET /event-types`, `/regions`, `/departments` | allowed values of the filters |
| `GET /static-sources?bbox` | excluded static sources (volcanoes, gas plants, industry) |
| `GET /health`, `/meta`, `/index`, `POST /index/rebuild` | status and parameters |

## Method in brief

1. **Data:** only the FIRMS standard product (SP) (Giglio et al., 2016; NASA FIRMS, 2026;
   Schroeder et al., 2014), `type 0` (vegetation), without low confidence, clipped to the Peru
   polygon (Natural Earth, n.d.) and assigned to departments (Runfola et al., 2020). Static
   sources are excluded: cells FIRMS flagged as volcano, static land source or offshore, cells
   active almost all year, and a 2.5 km radius around volcanoes.
2. **Events:** two detections belong to the same event if they are ≤ 1.25 km and ≤ 5 days
   apart. They are reduced to 0.5 km × day nodes, a KD-tree (with time as a third axis) finds
   the pairs, and each connected component of the graph is an event (Andela et al., 2022;
   Chen et al., 2022).
3. **Satellite backbone:** the graph is built only with Suomi NPP + MODIS, present over the
   whole period. NOAA-20 (since 2018) and NOAA-21 (since 2023) attach to the nearest event but
   do not link events. Without this, events longer than 30 days went from 23 to 95 just by
   adding satellites.
4. **Calibration:** 1.25 km and 5 days is the combination that best reproduces the GlobFire
   fires in Peru 2013–2017 without splitting or merging them (Artés et al., 2019; Artés
   Vivancos & San-Miguel-Ayanz, 2018).
5. **Event type** (values stored in Spanish): `foco_aislado` (isolated hotspot: < 1 day,
   ≤ 2 km²) and `incendio` (fire: ≤ 22 days, the longest GlobFire fire in Peru). The longer ones
   are `quema_persistente` (persistent burning zone: ≥ 2 separate fronts per day),
   `incendio_prolongado` (long-lasting fire: 1 front per day) or `foco_recurrente` (recurrent
   hotspot: always within ≤ 5 km²).
6. **Projection:** Lambert azimuthal equal-area centred on Peru (distortion < 1 %).

Result: 795,540 events from 1,958,951 detections. The database was checked against published
figures: SERFOR hotspots in Ucayali in 48 hours (El Búho, 2024), the 12 September 2024
bulletin (Servicio Nacional de Meteorología e Hidrología del Perú [SENAMHI], 2024), the
September 2024 record (Cáceres, 2024), the emergency of DS 097-2024-PCM (Presidencia del
Consejo de Ministros, 2024) and the activity of the Ubinas volcano (Instituto Geofísico del
Perú, 2024).

## References

Andela, N., Morton, D. C., Schroeder, W., Chen, Y., Brando, P. M., & Randerson, J. T. (2022).
Tracking and classifying Amazon fire events in near real time. *Science Advances, 8*(30),
eabd2713. https://doi.org/10.1126/sciadv.abd2713

Artés, T., Oom, D., de Rigo, D., Durrant, T. H., Maianti, P., Libertà, G., & San-Miguel-Ayanz, J.
(2019). A global wildfire dataset for the analysis of fire regimes and fire behaviour.
*Scientific Data, 6*, Article 296. https://doi.org/10.1038/s41597-019-0312-2

Artés Vivancos, T., & San-Miguel-Ayanz, J. (2018). *ESRI shapefiles in monthly resolution*
[Data set]. In *Global wildfire database for GWIS*. PANGAEA.
https://doi.org/10.1594/PANGAEA.895898

Cáceres, Z. (2024). *Nota técnica: Incendios forestales en el Perú entre 2002 al 2024*
[Technical note: Forest fires in Peru from 2002 to 2024]. MapBiomas Perú.
https://old-peru.mapbiomas.org/wp-content/uploads/sites/14/2024/11/Nota-tecnica_-Incendios-forestales-en-el-Peru-2002-2024-1.pdf

Chen, Y., Hantson, S., Andela, N., Coffield, S. R., Graff, C. A., Morton, D. C., Ott, L. E.,
Foufoula-Georgiou, E., Smyth, P., Goulden, M. L., & Randerson, J. T. (2022). California wildfire
spread derived using VIIRS satellite observations and an object-based tracking system.
*Scientific Data, 9*, Article 249. https://doi.org/10.1038/s41597-022-01343-0

El Búho. (2024, September 27). *Amazonía peruana arde: Más de 7 000 focos de calor en 48
horas* [The Peruvian Amazon burns: More than 7,000 hotspots in 48 hours].
https://elbuho.pe/2024/09/amazonia-peruana-arde-mas-de-7-000-focos-de-calor-en-48-horas/

Giglio, L., Schroeder, W., & Justice, C. O. (2016). The collection 6 MODIS active fire detection
algorithm and fire products. *Remote Sensing of Environment, 178*, 31–41.
https://doi.org/10.1016/j.rse.2016.02.054

Instituto Geofísico del Perú. (2024). *Reporte vulcanológico diario, 1 de marzo de 2024*
[Daily volcanological report, 1 March 2024].
https://www.igp.gob.pe/servicios/centro-vulcanologico-nacional/sites/default/files/reportes-vulcanologicos/2024/REPORTE%20VULCANOLOGICO%20DIARIO%201%20DE%20MARZO%20DE%202024.pdf

NASA FIRMS. (2026). *Fire Information for Resource Management System: MODIS C6.1 and VIIRS 375 m
active fire detections, standard product* [Data set]. NASA Earth Science Data and Information
System. Retrieved November 15, 2026, from https://firms.modaps.eosdis.nasa.gov/

Natural Earth. (n.d.). *Admin 0 – Countries, 1:10m* [Data set]. Retrieved November 15, 2026,
from https://www.naturalearthdata.com/

Presidencia del Consejo de Ministros. (2024, September 18). *Gobierno declara en emergencia
regiones de Amazonas, San Martín y Ucayali por presencia de incendios forestales* [Government
declares a state of emergency in Amazonas, San Martín and Ucayali because of forest fires]
[Press release on Supreme Decree No. 097-2024-PCM]. Gob.pe.
https://www.gob.pe/institucion/presidencia/noticias/1024206-gobierno-declara-en-emergencia-regiones-de-amazonas-san-martin-y-ucayali-por-presencia-de-incendios-forestales

Runfola, D., Anderson, A., Baier, H., Crittenden, M., Dowker, E., Fuhrig, S., Goodman, S.,
Grimsley, G., Layko, R., Melville, G., Mulder, M., Oberman, R., Panganiban, J., Peck, A., Seitz,
L., Shea, S., Slevin, H., Youngerman, R., & Hobbs, L. (2020). geoBoundaries: A global database of
political administrative boundaries. *PLOS ONE, 15*(4), Article e0231866.
https://doi.org/10.1371/journal.pone.0231866

Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). The new VIIRS 375 m active fire
detection data product: Algorithm description and initial assessment. *Remote Sensing of
Environment, 143*, 85–96. https://doi.org/10.1016/j.rse.2013.12.008

Servicio Nacional de Meteorología e Hidrología del Perú. (2024, September 12). [Bulletin of
hotspots and conditions for forest fires, 12:00 h issue].
https://www.senamhi.gob.pe/load/file/02256SENA-947.pdf
