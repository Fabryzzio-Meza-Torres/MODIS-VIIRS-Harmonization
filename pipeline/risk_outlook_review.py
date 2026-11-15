# %% [markdown]
# # Piloto de pronósticos regionales: revisión antes de publicar
# Se estima la probabilidad experimental de al menos un nuevo episodio de fuego
# **detectado** en un departamento durante una semana. No es porcentaje de
# territorio quemado, gravedad ni ignición física verificada. Cada semana es
# independiente como consulta: el plazo 12 no significa riesgo acumulado.

# %%
from pathlib import Path
import hashlib,json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display

repo=next(p for p in [Path.cwd(),*Path.cwd().parents] if (p/'data/regional_outlook.json').exists())
raw=(repo/'data/regional_outlook.json').read_bytes()
document=json.loads(raw);meta=document['metadata']
manifest=json.loads((repo/'data/regional_outlook_manifest.json').read_text(encoding='utf-8'))
assert hashlib.sha256(raw).hexdigest()==manifest['sha256']
data=pd.DataFrame(document['data'])
folder=repo/'reports/prediction/pilot'
figures=folder/'figures';figures.mkdir(parents=True,exist_ok=True)
print('Emisión real:',meta['issued_at'])
print('Corte semanal de referencia:',meta['feature_reference_at'])
print('Primera y última semana:',data.target_week_start.min(),data.target_week_start.max())
print('Fin exclusivo del último objetivo:',data.target_week_end_exclusive.max())

# %% [markdown]
# ## 1. ¿Están las 300 combinaciones completas?
# Son 25 departamentos por 12 semanas. Los valores son probabilidades regionales,
# no la suma de probabilidades de celdas. Los faltantes deben permanecer nulos
# con una razón explícita; aquí los insumos permiten calcular las 300 salidas.

# %%
assert len(data)==300 and not data.duplicated(['region_id','lead_weeks']).any()
assert set(data.lead_weeks)==set(range(1,13)) and data.region_id.nunique()==25
assert data.probability.between(0,1).all()
assert np.allclose(data.probability*100,data.probability_percent,atol=1e-9,rtol=0)
display(data.groupby(['estimation_status','quality_status']).size().rename('filas').to_frame())
first=data.loc[data.lead_weeks.eq(1)].sort_values('region_name')
display(first[['region_id','region_name','target_week_start','probability_percent']].round(2))

# %% [markdown]
# ## 2. Todas las semanas y departamentos
# Una región grande puede tener un porcentaje alto porque basta con un episodio
# en cualquier lugar de la región. La prevalencia positiva histórica fue alta
# (aproximadamente 84 % en entrenamiento); no interpretar estos porcentajes como
# certeza de un incendio destructivo. El modelo también puede registrar quemas.

# %%
matrix=data.pivot(index='region_name',columns='target_week_start',values='probability_percent').sort_index()
fig,ax=plt.subplots(figsize=(13,11))
image=ax.imshow(matrix.to_numpy(),vmin=0,vmax=100,cmap='YlOrRd',aspect='auto')
ax.set_xticks(range(12),[x[5:] for x in matrix.columns],rotation=45,ha='right')
ax.set_yticks(range(25),matrix.index)
ax.set_xlabel('Inicio de la semana objetivo (MM-DD); 2026-11 a 2027-02')
ax.set_title('Probabilidad experimental de nuevo episodio detectado (%)')
fig.colorbar(image,ax=ax,label='% regional semanal')
fig.tight_layout();fig.savefig(figures/'regional_outlook_heatmap.png',dpi=150);plt.show()

# %% [markdown]
# ## 3. Comparación con climatología y señales fuera del rango histórico
# La climatología es una referencia, no una verdad. El modelo mejora frente a
# ella en 2025 y 2026, pero empata en 2024. La calibración no mejoró la prueba
# conjunta. No se seleccionó otra variante después de ver esos resultados.
# Los avisos de rango comparan variables con el entrenamiento 2018–2021;
# no son intervalos de confianza ni corrigen automáticamente el porcentaje.

# %%
review=first[['region_name','probability_percent','climatology_probability_for_review',
    'features_outside_region_training_range']].copy()
review['climatology_percent']=100*review.pop('climatology_probability_for_review')
review['outside_training_range_count']=review.features_outside_region_training_range.map(len)
display(review.drop(columns='features_outside_region_training_range').round(2))
fig,ax=plt.subplots(figsize=(11,4))
ax.scatter(first.region_name,first.probability_percent,label='Modelo congelado',s=24)
ax.scatter(first.region_name,first.climatology_probability_for_review*100,label='Climatología',s=24,marker='x')
ax.set_ylim(0,103);ax.set_ylabel('% regional semanal');ax.tick_params(axis='x',rotation=90)
ax.legend();ax.set_title('Primera semana: 16–22 de noviembre de 2026')
fig.tight_layout();fig.savefig(figures/'first_week_vs_climatology.png',dpi=150);plt.show()

# %% [markdown]
# ## 4. Vigencia, procedencia y límites de esta entrega
# No se usó meteorología futura realizada ni se inventó un pronóstico diario
# a 12 semanas. La señal es principalmente región y estación del año. POWER es
# un punto por departamento, no una media de todo el territorio. La disponibilidad
# histórica meteorológica se simuló con latencia, no se reconstruyeron vintages.
# El NRT carece de tipo confirmado y su transferencia desde SP sigue sin validarse
# con resultados futuros. Esta primera emisión no tiene refresco automático.
# Caduca el domingo 22 de noviembre a las 00:00 de Lima: entonces la API rechaza
# porcentajes hasta que exista una emisión renovada. No reentrena por petición.

# %%
display(pd.Series({k:meta[k] for k in ['NRT_last_acquisition_utc','NRT_ingested_at',
    'reference_cutoff_exclusive','weather_value_days_used','weather_last_source_day',
    'NRT_SP_transfer_validated','NRT_type0_assumed','automatic_refresh_configured',
    'physical_ignition_probability_verified','calibration_improvement_demonstrated']},name='valor').to_frame())
for name in ['pilot_verification.json','feature_parity_report.json','local_api_review.json','docker_HTTP_verification.json']:
    evidence=json.loads((folder/name).read_text(encoding='utf-8'))
    print(name);display(evidence)

# %% [markdown]
# ## 5. Consulta por región y semana
# Endpoint preparado localmente, pendiente de revisión y publicación:
# `/v1/fire-risk?region_id=08&target_week_start=2026-11-16`.
# La respuesta conserva versión, fechas de emisión/objetivo, calidad de insumos
# y porcentaje. La selección de una región en la web puede usar `/v1/regions`.
# Un porcentaje de 97.7 % en Cusco significa al menos un episodio nuevo detectado
# en toda la región durante esa semana; no que 97.7 % de Cusco se vaya a quemar.

# %%
example=json.loads((folder/'example_response_cusco.json').read_text(encoding='utf-8'))
display(example['data'])
print('Estado del objetivo:',example['metadata']['target_period_status'])
print('Vigente hasta:',example['metadata']['valid_until'])
print('Interpretación:',example['metadata']['interpretation_es'])
print('Pendiente: revisión humana y autorización para publicar el snapshot experimental.')
