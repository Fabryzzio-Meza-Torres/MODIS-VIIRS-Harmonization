# Methodology: research, preparation and validation

Documented state: 15 November 2026. Published method: `empirical-positive-pair-v1.1`.

## 1. What problem we solve

MODIS and VIIRS have different resolution and detection response. Comparing their point counts directly can mistake a change of instrument for a change in fire activity.

We build **two series of reported detections adjusted to a common scale**, per week and zone of Peru. Harmonizing does not mean forcing them to match, nor turning points into independent fires.

## 2. How we researched

The work moved forward in reviewable steps: explore the originals, document limitations, test a baseline, define the common estimand, validate and publish reproducible artifacts.

- We consulted products and documentation from [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/content/active_fire/) to tell apart platforms, standard scientific processing (SP), NRT and quality variables.
- We explored dates, coordinates, counts, confidence and differences between sensors. We compared 5, 10 and 25 km aggregations before adopting the 10 km grid.
- We tested a national baseline that converts VIIRS to Aqua units with global or monthly factors. It is kept as a reference; it is not the current method.
- We reviewed official reports and news about incidents to look for spatial and temporal matches. A news report gives context, but on its own it does not prove which detection corresponds to a fire.
- We studied detection limits and FRP in the [GMD article](https://gmd.copernicus.org/articles/19/10123/2026/). Its operator was implemented as independent research and **is not applied in the API**. Discrepancies between tables and text, and one assumption still to be confirmed, were documented.

The notebooks keep executed results; the scripts, metadata and hashes make it possible to trace the inputs.

## 3. Data and cleaning

We started from four FIRMS ZIP files: MODIS C6.1 and VIIRS C2 from Suomi-NPP, NOAA-20 and NOAA-21. MODIS includes Terra and Aqua, so there are five platforms in total.

We normalized UTC dates, coordinates and platform names. We kept provenance and quality checks, filtered SP products and `type=0`, clipped to the boundary of Peru and used complete weeks.

We did not apply the same confidence threshold to both instruments, because their scales are different. NRT data are not mixed automatically with SP data; our published series does not include NRT.

Preparation retained **2,228,157 detections**, aggregated into **855,553 positive cell–week–platform groups**.

## 4. Spatial and temporal organization

- Boundary of Peru: union of the official MINAM departments, with generalized geometries. The assignment of points close to borders depends on that geometric detail.
- Grid: **13,405 cells of 10 × 10 km**, in an equal-area LAEA projection centred on Peru.
- Time: UTC weeks from Monday to Sunday. A cell–week is a specific square during a specific week.
- History: MODIS from **2000-11-06** and VIIRS from **2012-02-06**, up to **2026-07-26**, respecting the complete-week cut-off.

**One platform per instrument and week is selected for the whole country.** Aqua and Suomi-NPP are preferred; documented bridges are used when the main platform is missing at national scale. Not all satellites are added together, and local gaps are not selectively filled with other platforms.

The main series keeps 1,322,019 original detections from the selected platforms and 513,756 positive cell–week–instrument rows. The national calendar has 10 MODIS weeks without an estimate. Missing values stay null.

## 5. Harmonization model

The statistical idea is:

```text
expected count = shared activity × relative response of the platform
comparable count = reported count / estimated response
```

The response is empirical: it can also absorb differences in observation opportunities, because we do not yet correct the full historical coverage.

We assume Poisson counts for two platforms observing the same cell–week. Conditioning on the sum of their counts gives a binomial distribution that removes the shared activity as an unknown parameter.

Because we work with pairs where both platforms recorded detections, the likelihood is also conditioned on both counts being positive. `1 + 1` pairs carry no information about their ratio and are excluded.

To fix the scale, the geometric mean of the Aqua and Suomi-NPP responses is set to 1. Neither is considered the absolute truth. **It is a conditional maximum-likelihood calibration, not a regression that takes MODIS as the truth.**

Approximate multiplicative factors of the selected model:

| Platform | Factor applied to the count |
| --- | --- |
| Aqua | 1.993784 |
| Suomi-NPP | 0.501559 |
| Terra | 4.311475 |
| NOAA-20 | 0.512807 |
| NOAA-21 | 0.520861 |

For example, 7 Aqua detections are equivalent to about 13.956 comparable units. The decimals are statistical units, not fractions of a fire.

## 6. How we validated

### Temporal and spatial evaluation

We compared global, seasonal and regional-seasonal candidates. Internal selection uses 2019–2021 and requires at least a 1 % improvement to add complexity; the global model was kept.

The fit of the established platforms uses data up to 2021 and holds out 200 km spatial blocks. NOAA-21 is calibrated through a March–June 2023 bridge, keeping the earlier factors frozen. The final 2024–2025 test was evaluated after the model was fixed.

Example MAE on positive pairs, without adjustment versus calibrated:

| Evaluation | No adjustment | Calibrated |
| --- | --- | --- |
| 2024, seen zones | 1.833 | 1.099 |
| 2024, held-out zones | 2.454 | 1.261 |
| 2025, seen zones | 1.253 | 0.971 |
| 2025, held-out zones | 1.328 | 0.993 |

It measures the error in splitting the observed total between platforms, **not the error against the real number of fires**. The years 2024–2025 have already been examined: they must not be presented as a still-untouched test for future models.

### Uncertainty and reproducibility

We computed 95 % bands with 100 Bayesian bootstrap replicates using 28-day blocks. The correlation between factors is preserved when aggregating results.

Revision v1.1 fixed a time-unit error in the bootstrap; the earlier bands were withdrawn. The central parameters and the forecast variables stayed the same within a `1e-12` tolerance. The current bands only represent calibration uncertainty, not all the uncertainty of fire or coverage.

### Geographic and integrity validation

We checked point-to-cell assignments and border cases. For regional queries we use an R*Tree as a candidate search plus exact containment in the polygon. Counts are assigned with the original coordinates; a tie between departments is resolved once by official code.

The regional sum preserves the national counts per week and instrument: **1,322,019 detections in total**. The pipeline rejects regional assets from an incompatible snapshot. The published files include hashes, and the SQLite restore checks integrity.

### Comparison with external references

We downloaded 54,493 records from the [official MINAM geographic service](https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1); 44,374 eligible references for 2013–2025 remained after auditing dates, coordinates, duplicates and provenance.

The main window was 5 km and ±3 calendar days. We evaluated other windows and date shifts of ±28 days as controls. For references originating from INDECI, matches were 19.64 % for MODIS and 45.11 % for VIIRS.

This shows association, not a detection rate of all fires. Whether the references are independent from satellite imagery is still to be checked. The requested portal answered 403: the accessible official layer was used, without claiming it is exactly the same file. A correlation does not validate our factors either: multiplying by a positive constant does not change Pearson or Spearman.

## 7. Existing forecast and next stage

The delivery contains an **experimental HistGradientBoostingClassifier** for satellite records during 16–22 November 2026. It uses geography, seasonality and the history of previous years; no weather data and no recent NRT. It was trained on 2013–2021, calibrated on 2022, selected on 2023 and evaluated on 2024–2025. It does not always beat climatology.

The later plan with LightGBM, weather data, NRT and prioritization of population and protected areas **is not implemented yet**. It requires defining the labels, avoiding future information, calibrating probabilities and evaluating prospectively before calling it an operational fire risk.

## 8. Evidence to review

- [Simple EDA](../notebooks/00_simple_EDA_MODIS_VIIRS.ipynb) and [sensor diagnostics](../notebooks/03_sensor_diagnostics.ipynb).
- [Earlier baseline](../notebooks/07_harmonization_baseline.ipynb) and [current comparable series](../notebooks/09_comparable_time_series.ipynb).
- [Experimental forecast](../notebooks/10_experimental_forecast.ipynb), [detection limits](../notebooks/11_detection_limits.ipynb) and [MINAM comparison](../validation/12_MINAM_registry_comparison.ipynb).
- [Series metadata](../data/series_metadata.json), [calibration results](../reports/empirical/), [regional validation](../reports/regional_query/verification.json) and [reproduction guide](../pipeline/REPRODUCE.txt).
- [Documentation of our API](API.md).

**Main limitation:** we deliver an empirical harmonization of reported counts. The physical correction of the full historical coverage, undetected fires and the integration of events are still pending.
