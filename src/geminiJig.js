// Gemini API integration for Jig Mode drill analysis

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function buildPrompt(imageWidth, imageHeight, thresholds) {
  return `You are analyzing a photograph of a drill bit measurement jig. The jig contains:

1. ONE VERTICAL MEASURING TAPE: A single measuring tape mounted on the back board of the jig, running vertically (Y-axis). It measures 0–40 centimeters with tick marks every centimeter. This is on the far side of the jig (back wall).

2. AN A4 SHEET OF PAPER: A colored A4 sheet (297mm × 210mm) lying flat on the table beside or in front of the jig. Its near edge (closest to the camera) appears wider in pixels than its far edge due to perspective. Use both edges to compute perspective distortion.

3. A BASE LINE: The top edge of the drill holder tray — a horizontal line where all drill bits are inserted at the bottom.

4. DRILL BITS: Multiple drill bits standing vertically in the jig, rising above the base line. Drills closer to the camera appear proportionally taller in pixels than drills near the back wall.

The image is ${imageWidth}×${imageHeight} pixels.

TASK — follow these steps IN ORDER:

STEP 1 — RULER TICK CALIBRATION:
Find the vertical measuring tape. Record at least 4 observed cm marks with their pixel Y coordinates. Use the spread of ticks to compute an accurate px/mm scale.

STEP 2 — A4 PERSPECTIVE RATIO:
Find the A4 sheet. Measure the pixel length of its near edge (closest to camera) and far edge (furthest from camera). Compute:
  perspectiveRatio = nearEdgePx / farEdgePx   (will be > 1.0 because near side looks larger)
  scalePxPerMm = nearEdgePx / 210   (210mm = short side of A4, use whichever edge is clearer)

STEP 3 — BASE LINE:
Find the base line pixel Y coordinate.

STEP 4 — PER-DRILL MEASUREMENT WITH PERSPECTIVE CORRECTION:
For each drill:
  a) Measure raw height in pixels from base line to drill tip.
  b) Estimate depthRatio: how far the drill is from the front of the jig toward the back wall.
     depthRatio = 0.0 means drill is at the same depth as the ruler (back wall, far side).
     depthRatio = 1.0 means drill is at the very front, closest to the camera.
  c) Compute perspective-corrected height:
     corrected_height_mm = (raw_height_px / ruler_scalePxPerMm) / (1 + depthRatio × (perspectiveRatio - 1))
  d) Categorize: A (Short, <${thresholds.shortMax}mm), B (Medium, ${thresholds.shortMax}–${thresholds.mediumMax}mm), C (Long, >${thresholds.mediumMax}mm).

Return ONLY valid JSON (no markdown fences) matching this schema exactly:
{
  "ruler": {
    "ticks": [
      { "cm": <integer cm value>, "pixelY": <pixel Y coordinate> },
      ...at least 4 entries...
    ]
  },
  "a4Paper": {
    "nearEdgePx": <pixel length of A4 near edge>,
    "farEdgePx": <pixel length of A4 far edge>,
    "perspectiveRatio": <nearEdgePx / farEdgePx>,
    "scalePxPerMm": <px per mm from A4 near edge / 210>
  },
  "baseLineY": <pixel Y of base line>,
  "drills": [
    {
      "centerX": <pixel X of drill center>,
      "topY": <pixel Y of drill tip>,
      "widthPx": <approximate drill width in pixels>,
      "depthRatio": <0.0 = at ruler depth, 1.0 = front of jig>,
      "heightMm": <perspective-corrected height in millimeters>,
      "category": "A or B or C"
    }
  ]
}

IMPORTANT:
- All coordinates are in pixels of the original ${imageWidth}×${imageHeight} image.
- Be thorough: detect ALL visible drill bits.
- The ruler.ticks array must have at least 4 entries spread across the visible ruler range.
- perspectiveRatio should be between 1.0 and 2.0 for a typical ~30-45° camera angle.
- heightMm values must be perspective-corrected as described in Step 4c.`;
}

/**
 * Build a yRuler object from the new ruler.ticks[] data.
 * @param {{ ticks: Array<{cm: number, pixelY: number}> }} rulerData
 * @returns {{ line, ticks, scalePxPerMm, length, refPixelY }}
 */
function buildRulerFromTicks(rulerData) {
  const ticks = (rulerData.ticks || []).slice().sort((a, b) => a.cm - b.cm);
  if (ticks.length < 2) return null;

  // Use linear regression over all ticks for a robust px/mm estimate
  const n = ticks.length;
  let sumMm = 0, sumPx = 0, sumMmPx = 0, sumMm2 = 0;
  for (const t of ticks) {
    const mm = t.cm * 10;
    sumMm += mm;
    sumPx += t.pixelY;
    sumMmPx += mm * t.pixelY;
    sumMm2 += mm * mm;
  }
  // slope = dpx/dmm (could be negative if ruler goes top=0 to bottom=40)
  const slope = (n * sumMmPx - sumMm * sumPx) / (n * sumMm2 - sumMm * sumMm);
  const scalePxPerMm = Math.abs(slope);

  // Reference pixel Y at 0cm
  const intercept = (sumPx - slope * sumMm) / n;
  const refPixelY = intercept; // pixel Y when cm=0

  const firstTick = ticks[0];
  const lastTick = ticks[ticks.length - 1];
  const start = { x: 0, y: firstTick.pixelY };
  const end = { x: 0, y: lastTick.pixelY };

  // Build tick array relative to start (distance in px from start)
  const ticksOut = ticks.map(t => ({
    px: Math.abs(t.pixelY - refPixelY),
    mm: t.cm * 10,
  }));

  const lengthMm = lastTick.cm * 10 - firstTick.cm * 10;

  return {
    line: { start, end },
    ticks: ticksOut,
    scalePxPerMm,
    length: lengthMm,
    refPixelY,
  };
}

/**
 * Build an xRuler-compatible object from the A4 paper scalar data.
 * Used only for the perspective warning UI (scalePxPerMm comparison).
 * @param {{ nearEdgePx, farEdgePx, perspectiveRatio, scalePxPerMm }} a4Data
 * @returns {{ line, ticks, scalePxPerMm, length }}
 */
function buildRulerFromA4(a4Data) {
  if (!a4Data || !a4Data.scalePxPerMm) return null;
  return {
    line: { start: { x: 0, y: 0 }, end: { x: a4Data.nearEdgePx || 0, y: 0 } },
    ticks: [],
    scalePxPerMm: a4Data.scalePxPerMm,
    length: 210,
  };
}

function parseGeminiResponse(text, imageWidth, imageHeight, thresholds) {
  // Extract JSON from response (handle markdown fences, thinking blocks, etc.)
  let jsonStr = text.trim();

  // Try to extract from markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    // Try to find raw JSON object in the text
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
  }

  console.log('Gemini raw response:', text);
  console.log('Extracted JSON string:', jsonStr);
  const data = JSON.parse(jsonStr);

  // Build rulers — support both new schema (ruler.ticks) and old schema (xRuler/yRuler) for backward compat
  let xRuler = null;
  let yRuler = null;

  if (data.ruler && data.ruler.ticks) {
    // New schema
    yRuler = buildRulerFromTicks(data.ruler);
    xRuler = buildRulerFromA4(data.a4Paper);
  } else {
    // Old schema fallback
    xRuler = data.xRuler ? transformRuler(data.xRuler, 'x') : null;
    yRuler = data.yRuler ? transformRuler(data.yRuler, 'y') : null;
  }

  // Transform baseLine
  const baseLine = data.baseLineY != null
    ? {
        y: data.baseLineY,
        mmValue: yRuler
          ? (data.baseLineY - yRuler.line.start.y) / yRuler.scalePxPerMm
          : 0,
      }
    : null;

  // Transform drills
  const drills = (data.drills || [])
    .sort((a, b) => a.centerX - b.centerX)
    .map((d, i) => {
      const halfW = (d.widthPx || 20) / 2;
      const heightMm = d.heightMm || 0;
      const category = heightMm < thresholds.shortMax ? 'A'
        : heightMm < thresholds.mediumMax ? 'B' : 'C';
      // bottomY: use data.baseLineY as fallback (new schema drops bottomY)
      const bottomY = d.bottomY != null ? d.bottomY : (data.baseLineY || 0);
      return {
        id: i + 1,
        rect: null,
        vertices: [
          { x: d.centerX - halfW, y: d.topY },
          { x: d.centerX + halfW, y: d.topY },
          { x: d.centerX + halfW, y: bottomY },
          { x: d.centerX - halfW, y: bottomY },
        ],
        topY: d.topY,
        bottomY,
        centerX: d.centerX,
        heightPx: bottomY - d.topY,
        heightMm,
        category,
      };
    });

  return { xRuler, yRuler, baseLine, drills };
}

function transformRuler(raw, axis) {
  const start = { x: raw.startX, y: raw.startY };
  const end = { x: raw.endX, y: raw.endY };
  const lengthMm = (raw.lengthCm || 40) * 10;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const scalePxPerMm = distPx / lengthMm;

  // Generate synthetic ticks every 10mm (1cm)
  const numTicks = Math.round(raw.lengthCm || 40) + 1;
  const ticks = [];
  for (let i = 0; i < numTicks; i++) {
    const mm = i * 10;
    const t = mm / lengthMm;
    // px = distance along ruler from start in pixels
    ticks.push({ px: t * distPx, mm });
  }

  return {
    line: { start, end },
    ticks,
    scalePxPerMm,
    length: lengthMm,
  };
}

/**
 * Resize image if needed and return base64 JPEG.
 * @param {HTMLImageElement} image
 * @returns {{ base64: string, width: number, height: number }}
 */
function imageToBase64(image) {
  const MAX_DIM = 4096;
  let w = image.naturalWidth;
  let h = image.naturalHeight;
  let scale = 1;

  if (w > MAX_DIM || h > MAX_DIM) {
    scale = MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], width: w, height: h, scale };
}

/**
 * Analyze a jig photo using Gemini API.
 * @param {string} apiKey
 * @param {HTMLImageElement} image
 * @param {{ shortMax: number, mediumMax: number }} thresholds
 * @returns {Promise<{ xRuler, yRuler, baseLine, drills }>}
 */
export async function analyzeJigImage(apiKey, image, thresholds) {
  const { base64, width, height, scale } = imageToBase64(image);
  const prompt = buildPrompt(width, height, thresholds);

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32000,
        thinkingConfig: { thinkingBudget: 4096 },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      const msg = err.error?.message || '';
      if (msg.includes('SERVICE_DISABLED') || msg.includes('has not been used')) {
        throw new Error('Generative Language API is not enabled. Visit console.developers.google.com to enable it for your project, or use a key from aistudio.google.com.');
      }
      throw new Error('Invalid API key. Check your Gemini API key and try again.');
    }
    if (response.status === 429) {
      throw new Error('Rate limited. Please wait a moment and try again.');
    }
    throw new Error(err.error?.message || `Gemini API error (${response.status})`);
  }

  const json = await response.json();
  // Gemini 2.5 may return multiple parts (thinking + text). Find the text part with JSON.
  const parts = json.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').filter(Boolean).pop();
  console.log('Gemini response parts:', parts.length, parts.map(p => (p.text || '').substring(0, 100)));
  if (!text) {
    throw new Error('Gemini returned an empty response. Try again with a clearer photo.');
  }

  const result = parseGeminiResponse(text, width, height, thresholds);

  // If image was downscaled, map coordinates back to original dimensions
  if (scale < 1) {
    const inv = 1 / scale;
    scaleResult(result, inv);
  }

  if (result.drills.length === 0) {
    throw new Error('No drill bits detected. Ensure drill bits are visible in the photo.');
  }

  return result;
}

function scaleResult(result, factor) {
  const scalePoint = (p) => { p.x *= factor; p.y *= factor; };
  const scaleRuler = (r) => {
    if (!r) return;
    scalePoint(r.line.start);
    scalePoint(r.line.end);
    r.ticks.forEach(t => { t.px *= factor; });
    r.scalePxPerMm *= factor;
    if (r.refPixelY != null) r.refPixelY *= factor;
  };
  scaleRuler(result.xRuler);
  scaleRuler(result.yRuler);
  if (result.baseLine) result.baseLine.y *= factor;
  result.drills.forEach(d => {
    d.topY *= factor;
    d.bottomY *= factor;
    d.centerX *= factor;
    d.heightPx *= factor;
    d.vertices.forEach(scalePoint);
  });
}
