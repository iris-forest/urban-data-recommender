# Urban Planner Dataset Assistant

This is the Vite/React frontend for the Urban Planner Dataset Assistant.

## Running the code

Use pnpm 11 for this frontend. `pnpm-workspace.yaml` keeps pnpm's store, cache, and state files inside this folder, and `pnpm-lock.yaml` is the only tracked frontend package lockfile.

Install dependencies with the repo-local pnpm store:

```bash
pnpm install --store-dir .pnpm-store
```

Start the development server:

```bash
pnpm run dev --host 127.0.0.1
```

If a fresh checkout or copied workspace reports a missing Vite import such as `react-markdown` or `remark-gfm`, remove stale generated install artifacts and reinstall from the pnpm lockfile:

```bash
rm -rf node_modules dist .vite .pnpm-store .npm-cache .pnpm-state
corepack enable
corepack prepare pnpm@11.0.5 --activate
pnpm install --frozen-lockfile --store-dir .pnpm-store
pnpm run build
```

For Docker, build from the repository root with `docker compose build frontend` or `docker build -f frontend/Dockerfile .` so the Dockerfile can copy the frontend manifest and pnpm lockfile from the expected context.
