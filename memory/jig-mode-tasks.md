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

- [ ] Implement `detectBaseLine()` — Canny + HoughLinesP in lower measurement area
- [ ] Render base line on canvas (white dashed)
- [ ] Enable dragging the base line to adjust Y-position
- [ ] Implement manual base line drawing as fallback
- [ ] Recalculate all drill heights when base line moves
- [ ] Display base line status in sidebar calibration section
- [ ] **Tests:** Verify base line detection on test image, drag adjustment works, height recalculation triggers
- [ ] **Commit & push**

## 5. Multi-Drill Detection

- [ ] Implement `detectDrills()` — adaptive threshold, vertical kernel erosion/dilation, multi-contour filtering
- [ ] Filter contours by minimum area, aspect ratio, and base line proximity
- [ ] Extract bounding box properties (topY, bottomY, centerX, heightPx) per drill
- [ ] Calculate `heightMm` using `scaleY` (or piecewise-linear calibration if available)
- [ ] Sort drills left-to-right and assign sequential IDs
- [ ] Wire up "Detect Drills" button (enabled only after calibration)
- [ ] **Tests:** Verify multi-drill detection on test image, correct height calculations, correct left-to-right ordering
- [ ] **Commit & push**

## 6. Categorization & Canvas Overlay

- [ ] Implement `categorize()` function with configurable thresholds
- [ ] Render color-coded bounding boxes per category (Blue/Amber/Red)
- [ ] Render drill labels above each box: `#1: 245mm (B)`
- [ ] Highlight selected drill in green
- [ ] Implement drill selection via click on bounding box
- [ ] **Tests:** Verify correct category assignment at boundary values (199/200/300/301mm), colors match categories, selection highlight works
- [ ] **Commit & push**

## 7. Results Panel & Export

- [ ] Build sidebar results table (index, height, category, remove button)
- [ ] Display category summary counts
- [ ] Add category threshold inputs (Short max / Medium max) with live re-categorization
- [ ] Implement `exportDrillsToClipboard()` — TSV format
- [ ] Wire up "Copy to Clipboard" button
- [ ] **Tests:** Verify table renders correct data, threshold changes re-categorize drills, clipboard export format is correct
- [ ] **Commit & push**

## 8. Manual Corrections

- [ ] Implement "Remove" button per drill (removes from canvas + results table)
- [ ] Implement manual drill addition by drawing a vertical line from base to tip
- [ ] Implement top-edge drag on selected drill to adjust height
- [ ] Recalculate category on manual height adjustment
- [ ] **Tests:** Verify add/remove/adjust operations, category updates after adjustment
- [ ] **Commit & push**

## 9. Refinement & Polish

- [ ] Test with multiple jig photographs under varying lighting conditions
- [ ] Tune default detection parameters (block size, C, min area, aspect ratio)
- [ ] Add error handling and user-friendly messages for each detection failure mode
- [ ] Performance test with 20+ drills in a single image
- [ ] Add loading spinners during CV processing
- [ ] **Tests:** End-to-end test of full Flow F (upload → detect → categorize → export)
- [ ] **Commit & push**
