"""Descarga MODIS, NOAA-20 y NOAA-21 (solo SP) de Perú desde la API de FIRMS, en bloques de 5 días.

Es reanudable: cada bloque se guarda en data/raw/api/<fuente>/<inicio>.csv y no se vuelve a
pedir. Respeta el límite de transacciones de la MAP_KEY (5000 cada 10 minutos).

    python -m src.firms.download            # todo el plan de config.API_PLAN
    python -m src.firms.download MODIS      # solo una plataforma
"""
import io
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from dotenv import load_dotenv

from .config import API_PLAN, PERU_BBOX, RAW_API, REPO

BASE = "https://firms.modaps.eosdis.nasa.gov"
_lock = threading.Lock()
_last_check = [0.0]


def map_key():
    load_dotenv(REPO / ".env")
    key = os.getenv("NPP_KEY") or os.getenv("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Falta NPP_KEY (o FIRMS_MAP_KEY) en .env")
    return key.strip().strip('"')


def wait_for_quota(key, limit=4300):
    """Si la clave está cerca del límite, espera a que se libere."""
    with _lock:
        if time.time() - _last_check[0] < 15:
            return
        while True:
            try:
                s = requests.get(f"{BASE}/mapserver/mapkey_status/?MAP_KEY={key}", timeout=30).json()
                used = s.get("current_transactions", 0)
            except Exception:
                used = 0
            if used < limit:
                break
            print(f"  cuota {used}/5000, esperando 60 s", flush=True)
            time.sleep(60)
        _last_check[0] = time.time()


def blocks(start, end):
    day, end = pd.Timestamp(start), pd.Timestamp(end)
    while day <= end:
        days = min(5, (end - day).days + 1)
        yield day.date(), days
        day += pd.Timedelta(days=days)


def fetch_block(key, source, day, days):
    path = RAW_API / source / f"{day}.csv"
    if path.exists():
        return path, "cache"
    area = ",".join(map(str, PERU_BBOX))
    url = f"{BASE}/api/area/csv/{key}/{source}/{area}/{days}/{day}"
    for attempt in range(6):
        wait_for_quota(key)
        try:
            r = requests.get(url, timeout=180)
            text = r.text
            if r.ok and text.startswith("latitude"):
                pd.read_csv(io.StringIO(text), nrows=1)  # cabecera válida
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".part")
                tmp.write_text(text)
                tmp.replace(path)
                return path, "ok"
            msg = text[:120].strip()
        except Exception as e:  # red o timeout
            msg = repr(e)[:120]
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{source} {day}: {msg}")


def plan(platforms=None):
    """Bloques de 5 días de cada fuente SP del plan (sin NRT)."""
    jobs = []
    for name, (sp, start, end) in API_PLAN.items():
        if platforms and name not in platforms:
            continue
        jobs += [(sp, d, n) for d, n in blocks(start, end)]
    return jobs


def main(argv):
    key = map_key()
    jobs = plan(argv or None)
    print(f"{len(jobs)} bloques por bajar o verificar", flush=True)
    done, failed, t0 = 0, [], time.time()
    with ThreadPoolExecutor(max_workers=int(os.environ.get("FIRMS_WORKERS", 6))) as pool:
        futures = {pool.submit(fetch_block, key, *job): job for job in jobs}
        for f in as_completed(futures):
            done += 1
            try:
                f.result()
            except Exception as e:
                failed.append(futures[f])
                print("  FALLA", e, flush=True)
            if done % 50 == 0 or done == len(jobs):
                print(f"{done}/{len(jobs)} bloques · {time.time() - t0:.0f} s", flush=True)
    if failed:
        print(f"{len(failed)} bloques fallaron; vuelve a ejecutar para reintentarlos.")
        sys.exit(1)
    print("Descarga completa.")


if __name__ == "__main__":
    main(sys.argv[1:])
