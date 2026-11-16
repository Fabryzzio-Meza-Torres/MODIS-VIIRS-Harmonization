# Regional pilot: what we deliver and how to test it

This document describes the archived episode-proxy experiment. For the current detected-activity target and API, see [Weekly detected fire activity](OBSERVED_FIRE_ACTIVITY.md).

Status: **100 % of the approved experimental delivery**, published and verified on 15 November 2026. API `0.4.0`, at https://modis-viirs-harmonization-production.up.railway.app. Automatic updating and validation of physical ignition remain pending as later work.

## What the percentage means

Experimental probability of **at least one new fire episode detected by NOAA-20 anywhere in a department during one week**. It is not the percentage of area that will burn, severity, human losses or a validated probability of physical ignition. It may include agricultural burning and late detections. The labels were rebuilt causally with a spatial rule of 1.25 km and 5 days, not with the teammate's future aggregates.

The winning model is LightGBM, selected before opening the final evaluation. Climatology, logistic regression and LightGBM variants were compared. The winning variant excludes the harmonized annual context: adding it did not improve the selection. The harmonized series are still a separate historical product. It is not presented as a model that necessarily uses those series.

The per-lead-time calibration was fitted on 2023. The model ties with climatology in 2024 and improves in 2025 and 2026; calibration did not improve the joint test. See `EXPERIMENTAL_MODEL_RESULTS.md` for metrics and limits. No individual confidence intervals were invented.

## Available issue

* Actual issue time: **15 November 2026, 15:39:33 Lima time**.
* Feature reference: Sunday 15 November, 00:00 Lima time. The issue was not backdated.
* 25 departments × 12 weeks = **300 results**.
* First week: **16–22 November 2026**.
* Last week: **1–7 February 2027**; exclusive end: 8 February.
* Expires for current queries: **22 November 2026, 00:00 Lima time**. A later GET returns 503 until the issue is renewed; metadata stays available.

Examples for the first week: Cusco **97.67 %**, Callao **11.07 %**, Tacna **45.83 %**. High percentages reflect that one episode anywhere in the department is enough: about 84 % of the training rows were positive. Each lead time is a specific week, not the cumulative risk over 12 weeks.

## Inputs and checks

NOAA-20 NRT: last acquisition 13 November, 18:47 UTC. The features used records before 12 November, 05:00 UTC, with a window of up to 90 days. The NRT file does not confirm the fire type; `type=0` was not artificially assigned to it. The SP→NRT transfer has not been validated with future results.

NASA POWER: one interior point per department, not a territorial average. Last weather day used: 7 November, with a conservative simulated availability. No realized future weather was used and no daily weather forecasts 12 weeks ahead were invented. The model depends mainly on region and season.

The inference extractor reproduces the **115,350** historical rows with an absolute tolerance of 1e-12 and the same pattern of missing values. Five tests check the causality of the cut-off, stale data, missing features and invalid calendars. The API passed 43 tests, including integrity, dates, percentages, expiry and regressions of the historical data.

## Local API and Postman

From the repository root, with the API environment activated:

```powershell
python -m pip install -r api/requirements.txt
python -m uvicorn api:app --app-dir api --host 127.0.0.1 --port 8010
```

In Postman, import `api/POSTMAN_FIRE_RISK.postman_collection.json`. Its `base_url` variable points to `https://modis-viirs-harmonization-production.up.railway.app`. To test a local server, change it to `http://127.0.0.1:8010`.

```http
GET /v1/fire-risk/metadata
GET /v1/fire-risk?region_id=08&target_week_start=2026-11-16
GET /v1/fire-risk/outlook?region_id=08
GET /v1/fire-risk/outlook?limit=300
```

The query requires the Monday of the week. It does not return forecasts for arbitrary dates outside the 12 published weeks. Unknown region or week outside the issue: 404. Date that is not a Monday: 422. Snapshot missing, corrupt, not issued or expired: 503. A record without support keeps `probability: null` with the reason; it is never turned into zero.

Main fields: `region_id`, `region_name`, `issued_at`, `target_week_start`, `target_week_end_exclusive`, `lead_weeks`, `probability`, `probability_percent`, `estimation_status`, `quality_status`, `unavailable_reasons` and `features_outside_region_training_range`. Range warnings are not confidence intervals.

The metadata identifies the version, hashes, input dates and validity. `target_period_status` distinguishes a future week from a week already started. The API serves a precomputed snapshot, without retraining per request or changing the percentage when queried.

Reusable client in `web/fire-risk-client.js`:

```javascript
import {createFireRiskClient} from './fire-risk-client.js';
const risk = createFireRiskClient('http://127.0.0.1:8010');
const result = await risk.week('08', '2026-11-16');
console.log(result.data[0].probability_percent);
```

If the query fails, show "forecast not available" and the reason. Do not silently reuse an expired percentage. The 12 available weeks are listed in the metadata, so the web calendar can limit its options.

## Reproduce without retraining

The API snapshot and its manifest are in `data/regional_outlook*.json`. The service only needs the API dependencies. The trained model and large data stay in the local `outputs/` directories, outside Git; regenerating issues requires those artifacts and fresh NRT and weather data. The generation scripts accept explicit paths; `python pipeline/generate_regional_outlook.py --help` lists their arguments.

A new issue is validated, packaged with `pipeline/package_regional_outlook.py` and deployed. Packaging does not validate or update the scientific data. No cron job was left that would serve the percentages of this issue indefinitely.

Executed review notebook: `notebooks/17_piloto_pronosticos_regionales.ipynb`. Evidence and an example local response: `reports/prediction/pilot/`.

The final container was built and checked as an unprivileged user. Eleven HTTP checks against `http://127.0.0.1:8010` passed, including history, location, CORS and the new routes. The local container `modis-viirs-risk-review-20261115` is running on this machine; Swagger is at `/docs`. To stop only that review viewer: `docker stop modis-viirs-risk-review-20261115`. Do not run that command if you want to keep testing in Postman.

Publication approved by the user. The eleven checks also passed against the public URL: evidence in `reports/prediction/pilot/public_HTTP_verification.json`, with the code commit and the UTC time of verification. The teammate's public API is still independent; its backup was used for comparison, and it is not declared merged just because it shares this project.
