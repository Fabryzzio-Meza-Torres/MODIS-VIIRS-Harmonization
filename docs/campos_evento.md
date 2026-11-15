# Campos de un evento

Cada evento que devuelve la API (`GET /events`, `/events/{id}`, `/events/near`,
`/events/nearest`) es un grupo de detecciones de fuego de MODIS y VIIRS que caen a ≤ 1,25 km y
≤ 5 días unas de otras. El método está resumido en el [README](../README.md#método-en-breve).

Ejemplo (evento real de Huánuco, fin de agosto de 2024):

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

## Identidad y tiempo

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `event_id` | Número del evento. Se asigna en orden de inicio (1 = el primero de 2012), así que es estable mientras no cambien los datos ni los parámetros. | evento 670 783 |
| `t_start` | Hora (UTC) de la primera detección del evento. | 30-ago-2024 17:41 UTC (12:41 en Perú) |
| `t_end` | Hora (UTC) de la última detección. | 6-sep-2024 17:59 UTC |
| `duration_days` | `t_end − t_start` en días con decimales. Un evento de una sola pasada dura 0. | 7,01 días |

Todas las horas están en UTC, como en FIRMS. Perú es UTC−5.

## Ubicación

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `lat`, `lon` | Centro del evento: promedio de las coordenadas de todas sus detecciones (grados WGS84). Es el punto para ponerlo en un mapa. | −8,890, −74,741 |
| `lat_min`, `lat_max`, `lon_min`, `lon_max` | Caja que encierra todas las detecciones. Es la caja que se cruza con la región en `GET /events?bbox=…`. | caja de ~1,8 × 0,9 km |
| `department` | Departamento con más detecciones del evento (límites geoBoundaries). Un evento en el borde puede tener puntos en dos departamentos; aquí va el mayoritario. | Huánuco |

## Detecciones por sensor

Una **detección** es un píxel con fuego en una imagen de satélite (MODIS: ~1 km; VIIRS:
~375 m). Una **pasada** es una imagen: las detecciones seguidas del mismo satélite sin huecos
de más de 20 minutos.

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `n_det` | Total de detecciones (píxeles con fuego) del evento. | 15 |
| `n_modis` | Detecciones de MODIS (Terra y Aqua). | 1 |
| `n_viirs` | Detecciones de VIIRS (Suomi NPP, NOAA-20, NOAA-21). | 14 |
| `passes_modis` | Pasadas de MODIS que vieron el evento. | 1 |
| `passes_viirs` | Pasadas de VIIRS que vieron el evento. | 10 |
| `satellites` | Satélites que lo detectaron, separados por comas. | Aqua, NOAA-20, NOAA-21, Suomi NPP |

VIIRS suele tener muchas más detecciones que MODIS en el mismo fuego, porque su píxel es más
chico y ve fuegos más pequeños. Por eso este reto pide armonizarlos.

## Energía (FRP)

**FRP** (*Fire Radiative Power*) es la potencia que irradia el fuego en el píxel, en
megavatios (MW). Sirve como medida de intensidad.

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `frp_total` | Suma del FRP de todas las detecciones (MW). | 135,2 MW |
| `frp_max` | FRP de la detección más intensa (MW). | 23,3 MW |
| `frp_modis` | Suma del FRP de las detecciones MODIS. | 14,2 MW |
| `frp_viirs` | Suma del FRP de las detecciones VIIRS. | 121,0 MW |

Las sumas de FRP no están armonizadas entre sensores: VIIRS suma más porque tiene más
detecciones, no porque el fuego sea más fuerte. Para comparar MODIS con VIIRS hay que usar el
factor de armonización.

## Forma y movimiento

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `spread_km` | Cuánto se desplazó el fuego: distancia entre el centro de las detecciones del primer día y el del último día (día solar local). 0 si quemó un solo día. | 0,71 km |
| `bearing_deg` | Hacia dónde se desplazó, en grados desde el norte en sentido horario (0 = N, 90 = E, 180 = S, 270 = O). Solo tiene sentido si `spread_km` > 0. | 301° → hacia el noroeste |

## Patrón de quema

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `active_days` | Días distintos con al menos una detección. Si es menor que `duration_days`, hubo días sin fuego visto (nubes, humo o pausa). | 5 de 7 días |
| `foci_per_day` | Mediana, sobre los días activos, de cuántos focos separados (a más de 1,25 km entre sí) hubo el mismo día. 1 = un solo frente; ≥ 2 = varias quemas a la vez. Se cuenta solo con Suomi NPP + MODIS, para que no suba cuando se suman satélites nuevos. | 1 foco por día |
| `n_cells_1km` | Cuántas celdas de 1 × 1 km tocó el evento. Es una medida aproximada del área afectada en km². | 3 km² |
| `reburn_frac` | Fracción de esas celdas que tuvieron fuego en dos o más semanas distintas (volvieron a quemar). 0 = cada celda quemó una sola vez; cerca de 1 = se quema siempre en el mismo sitio. | 1 de 3 celdas |

## Clasificación

| Campo | Qué es | En el ejemplo |
|---|---|---|
| `event_type` | Tipo de evento según los campos anteriores (ver tabla abajo). | incendio |
| `confidence` | Qué tan seguro es que sea un fuego real. Suma un punto por cada condición: (1) lo vieron MODIS **y** VIIRS; (2) lo vieron 2 o más pasadas; (3) tiene 5 o más detecciones. 3 puntos = `alta`, 2 = `media`, 0–1 = `baja`. | alta (cumple las tres) |
| `may_split` | `true` si el evento se partiría en varios con un radio de unión más estricto (1,25 / 1,5 ≈ 0,83 km). Indica que son quemas cercanas que podrían ser fuegos distintos. | sí |
| `may_merge` | `true` si el evento se uniría a otro con un radio más amplio (1,25 × 1,5 ≈ 1,9 km). Indica que tiene un vecino cercano que podría ser el mismo fuego. | sí |

`may_split` y `may_merge` no son errores: marcan los eventos cuyo límite depende del parámetro
de distancia. Si ambos son `false`, el evento es el mismo con cualquier radio razonable.

### Tipos de evento (`event_type`)

GlobFire (área quemada MODIS) no registra en Perú ningún fuego de más de 22 días. Los eventos
más largos que eso se separan en tres tipos.

| Tipo | Regla | Qué suele ser |
|---|---|---|
| `foco_aislado` | Dura menos de 1 día y toca 1–2 celdas de 1 km. | Una quema pequeña vista en una sola pasada. |
| `incendio` | Dura hasta 22 días y no es foco aislado. | Un incendio o quema normal. |
| `incendio_prolongado` | Dura más de 22 días, con un solo foco por día. | Un fuego que sigue activo y se mueve. |
| `quema_persistente` | Dura más de 22 días, con 2 o más focos por día. | Muchas quemas en una zona durante semanas (desmonte, quema agrícola, p. ej. al oeste de Pucallpa). |
| `foco_recurrente` | Dura más de 22 días y toca 5 celdas o menos. | Siempre el mismo sitio: botadero, ladrillera, ingenio o una parcela que se quema repetidas veces. |

`GET /event-types` devuelve los tipos y cuántos eventos hay de cada uno.

## Campos que agrega cada consulta

No se guardan en la tabla: los calcula la API según la consulta.

| Campo | Aparece en | Qué es |
|---|---|---|
| `hits` | `/events?engine=index`, `/events/near` | Cuántas detecciones del evento caen dentro de la región (o del radio) **y** de las fechas pedidas. En el ejemplo, 5 de las 15 detecciones están dentro de la consulta. |
| `distance_km` | `/events/nearest` | Distancia espacio-tiempo entre el punto pedido y la detección más cercana del evento. Combina kilómetros y días (1 día equivale a `km_per_day` km, ver `GET /index`). |

## Campos de una detección (`GET /events/{id}/detections`)

| Campo | Qué es |
|---|---|
| `det_id` | Número de la detección. |
| `lat`, `lon` | Centro del píxel con fuego. |
| `t_utc` | Hora de la pasada (UTC). |
| `satellite`, `instrument` | Satélite (Terra, Aqua, SNPP, NOAA20, NOAA21) e instrumento (MODIS, VIIRS). |
| `processing` | Producto de FIRMS: siempre `SP` (estándar). |
| `overpass` | Pasada a la que pertenece (satélite + número). Las detecciones con el mismo valor salieron de la misma imagen. |
| `frp` | Potencia radiativa del píxel (MW). |
| `confidence` | Confianza de FIRMS para ese píxel en una escala común: `nominal` o `high`. En MODIS, que la da de 0 a 100, `nominal` es 30–79 y `high` es 80 o más. Las de confianza baja (`low`) ya se descartaron. |
| `daynight` | `D` día o `N` noche. |
| `scan_km`, `track_km` | Tamaño real del píxel en km. Crece hacia el borde de la imagen. |
