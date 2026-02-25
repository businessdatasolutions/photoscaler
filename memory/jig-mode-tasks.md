# Jig Mode — Gemini Vision API Migration

Reference: [PRD](../docs/prd-jig-mode.md) | [TDD](../docs/tdd-jig-mode.md) | [Issue #11](https://github.com/businessdatasolutions/photoscaler/issues/11)

---

## Completed (OpenCV era)

Tasks 1–10 implemented the original OpenCV-based pipeline (commits 88ce977 through 6877f55).
That code has been replaced by a Gemini API integration.

---

## Gemini Migration

- [x] Create `src/geminiJig.js` — API call, prompt engineering, response parsing
- [x] Add Gemini API key management (localStorage persistence, sidebar input)
- [x] Replace 3-step OpenCV pipeline with single `analyzeWithGemini()` call
- [x] Simplify sidebar: single "Analyze Jig" button, remove detection param sliders & debug toggle
- [x] Remove dead code: `detectRulers()`, `detectBaseLine()`, `detectDrillsJig()`, manual ruler drawing
- [x] Delete `src/rulerDetection.js`
- [x] Remove ruler length modal
- [x] Build passes

## Remaining

- [ ] Test with multiple jig photographs under varying lighting conditions
- [ ] Performance test with 20+ drills in a single image
- [ ] End-to-end test of full Flow F (upload → analyze → categorize → export)
- [ ] Update `docs/tdd-jig-mode.md` to reflect Gemini-based architecture
