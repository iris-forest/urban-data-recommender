FROM python:3.12-slim-bookworm

WORKDIR /app/backend

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
ENV PIP_DEFAULT_TIMEOUT=300
RUN pip install --no-cache-dir --default-timeout=300 -r /tmp/requirements.txt

COPY backend/ /app/backend/

# Keep a copy outside the runtime volume mount so first-start seeding still works
# when backend_data overlays /app/backend/data.
RUN if [ -f /app/backend/data/cache/manifest.json ]; then \
      mkdir -p /app/backend/catalog-cache-seed && \
      cp -a /app/backend/data/cache/. /app/backend/catalog-cache-seed/; \
    fi \
    && mkdir -p /app/imports

COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/data/huggingface
ENV TRANSFORMERS_CACHE=/data/huggingface

EXPOSE 8000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD sh -c 'python -m uvicorn app.api:app --host 0.0.0.0 --port ${PORT:-8000}'