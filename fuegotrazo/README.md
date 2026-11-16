# FuegoTrazo dashboard

React interface for exploring reported thermal activity in Peru. The application
uses two independent public APIs. Satellite detections, grouped historical events,
comparable counts and experimental probabilities are shown as separate products.

## Services

| Service | Environment setting | Main routes |
| --- | --- | --- |
| Historical series and forecasts | `VITE_API_BASE`; defaults to the published Railway service | `/v1/regions`, `/v1/regions/geometry`, `/v1/empirical/metadata`, `/v1/empirical/series`, `/v1/validation`, regional forecast routes |
| Historical events | Fixed upstream in the Netlify function | `/meta`, `/departments`, `/events`, `/events/{id}`, `/events/{id}/detections` |

The application does not use the reserved `/v1/series` endpoint or substitute the
older cell-based `/v1/forecasts` experiment for the regional forecast.

## Development

```bash
npm ci
npm test
npm run dev
npm run build
```

The Vite development proxy uses the same event-request rules as production.
The tests cover aggregations, proxy rules, department mapping, geography,
province statistics, contacts, planning inputs and forecast availability.

## Interpreting the products

- **Detections:** satellite observations of active-fire or thermal-anomaly pixels.
  They are not individually verified physical fires.
- **Events:** algorithmic groups of detections. Event type and confidence come
  from that grouping process, not from official incident confirmation.
- **Comparable counts:** statistical estimates on a shared instrument scale.
  A missing estimate is not zero. Bands are shown only where provided.
- **Regional forecasts:** experimental probabilities for a whole department
  during a published target week. They do not identify a point, province,
  burned fraction, event severity or confirmed physical ignition.

Dates are product-specific: historical series use UTC weeks and exclusive end
dates; event queries use UTC dates with an inclusive end; regional forecasts use
Monday-to-Sunday America/Lima weeks with an exclusive following Monday.

## Geographic inputs

Province boundaries and capitals come from
[juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson), under MPL-2.0.
They are simplified 2016 geometries in `public/geo/`, not current official
cadastral boundaries. They can differ from the APIs' geometries. Fragmented
source names are joined by identifier in `src/lib/geo.ts`.

Provincial event statistics use these polygons. Event totals overlapping the
selected period are reconciled with the displayed onset-date series; events
starting before the period are counted separately. Area-normalized figures use
the geodesic area of the displayed simplified polygon, not an official land-area
statistic. The original validation compared 195 polygons with their source
area attributes: all differences were within 10%, with 185 within 2%.

## Event proxy

The event service did not return cross-origin access headers during integration.
`netlify/functions/events.mts` exposes the read-only `/api/events/*` proxy on the
application's own origin. Its upstream is fixed. Allowed paths and parameters
are defined in `src/lib/proxy-rules.ts`, with a maximum 366-day range,
`limit <= 1000`, a 20-second timeout and five-minute caching.
Arbitrary upstream URLs are not accepted.

## Deployment

Netlify deploys this directory from the repository's `main` branch:

- Base directory: `fuegotrazo`
- Build command: `npm run build`
- Configuration: `netlify.toml`

The ignore rule avoids rebuilding the dashboard for changes outside its source
directory. The series API Dockerfile has a separate allowlist that excludes this
application.

Optional manual deployment from this directory:
`npx netlify-cli deploy --prod --build`.

The interface remains in Spanish; repository documentation is in English.
