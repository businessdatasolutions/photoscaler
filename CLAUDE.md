# CLAUDE.md

Client-side web app for measuring objects in images. React + Vite + Tailwind + OpenCV.js (WASM). All logic in `src/App.jsx`.

## Commands

```bash
npm install      # Install dependencies
npm run dev      # Dev server at localhost:5173
npm run build    # Production build (dist/)
```

## Deployment

GitHub Pages via `.github/workflows/deploy.yml`. Push to `main` auto-deploys to `/photoscaler/`.

## Key Rule

All `cv.Mat` objects must be cleaned up with `.delete()` in try/finally.

## Docs

- `docs/prd.md` / `docs/tdd.md` — Standard Mode
- `docs/prd-jig-mode.md` / `docs/tdd-jig-mode.md` — Jig Mode (in development)
- `memory/jig-mode-tasks.md` — Implementation checklist (follow sequentially, commit after each passing test group)
