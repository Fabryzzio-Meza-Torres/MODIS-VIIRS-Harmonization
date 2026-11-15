# Evidencia histórica en la web

Sección integrada en `web/index.html`, ancla `#validacion`. Reutiliza la tipografía Inter, la paleta, los controles y el ritmo del visor existente. No modifica el modelo, la armonización ni la API del compañero.

## Qué se publica

El catálogo contiene **las 15 140 referencias atribuidas a INDECI** elegibles para el contraste de 2013-01-07 a 2025-12-31, conservando sus 22 473 ubicaciones reportadas. No se seleccionaron únicamente ejemplos favorables:

| Resultado bajo el criterio principal | Referencias |
| --- | ---: |
| Coincidencia con ambos instrumentos | 2 638 |
| Solo MODIS | 336 |
| Solo VIIRS | 4 192 |
| Sin coincidencia | 7 974 |
| Total | 15 140 |

Una referencia no equivale necesariamente a un incendio físico independiente. El catálogo agrupa puntos de un mismo código/origen y conserva las fechas y los IDs oficiales; las referencias sin código usan la clave de lugar/fecha del análisis anterior. Se excluyeron los códigos ambiguos cuyo rango temporal superaba 30 días.

Por instrumento, se reproducen exactamente los resultados ya publicados: **2 974 MODIS** y **6 830 VIIRS**. Hay superposición; no se suman para contar incendios. El denominador de estos resultados es el catálogo de referencias elegibles, no un inventario completo y verificado de incendios en Perú.

## Regla reproducida

Se conserva la ventana predefinida de **5 km y ±3 días completos del calendario local de Perú**, con distancia LAEA centrada en Perú. Las fechas sin hora se tratan como días completos; no se les asigna una hora de ignición inventada. El detalle muestra además distancia geodésica WGS84, sin cambiar el criterio original después de inspeccionar los resultados.

Se seleccionan los mismos registros FIRMS SP `type=0` y la misma plataforma por instrumento/semana que en la serie empírica publicada. Se reconstruyeron 1 097 502 observaciones seleccionadas: 155 836 MODIS y 941 666 VIIRS. Para cada referencia e instrumento se muestra el testigo más cercano que cumple la regla entre sus ubicaciones y fechas reportadas, con plataforma, timestamp, coordenadas y `source_row` del archivo original.

Se muestran también las sensibilidades predefinidas de 10 km/±3 días y 25 km/±7 días, los controles de fecha desplazada ±28 días y las asociaciones por origen. MINAM y ORORATECH permanecen separados de INDECI: su independencia de los datos satelitales no está demostrada. Los controles tampoco se presentan como periodos comprobados sin fuego.

## Trazabilidad de la fuente

Fuente oficial: [MINAM, Registro histórico de incendios 2000–2025](https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1).

El snapshot original tiene 54 493 filas, descarga UTC 2026-11-15T03:44:33, SHA-256 `77e4df26fe8e6f6e3c37cac1d2893f9c93fe4a2a8b32ccd4567a0b38bea6a3ae`. La descarga comprobó conservación exacta de los IDs oficiales. El catálogo deriva del archivo auditado previo, sin sustituirlo por datos obtenidos después para mejorar resultados.

Al preparar esta sección, se cotejó de nuevo una muestra determinista de **13 filas, una de cada año**, contra el servicio oficial. Coinciden origen, departamento, fecha textual y geometría. Esta comprobación muestral no se presenta como una nueva validación en vivo de todas las filas. Cada caso enlaza sus IDs oficiales, permitiendo inspeccionar el registro de origen.

No se afirma identidad exacta con el recurso del portal Datos Abiertos aportado anteriormente: ese portal devolvía 403 en la descarga inicial. La fuente empleada y verificable es explícitamente esta capa oficial de MINAM.

## Caso documental y evaluación estadística

Se incluye el caso COEN–INDECI n.º 2027 de Dos de Mayo, Curimaná, en 2019. Se conservan las copias de los PDF oficiales de INDECI y ANA con sus hashes originales. La referencia de localidad proviene de vértices de ribera junto al centro poblado, no de un punto del fuego. Los siete candidatos Suomi-NPP dentro de 2 km durante el intervalo reportado son compatibles con el entorno y el tiempo; no se les atribuye causalmente el incendio ni se infiere una omisión de MODIS.

Se publican por separado las correlaciones semanales descriptivas y los Brier del modelo frente a climatología. Una correlación no valida los factores de armonización; el error del modelo de episodios detectados tampoco demuestra que el porcentaje de ignición física esté validado.

## Publicación y funcionamiento

Datos versionados en `web/validation-data/summary.json` y `cases-AAAA.json`. El navegador descarga solo el año seleccionado, normalmente como gzip, verifica SHA-256 sobre los bytes descomprimidos y renderiza 12 referencias por página. Las copias JSON sin comprimir permiten descargar y auditar los registros. Todas las particiones comprimidas suman aproximadamente 1.1 MB.

Los filtros permiten año, departamento, resultado y código/ID. Los errores de carga o integridad se muestran sin datos ficticios. Las solicitudes anteriores se cancelan al cambiar de año. La sección es independiente de los resultados del filtro del gráfico principal; las métricas de cabecera corresponden al periodo completo y los filtros del catálogo solo afectan los ejemplos visibles.

Puede consumirse el mismo JSON desde otra web, mediante su backend si las reglas CORS del hosting lo requieren. No se necesita descargar datos masivos de la API de eventos para mostrar estas evidencias.

Regeneración local, conservando los artefactos auditados fuera de Git:

```powershell
python pipeline/build_validation_catalog.py --artifacts ../../outputs
python -m unittest discover -s pipeline -p test_validation_catalog.py -v
python pipeline/qa_validation_web.py --output ../../outputs/41_validacion_web/qa
```

La generación requiere las dependencias del entorno científico; la QA del navegador requiere Playwright y Chromium/Chrome. El servicio web no necesita esas dependencias. `build_validation_catalog.py` vuelve a contrastar la muestra con el servicio oficial y falla si no coincide; no sustituye silenciosamente los datos.
