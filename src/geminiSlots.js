// Gemini API integration for Jig Mode slot occupancy detection

import stripsConfig from './config/strips.json';

const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

export const PROMPT_VERSIONS = [
  { id: 'v1', label: 'V1 — Geometry' },
  { id: 'v2', label: 'V2 — 3-Phase Analysis' },
];

/**
 * Build disambiguation hints grouped by color for the prompt.
 */
function buildStripHints() {
  const byColor = {};
  for (const s of stripsConfig.strips) {
    if (!byColor[s.color_name]) byColor[s.color_name] = [];
    byColor[s.color_name].push(`${s.id} (${s.diameter_mm}mm, ${s.slot_count} slots)`);
  }
  return Object.entries(byColor)
    .map(([color, entries]) => `  ${color}: ${entries.join(', ')}`)
    .join('\n');
}

function buildImageIntro(imageWidth, imageHeight, imageCount) {
  return imageCount > 1
    ? `You are analyzing ${imageCount} photographs of the SAME drill bit storage jig taken from different angles. The jig is BLACK with a cross-hatch grid pattern. Colored plastic strips run as rows through the jig, each containing circular ring holders at regular intervals.

The primary image (first image) is ${imageWidth}×${imageHeight} pixels. Use all images to cross-reference your occupancy decisions — if a slot looks ambiguous in one image, check the other image(s) for confirmation. Report coordinates relative to the FIRST image only.`
    : `You are analyzing a TOP-DOWN photograph of a drill bit storage jig. The jig is BLACK with a cross-hatch grid pattern. Colored plastic strips run as rows through the jig, each containing circular ring holders at regular intervals.

The image is ${imageWidth}×${imageHeight} pixels.`;
}

function buildSharedSections(imageWidth, imageHeight) {
  const hints = buildStripHints();
  return {
    structure: `PHYSICAL STRUCTURE:
Each strip is a colored plastic bar with circular ring holders molded into it. These rings are ALWAYS present — they are part of the strip, NOT drill bits. Each ring has an opening in the center.

STRIP COLORS (Dutch names with hex values):
zwart (#1a1a1a), bruin (#8B4513), groen (#22c55e), grijs (#9ca3af), rood (#ef4444),
geel (#fbbf24), wit (#f1f5f9), oranje (#f97316), blauw (#3b82f6), paars (#a855f7)

KNOWN STRIP TYPES (by color):
${hints}`,
    confidence: `CONFIDENCE SCORING:
For each slot, provide a confidence score between 0.0 and 1.0:
- 0.9–1.0: Very clear — obvious drill geometry or obviously hollow/recessed
- 0.7–0.9: Fairly confident — likely correct but some visual ambiguity
- 0.5–0.7: Uncertain — hard to tell, could go either way
- Below 0.5: Guessing — very unclear, defaulting to EMPTY`,
    task: `TASK:
1. Identify each colored strip visible in the jig.
2. For each strip, count the total number of circular ring holders.
3. For each ring, determine occupancy using the method described above.
4. Rate your confidence for each slot determination.
5. Report the approximate pixel bounding box of each strip and the pixel center of each slot.

Return ONLY valid JSON (no markdown fences) matching this schema:
{
  "strips": [
    {
      "color_name": "<Dutch color name from the list above>",
      "slot_count": <total number of slots detected>,
      "boundingBox": { "x": <px>, "y": <px>, "width": <px>, "height": <px> },
      "slots": [
        { "index": 1, "occupied": true, "confidence": 0.95, "x": <center px X>, "y": <center px Y> },
        { "index": 2, "occupied": false, "confidence": 0.85, "x": <center px X>, "y": <center px Y> }
      ]
    }
  ]
}

IMPORTANT:
- The colored ring holders are part of the strip — do NOT count them as drills.
- Do NOT use color or brightness alone to determine occupancy — empty slots can appear dark, bright, or colored depending on angle and lighting.
- All coordinates are in pixels of the original ${imageWidth}×${imageHeight} image.
- Detect ALL visible strips and ALL slots within each strip.
- Number slots 1 to N from left to right (or top to bottom, depending on strip orientation) within each strip.
- Order strips as they appear in the image.`,
  };
}

const OCCUPANCY_V1 = `HOW TO DETERMINE SLOT OCCUPANCY (TOP-DOWN VIEW):
This is about GEOMETRY, not color or brightness.

- OCCUPIED: The ring opening is FILLED with a metallic drill bit. Look for:
  * Spiral flutes or helical grooves (the distinctive twisted cutting edges of a drill)
  * A solid metallic cylindrical cross-section filling most of the ring
  * Metallic sheen/texture clearly different from the plastic ring
  The drill tip sits AT or ABOVE the ring level — it fills the opening.

- EMPTY: The ring opening is HOLLOW/RECESSED. Look for:
  * You can see the inner wall of the plastic ring — rim edges visible going around an open center
  * The center is recessed/lower than the ring top — it drops away into the holder
  * No metallic drill geometry (flutes, spiral, cutting edges) fills the opening
  * The interior may appear dark, bright, or colored depending on angle and lighting — color does NOT determine occupancy

KEY DISTINCTION: Does metallic drill geometry (flutes/spiral) fill the ring? → OCCUPIED. Is the ring center hollow/recessed with no drill geometry? → EMPTY.

IMPORTANT BIAS: When uncertain, mark as EMPTY. Only mark occupied when you can clearly identify metallic drill geometry filling the ring.`;

const OCCUPANCY_V2 = `ANALYSIS STRATEGY — work systematically in three phases:

Phase 1 — Object Detection (find the "what"):
- Identify the black rectangular jig frame with its cross-hatch grid pattern.
- Isolate each colored strip by its high-contrast color against the black/grey jig.
- Look for metallic textures, flutes (spiral grooves on drills), and light reflections that differ from the matte plastic of the jig and strips.

Phase 2 — Spatial Mapping (find the "where"):
- Overlay a mental grid aligned to the strips and their slot positions.
- Sweep LEFT-TO-RIGHT (or top-to-bottom) across each strip to avoid double-counting.
- Use depth cues: tool angles, overhead perspective, and whether a tool might be hidden behind a taller one.

Phase 3 — Feature Extraction (confirm occupancy per slot):
For each ring holder, apply these three tests:

1. CIRCULAR PROFILE TEST:
   - EMPTY: The ring center shows a hollow circle — you can see the inner wall of the ring and the bottom of the holder (recessed/lower).
   - OCCUPIED: The ring center shows a solid mass — the sharpened face of an end mill or the point of a drill bit fills the opening.

2. MATERIAL CONTRAST TEST:
   - EMPTY: The center matches the plastic material of the jig (matte, uniform).
   - OCCUPIED: The center has a metallic sheen — carbide or high-speed steel glint, clearly different from the surrounding plastic.

3. SHADOW ANALYSIS TEST:
   - EMPTY: A deep, uniform shadow inside the holder — light falls unobstructed into the hole.
   - OCCUPIED: A disrupted shadow — a tool blocks the light, creating irregular shadow patterns or reflections.

OCCUPANCY DECISION:
- OCCUPIED = at least 2 of the 3 tests indicate a tool is present, AND you can identify drill geometry (flutes/spiral/cutting edges).
- EMPTY = the ring center is hollow/recessed with no drill geometry visible.
- IMPORTANT BIAS: When uncertain, mark as EMPTY. Only mark occupied when you can clearly confirm metallic drill geometry.`;

function buildSlotDetectionPrompt(imageWidth, imageHeight, imageCount = 1, version = 'v1') {
  const intro = buildImageIntro(imageWidth, imageHeight, imageCount);
  const shared = buildSharedSections(imageWidth, imageHeight);
  const occupancy = version === 'v2' ? OCCUPANCY_V2 : OCCUPANCY_V1;

  return `${intro}

${shared.structure}

${occupancy}

${shared.confidence}

${shared.task}`;
}

/**
 * Resolve strip IDs from color + slot_count against strips.json.
 */
function resolveStripIds(colorName, slotCount) {
  const candidates = stripsConfig.strips.filter(s => s.color_name === colorName);
  if (candidates.length === 0) {
    return { possible_ids: [], resolved_id: null };
  }

  const exactMatch = candidates.filter(s => s.slot_count === slotCount);
  if (exactMatch.length === 1) {
    return { possible_ids: [exactMatch[0].id], resolved_id: exactMatch[0].id };
  }
  if (exactMatch.length > 1) {
    return { possible_ids: exactMatch.map(s => s.id), resolved_id: null };
  }

  // No exact slot count match — return all same-color candidates
  return { possible_ids: candidates.map(s => s.id), resolved_id: null };
}

function parseSlotDetectionResponse(text, imageWidth, imageHeight) {
  let jsonStr = text.trim();

  // Extract from markdown code fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
  }

  console.log('Gemini slot detection raw response:', text);
  console.log('Extracted JSON string:', jsonStr);
  const data = JSON.parse(jsonStr);

  if (!data.strips || !Array.isArray(data.strips)) {
    throw new Error('Invalid response: missing strips array');
  }

  const strips = data.strips.map((strip, i) => {
    const { possible_ids, resolved_id } = resolveStripIds(strip.color_name, strip.slot_count);
    return {
      index: i,
      color_name: strip.color_name || 'unknown',
      slot_count: strip.slot_count || 0,
      possible_ids,
      resolved_id,
      boundingBox: strip.boundingBox || { x: 0, y: 0, width: 0, height: 0 },
      slots: (strip.slots || []).map(slot => ({
        index: slot.index,
        occupied: !!slot.occupied,
        confidence: typeof slot.confidence === 'number' ? slot.confidence : 1.0,
        x: slot.x || 0,
        y: slot.y || 0,
      })),
    };
  });

  return { strips };
}

/**
 * Resize image if needed and return base64 JPEG.
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
 * Scale all pixel coordinates back to original image dimensions.
 */
function scaleSlotResult(result, factor) {
  result.strips.forEach(strip => {
    strip.boundingBox.x *= factor;
    strip.boundingBox.y *= factor;
    strip.boundingBox.width *= factor;
    strip.boundingBox.height *= factor;
    strip.slots.forEach(slot => {
      slot.x *= factor;
      slot.y *= factor;
    });
  });
}

/**
 * Analyze jig photo(s) for slot occupancy using Gemini API.
 * @param {string} apiKey
 * @param {HTMLImageElement|HTMLImageElement[]} images - single image or array of images
 * @param {string} [model='gemini-3-flash-preview'] - Gemini model ID
 * @param {string} [promptVersion='v1'] - Prompt version ('v1' or 'v2')
 * @returns {Promise<{ strips: Array }>}
 */
export async function analyzeJigSlots(apiKey, images, model = 'gemini-3-flash-preview', promptVersion = 'v1') {
  // Normalize to array
  const imageArray = Array.isArray(images) ? images : [images];
  const encoded = imageArray.map(img => imageToBase64(img));
  const primary = encoded[0];
  const prompt = buildSlotDetectionPrompt(primary.width, primary.height, encoded.length, promptVersion);
  const url = `${GEMINI_API_BASE}/${model}:generateContent`;

  const imageParts = encoded.map(enc => ({
    inline_data: { mime_type: 'image/jpeg', data: enc.base64 },
  }));

  const response = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          ...imageParts,
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
  const parts = json.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').filter(Boolean).pop();
  if (!text) {
    throw new Error('Gemini returned an empty response. Try again with a clearer photo.');
  }

  const result = parseSlotDetectionResponse(text, primary.width, primary.height);

  if (primary.scale < 1) {
    scaleSlotResult(result, 1 / primary.scale);
  }

  if (result.strips.length === 0) {
    throw new Error('No strips detected. Ensure colored strips are visible in the photo.');
  }

  return result;
}
