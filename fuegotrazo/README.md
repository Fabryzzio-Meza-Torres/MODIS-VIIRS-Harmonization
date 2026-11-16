# FuegoTrazo · datos reales

Visor web de la actividad térmica de MODIS y VIIRS en el Perú. Rehace la interfaz de
[FuegoTrazo](https://github.com/maritzajimenez-hub/FuegoTrazo) sobre dos APIs públicas
independientes. **Todo número, gráfico y capa del mapa proviene de ellas**; no hay datos simulados.

| API | Rutas que usa la web |
|---|---|
| Series y pronósticos<br>`modis-viirs-harmonization-production.up.railway.app` (`VITE_API_BASE`) | `/v1/regions`, `/v1/regions/geometry`, `/v1/empirical/metadata`, `/v1/empirical/series`, `/v1/validation`, `/v1/fire-risk/metadata`, `/v1/fire-risk/outlook`, `/v1/fire-risk` |
| Eventos históricos<br>`peru-fire-events-api-production.up.railway.app` | `/meta`, `/departments`, `/events`, `/events/{id}`, `/events/{id}/detections` |

No usa `/v1/series` (reservado), ni `/v1/forecasts` (producto anterior por celdas).

## Ejecutar

```bash
npm install
npm run dev      # desarrollo; /api/events usa el mismo handler que producción
npm test         # agregaciones, reglas del proxy, mapeo de departamentos, estado del pronóstico
npm run build
```

## Secciones

Panorama · Calendario · Mapa de calor (departamentos, provincias y ciudades, eventos) · Tendencias · Prevención · Pronóstico experimental · Generador de planes · Centros de apoyo · Informes · Laboratorio de armonización.

- **Indicador:** solo datos armonizados (promedio MODIS y VIIRS, MODIS, VIIRS). La comparación con las detecciones originales vive en el Laboratorio.
- **Mapa con drill-down (Panorama y Mapa de calor):** clic en un departamento → se acerca y se divide en sus provincias con sus capitales (las «ciudades»); clic en una provincia → su panel de datos. Las migas del mapa o Esc suben un nivel. El mapa se monta una sola vez y no se recrea al cambiar de territorio.
- **Datos por provincia (calculados en la web, API de eventos):** la API de series publica solo departamentos, así que **no hay actividad armonizada ni pronóstico por provincia**. Lo que se muestra son **eventos reales**: se descargan todos los del departamento para el periodo (1 000 por página, 4 en paralelo, tope de 20 páginas) y cada uno se asigna a la provincia que contiene su punto central. Por defecto, los últimos 90 días de la cobertura; máximo 366 días.
- **Generador de planes:** diagnóstico con datos reales (estacionalidad, variación, pronóstico) y acciones por fase como plantilla editable, guardada solo en tu navegador. Los responsables quedan en blanco.
- **Centros de apoyo:** cada canal lleva estado y fuente. Solo se listan datos leídos en la página oficial citada (ver `src/data/contacts.ts`); lo que no se pudo confirmar así no se publica. Un test exige que cada canal tenga fuente oficial.
- **Informes:** informe territorial imprimible (PDF desde el navegador) con CSV mensual.

## Rigor de los datos por provincia

- Cada evento cuenta en **una sola** provincia (ninguna en más de una; el solape de polígonos medido en una rejilla sobre el Perú es 0 de 42 473 puntos). Los que caen en ninguna se informan aparte (territorio vecino dentro del rectángulo, o bordes simplificados). **Conciliación visible:** eventos devueltos por la API = dentro de las provincias + fuera.
- **Descarga completa o mínimo:** solo con la descarga completa se muestran tasas, porcentajes, ranking y coropleta; si se alcanza el tope, el panel lo avisa y las cifras son un mínimo.
- Fechas UTC con «hasta» inclusivo; la serie temporal agrupa por la **fecha UTC de inicio** del evento y los que empezaron antes del periodo se cuentan aparte.
- «Por 1 000 km²» usa el **área geodésica del mismo polígono** (2016, simplificado), no un área oficial. Contrastada contra el atributo de la fuente: 195 provincias, todas dentro del 10 % y 185 dentro del 2 %.
- Verificado contra un cálculo independiente (otro lenguaje, otro algoritmo) para Cusco y Lima: conteos, conciliación, detecciones y FRP coinciden exactamente.

## Datos geográficos

Provincias y capitales: [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson) (MPL-2.0), límites de 2016 simplificados, en `public/geo/`. Pueden diferir de los límites vigentes y de los de las APIs. La fuente trae fragmentos de provincia con nombres mal escritos (`PUIRA`, `VICTOR FAFARDO`); se unen por identificador (`src/lib/geo.ts`).

## Proxy de eventos

La API de eventos no envía `Access-Control-Allow-Origin`, así que el navegador no puede consultarla
directamente. `netlify/functions/events.mts` sirve `/api/events/*` en el mismo dominio: upstream fijo,
solo GET, solo las rutas y parámetros de `src/lib/proxy-rules.ts`, rango máximo de 366 días,
`limit` ≤ 1000, timeout de 20 s y caché de 5 minutos. No acepta URLs arbitrarias.

## Qué es cada dato

- **Detecciones**: observaciones satelitales (píxeles con fuego).
- **Eventos**: agrupaciones de detecciones calculadas por la API de eventos; el tipo y la confianza son de ese procesamiento, no una confirmación oficial.
- **Conteos comparables estimados**: estimaciones estadísticas de la API de series; no son un número verificado de incendios. «Sin estimación» no es cero. Las bandas solo aparecen donde el servicio las entrega.
- **Pronóstico experimental**: probabilidad regional de al menos un nuevo episodio detectado en una semana concreta. No indica ubicación, extensión ni gravedad. Actualización manual.

## Fechas

Series: semanas UTC, fin exclusivo. Eventos: fechas UTC, fin inclusivo; un evento que empezó antes puede coincidir con el periodo. Pronóstico: semanas de lunes a domingo en America/Lima, fin exclusivo, solo las semanas que ofrece la emisión.

## Despliegue

Esta carpeta vive dentro del repositorio `MODIS-VIIRS-Harmonization` (rama `main`) y Netlify la despliega desde ahí:

- **Base directory:** `fuegotrazo`
- **Build command:** `npm run build` (el resto sale de `netlify.toml`)
- **Production branch:** `main`

`netlify.toml` incluye una regla `ignore` para que un cambio solo en la API, los datos o los cuadernos no recompile la web. La imagen de la API (`deploy/series.Dockerfile`) usa una lista de archivos permitidos, así que esta carpeta no entra en ella.

Despliegue manual (opcional): `npx netlify-cli deploy --prod --build` desde esta carpeta.
