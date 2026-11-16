# Result of the experimental regional training

This document describes the archived episode-proxy experiment. For the current detected-activity target and API, see [Weekly detected fire activity](OBSERVED_FIRE_ACTIVITY.md).

Date: 2026-11-15. Version: `regional-onset-proxy-v0.1`. Progress by deliverables: **70 %**. The model is trained and evaluated; it is not published in the API yet.

## What it predicts

Probability of at least one **new fire episode detected by NOAA-20** in a region of Peru during a target week, with lead times of 1 to 12 weeks. It is an indirect start label; it is not yet a validated probability of physical ignition and does not automatically tell apart every agricultural burn.

The output describes one week, not the cumulative risk over twelve weeks. Regional percentages are modelled directly; cell probabilities are not added up.

## What we trained and how we chose

We compared eight candidates: constant, regional/monthly climatology, logistic regression and five LightGBM variants. The variants test complexity and the contribution of weather and harmonized history. We did not artificially balance the data.

- Fitting: 2018–2021, with target weeks matured before the limit.
- Selection and early stopping: 2022.
- Monotonic probability calibration per lead time: 2023.
- Retrospective test: 2024–2025, previously examined in the earlier project.
- 2026 confirmation: opened after freezing the selection, without using it to choose the model.
- Selection metric: mean Brier per lead time; a more complex model needs at least a 1 % improvement over the simpler candidate.

The chosen candidate was **LightGBM without the three harmonized context features**, with 29 features. Its selection Brier was 0.07017 against 0.07297 for climatology: a relative improvement of about 3.8 %.

This does not invalidate the harmonized series: they are a historical comparison product. In this experiment their annual features did not add an incremental improvement over NOAA-20 history, region, season and weather. The model does not add FRP across platforms or apply count factors to FRP.

## Results outside the fit

Comparison of probabilities with the calibration transform fixed in 2023. **Lower Brier is better**; it is not a percentage of correct answers.

| Period | Calibrated climatology | Selected LightGBM | Reading |
| --- | ---: | ---: | --- |
| 2024 | 0.08300 | 0.08302 | Practically tied; candidate slightly worse |
| 2025 | 0.07435 | 0.06782 | 8.8 % Brier reduction |
| 2026 confirmation up to July | 0.09286 | 0.08919 | 3.9 % Brier reduction |

The joint 2024–2025 improvement has a block interval that includes zero: a Brier gain of 0.00304, 95 % percentile interval from **−0.00082 to 0.00682**. These are 1,000 replicates over nine blocks of 13 target weeks, keeping the model fixed. It is not an uncertainty interval of physical fires and it does not include the labelling error.

Calibration did not guarantee an improvement: in 2024–2025 the Brier before/after was 0.07587/0.07593 and the ten-bin ECE was 0.01483/0.02131. We did not switch to the uncalibrated variant after looking at this test. The applied transform is documented, but its percentages are not claimed to be reliable for every department.

## Spatial validation, lead times and errors

We trained a shadow model excluding the targets of Ayacucho, Huánuco, Lima, Piura and Ucayali from selection and calibration as well. Their local historical covariates remain available: it does not simulate regions with no history at all. The shadow model was selected separately, without using the labels of those departments.

In the five held-out departments, the Brier of the selected model was 0.07118 in 2024, 0.04791 in 2025 and 0.07579 in the 2026 confirmation. These are results of a shadow model, not of the model trained with all regions.

Metrics were computed per department and per lead time. To compare lead times, an evaluation with the same target weeks was added: the maturity filters leave different calendars per lead time and could make twelve weeks look better just because other seasons are evaluated.

Moquegua and Tacna are among the largest regional errors. A different model is not chosen retrospectively for each region, and those cases are not removed from the metrics.

Labels are frequent: 83.9 % of the training rows are positive. That is why we do not use accuracy as the main argument or present an average precision close to 1 as proof of detecting real fires. The capacity rule evaluates the five priority regions per issue/lead time, without claiming that this maximizes protected lives.

## Robustness and limits for deployment

In retrospective perturbations, removing all weather raised the Brier to 0.08054 against 0.07593 and changed the probability by about 3.1 percentage points on average. Altering the counts by ±30 % changed the result much less. These are synthetic diagnostics, not validation of the SP/NRT transfer.

Permutation importance in selection points mainly to region and seasonality. It is not causal evidence of why a fire starts.

Pending before publishing the new route:

1. Reproduce the same features at inference and generate the 300 region/lead-time combinations.
2. Check freshness, missing values and NRT differences from SP; NRT does not provide a confirmed type=0.
3. Set up input updates and an explicit output when there is no support.
4. Integrate and test the experimental endpoint, keeping its semantics, version and validation warnings.

Verification of physical ignition, human review of labels and prospective evaluation are still pending. Institutional use requires that evidence in addition to this demonstration.

## Where the evidence is

- [Executed training notebook](../notebooks/16_modelo_riesgo_regional.ipynb).
- [Protocol fixed before training](../reports/prediction/model/training_protocol_frozen.json).
- [Selection](../reports/prediction/model/selection_metrics.csv), [evaluation](../reports/prediction/model/evaluation_metrics.csv), [lead times](../reports/prediction/model/evaluation_by_lead.csv) and [regions](../reports/prediction/model/evaluation_by_region.csv).
- [Report and hashes](../reports/prediction/model/training_evaluation_report.json), [calibration](../reports/prediction/model/calibration_diagnostic.json) and [robustness](../reports/prediction/model/robustness_diagnostic.json).
- Code: [estimators](../pipeline/regional_risk_models.py), [training](../pipeline/train_regional_risk.py) and [diagnostics](../pipeline/analyze_regional_risk.py).

The file `model_freeze_before_test.json` intentionally keeps the state **before** opening the test. The later result is in `training_evaluation_report.json`; the hashes of the model and of the freeze file stay the same.

The trained local artifact is in `outputs/39_modelo_riesgo_regional/regional_risk_models.joblib`, outside the checkout. It does not need retraining to generate predictions; it needs the same features and versions. Predictions were checked to be equal after saving and reloading the model, with an absolute tolerance of `1e-12`.
