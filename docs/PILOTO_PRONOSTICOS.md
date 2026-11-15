# Piloto regional: qué entregamos y cómo probarlo

Estado: **90 % de la versión experimental**, preparado localmente para revisión. No se ha publicado esta ruta en Railway ni se ha configurado actualización automática.

## Qué significa el porcentaje

Probabilidad experimental de **al menos un nuevo episodio de fuego detectado por NOAA-20 en todo un departamento durante una semana**. No es porcentaje de superficie que se quemará, gravedad, pérdidas humanas ni probabilidad validada de ignición física. Puede incluir quemas y detecciones tardías. Las etiquetas se reconstruyeron causalmente con una regla espacial de 1.25 km y 5 días, no con agregados futuros del compañero.

El modelo ganador es LightGBM, seleccionado antes de abrir la evaluación final. Se compararon climatología, regresión logística y variantes de LightGBM. La variante ganadora excluye el contexto anual armonizado: añadirlo no mejoró la selección. Las series armonizadas siguen siendo un producto histórico separado. No se presenta como un modelo que obligatoriamente usa esas series.

La calibración por plazo se ajustó en 2023. El modelo empata con climatología en 2024 y mejora en 2025 y 2026; la calibración no mejoró la prueba conjunta. Véase `RESULTADOS_MODELO_EXPERIMENTAL.md` para métricas y límites. No se inventaron intervalos de confianza individuales.

## Emisión disponible

* Emisión real: **15 de noviembre de 2026, 15:39:33 de Lima**.
* Referencia de variables: domingo 15 de noviembre, 00:00 de Lima. No se retrodató la emisión.
* 25 departamentos × 12 semanas = **300 resultados**.
* Primera semana: **16–22 de noviembre de 2026**.
* Última semana: **1–7 de febrero de 2027**; fin exclusivo: 8 de febrero.
* Vence para consultas vigentes: **22 de noviembre de 2026, 00:00 de Lima**. Un GET posterior devuelve 503 hasta renovar la emisión; metadata sigue disponible.

Ejemplos para la primera semana: Cusco **97.67 %**, Callao **11.07 %**, Tacna **45.83 %**. Los porcentajes altos reflejan que basta un episodio en cualquier lugar del departamento: aproximadamente 84 % de las filas de entrenamiento eran positivas. Cada plazo corresponde a una semana concreta, no al riesgo acumulado de 12 semanas.

## Insumos y verificaciones

NOAA-20 NRT: última adquisición 13 de noviembre, 18:47 UTC. Para las variables se usaron registros anteriores al 12 de noviembre, 05:00 UTC, con ventana de hasta 90 días. El archivo NRT no confirma tipo de fuego; no se le asignó artificialmente `type=0`. La transferencia SP→NRT no está validada con resultados futuros.

NASA POWER: un punto interior por departamento, no promedio territorial. Último día meteorológico utilizado: 7 de noviembre, con disponibilidad simulada conservadora. No se usó tiempo futuro realizado ni se inventaron pronósticos meteorológicos diarios a 12 semanas. El modelo depende principalmente de región y estación.

El extractor de inferencia reproduce las **115 350 filas** históricas con tolerancia absoluta 1e-12 y mismo patrón de faltantes. Cinco pruebas comprueban causabilidad del corte, datos viejos, variables ausentes y calendarios inválidos. La API pasó 43 pruebas, incluidas integridad, fechas, porcentajes, caducidad y regresiones del histórico.

## API local y Postman

Desde la raíz del repositorio, con el entorno de API activado:

```powershell
python -m pip install -r api/requirements.txt
python -m uvicorn api:app --app-dir api --host 127.0.0.1 --port 8010
```

En Postman importa `api/POSTMAN_FIRE_RISK.postman_collection.json`. Su variable `base_url` apunta a `http://127.0.0.1:8010`. La URL pública existente solo podrá usarse para estas rutas después de aprobar y desplegar esta versión.

```http
GET /v1/fire-risk/metadata
GET /v1/fire-risk?region_id=08&target_week_start=2026-11-16
GET /v1/fire-risk/outlook?region_id=08
GET /v1/fire-risk/outlook?limit=300
```

La consulta requiere el lunes de la semana. No devuelve pronósticos para cualquier fecha arbitraria fuera de las 12 semanas publicadas. Región inexistente o semana fuera de la emisión: 404. Fecha que no es lunes: 422. Snapshot ausente, corrupto, no emitido o vencido: 503. Un registro sin soporte conserva `probability: null` con la razón; nunca se convierte en cero.

Campos principales: `region_id`, `region_name`, `issued_at`, `target_week_start`, `target_week_end_exclusive`, `lead_weeks`, `probability`, `probability_percent`, `estimation_status`, `quality_status`, `unavailable_reasons` y `features_outside_region_training_range`. Los avisos de rango no son intervalos de confianza.

La metadata identifica versión, hashes, fechas de insumos y vigencia. `target_period_status` distingue semana futura y semana ya iniciada. La API sirve un snapshot precalculado, sin reentrenar por petición ni modificar el porcentaje al consultar.

Cliente reutilizable en `web/fire-risk-client.js`:

```javascript
import {createFireRiskClient} from './fire-risk-client.js';
const risk = createFireRiskClient('http://127.0.0.1:8010');
const result = await risk.week('08', '2026-11-16');
console.log(result.data[0].probability_percent);
```

Si la consulta falla, mostrar “pronóstico no disponible” y la razón. No reutilizar silenciosamente un porcentaje vencido. Las 12 semanas disponibles se consultan en metadata, para que el calendario web limite sus opciones.

## Reproducir sin reentrenar

El snapshot API y su manifest están en `data/regional_outlook*.json`. El servicio solo necesita dependencias de API. El modelo entrenado y datos grandes permanecen en los directorios locales `outputs/`, fuera de Git; para regenerar emisiones se necesitan esos artefactos y renovar NRT/meteorología. Los scripts de generación aceptan rutas explícitas; `python pipeline/generate_regional_outlook.py --help` lista sus argumentos.

Una nueva emisión se valida, se empaqueta con `pipeline/package_regional_outlook.py` y se despliega. Empaquetar no valida ni actualiza los datos científicos. No se dejó un cron que sirva indefinidamente los porcentajes de esta emisión.

Notebook ejecutado de revisión: `notebooks/17_piloto_pronosticos_regionales.ipynb`. Evidencias y respuesta local de ejemplo: `reports/prediction/pilot/`.

El contenedor final se construyó y verificó como usuario sin privilegios. Once comprobaciones HTTP sobre `http://127.0.0.1:8010` pasaron, incluyendo histórico, ubicación, CORS y las rutas nuevas. En este equipo está corriendo el contenedor local `modis-viirs-risk-review-20261115`; Swagger está en `/docs`. Para detener solamente ese visor de revisión: `docker stop modis-viirs-risk-review-20261115`. No usar ese comando si se quiere continuar probando en Postman.

Pendiente de esta revisión: autorizar la publicación experimental en el dominio actual. La API pública del compañero sigue siendo independiente; su respaldo se empleó para contraste, no se declara fusionado por compartir este proyecto.
