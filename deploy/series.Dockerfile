FROM python:3.13.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/*.py ./api/
COPY web/ ./web/
COPY data/history.sqlite.gz data/manifest.json ./data/
# Build fails on a corrupt snapshot. The verified database is part of the image,
# so ephemeral filesystem resets do not require another network download.
RUN python api/restaurar_snapshot.py \
    && useradd --uid 10001 --create-home apiuser
USER apiuser
EXPOSE 8000
CMD ["python", "api/serve.py"]
