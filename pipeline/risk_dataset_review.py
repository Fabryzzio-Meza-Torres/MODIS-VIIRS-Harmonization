# %% [markdown]
# # Revisión humana 2: dataset regional para anticipaciones de 1 a 12 semanas
# Se construyó un dataset experimental con NOAA-20 como referencia, historia
# armonizada y meteorología pasada. Todavía no se entrenó ni publicó un modelo.
# El objetivo deseado es un nuevo incendio; la etiqueta disponible es un nuevo
# episodio detectado. No se declaran igniciones físicas confirmadas.

# %%
from pathlib import Path
import json
from IPython.display import display, Markdown, Image
import matplotlib.pyplot as plt

repo=next(p for p in [Path.cwd(),*Path.cwd().parents]
          if (p/'reports/prediction/dataset_manifest.json').exists())
folder=repo/'reports/prediction'
load=lambda name:json.loads((folder/name).read_text(encoding='utf-8'))
data=load('dataset_manifest.json')
protocol=load('evaluation_protocol.json')
nrt=load('nrt_ingestion_report.json')
reference=load('noaa20_label_manifest.json')
evidence=load('onset_evidence_report.json')
assert not data['model_trained'] and not data['physical_ignition_labels_verified']
print('Filas:',data['rows'])
print('Departamentos/Callao:',data['regions'])
print('Anticipaciones:',data['leads'])
print('Variables:',len(data['features']))
print('Referencia:',reference['reference_platform'])

# %% [markdown]
# ## 1. Separación temporal y madurez de las etiquetas
# Cada fila identifica región, emisión dominical y semana objetivo posterior.
# Las semanas objetivo deben terminar antes del siguiente periodo: no basta con
# que la fecha de emisión esté dentro del entrenamiento.
# 2024–2025 ya se examinaron en el proyecto anterior y son evaluación retrospectiva.
# El rendimiento 2026 no se usará para seleccionar el nuevo modelo.

# %%
table=['| Etapa | Filas |','| --- | ---: |']
table += [f'| {name} | {count:,} |' for name,count in data['rows_by_split'].items()]
display(Markdown('\n'.join(table)))
print('Filas retiradas por madurez:',data['boundary_rows_purged_for_target_maturity'])
print('Emisión:',protocol['issue_schedule'])
print('Semana 1:',protocol['lead_1'])
print('Semana 12:',protocol['lead_12'])

# %% [markdown]
# ## 2. La frecuencia histórica obliga a un baseline serio
# La proporción de positivos se muestra únicamente para entrenamiento. No es
# accuracy ni probabilidad calculada para una semana futura particular.
# La unidad de etiqueta región/semana se repite en anticipaciones distintas;
# las 115 mil filas no son 115 mil incendios o resultados independientes.

# %%
p=data['training_target_prevalence']
fig,ax=plt.subplots(figsize=(6,3.5))
bars=ax.bar(['Nuevo episodio registrado','Sin nuevo episodio registrado'],[100*p,100*(1-p)],color=['#c45c24','#177785'])
ax.set_ylabel('% de filas de entrenamiento')
ax.set_ylim(0,100)
ax.bar_label(bars,fmt='%.1f %%',padding=3)
ax.spines[['top','right']].set_visible(False)
fig.tight_layout()
figure_folder=repo.parent.parent/'outputs/37_dataset_riesgo_regional/figures'
figure_folder.mkdir(parents=True,exist_ok=True)
figure=figure_folder/'training_label_prevalence.png'
fig.savefig(figure,dpi=150)
plt.close(fig)
display(Image(filename=str(figure)))
print('Las ausencias son de registro, no observaciones confirmadas sin fuego.')

# %% [markdown]
# ## 3. Evidencia externa y límites de la etiqueta
# Los eventos del compañero y el registro oficial se usan como contraste.
# Sus coincidencias y desacuerdos no son etiquetas humanas inventadas.
# La máscara no vegetal de NOAA-20 se congeló antes de 2018-04-16.

# %%
print('Piloto 2013: candidatos enlazados con compañero:',evidence['companion_matched'])
print('Candidatos en eventos iniciados >5 días antes:',evidence['companion_event_over_5d_earlier'])
print('Celdas no vegetales conocidas previamente:',evidence['prior_nonvegetation_cells'])
print('Asociación INDECI:',evidence['registry_associations']['INDECI_shift_0'])
print('Máscara congelada para NOAA-20:',reference['frozen_nonvegetation_mask'])
print('Revisión humana de ignición terminada:',evidence['human_review_complete'])
display(Markdown('**Una coincidencia no demuestra ignición; una ausencia de coincidencia no demuestra un falso incendio.**'))

# %% [markdown]
# ## 4. Meteorología y NRT: preparación frente a disponibilidad real
# La meteorología es una muestra puntual por región y utiliza observaciones
# pasadas, no clima futuro realizado. Los retardos históricos son supuestos
# explícitos: no se reconstruyeron publicaciones ni versiones de reanálisis.
# La ingestión NRT se hizo una vez desde los ZIP; aún no hay refresco automático.

# %%
print('Retardo supuesto de referencia:',protocol['reference_feature_delay_days_assumed'],'días')
print('Retardo meteorológico supuesto tras fin del día:',protocol['weather_release_delay_days_assumed_after_day_end'],'días')
print('Disponibilidad histórica verificada:',data['historical_available_at_verified'])
print('Meteorología:',data['weather_spatial_support'])
print('NRT elegibles:',nrt['eligible_rows'])
print('Última adquisición NRT:',nrt['last_acquisition_utc'])
print('NRT sin campo type:',nrt['type_unavailable_rows'])
print('Transferencia NRT/SP validada:',nrt['NRT_SP_transfer_validated'])
print('Refresco automático configurado:',nrt['automatic_FIRMS_refresh_configured'])

# %% [markdown]
# ## 5. Siguiente punto de revisión: entrenamiento experimental
# Compararemos climatología regional/estacional, un modelo sencillo y LightGBM.
# Ajuste, selección, calibración y evaluación serán separados. Mediremos Brier,
# calibración y precisión/recuperación por anticipación y región.
# Los porcentajes describirán primero episodios detectados: antes de presentarlos
# como riesgo físico de ignición se necesita validación de etiquetas.
# Avance del flujo: 45 % por entregables; la API publicada permanece igual.

# %%
assert not data['public_api_modified']
assert protocol['new_model_trained'] is False
display(Markdown('**Listo para revisar el dataset experimental. Sin entrenamiento ni nueva API publicados.**'))
