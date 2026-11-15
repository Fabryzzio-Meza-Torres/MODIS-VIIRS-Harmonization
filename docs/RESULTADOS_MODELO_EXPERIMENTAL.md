# Resultado del entrenamiento experimental regional

Fecha: 2026-11-15. Versión: `regional-onset-proxy-v0.1`. Avance por entregables: **70 %**. El modelo está entrenado y evaluado; todavía no se publica en la API.

## Qué predice

Probabilidad de al menos un **nuevo episodio de fuego detectado por NOAA-20** en una región de Perú durante una semana objetivo, con anticipaciones de 1 a 12 semanas. Es una etiqueta indirecta de inicio; todavía no es una probabilidad validada de ignición física ni distingue automáticamente todas las quemas agrícolas.

La salida describe una semana, no el riesgo acumulado durante doce semanas. Los porcentajes regionales se modelan directamente; no se suman probabilidades de celdas.

## Qué entrenamos y cómo elegimos

Comparamos ocho candidatos: constante, climatología regional/mensual, regresión logística y cinco variantes LightGBM. Las variantes comprueban complejidad y contribución de meteorología/historia armonizada. No balanceamos artificialmente los datos.

- Ajuste: 2018–2021, con semanas objetivo maduras antes del límite.
- Selección y parada temprana: 2022.
- Calibración monotónica de probabilidades por anticipación: 2023.
- Prueba retrospectiva: 2024–2025, previamente examinados en el proyecto anterior.
- Confirmación 2026: abierta después de congelar la selección, sin usarla para elegir el modelo.
- Métrica de selección: media del Brier por anticipación; un modelo más complejo requiere al menos 1 % de mejora frente al candidato sencillo.

El candidato elegido fue **LightGBM sin las tres variables de contexto armonizado**, con 29 variables. Su Brier de selección fue 0,07017 frente a 0,07297 de climatología: mejora relativa de aproximadamente 3,8 %.

Esto no invalida las series armonizadas: son un producto de comparación histórica. En este experimento sus variables anuales no añadieron mejora incremental frente a historia NOAA-20, región, estación y meteorología. El modelo no suma FRP entre plataformas ni aplica factores de conteos al FRP.

## Resultados fuera del ajuste

Comparación de probabilidades con la transformación de calibración fijada en 2023. **Brier menor es mejor**; no es un porcentaje de aciertos.

| Periodo | Climatología calibrada | LightGBM seleccionado | Lectura |
| --- | ---: | ---: | --- |
| 2024 | 0,08300 | 0,08302 | Prácticamente empatados; candidato ligeramente peor |
| 2025 | 0,07435 | 0,06782 | Reducción de Brier del 8,8 % |
| Confirmación 2026 hasta julio | 0,09286 | 0,08919 | Reducción de Brier del 3,9 % |

La mejora conjunta 2024–2025 tiene un intervalo por bloques que incluye cero: ganancia Brier de 0,00304, intervalo percentil del 95 % de **−0,00082 a 0,00682**. Son 1.000 réplicas sobre nueve bloques de semanas objetivo de 13 semanas, manteniendo fijo el modelo. No es un intervalo de incertidumbre de incendios físicos ni incorpora el error del etiquetado.

La calibración no garantizó mejora: en 2024–2025 el Brier antes/después fue 0,07587/0,07593 y el ECE de diez intervalos fue 0,01483/0,02131. No cambiamos a la variante sin calibrar después de mirar esta prueba. La transformación aplicada está documentada, pero no se afirma que sus porcentajes sean confiables para todos los departamentos.

## Validación espacial, anticipaciones y errores

Entrenamos un modelo sombra excluyendo los objetivos de Ayacucho, Huánuco, Lima, Piura y Ucayali también de selección y calibración. Sus covariables históricas locales siguen disponibles: no simula regiones sin ninguna historia. El modelo sombra se seleccionó separadamente, sin usar las etiquetas de esos departamentos.

En los cinco departamentos reservados, el Brier del modelo seleccionado fue 0,07118 en 2024, 0,04791 en 2025 y 0,07579 en la confirmación 2026. Son resultados de un modelo sombra, no los del modelo entrenado con todas las regiones.

Se calcularon métricas por departamento y por anticipación. Para comparar anticipaciones se añadió una evaluación con las mismas semanas objetivo: los filtros de madurez dejan calendarios diferentes por plazo y podrían hacer parecer que doce semanas son mejores solo porque se evalúan otras estaciones.

Entre los mayores errores regionales aparecen Moquegua y Tacna. No se elige retrospectivamente un modelo diferente para cada región ni se borran esos casos de las métricas.

Las etiquetas son frecuentes: el 83,9 % de las filas de entrenamiento son positivas. Por eso no usamos accuracy como argumento principal ni presentamos average precision cercana a 1 como prueba de detección de incendios reales. La regla de capacidad evalúa las cinco regiones prioritarias por emisión/anticipación, sin afirmar que eso maximice vidas protegidas.

## Robustez y límites para el despliegue

En perturbaciones retrospectivas, retirar toda la meteorología elevó el Brier a 0,08054 frente a 0,07593 y cambió la probabilidad unos 3,1 puntos porcentuales en promedio. Alterar los conteos un ±30 % cambió mucho menos el resultado. Son diagnósticos sintéticos, no validación de transferencia SP/NRT.

La importancia por permutación en selección señala principalmente región y estacionalidad. No es evidencia causal de por qué se inicia un incendio.

Pendientes antes de publicar la nueva ruta:

1. Reproducir las mismas variables en inferencia y generar las 300 combinaciones región/anticipación.
2. Comprobar frescura, valores faltantes y diferencias de NRT respecto de SP; NRT no aporta type=0 confirmado.
3. Configurar actualización de insumos y salida explícita cuando no exista soporte.
4. Integrar y probar el endpoint experimental, conservando semántica, versión y advertencias de validación.

La verificación de ignición física, la revisión humana de etiquetas y la evaluación prospectiva siguen pendientes. El uso institucional requiere esa evidencia adicional a esta demostración.

## Dónde está la evidencia

- [Notebook ejecutado del entrenamiento](../notebooks/16_modelo_riesgo_regional.ipynb).
- [Protocolo fijado antes del entrenamiento](../reports/prediction/model/training_protocol_frozen.json).
- [Selección](../reports/prediction/model/selection_metrics.csv), [evaluación](../reports/prediction/model/evaluation_metrics.csv), [anticipaciones](../reports/prediction/model/evaluation_by_lead.csv) y [regiones](../reports/prediction/model/evaluation_by_region.csv).
- [Informe y hashes](../reports/prediction/model/training_evaluation_report.json), [calibración](../reports/prediction/model/calibration_diagnostic.json) y [robustez](../reports/prediction/model/robustness_diagnostic.json).
- Código: [estimadores](../pipeline/regional_risk_models.py), [entrenamiento](../pipeline/train_regional_risk.py) y [diagnósticos](../pipeline/analyze_regional_risk.py).

El archivo `model_freeze_before_test.json` conserva intencionalmente el estado **anterior** a abrir la prueba. El resultado posterior está en `training_evaluation_report.json`; los hashes del modelo y del archivo de congelamiento permanecen iguales.

El artefacto entrenado local está en `outputs/39_modelo_riesgo_regional/regional_risk_models.joblib`, fuera del checkout. No necesita reentrenarse para generar predicciones; requiere las mismas variables y versiones. Se comprobó igualdad de predicciones tras guardar y volver a cargar el modelo, con tolerancia absoluta `1e-12`.
