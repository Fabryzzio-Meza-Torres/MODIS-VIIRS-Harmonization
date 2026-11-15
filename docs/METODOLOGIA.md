# Metodología: investigación, preparación y validación

Estado documentado: 15 de noviembre de 2026. Método publicado: `empirical-positive-pair-v1.1`.

## 1. Qué problema resolvemos

MODIS y VIIRS tienen distinta resolución y respuesta de detección. Comparar directamente sus cantidades de puntos puede confundir un cambio de instrumento con un cambio de actividad de fuego.

Construimos **dos series de detecciones reportadas ajustadas a una escala común**, por semana y zona de Perú. Armonizar no significa obligar a que coincidan ni convertir puntos en incendios independientes.

## 2. Cómo investigamos

El trabajo avanzó mediante pasos revisables: explorar los originales, documentar limitaciones, probar un baseline, definir el estimando común, validar y publicar artefactos reproducibles.

- Consultamos productos y documentación de [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/content/active_fire/) para distinguir plataformas, procesamiento científico estándar (SP), NRT y variables de calidad.
- Exploramos fechas, coordenadas, conteos, confianza y diferencias entre sensores. Comparamos agregaciones de 5, 10 y 25 km antes de adoptar la malla de 10 km.
- Probamos un baseline nacional que convierte VIIRS a unidades Aqua con factores globales o mensuales. Se conserva como referencia; no es el método actual.
- Revisamos reportes oficiales y noticias sobre incidentes para buscar correspondencias espaciales y temporales. Un reporte periodístico aporta contexto, pero no demuestra por sí solo qué detección corresponde a un incendio.
- Investigamos límites de detección y FRP en el [artículo de GMD](https://gmd.copernicus.org/articles/19/10123/2026/). Su operador se implementó como investigación independiente y **no está aplicado en la API**. Quedaron documentadas discrepancias entre tablas/texto y un supuesto pendiente de confirmar.

Los notebooks conservan resultados ejecutados; los scripts, metadatos y hashes permiten rastrear los insumos.

## 3. Datos y limpieza

Partimos de cuatro ZIP FIRMS: MODIS C6.1 y VIIRS C2 de Suomi-NPP, NOAA-20 y NOAA-21. MODIS incluye Terra y Aqua: son cinco plataformas en total.

Normalizamos fechas UTC, coordenadas y nombres de plataformas. Conservamos procedencia y controles de calidad, filtramos productos SP y `type=0`, recortamos al límite de Perú y usamos semanas completas.

No aplicamos el mismo umbral de confianza a ambos instrumentos, porque sus escalas son diferentes. Los NRT no se mezclan automáticamente con los SP; nuestra serie publicada no incluye NRT.

La preparación retuvo **2.228.157 detecciones**, agregadas en **855.553 grupos positivos celda–semana–plataforma**.

## 4. Organización espacial y temporal

- Límite de Perú: unión de departamentos oficiales MINAM, con geometrías generalizadas. La ubicación de puntos próximos a fronteras depende de ese detalle geométrico.
- Malla: **13.405 celdas de 10 × 10 km**, en proyección LAEA de área equivalente centrada en Perú.
- Tiempo: semanas UTC de lunes a domingo. Una celda–semana es un cuadrado concreto durante una semana concreta.
- Historia: MODIS desde **2000-11-06** y VIIRS desde **2012-02-06**, hasta **2026-07-26**, respetando el corte de semanas completas.

Se selecciona **una plataforma por instrumento y semana en todo el país**. Se prioriza Aqua y Suomi-NPP; se usan puentes documentados cuando falta la plataforma principal a escala nacional. No se suman todos los satélites ni se rellenan selectivamente huecos locales con otras plataformas.

La serie principal conserva 1.322.019 detecciones originales de las plataformas seleccionadas y 513.756 filas positivas celda–semana–instrumento. En el calendario nacional hay 10 semanas MODIS sin estimación. Los faltantes permanecen nulos.

## 5. Modelo de armonización

La idea estadística es:

```text
conteo esperado = actividad compartida × respuesta relativa de la plataforma
conteo comparable = conteo reportado / respuesta estimada
```

La respuesta es empírica: también puede absorber diferencias de oportunidades de observación, porque todavía no corregimos toda la cobertura histórica.

Suponemos conteos Poisson para dos plataformas que observan una misma celda–semana. Al condicionar en la suma de sus conteos, obtenemos una distribución binomial que elimina la actividad compartida como parámetro desconocido.

Como trabajamos con pares donde ambas plataformas registraron detecciones, la verosimilitud se condiciona además a que los dos conteos sean positivos. Los pares `1 + 1` no aportan información sobre su razón y se excluyen.

Para fijar la escala hacemos que la media geométrica de las respuestas Aqua y Suomi-NPP sea 1. Ninguno se considera la verdad absoluta. **Es una calibración por máxima verosimilitud condicional; no una regresión que toma MODIS como verdad.**

Factores multiplicativos aproximados del modelo seleccionado:

| Plataforma | Factor aplicado al conteo |
| --- | --- |
| Aqua | 1,993784 |
| Suomi-NPP | 0,501559 |
| Terra | 4,311475 |
| NOAA-20 | 0,512807 |
| NOAA-21 | 0,520861 |

Por ejemplo, 7 detecciones Aqua equivalen a unas 13,956 unidades comparables. Los decimales son unidades estadísticas, no fracciones de un incendio.

## 6. Cómo validamos

### Evaluación temporal y espacial

Comparamos candidatos global, estacional y regional-estacional. La selección interna usa 2019–2021 y exige al menos un 1 % de mejora para aumentar complejidad; se conservó el modelo global.

El ajuste de plataformas establecidas usa datos hasta 2021 y reserva bloques espaciales de 200 km. NOAA-21 se calibra mediante un puente de marzo–junio de 2023, manteniendo congelados los factores anteriores. La prueba final de 2024–2025 se evaluó después de fijar el modelo.

Ejemplo de MAE en pares positivos, sin ajuste frente a calibración:

| Evaluación | Sin ajuste | Calibrado |
| --- | --- | --- |
| 2024, zonas vistas | 1,833 | 1,099 |
| 2024, zonas reservadas | 2,454 | 1,261 |
| 2025, zonas vistas | 1,253 | 0,971 |
| 2025, zonas reservadas | 1,328 | 0,993 |

Mide el error al distribuir el total observado entre plataformas, **no el error contra el número real de incendios**. Los años 2024–2025 ya fueron examinados: no deben presentarse como una prueba todavía intacta para futuros modelos.

### Incertidumbre y reproducibilidad

Calculamos bandas del 95 % con 100 réplicas de bootstrap bayesiano por bloques de 28 días. Preservamos la correlación entre factores al agregar resultados.

La revisión v1.1 corrigió un error de unidades temporales en el bootstrap; las bandas anteriores se retiraron. Los parámetros centrales y las variables del pronóstico permanecieron iguales a tolerancia `1e-12`. Las bandas actuales solo representan incertidumbre de calibración, no toda la incertidumbre de fuego o cobertura.

### Validación geográfica y de integridad

Verificamos asignaciones de puntos a celdas y casos de frontera. Para las consultas regionales usamos R*Tree como búsqueda de candidatos y contención exacta en el polígono. Los conteos se asignan con las coordenadas originales; un empate de departamentos se resuelve una sola vez por código oficial.

La suma regional conserva los conteos nacionales por semana e instrumento: **1.322.019 detecciones en total**. El pipeline rechaza activos regionales de un snapshot incompatible. Los archivos publicados incluyen hashes y la restauración de SQLite comprueba integridad.

### Contraste con referencias externas

Descargamos 54.493 registros del [servicio geográfico oficial MINAM](https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1); quedaron 44.374 referencias elegibles para 2013–2025 después de auditar fechas, coordenadas, duplicados y procedencias.

La ventana principal fue 5 km y ±3 días de calendario. Evaluamos otras ventanas y desplazamientos de fechas de ±28 días como controles. En referencias de origen INDECI hubo coincidencias del 19,64 % para MODIS y 45,11 % para VIIRS.

Esto indica asociación, no una tasa de detección de todos los incendios. La independencia de las referencias respecto de imágenes satelitales sigue por comprobar. El portal solicitado respondió 403: se usó la capa oficial accesible, sin afirmar que sea exactamente el mismo archivo. Una correlación tampoco valida nuestros factores: multiplicar por una constante positiva no cambia Pearson o Spearman.

## 7. Pronóstico existente y siguiente etapa

La entrega contiene un **HistGradientBoostingClassifier experimental** para registros satelitales durante el 16–22 de noviembre de 2026. Usa geografía, estacionalidad e historia de años anteriores; no meteorología ni NRT reciente. Se entrenó en 2013–2021, calibró en 2022, seleccionó en 2023 y evaluó en 2024–2025. No supera siempre a la climatología.

El plan posterior de LightGBM, meteorología, NRT y priorización de población/áreas protegidas **todavía no está implementado**. Requiere definir las etiquetas, evitar información futura, calibrar probabilidades y evaluar prospectivamente antes de llamarlo riesgo operativo de incendio.

## 8. Evidencias para revisar

- [EDA simple](../notebooks/00_EDA_simple_MODIS_VIIRS.ipynb) y [diagnóstico de sensores](../notebooks/03_diagnostico_sensores.ipynb).
- [Baseline anterior](../notebooks/07_baseline_armonizacion.ipynb) y [serie comparable actual](../notebooks/09_series_comparables.ipynb).
- [Pronóstico experimental](../notebooks/10_pronostico_experimental.ipynb), [límites de detección](../notebooks/11_limites_deteccion.ipynb) y [contraste MINAM](../validacion/12_contraste_registro_MINAM.ipynb).
- [Metadatos de la serie](../data/series_metadata.json), [resultados de calibración](../reports/empirical/), [validación regional](../reports/regional_query/verification.json) y [guía para reproducir](../pipeline/REPRODUCIR.txt).
- [Documentación de nuestra API](API.md).

**Límite principal:** entregamos una armonización empírica de conteos reportados. La corrección física de toda la cobertura histórica, los incendios no detectados y la integración de eventos siguen pendientes.
