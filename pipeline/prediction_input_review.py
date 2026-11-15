# %% [markdown]
# # Modelo de incendios: revisión humana 1
# Auditoría de insumos, sin entrenamiento. El objetivo confirmado es pronosticar
# inicio de nuevos incendios por región de Perú y semana futura seleccionada.
# Las celdas de 10 km pueden servir internamente, pero la salida será regional.
# Este notebook presenta artefactos de una auditoría completa ya ejecutada;
# no necesita descargar ni cargar dos millones de filas para volver a revisarlos.

# %%
from pathlib import Path
import json
from IPython.display import display, Markdown

repo = next(p for p in [Path.cwd(), *Path.cwd().parents]
            if (p / 'data/series_metadata.json').is_file())
folder = repo / 'reports/prediction'
audit = json.loads((folder / 'input_audit.json').read_text(encoding='utf-8'))
contract = json.loads((folder / 'contract_proposed.json').read_text(encoding='utf-8'))
assert audit['model_trained'] is False
assert audit['public_api_snapshot_matches']
assert audit['our_snapshot_sha256_verified']
print('Estado:', contract['status'])
print('Commit fuente:', audit['source']['source_commit'])
print('Bytes del respaldo:', audit['source']['bytes'])
print('SHA-256:', audit['source']['sha256'])

# %% [markdown]
# ## 1. Qué datos tenemos
# Se extrajo el contenido COPY del dump con pg_restore en un contenedor sin red,
# sin ejecutar SQL ni restaurar en bases de otros proyectos. Los datos son SP;
# la fuente del compañero aplica filtros distintos a nuestra serie.

# %%
rows = ['| Tabla | Filas |', '| --- | ---: |']
rows += [f"| {name} | {item['rows']:,} |" for name, item in audit['tables'].items()]
display(Markdown('\n'.join(rows)))
print('Inicio:', audit['detections']['time_min'])
print('Fin:', audit['detections']['time_max'])
print('Detecciones por instrumento:', audit['detections']['categories']['instrument'])
print('Malla de nuestra API:', audit['our_series_metadata']['grid_km'], 'km')
print('Cobertura física corregida:', audit['our_series_metadata']['coverage_corrected'])

# %% [markdown]
# ## 2. Integridad no equivale a verdad de terreno
# Estas comprobaciones detectan problemas estructurales. No prueban que cada
# detección sea un incendio independiente ni que cada ausencia sea un día sin fuego.

# %%
checks = ['duplicate_ids', 'invalid_coordinates', 'invalid_timestamps',
          'invalid_or_negative_frp', 'missing_event_references']
for check in checks:
    print(check, audit['detections'][check])
    assert audit['detections'][check] == 0
assert sum(audit['detections']['missing_by_column'].values()) == 0
print('Columnas de detecciones sin faltantes en el respaldo auditado.')
print('Intervalos de eventos inválidos:', audit['events']['invalid_time_intervals'])

# %% [markdown]
# ## 3. Información futura que debemos evitar
# Los eventos se agruparon retrospectivamente. Su duración, centro final,
# clasificación y totales no estaban disponibles al principio del evento.
# La máscara global de fuentes fijas también necesita reconstrucción temporal.

# %%
for number, finding in enumerate(audit['leakage_findings'], 1):
    print(f'{number}. {finding}')
display(Markdown(
    '**Decisión propuesta:** reconstruir variables desde detecciones anteriores '
    'al corte; no usar agregados finales, IDs retrospectivos ni máscaras futuras '
    'como si hubieran estado disponibles en tiempo real.'))

# %% [markdown]
# ## 4. Contrato propuesto y siguiente revisión
# Una fila será región/fecha de emisión/semana objetivo, con etiqueta de al menos
# un inicio nuevo durante esa semana. Un primer registro es un proxy de ignición
# que necesita contraste; los eventos en curso no equivalen a un inicio nuevo.
# El calendario histórico de SP no demuestra
# disponibilidad operativa de NRT; necesitamos registrar esa latencia.
# Las etiquetas y el protocolo de plataformas se congelarán antes del ajuste.

# %%
print('Horizonte:', contract['horizon_days'], 'días')
print('Anticipaciones solicitadas:', contract['forecast_lead_weeks'])
print('Emisión:', contract['issue_frequency'])
print('Candidatos:', ', '.join(contract['candidate_models']))
print('NRT preparado:', contract['NRT_ingestion_ready'])
print('Meteorología preparada:', contract['weather_ingestion_ready'])
print('Probabilidad física de ignición:', contract['physical_ignition_probability'])
display(Markdown(
    f"**Avance: {contract['stages_completed']} de 5 entregables, "
    f"{contract['milestone_progress_percent']} % por hitos.** "
    'No hay métricas predictivas nuevas ni modelo '
    'nuevo publicado. Validaremos periodos temporales y bloques espaciales, '
    'calibración y comparación con climatología antes de conectar el modelo.'))

# %% [markdown]
# ## 5. Piloto de etiquetas causales, solo desarrollo 2013
# Regla candidata: primer episodio detectado tras cinco días sin detección a
# 1,25 km. No es verdad de ignición. Los detalles de los casos requieren revisión
# humana antes de aprobar las etiquetas de entrenamiento.

# %%
pilot_path = folder / 'onset_pilot_report.json'
if pilot_path.is_file():
    pilot = json.loads(pilot_path.read_text(encoding='utf-8'))
    print('Detecciones de desarrollo:', pilot['rows_in_pilot'])
    print('Sensibilidad:', json.dumps(pilot['sensitivity'], indent=2))
    print('Casos de revisión:', pilot['human_review_cases'])
    print('Revisión humana terminada:', pilot['human_review_complete'])
    assert pilot['full_history_static_mask_used'] is False
    assert pilot['physical_ignition_ground_truth'] is False
    assert pilot['model_trained'] is False
    display(Markdown(
        '**Lectura:** el resultado regional de al menos un episodio es frecuente '
        'en este piloto. Necesitamos validar las etiquetas y la calibración por '
        'región; un porcentaje alto por sí solo no demuestra capacidad predictiva.'))
else:
    print('Piloto aún no ejecutado en esta copia del repositorio.')
