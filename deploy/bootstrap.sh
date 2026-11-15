#!/usr/bin/env bash
# Prepara la base y lanza la API.
#
# 1. Espera a que Postgres responda en DATABASE_URL.
# 2. Si la base todavía no tiene la tabla `events`, baja fires.dump (Google Drive por defecto),
#    verifica su sha256 y lo restaura con pg_restore.
# 3. Arranca la API con uvicorn.
#
# Sirve dentro del contenedor (docker compose) y en cualquier Linux con Postgres:
#   DATABASE_URL=postgresql:///fires PYTHON=.venv/bin/python bash deploy/bootstrap.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql:///fires}"
DUMP_URL="${DUMP_URL:-https://drive.usercontent.google.com/download?id=1k76VcDl7RQq5hpKhayTXl_3URC_kQIAl&export=download&confirm=t}"
DUMP_SHA256="${DUMP_SHA256:-5382be98a0221e528995f2d44470d03f0e2bcc2307bc0a61410744c745aa7e71}"
DUMP_PATH="${DUMP_PATH:-/tmp/fires.dump}"
PYTHON="${PYTHON:-python3}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

log() { echo "[bootstrap] $*"; }

log "Esperando a Postgres…"
for i in $(seq 1 60); do
  if psql "$DATABASE_URL" -Atqc "select 1" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 60 ]; then log "Postgres no responde en DATABASE_URL"; exit 1; fi
  sleep 2
done

if [ "$(psql "$DATABASE_URL" -Atqc "select to_regclass('public.events') is not null")" = "t" ]; then
  log "La base ya tiene datos: no se descarga nada."
else
  if [ ! -s "$DUMP_PATH" ] || ! echo "$DUMP_SHA256  $DUMP_PATH" | sha256sum -c --status; then
    log "Descargando fires.dump (132 MB)…"
    curl -fL --retry 3 -o "$DUMP_PATH" "$DUMP_URL"
  fi
  if ! echo "$DUMP_SHA256  $DUMP_PATH" | sha256sum -c --status; then
    log "El sha256 del dump no coincide: descarga incompleta o enlace equivocado."
    exit 1
  fi
  log "Restaurando la base (unos 2 minutos)…"
  pg_restore --no-owner --no-privileges -d "$DATABASE_URL" "$DUMP_PATH"
  log "Base lista: $(psql "$DATABASE_URL" -Atqc "select count(*) from events") eventos."
  [ "${KEEP_DUMP:-0}" = "1" ] || rm -f "$DUMP_PATH"
fi

log "Lanzando la API en http://$HOST:$PORT (docs en /docs)…"
exec "$PYTHON" -m uvicorn src.api.main:app --host "$HOST" --port "$PORT"
