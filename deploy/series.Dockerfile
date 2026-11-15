FROM python:3.13.15-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/*.py ./api/
COPY web/ ./web/
COPY data/history.sqlite.gz data/manifest.json ./data/
COPY data/regional_outlook.json data/regional_outlook_manifest.json ./data/
# Build fails on a corrupt snapshot. The verified database is part of the image,
# so ephemeral filesystem resets do not require another network download.
RUN python api/restaurar_snapshot.py \
    && chmod 0444 api/history.sqlite \
    && useradd --uid 10001 --create-home apiuser
COPY deploy/check_image.py ./deploy/check_image.py
USER apiuser
# Verify the database and spatial queries with the actual non-root runtime user.
RUN python deploy/check_image.py
EXPOSE 8000
CMD ["python", "api/serve.py"]
