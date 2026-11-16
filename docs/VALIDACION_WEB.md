# Historical evidence on the website

Section integrated into `web/index.html`, anchor `#validacion`. It reuses the Inter typeface, the palette, the controls and the rhythm of the existing viewer. It does not modify the model, the harmonization or the teammate's API.

Published at [Evidence and comparison with official records](https://modis-viirs-harmonization-production.up.railway.app/visor/#validacion). Public verification of the 13 partitions and the two documents, with UTC time and catalog fingerprint: `reports/validation_web/public_HTTP_verification.json`. Independent interface review: **ship**, with the two initial findings resolved, in `reports/validation_web/finish_review.md`.

## What is published

The catalog contains **the 15,140 references attributed to INDECI** that are eligible for the comparison from 2013-01-07 to 2025-12-31, keeping their 22,473 reported locations. Favourable examples were not cherry-picked:

| Result under the main criterion | References |
| --- | ---: |
| Match with both instruments | 2,638 |
| MODIS only | 336 |
| VIIRS only | 4,192 |
| No match | 7,974 |
| Total | 15,140 |

A reference is not necessarily an independent physical fire. The catalog groups points with the same code/origin and keeps the official dates and IDs; references without a code use the place/date key of the earlier analysis. Ambiguous codes whose time range exceeded 30 days were excluded.

Per instrument, the results already published are reproduced exactly: **2,974 MODIS** and **6,830 VIIRS**. They overlap; they are not added to count fires. The denominator of these results is the catalog of eligible references, not a complete and verified inventory of fires in Peru.

## Rule reproduced

The predefined window of **5 km and ±3 full days of the local Peru calendar** is kept, with LAEA distance centred on Peru. Dates without a time are treated as full days; no invented ignition time is assigned to them. The detail also shows the WGS84 geodesic distance, without changing the original criterion after inspecting the results.

The same FIRMS SP `type=0` records and the same platform per instrument/week as in the published empirical series are selected. 1,097,502 selected observations were rebuilt: 155,836 MODIS and 941,666 VIIRS. For each reference and instrument, the nearest witness that meets the rule among its reported locations and dates is shown, with platform, timestamp, coordinates and the `source_row` of the original file.

The predefined sensitivities of 10 km/±3 days and 25 km/±7 days, the ±28-day shifted-date controls and the associations by origin are also shown. MINAM and ORORATECH stay separate from INDECI: their independence from satellite data has not been demonstrated. The controls are not presented as periods proven to be free of fire either.

## Source traceability

Official source: [MINAM, Historical fire record 2000–2025](https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1).

The original snapshot has 54,493 rows, UTC download 2026-11-15T03:44:33, SHA-256 `77e4df26fe8e6f6e3c37cac1d2893f9c93fe4a2a8b32ccd4567a0b38bea6a3ae`. The download checked that the official IDs were preserved exactly. The catalog derives from the previously audited file, without replacing it with data obtained later to improve results.

While preparing this section, a deterministic sample of **13 rows, one per year**, was checked again against the official service. Origin, department, textual date and geometry match. This sample check is not presented as a new live validation of every row. Each case links its official IDs, so the source record can be inspected.

Exact identity with the Open Data portal resource provided earlier is not claimed: that portal returned 403 on the initial download. The source used and verifiable is explicitly this official MINAM layer.

## Documentary case and statistical evaluation

The COEN–INDECI case no. 2027 of Dos de Mayo, Curimaná, in 2019 is included. Copies of the official INDECI and ANA PDFs are kept with their original hashes. The locality reference comes from riverbank vertices next to the village, not from a point of the fire. The seven Suomi-NPP candidates within 2 km during the reported interval are compatible with the surroundings and the timing; the fire is not causally attributed to them and no MODIS omission is inferred.

The descriptive weekly correlations and the model's Brier scores against climatology are published separately. A correlation does not validate the harmonization factors; the error of the detected-episode model does not prove that the physical ignition percentage is validated either.

## Publication and operation

Versioned data in `web/validation-data/summary.json` and `cases-YYYY.json`. The browser downloads only the selected year, usually as gzip, checks SHA-256 on the decompressed bytes and renders 12 references per page. The uncompressed JSON copies allow downloading and auditing the records. All the compressed partitions add up to about 1.1 MB.

The filters allow year, department, result and code/ID. Loading or integrity errors are shown without fake data. Earlier requests are cancelled when the year changes. The section is independent of the filter results of the main chart; the header metrics cover the full period and the catalog filters only affect the visible examples.

The same JSON can be consumed from another website, through its backend if the hosting's CORS rules require it. There is no need to download bulk data from the events API to show this evidence.

Local regeneration, keeping the audited artifacts outside Git:

```powershell
python pipeline/build_validation_catalog.py --artifacts ../../outputs
python -m unittest discover -s pipeline -p test_validation_catalog.py -v
python pipeline/qa_validation_web.py --output ../../outputs/41_validacion_web/qa
```

Generation requires the scientific environment's dependencies; the browser QA requires Playwright and Chromium/Chrome. The web service does not need those dependencies. `build_validation_catalog.py` checks the sample against the official service again and fails if it does not match; it does not silently replace the data.
