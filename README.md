# Urban Planner Dataset Assistant

This repository contains a Vite/React frontend and a FastAPI backend for matching urban planning indicator descriptions to useful datasets. It is an integration prototype: the main product path is the React app talking to the FastAPI service.

## Layout

- `frontend/` - Vite + React app, with source in `frontend/src`.
- `backend/` - FastAPI backend, recommendation workflow, external API adapters, and packaging logic.
- `docs/` - Handover notes for the next implementation pass.
- `imports/` - Repo-local runtime output for imported API metadata. This directory is ignored by git.

## Quick Start

Create and use the repository-local Python environment:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

Start the backend:

```bash
cd backend
../.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Install and run the frontend:

```bash
cd frontend
pnpm install --store-dir .pnpm-store
pnpm run dev --host 127.0.0.1
```

`frontend/pnpm-workspace.yaml` pins pnpm's store, cache, and state directories inside the frontend folder.

The frontend defaults to `http://127.0.0.1:8000` for the API. Override it with `VITE_API_BASE_URL` if needed.

## Supported Data Sources

The product catalog is based on imported or live API-backed sources. Bundled example catalog entries have been removed.

Runtime imports support:

- `madrid-ckan` - Madrid Open Data CKAN API.
- `datos-gob-es` - Spanish national open data API.

IGN Geoportal is shown in the UI as unsupported until an adapter is added. Imported datasets are kept in the active backend process and written to repo-local `imports/` metadata files for inspection. They can be cleared from the active catalog without deleting historical import session files.

Full-catalog imports are available for Madrid CKAN and datos.gob.es through `POST /import/{source}/full`. They cache raw snapshots under `backend/data/cache/raw/`, normalized datasets under `backend/data/cache/normalized/`, and progress in `backend/data/cache/manifest.json`. Use `POST /import/{source}/full/rebuild` to rebuild normalized records from raw snapshots without refetching the source API.

Dataset detail previews are loaded lazily through `GET /datasets/{dataset_id}/preview?rows=5`. The backend returns schema metadata when available and fetches a small source-resource sample only on request.

## Environment Variables

Backend:

- `ENABLE_MADRID_CKAN=true` enables live Madrid CKAN search during catalog/recommendation calls.
- `ENABLE_DATOS_GOB_ES=true` enables live datos.gob.es search during catalog/recommendation calls.
- `MADRID_CKAN_ROWS`, `MADRID_CKAN_QUERY`, `DATOS_GOB_ES_PAGE`, and `DATOS_GOB_ES_LIMIT` tune API fetches.
- `CORS_ORIGINS` is a comma-separated list of allowed frontend origins.
- `CORS_ORIGIN_REGEX` defaults to local dev origins on any port, so Vite fallback ports such as `5174` work without editing backend code.
- `ENABLE_LLM_INSIGHTS`, `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL` control optional summary enrichment.

Frontend:

- `VITE_API_BASE_URL=http://127.0.0.1:8000`

## Verification

Backend smoke tests:

```bash
cd backend
../.venv/bin/python scripts/test_agent.py
../.venv/bin/python scripts/test_contract.py
```

Frontend build:

```bash
cd frontend
pnpm run build
```

See `docs/handover-next-steps.md` for the current pickup list and implementation notes.

## Deployment

The deployment shape is one FastAPI backend service plus one static frontend build. Build the frontend with `pnpm run build`, host `frontend/dist/`, and set `VITE_API_BASE_URL` to the deployed backend URL. Configure backend `CORS_ORIGINS` for the deployed frontend origin.
