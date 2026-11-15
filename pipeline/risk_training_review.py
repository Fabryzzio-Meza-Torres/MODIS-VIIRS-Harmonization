# %% [markdown]
# # Modelo regional experimental: entrenamiento y evaluación
# LightGBM fue seleccionado en 2022, se ajustó una transformación probabilística
# en 2023 y después se abrieron las evaluaciones. La etiqueta es inicio detectado,
# no ignición física verificada. Esta versión no está publicada en la API.

# %%
from pathlib import Path
import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from IPython.display import display,Markdown,Image

repo=next(p for p in [Path.cwd(),*Path.cwd().parents]
          if (p/'reports/prediction/model/training_evaluation_report.json').exists())
folder=repo/'reports/prediction/model'
load=lambda name:json.loads((folder/name).read_text(encoding='utf-8'))
report=load('training_evaluation_report.json')
protocol=load('training_protocol_frozen.json')
scores=pd.read_csv(folder/'evaluation_metrics.csv')
selected=report['selected']['all_regions']
figures=repo.parent.parent/'outputs/39_modelo_riesgo_regional/figures'
figures.mkdir(parents=True,exist_ok=True)

def show(fig,name):
    fig.tight_layout()
    path=figures/name
    fig.savefig(path,dpi=150)
    plt.close(fig)
    display(Image(filename=str(path)))

print('Modelo seleccionado:',selected)
print('Versión:',report['method_version'])
print('Software:',report['software'])
print('Modelo cambiado tras la prueba:',report['model_selection_from_test'])
print('Ignición física validada:',report['physical_ignition_probability_verified'])

# %% [markdown]
# ## 1. Separación y selección
# Ajuste 2018–2021, selección 2022 y calibración 2023. La prueba 2024–2025 es
# retrospectiva porque el proyecto ya examinó esos años. La confirmación 2026
# se abrió después de congelar el modelo. Ocho candidatos predefinidos, sin
# rebalancear clases; los complejos requieren mejora Brier de al menos 1 %.

# %%
selection=pd.read_csv(folder/'selection_metrics.csv')
display(selection.loc[selection.scope.eq('all_regions'),
                      ['model','macro_lead_brier','average_precision','fit_seconds','best_iteration']])
display(Markdown('**Resultado:** el candidato sin variables de contexto armonizado ganó '
                 'en selección. No añadieron mejora incremental en este experimento; '
                 'esto no reemplaza ni invalida el producto histórico de armonización.'))

# %% [markdown]
# ## 2. Comparación fuera del ajuste
# Brier mide error de probabilidades y menor es mejor. Average precision se
# interpreta frente a la prevalencia alta, no como porcentaje de aciertos.

# %%
comparison=scores.loc[scores.scope.eq('all_regions') &
                     scores.model.isin(['climatology',selected])]
display(comparison[['period','model','positive_fraction','brier','average_precision','ece_10_equal_width']])
wide=comparison.pivot(index='period',columns='model',values='brier').reindex(['2024','2025','confirmation_2026'])
fig,ax=plt.subplots(figsize=(7,3.5))
x=np.arange(len(wide))
ax.bar(x-.18,wide.climatology,.36,label='Climatología calibrada',color='#64748b')
ax.bar(x+.18,wide[selected],.36,label='LightGBM seleccionado',color='#177785')
ax.set_xticks(x,['2024','2025','2026 hasta julio'])
ax.set_ylabel('Brier: menor es mejor')
ax.set_ylim(0,.12)
ax.legend(frameon=False)
ax.spines[['top','right']].set_visible(False)
show(fig,'comparison_brier.png')
print('Comparación por bloques:',report['block_comparisons']['all_regions'])
display(Markdown('**Lectura:** prácticamente empate en 2024, mejora en 2025 y 2026. '
                 'El intervalo de mejora conjunta incluye cero; no se demuestra '
                 'superioridad consistente entre estaciones o años.'))

# %% [markdown]
# ## 3. Calibración: una transformación no garantiza mejora
# La transformación por anticipación se fijó con 2023. La evaluación posterior
# no mejora el Brier ni el ECE conjunto. No se cambia a la variante sin calibrar
# después de mirar el test. Los puntos siguientes no son intervalos de confianza.

# %%
cal=load('calibration_diagnostic.json')
display(pd.DataFrame({'antes':cal['retrospective_before'],'después':cal['retrospective_after']}).loc[
    ['brier','log_loss','ece_10_equal_width','mean_probability','positive_fraction']])
bins=pd.read_csv(folder/'calibration_bins.csv')
fig,ax=plt.subplots(figsize=(5.2,4.2))
ax.plot([0,1],[0,1],linestyle='--',color='#999999',label='Referencia ideal')
for variant,label,color in [('selected_raw','Antes de transformar','#c45c24'),
                            ('selected_calibrated','Después de transformar','#177785')]:
    g=bins.loc[bins.variant.eq(variant)]
    ax.plot(g.mean_probability,g.observed_fraction,'o-',label=label,color=color)
ax.set(xlim=(0,1),ylim=(0,1),xlabel='Probabilidad media',ylabel='Fracción con episodio registrado')
ax.legend(frameon=False,fontsize=8)
show(fig,'calibration.png')
display(bins.loc[bins.variant.eq('selected_calibrated'),
                 ['bin','rows','mean_probability','observed_fraction']])
display(Markdown('Los grupos tienen tamaños distintos: la cercanía visual de '
                 'algunos puntos a la diagonal no sustituye las métricas ponderadas.'))

# %% [markdown]
# ## 4. Plazos comparables y regiones difíciles
# Cada anticipación tiene calendarios distintos por madurez de etiquetas.
# Para comparar horizontes se usan las mismas semanas objetivo. No se interpreta
# una curva descendente como evidencia automática de mejor predicción a 12 semanas.

# %%
matched=pd.read_csv(folder/'matched_target_week_lead_metrics.csv')
fig,axes=plt.subplots(1,2,figsize=(9,3.3))
for period,ax in zip(['2024','2025'],axes):
    g=matched.loc[matched.period.eq(int(period))]
    ax.plot(g.lead_weeks,g.brier,'o-',label='Seleccionado',color='#177785')
    ax.plot(g.lead_weeks,g.climatology_brier,'o-',label='Climatología',color='#64748b')
    ax.set(title=f'{period}: {int(g.common_target_weeks.iloc[0])} semanas comunes',
           xlabel='Semanas de anticipación',ylabel='Brier')
    ax.set_xticks([1,3,6,9,12])
axes[0].legend(frameon=False,fontsize=8)
show(fig,'matched_leads.png')
regions=pd.read_csv(folder/'evaluation_by_region.csv',dtype={'region_id':str})
display(regions.loc[regions.scope.eq('all_regions')].sort_values('brier',ascending=False)[
    ['period','region_id','brier','positive_fraction','mean_probability']].head(10))
display(Markdown('**Lectura:** Moquegua y Tacna aparecen entre los errores mayores. '
                 'Sus casos se conservan y no se escoge otro modelo por región usando el test.'))

# %% [markdown]
# ## 5. Generalización espacial, importancia y robustez
# Los objetivos de cinco departamentos se excluyen del ajuste, selección y
# calibración del modelo sombra. Su historia local sigue disponible como variable.
# Permutar variables mide dependencia predictiva marginal, no causalidad.

# %%
shadow=scores.loc[scores.scope.eq('spatial_shadow') & scores.model.isin(['climatology',selected])]
display(shadow[['period','model','brier','average_precision','ece_10_equal_width']])
importance=pd.read_csv(folder/'permutation_importance_selection.csv').head(10).iloc[::-1]
fig,ax=plt.subplots(figsize=(8,4))
ax.barh(importance.feature,importance.brier_increase_mean,color='#177785')
ax.set_xlabel('Aumento de Brier al permutar: selección 2022')
show(fig,'importance.png')
robust=load('robustness_diagnostic.json')
display(pd.DataFrame(robust['scenarios']))
print('Brier sin perturbación:',robust['baseline']['brier'])
print('Matriz a umbral 0.5, solo diagnóstico:',load('diagnostic_confusion.json'))
display(Markdown('**Lectura:** región y estación dominan la señal. Las perturbaciones '
                 'no prueban transferencia SP/NRT ni definen un umbral operativo.'))

# %% [markdown]
# ## 6. Artefacto utilizable y siguiente revisión
# El modelo se guardó y recargó sin cambiar predicciones a tolerancia 1e-12.
# Falta construir las variables actuales con la misma lógica, generar las
# 300 consultas región/plazo, verificar NRT y publicar la nueva ruta con sus
# metadatos. No se ha cambiado la API pública. La revisión de ignición y un
# piloto prospectivo siguen pendientes; no se asignan pérdidas humanas.

# %%
freeze=load('model_freeze_before_test.json')
assert freeze['test_performance_opened'] is False
assert report['retrospective_test_evaluated'] is True
assert freeze['choices']==report['selected']
assert report['public_api_modified'] is False
print('SHA-256 modelo:',report['model_sha256'])
print('SHA-256 congelamiento previo a prueba:',report['freeze_before_test_sha256'])
print('Paridad de serialización:',report['serialization_prediction_parity_atol'])
display(Markdown('**Avance: 70 % por entregables.** Modelo experimental entrenado, '
                 'transformado y evaluado. Pendientes inferencia NRT, integración y revisión de publicación.'))
