"""API de eventos de fuego de Perú (FastAPI + Postgres + índice espacio-tiempo).

    export DATABASE_URL=postgresql:///fires
    export INDEX_BACKEND=auto          # auto | kdtree | cuda
    uvicorn src.api.main:app --reload --port 8000

Documentación interactiva en http://localhost:8000/docs
"""
import json
import os
import threading
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from ..firms.config import PERU_BBOX, REPO
from ..firms.index import SpaceTimeIndex

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///fires")
INDEX_BACKEND = os.environ.get("INDEX_BACKEND", "auto")
REGIONS_JSON = REPO / "config" / "api_links.json"

EVENT_FIELDS = """event_id, t_start, t_end, duration_days, lat, lon,
    lat_min, lat_max, lon_min, lon_max, n_det, n_modis, n_viirs, passes_modis, passes_viirs,
    frp_total, frp_max, frp_modis, frp_viirs, satellites, department, spread_km, bearing_deg,
    may_split, may_merge, confidence, event_type, active_days, foci_per_day, n_cells_1km,
    reburn_frac"""
EVENT_TYPES = ["foco_aislado", "incendio", "incendio_prolongado", "quema_persistente",
               "foco_recurrente"]
CONFIDENCE_LEVELS = {"baja": ["baja", "media", "alta"], "media": ["media", "alta"],
                     "alta": ["alta"]}

state = {}


def load_regions():
    try:
        regs = json.loads(REGIONS_JSON.read_text(encoding="utf-8"))["regiones"]
    except Exception:
        regs = {}
    out = {"peru": PERU_BBOX}
    for name, r in regs.items():
        if r.get("tipo") != "pais":
            out[name] = tuple(float(v) for v in r["area"].split(","))
    return out


def build_index():
    with state["pool"].connection() as conn:
        state["index"] = SpaceTimeIndex.from_postgres(conn, backend=INDEX_BACKEND)


@asynccontextmanager
async def lifespan(app):
    # Todas las horas de la API salen en UTC, como en FIRMS.
    state["pool"] = ConnectionPool(DATABASE_URL, min_size=1, max_size=8, open=True,
                                   kwargs={"options": "-c TimeZone=UTC"})
    state["regions"] = load_regions()
    state["departments"] = [r["department"] for r in sql(
        "SELECT DISTINCT department FROM events WHERE department IS NOT NULL ORDER BY 1")]
    state["index_lock"] = threading.Lock()
    build_index()
    yield
    state["pool"].close()


app = FastAPI(title="Eventos de fuego Perú · MODIS + VIIRS", version="0.1.0",
              lifespan=lifespan)


def sql(query, params=()):
    with state["pool"].connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params)
        return cur.fetchall()


def resolve_bbox(bbox: Optional[str], region: Optional[str]):
    if region:
        if region not in state["regions"]:
            raise HTTPException(404, f"Región desconocida. Usa una de: {list(state['regions'])}")
        return state["regions"][region]
    if not bbox:
        raise HTTPException(422, "Indica bbox=lon_min,lat_min,lon_max,lat_max o region=<nombre>")
    try:
        lon_min, lat_min, lon_max, lat_max = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox debe ser lon_min,lat_min,lon_max,lat_max")
    if lon_min > lon_max or lat_min > lat_max:
        raise HTTPException(422, "bbox: el mínimo debe ser menor que el máximo")
    return lon_min, lat_min, lon_max, lat_max


def day_after(d: date):
    """Límite superior exclusivo: el día siguiente a las 00:00 UTC."""
    return datetime.combine(d, datetime.min.time()) + timedelta(days=1)


def as_geojson(rows):
    feats = [{"type": "Feature",
              "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
              "properties": {k: v for k, v in r.items() if k not in ("lat", "lon")}}
             for r in rows]
    return {"type": "FeatureCollection", "features": feats}


def events_by_ids(ids, extra=None, order=None):
    if not ids:
        return []
    rows = sql(f"SELECT {EVENT_FIELDS} FROM events WHERE event_id = ANY(%s)", (list(ids),))
    if extra is not None:
        for r in rows:
            r.update(extra.get(r["event_id"], {}))
    if order:
        pos = {e: i for i, e in enumerate(order)}
        rows.sort(key=lambda r: pos[r["event_id"]])
    return rows


# ---------------------------------------------------------------------------- endpoints
@app.get("/health")
def health():
    n = sql("SELECT (SELECT count(*) FROM events) AS events, "
            "(SELECT count(*) FROM detections) AS detections")[0]
    return {"status": "ok", **n, "index": state["index"].info()}


@app.get("/meta")
def meta():
    rows = sql("SELECT key, value FROM meta ORDER BY key")
    return {r["key"]: r["value"] for r in rows}


@app.get("/regions")
def regions():
    return {k: {"bbox": list(v)} for k, v in state["regions"].items()}


@app.get("/departments")
def departments_list():
    """Departamentos con eventos (para el parámetro department de /events)."""
    return {"departments": state["departments"]}


TYPE_HELP = {
    "foco_aislado": "dura menos de un día y ocupa 1–2 km²",
    "incendio": "hasta 22 días (el fuego más largo de GlobFire en Perú)",
    "incendio_prolongado": "más de 22 días con un solo foco por día que sigue activo",
    "quema_persistente": "más de 22 días con varios focos a la vez: zona de quemas (desmonte o "
                         "quema agrícola)",
    "foco_recurrente": "más de 22 días siempre en ≤ 5 km²: posible fuente fija no enmascarada",
}


@app.get("/event-types")
def event_types():
    """Tipos de evento, qué significan y cuántos hay."""
    counts = {r["event_type"]: r for r in sql(
        """SELECT event_type, count(*) AS events, sum(n_det) AS detections,
                  max(duration_days) AS max_duration_days
           FROM events GROUP BY event_type""")}
    return [{"event_type": t, "description": TYPE_HELP[t],
             **{k: v for k, v in counts.get(t, {}).items() if k != "event_type"}}
            for t in EVENT_TYPES]


@app.get("/static-sources")
def static_sources(bbox: Optional[str] = Query(None, examples=["-81.5,-18.5,-68.5,0.1"]),
                   region: Optional[str] = None,
                   format: Literal["json", "geojson"] = "json"):
    """Celdas excluidas por ser fuentes fijas (volcanes, gas, industria), no fuego de vegetación."""
    lon_min, lat_min, lon_max, lat_max = resolve_bbox(bbox, region) if (bbox or region) \
        else PERU_BBOX
    rows = sql("""SELECT cell, lat, lon, reason, n_det, years, months, months_per_year,
                         n_type1, n_type2, n_type3, frp_median, first, last
                  FROM static_sources WHERE pt <@ box(point(%s,%s), point(%s,%s))
                  ORDER BY n_det DESC""", (lon_min, lat_min, lon_max, lat_max))
    if format == "geojson":
        return as_geojson(rows)
    return {"count": len(rows), "static_sources": rows}


@app.get("/events")
def events(
    start: date = Query(..., description="Fecha inicial (UTC), incluida", examples=["2024-09-01"]),
    end: date = Query(..., description="Fecha final (UTC), incluida", examples=["2024-09-30"]),
    bbox: Optional[str] = Query(None, description="lon_min,lat_min,lon_max,lat_max",
                                examples=["-75.7,-11.5,-70.4,-7.2"]),
    region: Optional[str] = Query(None, description="Nombre de /regions, p. ej. ucayali"),
    department: Optional[str] = Query(None, description="Departamento, p. ej. Ucayali "
                                      "(ver /departments). Se puede combinar con bbox."),
    min_confidence: Literal["baja", "media", "alta"] = "baja",
    min_det: int = Query(1, ge=1, description="Mínimo de detecciones del evento"),
    event_type: Optional[str] = Query(
        None, description="Uno o varios tipos separados por coma: foco_aislado, incendio, "
                          "incendio_prolongado, quema_persistente, foco_recurrente"),
    engine: Literal["postgres", "index"] = Query(
        "postgres", description="postgres: índices GiST; index: KD-tree/GPU en memoria"),
    format: Literal["json", "geojson"] = "json",
    limit: int = Query(1000, ge=1, le=50000),
    offset: int = Query(0, ge=0),
):
    """Eventos activos en la región y el rango de fechas, con su centro (lat, lon) y su caja."""
    if department and not (bbox or region):
        lon_min, lat_min, lon_max, lat_max = PERU_BBOX
    else:
        lon_min, lat_min, lon_max, lat_max = resolve_bbox(bbox, region)
    if department and department not in state["departments"]:
        raise HTTPException(404, f"Departamento desconocido. Usa uno de: {state['departments']}")
    types = [t.strip() for t in event_type.split(",")] if event_type else EVENT_TYPES
    if set(types) - set(EVENT_TYPES):
        raise HTTPException(422, f"event_type debe ser uno de {EVENT_TYPES}")
    t0 = datetime.combine(start, datetime.min.time())
    t1 = datetime.combine(end, datetime.min.time()).replace(hour=23, minute=59, second=59)
    levels = CONFIDENCE_LEVELS[min_confidence]
    if engine == "postgres":
        where = """bbox && box(point(%s,%s), point(%s,%s))
                   AND period && tstzrange(%s::timestamp AT TIME ZONE 'UTC',
                                           %s::timestamp AT TIME ZONE 'UTC', '[]')
                   AND confidence = ANY(%s) AND n_det >= %s
                   AND (%s::text IS NULL OR department = %s::text)
                   AND event_type = ANY(%s)"""
        args = (lon_min, lat_min, lon_max, lat_max, t0, t1, levels, min_det, department,
                department, types)
        total = sql(f"SELECT count(*) AS n FROM events WHERE {where}", args)[0]["n"]
        rows = sql(f"""SELECT {EVENT_FIELDS} FROM events WHERE {where}
                       ORDER BY t_start, event_id LIMIT %s OFFSET %s""",
                   args + (limit, offset))
    else:
        # El índice encuentra los eventos con al menos una detección dentro de la región y las
        # fechas (más estricto que cruzar cajas). Luego Postgres trae las fichas.
        hits = state["index"].box(lon_min, lat_min, lon_max, lat_max, t0, day_after(end))
        rows = events_by_ids(hits["event_id"].tolist(),
                             extra={e: {"hits": int(h)} for e, h in
                                    zip(hits["event_id"], hits["hits"])})
        rows = [r for r in rows if r["confidence"] in levels and r["n_det"] >= min_det
                and (department is None or r["department"] == department)
                and r["event_type"] in types]
        rows.sort(key=lambda r: (r["t_start"], r["event_id"]))
        total = len(rows)
        rows = rows[offset:offset + limit]
    if format == "geojson":
        return {**as_geojson(rows), "total": total}
    return {"total": total, "count": len(rows), "offset": offset,
            "query": {"bbox": [lon_min, lat_min, lon_max, lat_max], "department": department,
                      "event_type": types, "start": start, "end": end, "engine": engine},
            "events": rows}


@app.get("/events/near")
def events_near(lat: float, lon: float, start: date, end: date,
                radius_km: float = Query(10, gt=0, le=500), limit: int = 500):
    """Eventos con detecciones a ≤ radius_km del punto en el rango de fechas (KD-tree)."""
    hits = state["index"].near(lat, lon, radius_km, start, day_after(end)).nlargest(limit, "hits")
    rows = events_by_ids(hits["event_id"].tolist(),
                         extra={e: {"hits": int(h)} for e, h in
                                zip(hits["event_id"], hits["hits"])})
    rows.sort(key=lambda r: r["t_start"])
    return {"count": len(rows), "events": rows}


@app.get("/events/nearest")
def events_nearest(lat: float, lon: float, t: datetime, k: int = Query(10, ge=1, le=200)):
    """Los k eventos más cercanos en espacio-tiempo (1 día equivale a km_per_day km)."""
    near = state["index"].nearest(lat, lon, t, k)
    rows = events_by_ids(near["event_id"].tolist(),
                         extra={e: {"distance_km": float(d)} for e, d in
                                zip(near["event_id"], near["distance_km"])},
                         order=near["event_id"].tolist())
    return {"count": len(rows), "km_per_day": state["index"].km_per_day, "events": rows}


@app.get("/events/{event_id}")
def event(event_id: int):
    rows = events_by_ids([event_id])
    if not rows:
        raise HTTPException(404, "Evento no encontrado")
    return rows[0]


@app.get("/events/{event_id}/detections")
def event_detections(event_id: int, format: Literal["json", "geojson"] = "json"):
    """Cada detección del evento: dónde, cuándo, qué satélite y su FRP."""
    rows = sql("""SELECT det_id, t_utc, lat, lon, instrument, satellite, processing, overpass,
                         frp, scan_km, track_km, confidence, daynight
                  FROM detections WHERE event_id = %s ORDER BY t_utc""", (event_id,))
    if not rows:
        raise HTTPException(404, "Evento no encontrado")
    if format == "geojson":
        return as_geojson(rows)
    return {"event_id": event_id, "count": len(rows), "detections": rows}


@app.get("/index")
def index_info():
    return state["index"].info()


@app.post("/index/rebuild")
def index_rebuild(backend: Optional[Literal["auto", "kdtree", "cuda"]] = None):
    """Vuelve a leer las detecciones de Postgres y reconstruye el índice."""
    global INDEX_BACKEND
    with state["index_lock"]:
        if backend:
            INDEX_BACKEND = backend
        build_index()
    return state["index"].info()
