# Weekly detected fire activity

The current experimental forecast estimates the probability of at least one eligible NOAA-20 detection being recorded anywhere in a department during a specified week. It supports 25 departments, including Callao, and 12 separate weekly horizons. It does not estimate the probability of a verified physical ignition, the proportion of land that will burn, or losses to people or infrastructure.

## Why the percentages can be high

One detection anywhere in a large department is sufficient for a positive outcome. The historical labels are positive in 82.82% of the 10,800 department-weeks. A high probability can therefore be a reasonable estimate of a common observation, without indicating extreme danger. We have not reduced probabilities for presentation.

The website places each estimate beside the frequency observed in comparable historical weeks and their difference in percentage points. The reference uses fully closed weeks from earlier years within 14 seasonal days of the target week, available before issuance. At least 20 weeks are required; smaller samples produce a null reference. These frequencies are descriptive, not independent binomial samples or confidence intervals. The difference is not an alert or a significance test.

## Labels and model

The standard-processing archive supplies labels: NOAA-20 detections with inferred type 0, nominal or high confidence, after the pipeline's frozen historical non-vegetation exclusion. Type 0 means presumed vegetation fire; it is not an independently verified wildfire. Agricultural burning and classification errors remain possible.

Training uses 2018–2021. Selection uses 2022, calibration uses 2023, and retrospective evaluation covers 2024, 2025 and January–July 2026. These evaluation periods were already examined during this project; they are not a new blind test. The fixed comparison includes a constant, seasonal climatology, logistic regression and LightGBM. The selected model is LightGBM. Three harmonized context features were excluded following the previous experiment; the harmonic series remains a separate data product rather than evidence of extra forecasting skill.

The model selection rule requires at least a 1% improvement in macro-horizon Brier score over climatology on 2022. A separate spatial diagnostic excludes five departments from fitting, selection and calibration. Its results are retrospective diagnostics, not proof of generalization to other countries.

| Retrospective period | Calibrated model Brier | Climatology Brier |
| --- | ---: | ---: |
| 2024 | 0.0840 | 0.0842 |
| 2025 | 0.0682 | 0.0744 |
| January–July 2026 | 0.0899 | 0.0935 |

Lower Brier is better; it is not a percentage accuracy. The 2024 result is practically tied. Per-horizon Platt calibration, fitted on 2023, did not improve pooled 2024–2025 Brier (0.07663 calibrated versus 0.07642 raw). Both outcomes are retained in the reports; no calibrator was selected using these evaluation scores.

## API and web contract

The API version is 0.5.0. The current target is served separately from the earlier episode-onset proxy:

```text
GET /v1/fire-activity/metadata
GET /v1/fire-activity/outlook?region_id=20&limit=300
GET /v1/fire-activity?region_id=20&target_week_start=2026-11-16
```

The response contains `metadata`, `data` and `pagination`. Each row includes `probability_percent`, `historical_reference` (frequency, positive weeks, denominator and years), and `difference_from_historical_frequency_pp`. Nulls mean unavailable; they are never replaced with zero. Metadata identifies the target, source hashes, issue time, expiry and limitations. Unsupported province or point filters return HTTP 422. Department probabilities cannot be averaged into a national probability.

The published issue contains 300 department/horizon combinations. It uses a Sunday reference in America/Lima and Monday-to-Monday target weeks with exclusive ends. The actual issue time is recorded separately from the reference. It expires on 22 November 2026 at 00:00 Lima time; expired data returns HTTP 503 until an updated issue is published. Updating is manual. Historical-series routes and the archived `/v1/fire-risk` experiment retain their original meanings.

The web shows an explicit department scope, historical context, retrospective evaluation and links to the official historical evidence. A province in a shared page URL does not make this a province forecast. The evidence gallery displays documented matching examples; its instrument association counts keep the original reference denominators and cannot be interpreted as forecast accuracy.

## Reproduction and remaining work

`pipeline/train_regional_activity.py` records the frozen protocol, model and dataset hashes. `pipeline/generate_regional_activity.py` checks the current feature cache and input provenance before issuing predictions. `pipeline/package_regional_outlook.py` preserves the exact snapshot bytes and produces a manifest. The API verifies that manifest, the time window, the target and the historical arithmetic before serving data.

Versioned reports are in `reports/prediction/activity_v02/`; the earlier high-probability audit is in `reports/prediction/probability_audit/` and notebook 19. API tests cover integrity, expiry, unavailable values and geographic filter rejection. `pipeline/qa_activity_web.py` checks the actual API-backed desktop/mobile interface.

Prospective evaluation and standard-processing-to-NRT transfer validation remain outstanding. Cloud and observation coverage are not fully corrected. Weather represents one point per department, not a territorial average, and the model does not use a daily weather forecast extending 12 weeks. Individual uncertainty intervals and independently verified ignition probabilities are unavailable. These restrictions are part of the public metadata and interface.

Product definitions: [NASA VIIRS active fire documentation](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html) and [FIRMS detection limitations](https://firms.modaps.eosdis.nasa.gov/alerts/notes.php).
