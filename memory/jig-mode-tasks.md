# Jig Mode — Drill Position Detection (Slot Occupancy)

Reference: [PRD](../docs/prd-jig-mode.md) | [TDD](../docs/tdd-jig-mode.md) | [strips.json](../src/config/strips.json)

---

## Prior Work (Complete)

- [x] Gemini-based height measurement (`src/geminiJig.js`, "Analyze Jig" button)
- [x] Gemini API key management (localStorage + env var)
- [x] Jig Mode UI (sidebar, canvas overlay, export)

---

## Drill Position Detection Tasks

### 1. Create `src/geminiSlots.js` — Gemini prompt & parser
- [x] `analyzeJigSlots(apiKey, image)` — exported entry point
- [x] `buildSlotDetectionPrompt(width, height)` — prompt for strip/slot detection
- [x] `parseSlotDetectionResponse(text, imageWidth, imageHeight)` — extract JSON, validate, run disambiguation
- [x] `resolveStripIds(detectedStrip)` — match color + slot_count against `strips.json`
- [x] Copy `imageToBase64` and fetch boilerplate from `geminiJig.js`

### 2. Strip ID disambiguation logic
- [x] Auto-resolve unique color+slot_count combos (most strips)
- [x] Flag ambiguous cases for user selection via dropdown

### 3. Add state to `App.jsx`
- [x] `slotDetectionResult`, `slotDetectionError`, `isDetectingSlots`
- [x] Clear new state in `resetJigState()`

### 4. Add `analyzeSlots()` handler in `App.jsx`
- [x] Mirror `analyzeWithGemini()` pattern

### 5. Sidebar UI — "Detect Drill Positions" button
- [x] Purple button below existing "Analyze Jig"
- [x] Shows spinner during analysis

### 6. Sidebar UI — Slot occupancy grid
- [x] Per strip: color swatch + strip ID + circles + occupancy count
- [x] Disambiguation dropdown for ambiguous strips
- [x] Manual toggle: click slot circle to flip occupied↔empty

### 7. Canvas overlay for slot positions
- [x] Dashed strip bounding boxes + slot markers (green=occupied, grey=empty)

### 8. Export slot data
- [x] Extended clipboard export with TSV slot grid

### 9. Testing
- [x] `npm run build` passes
- [ ] Test with angled jig photo (strips and drills visible)
- [ ] Verify strip color detection and slot counting
- [ ] Verify disambiguation dropdown for ambiguous strips
- [ ] Verify manual slot toggle works
- [ ] Verify export includes slot data
