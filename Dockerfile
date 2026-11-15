FROM python:3.12-slim

# pg_restore y psql para restaurar la base; curl para bajar el dump.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY config ./config
COPY deploy/bootstrap.sh ./deploy/bootstrap.sh

ENV PYTHON=python PORT=8000 INDEX_BACKEND=kdtree
EXPOSE 8000
CMD ["bash", "deploy/bootstrap.sh"]
