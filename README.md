# Urban Planner Dataset Assistant

This repository contains a Vite/React frontend and a FastAPI backend for matching urban planning indicator descriptions to useful datasets. It is an integration prototype: the main product path is the React app talking to the FastAPI service.

## Layout

- `frontend/` - Vite + React app, with source in `frontend/src`.
- `backend/` - FastAPI backend, recommendation workflow, external API adapters, and packaging logic.
- `docs/` - Handover notes for the next implementation pass.
- `imports/` - Repo-local runtime output for imported API metadata. This directory is ignored by git.

## Requirements

- Python 3.
- Node.js 22 with Corepack.
- Internet access for the first dependency install and for importing source API metadata.

Docker is not required for local development or Vercel frontend deployment.

## Quick Start

From a fresh checkout, install backend and frontend dependencies:

```bash
./scripts/setup.sh
```

Start both services:

```bash
./scripts/dev.sh
```

Open the URL printed by Vite, usually `http://127.0.0.1:5173`.

If a default port is already occupied, override it from the repository root:

```bash
BACKEND_PORT=8001 FRONTEND_PORT=5174 ./scripts/dev.sh
```

Use pnpm for frontend installs. The tracked lockfile is `frontend/pnpm-lock.yaml`, and npm/yarn/bun lockfiles are intentionally ignored so clean environments do not accidentally install a different dependency graph.

Manual startup is still available if you prefer separate terminals:

```bash
cd backend
../.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

```bash
cd frontend
pnpm run dev --host 127.0.0.1
```

For a scratch or stale local frontend setup, reset the generated install artifacts and reinstall from the pnpm lockfile:

```bash
cd frontend
rm -rf node_modules dist .vite .pnpm-store .npm-cache .pnpm-state
corepack enable
corepack prepare pnpm@11.0.5 --activate
pnpm install --frozen-lockfile --store-dir .pnpm-store
pnpm run build
```

`frontend/pnpm-workspace.yaml` pins pnpm's store, cache, and state directories inside the frontend folder.

The frontend uses `/backend` in local Vite development and proxies that path to the FastAPI backend. Override `VITE_API_BASE_URL` only when pointing the frontend at a deployed API.

## First-Time Setup: Import API Metadata Locally

Before searching for dataset matches, import the external catalog metadata into the local backend cache. The app recommends datasets from locally cached API metadata, not from a bundled static catalog. This import stores catalog records, resource links, schema hints, and source metadata; it does not download every raw dataset file up front.

### Import From The Frontend

1. Start the backend and frontend.
2. Open the frontend in your browser.
3. On the first screen, select the **Data sources** tab.
4. Choose a source, such as **Madrid CKAN** or **datos.gob.es**.
5. Click **Import full catalog**.
6. Watch the status and progress on the same card. You can stay on the page or return later; the frontend polls the backend for progress.
7. When the card shows the source is saved locally / completed, return to the planning question tab and run the normal recommendation flow.

Supported full-catalog imports:

- Madrid CKAN: `madrid-ckan`
- datos.gob.es: `datos-gob-es`

Use **Quick sync** only for a smaller interactive import. For normal local use, prefer **Import full catalog** so recommendations can search the full locally cached metadata.

If raw snapshots already exist, click **Rebuild from saved source files** in the source card. This regenerates normalized cache records without refetching the source API.

To remove one source from the active recommendation catalog, click **Clear imported data** on that source card. This clears the active imported records, but historical import output can remain on disk for inspection.

To inspect what was imported, click **View imported datasets** on the source card.

### Local Cache Notes

Local cache locations:

- `backend/data/cache/raw/` - raw paginated source snapshots.
- `backend/data/cache/normalized/` - normalized JSONL dataset records used by recommendations.
- `backend/data/cache/manifest.json` - import progress and cache status.
- `imports/` - repo-local metadata output for inspection.

## App Workflow

1. **Import API metadata locally** from the **Data sources** tab.
2. **Describe the planning indicator** in natural language.
3. **Review matching datasets** on the Role Board. The visible `Match` value describes role usefulness for the question; it does not claim the dataset is analysis-ready.
4. **Select datasets for the indicator roles**. The board groups datasets by the role they can play, such as green-space input, population denominator, or low-emission context.
5. **Run Data Quality Review**. This page does not show a numeric quality score. It shows a review status such as `Needs review`, `Source check needed`, or `No major issues`, plus concrete next steps.
6. **Export or download outputs** from the summary page:
   - **Export PDF Summary** opens a print-ready summary that can be saved as PDF.
   - **Download Data Package** creates a ZIP with the manifest, generated docs, per-dataset summaries, and source files when public resource URLs can be fetched.

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

The deployment shape is one FastAPI backend service plus one static frontend build. The frontend can run on Vercel, Render Static Site, Netlify, or any static host. The backend should run on a Python service host such as Render Web Service, Fly.io, Railway, AWS, or a university/internal server.

### Vercel Frontend

Vercel does not need Docker for this project. Deploy only `frontend/` as a Vite static app:

- **Root directory:** `frontend`
- **Install command:** `corepack enable && corepack prepare pnpm@11.0.5 --activate && pnpm install --frozen-lockfile`
- **Build command:** `pnpm run build`
- **Output directory:** `dist`
- **Environment:** `VITE_API_BASE_URL=https://your-backend.example.com`

Configure backend `CORS_ORIGINS` to include the deployed Vercel frontend origin.

### Render (static frontend)

For a Render **Static Site** rooted at `frontend/`:

- **Environment:** `NODE_VERSION=22`, `VITE_API_BASE_URL=https://your-api.onrender.com`
- **Build command:**

```bash
corepack enable && corepack prepare pnpm@11.0.5 --activate && pnpm install --frozen-lockfile && pnpm run build
```

`package.json` pins `packageManager` to pnpm 11 so the lockfile matches CI/Render (avoids override mismatch on older pnpm).

### Manual deployment

Build the frontend with `pnpm run build`, host `frontend/dist/`, and set `VITE_API_BASE_URL` to the deployed backend URL. Configure backend `CORS_ORIGINS` for the deployed frontend origin.
