# Static hosting (Plex, nginx, S3, etc.)

`npm run build` writes a self-contained site to **`dist/`**:

- `index.html` — SPA shell (TanStack Start prerender)
- `assets/*` — hashed JS/CSS (`base: ./` so paths work on any origin)
- `software/*` — bundled disks (including `boulder-dash.d64` fetched at build time)
- `favicon.svg`, `og.jpg`, `__grok/*`

## Serve

Point your static host at **`dist/`** with SPA fallback to `index.html` for unknown paths.

Examples:

```bash
# Python (quick check)
cd dist && python3 -m http.server 8080

# nginx
root /var/www/grok64/dist;
location / { try_files $uri $uri/ /index.html; }
```

## EmulatorJS

VICE WASM cores load from `https://cdn.emulatorjs.org/stable/data/` (no bundling required). Power-on fetches `./software/blank.d64` relative to the app base.

## Catalog & Internet Archive

**grok.me / Vercel:** use `npm run build:vercel` so TanStack Start server functions stay wired (Nitro). Catalog search and Archive.org downloads go through the server-side fetch path restored from main — this bypasses IA CDN CORS in the browser.

**Pure static hosts (Plex, nginx, S3):** `npm run build` flattens to a client-only `dist/`. Power-on, bundled `./software/*`, and the on-device library work. Catalog search/download needs a server; for IA titles on a static host, run behind any reverse proxy that can forward `/api` (or deploy the Vercel build) or use grok.me for catalog fetch then play from library.

Assembly64 and HVSC metadata/search work in-browser (CORS allowed). IA **download** CDN nodes block browser CORS — server-side fetch is required (the restored `createServerFn` path).

## Vercel / grok.me

Use `npm run build:vercel` (sets `GROK_VERCEL_BUILD=1`) to include the Nitro server bundle for legacy deploys.
