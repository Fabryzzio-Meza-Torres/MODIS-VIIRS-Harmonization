# FuegoTrazo: MODIS–VIIRS harmonization for Peru

FuegoTrazo compares MODIS and VIIRS thermal detections on a common statistical scale and provides a web interface for exploring Peru's historical observations, grouped events and experimental forecasts.

The harmonized counts describe reported satellite observations. They are not a census of independent fires, and the historical series has not been fully corrected for observation coverage.

## Applications

- [FuegoTrazo dashboard](https://fuegotrazo-modis-viirs.netlify.app/)
- [Series and forecast API](https://modis-viirs-harmonization-production.up.railway.app/docs)
- [Historical evidence catalog](https://modis-viirs-harmonization-production.up.railway.app/visor/#validacion)
- [Historical events API](https://peru-fire-events-api-production.up.railway.app/docs)

The two APIs are separate services. The dashboard combines their results without treating detection counts, grouped events and probabilities as interchangeable quantities.

## Run the API

Use Python 3.13 and an isolated environment:

```bash
git clone https://github.com/Fabryzzio-Meza-Torres/MODIS-VIIRS-Harmonization.git
cd MODIS-VIIRS-Harmonization
python -m pip install -r api/requirements.txt
python api/restaurar_snapshot.py
python -m uvicorn api:app --app-dir api --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs. Snapshot restoration checks file hashes and SQLite integrity. It does not require Earthdata credentials or the original FIRMS downloads.

## Run the dashboard

The React application is in `fuegotrazo/`. Node 22.23.2 was used locally.

```bash
cd fuegotrazo
npm ci
npm test
npm run dev
```

Use `npm run build` for a production build. Netlify reads the configuration in `fuegotrazo/netlify.toml`. Railway builds the series API with `deploy/series.Dockerfile`.

## Data and methods

- MODIS historical series: 6 November 2000–26 July 2026.
- VIIRS historical series: 6 February 2012–26 July 2026.
- Historical counts use UTC weeks, with an exclusive end date in API queries.
- Forecasts are experimental weekly probabilities for entire departments, using America/Lima weeks. A department-level probability is not a province or point forecast.
- The evidence catalog contains 15,140 references attributed to INDECI, including records without a satellite match. Spatial and temporal association does not establish incident attribution or validate future physical ignitions.

NASA FIRMS supplies the satellite observations; NASA POWER supplies the regional-point weather inputs used in the forecasting experiments. Official MINAM records and COEN–INDECI documents provide historical comparisons. Source provenance and limitations are documented alongside each analysis.

## Documentation

- [API reference](docs/API.md)
- [Harmonization methodology](docs/METHODOLOGY.md)
- [Regional forecast pilot](docs/FORECAST_PILOT.md)
- [Model evaluation](docs/EXPERIMENTAL_MODEL_RESULTS.md)
- [Historical evidence catalog](docs/WEB_VALIDATION.md)
- [Dashboard setup and data semantics](fuegotrazo/README.md)
- [Reproduction instructions](pipeline/REPRODUCE.txt)

Documentation is in English. The public interface remains in Spanish for its intended audience. Existing filenames, field identifiers, official source documents and versioned release archives retain their original names and contents where required for compatibility and traceability.

Raw FIRMS archives, authentication files and local training caches are not stored in Git. The repository includes versioned derived snapshots, code, evaluation reports and executed notebooks.

Current experimental forecast: [weekly detected fire activity, API contract and evaluation](docs/OBSERVED_FIRE_ACTIVITY.md).
