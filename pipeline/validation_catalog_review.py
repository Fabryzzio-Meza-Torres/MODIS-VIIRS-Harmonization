# %% [markdown]
# # Evidencia histórica publicada en la web
# Auditoría del catálogo de referencias oficiales y sus testigos satelitales.
# Una asociación espacio-temporal no verifica atribución ni ignición física.
# Este notebook conserva todos los resultados, incluidos los no coincidentes.

# %%
from pathlib import Path
import gzip,hashlib,json
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display
repo=next(p for p in [Path.cwd(),*Path.cwd().parents] if (p/'web/validation-data/summary.json').exists())
folder=repo/'web/validation-data'
summary=json.loads((folder/'summary.json').read_text(encoding='utf-8'))
cases=[]
for entry in summary['years']:
    raw=(folder/entry['file']).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==entry['sha256']
    assert gzip.decompress((folder/entry['compressed_file']).read_bytes())==raw
    cases.extend(json.loads(raw)['data'])
data=pd.DataFrame(cases)
assert len(data)==15140 and data.id.is_unique
print('Referencias conservadas:',len(data))
print('Ubicaciones originales agrupadas:',data.registry_locations.sum())
display(data.match_status.value_counts().rename_axis('resultado').rename('referencias').to_frame())

# %% [markdown]
# ## Una misma regla y el denominador completo
# Distancia LAEA hasta 5 km y ±3 días completos del calendario local. Los
# controles desplazan la fecha ±28 días en el mismo lugar. No son negativos
# comprobados ni una estimación de la tasa de falsos positivos.

# %%
scores=pd.DataFrame(summary['associations'])
primary=scores.loc[scores.origin.eq('INDECI')&scores.radius_km.eq(5)]
display(primary[['instrument','date_shift_days','incident_references','with_satellite_record','association_fraction']])
plot=primary.pivot(index='instrument',columns='date_shift_days',values='association_fraction')*100
plot=plot.reindex(columns=[-28,0,28]).rename(columns={-28:'28 días antes',0:'Fecha del registro',28:'28 días después'})
ax=plot.plot.bar(figsize=(9,4),rot=0,color=['#64748b','#147d92','#b56936'])
ax.set_ylabel('% de referencias con coincidencia');ax.set_xlabel('Instrumento')
ax.set_title('Asociación con referencias INDECI: 5 km y ±3 días')
ax.set_ylim(0,100);ax.figure.tight_layout();plt.show()

# %% [markdown]
# ## Ejemplos trazables, sin ocultar los casos sin coincidencia
# Cada año es una partición completa, no una selección de éxitos. Los testigos
# guardan IDs oficiales, fechas, coordenadas, distancia y fila del archivo FIRMS.
# La ausencia de coincidencia no demuestra ausencia de fuego u omisión del sensor.

# %%
for status in ['both','modis','viirs','none']:
    print('Resultado:',status)
    display(data.loc[data.match_status.eq(status),['id','date_start','departments','registry_object_ids','matches']].head(2))
assert sum(data.matches.map(lambda rows:any(r['instrument']=='MODIS' for r in rows)))==2974
assert sum(data.matches.map(lambda rows:any(r['instrument']=='VIIRS' for r in rows)))==6830

# %% [markdown]
# ## Fuentes y comprobación reciente
# La muestra actual de 13 filas coteja atributos y geometría con el servicio
# oficial. No verifica en vivo todas las filas ni demuestra independencia de
# la fuente respecto de los productos satelitales. Los PDF del caso Curimaná
# conservan los hashes del estudio previo.

# %%
display(summary['source_snapshot'])
display(summary['live_source_verification'])
for document in summary['case_study']['document_hashes']:
    assert hashlib.sha256((folder/'documents'/document['file']).read_bytes()).hexdigest()==document['sha256']
display(summary['case_study'])

# %% [markdown]
# ## Lo que esta evidencia permite afirmar
# Permite mostrar asociaciones históricas concretas, con denominadores y fuentes.
# No verifica que cada detección corresponda al incendio reportado, no valida la
# escala global de armonización por correlación ni valida el riesgo de ignición
# física futura. La evaluación del modelo usa etiquetas indirectas y se muestra
# por separado; no se presenta como una tasa de acierto contra incendios reales.

# %%
display(pd.DataFrame(summary['model_evaluation']))
display(summary['interpretation'])
assert not any(summary['interpretation'].values())
print('Sección: /visor/#validacion')
print('Datos: /visor/validation-data/summary.json')
