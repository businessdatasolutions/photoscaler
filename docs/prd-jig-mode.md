# Product Requirement Document (PRD): Jig Mode — Ruler-Based Drill Categorization

| Field | Value |
|-------|-------|
| **Document Version** | 1.0 |
| **Status** | Draft |
| **Product Name** | PhotoScale Estimator — Jig Mode |
| **Last Updated** | February 25, 2026 |

---

## 1. Executive Summary

Jig Mode is a new measurement mode for the PhotoScale Estimator that enables **batch measurement and categorization of drill bits** from a single photograph. The user places drill bits upright in a purpose-built measurement jig — a fixture with two physical rulers (0–40 cm) along the X and Y axes. The system automatically detects the rulers, calibrates a two-axis coordinate system, detects individual drill bits, measures their heights, and categorizes them into three industrial sorting bins.

> **Jig** (noun): A purpose-built fixture that holds workpieces in a fixed, repeatable position for measurement or machining.

---

## 2. Goals & Objectives

| Goal | Description |
|------|-------------|
| **Primary** | Batch-measure drill bit heights from a single photograph of the measurement jig |
| **Calibration** | Fully automatic two-axis calibration from the physical rulers — no manual line drawing required |
| **Categorization** | Automatically sort drills into 3 height categories for industrial use |
| **Accuracy** | Achieve ~0.4 mm/px resolution with tick-mark refinement to ~0.2 mm/px |
| **Target Audience** | Industrial tool management, drill bit inventory, batch QA measurement |

---

## 3. Functional Requirements

### 3.1 Automatic Ruler Detection

#### FR 1.0 — Ruler Identification

- The system detects two rulers in the uploaded image: one along the **X-axis** (horizontal) and one along the **Y-axis** (vertical).
- **Detection pipeline:**
  1. Convert image to grayscale.
  2. Apply edge detection (Canny) to identify linear structures.
  3. Use Hough Line Transform to find dominant horizontal and vertical lines.
  4. Identify ruler candidates by locating pairs of parallel lines with regular internal markings (tick marks).
  5. Classify as X-ruler (predominantly horizontal) or Y-ruler (predominantly vertical).

#### FR 1.1 — Tick Mark Detection

- For each detected ruler, extract a narrow strip of pixels along its length.
- Compute a 1D intensity profile perpendicular to the tick direction.
- Detect local minima (dark tick marks on light ruler background) at regular intervals.
- Match detected tick spacing to known intervals (1 cm = 10 mm) to determine the ruler's scale.
- Output: an ordered list of tick positions in pixel coordinates with their corresponding real-world values (0 cm, 1 cm, 2 cm, ..., 40 cm).

#### FR 1.2 — Fallback: Manual Ruler Definition

- If automatic detection fails, the user can manually draw a line along each ruler and input the real-world length (default: 400 mm).
- The system displays a prompt when auto-detection confidence is below a threshold.

### 3.2 Two-Axis Calibration

#### FR 2.0 — Independent Axis Scale Factors

- The system computes independent scale factors for each axis:
  - `scaleX = averageTickSpacingX_px / tickInterval_mm`
  - `scaleY = averageTickSpacingY_px / tickInterval_mm`
- If tick-mark detection is available, the system uses **piecewise-linear calibration** from multiple tick positions, correcting for lens distortion along the ruler length.
- If only two endpoints are available (manual fallback), a simple linear calibration is used.

#### FR 2.1 — Perspective Warning

- If `scaleX` and `scaleY` differ by more than 5%, the system displays a perspective warning.
- The warning is informational — measurements proceed using per-axis scale factors, which inherently compensate for moderate perspective.

| Calibration Mode | Scale Factor | Perspective Handling |
|------------------|-------------|---------------------|
| Single reference (existing) | One global `scaleFactor` | None (assumes orthographic) |
| Paper-based (existing) | Average of horizontal/vertical | Homography correction available |
| **Ruler-based (Jig Mode)** | Independent X and Y factors | Built-in via dual-axis calibration |

### 3.3 Base Line Detection

#### FR 3.0 — Drill Holder Base Detection

- The system auto-detects the **top edge of the drill holder tray** — the horizontal line where all drill bits begin.
- **Detection approach:**
  1. After ruler calibration, focus on the region between the rulers.
  2. Detect the dominant horizontal edge in the lower portion of the measurement area (Canny + Hough).
  3. The base line is the topmost strong horizontal edge of the drill holder tray.
- All drill heights are measured **upward** from this base line.

#### FR 3.1 — Manual Base Line Adjustment

- The user can drag the detected base line up or down to correct its position.
- Alternatively, the user can draw the base line manually if auto-detection fails.

### 3.4 Multi-Drill Detection

#### FR 4.0 — Multi-Object Contour Detection

- **Trigger:** "Detect Drills" button (available after calibration is complete).
- **Detection pipeline:**
  1. Convert image to grayscale.
  2. Apply **adaptive thresholding** (`cv.adaptiveThreshold`, Gaussian, block size 15, C=5) — handles non-uniform lighting across the jig better than global Otsu.
  3. Apply morphological **erosion** with a vertical kernel (3×7) to separate touching drill bits.
  4. Apply morphological **dilation** with the same kernel to restore drill shape.
  5. Standard cleanup: morphological close with 5×5 kernel.
  6. `findContours` with `RETR_EXTERNAL` and `CHAIN_APPROX_SIMPLE`.
  7. Filter contours by:
     - **Minimum area:** > 1000 px (configurable).
     - **Aspect ratio:** height/width > 3:1 (elongated objects only).
     - **Proximity to base line:** bottom of contour within tolerance of the base Y-coordinate.
  8. For each qualifying contour, fit a `minAreaRect`.

- **Key difference from existing detection:** The system keeps **all** qualifying contours, not just the largest one.

#### FR 4.1 — Drill Bounding Box Extraction

For each detected drill, the system extracts:

| Property | Description |
|----------|-------------|
| `topY` | Highest point of the bounding rectangle (pixel Y) |
| `bottomY` | Lowest point (should align with base line) |
| `centerX` | Horizontal center position |
| `heightPx` | Vertical extent in pixels |
| `widthPx` | Horizontal extent in pixels |

Drills are numbered left-to-right by `centerX` position.

### 3.5 Height Measurement & Categorization

#### FR 5.0 — Height Calculation

- Each drill's real-world height: `heightMm = heightPx / scaleY`
- If piecewise-linear calibration is active (FR 2.0), the system maps the drill's `topY` pixel coordinate to a mm value on the Y-axis ruler, then subtracts the base line mm value.

#### FR 5.1 — Automatic Category Assignment

| Category | Label | Height Range | Color | Hex |
|----------|-------|-------------|-------|-----|
| A | Short | < 200 mm | Blue | `#3B82F6` |
| B | Medium | 200–300 mm | Amber | `#F59E0B` |
| C | Long | > 300 mm | Red | `#EF4444` |

- Category thresholds are configurable in the sidebar (default values above).
- Each detected drill is assigned a category based on its measured height.

### 3.6 Visual Overlay

#### FR 6.0 — Canvas Overlay Elements

| Element | Color | Style | Description |
|---------|-------|-------|-------------|
| X-axis ruler | Cyan `#06B6D4` | Solid line with tick marks | Detected horizontal ruler |
| Y-axis ruler | Cyan `#06B6D4` | Solid line with tick marks | Detected vertical ruler |
| Base line | White | Dashed | Top edge of drill holder tray |
| Category A drills | Blue `#3B82F6` | Bounding box | Short drills (< 200 mm) |
| Category B drills | Amber `#F59E0B` | Bounding box | Medium drills (200–300 mm) |
| Category C drills | Red `#EF4444` | Bounding box | Long drills (> 300 mm) |
| Selected drill | Green `#22C55E` | Highlighted box | Drill selected for adjustment |

#### FR 6.1 — Drill Labels

- Each drill displays a label above its bounding box: `#1: 245mm (B)`
- Format: `#<index>: <height>mm (<category>)`

### 3.7 Results Panel

#### FR 7.0 — Sidebar Layout (Jig Mode)

The sidebar switches to a dedicated "Jig Mode" layout:

**1. Calibration Section**
- X-axis ruler status: detected / not detected, px/mm value
- Y-axis ruler status: detected / not detected, px/mm value
- Perspective warning (if X and Y scales differ > 5%)
- Base line status: detected / not detected

**2. Detection Section**
- "Detect Drills" button (enabled after calibration)
- Sensitivity slider (minimum contour area)
- Aspect ratio filter slider

**3. Results Section**
- Drill summary table:

| # | Height (mm) | Category | Action |
|---|-------------|----------|--------|
| 1 | 187 | A (Short) | [Remove] |
| 2 | 245 | B (Medium) | [Remove] |
| 3 | 312 | C (Long) | [Remove] |

- Category summary:
  - Category A: X drills
  - Category B: X drills
  - Category C: X drills
  - **Total: X drills**

#### FR 7.1 — Export

- "Copy to Clipboard" button exports the drill table as tab-separated values:
  ```
  Index	Height(mm)	Category
  1	187	A
  2	245	B
  3	312	C
  ```
- Paste-friendly for spreadsheets (Excel, Google Sheets).

### 3.8 Manual Corrections

#### FR 8.0 — Add Missed Drills

- If auto-detection misses a drill, the user can draw a vertical line from the base line to the drill tip.
- The system calculates height using `scaleY` and adds the drill to the results table.

#### FR 8.1 — Remove False Positives

- Each drill in the results table has a [Remove] button.
- Clicking removes the drill from both the canvas overlay and the results table.

#### FR 8.2 — Adjust Bounding Boxes

- The user can click a detected drill to select it (highlighted in green).
- The user can drag the top edge of the bounding box to adjust the measured height.

---

## 4. User Flows

### Flow F: Jig Mode — Automatic Drill Measurement (Primary)

1. User uploads photo of the measurement jig (drill bits standing upright, rulers along X and Y axes).
2. User selects **"Jig Mode"** from the mode selector.
3. System automatically detects both rulers and calibrates the two-axis coordinate system.
4. System automatically detects the base line (top of drill holder tray).
5. System displays calibration status in the sidebar (scale factors, base line position).
6. User clicks **"Detect Drills"**.
7. System detects all drill bit contours, measures heights, and assigns categories.
8. Canvas shows color-coded bounding boxes with height labels. Sidebar shows results table and category counts.
9. User reviews results, optionally corrects misdetections (add/remove/adjust).
10. User clicks **"Copy to Clipboard"** to export data.

### Flow G: Manual Drill Addition (Fallback)

1. After calibration (steps 1–5 of Flow F), if auto-detection misses drills:
2. User draws a vertical line from the base line to the drill tip.
3. System calculates height and adds the drill to the results table.
4. Drill is automatically categorized and displayed on canvas.

### Flow H: Manual Ruler Calibration (Fallback)

1. If automatic ruler detection fails, the system prompts the user.
2. User draws a line along the X-axis ruler from the 0 mark to the 40 cm mark.
3. System prompts for real-world length (default: 400 mm). User confirms.
4. User draws a line along the Y-axis ruler from the 0 mark to the 40 cm mark.
5. System prompts for real-world length (default: 400 mm). User confirms.
6. Continues from step 4 of Flow F.

---

## 5. Technical Constraints

| Aspect | Specification |
|--------|---------------|
| **Platform** | Client-side web application (React.js + Vite + OpenCV.js) |
| **Multi-object detection** | `findContours` returns all contours; Jig Mode processes all qualifying contours instead of selecting only the largest |
| **Adaptive thresholding** | `cv.adaptiveThreshold` handles non-uniform lighting across the jig. Block size and C constant are tunable via sidebar sliders |
| **Drill separation** | Morphological erosion with a vertical kernel (3×7) separates drills that touch while preserving vertical structure |
| **Performance** | Processing ~20 contours with `minAreaRect` adds negligible overhead. Bottleneck remains the initial `findContours` call |
| **Accuracy target** | With a 40 cm ruler spanning ~1000 px in a typical photo: ~0.4 mm/px base resolution, ~0.2 mm/px with tick-mark refinement |
| **Browser support** | Modern browsers with WebAssembly support (Chrome, Firefox, Safari, Edge) |

---

## 6. Edge Cases & Mitigations

| Edge Case | Mitigation |
|-----------|-----------|
| **Partial ruler visibility** | If fewer than 5 tick marks are detected, fall back to linear calibration from detected endpoints. If detection fails entirely, prompt for manual ruler definition (Flow H). |
| **Non-uniform lighting / shadows** | Adaptive thresholding (block-based) handles local brightness variations. User can adjust sensitivity slider. |
| **Touching / overlapping drills** | Morphological erosion with vertical kernel separates contact points. If separation fails, user manually adds individual drills (Flow G). |
| **Drill bits at slight angles** | `minAreaRect` handles tilted objects. Height is the major axis of the rotated rectangle projected onto the Y-axis. |
| **Reflective drill surfaces (glare)** | Adaptive thresholding is more robust than global thresholding. User can also manually add missed drills. |
| **Ruler not aligned with image axes** | Hough Line Transform detects rulers at any angle. Scale is computed along the ruler's actual direction. |
| **Very short drills (near noise threshold)** | Minimum area filter + aspect ratio filter. Configurable via sidebar sliders. |
| **Scale factor mismatch X vs Y** | >5% difference triggers a warning. System uses per-axis factors, so measurements remain correct under moderate perspective. |

---

## 7. Future Improvements

- **Automatic ruler detection improvement:** Machine-learning-based ruler detection for varied ruler styles and colors.
- **Batch image processing:** Process multiple jig photos in sequence, accumulating results across images.
- **Diameter estimation:** If drill bits are photographed from above, estimate shank diameters.
- **PDF report generation:** Export categorized results as a formatted PDF with the annotated image.
- **Camera capture with guide overlay:** Show an alignment guide on mobile camera for consistent jig photography.
- **Custom categories:** Allow users to define an arbitrary number of categories with custom height ranges and labels.
- **Drill identification:** OCR or barcode reading to identify specific drill bit models.
