"""Parámetros y rutas comunes del pipeline de eventos de fuego (Perú)."""
from dataclasses import dataclass
from pathlib import Path
import os

REPO = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("FIRES_DATA_DIR", REPO / "data"))
RAW_API = DATA / "raw" / "api"          # bloques de 5 días bajados de la API de FIRMS
STORE = DATA / "store"                  # detecciones en esquema común (parquet por año)
OUT = DATA / "events"                   # tablas finales listas para Postgres
PERU_GEOJSON = Path(__file__).with_name("peru.geojson")
DEPARTMENTS_GEOJSON = Path(__file__).with_name("peru_departments.geojson")  # geoBoundaries ADM1

# Caja que contiene a Perú. La API no acepta consulta por país en SP, así que se baja la
# caja y luego se recorta con el polígono de Perú.
PERU_BBOX = (-81.5, -18.5, -68.5, 0.1)  # lon_min, lat_min, lon_max, lat_max

# Centro de la proyección acimutal de áreas iguales (la misma del notebook 02).
LAT0, LON0 = -9.0, -75.0
EARTH_KM = 6371.0088

INSTRUMENT = {"MODIS": "MODIS", "VIIRS_SNPP": "VIIRS", "VIIRS_NOAA20": "VIIRS",
              "VIIRS_NOAA21": "VIIRS"}

# Periodo: desde que existe VIIRS hasta el último mes con datos SP (estándar) de los cuatro
# satélites. Solo SP: NRT no trae la columna "type" (fuente fija vs vegetación).
VIIRS_START = "2012-01-20"
END_DATE = "2026-07-31"            # incluido

# Qué se baja por API: (fuente SP, inicio, fin). Suomi NPP viene del ZIP de FIRMS.
API_PLAN = {
    "MODIS": ("MODIS_SP", VIIRS_START, END_DATE),
    "VIIRS_NOAA20": ("VIIRS_NOAA20_SP", "2018-04-01", END_DATE),
    "VIIRS_NOAA21": ("VIIRS_NOAA21_SP", "2023-03-01", END_DATE),
}
SNPP_ZIP = Path(os.environ.get(
    "SNPP_ZIP", "/mnt/c/Users/USER/Desktop/NASA/DL_FIRE_SV-C2_848901.zip"))

# Máscara de fuentes fijas (volcanes, gas, industria), en celdas de STATIC_CELL_DEG (~550 m).
# Una celda es fuente fija si FIRMS la marcó alguna vez con type 1, 2 o 3, o si está activa
# muchos meses y casi todo el año (un fuego de vegetación tiene ~1 mes activo por año).
STATIC_CELL_DEG = 0.005
STATIC_MIN_MONTHS = 24
STATIC_MIN_MONTHS_PER_YEAR = 4.0
# Alrededor de las celdas que FIRMS marcó como volcán (type 1) se excluye un radio: el calor del
# cráter cae en píxeles vecinos marcados como type 0 (radio del cráter ~0,7 km + píxel MODIS
# fuera del nadir ~2 km).
VOLCANO_BUFFER_KM = 2.5


@dataclass(frozen=True)
class Params:
    # link_km y link_days calibrados contra GlobFire Perú 2013–2017 (ver README):
    # el par con menor |log frag| + |log merge|, es decir, ni partir ni fundir fuegos.
    link_km: float = 1.25       # distancia máxima para unir detecciones en un evento
    link_days: float = 5.0      # días sin detección tras los que un fuego se da por terminado
    node_km: float = 0.5        # celda de agrupación previa (Andela 2022 usa ~550 m)
    pair_minutes: float = 60.0  # ventana para comparar MODIS con VIIRS
    cell_km: float = 1.0        # celda "tipo MODIS" para degradar VIIRS
    overpass_gap_min: float = 20.0


P = Params()

# Duración del fuego más largo de GlobFire en Perú 2013–2017 (área quemada MODIS). Un evento más
# largo no es "un incendio" en el sentido de GlobFire: se clasifica aparte (events.event_type).
LONG_EVENT_DAYS = 22
# Un evento largo que nunca pasa de este número de celdas de 1 km es un foco recurrente.
RECURRENT_MAX_CELLS = 5
