"""Carga events y detections a Postgres y crea los índices para consultar región + fechas.

    export DATABASE_URL=postgresql:///fires      # por defecto
    python -m src.firms.load_postgres            # crea tablas, copia datos, índices
    python -m src.firms.load_postgres --dump     # además deja data/fires.dump (pg_dump -Fc)

Índices:
- events.bbox     GiST sobre la caja (box) del evento → "¿qué eventos tocan esta región?"
- events.period   GiST sobre tstzrange [t_start, t_end] → "¿cuáles estaban activos en estas fechas?"
- detections.pt   SP-GiST kd_point_ops: un KD-tree nativo de Postgres sobre (lon, lat)
- detections(event_id), detections(t_utc)
"""
import io
import os
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd
import psycopg

from .config import DATA, OUT

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///fires")

SCHEMA = """
DROP TABLE IF EXISTS detections, events, meta, static_sources CASCADE;

CREATE TABLE static_sources (
    cell bigint PRIMARY KEY,
    lat double precision, lon double precision,
    n_det integer, first timestamptz, last timestamptz,
    years integer, months integer, months_per_year double precision,
    n_type1 integer, n_type2 integer, n_type3 integer,
    frp_median double precision,
    reason text,
    pt point GENERATED ALWAYS AS (point(lon, lat)) STORED
);

CREATE TABLE events (
    event_id      bigint PRIMARY KEY,
    t_start       timestamptz NOT NULL,
    t_end         timestamptz NOT NULL,
    duration_days double precision,
    n_det         integer,
    lat           double precision,
    lon           double precision,
    lat_min double precision, lat_max double precision,
    lon_min double precision, lon_max double precision,
    x_km double precision, y_km double precision,
    frp_total double precision, frp_max double precision,
    n_modis integer, n_viirs integer,
    passes_modis integer, passes_viirs integer,
    frp_modis double precision, frp_viirs double precision,
    satellites    text,
    department    text,
    spread_km     double precision,
    bearing_deg   double precision,
    may_split     boolean,
    may_merge     boolean,
    confidence    text,
    active_days   integer,
    foci_per_day  double precision,
    n_cells_1km   integer,
    reburn_frac   double precision,
    event_type    text,
    bbox   box       GENERATED ALWAYS AS (box(point(lon_min, lat_min), point(lon_max, lat_max))) STORED,
    period tstzrange GENERATED ALWAYS AS (tstzrange(t_start, t_end, '[]')) STORED
);

CREATE TABLE detections (
    det_id     bigint PRIMARY KEY,
    event_id   bigint NOT NULL,
    instrument text, satellite text, processing text, overpass text,
    t_utc      timestamptz NOT NULL,
    date_local date,
    department text,
    lat double precision, lon double precision,
    x_km double precision, y_km double precision,
    scan_km real, track_km real,
    frp real,
    confidence text, daynight char(1), type smallint, version text,
    pt point GENERATED ALWAYS AS (point(lon, lat)) STORED
);

CREATE TABLE meta (key text PRIMARY KEY, value text);
"""

INDEXES = """
CREATE INDEX events_bbox_gist   ON events USING gist (bbox);
CREATE INDEX events_period_gist ON events USING gist (period);
CREATE INDEX events_t_start     ON events (t_start);
CREATE INDEX events_department  ON events (department, t_start);
CREATE INDEX events_type        ON events (event_type, t_start);
CREATE INDEX detections_event   ON detections (event_id);
CREATE INDEX detections_t       ON detections (t_utc);
CREATE INDEX detections_pt_kd   ON detections USING spgist (pt kd_point_ops);
CREATE INDEX static_pt_kd       ON static_sources USING spgist (pt kd_point_ops);
ALTER TABLE detections ADD CONSTRAINT detections_event_fk
    FOREIGN KEY (event_id) REFERENCES events (event_id);
ANALYZE events; ANALYZE detections; ANALYZE static_sources;
"""

EVENT_COLS = ["event_id", "t_start", "t_end", "duration_days", "n_det", "lat", "lon",
              "lat_min", "lat_max", "lon_min", "lon_max", "x_km", "y_km", "frp_total",
              "frp_max", "n_MODIS", "n_VIIRS", "passes_MODIS", "passes_VIIRS", "frp_MODIS",
              "frp_VIIRS", "satellites", "department", "spread_km", "bearing_deg", "may_split", "may_merge",
              "confidence", "active_days", "foci_per_day", "n_cells_1km", "reburn_frac",
              "event_type"]
DET_COLS = ["det_id", "event_id", "instrument", "satellite", "processing", "overpass", "t_utc",
            "date_local", "department", "lat", "lon", "x_km", "y_km", "scan_km", "track_km", "frp",
            "confidence", "daynight", "type", "version"]
STATIC_COLS = ["cell", "lat", "lon", "n_det", "first", "last", "years", "months",
               "months_per_year", "n_type1", "n_type2", "n_type3", "frp_median", "reason"]


def copy_frame(cur, table, df, columns, chunk=500_000):
    """COPY en bloques de CSV: mucho más rápido que INSERT."""
    cols = ", ".join(c.lower() for c in columns)
    for start in range(0, len(df), chunk):
        buf = io.StringIO()
        df.iloc[start:start + chunk][columns].to_csv(buf, index=False, header=False,
                                                     date_format="%Y-%m-%d %H:%M:%S%z")
        buf.seek(0)
        with cur.copy(f"COPY {table} ({cols}) FROM STDIN WITH (FORMAT csv)") as cp:
            while data := buf.read(1 << 20):
                cp.write(data)
        print(f"  {table}: {min(start + chunk, len(df)):,}/{len(df):,}", flush=True)


def load(folder=OUT, url=DATABASE_URL):
    t0 = time.time()
    ev = pd.read_parquet(Path(folder) / "events.parquet")
    det = pd.read_parquet(Path(folder) / "detections.parquet")
    meta = pd.read_parquet(Path(folder) / "meta.parquet")
    static = pd.read_parquet(Path(folder) / "static_sources.parquet")
    det["date_local"] = det["date_local"].dt.date
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA)
        copy_frame(cur, "events", ev, EVENT_COLS)
        copy_frame(cur, "detections", det, DET_COLS)
        copy_frame(cur, "meta", meta, ["key", "value"])
        copy_frame(cur, "static_sources", static, STATIC_COLS)
        print("Creando índices…", flush=True)
        cur.execute(INDEXES)
    print(f"Postgres listo: {len(ev):,} eventos, {len(det):,} detecciones "
          f"({time.time() - t0:.0f} s)", flush=True)


def dump(url=DATABASE_URL, target=DATA / "fires.dump"):
    subprocess.run(["pg_dump", "-Fc", "-d", url, "-f", str(target)], check=True)
    print(f"Copia lista para compartir: {target} ({target.stat().st_size / 1e6:.0f} MB). "
          f"Restaurar con: pg_restore -d fires {target.name}")


if __name__ == "__main__":
    load()
    if "--dump" in sys.argv:
        dump()
