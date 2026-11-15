# Nuestra API MODIS–VIIRS Perú

Estado documentado: 15 de noviembre de 2026. API `0.4.0`.

El visor incorpora [evidencia histórica y registros oficiales](https://modis-viirs-harmonization-production.up.railway.app/visor/#validacion): catálogo de 15 140 referencias atribuidas a INDECI, con coincidencias y casos sin coincidencia, documentos y trazabilidad. Datos versionados en `/visor/validation-data/summary.json`; [metodología de esta sección](VALIDACION_WEB.md). Es un contraste histórico, no validación de igniciones físicas ni de la probabilidad futura.

Esta versión añade el pronóstico regional experimental: `GET /v1/fire-risk?region_id=08&target_week_start=2026-11-16`, `/v1/fire-risk/outlook` y `/v1/fire-risk/metadata`. Son 25 regiones por 12 semanas, con probabilidades de nuevos episodios detectados, sin ignición física verificada. Esta emisión vence el 22 de noviembre de 2026 a las 00:00 de Lima y aún requiere renovación manual. Uso, límites y Postman: [piloto de pronósticos](PILOTO_PRONOSTICOS.md).

## Qué hicimos

Publicamos una API de consulta para comparar la actividad térmica reportada por MODIS y VIIRS en Perú. Devuelve dos series semanales en una escala estadística común, con filtros por departamento, celda y fechas. También incluye un pronóstico experimental y un visor web.

**URL base:** https://modis-viirs-harmonization-production.up.railway.app

- [Documentación interactiva](https://modis-viirs-harmonization-production.up.railway.app/docs).
- [Visor regional](https://modis-viirs-harmonization-production.up.railway.app/visor/).
- Las consultas son `GET`, sin API key. CORS permite consumirlas desde una web externa.
- El servicio consulta resultados precalculados; no entrena modelos por petición.

**Alcance:** este dominio publica nuestra API de series. La API de eventos del compañero sigue siendo un servicio separado; todavía no está integrada detrás de esta URL.

## Datos disponibles

| Serie | Inicio | Último día incluido |
| --- | --- | --- |
| MODIS | 2000-11-06 | 2026-07-26 |
| VIIRS | 2012-02-06 | 2026-07-26 |

La unidad es una semana UTC, de lunes a domingo. Hay 13.405 celdas de 10 × 10 km que intersectan Perú y un catálogo de 25 departamentos/Callao. MODIS conserva 10 semanas nacionales sin estimación; antes del inicio de VIIRS sus valores son nulos.

## Rutas principales

Todas las rutas se agregan a la URL base.

| Ruta | Para qué sirve |
| --- | --- |
| `/health` | Estado del servicio y existencia del snapshot histórico |
| `/v1/empirical/metadata` | Método, periodo y limitaciones de los datos |
| `/v1/regions` | Códigos y nombres de departamentos |
| `/v1/regions/locate?latitude=-13.5319&longitude=-71.9675` | Departamento que contiene una coordenada |
| `/v1/regions/08/geometry` | Polígono de Cusco en GeoJSON |
| `/v1/empirical/series` | Series semanales de ambos instrumentos |
| `/v1/empirical/cells?region_id=08` | Celdas que intersectan Cusco |
| `/v1/forecasts?region_id=08` | Pronóstico experimental por celda |
| `/v1/validation` | Resultados y limitaciones de validación |

`/v1/series` está reservado para una futura serie con corrección completa de cobertura. Para los datos entregados se usa **`/v1/empirical/series`**.

## Ejemplo de consulta

Comparación de Cusco durante agosto de 2023:

```text
GET https://modis-viirs-harmonization-production.up.railway.app/v1/empirical/series?region_id=08&start=2023-08-01&end=2023-09-01
```

- `region_id`: código del departamento; `08` es Cusco. Sin filtro de lugar devuelve el total de Perú.
- `start`: fecha inicial incluida. `end`: fecha final excluida.
- `instrument=MODIS` o `instrument=VIIRS`: opcional; sin filtro devuelve ambos.
- `cell_id`: permite consultar una celda; no se combina con `region_id`.
- `week_selection=starts_within`: comportamiento predeterminado; selecciona semanas cuyo lunes está dentro del intervalo.
- `week_selection=overlap`: incluye semanas que se cruzan con el intervalo. Devuelve semanas completas, sin repartir sus conteos entre días.
- `limit` y `offset`: paginación, con máximo de 1.000 registros por petición. Continuar con `pagination.next_offset` hasta que sea `null`.

En Postman: seleccionar **GET**, pegar la URL y pulsar **Send**.

```javascript
const base = "https://modis-viirs-harmonization-production.up.railway.app";
const params = new URLSearchParams({
  region_id: "08",
  start: "2023-08-01",
  end: "2023-09-01"
});
const response = await fetch(`${base}/v1/empirical/series?${params}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const result = await response.json();
console.table(result.data);
```

## Cómo interpretar la respuesta

La respuesta contiene `metadata`, `data` y `pagination`.

| Campo de cada registro | Significado |
| --- | --- |
| `week_start_utc` | Lunes de la semana |
| `instrument` / `platform` | Instrumento y plataforma seleccionada |
| `raw_count` | Número original de detecciones de esa plataforma |
| `harmonized_count` | Conteo ajustado a la escala común |
| `lower_bound` / `upper_bound` | Banda del 95 % de incertidumbre del factor de calibración |
| `coverage_status` | Actualmente `unknown`: no se certifica cobertura completa |
| `estimation_status` | `estimated` si hay estimación; `unavailable` si falta |

Un valor nulo no significa cero incendios. Un conteo ajustado tampoco es un número de incendios independientes. La versión del método y el identificador del snapshot están en los metadatos.

`record_probability`, en `/v1/forecasts`, es una probabilidad experimental de registro satelital para la semana **16–22 de noviembre de 2026**. No es una probabilidad operativa de ignición ni un pronóstico actualizado diariamente.

## Implementación, despliegue y pruebas

- **FastAPI + SQLite:** snapshot de consulta de solo lectura, publicado comprimido en `data/history.sqlite.gz`.
- **Geografía:** R*Tree obtiene candidatos y después se comprueba el polígono exacto. Índices B-tree aceleran consultas por región, instrumento y fecha.
- **Conteos regionales:** se asignan por la ubicación original de cada detección, no por el centro de una celda fronteriza. Las consultas de celdas usan intersección de área; los filtros `bbox` de celdas usan sus centros.
- **Railway + Docker:** el build restaura el snapshot, verifica SHA-256 e integridad SQLite y permite su lectura al usuario no root. Una comprobación durante el build consulta los datos con ese usuario.
- **Verificación:** 34 pruebas de API aprobadas en la preparación del despliegue y comprobación externa del dominio: snapshot, CORS, regiones, coordenadas, valores regionales, pronóstico y ausencia de reconstrucción administrativa pública.

`/health` comprueba existencia de archivos, no toda la integridad de las consultas. Puede mostrar `database_available=false` porque falta la base antigua `firms.sqlite`, mientras `historical_snapshot_available=true` identifica el snapshot actual. La comprobación externa sí consulta resultados de datos.

Archivos útiles: [código de la API](../api/api.py), [consultas históricas](../api/history_api.py), [Postman](../api/POSTMAN_REGIONES.postman_collection.json), [cliente JavaScript](../api/cliente.js), [Dockerfile](../deploy/series.Dockerfile) y [verificador público](../deploy/verify_public.py).

Para ejecutar localmente, desde la raíz del repositorio:

```bash
python -m pip install -r api/requirements.txt
python api/restaurar_snapshot.py
python api/serve.py
```

La API local queda en `http://localhost:8000/docs`. Para verificar el despliegue real:

```bash
python deploy/verify_public.py https://modis-viirs-harmonization-production.up.railway.app
```

La integración con eventos y el nuevo modelo con meteorología y NRT son trabajo pendiente. La metodología de la versión entregada está en [METODOLOGIA.md](METODOLOGIA.md).
