# Urban Data Recommender Agent Guide

## Project State

This repository is an integration prototype for an Urban Planner Dataset Assistant. The frontend was generated from a Figma proof of concept, the backend was model-assisted/vibe-coded, and the active work is connecting both sides into a coherent product.

Treat the codebase as useful but uneven. Prefer small, verified changes over broad rewrites, and keep the frontend/backend contract explicit whenever you touch either side.

## Repository Map

- `frontend/` contains the user-facing Vite + React app.
- `frontend/src/app/routes.tsx` defines the main screens: `/`, `/overview`, `/results`, `/dataset-fit`, `/imported`, and `/summary`.
- `frontend/src/app/api.ts` is the integration boundary for FastAPI calls and response-to-UI conversion.
- `frontend/src/app/store.ts` is a small in-memory app store used across screens.
- `frontend/src/app/components/` contains the Figma-generated application components.
- `frontend/src/app/components/ui/` contains generated Radix/shadcn-style primitives.
- `backend/` contains the Python backend package and helper scripts.
- `backend/app/api.py` exposes the FastAPI application.
- `backend/app/agent.py` contains the LangGraph-style recommendation workflow nodes.
- `backend/app/catalog.py` owns external-source loading, imported datasets, search, and summary loading.
- `backend/app/api_adapters.py` normalizes Madrid CKAN and datos.gob.es API payloads into internal datasets.
- `backend/app/models.py` defines the dataclass domain models and graph state.
- `backend/app/storage.py` writes imported dataset metadata under runtime `imports/`.
- `backend/app/embeddings.py` provides lightweight semantic search over persisted summaries.
- `backend/app/package_builder.py` creates downloadable metadata zip packages.
- `docs/` contains short existing frontend/backend notes.

## Architecture

The frontend is a Vite React single-page app. It currently uses generated components, local store state, and `frontend/src/app/api.ts` to call the backend. The default backend URL is `http://127.0.0.1:8000`, overridable with `VITE_API_BASE_URL`.

The backend is a FastAPI API around a deterministic recommendation workflow. The core request path is:

1. The UI sends indicator text to `/topics/suggest`, `/analyze`, or `/recommend`.
2. `backend/app/api.py` validates request/response shapes with Pydantic.
3. `backend/app/application/recommend_datasets.py` normalizes text, parses geography/time/population, extracts themes, filters candidate datasets, scores recommendations, and produces gaps/risks. `backend/app/agent.py` is a compatibility wrapper for scripts that still expect the LangGraph entry point.
4. `backend/app/catalog.py` supplies imported datasets and optionally merges live external API data.
5. `frontend/src/app/api.ts` converts backend dataset objects into the UI `Dataset` type.

Important API endpoints:

- `GET /health`
- `POST /topics/suggest`
- `POST /analyze`
- `POST /recommend`
- `GET /datasets?include_apis=false`
- `GET /datasets/{dataset_id}/preview?rows=5`
- `POST /import/{source}` where `source` is `madrid-ckan` or `datos-gob-es`
- `POST /import/{source}/full`
- `POST /import/{source}/full/rebuild`
- `GET /import/{source}/full/progress`
- `POST /summaries/search`
- `POST /package/create`
- `POST /package/manifest`
- `GET /settings/llm`
- `POST /summaries/enrich`

## Build And Run

Use a repository-local environment for all build, run, and test work. Never install packages globally, never use system site-packages, and never write configuration, caches, generated files, or dependency artifacts outside this repository. If a task appears to require modifying anything outside the repo, stop and ask for a repo-local alternative.

Python must always run through the repo virtualenv. The only permitted system Python use is creating `.venv` when it does not exist.

Frontend:

```bash
cd frontend
pnpm install --store-dir .pnpm-store
pnpm run dev --host 127.0.0.1
```

The Vite app serves at `http://127.0.0.1:5173/`. For a production compile check:

```bash
cd frontend
pnpm run build
```

Backend:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd backend
../.venv/bin/python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

The API serves at `http://127.0.0.1:8000/`. Check it with:

```bash
curl http://127.0.0.1:8000/health
```

Backend smoke test:

```bash
cd backend
../.venv/bin/python scripts/test_agent.py
```

## Runtime Configuration

Useful backend environment variables:

- `ENABLE_MADRID_CKAN=true` enables Madrid CKAN during catalog/recommendation search.
- `ENABLE_DATOS_GOB_ES=true` enables datos.gob.es during catalog/recommendation search.
- `MADRID_CKAN_ROWS`, `MADRID_CKAN_QUERY`, `DATOS_GOB_ES_PAGE`, and `DATOS_GOB_ES_LIMIT` tune external fetches.
- `CORS_ORIGINS` is a comma-separated list of allowed frontend origins.
- `CORS_ORIGIN_REGEX` defaults to local dev origins on any port, which covers Vite fallback ports such as `5174`.
- `ENABLE_LLM_INSIGHTS=true`, `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL` control optional summary enrichment.

Useful frontend environment variable:

- `VITE_API_BASE_URL=http://127.0.0.1:8000`

External API calls can be slow or flaky. Keep imported-source empty states and error handling clear when network-backed sources are disabled or unavailable.

## Behavioral Guidelines For Agents

Preserve the Figma-generated frontend unless the task explicitly asks for redesign. Keep visual and component changes tightly scoped, reuse existing UI primitives, and do not remove the Figma asset resolver or required React/Tailwind Vite plugins.

Assume backend comments may describe an intended design rather than exact behavior. Read the code path before changing it, then verify with a smoke test or endpoint call.

Treat `frontend/src/app/api.ts` and `backend/app/api.py` as the contract. If you add, remove, or rename API fields, update the Pydantic models, TypeScript interfaces, converters, and any affected components in the same change.

Keep recommendation behavior explainable. Theme extraction, scoring, gaps, and risks should remain deterministic and inspectable unless the user explicitly asks for LLM-driven behavior.

Do not silently fall back to mock data on connected flows. Integration work should prefer real API responses or explicit loading/error states.

When adding imports or generated data, avoid committing runtime artifacts from `imports/`, caches, virtual environments, `node_modules/`, or build outputs unless the user explicitly asks.

After frontend changes, run `pnpm run build` from `frontend/`. After backend changes, run at least `scripts/test_agent.py` or a targeted FastAPI endpoint smoke test. When integration behavior changes, run both sides together and check the UI against the API.

Favor boring, direct fixes. This project is in the stitching-together phase, so stable contracts, clear error handling, and small compatibility adapters are usually more valuable than new abstractions.

## Hard Environment Boundary

All agents must obey these rules:

- Always use the root `.venv` for Python commands after it exists.
- Never run bare `python`, `python3`, `pip`, `pip3`, or `python -m pip` for project work, except `python3 -m venv .venv` to create the repo-local virtualenv.
- Never install Python or Node dependencies globally.
- Never modify files, package stores, caches, shell profiles, tool config, or generated artifacts outside this repository.
- Keep dependency caches inside the repo, for example `frontend/.pnpm-store` for pnpm or `frontend/.npm-cache` for npm.
- If a tool would write outside the repo by default, configure it to use a repo-local path or do not run it.
- Curl is always allowed for localhost-only URLs: `http://127.0.0.1/...`, `http://localhost/...`, and `http://[::1]/...`.
- Never use `curl` for non-localhost URLs. Use browser/search tools only when external web access is explicitly needed and allowed by the broader task rules.
