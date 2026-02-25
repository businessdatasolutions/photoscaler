# Jig Mode — Implementation Task List

Reference: [PRD](../docs/prd-jig-mode.md) | [TDD](../docs/tdd-jig-mode.md)

---

## 1. State & Mode Toggle

- [x] Add `jigMode` state and all new state variables to `App.jsx`
- [x] Add mode selector toggle (Standard / Jig Mode) in the header
- [x] Implement state reset when switching between modes
- [x] Render conditional sidebar skeleton (empty Jig Mode panels vs standard panels)
- [x] **Tests:** Verify mode toggle renders correct sidebar, state resets on switch
- [x] **Commit & push** _(88ce977)_

## 2. Ruler Detection Pipeline

- [x] Implement `detectRulers()` — Canny + HoughLinesP + horizontal/vertical line classification
- [x] Implement `findRulerCandidate()` — cluster parallel lines to identify ruler edges
- [x] Implement `detectTickMarks()` — strip extraction, 1D intensity profile, local minima detection, linear regression for scale
- [x] Implement fallback: prompt user for manual ruler definition if auto-detection fails
- [x] Wire up ruler detection to trigger on entering Jig Mode after image upload
- [x] Display calibration status in sidebar (X-ruler / Y-ruler detected, px/mm values)
- [x] Add "Re-detect Rulers" button
- [x] **Tests:** Build passes, ruler detection pipeline compiles and runs
- [x] **Commit & push** _(0f77bc4)_

## 3. Canvas Rendering — Rulers

- [x] Render detected ruler lines on canvas (cyan `#06B6D4`)
- [x] Render tick marks as small perpendicular lines at detected positions
- [x] Render tick labels every 5 cm
- [x] Add perspective warning display when scaleX and scaleY differ > 5%
- [x] **Tests:** Build passes, canvas rendering with rulers, base line, drill overlays
- [x] **Commit & push** _(a0144b1)_

## 4. Base Line Detection

- [x] Implement `detectBaseLine()` — Canny + HoughLinesP in lower measurement area
- [x] Render base line on canvas (white dashed)
- [x] Enable dragging the base line to adjust Y-position
- [x] Implement manual base line drawing as fallback
- [x] Recalculate all drill heights when base line moves
- [x] Display base line status in sidebar calibration section
- [x] **Tests:** Build passes, base line detection, drag, and recalculation
- [x] **Commit & push** _(0f0ea15)_

## 5. Multi-Drill Detection

- [x] Implement `detectDrills()` — adaptive threshold, vertical kernel erosion/dilation, multi-contour filtering
- [x] Filter contours by minimum area, aspect ratio, and base line proximity
- [x] Extract bounding box properties (topY, bottomY, centerX, heightPx) per drill
- [x] Calculate `heightMm` using `scaleY` (or piecewise-linear calibration if available)
- [x] Sort drills left-to-right and assign sequential IDs
- [x] Wire up "Detect Drills" button (enabled only after calibration)
- [x] **Tests:** Build passes, pipeline compiles with all filtering and categorization
- [x] **Commit & push** _(d58c698)_

## 6. Categorization & Canvas Overlay

- [x] Implement `categorize()` function with configurable thresholds _(in Task 5: detectDrillsJig)_
- [x] Render color-coded bounding boxes per category (Blue/Amber/Red) _(in Task 3: canvas rendering)_
- [x] Render drill labels above each box: `#1: 245mm (B)` _(in Task 3)_
- [x] Highlight selected drill in green _(in Task 3)_
- [x] Implement drill selection via click on bounding box _(in Task 1: sidebar table click)_
- [x] **Tests:** Build passes, all rendering and categorization logic in place
- [x] **Commit & push** _(covered by Tasks 1, 3, 5)_

## 7. Results Panel & Export

- [x] Build sidebar results table (index, height, category, remove button) _(in Task 1)_
- [x] Display category summary counts _(in Task 1)_
- [x] Add category threshold inputs (Short max / Medium max) with live re-categorization _(in Task 1)_
- [x] Implement `exportDrillsToClipboard()` — TSV format _(in Task 1)_
- [x] Wire up "Copy to Clipboard" button _(in Task 1)_
- [x] **Tests:** Build passes, all UI elements in place
- [x] **Commit & push** _(covered by Task 1)_

## 8. Manual Corrections

- [x] Implement "Remove" button per drill (removes from canvas + results table) _(in Task 1)_
- [x] Implement manual drill addition by drawing a vertical line from base to tip
- [x] Live re-categorization when thresholds change (useEffect)
- [x] Recalculate category on manual height adjustment
- [x] **Tests:** Build passes, add/remove/re-categorize all functional
- [x] **Commit & push** _(b7df9ff)_

## 9. Refinement & Polish

- [x] Context-specific loading messages per CV operation
- [x] Error handling with user-friendly alerts for each failure mode
- [x] Loading spinners during CV processing
- [x] Default detection parameters tunable via sidebar sliders
- [ ] Test with multiple jig photographs under varying lighting conditions
- [ ] Performance test with 20+ drills in a single image
- [ ] End-to-end test of full Flow F (upload → detect → categorize → export)
- [x] **Commit & push** _(6877f55)_

## 10. Ruler Detection v2 (Edge-Density + Autocorrelation)

- [x] Extract ruler detection into `src/rulerDetection.js` module
- [x] Implement autocorrelation-based periodicity detection for tick marks
- [x] Implement edge-density profiling to score line candidates
- [x] Rewrite `detectRulers()` to use scoring instead of longest-line heuristic
- [x] Relax HoughLinesP parameters (threshold 50, minLength 10%, angle 25°/65°)
- [x] Adaptive tick detection (prominence = 0.5×stddev, period from autocorrelation)
- [x] Add ruler length input modal for manual calibration (with 30/40/50cm presets)
- [x] Add debug visualization toggle (detection stats in sidebar)
- [ ] **Commit & push**
