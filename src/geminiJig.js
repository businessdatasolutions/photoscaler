// Gemini API integration for Jig Mode drill analysis

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

function buildPrompt(imageWidth, imageHeight, thresholds) {
  return `You are analyzing a photograph of a drill bit measurement jig. The jig contains:

1. TWO RULERS: One horizontal ruler along the X-axis and one vertical ruler along the Y-axis. Each ruler measures 0–40 centimeters with tick marks every centimeter.

2. A BASE LINE: The top edge of the drill holder tray — a horizontal line where all drill bits are inserted at the bottom.

3. DRILL BITS: Multiple drill bits standing vertically in the jig, rising above the base line.

The image is ${imageWidth}×${imageHeight} pixels.

TASK:
1. Locate both rulers and their tick marks.
2. Locate the base line (top edge of drill holder tray).
3. Identify every drill bit visible in the image.
4. For each drill, measure its height in millimeters from the base line to the tip using the rulers for scale.
5. Categorize: A (Short, <${thresholds.shortMax}mm), B (Medium, ${thresholds.shortMax}–${thresholds.mediumMax}mm), C (Long, >${thresholds.mediumMax}mm).

Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "xRuler": {
    "startX": <pixel X of 0cm mark>,
    "startY": <pixel Y of ruler>,
    "endX": <pixel X of last visible cm mark>,
    "endY": <pixel Y of ruler>,
    "lengthCm": <visible ruler length in cm>
  },
  "yRuler": {
    "startX": <pixel X of ruler>,
    "startY": <pixel Y of 0cm mark>,
    "endX": <pixel X of ruler>,
    "endY": <pixel Y of last visible cm mark>,
    "lengthCm": <visible ruler length in cm>
  },
  "baseLineY": <pixel Y of base line>,
  "drills": [
    {
      "centerX": <pixel X of drill center>,
      "topY": <pixel Y of drill tip>,
      "bottomY": <pixel Y of drill base>,
      "widthPx": <approximate drill width in pixels>,
      "heightMm": <measured height in millimeters>,
      "category": "A" | "B" | "C"
    }
  ]
}

IMPORTANT:
- All coordinates are in pixels of the original ${imageWidth}×${imageHeight} image.
- Be thorough: detect ALL visible drill bits.
- Measure heights as precisely as possible using the ruler markings.`;
}

function parseGeminiResponse(text, imageWidth, imageHeight, thresholds) {
  // Extract JSON from response (handle markdown fences if present)
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const data = JSON.parse(jsonStr);

  // Transform xRuler
  const xRuler = data.xRuler ? transformRuler(data.xRuler, 'x') : null;
  const yRuler = data.yRuler ? transformRuler(data.yRuler, 'y') : null;

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
      return {
        id: i + 1,
        rect: null,
        vertices: [
          { x: d.centerX - halfW, y: d.topY },
          { x: d.centerX + halfW, y: d.topY },
          { x: d.centerX + halfW, y: d.bottomY },
          { x: d.centerX - halfW, y: d.bottomY },
        ],
        topY: d.topY,
        bottomY: d.bottomY,
        centerX: d.centerX,
        heightPx: d.bottomY - d.topY,
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
        maxOutputTokens: 4096,
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
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
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
