# Modelo de predicción: primer punto de revisión

Fecha: 2026-11-15. Estado: **modelo experimental entrenado y evaluado; revisión previa a inferencia NRT y publicación**. Avance por entregables: **70 %**. La API pública todavía no se modificó. Resultados: [RESULTADOS_MODELO_EXPERIMENTAL.md](RESULTADOS_MODELO_EXPERIMENTAL.md).

## Objetivo propuesto

**Objetivo confirmado por el equipo:** mostrar un porcentaje de riesgo de inicio de al menos un nuevo incendio en una región de Perú durante una semana futura seleccionada. Usaremos los códigos regionales de nuestra API. Las celdas de 10 km podrán servir como soporte interno de variables; el resultado final es regional.

La variable deseada es un inicio de incendio nuevo, no la continuación de uno existente. Las detecciones satelitales son etiquetas indirectas: el primer registro no demuestra la hora real de ignición ni distingue por sí solo una quema agrícola. Debemos reconstruir inicios sin información futura y contrastar sus etiquetas antes de presentar el porcentaje como probabilidad física de incendio. Los eventos activos y las pérdidas potenciales son salidas separadas.

Ejemplo de interpretación: 60 % para Cusco y una semana futura significa una probabilidad estimada de que se inicie al menos un nuevo incendio elegible allí durante esa semana; no significa que arderá el 60 % de Cusco. Es un ejemplo de contrato, no una predicción calculada.

Evaluaremos directamente la etiqueta regional. No sumaremos ni promediaremos probabilidades de celdas ni asumiremos su independencia. También comprobaremos si el resultado se satura cerca del 100 % en regiones grandes; un conteo esperado puede complementar la probabilidad, sin cambiar silenciosamente el objetivo.

La semana objetivo se define de lunes 00:00 a lunes siguiente 00:00 en America/Lima. **Anticipación solicitada: de 1 a 12 semanas.** La semana 1 es la próxima semana completa posterior a la fecha de emisión; la semana 12 empieza once semanas después de la semana 1. El producto debe evaluar cada anticipación por separado y rechazar combinaciones sin soporte suficiente.

Doce semanas de salida no significan doce semanas de clima diario preciso. Los modelos meteorológicos de medio plazo de ECMWF llegan a 15 días y los subestacionales a 46 días. Para plazos mayores se usarán, si disponemos de históricos de emisión verificables, predictores estacionales/probabilísticos; de otro modo se evaluará una referencia histórica/estacional explícita. No usaremos el clima futuro realizado como si se hubiera pronosticado. Fuentes: [ECMWF medio plazo](https://www.ecmwf.int/en/forecasts/documentation-and-support/medium-range-forecasts), [subestacional](https://www.ecmwf.int/en/forecasts/about-our-forecasts/sub-seasonal-range-forecasts) e [índices estacionales de peligro de fuego](https://www.ecmwf.int/en/forecasts/datasets/seasonal-forecast-fire-danger-indices-copernicus-emergency-management-service).

## Datos ya revisados

| Fuente | Qué aporta | Estado |
| --- | --- | --- |
| Nuestra API/snapshot | Historia armonizada semanal, malla y regiones MINAM | Snapshot local y público coinciden |
| Rama `deploy-docker` del compañero | Detecciones individuales, eventos y fuentes fijas | Respaldo descargado y SHA-256 verificado |
| Cuatro ZIP FIRMS originales | Reconstrucción de filtros sin mirar el futuro | Disponibles localmente; preparación pendiente |
| Meteorología NASA POWER observada | Temperatura, humedad, precipitación y viento pasados | 135.750 registros diarios en 25 puntos regionales; sin pronóstico futuro utilizado |
| NRT NOAA-20 | Variables recientes | 40.384 detecciones preparadas desde la descarga original; refresco automático y transferencia SP/NRT pendientes |

**Plataforma de referencia confirmada por el usuario: NOAA-20.** NOAA anunció el cese de entrega de productos Suomi-NPP el 2 de noviembre de 2026. Usamos NOAA-20 para el nuevo objetivo y sus señales recientes; MODIS y Suomi-NPP permanecen en el contexto histórico armonizado. El cambio de referencia no descarta sus series. [Aviso actualizado de NOAA](https://www.nesdis.noaa.gov/news/update-3-cessation-of-suomi-national-polar-orbiting-partnership-s-npp-data-users-november-02-2026-1540-utc-and-decommissioning-issued-october-30-2026-1400-utc).

La rama del compañero está fijada al commit `3084cc5681bac763fdd651e01cef1d6a12461520`. Su dump pesa 131.915.596 bytes y tiene SHA-256 `5382be98a0221e528995f2d44470d03f0e2bcc2307bc0a61410744c745aa7e71`.

Se extrajeron los datos sin ejecutar el SQL del respaldo y sin modificar bases existentes:

- 795.540 eventos.
- 1.958.951 detecciones SP, entre 2012-01-20 y 2026-07-31.
- 4.803 celdas de fuentes fijas.
- Cero IDs de detección duplicados, fechas/coordenadas inválidas, FRP negativo o faltante, y referencias a eventos inexistentes en las comprobaciones ejecutadas.

Esto prueba integridad estructural; no certifica que cada fila sea un incendio real ni sustituye la validación de etiquetas.

## Diferencias que debemos resolver

1. **Filtros distintos:** nuestro histórico retiene SP type=0 sin un umbral común de confianza; el compañero excluye confianza baja y fuentes fijas. No sumaremos ambos conteos ni transferiremos nuestros factores a sus agregados sin comprobarlo.
2. **Geografía distinta:** sus departamentos son geoBoundaries y su LAEA es esférica. Reproyectaremos desde latitud/longitud a nuestra malla; no reutilizaremos directamente su `x_km`, `y_km` o departamento como identificadores equivalentes.
3. **Campos finales del evento:** centro, duración, tipo, confianza agregada, FRP total y desplazamiento usan el futuro del evento. No serán variables de entrada tal como vienen. Las reconstruiremos, cuando proceda, solo con detecciones previas a la emisión.
4. **Máscara retrospectiva:** la exclusión de fuentes fijas usa todo 2012–2026. Debemos recalcularla con el pasado disponible o declarar el dump como fuente retrospectiva auxiliar. La evaluación principal no puede presentarse como una simulación operativa limpia usando silenciosamente ese filtro.
5. **Disponibilidad real:** `t_utc` es hora de adquisición, no de publicación. El backtest SP no demuestra rendimiento con NRT. Se conservarán `acquired_at`, `available_at` y `ingested_at` cuando existan; sus diferencias no se inventarán.

## Cómo construiremos cada fila

### Piloto de etiquetas ya ejecutado (desarrollo, 2013)

Para comprobar el objetivo antes del entrenamiento, usamos el archivo original SP de Suomi-NPP, type=0 y confianza nominal/alta, sin aplicar la máscara retrospectiva del compañero. Es una plataforma de referencia estable dentro del piloto, no un protocolo final para todo 2012–2026/NRT.

Regla candidata: un episodio comienza con una detección sin otra detección previa a 1,25 km o menos durante los cinco días anteriores. Las detecciones del mismo instante se agrupan espacialmente; si su componente conecta con actividad previa, se trata como continuación. Los episodios pasados no se reescriben cuando llegan observaciones posteriores.

Se procesaron 59.225 detecciones del periodo objetivo de 2013, más un buffer anterior para evitar inicios falsos por corte del archivo. La regla produjo 33.057 candidatos, con alguna aparición en 1.057 de 1.300 combinaciones región–semana (81,31 %). Con 1 km/3 días y 2,5 km/7 días, la prevalencia regional fue 81,38 % y 80,85 %. Son resultados descriptivos de desarrollo, no métricas del modelo.

Se generaron 50 casos de inicios/continuaciones para revisión humana. Tres pruebas verifican invariancia frente a añadir futuro, tratamiento conjunto de detecciones simultáneas y límites temporales/espaciales. Todavía pueden aparecer falsos inicios por nubosidad, avance de un frente o quemas agrícolas; primer registro no significa ignición. Las etiquetas no están aprobadas para entrenamiento final.

Informes: `reports/prediction/onset_pilot_report.json` y `reports/prediction/regional_prevalence_pilot.csv`. El detalle de detecciones y los 50 casos quedan localmente en el directorio de salida del piloto, sin publicarse ni modificar la API.

### Dataset NOAA-20 ya construido

La referencia NOAA-20 cubre del 16 de abril de 2018 al 26 de julio de 2026, en semanas locales completas. Se retuvieron 577.813 detecciones del periodo objetivo; el algoritmo generó 324.828 candidatos de inicio. Son etiquetas indirectas, no un inventario de incendios físicos verificados.

El filtro no vegetal se fijó con 2.892 celdas identificadas como type=1/2/3 **antes del 16 de abril de 2018**, sin aprender persistencia de 2018–2026. Se excluyeron 3.317 detecciones del archivo con buffer. No se trasladó la máscara retrospectiva completa del compañero al entrenamiento.

La tabla final contiene **115.350 filas región–emisión–semana objetivo**, 25 regiones y anticipaciones 1–12. Incluye 32 variables, contando identificador regional y anticipación. Hay 51.450 filas de entrenamiento, 13.650 de selección, 13.950 de calibración, 29.250 de prueba retrospectiva y 7.050 de confirmación 2026. Se retiraron 7.800 filas cuyas semanas objetivo no terminaban antes del límite de su periodo. Las filas de anticipaciones distintas pueden compartir la misma región/semana objetivo; no son resultados independientes.

El protocolo de emisión para esta versión es domingo 00:00 de Perú; la semana 1 empieza al lunes siguiente y la semana 12 once semanas después. Las variables históricas incluyen recuentos/FRP y candidatos previos a 7/28/90 días, contexto armonizado de un año antes y meteorología pasada. El contexto armonizado ausente permanece nulo, acompañado de un indicador; no se inventan conteos diarios a partir de semanas.

Los retardos de tres días para detecciones y siete días después del final de la jornada meteorológica son **supuestos de simulación**, no tiempos de publicación históricos demostrados. Los archivos SP y los reanálisis actuales no permiten reconstruir exactamente qué versión habría estado disponible entonces. Por tanto, los resultados futuros de este dataset serán retrospectivos hasta validar la transferencia a NRT y realizar un piloto prospectivo.

Los datos meteorológicos son muestras en un punto interior por departamento, no promedios de superficie. No se ha utilizado meteorología futura realizada. El NRT preparado no aporta el campo type: se conserva desconocido, sin inventar type=0 ni usarlo como etiqueta de entrenamiento. La última adquisición del archivo NOAA-20 es 2026-11-13 18:47 UTC; hay que actualizar la fuente antes de mantener un servicio periódico.

Evidencia: `reports/prediction/dataset_manifest.json`, `evaluation_protocol.json`, `weather_manifest.json`, `noaa20_label_manifest.json` y `nrt_ingestion_report.json`. Revisión ejecutada: `notebooks/15_dataset_riesgo_regional.ipynb`.

Una fila del modelo final corresponde a región, fecha de emisión y semana objetivo futura. Se podrá preparar una tabla intermedia por celda. Las variables deben estar disponibles antes de la emisión; los datos de la semana futura no pueden entrar como variables.

Variables candidatas:

- Detecciones previas y FRP por plataforma en ventanas de 1, 7, 30 y 90 días, con controles de duplicados y disponibilidad.
- Historia armonizada de semanas ya terminadas y publicadas; recurrencia estacional de años anteriores.
- Señales de actividad cercana calculadas solo con el pasado.
- Meteorología pasada y pronósticos emitidos antes del corte. No sustituiremos pronósticos históricos por el clima que realmente ocurrió después.
- Geografía y vegetación con fecha de referencia documentada.
- Indicadores de datos faltantes, antigüedad de insumos y plataformas disponibles.

Etiqueta deseada: al menos un inicio nuevo en la región durante la semana objetivo, bajo un protocolo de episodio/plataformas/filtros que fijaremos antes de entrenar y contrastaremos con referencias. Una etiqueta negativa de archivo representa ausencia de inicio registrado, no ausencia física de fuego. Ventanas incompletas se excluyen o marcan desconocidas. Se distinguirá la detección inicial de la continuación de un episodio previo.

La calibración de conteos publicada se tratará como un componente congelado/versionado; se revisará que su fecha de ajuste sea compatible con cada evaluación. Se necesitan datos diarios originales: la serie semanal de la API no se desagrega inventando conteos diarios.

## Modelos y evaluación

Se compararon climatología regional/estacional, un baseline sencillo y LightGBM para el objetivo de nuevos inicios detectados, con calibración y evaluación por región y anticipación. Nuestro pronóstico experimental semanal anterior sirve como referencia de producto, pero no como comparación directa porque su etiqueta es actividad reportada por celda, no inicio nuevo regional.

El candidato elegido en selección fue LightGBM sin las variables de contexto armonizado. En prueba quedó prácticamente empatado con climatología en 2024, redujo Brier 8,8 % en 2025 y 3,9 % en la confirmación 2026. La mejora conjunta por bloques incluye cero y la transformación de calibración no mejoró el Brier/ECE retrospectivo conjunto. No se cambió el modelo después de abrir estas evaluaciones. El artefacto está guardado y verificado; aún falta la inferencia actual y su integración.

- Validación cronológica con ventanas móviles y separación espacial por bloques.
- Las etiquetas de entrenamiento deben terminar antes del siguiente periodo de evaluación; se aplica una separación acorde al horizonte de siete días.
- Ajuste de hiperparámetros y calibración probabilística usan periodos separados del de evaluación.
- PR-AUC, Brier, curva de calibración, falsas alarmas y precisión/recuperación entre las zonas prioritarias. El conjunto de evaluación conserva la prevalencia real.
- Comparación con y sin datos del compañero, con y sin meteorología y con distintos regímenes de plataformas.
- 2024–2025 ya se examinaron en el trabajo previo: las comparaciones allí serán retrospectivas. Antes de abrir resultados del nuevo modelo fijaremos el protocolo y reservaremos una evaluación prospectiva.

No elegiremos LightGBM automáticamente: debe mejorar una referencia útil y producir probabilidades suficientemente calibradas. Un porcentaje mal calibrado no se publicará como riesgo confiable.

## Entregables y revisiones humanas

Estos porcentajes representan entregables previstos; no tiempo consumido ni calidad científica.

| Paso | Entregable revisable | Avance acumulado |
| --- | --- | --- |
| 1 | Auditoría de fuentes y propuesta de contrato | 20 %: preparado para revisión |
| 2 | Dataset experimental reproducible y cortes temporales comprobados; disponibilidad histórica simulada explícita | 45 %: preparado para revisión |
| 3 | Baselines, LightGBM y evaluación temporal/departamentos reservados | 70 %: terminado, preparado para revisión |
| 4 | Calibración, errores regionales y piloto con NRT | 90 %: terminado; API local preparada para revisión |
| 5 | API, pruebas desde la web y documentación de uso | 100 % de la versión experimental acordada |

Al terminar cada paso se presentan resultados y decisiones; el siguiente comienza después de tu revisión. Ningún porcentaje sustituye los criterios de aceptación.

## Integración prevista

Se entrenó con archivos/snapshots versionados, sin pedir millones de registros a la API por cada ejecución. El piloto generó 300 predicciones en un snapshot que la API local ya lee. La tarea periódica de actualización aún no está implementada: esta emisión caduca el 22 de noviembre de 2026 a las 00:00 de Lima. Resultados, vigencia y pruebas están en `PILOTO_PRONOSTICOS.md`.

Ruta implementada y probada localmente, pendiente de aprobación para publicarse:

```text
GET /v1/fire-risk?region_id=08&target_week_start=AAAA-MM-DD
```

Cada resultado identificará región, emisión, semana objetivo, anticipación, probabilidad de al menos un inicio nuevo y su significado, calidad/frescura de datos, versión del modelo y del dataset. Si faltan NRT o meteorología necesarios, devolverá un estado explícito o un producto histórico separado; no una probabilidad aparentemente actual.

La prioridad para gobiernos se calculará aparte, cruzando probabilidad con población, áreas protegidas y capacidad de respuesta. No sumaremos probabilidades por celda para inventar una probabilidad regional ni presentaremos ese ranking como pérdidas humanas esperadas.

**Decisiones incorporadas:** el equipo prioriza inicio de nuevos incendios por región y semana futura, con hasta 12 semanas de anticipación. NOAA-20 es la referencia aprobada. El piloto usa nuevos episodios detectados como etiqueta indirecta; no se validó ignición física. Siguiente revisión: resultados de la emisión y autorización para publicar la versión experimental. El uso operativo para protección de vidas requiere validación y revisión institucional adicionales al piloto.
