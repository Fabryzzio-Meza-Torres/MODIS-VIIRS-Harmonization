# Our MODIS–VIIRS Peru API

Documented state: 15 November 2026. API `0.4.0`.

The viewer includes [historical evidence and official records](https://modis-viirs-harmonization-production.up.railway.app/visor/#validacion): a catalog of 15,140 references attributed to INDECI, with matches and non-matches, documents and traceability. Versioned data in `/visor/validation-data/summary.json`; [methodology of this section](WEB_VALIDATION.md). It is a historical comparison, not a validation of physical ignitions or of the future probability.

This version adds the experimental regional forecast: `GET /v1/fire-risk?region_id=08&target_week_start=2026-11-16`, `/v1/fire-risk/outlook` and `/v1/fire-risk/metadata`. It covers 25 regions over 12 weeks, with probabilities of new detected episodes, without verified physical ignition. This issue expires on 22 November 2026 at 00:00 Lima time and still requires manual renewal. Usage, limits and Postman: [forecast pilot](FORECAST_PILOT.md).

## What we did

We published a query API to compare the thermal activity reported by MODIS and VIIRS in Peru. It returns two weekly series on a common statistical scale, with filters by department, cell and dates. It also includes an experimental forecast and a web viewer.

**Base URL:** https://modis-viirs-harmonization-production.up.railway.app

- [Interactive documentation](https://modis-viirs-harmonization-production.up.railway.app/docs).
- [Regional viewer](https://modis-viirs-harmonization-production.up.railway.app/visor/).
- All queries are `GET`, with no API key. CORS allows calling them from an external website.
- The service queries precomputed results; it does not train models per request.

**Scope:** this domain publishes our series API. The teammate's events API is still a separate service; it is not yet integrated behind this URL.

## Available data

| Series | Start | Last day included |
| --- | --- | --- |
| MODIS | 2000-11-06 | 2026-07-26 |
| VIIRS | 2012-02-06 | 2026-07-26 |

The unit is a UTC week, Monday to Sunday. There are 13,405 cells of 10 × 10 km that intersect Peru and a catalog of 25 departments/Callao. MODIS keeps 10 national weeks without an estimate; before VIIRS starts, its values are null.

## Main routes

All routes are appended to the base URL.

| Route | Purpose |
| --- | --- |
| `/health` | Service status and presence of the historical snapshot |
| `/v1/empirical/metadata` | Method, period and limitations of the data |
| `/v1/regions` | Department codes and names |
| `/v1/regions/locate?latitude=-13.5319&longitude=-71.9675` | Department that contains a coordinate |
| `/v1/regions/08/geometry` | Cusco polygon as GeoJSON |
| `/v1/empirical/series` | Weekly series of both instruments |
| `/v1/empirical/cells?region_id=08` | Cells that intersect Cusco |
| `/v1/forecasts?region_id=08` | Experimental forecast per cell |
| `/v1/validation` | Validation results and limitations |

`/v1/series` is reserved for a future series with full coverage correction. For the delivered data, use **`/v1/empirical/series`**.

## Query example

Comparison for Cusco during August 2023:

```text
GET https://modis-viirs-harmonization-production.up.railway.app/v1/empirical/series?region_id=08&start=2023-08-01&end=2023-09-01
```

- `region_id`: department code; `08` is Cusco. Without a place filter it returns the total for Peru.
- `start`: first date, included. `end`: last date, excluded.
- `instrument=MODIS` or `instrument=VIIRS`: optional; without a filter it returns both.
- `cell_id`: queries a single cell; cannot be combined with `region_id`.
- `week_selection=starts_within`: default behaviour; selects weeks whose Monday is inside the interval.
- `week_selection=overlap`: includes weeks that overlap the interval. It returns whole weeks, without splitting their counts across days.
- `limit` and `offset`: pagination, with a maximum of 1,000 records per request. Continue with `pagination.next_offset` until it is `null`.

In Postman: select **GET**, paste the URL and click **Send**.

```javascript
const base = "https://modis-viirs-harmonization-production.up.railway.app";
const params = new URLSearchParams({
  region_id: "08",
  start: "2023-08-01",
  end: "2023-09-01"
});
const response = await fetch(`${base}/v1/empirical/series?${params}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const result = await response.json();
console.table(result.data);
```

## How to read the response

The response contains `metadata`, `data` and `pagination`.

| Field of each record | Meaning |
| --- | --- |
| `week_start_utc` | Monday of the week |
| `instrument` / `platform` | Selected instrument and platform |
| `raw_count` | Original number of detections of that platform |
| `harmonized_count` | Count adjusted to the common scale |
| `lower_bound` / `upper_bound` | 95 % uncertainty band of the calibration factor |
| `coverage_status` | Currently `unknown`: full coverage is not certified |
| `estimation_status` | `estimated` if there is an estimate; `unavailable` if it is missing |

A null value does not mean zero fires. An adjusted count is not a number of independent fires either. The method version and the snapshot identifier are in the metadata.

`record_probability`, in `/v1/forecasts`, is an experimental probability of a satellite record for the week of **16–22 November 2026**. It is not an operational ignition probability or a forecast updated daily.

## Implementation, deployment and tests

- **FastAPI + SQLite:** read-only query snapshot, published compressed in `data/history.sqlite.gz`.
- **Geography:** an R*Tree finds candidates and then the exact polygon is checked. B-tree indexes speed up queries by region, instrument and date.
- **Regional counts:** assigned by the original location of each detection, not by the centre of a border cell. Cell queries use area intersection; cell `bbox` filters use their centres.
- **Railway + Docker:** the build restores the snapshot, checks SHA-256 and SQLite integrity and makes it readable by the non-root user. A check during the build queries the data as that user.
- **Verification:** 34 API tests passed while preparing the deployment, plus an external check of the domain: snapshot, CORS, regions, coordinates, regional values, forecast and absence of a public administrative rebuild.

`/health` checks that files exist, not the full integrity of the queries. It may show `database_available=false` because the old `firms.sqlite` database is missing, while `historical_snapshot_available=true` identifies the current snapshot. The external check does query data results.

Useful files: [API code](../api/api.py), [historical queries](../api/history_api.py), [Postman](../api/POSTMAN_REGIONES.postman_collection.json), [JavaScript client](../api/cliente.js), [Dockerfile](../deploy/series.Dockerfile) and [public verifier](../deploy/verify_public.py).

To run locally, from the repository root:

```bash
python -m pip install -r api/requirements.txt
python api/restaurar_snapshot.py
python api/serve.py
```

The local API is at `http://localhost:8000/docs`. To verify the real deployment:

```bash
python deploy/verify_public.py https://modis-viirs-harmonization-production.up.railway.app
```

Integration with the events API and the new model with weather data and NRT are pending work. The methodology of the delivered version is in [METHODOLOGY.md](METHODOLOGY.md).
