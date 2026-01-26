# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PhotoScale Estimator is a client-side web application for extracting dimensional data from images using a known reference measurement. It supports manual measurement, cylindrical surface area calculation, and automated object detection via OpenCV.js.

## Commands

```bash
npm install      # Install dependencies
npm run dev      # Start dev server at localhost:5173
npm run build    # Build for production (outputs to dist/)
npm run preview  # Preview production build locally
```

## Deployment

Deployed to GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`). Push to `main` triggers automatic build and deploy. The app is served from `/photoscaler/` base path.

## Tech Stack

- **Framework:** React.js (hooks-based functional components)
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Graphics:** HTML5 Canvas API
- **Computer Vision:** OpenCV.js (WASM, loaded from CDN)
- **Icons:** lucide-react

## Architecture

Main component is `src/App.jsx`:

| Section | Lines | Purpose |
|---------|-------|---------|
| State | 5-33 | React useState for image, measurements, scale factor, CV status |
| OpenCV Loader | 35-57 | Dynamic script loading with async initialization |
| Image Handler | 60-80 | File upload, FileReader, canvas sizing |
| CV Pipeline | 82-195 | `detectDrill()` - grayscale → blur → threshold → contours → minAreaRect |
| Drawing | 219-269 | Mouse/touch event handlers for line drawing |
| Calculations | 271-339 | Scale factor, linear measurement, surface area |
| Canvas Render | 341-416 | useEffect redraw loop with image + lines + labels |
| UI Components | 419-782 | Header, canvas area, sidebar, modals |

## Key Patterns

**CV Pipeline (`detectDrill`):**
1. Canvas → `cv.imread()` → cv.Mat
2. RGB → Grayscale → GaussianBlur → Otsu threshold
3. `findContours` → filter by area (>500px) → largest contour
4. `minAreaRect` → extract width (diameter) / height (length)
5. Auto-populate state with measurements
6. Clean up Mat objects with `.delete()`

**Canvas Rendering:**
- Three layers: base image, vector lines (color-coded), text labels
- Colors: Blue = reference, Red = measurements, Green = selected for calculation

**Surface Area Calculation:**
- Auto mode: reference flagged as diameter triggers automatic calculation
- Manual mode: user selects diameter + length from dropdown
- Formula: `π × diameter × length`

## External Dependencies

OpenCV.js is loaded at runtime from `https://docs.opencv.org/4.5.4/opencv.js`. The `cvReady` state flag tracks initialization status.

## Documentation

- `docs/prd.md` - Product requirements, user flows, future improvements
- `docs/tdd.md` - Technical architecture, CV pipeline details, implementation roadmap
