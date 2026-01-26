# Technical Design Document (TDD): PhotoScale Estimator

| Field | Value |
|-------|-------|
| **Document Version** | 2.0 |
| **Status** | Approved |
| **Project** | PhotoScale Estimator (Code Name: One-Measure) |
| **Reference PRD** | PhotoScale_PRD_v2.md |

---

## 1. Introduction

### 1.1 Purpose

This document outlines the technical architecture for PhotoScale Estimator v2.0. It expands upon the original design by adding client-side Computer Vision (CV) for automated object detection and specialized logic for calculating the surface area of cylindrical objects (drills).

### 1.2 Scope

- **Frontend:** React.js + Vite + Tailwind CSS
- **Graphics:** HTML5 Canvas API
- **CV Engine:** OpenCV.js (WebAssembly)
- **Deployment:** Static hosting (Netlify/Vercel)

---

## 2. System Architecture

### 2.1 High-Level Overview

The application remains a Single Page Application (SPA). To maintain privacy and performance, all image processing occurs client-side. The system loads `opencv.js` dynamically at runtime to handle image segmentation without server roundtrips.

### 2.2 Component Diagram

| Layer | Description |
|-------|-------------|
| **UI Layer** | React components for the Sidebar, Header, and Modal interactions |
| **Canvas Controller** | Handles image rendering, coordinate mapping, and vector drawing (lines/labels) |
| **CV Service** (New) | An asynchronous interface that communicates with the OpenCV.js WASM module |
| **Math Engine** | Pure functions for Scale Factors, Euclidean Distances, and Surface Area geometry |

---

## 3. Data Flow & Logic

### 3.1 State Management (React)

The application state is centralized in the main App component:

```javascript
{
  image: ImageObject,
  scaleFactor: Float, // null initially
  referenceLine: {
    start: {x, y},
    end: {x, y},
    realLength: Float,
    unit: String,
    isDiameter: Boolean // NEW: Flags if reference is a diameter
  },
  measurements: Array<{
    id: Timestamp,
    start: {x, y},
    end: {x, y},
    value: Float
  }>,
  cvReady: Boolean // NEW: Tracks OpenCV loading status
}
```

### 3.2 The Reference Scale Logic (Updated)

**Standard Mode:**

$$Scale = \frac{UserValue}{PixelDistance}$$

**Surface Area Mode:**

If `referenceLine.isDiameter` is `true`:

For any subsequent measurement $M$ (length):

$$SurfaceArea = \pi \times Reference.realLength \times M.value$$

### 3.3 Computer Vision Pipeline (Auto-Detect)

The `detectDrill()` function executes the following pipeline on the Canvas pixel data:

1. **Ingest:** `cv.imread(canvas)` to get the `cv.Mat`.

2. **Pre-process:**
   - `cv.cvtColor` (RGB → Gray)
   - `cv.GaussianBlur` (Reduce noise/grain)
   - `cv.threshold` (Otsu's Binarization) to create a binary mask

3. **Segmentation:**
   - `cv.findContours` to retrieve object shapes
   - Filter: Iterate contours; discard small areas (< 500px); select the contour with `Max(Area)`

4. **Geometry Extraction:**
   - `cv.minAreaRect(contour)` returns a Rotated Rectangle (center, size, angle)

5. **Dimension Logic:**
   - `Diameter (Pixels)` = `Min(rect.width, rect.height)`
   - `Length (Pixels)` = `Max(rect.width, rect.height)`

6. **Output Generation:**
   - Construct vector lines for the UI based on the rect's vertices
   - Automatically populate `referenceLine` using the calculated Diameter Pixel count and User Input
   - Automatically populate `measurements` using the calculated Length Pixel count

---

## 4. Interface Design

### 4.1 Canvas Layer

**Interaction:** Mouse/Touch events mapped to Canvas coordinates.

**Layers:**

| Layer | Content |
|-------|---------|
| **Base** | Source Image |
| **Overlay** | Vector paths (lines, circles for end-caps) |
| **Labels** | Text with background boxes for legibility |

### 4.2 Auto-Detect UI

**Trigger:** "Find & Measure" button in Sidebar.

**Feedback:**
- Loading Spinner overlay during CV processing (prevents UI freeze perception)
- Error Alerts if no valid contour is found

---

## 5. Technical Constraints & Risks

### 5.1 CV Limitations (Client-Side)

| Constraint | Details |
|------------|---------|
| **Lighting/Contrast** | The simpler Edge Detection algorithms (Thresholding) require high contrast (e.g., dark drill on white paper). Shadows may be detected as part of the object. |
| **Performance** | Large images (> 4K) may cause momentary main-thread blocking during `cv.findContours`. **Mitigation:** Downscale image internally for CV analysis if width > 2000px. |

### 5.2 Browser Support

Requires WASM support for OpenCV.js (Supported in all modern browsers: Chrome, Firefox, Safari, Edge).

---

## 6. Implementation Roadmap (V2 Update)

### Step 1: Core Geometry
- Implement `isDiameter` flag in Reference state
- Implement Surface Area calculation display in the Sidebar

### Step 2: CV Integration
- Add `opencv.js` script loader
- Implement `detectDrill` function with standard Mat operations
- Map CV output (Rotated Rect) to UI State (`measurements` array)

### Step 3: Refinement
- Add error handling for "No Contour Found"
- Optimize canvas re-drawing loop
