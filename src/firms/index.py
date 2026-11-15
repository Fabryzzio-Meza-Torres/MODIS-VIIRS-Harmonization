"""Índice espacio-tiempo en memoria, construido a partir de las detecciones en Postgres.

Cada detección es un punto (x_km, y_km, t·s) con x, y en la proyección LAEA de Perú y t en
días; s (km por día) iguala las unidades de tiempo y espacio. Sobre esos puntos:

- backend "kdtree": scipy cKDTree (CPU). Construcción O(n log n), consultas O(log n + k).
- backend "cuda":   CuPy en la GPU. Guarda las columnas en la tarjeta y filtra por fuerza bruta
                    en paralelo; útil para regiones grandes (miles de resultados).

Consultas (todas devuelven event_id con el número de detecciones que cayeron en la consulta):
- box(lon_min, lat_min, lon_max, lat_max, t0, t1)
- near(lat, lon, radius_km, t0, t1)
- nearest(lat, lon, t, k)  vecinos más cercanos en espacio-tiempo
"""
import io
import os
import time

import numpy as np
import pandas as pd

from .archive import laea_km

EPOCH = pd.Timestamp("2012-01-01", tz="UTC")


def to_days(t):
    """Días (float) desde EPOCH; las fechas sin zona se toman como UTC."""
    ts = pd.Timestamp(t)
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
    return (ts - EPOCH) / pd.Timedelta(days=1)


def read_points(conn):
    """Lee de Postgres lo mínimo para el índice: id, evento, lon, lat, x, y, t."""
    buf = io.StringIO()
    sql = ("COPY (SELECT event_id, lon, lat, x_km, y_km, "
           f"extract(epoch FROM t_utc - timestamptz '{EPOCH.isoformat()}') / 86400 "
           "FROM detections) TO STDOUT WITH (FORMAT csv)")
    with conn.cursor() as cur, cur.copy(sql) as cp:
        for chunk in cp:
            buf.write(bytes(chunk).decode())
    buf.seek(0)
    return pd.read_csv(buf, header=None, names=["event_id", "lon", "lat", "x", "y", "t"],
                       dtype={"event_id": np.int64, "lon": np.float64, "lat": np.float64,
                              "x": np.float64, "y": np.float64, "t": np.float64})


class SpaceTimeIndex:
    def __init__(self, points, km_per_day=1.0, backend="auto"):
        t0 = time.perf_counter()
        self.km_per_day = km_per_day
        self.n = len(points)
        self.event = points["event_id"].to_numpy()
        self.lon, self.lat = points["lon"].to_numpy(), points["lat"].to_numpy()
        self.t = points["t"].to_numpy()
        self.xyz = np.c_[points["x"].to_numpy(), points["y"].to_numpy(), self.t * km_per_day]
        self.backend = self._pick(backend)
        # hybrid: KD-tree para near/nearest (pocas respuestas) y GPU para cajas grandes.
        self.box_backend = "kdtree" if self.backend == "kdtree" else "cuda"
        self.point_backend = "cuda" if self.backend == "cuda" else "kdtree"
        if "cuda" in (self.box_backend, self.point_backend):
            import cupy as cp
            self.cp = cp
            self.g = {k: cp.asarray(v) for k, v in
                      {"x": self.xyz[:, 0], "y": self.xyz[:, 1], "t": self.t,
                       "lon": self.lon, "lat": self.lat, "event": self.event}.items()}
            self._warmup()
        if "kdtree" in (self.box_backend, self.point_backend):
            from scipy.spatial import cKDTree
            self.tree = cKDTree(self.xyz, leafsize=32, balanced_tree=False)
        self.build_seconds = time.perf_counter() - t0

    def _warmup(self):
        """Compila los kernels de CuPy una vez, para que la primera consulta no tarde."""
        g = self.g
        m = (g["lon"] >= 0) & (g["lat"] >= 0) & (g["t"] >= 0) & (g["t"] < 1)
        g["event"][m].get()
        ((g["x"] - 0.0) ** 2 + (g["y"] - 0.0) ** 2 <= 1.0).sum().get()
        self.cp.cuda.Device().synchronize()

    @staticmethod
    def _pick(backend):
        if backend in ("kdtree", "cpu"):
            return "kdtree"
        try:
            import cupy as cp
            cp.zeros(1).sum()
            return "cuda" if backend == "cuda" else "hybrid"
        except Exception:
            if backend == "cuda":
                raise
            return "kdtree"

    @classmethod
    def from_postgres(cls, conn, **kw):
        t0 = time.perf_counter()
        pts = read_points(conn)
        idx = cls(pts, **kw)
        idx.load_seconds = time.perf_counter() - t0 - idx.build_seconds
        return idx

    def info(self):
        return {"backend": self.backend, "box_backend": self.box_backend,
                "point_backend": self.point_backend, "points": int(self.n),
                "km_per_day": self.km_per_day,
                "load_seconds": round(getattr(self, "load_seconds", 0.0), 3),
                "build_seconds": round(self.build_seconds, 3)}

    # ------------------------------------------------------------------ consultas
    @staticmethod
    def _count(event_ids):
        ids, n = np.unique(event_ids, return_counts=True)
        return pd.DataFrame({"event_id": ids, "hits": n})

    def box(self, lon_min, lat_min, lon_max, lat_max, t0, t1):
        d0, d1 = to_days(t0), to_days(t1)
        if self.box_backend == "cuda":
            g, cp = self.g, self.cp
            m = ((g["lon"] >= lon_min) & (g["lon"] <= lon_max) & (g["lat"] >= lat_min)
                 & (g["lat"] <= lat_max) & (g["t"] >= d0) & (g["t"] < d1))
            return self._count(cp.asnumpy(g["event"][m]))
        # La caja lon/lat se lleva a una caja en km que la contiene; el KD-tree devuelve los
        # candidatos de un cubo (norma infinito) y luego se filtra exacto.
        # En LAEA los bordes de la caja son curvos: se muestrea todo el contorno y se deja
        # un margen de 1 km para no perder puntos cerca del borde.
        s = np.linspace(0, 1, 65)
        lons = np.r_[lon_min + s * (lon_max - lon_min), lon_min + s * (lon_max - lon_min),
                     np.full(65, lon_min), np.full(65, lon_max)]
        lats = np.r_[np.full(65, lat_min), np.full(65, lat_max),
                     lat_min + s * (lat_max - lat_min), lat_min + s * (lat_max - lat_min)]
        xs, ys = laea_km(lats, lons)
        lo = np.array([xs.min() - 1, ys.min() - 1, d0 * self.km_per_day])
        hi = np.array([xs.max() + 1, ys.max() + 1, d1 * self.km_per_day])
        cand = self._cube(lo, hi)
        m = ((self.lon[cand] >= lon_min) & (self.lon[cand] <= lon_max)
             & (self.lat[cand] >= lat_min) & (self.lat[cand] <= lat_max)
             & (self.t[cand] >= d0) & (self.t[cand] < d1))
        return self._count(self.event[cand[m]])

    def _cube(self, lo, hi):
        """Candidatos dentro de un rectángulo 3D: se cubre con una rejilla de cubos (bolas en
        norma infinito) de lado parecido, máximo 8 por eje, y se consulta todo de una vez."""
        ext = hi - lo
        side = max(ext.min(), ext.max() / 8, 1e-6)
        steps = np.maximum(np.ceil(ext / side).astype(int), 1)
        cell = ext / steps
        grid = np.stack(np.meshgrid(*[np.arange(s) for s in steps], indexing="ij"), -1)
        centers = lo + (grid.reshape(-1, 3) + 0.5) * cell
        hits = self.tree.query_ball_point(centers, cell.max() / 2 * (1 + 1e-9), p=np.inf)
        flat = [np.asarray(h, dtype=np.int64) for h in hits if len(h)]
        return np.unique(np.concatenate(flat)) if flat else np.empty(0, np.int64)

    def near(self, lat, lon, radius_km, t0, t1):
        x, y = laea_km(np.array([lat]), np.array([lon]))
        d0, d1 = to_days(t0), to_days(t1)
        if self.point_backend == "cuda":
            g, cp = self.g, self.cp
            m = (((g["x"] - x[0]) ** 2 + (g["y"] - y[0]) ** 2 <= radius_km ** 2)
                 & (g["t"] >= d0) & (g["t"] < d1))
            return self._count(cp.asnumpy(g["event"][m]))
        lo = np.array([x[0] - radius_km, y[0] - radius_km, d0 * self.km_per_day])
        hi = np.array([x[0] + radius_km, y[0] + radius_km, d1 * self.km_per_day])
        cand = self._cube(lo, hi)
        dx, dy = self.xyz[cand, 0] - x[0], self.xyz[cand, 1] - y[0]
        m = (dx ** 2 + dy ** 2 <= radius_km ** 2) & (self.t[cand] >= d0) & (self.t[cand] < d1)
        return self._count(self.event[cand[m]])

    def nearest(self, lat, lon, t, k=10):
        """Los k eventos más cercanos a (lugar, instante), en km equivalentes."""
        x, y = laea_km(np.array([lat]), np.array([lon]))
        q = np.array([x[0], y[0], to_days(t) * self.km_per_day])
        if self.point_backend == "cuda":
            g, cp = self.g, self.cp
            d = cp.sqrt((g["x"] - q[0]) ** 2 + (g["y"] - q[1]) ** 2
                        + ((g["t"] * self.km_per_day) - q[2]) ** 2)
            take = min(self.n, k * 200)
            order = cp.argpartition(d, take - 1)[:take]
            dist, ev = cp.asnumpy(d[order]), cp.asnumpy(g["event"][order])
        else:
            take = min(self.n, k * 200)
            dist, i = self.tree.query(q, k=take)
            dist, ev = np.atleast_1d(dist), self.event[np.atleast_1d(i)]
        df = pd.DataFrame({"event_id": ev, "distance_km": dist})
        return df.groupby("event_id", as_index=False)["distance_km"].min() \
                 .nsmallest(k, "distance_km").reset_index(drop=True)


def benchmark(conn, repeats=20):
    """Compara construcción y consultas en CPU y GPU con los datos de Postgres."""
    pts = read_points(conn)
    rng = np.random.default_rng(0)
    out = []
    for backend in ("kdtree", "cuda", "auto"):
        try:
            idx = SpaceTimeIndex(pts, backend=backend)
        except Exception as e:
            out.append({"backend": backend, "error": str(e)[:80]})
            continue
        row = {"backend": idx.backend, "build_s": round(idx.build_seconds, 3)}
        for name, fn in {
            "box_region_mes": lambda: idx.box(-75.5, -10, -73.5, -8, "2024-09-01", "2024-10-01"),
            "box_peru_anio": lambda: idx.box(-81.4, -18.4, -68.6, 0, "2020-01-01", "2021-01-01"),
            "near_10km_30d": lambda: idx.near(-8.8, -74.8, 10, "2019-08-15", "2019-09-15"),
            "nearest_k10": lambda: idx.nearest(*rng.uniform([-12, -76], [-6, -70]),
                                               "2019-09-01", 10),
        }.items():
            fn()
            t = time.perf_counter()
            for _ in range(repeats):
                fn()
            row[name + "_ms"] = round((time.perf_counter() - t) / repeats * 1000, 2)
        out.append(row)
    return pd.DataFrame(out)


if __name__ == "__main__":
    import psycopg
    with psycopg.connect(os.environ.get("DATABASE_URL", "postgresql:///fires")) as conn:
        print(benchmark(conn).to_string(index=False))
