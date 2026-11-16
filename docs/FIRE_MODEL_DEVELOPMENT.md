# Regional episode-proxy model: development record

This document records the design and review stages of the original regional episode-proxy experiment. That experimental release was approved, published and verified on 15 November 2026. The milestones below describe delivery stages, not scientific confidence. Results and limitations: [EXPERIMENTAL_MODEL_RESULTS.md](EXPERIMENTAL_MODEL_RESULTS.md). The broader recorded-activity target is evaluated separately; it must not be inferred by renaming this model's output.

## Proposed objective

**Objective confirmed by the team:** show a percentage risk of at least one new fire starting in a region of Peru during a selected future week. We will use the regional codes of our API. The 10 km cells may serve as internal support for features; the final result is regional.

The target variable is the start of a new fire, not the continuation of an existing one. Satellite detections are indirect labels: the first record does not prove the real ignition time and does not by itself distinguish agricultural burning. We must rebuild starts without future information and check their labels before presenting the percentage as a physical fire probability. Active events and potential losses are separate outputs.

Interpretation example: 60 % for Cusco and a future week means an estimated probability that at least one new eligible fire starts there during that week; it does not mean that 60 % of Cusco will burn. It is a contract example, not a computed prediction.

We will evaluate the regional label directly. We will not add or average cell probabilities or assume their independence. We will also check whether the result saturates near 100 % in large regions; an expected count can complement the probability, without silently changing the objective.

The target week runs from Monday 00:00 to the following Monday 00:00 in America/Lima. **Requested lead time: 1 to 12 weeks.** Week 1 is the next full week after the issue date; week 12 starts eleven weeks after week 1. The product must evaluate each lead time separately and reject combinations without enough support.

Twelve output weeks do not mean twelve weeks of accurate daily weather. ECMWF medium-range weather models reach 15 days and sub-seasonal ones 46 days. For longer lead times, seasonal/probabilistic predictors will be used if we have verifiable historical issues; otherwise an explicit historical/seasonal reference will be evaluated. We will not use the realized future weather as if it had been forecast. Sources: [ECMWF medium range](https://www.ecmwf.int/en/forecasts/documentation-and-support/medium-range-forecasts), [sub-seasonal](https://www.ecmwf.int/en/forecasts/about-our-forecasts/sub-seasonal-range-forecasts) and [seasonal fire danger indices](https://www.ecmwf.int/en/forecasts/datasets/seasonal-forecast-fire-danger-indices-copernicus-emergency-management-service).

## Data already reviewed

| Source | What it provides | Status |
| --- | --- | --- |
| Our API/snapshot | Weekly harmonized history, grid and MINAM regions | Local and public snapshots match |
| Teammate's `deploy-docker` branch | Individual detections, events and static sources | Backup downloaded and SHA-256 verified |
| Four original FIRMS ZIP files | Rebuilding filters without looking at the future | Prepared; NOAA-20 used for labels and the pilot's NRT |
| Observed NASA POWER weather | Past temperature, humidity, precipitation and wind | 135,750 daily records at 25 regional points; no future forecast used |
| NOAA-20 NRT | Recent features | 40,384 detections prepared from the original download; automatic refresh and SP/NRT transfer pending |

**Reference platform confirmed by the user: NOAA-20.** NOAA announced the end of Suomi-NPP product delivery on 2 November 2026. We use NOAA-20 for the new objective and its recent signals; MODIS and Suomi-NPP remain in the harmonized historical context. The change of reference does not discard their series. [Updated NOAA notice](https://www.nesdis.noaa.gov/news/update-3-cessation-of-suomi-national-polar-orbiting-partnership-s-npp-data-users-november-02-2026-1540-utc-and-decommissioning-issued-october-30-2026-1400-utc).

The teammate's branch is pinned to commit `3084cc5681bac763fdd651e01cef1d6a12461520`. Its dump is 131,915,596 bytes with SHA-256 `5382be98a0221e528995f2d44470d03f0e2bcc2307bc0a61410744c745aa7e71`.

The data were extracted without running the backup's SQL and without modifying existing databases:

- 795,540 events.
- 1,958,951 SP detections, between 2012-01-20 and 2026-07-31.
- 4,803 static-source cells.
- Zero duplicated detection IDs, invalid dates/coordinates, negative or missing FRP, and references to non-existent events in the checks that were run.

This proves structural integrity; it does not certify that every row is a real fire and does not replace label validation.

## Differences we must resolve

1. **Different filters:** our history keeps SP type=0 without a common confidence threshold; the teammate excludes low confidence and static sources. We will not add both counts or transfer our factors to their aggregates without checking.
2. **Different geography:** their departments are geoBoundaries and their LAEA is spherical. We will reproject from latitude/longitude to our grid; we will not reuse their `x_km`, `y_km` or department directly as equivalent identifiers.
3. **Final event fields:** centre, duration, type, aggregated confidence, total FRP and displacement use the event's future. They will not be input features as they come. Where appropriate, we will rebuild them only with detections before the issue.
4. **Retrospective mask:** the static-source exclusion uses all of 2012–2026. We must recompute it with the available past or declare the dump an auxiliary retrospective source. The main evaluation cannot be presented as a clean operational simulation while silently using that filter.
5. **Real availability:** `t_utc` is the acquisition time, not the publication time. The SP backtest does not prove performance with NRT. `acquired_at`, `available_at` and `ingested_at` will be kept when they exist; their differences will not be invented.

## How we will build each row

### Label pilot already run (development, 2013)

To check the objective before training, we used the original Suomi-NPP SP file, type=0 and nominal/high confidence, without applying the teammate's retrospective mask. It is a stable reference platform within the pilot, not a final protocol for all of 2012–2026/NRT.

Candidate rule: an episode starts with a detection that has no other detection within 1.25 km during the previous five days. Detections at the same instant are grouped spatially; if their component connects with previous activity, it is treated as a continuation. Past episodes are not rewritten when later observations arrive.

59,225 detections from the 2013 target period were processed, plus an earlier buffer to avoid false starts caused by the file cut-off. The rule produced 33,057 candidates, with at least one occurrence in 1,057 of 1,300 region–week combinations (81.31 %). With 1 km/3 days and 2.5 km/7 days, the regional prevalence was 81.38 % and 80.85 %. These are descriptive development results, not model metrics.

50 start/continuation cases were generated for human review. Three tests check invariance to adding the future, joint treatment of simultaneous detections, and temporal/spatial limits. False starts may still appear because of clouds, a moving front or agricultural burning; a first record does not mean ignition. The labels are not approved for final training.

Reports: `reports/prediction/onset_pilot_report.json` and `reports/prediction/regional_prevalence_pilot.csv`. The detection detail and the 50 cases stay locally in the pilot's output directory, without being published or modifying the API.

### NOAA-20 dataset already built

The NOAA-20 reference covers 16 April 2018 to 26 July 2026, in complete local weeks. 577,813 detections of the target period were kept; the algorithm generated 324,828 start candidates. They are indirect labels, not an inventory of verified physical fires.

The non-vegetation filter was fixed with 2,892 cells identified as type=1/2/3 **before 16 April 2018**, without learning persistence from 2018–2026. 3,317 detections were excluded from the file with buffer. The teammate's full retrospective mask was not carried over to training.

The final table contains **115,350 region–issue–target-week rows**, 25 regions and lead times 1–12. It includes 32 features, counting the regional identifier and the lead time. There are 51,450 training rows, 13,650 selection rows, 13,950 calibration rows, 29,250 retrospective test rows and 7,050 rows for the 2026 confirmation. 7,800 rows whose target weeks did not end before the limit of their period were removed. Rows with different lead times can share the same region/target week; they are not independent results.

The issue protocol for this version is Sunday 00:00 Peru time; week 1 starts the following Monday and week 12 eleven weeks later. The historical features include counts/FRP and previous candidates over 7/28/90 days, harmonized context from one year earlier and past weather. Missing harmonized context stays null, together with an indicator; daily counts are not invented from weeks.

The delays of three days for detections and seven days after the end of the weather day are **simulation assumptions**, not proven historical publication times. The SP files and current reanalyses do not allow an exact reconstruction of which version would have been available then. Therefore the future results of this dataset will be retrospective until the transfer to NRT is validated and a prospective pilot is run.

The weather data are samples at one interior point per department, not area averages. No realized future weather has been used. The prepared NRT does not provide the type field: it is kept unknown, without inventing type=0 or using it as a training label. The last acquisition in the NOAA-20 file is 2026-11-13 18:47 UTC; the source must be updated before running a periodic service.

Evidence: `reports/prediction/dataset_manifest.json`, `evaluation_protocol.json`, `weather_manifest.json`, `noaa20_label_manifest.json` and `nrt_ingestion_report.json`. Executed review: `notebooks/15_dataset_riesgo_regional.ipynb`.

A row of the final model corresponds to a region, an issue date and a future target week. An intermediate per-cell table may be prepared. Features must be available before the issue; data from the future week cannot enter as features.

Candidate features:

- Previous detections and FRP per platform over 1, 7, 30 and 90-day windows, with duplicate and availability checks.
- Harmonized history of weeks already finished and published; seasonal recurrence from previous years.
- Nearby activity signals computed only with the past.
- Past weather and forecasts issued before the cut-off. We will not replace historical forecasts with the weather that actually happened afterwards.
- Geography and vegetation with a documented reference date.
- Indicators of missing data, input age and available platforms.

Desired label: at least one new start in the region during the target week, under an episode/platform/filter protocol that we will fix before training and check against references. A negative label in the archive means no recorded start, not physical absence of fire. Incomplete windows are excluded or marked unknown. The initial detection will be distinguished from the continuation of a previous episode.

The published count calibration will be treated as a frozen/versioned component; we will check that its fitting date is compatible with each evaluation. Original daily data are needed: the API's weekly series is not disaggregated by inventing daily counts.

## Models and evaluation

Regional/seasonal climatology, a simple baseline and LightGBM were compared for the objective of new detected starts, with calibration and evaluation by region and lead time. Our earlier weekly experimental forecast serves as a product reference, but not as a direct comparison because its label is reported activity per cell, not a new regional start.

The candidate chosen in selection was LightGBM without the harmonized context features. In the test it practically tied with climatology in 2024, reduced Brier by 8.8 % in 2025 and by 3.9 % in the 2026 confirmation. The joint block improvement includes zero, and the calibration transform did not improve the joint retrospective Brier/ECE. The model was not changed after opening these evaluations. The artifact is saved and verified; current inference and its integration are still missing.

- Chronological validation with rolling windows and spatial separation by blocks.
- Training labels must end before the next evaluation period; a gap matching the seven-day horizon is applied.
- Hyperparameter tuning and probability calibration use periods separate from the evaluation period.
- PR-AUC, Brier, calibration curve, false alarms and precision/recall among the priority zones. The evaluation set keeps the real prevalence.
- Comparison with and without the teammate's data, with and without weather, and with different platform regimes.
- 2024–2025 were already examined in earlier work: comparisons there will be retrospective. Before opening results of the new model we will fix the protocol and reserve a prospective evaluation.

We will not choose LightGBM automatically: it must beat a useful reference and produce sufficiently calibrated probabilities. A poorly calibrated percentage will not be published as a reliable risk.

## Deliverables and human reviews

These percentages represent planned deliverables; not time spent or scientific quality.

| Step | Reviewable deliverable | Cumulative progress |
| --- | --- | --- |
| 1 | Source audit and contract proposal | 20 %: finished and reviewed |
| 2 | Reproducible experimental dataset and checked time cut-offs; explicit simulated historical availability | 45 %: finished and reviewed |
| 3 | Baselines, LightGBM and evaluation on held-out time/departments | 70 %: finished and reviewed |
| 4 | Calibration, regional errors and NRT pilot | 90 %: finished and reviewed |
| 5 | API, HTTP/CORS checks for web connection and documentation | 100 %: experimental version approved, published and verified |

At the end of each step, results and decisions are presented; the next one starts after your review. No percentage replaces the acceptance criteria.

## Planned integration

It was trained with versioned files/snapshots, without requesting millions of records from the API on each run. The pilot generated 300 predictions in a snapshot that the public API already reads. The periodic update task is not implemented yet: this issue expires on 22 November 2026 at 00:00 Lima time. Results, validity and tests are in `FORECAST_PILOT.md`.

Route approved, published and verified on Railway:

```text
GET /v1/fire-risk?region_id=08&target_week_start=YYYY-MM-DD
```

Each result will identify the region, issue, target week, lead time, probability of at least one new start and its meaning, data quality/freshness, and model and dataset versions. If the required NRT or weather data are missing, it will return an explicit status or a separate historical product; not a seemingly current probability.

Priority for governments will be computed separately, crossing probability with population, protected areas and response capacity. We will not add cell probabilities to invent a regional probability, nor present that ranking as expected human losses.

**Decisions incorporated:** the team prioritizes the start of new fires per region and future week, with up to 12 weeks of lead time. NOAA-20 is the approved reference. The pilot uses new detected episodes as an indirect label; physical ignition was not validated. The experimental delivery is approved and published. Operational use for protecting lives requires validation and institutional review beyond the pilot.
