#!/usr/bin/env bash
# Arranque en un solo contenedor (Hugging Face Spaces):
# 1. Crea un Postgres local en $PGDATA (solo socket Unix, sin red) y la base `fires`.
# 2. Llama a deploy/bootstrap.sh, que baja y restaura fires.dump y lanza la API.
#
# También corre en cualquier Linux con Postgres instalado (sin root):
#   PGDATA=~/pgdata-prueba PORT=7860 PYTHON=.venv/bin/python bash deploy/hf_start.sh
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
PGDATA="${PGDATA:-$HOME/pgdata}"
PGSOCK="${PGSOCK:-/tmp}"
PGPORT_LOCAL="${PGPORT_LOCAL:-5432}"

log() { echo "[hf_start] $*"; }

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "Creando Postgres en $PGDATA…"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
fi

mkdir -p "$PGSOCK"
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -w \
  -o "-c listen_addresses='' -k $PGSOCK -p $PGPORT_LOCAL" start

PSQL=(psql -h "$PGSOCK" -p "$PGPORT_LOCAL" -U postgres -Atq)
if [ "$("${PSQL[@]}" -c "select 1 from pg_database where datname = 'fires'")" != "1" ]; then
  "${PSQL[@]}" -c "create database fires"
fi

export DATABASE_URL="postgresql://postgres@/fires?host=$PGSOCK&port=$PGPORT_LOCAL"
exec bash "$(dirname "$0")/bootstrap.sh"
