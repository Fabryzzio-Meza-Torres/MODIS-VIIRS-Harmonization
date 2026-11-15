# Hugging Face Spaces (y cualquier host de un solo contenedor): Postgres y la API juntos.
# Al arrancar, deploy/hf_start.sh crea la base local, baja fires.dump de Google Drive, la
# restaura y lanza la API en el puerto 7860.
# Para Docker Compose (Postgres aparte) se usa deploy/compose.Dockerfile.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Spaces corre el contenedor con el usuario 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user
WORKDIR /home/user/app

COPY --chown=user src ./src
COPY --chown=user config ./config
COPY --chown=user deploy ./deploy

ENV PYTHON=python PORT=7860 INDEX_BACKEND=kdtree PGDATA=/home/user/pgdata
EXPOSE 7860
CMD ["bash", "deploy/hf_start.sh"]
