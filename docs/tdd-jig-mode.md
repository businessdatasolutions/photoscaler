# Technical Design Document (TDD): Jig Mode — Ruler-Based Drill Categorization

| Field | Value |
|-------|-------|
| **Document Version** | 1.0 |
| **Status** | Draft |
| **Project** | PhotoScale Estimator — Jig Mode |
| **Reference PRD** | prd-jig-mode.md |

---

## 1. Introduction

### 1.1 Purpose

This document describes the technical architecture for the Jig Mode feature. Jig Mode adds automatic ruler detection, two-axis calibration, multi-drill detection, and height-based categorization to the existing PhotoScale Estimator.

### 1.2 Scope

- **Existing stack:** React.js + Vite + Tailwind CSS + HTML5 Canvas + OpenCV.js (WASM)
- **New capabilities:** Ruler detection, tick-mark analysis, multi-contour processing, batch categorization, TSV export
- **Unchanged:** OpenCV.js loaded from CDN, all processing client-side, monolithic `App.jsx` component

### 1.3 Key Differences from Existing CV Pipelines

| Aspect | Existing (V3) | Jig Mode (V4) |
|--------|---------------|----------------|
| Calibration source | Manual line or paper detection | Automatic ruler detection with tick marks |
| Scale factor | Single global `scaleFactor` | Independent `scaleX` and `scaleY` |
| Object detection | Single largest contour | All qualifying contours |
| Thresholding | Otsu (global) | Adaptive (local, handles uneven lighting) |
| Output | One measurement + surface area | Batch results table with categories |

---

## 2. State Model

### 2.1 New State Variables

All new state is added to the main `PhotoScaleApp` component in `src/App.jsx`:

```javascript
// --- Jig Mode ---
const [jigMode, setJigMode] = useState(false);

// Ruler Calibration
const [xRuler, setXRuler] = useState(null);
// {
//   line: { start: {x,y}, end: {x,y} },  // pixel endpoints of ruler
//   ticks: [{ px: Number, mm: Number }],  // detected tick positions
//   scalePxPerMm: Number,                 // computed scale factor
//   length: Number                        // real-world length in mm (default 400)
// }

const [yRuler, setYRuler] = useState(null);  // same shape as xRuler

// Base Line
const [baseLine, setBaseLine] = useState(null);
// {
//   y: Number,        // pixel Y-coordinate
//   mmValue: Number   // real-world Y value at the base line
// }

// Multi-Drill Results
const [detectedDrills, setDetectedDrills] = useState([]);
// Array of {
//   id: Number,
//   rect: RotatedRect,          // from cv.minAreaRect
//   vertices: [{x,y} x 4],     // bounding box corners
//   topY: Number,               // pixel Y of drill tip
//   bottomY: Number,            // pixel Y of drill base
//   centerX: Number,            // pixel X center
//   heightPx: Number,           // pixel height
//   heightMm: Number,           // real-world height in mm
//   category: 'A' | 'B' | 'C'  // assigned category
// }

const [selectedDrillId, setSelectedDrillId] = useState(null);

// Category Thresholds (configurable)
const [categoryThresholds, setCategoryThresholds] = useState({
  shortMax: 200,   // mm — below this = A
  mediumMax: 300,  // mm — below this = B, above = C
});

// Detection Tuning
const [jigDetectionParams, setJigDetectionParams] = useState({
  minContourArea: 1000,
  minAspectRatio: 3.0,
  adaptiveBlockSize: 15,
  adaptiveC: 5,
  baseLineTolerance: 30,  // px tolerance for base line proximity
});
```

### 2.2 State Reset on Mode Switch

When entering Jig Mode, clear all manual-mode state (`referenceLine`, `measurements`, `paperCorners`, etc.). When exiting Jig Mode, clear all jig state (`xRuler`, `yRuler`, `baseLine`, `detectedDrills`).

---

## 3. CV Pipelines

### 3.1 Ruler Detection Pipeline: `detectRulers()`

**Goal:** Find the two rulers (horizontal and vertical) and extract tick-mark positions.

```
function detectRulers(canvas):
  src = cv.imread(canvas)
  gray = cv.cvtColor(src, GRAY)
  edges = cv.Canny(gray, 50, 150)

  // --- Step 1: Find dominant lines via Hough Transform ---
  lines = cv.HoughLinesP(edges, rho=1, theta=π/180, threshold=100,
                          minLineLength=200, maxLineGap=10)

  // --- Step 2: Classify lines as horizontal or vertical ---
  horizontalLines = []
  verticalLines = []
  for each line (x1,y1,x2,y2) in lines:
    angle = atan2(y2-y1, x2-x1)
    if abs(angle) < 15°:
      horizontalLines.push(line)
    elif abs(angle - 90°) < 15° or abs(angle + 90°) < 15°:
      verticalLines.push(line)

  // --- Step 3: Cluster parallel lines to find ruler edges ---
  // A ruler appears as two parallel lines (top/bottom edges)
  // Group horizontal lines by Y-coordinate proximity (within 30px)
  xRulerCandidate = findRulerCandidate(horizontalLines, axis='x')
  yRulerCandidate = findRulerCandidate(verticalLines, axis='y')

  // --- Step 4: Extract tick marks for each ruler ---
  xRuler = detectTickMarks(gray, xRulerCandidate, axis='x')
  yRuler = detectTickMarks(gray, yRulerCandidate, axis='y')

  cleanup all Mat objects
  return { xRuler, yRuler }
```

### 3.2 Tick Mark Detection: `detectTickMarks()`

**Goal:** Given a ruler region, find the regular tick marks and compute scale.

```
function detectTickMarks(grayImage, rulerRegion, axis):
  // --- Step 1: Extract narrow strip along the ruler ---
  // For X-ruler: extract a horizontal strip (ruler height ~20px)
  // For Y-ruler: extract a vertical strip (ruler width ~20px)
  strip = cropRegion(grayImage, rulerRegion, padding=10px)

  // --- Step 2: Compute 1D intensity profile ---
  // Sum pixels perpendicular to the ruler direction
  if axis == 'x':
    profile = collapseRows(strip)  // 1D array along X
  else:
    profile = collapseCols(strip)  // 1D array along Y

  // --- Step 3: Find tick marks as intensity peaks/valleys ---
  // Tick marks are dark lines on a light background
  // Apply 1D Gaussian smoothing to reduce noise
  smoothed = gaussianSmooth1D(profile, sigma=3)

  // Find local minima (dark ticks)
  ticks_px = findLocalMinima(smoothed, minProminence=20, minDistance=15px)

  // --- Step 4: Match ticks to regular spacing ---
  // Compute median tick spacing
  spacings = diff(ticks_px)
  medianSpacing = median(spacings)

  // Filter outliers: remove ticks whose spacing deviates >30% from median
  filteredTicks = filterBySpacing(ticks_px, medianSpacing, tolerance=0.3)

  // --- Step 5: Assign real-world values ---
  // Each tick = 1 cm = 10 mm, starting from 0
  ticks = filteredTicks.map((px, i) => ({ px, mm: i * 10 }))

  // --- Step 6: Compute scale factor ---
  // Use linear regression over all tick positions for robustness
  scalePxPerMm = linearRegression(ticks.map(t => t.mm), ticks.map(t => t.px)).slope

  return {
    line: { start: rulerRegion.start, end: rulerRegion.end },
    ticks: ticks,
    scalePxPerMm: abs(scalePxPerMm),
    length: ticks.length * 10  // detected ruler length in mm
  }
```

**Fallback:** If fewer than 5 ticks are detected, fall back to linear two-point calibration using the ruler endpoints. If no ruler is detected at all, prompt the user for manual ruler definition.

### 3.3 Base Line Detection: `detectBaseLine()`

**Goal:** Find the top edge of the drill holder tray.

```
function detectBaseLine(canvas, yRuler):
  src = cv.imread(canvas)
  gray = cv.cvtColor(src, GRAY)
  edges = cv.Canny(gray, 50, 150)

  // Focus on the lower 60% of the measurement area
  // (between the rulers, below the midpoint)
  roi = cropToMeasurementArea(edges, xRuler, yRuler, verticalRange='lower60')

  // Find horizontal lines in this region
  lines = cv.HoughLinesP(roi, 1, π/180, threshold=80,
                          minLineLength=150, maxLineGap=20)

  // Select the topmost strong horizontal line as the base
  horizontalLines = lines.filter(angle < 10°)
  baseLine = horizontalLines.sort(by Y ascending).first()

  cleanup all Mat objects
  return { y: baseLine.y, mmValue: pixelToMm(baseLine.y, yRuler) }
```

### 3.4 Multi-Drill Detection Pipeline: `detectDrills()`

**Goal:** Find all drill bit contours above the base line.

```
function detectDrills(canvas, scaleY, baseLine, params):
  src = cv.imread(canvas)
  gray = cv.cvtColor(src, GRAY)

  // --- Step 1: Adaptive threshold ---
  // Handles non-uniform lighting across the jig
  binary = cv.adaptiveThreshold(gray, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    params.adaptiveBlockSize,  // default 15
    params.adaptiveC)          // default 5

  // --- Step 2: Morphological separation ---
  // Vertical kernel preserves drill shape, breaks horizontal contact
  vertKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 7))
  eroded = cv.erode(binary, vertKernel, iterations=1)
  dilated = cv.dilate(eroded, vertKernel, iterations=1)

  // Standard cleanup
  closeKernel = cv.Mat.ones(5, 5, cv.CV_8U)
  cleaned = cv.morphologyEx(dilated, cv.MORPH_CLOSE, closeKernel)

  // --- Step 3: Find contours ---
  contours = cv.findContours(cleaned, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

  // --- Step 4: Filter and extract drills ---
  drills = []
  for each contour in contours:
    area = cv.contourArea(contour)
    if area < params.minContourArea: continue

    rect = cv.minAreaRect(contour)
    width = min(rect.size.width, rect.size.height)
    height = max(rect.size.width, rect.size.height)
    aspectRatio = height / width
    if aspectRatio < params.minAspectRatio: continue

    vertices = cv.RotatedRect.points(rect)
    bottomY = max(v.y for v in vertices)
    topY = min(v.y for v in vertices)
    centerX = rect.center.x

    // Check proximity to base line
    if abs(bottomY - baseLine.y) > params.baseLineTolerance: continue

    // Calculate real-world height
    heightPx = bottomY - topY
    heightMm = heightPx / scaleY

    // Assign category
    category = categorize(heightMm, categoryThresholds)

    drills.push({
      id: drills.length + 1,
      rect, vertices, topY, bottomY, centerX,
      heightPx, heightMm, category
    })

  // Sort left to right
  drills.sort((a, b) => a.centerX - b.centerX)
  // Re-assign sequential IDs
  drills.forEach((d, i) => d.id = i + 1)

  cleanup all Mat objects
  return drills
```

### 3.5 Categorization Logic

```javascript
function categorize(heightMm, thresholds) {
  if (heightMm < thresholds.shortMax) return 'A';
  if (heightMm < thresholds.mediumMax) return 'B';
  return 'C';
}

const CATEGORY_COLORS = {
  A: '#3B82F6',  // Blue — Short
  B: '#F59E0B',  // Amber — Medium
  C: '#EF4444',  // Red — Long
};

const CATEGORY_LABELS = {
  A: 'Short',
  B: 'Medium',
  C: 'Long',
};
```

---

## 4. Canvas Rendering

### 4.1 Jig Mode Layers

The existing canvas `useEffect` redraw loop gains a new branch when `jigMode` is active:

| Layer | Content | Priority |
|-------|---------|----------|
| **Base** | Source image | 0 |
| **Rulers** | Detected ruler lines in cyan (`#06B6D4`) with tick marks as small perpendicular lines | 1 |
| **Base line** | White dashed horizontal line at `baseLine.y` | 2 |
| **Drill boxes** | Color-coded rotated rectangles per category | 3 |
| **Labels** | `#1: 245mm (B)` above each drill, with background pill in category color | 4 |
| **Selection** | Green highlight border on `selectedDrillId` | 5 |

### 4.2 Ruler Rendering

```
function drawRuler(ctx, ruler, axis):
  // Draw ruler line
  ctx.strokeStyle = '#06B6D4'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(ruler.line.start.x, ruler.line.start.y)
  ctx.lineTo(ruler.line.end.x, ruler.line.end.y)
  ctx.stroke()

  // Draw tick marks
  for each tick in ruler.ticks:
    // Short perpendicular line at each tick position
    drawTickMark(ctx, tick.px, ruler, axis, length=8)
    // Label every 5 cm (50 mm)
    if tick.mm % 50 == 0:
      drawTickLabel(ctx, tick.px, ruler, axis, label=tick.mm/10 + 'cm')
```

### 4.3 Drill Bounding Box Rendering

```
function drawDrill(ctx, drill, isSelected):
  color = isSelected ? '#22C55E' : CATEGORY_COLORS[drill.category]

  // Draw rotated rectangle
  ctx.strokeStyle = color
  ctx.lineWidth = isSelected ? 3 : 2
  ctx.beginPath()
  for i in 0..3:
    ctx.lineTo(drill.vertices[i].x, drill.vertices[i].y)
  ctx.closePath()
  ctx.stroke()

  // Draw label above drill
  label = `#${drill.id}: ${Math.round(drill.heightMm)}mm (${drill.category})`
  drawLabel(ctx, label, drill.centerX, drill.topY - 10, color)
```

---

## 5. UI Components

### 5.1 Mode Selector

Add a top-level toggle in the header area:

```
[Standard Mode] [Jig Mode]
```

When Jig Mode is active, the sidebar renders jig-specific panels instead of the standard calibration/measurement panels.

### 5.2 Jig Mode Sidebar Layout

```
┌─────────────────────────────┐
│ ★ CALIBRATION               │
│ X-Ruler: ✓ 2.51 px/mm       │
│ Y-Ruler: ✓ 2.48 px/mm       │
│ Base Line: ✓ Set             │
│ ⚠ Perspective: 1.2% diff    │
│                              │
│ [Re-detect Rulers]           │
├─────────────────────────────┤
│ ★ DETECTION                  │
│ Sensitivity: ████░░░░ 1000   │
│ Aspect Ratio: ███░░░░ 3.0    │
│                              │
│ [Detect Drills]              │
├─────────────────────────────┤
│ ★ RESULTS (10 drills)        │
│ ┌───┬──────────┬─────┬────┐ │
│ │ # │ Height   │ Cat │    │ │
│ ├───┼──────────┼─────┼────┤ │
│ │ 1 │ 187 mm   │ A   │ ✕  │ │
│ │ 2 │ 245 mm   │ B   │ ✕  │ │
│ │ 3 │ 312 mm   │ C   │ ✕  │ │
│ └───┴──────────┴─────┴────┘ │
│                              │
│ A (Short):  3                │
│ B (Medium): 5                │
│ C (Long):   2                │
│ Total:      10               │
├─────────────────────────────┤
│ ★ CATEGORY THRESHOLDS        │
│ Short max:  [200] mm         │
│ Medium max: [300] mm         │
│                              │
│ [Copy to Clipboard]          │
└─────────────────────────────┘
```

### 5.3 Canvas Interactions (Jig Mode)

| Interaction | Behavior |
|-------------|----------|
| Click on drill bounding box | Select drill (`selectedDrillId`) |
| Drag top edge of selected drill | Adjust `topY`, recalculate height and category |
| Drag base line | Adjust `baseLine.y`, recalculate all drill heights |
| Draw vertical line (when no drills selected) | Manual drill addition |

---

## 6. Data Flow

### 6.1 Primary Flow Sequence

```
Image Upload
    │
    ▼
[Enter Jig Mode]
    │
    ▼
detectRulers()
    ├── Canny edge detection
    ├── HoughLinesP → classify H/V
    ├── detectTickMarks(xRuler)
    │     ├── extract strip → 1D profile
    │     ├── find local minima (ticks)
    │     └── linear regression → scaleX
    └── detectTickMarks(yRuler)
          └── → scaleY
    │
    ▼
detectBaseLine()
    ├── Canny in lower measurement area
    ├── HoughLinesP → horizontal lines
    └── topmost strong line → baseLine
    │
    ▼
[User clicks "Detect Drills"]
    │
    ▼
detectDrills()
    ├── adaptiveThreshold
    ├── erode/dilate (vertical kernel)
    ├── findContours (RETR_EXTERNAL)
    ├── filter: area, aspect ratio, base proximity
    ├── minAreaRect per contour
    ├── heightMm = heightPx / scaleY
    └── categorize(heightMm)
    │
    ▼
Canvas redraw + Sidebar results table
    │
    ▼
[User reviews / corrects / exports]
```

### 6.2 Export Function

```javascript
function exportDrillsToClipboard(drills) {
  const header = 'Index\tHeight(mm)\tCategory';
  const rows = drills.map(d =>
    `${d.id}\t${Math.round(d.heightMm)}\t${d.category}`
  );
  const tsv = [header, ...rows].join('\n');
  navigator.clipboard.writeText(tsv);
}
```

---

## 7. OpenCV.js API Usage

### 7.1 New API Calls (Not Used in Existing Code)

| Function | Purpose | Parameters |
|----------|---------|------------|
| `cv.adaptiveThreshold()` | Local thresholding for uneven lighting | `src, dst, maxVal, adaptiveMethod, thresholdType, blockSize, C` |
| `cv.HoughLinesP()` | Detect line segments | `src, lines, rho, theta, threshold, minLineLength, maxLineGap` |
| `cv.erode()` | Separate touching drills | `src, dst, kernel, anchor, iterations` |
| `cv.dilate()` | Restore shape after erosion | `src, dst, kernel, anchor, iterations` |

### 7.2 Existing API Calls (Reused)

| Function | Current Use | Jig Mode Use |
|----------|-------------|--------------|
| `cv.imread()` | Read canvas to Mat | Same |
| `cv.cvtColor()` | RGB → Gray | Same |
| `cv.Canny()` | Paper detection | Ruler detection, base line detection |
| `cv.findContours()` | Single largest contour | All qualifying contours |
| `cv.minAreaRect()` | Single object rect | Per-drill rect |
| `cv.getStructuringElement()` | Paper morphology | Vertical kernel for drill separation |
| `cv.morphologyEx()` | Paper mask cleanup | Binary image cleanup |

### 7.3 Mat Cleanup

Every CV function must follow the existing pattern of explicit `.delete()` on all `cv.Mat` objects. The `detectDrills()` function will create more intermediate Mats than existing pipelines. Use a try/finally pattern:

```javascript
const mats = [];
try {
  const src = cv.imread(canvas); mats.push(src);
  const gray = new cv.Mat(); mats.push(gray);
  // ... processing ...
} finally {
  mats.forEach(m => m.delete());
}
```

---

## 8. Technical Constraints & Risks

| Constraint | Details | Mitigation |
|------------|---------|------------|
| **Ruler detection accuracy** | Hough Transform may detect non-ruler lines (table edges, box edges) | Filter candidates by: position (edges of image), regular tick-mark pattern, parallel-line pairing |
| **Tick mark detection** | Ruler style varies (engraved vs printed, dark vs light ticks) | Configurable prominence threshold; fallback to two-point linear calibration |
| **Adaptive threshold tuning** | Block size and C constant affect drill boundary accuracy | Exposed as sidebar sliders so user can tune per-image |
| **Performance with many contours** | Processing 20+ contours is fast, but canvas redraw with 20 labeled boxes may lag | Batch canvas operations; use `requestAnimationFrame` for redraw |
| **Touching drills** | Vertical erosion kernel may fail if drills overlap significantly | User can manually add/remove drills as fallback |
| **Image resolution** | Very high-res images (>4K) slow down `findContours` | Downscale for CV processing, map coordinates back to original resolution |

---

## 9. Implementation Roadmap

### Step 1: State & Mode Toggle
- Add `jigMode` state and mode selector toggle to the header
- Add all new state variables (rulers, baseLine, detectedDrills, thresholds, params)
- Implement state reset on mode switch
- Render conditional sidebar (standard vs jig)

### Step 2: Ruler Detection Pipeline
- Implement `detectRulers()` — Canny + HoughLinesP + line classification
- Implement `detectTickMarks()` — strip extraction, 1D profile, peak detection, linear regression
- Render detected rulers on canvas (cyan lines with tick marks)
- Wire up "Re-detect Rulers" button
- Implement manual ruler fallback (draw line + input length)

### Step 3: Base Line Detection
- Implement `detectBaseLine()` — horizontal edge detection in lower measurement area
- Render base line on canvas (white dashed)
- Enable dragging the base line to adjust position

### Step 4: Multi-Drill Detection
- Implement `detectDrills()` — adaptive threshold, morphological separation, multi-contour filtering
- Render color-coded bounding boxes + labels on canvas
- Wire up "Detect Drills" button

### Step 5: Results Panel & Export
- Build sidebar results table with category counts
- Implement category threshold inputs
- Implement `exportDrillsToClipboard()` — TSV format
- Re-categorize drills on threshold change

### Step 6: Manual Corrections
- Implement drill selection (click to highlight)
- Implement "Remove" button per drill
- Implement manual drill addition (draw vertical line)
- Implement top-edge drag to adjust drill height

### Step 7: Refinement & Testing
- Test with multiple jig photographs under varying lighting
- Tune default parameters (block size, C, min area, aspect ratio)
- Add error handling for failed detection at each stage
- Performance testing with 20+ drills
