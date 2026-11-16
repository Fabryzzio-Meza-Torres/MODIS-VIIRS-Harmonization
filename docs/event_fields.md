# Event fields

Each event returned by the API (`GET /events`, `/events/{id}`, `/events/near`,
`/events/nearest`) is a group of MODIS and VIIRS fire detections that lie ≤ 1.25 km and
≤ 5 days from one another. The method is summarized in the [README](../README.md#method-in-brief).

Example (a real event in Huánuco, late August 2024):

```json
{
  "event_id": 670783,
  "t_start": "2024-08-30T17:41:00+00:00",
  "t_end": "2024-09-06T17:59:00+00:00",
  "duration_days": 7.0125,
  "lat": -8.89004, "lon": -74.74085,
  "lat_min": -8.89879, "lat_max": -8.88218, "lon_min": -74.74414, "lon_max": -74.73621,
  "n_det": 15, "n_modis": 1, "n_viirs": 14,
  "passes_modis": 1, "passes_viirs": 10,
  "frp_total": 135.19, "frp_max": 23.27, "frp_modis": 14.2, "frp_viirs": 120.99,
  "satellites": "Aqua,NOAA20,NOAA21,SNPP",
  "department": "Huánuco",
  "spread_km": 0.709, "bearing_deg": 301.15,
  "may_split": true, "may_merge": true,
  "confidence": "alta",
  "event_type": "incendio",
  "active_days": 5, "foci_per_day": 1.0, "n_cells_1km": 3, "reburn_frac": 0.333,
  "hits": 5
}
```

## Identity and time

| Field | What it is | In the example |
|---|---|---|
| `event_id` | Event number. Assigned in order of start (1 = the first one in 2012), so it is stable as long as the data and parameters do not change. | event 670,783 |
| `t_start` | Time (UTC) of the event's first detection. | 30 Aug 2024 17:41 UTC (12:41 in Peru) |
| `t_end` | Time (UTC) of the last detection. | 6 Sep 2024 17:59 UTC |
| `duration_days` | `t_end − t_start` in days with decimals. A single-overpass event lasts 0. | 7.01 days |

All times are UTC, as in FIRMS. Peru is UTC−5.

## Location

| Field | What it is | In the example |
|---|---|---|
| `lat`, `lon` | Centre of the event: mean of the coordinates of all its detections (WGS84 degrees). The point to place it on a map. | −8.890, −74.741 |
| `lat_min`, `lat_max`, `lon_min`, `lon_max` | Box enclosing all detections. This is the box intersected with the region in `GET /events?bbox=…`. | box of ~1.8 × 0.9 km |
| `department` | Department with most of the event's detections (geoBoundaries boundaries). An event on a border may have points in two departments; this is the majority one. | Huánuco |

## Detections per sensor

A **detection** is a fire pixel in a satellite image (MODIS: ~1 km; VIIRS: ~375 m). An
**overpass** is one image: consecutive detections of the same satellite with no gap longer than
20 minutes.

| Field | What it is | In the example |
|---|---|---|
| `n_det` | Total detections (fire pixels) of the event. | 15 |
| `n_modis` | MODIS detections (Terra and Aqua). | 1 |
| `n_viirs` | VIIRS detections (Suomi NPP, NOAA-20, NOAA-21). | 14 |
| `passes_modis` | MODIS overpasses that saw the event. | 1 |
| `passes_viirs` | VIIRS overpasses that saw the event. | 10 |
| `satellites` | Satellites that detected it, comma-separated. | Aqua, NOAA-20, NOAA-21, Suomi NPP |

VIIRS usually has many more detections than MODIS on the same fire, because its pixel is
smaller and it sees smaller fires. That is why this challenge asks to harmonize them.

## Energy (FRP)

**FRP** (*Fire Radiative Power*) is the power radiated by the fire in the pixel, in megawatts
(MW). It is used as a measure of intensity.

| Field | What it is | In the example |
|---|---|---|
| `frp_total` | Sum of the FRP of all detections (MW). | 135.2 MW |
| `frp_max` | FRP of the most intense detection (MW). | 23.3 MW |
| `frp_modis` | Sum of the FRP of the MODIS detections. | 14.2 MW |
| `frp_viirs` | Sum of the FRP of the VIIRS detections. | 121.0 MW |

FRP sums are not harmonized across sensors: VIIRS adds up more because it has more detections,
not because the fire is stronger. Comparing MODIS with VIIRS needs the harmonization factor.

## Shape and movement

| Field | What it is | In the example |
|---|---|---|
| `spread_km` | How far the fire moved: distance between the centre of the detections of the first day and that of the last day (local solar day). 0 if it burnt a single day. | 0.71 km |
| `bearing_deg` | Direction of the movement, in degrees from north, clockwise (0 = N, 90 = E, 180 = S, 270 = W). Only meaningful if `spread_km` > 0. | 301° → towards the north-west |

## Burn pattern

| Field | What it is | In the example |
|---|---|---|
| `active_days` | Distinct days with at least one detection. If it is lower than `duration_days`, there were days with no fire seen (clouds, smoke or a pause). | 5 of 7 days |
| `foci_per_day` | Median, over the active days, of how many separate fronts (more than 1.25 km apart) burnt on the same day. 1 = a single front; ≥ 2 = several burns at once. Counted with Suomi NPP + MODIS only, so it does not grow when new satellites are added. | 1 front per day |
| `n_cells_1km` | How many 1 × 1 km cells the event touched. An approximate measure of the affected area in km². | 3 km² |
| `reburn_frac` | Share of those cells that had fire in two or more different weeks (burnt again). 0 = each cell burnt once; close to 1 = it keeps burning in the same place. | 1 of 3 cells |

## Classification

Stored values are in Spanish.

| Field | What it is | In the example |
|---|---|---|
| `event_type` | Event type according to the fields above (see the table below). | `incendio` (fire) |
| `confidence` | How sure it is a real fire. One point per condition: (1) seen by MODIS **and** VIIRS; (2) seen in 2 or more overpasses; (3) has 5 or more detections. 3 points = `alta` (high), 2 = `media` (medium), 0–1 = `baja` (low). | `alta` (meets all three) |
| `may_split` | `true` if the event would split into several with a stricter link radius (1.25 / 1.5 ≈ 0.83 km). It flags nearby burns that might be different fires. | yes |
| `may_merge` | `true` if the event would join another one with a wider radius (1.25 × 1.5 ≈ 1.9 km). It flags a close neighbour that might be the same fire. | yes |

`may_split` and `may_merge` are not errors: they mark the events whose boundary depends on the
distance parameter. If both are `false`, the event stays the same with any reasonable radius.

### Event types (`event_type`)

GlobFire (MODIS burned area) records no fire longer than 22 days in Peru. Events longer than
that are separated into three types.

| Type | Meaning | Rule | What it usually is |
|---|---|---|---|
| `foco_aislado` | isolated hotspot | Lasts less than 1 day and touches 1–2 cells of 1 km. | A small burn seen in a single overpass. |
| `incendio` | fire | Lasts up to 22 days and is not an isolated hotspot. | A normal fire or burn. |
| `incendio_prolongado` | long-lasting fire | Lasts more than 22 days, with a single front per day. | A fire that keeps burning and moving. |
| `quema_persistente` | persistent burning zone | Lasts more than 22 days, with 2 or more fronts per day. | Many burns in one area for weeks (land clearing, agricultural burning, e.g. west of Pucallpa). |
| `foco_recurrente` | recurrent hotspot | Lasts more than 22 days and touches 5 cells or fewer. | Always the same place: a dump, brick kiln, sugar mill or a plot burnt again and again. |

`GET /event-types` returns the types and how many events there are of each.

## Fields added by each query

They are not stored in the table: the API computes them for the query.

| Field | Appears in | What it is |
|---|---|---|
| `hits` | `/events?engine=index`, `/events/near` | How many detections of the event fall inside the requested region (or radius) **and** dates. In the example, 5 of the 15 detections are inside the query. |
| `distance_km` | `/events/nearest` | Space-time distance between the requested point and the event's nearest detection. Combines kilometres and days (1 day equals `km_per_day` km, see `GET /index`). |

## Detection fields (`GET /events/{id}/detections`)

| Field | What it is |
|---|---|
| `det_id` | Detection number. |
| `lat`, `lon` | Centre of the fire pixel. |
| `t_utc` | Time of the overpass (UTC). |
| `satellite`, `instrument` | Satellite (Terra, Aqua, SNPP, NOAA20, NOAA21) and instrument (MODIS, VIIRS). |
| `processing` | FIRMS product: always `SP` (standard). |
| `overpass` | Overpass it belongs to (satellite + number). Detections with the same value come from the same image. |
| `frp` | Radiative power of the pixel (MW). |
| `confidence` | FIRMS confidence for that pixel on a common scale: `nominal` or `high`. For MODIS, which gives it from 0 to 100, `nominal` is 30–79 and `high` is 80 or more. Low-confidence (`low`) detections were already discarded. |
| `daynight` | `D` day or `N` night. |
| `scan_km`, `track_km` | Real pixel size in km. It grows towards the edge of the image. |
