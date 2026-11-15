"""Agrupa las detecciones de Perú en eventos de fuego (mismo método que data_manager.ipynb).

Dos detecciones son del mismo evento si están a ≤ link_km y ≤ link_days. Se calcula de una
sola vez para todo 2012–2026 (no por años), así no hay que coser eventos entre años.

Entrada: data/store/detections.parquet
Salida:  data/events/events.parquet y data/events/detections.parquet

    python -m src.firms.events                      # parámetros de config.Params
    python -m src.firms.events --link-km 1.0 --link-days 5
"""
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from .config import LONG_EVENT_DAYS, OUT, P, Params, RECURRENT_MAX_CELLS, STORE

INSTRUMENTS = ["MODIS", "VIIRS"]
# Constelación que observa todo el periodo: arma el esqueleto de los eventos.
BACKBONE = ("SNPP", "Aqua", "Terra")


def quality_filter(df):
    """Solo vegetación: type 0, fuera de las celdas de fuentes fijas y sin confianza baja."""
    keep = (df["type"] == 0) & ~df["static"] & (df["confidence"] != "low")
    return df[keep].reset_index(drop=True)


def assign_overpass(df, gap_min=P.overpass_gap_min):
    """Pasada = detecciones seguidas del mismo satélite sin huecos > gap_min minutos."""
    df = df.sort_values(["satellite", "t_utc"])
    jump = df.groupby("satellite")["t_utc"].diff() > pd.Timedelta(minutes=gap_min)
    number = jump.groupby(df["satellite"]).cumsum()
    df = df.assign(overpass=df["satellite"] + "#" + number.astype(str))
    return df.sort_values("t_utc", ignore_index=True)


def space_time_nodes(df, p):
    day = (df["t_utc"] - df["t_utc"].min()).dt.total_seconds() // 86400
    keys = np.c_[df["x_km"] // p.node_km, df["y_km"] // p.node_km, day]
    return np.unique(keys, axis=0, return_inverse=True)


def link_nodes(nodes, p):
    points = nodes * [p.node_km, p.node_km, p.link_km / p.link_days]
    pairs = cKDTree(points).query_pairs(p.link_km, p=np.inf, output_type="ndarray")
    delta = points[pairs[:, 0], :2] - points[pairs[:, 1], :2]
    return pairs[np.hypot(delta[:, 0], delta[:, 1]) <= p.link_km]


def link_all(df, p=P):
    """Componentes conexas con todas las detecciones como posibles puentes."""
    nodes, node_of = space_time_nodes(df, p)
    pairs = link_nodes(nodes, p)
    graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(nodes),) * 2)
    labels = connected_components(graph, directed=False)[1]
    return labels[np.ravel(node_of)]


def build_events(df, p=P, backbone=BACKBONE):
    """Asigna a cada detección un evento con una constelación fija como esqueleto.

    1. El grafo de eventos se arma solo con los satélites de `backbone` (Suomi NPP + MODIS), que
       observan todo el periodo 2012–2026. Así la cantidad de puentes entre quemas vecinas no
       crece cuando se suman satélites (NOAA-20 en 2018, NOAA-21 en 2023).
    2. Cada detección de otro satélite se cuelga del evento de la detección del esqueleto más
       cercana a ≤ link_km y ≤ link_days. Aporta datos al evento pero no une eventos.
    3. Las que no tienen esqueleto cerca (fuegos que SNPP y MODIS no vieron) forman sus propios
       eventos entre ellas, con la misma regla."""
    df = df.reset_index(drop=True)
    is_bb = df["satellite"].isin(backbone).to_numpy()
    labels = np.full(len(df), -1, dtype=np.int64)
    bb = df[is_bb]
    if len(bb):
        labels[is_bb] = link_all(bb, p)
    rest = np.flatnonzero(~is_bb)
    if len(rest) and len(bb):
        scale = p.link_km / p.link_days
        t0 = df["t_utc"].min()
        days = ((df["t_utc"] - t0).dt.total_seconds() / 86400).to_numpy()
        pts = np.c_[df["x_km"].to_numpy(), df["y_km"].to_numpy(), days * scale]
        tree = cKDTree(pts[is_bb])
        dist, j = tree.query(pts[rest], k=1, p=np.inf, distance_upper_bound=p.link_km)
        ok = np.isfinite(dist)
        bb_idx = np.flatnonzero(is_bb)
        near = bb_idx[j[ok]]
        horiz = np.hypot(pts[rest[ok], 0] - pts[near, 0], pts[rest[ok], 1] - pts[near, 1])
        good = np.zeros(len(rest), dtype=bool)
        good[np.flatnonzero(ok)[horiz <= p.link_km]] = True
        labels[rest[good]] = labels[bb_idx[j[good]]]
    orphans = np.flatnonzero(labels < 0)
    if len(orphans):
        labels[orphans] = link_all(df.iloc[orphans], p) + labels.max() + 1
    return df.assign(event=labels)


def renumber_by_start(df):
    """event_id 1, 2, 3… en orden de inicio: ids legibles y estables para el mismo insumo."""
    first = df.groupby("event")["t_utc"].min().sort_values(kind="stable")
    new_id = pd.Series(np.arange(1, len(first) + 1), index=first.index)
    return df.assign(event_id=df["event"].map(new_id).astype(np.int64)).drop(columns="event")


def by_instrument(table, prefix):
    return table.reindex(columns=INSTRUMENTS, fill_value=0).add_prefix(prefix)


def event_table(df):
    g = df.groupby("event_id")
    ev = g.agg(t_start=("t_utc", "min"), t_end=("t_utc", "max"), n_det=("frp", "size"),
               lat=("lat", "mean"), lon=("lon", "mean"),
               lat_min=("lat", "min"), lat_max=("lat", "max"),
               lon_min=("lon", "min"), lon_max=("lon", "max"),
               x_km=("x_km", "mean"), y_km=("y_km", "mean"),
               frp_total=("frp", "sum"), frp_max=("frp", "max"))
    ev["duration_days"] = (ev["t_end"] - ev["t_start"]).dt.total_seconds() / 86400
    counts = pd.crosstab(df["event_id"], df["instrument"])
    passes = df.groupby(["event_id", "instrument"])["overpass"].nunique().unstack(fill_value=0)
    frp = df.pivot_table(index="event_id", columns="instrument", values="frp", aggfunc="sum",
                         fill_value=0)
    sats = df.groupby("event_id")["satellite"].agg(lambda s: ",".join(sorted(s.unique())))
    # Departamento con más detecciones del evento.
    dep = df.groupby(["event_id", "department"]).size().reset_index(name="n") \
            .sort_values(["event_id", "n"], ascending=[True, False]) \
            .drop_duplicates("event_id").set_index("event_id")["department"]
    return ev.join([by_instrument(counts, "n_"), by_instrument(passes, "passes_"),
                    by_instrument(frp, "frp_")]).assign(satellites=sats, department=dep)


def event_spread(df):
    daily = df.groupby(["event_id", "date_local"])[["x_km", "y_km"]].mean()
    first, last = daily.groupby("event_id").first(), daily.groupby("event_id").last()
    dx, dy = last["x_km"] - first["x_km"], last["y_km"] - first["y_km"]
    return pd.DataFrame({"spread_km": np.hypot(dx, dy),
                         "bearing_deg": np.degrees(np.arctan2(dx, dy)) % 360})


def event_stability(df, p=P, factor=1.5):
    """¿El evento se parte con link_km/1.5 o se une a otro con link_km·1.5?"""
    small = build_events(df, Params(**{**p.__dict__, "link_km": p.link_km / factor}))["event"]
    large = build_events(df, Params(**{**p.__dict__, "link_km": p.link_km * factor}))["event"]
    pieces = small.groupby(df["event_id"]).nunique()
    partners = df["event_id"].groupby(large).nunique()
    merged = large.groupby(df["event_id"]).first().map(partners)
    return pd.DataFrame({"may_split": pieces > 1, "may_merge": merged > 1})


def event_pattern(df, p=P):
    """Cómo quemó cada evento: días con fuego, celdas de 1 km, focos separados por día y
    cuántas celdas volvieron a quemar en otra semana."""
    # Focos separados el mismo día: componentes a ≤ link_km entre detecciones del mismo día UTC
    # (link_days casi cero hace que el eje del tiempo separe días distintos). Se cuentan con el
    # esqueleto (Suomi NPP + MODIS) para que no aumenten al sumarse satélites; los eventos que el
    # esqueleto no vio usan todas sus detecciones.
    day = (df["t_utc"] - df["t_utc"].min()).dt.total_seconds() // 86400
    same_day = Params(**{**p.__dict__, "link_days": 1e-3})

    def foci_of(part):
        focus = link_all(part, same_day)
        return pd.DataFrame({"event_id": part["event_id"].to_numpy(),
                             "day": day[part.index].to_numpy(), "focus": focus}) \
            .groupby(["event_id", "day"])["focus"].nunique()

    is_bb = df["satellite"].isin(BACKBONE)
    foci_bb = foci_of(df[is_bb])
    missing = ~df["event_id"].isin(foci_bb.index.get_level_values(0))
    foci = pd.concat([foci_bb, foci_of(df[missing])]) if missing.any() else foci_bb
    cell = (df["x_km"] // 1).astype(np.int64) * 100_000 + (df["y_km"] // 1).astype(np.int64)
    week = day // 7
    cells = pd.DataFrame({"event_id": df["event_id"], "cell": cell, "week": week})
    weeks_per_cell = cells.groupby(["event_id", "cell"])["week"].nunique()
    return pd.DataFrame({
        "active_days": day.groupby(df["event_id"]).nunique(),
        "foci_per_day": foci.groupby("event_id").median(),
        "n_cells_1km": weeks_per_cell.groupby("event_id").size(),
        "reburn_frac": (weeks_per_cell >= 2).groupby("event_id").mean(),
    })


def event_type(ev, long_days=LONG_EVENT_DAYS, few_cells=RECURRENT_MAX_CELLS):
    """Tipo de evento según su patrón (regla propia; ver README).

    Eventos de hasta `long_days` (el fuego más largo de GlobFire en Perú):
    - foco_aislado: dura menos de un día y ocupa una o dos celdas de 1 km.
    - incendio: el resto.
    Eventos más largos que cualquier fuego GlobFire:
    - foco_recurrente: siempre en las mismas pocas celdas (≤ `few_cells` km²). Un incendio no
      quema el mismo puñado de km² durante semanas; suele ser una fuente fija que la máscara no
      atrapó (botadero, ladrillera, ingenio) o una quema repetida en la misma parcela.
    - quema_persistente: varios focos separados al mismo tiempo (mediana ≥ 2 por día): muchas
      quemas en una zona durante semanas, típico de frentes de desmonte o quema agrícola.
    - incendio_prolongado: un solo foco por día que sigue activo y se mueve."""
    small = (ev["duration_days"] < 1) & (ev["n_cells_1km"] <= 2)
    long = ev["duration_days"] > long_days
    return pd.Series(np.select(
        [long & (ev["n_cells_1km"] <= few_cells), long & (ev["foci_per_day"] >= 2), long, small],
        ["foco_recurrente", "quema_persistente", "incendio_prolongado", "foco_aislado"],
        default="incendio"), index=ev.index)


def event_confidence(ev):
    score = ((ev["n_MODIS"] > 0) & (ev["n_VIIRS"] > 0)).astype(int) \
        + (ev["passes_VIIRS"] + ev["passes_MODIS"] >= 2).astype(int) \
        + (ev["n_det"] >= 5).astype(int)
    return score.map({0: "baja", 1: "baja", 2: "media", 3: "alta"})


def run(store=STORE, out=OUT, p=P):
    t0 = time.time()
    det = pd.read_parquet(Path(store) / "detections.parquet")
    print(f"{len(det):,} detecciones", flush=True)
    det = assign_overpass(quality_filter(det), p.overpass_gap_min)
    print(f"{len(det):,} tras el filtro de calidad", flush=True)
    det = renumber_by_start(build_events(det, p))
    print(f"{det['event_id'].nunique():,} eventos ({time.time() - t0:.0f} s)", flush=True)
    ev = event_table(det).join([event_spread(det), event_stability(det, p),
                                event_pattern(det, p)])
    ev = ev.assign(confidence=event_confidence(ev), event_type=event_type(ev)).reset_index()
    Path(out).mkdir(parents=True, exist_ok=True)
    ev.to_parquet(Path(out) / "events.parquet", index=False)
    keep = ["det_id", "event_id", "instrument", "satellite", "processing", "overpass", "t_utc",
            "date_local", "department", "lat", "lon", "x_km", "y_km", "scan_km", "track_km", "frp",
            "confidence", "daynight", "type", "version"]
    det[keep].to_parquet(Path(out) / "detections.parquet", index=False)
    static = pd.read_parquet(Path(store) / "static_sources.parquet")
    static.to_parquet(Path(out) / "static_sources.parquet", index=False)
    pd.Series({"link_km": p.link_km, "link_days": p.link_days, "node_km": p.node_km,
               "processing": "SP", "n_events": len(ev), "n_detections": len(det),
               "n_static_cells": len(static),
               "t_min": str(det["t_utc"].min()), "t_max": str(det["t_utc"].max()),
               "built_at": pd.Timestamp.now("UTC").isoformat()}).astype(str) \
        .rename_axis("key").rename("value").reset_index() \
        .to_parquet(Path(out) / "meta.parquet", index=False)
    print(f"Listo en {time.time() - t0:.0f} s → {out}", flush=True)
    print(ev["confidence"].value_counts().to_string(), flush=True)
    print(ev["event_type"].value_counts().to_string(), flush=True)
    return det, ev


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--link-km", type=float, default=P.link_km)
    ap.add_argument("--link-days", type=float, default=P.link_days)
    args = ap.parse_args()
    run(p=Params(**{**P.__dict__, "link_km": args.link_km, "link_days": args.link_days}))
