"""Une el ZIP de Suomi NPP y los bloques de la API en una sola tabla de detecciones de Perú.

Solo datos SP (estándar), del 20-ene-2012 al 31-jul-2026, recortados al polígono de Perú.

Salidas:
- data/store/detections.parquet: una fila por detección con el esquema común
  (instrument, satellite, t_utc, lat, lon, x_km, y_km, scan_km, track_km, frp, confidence,
  daynight, type, ..., static = cae en una fuente fija).
- data/store/static_sources.parquet: celdas de fuentes fijas (volcanes, gas, industria).

    python -m src.firms.archive
"""
import json
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from scipy.spatial import cKDTree
from shapely.geometry import shape

from .config import (DEPARTMENTS_GEOJSON, EARTH_KM, END_DATE, LAT0, LON0, PERU_GEOJSON,
                     RAW_API, SNPP_ZIP,
                     STATIC_CELL_DEG, STATIC_MIN_MONTHS, STATIC_MIN_MONTHS_PER_YEAR, STORE,
                     VIIRS_START, VOLCANO_BUFFER_KM)

SATELLITE = {"Terra": "Terra", "T": "Terra", "Aqua": "Aqua", "A": "Aqua",
             "N": "SNPP", "SNPP": "SNPP", "1": "NOAA20", "N20": "NOAA20", "NOAA20": "NOAA20",
             "J1": "NOAA20", "2": "NOAA21", "N21": "NOAA21", "NOAA21": "NOAA21", "J2": "NOAA21"}
COLUMNS = ["latitude", "longitude", "scan", "track", "acq_date", "acq_time", "satellite",
           "confidence", "version", "frp", "daynight", "type"]


def laea_km(lat, lon, lat0=LAT0, lon0=LON0):
    """Proyección acimutal de Lambert de áreas iguales (esfera), en km.
    Centrada en Perú: distorsión < 1 % en todo el país."""
    phi, lam = np.radians(lat), np.radians(lon - lon0)
    phi0 = np.radians(lat0)
    k = np.sqrt(2 / (1 + np.sin(phi0) * np.sin(phi) + np.cos(phi0) * np.cos(phi) * np.cos(lam)))
    x = EARTH_KM * k * np.cos(phi) * np.sin(lam)
    y = EARTH_KM * k * (np.cos(phi0) * np.sin(phi) - np.sin(phi0) * np.cos(phi) * np.cos(lam))
    return x, y


def laea_inverse(x, y, lat0=LAT0, lon0=LON0):
    rho = np.hypot(x, y) / EARTH_KM
    c = 2 * np.arcsin(np.clip(rho / 2, -1, 1))
    phi0 = np.radians(lat0)
    with np.errstate(invalid="ignore", divide="ignore"):
        lat = np.arcsin(np.cos(c) * np.sin(phi0)
                        + np.where(rho > 0, y / EARTH_KM * np.sin(c) * np.cos(phi0) / rho, 0))
        lon = lon0 + np.degrees(np.arctan2(x / EARTH_KM * np.sin(c),
                                           rho * np.cos(phi0) * np.cos(c)
                                           - y / EARTH_KM * np.sin(phi0) * np.sin(c)))
    return np.degrees(lat), lon


def peru_polygon():
    geom = json.loads(Path(PERU_GEOJSON).read_text())["features"][0]["geometry"]
    poly = shape(geom)
    shapely.prepare(poly)
    return poly


def departments():
    """Nombres y polígonos de los departamentos (geoBoundaries PER ADM1, dominio público)."""
    feats = json.loads(Path(DEPARTMENTS_GEOJSON).read_text(encoding="utf-8"))["features"]
    names = ["Lima" if f["properties"]["shapeName"] == "Municipalidad Metropolitana de Lima"
             else f["properties"]["shapeName"] for f in feats]
    return names, [shape(f["geometry"]) for f in feats]


def assign_department(lat, lon):
    """Departamento de cada punto (o None si cae fuera de todos, p. ej. en la costa)."""
    names, polys = departments()
    tree = shapely.STRtree(polys)
    pts = shapely.points(np.asarray(lon), np.asarray(lat))
    i_pt, i_poly = tree.query(pts, predicate="within")
    out = np.full(len(pts), None, dtype=object)
    out[i_pt] = np.asarray(names, dtype=object)[i_poly]
    missing = np.flatnonzero(out == None)  # noqa: E711  (puntos en el borde: el más cercano)
    if len(missing):
        out[missing] = np.asarray(names, dtype=object)[tree.nearest(pts[missing])]
    return out


def read_snpp_zip(path=SNPP_ZIP):
    """Solo el archivo estándar (fire_archive_*); el NRT del ZIP se ignora."""
    parts = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not (name.endswith(".csv") and name.startswith("fire_archive")):
                continue
            with z.open(name) as f:
                df = pd.read_csv(f, dtype={"acq_time": str, "version": str, "confidence": str})
            df["processing"] = "NRT" if "nrt" in name else "SP"
            df["source"] = "ZIP:" + name
            parts.append(df)
            print(f"  {name}: {len(df):,} filas", flush=True)
    return pd.concat(parts, ignore_index=True)


def read_api_blocks(root=RAW_API):
    parts = []
    for folder in sorted(Path(root).glob("*_SP")):
        files = sorted(folder.glob("*.csv"))
        frames = [pd.read_csv(f, dtype={"acq_time": str, "version": str, "confidence": str})
                  for f in files]
        frames = [f for f in frames if len(f)]
        if not frames:
            continue
        df = pd.concat(frames, ignore_index=True)
        df["processing"] = "SP"
        df["source"] = "API:" + folder.name
        parts.append(df)
        print(f"  {folder.name}: {len(df):,} filas en {len(files)} bloques", flush=True)
    return pd.concat(parts, ignore_index=True)


def confidence_class(conf, instrument):
    """Confianza de ambos sensores en tres clases: low, nominal, high."""
    viirs = conf.str.lower().map({"l": "low", "n": "nominal", "h": "high"})
    score = pd.to_numeric(conf, errors="coerce")
    modis = pd.cut(score, [0, 30, 80, 101], right=False,
                   labels=["low", "nominal", "high"]).astype(object)
    return viirs.where(instrument == "VIIRS", modis)


def to_common(raw):
    sat = raw["satellite"].astype(str).map(SATELLITE)
    unknown = raw.loc[sat.isna(), "satellite"].unique()
    if len(unknown):
        raise ValueError(f"Valores de 'satellite' sin mapear: {unknown[:10]}")
    instrument = np.where(sat.isin(["Terra", "Aqua"]), "MODIS", "VIIRS")
    instrument = pd.Series(instrument, index=raw.index)
    hhmm = raw["acq_time"].astype(str).str.zfill(4)
    t = pd.to_datetime(raw["acq_date"] + " " + hhmm, format="%Y-%m-%d %H%M", utc=True)
    df = pd.DataFrame({
        "instrument": instrument,
        "satellite": sat,
        "processing": raw["processing"],
        "t_utc": t,
        "lat": raw["latitude"].astype(float),
        "lon": raw["longitude"].astype(float),
        "scan_km": raw["scan"].astype(float),
        "track_km": raw["track"].astype(float),
        "frp": raw["frp"].astype(float),
        "confidence": confidence_class(raw["confidence"].astype(str), instrument),
        "daynight": raw["daynight"],
        "type": pd.to_numeric(raw["type"], errors="raise").astype("int8"),
        "version": raw["version"].astype(str),
        "source": raw["source"],
    })
    return df


def add_geometry(df):
    x, y = laea_km(df["lat"].to_numpy(), df["lon"].to_numpy())
    return df.assign(
        x_km=x, y_km=y,
        pixel_km2=df["scan_km"] * df["track_km"],
        date_local=(df["t_utc"] + pd.to_timedelta(df["lon"] / 15, unit="h")).dt.tz_localize(None)
        .dt.normalize(),
    )


def static_cell(lat, lon):
    """Celda de ~550 m usada por la máscara de fuentes fijas."""
    return ((np.round(np.asarray(lat) / STATIC_CELL_DEG).astype(np.int64) * 1_000_000)
            + np.round(np.asarray(lon) / STATIC_CELL_DEG).astype(np.int64))


def static_sources(df, all_cells=False):
    """Celdas que son fuentes fijas (volcán, gas, industria) y no fuego de vegetación.

    Regla 1: FIRMS marcó la celda alguna vez con type 1 (volcán), 2 (fuente fija) o 3 (mar).
    Regla 2: activa en ≥ STATIC_MIN_MONTHS meses y ≥ STATIC_MIN_MONTHS_PER_YEAR meses por año
             activo. Una celda de vegetación tiene mediana de 1 mes por año (temporada)."""
    d = df.assign(year=df["t_utc"].dt.year, month=df["t_utc"].dt.strftime("%Y-%m"))
    g = d.groupby("cell").agg(
        lat=("lat", "mean"), lon=("lon", "mean"), n_det=("lat", "size"),
        first=("t_utc", "min"), last=("t_utc", "max"),
        years=("year", "nunique"), months=("month", "nunique"),
        n_type1=("type", lambda s: int((s == 1).sum())),
        n_type2=("type", lambda s: int((s == 2).sum())),
        n_type3=("type", lambda s: int((s == 3).sum())),
        frp_median=("frp", "median"))
    g["months_per_year"] = g["months"] / g["years"]
    typed = (g["n_type1"] + g["n_type2"] + g["n_type3"]) > 0
    persistent = (g["months"] >= STATIC_MIN_MONTHS) & \
                 (g["months_per_year"] >= STATIC_MIN_MONTHS_PER_YEAR)
    g["reason"] = np.select(
        [g["n_type1"] > 0, g["n_type3"] > 0, g["n_type2"] > 0, persistent],
        ["volcán (FIRMS type 1)", "mar (FIRMS type 3)", "fuente fija (FIRMS type 2)",
         "persistente (activa casi todo el año)"], default="")
    return (g if all_cells else g[typed | persistent]).reset_index()


def build(snpp_zip=SNPP_ZIP, out=STORE):
    t0 = time.time()
    print("Leyendo ZIP de Suomi NPP (solo SP)", flush=True)
    raw = [read_snpp_zip(snpp_zip)]
    print("Leyendo bloques SP de la API", flush=True)
    raw.append(read_api_blocks())
    df = to_common(pd.concat(raw, ignore_index=True))
    end = pd.Timestamp(END_DATE, tz="UTC") + pd.Timedelta(days=1)
    df = df[(df["t_utc"] >= pd.Timestamp(VIIRS_START, tz="UTC")) & (df["t_utc"] < end)]
    n0 = len(df)
    inside = shapely.contains_xy(peru_polygon(), df["lon"].to_numpy(), df["lat"].to_numpy())
    df = df[inside].drop_duplicates(["satellite", "t_utc", "lat", "lon"])
    df = add_geometry(df).sort_values("t_utc", ignore_index=True)
    df.insert(0, "det_id", np.arange(len(df), dtype=np.int64))
    df["department"] = assign_department(df["lat"], df["lon"])
    df["cell"] = static_cell(df["lat"], df["lon"])
    static = static_sources(df)
    df["static"] = df["cell"].isin(static["cell"])
    # Radio de exclusión alrededor de los volcanes.
    volc = static[static["n_type1"] > 0]
    vx, vy = laea_km(volc["lat"].to_numpy(), volc["lon"].to_numpy())
    near = cKDTree(np.c_[vx, vy]).query(df[["x_km", "y_km"]].to_numpy(),
                                        distance_upper_bound=VOLCANO_BUFFER_KM)[0]
    extra = np.isfinite(near) & ~df["static"].to_numpy()
    if extra.any():
        ring = static_sources(df[df["cell"].isin(df.loc[extra, "cell"])]
                              .assign(type=np.int8(0)), all_cells=True)
        ring["reason"] = f"a ≤ {VOLCANO_BUFFER_KM} km de un volcán"
        static = pd.concat([static, ring], ignore_index=True)
        df["static"] = df["cell"].isin(static["cell"])
    Path(out).mkdir(parents=True, exist_ok=True)
    df.to_parquet(Path(out) / "detections.parquet", index=False)
    static.to_parquet(Path(out) / "static_sources.parquet", index=False)
    print(f"{n0:,} detecciones SP en la caja → {len(df):,} dentro de Perú "
          f"({df['t_utc'].min():%Y-%m-%d} a {df['t_utc'].max():%Y-%m-%d}, "
          f"{time.time() - t0:.0f} s)", flush=True)
    print(df.groupby(["satellite", "type"]).size().unstack(fill_value=0).to_string(), flush=True)
    print(f"Fuentes fijas: {len(static):,} celdas, {int(df['static'].sum()):,} detecciones\n"
          + static["reason"].value_counts().to_string(), flush=True)
    return df


if __name__ == "__main__":
    build()
