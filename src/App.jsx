import { useState, useRef, useEffect } from 'react';
import { Upload, Ruler, Trash2, RefreshCcw, Info, Check, AlertTriangle, Calculator, Cylinder, Crosshair, Loader2, Circle, FileImage, Move } from 'lucide-react';

// Track OpenCV loading state outside component to survive StrictMode double-mount
let cvLoadingStarted = false;

const PhotoScaleApp = () => {
  // --- State Management ---
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [image, setImage] = useState(null);
  const [scaleFactor, setScaleFactor] = useState(null); // pixels per unit
  const [referenceLine, setReferenceLine] = useState(null); // { start, end, realLength, unit, isDiameter }
  const [measurements, setMeasurements] = useState([]); // Array of { start, end, value, id }

  // CV State
  const [cvReady, setCvReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoDiameter, setAutoDiameter] = useState('');
  const [autoUnit, setAutoUnit] = useState('mm');

  // Calculator State
  const [calcDiameterId, setCalcDiameterId] = useState('');
  const [calcLengthId, setCalcLengthId] = useState('');

  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState(null); // { start, end }
  const [inputModalOpen, setInputModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  // Input State
  const [refInputVal, setRefInputVal] = useState('');
  const [refInputUnit, setRefInputUnit] = useState('cm');
  const [refIsDiameter, setRefIsDiameter] = useState(false);

  // Perspective Correction State
  const [paperCorners, setPaperCorners] = useState(null); // [{x,y}, {x,y}, {x,y}, {x,y}] - TL, TR, BR, BL
  const [correctedImage, setCorrectedImage] = useState(null); // Corrected Image object
  const [paperSize, setPaperSize] = useState('a4'); // 'a4', 'letter', 'custom'
  const [isDetectingPaper, setIsDetectingPaper] = useState(false);
  const [draggingCorner, setDraggingCorner] = useState(null); // Index of corner being dragged
  const [showGrid, setShowGrid] = useState(true); // Show perspective grid overlay

  // Object Detection State
  const [detectedObject, setDetectedObject] = useState(null); // { rect: {x,y,width,height,angle}, heightMm, widthMm }
  const [isDetectingObject, setIsDetectingObject] = useState(false);

  // --- Jig Mode State ---
  const [jigMode, setJigMode] = useState(false);

  // Ruler Calibration
  const [xRuler, setXRuler] = useState(null);
  // { line: {start,end}, ticks: [{px,mm}], scalePxPerMm: Number, length: Number }
  const [yRuler, setYRuler] = useState(null);

  // Base Line
  const [baseLine, setBaseLine] = useState(null);
  // { y: Number, mmValue: Number }

  // Multi-Drill Results
  const [detectedDrills, setDetectedDrills] = useState([]);
  // Array of { id, rect, vertices, topY, bottomY, centerX, heightPx, heightMm, category }
  const [selectedDrillId, setSelectedDrillId] = useState(null);

  // Category Thresholds
  const [categoryThresholds, setCategoryThresholds] = useState({
    shortMax: 200,   // mm — below = A
    mediumMax: 300,  // mm — below = B, above = C
  });

  // Manual ruler drawing: null | 'x' | 'y'
  const [jigDrawingRuler, setJigDrawingRuler] = useState(null);
  // Base line dragging
  const [draggingBaseLine, setDraggingBaseLine] = useState(false);

  // Detection Tuning
  const [jigDetectionParams, setJigDetectionParams] = useState({
    minContourArea: 1000,
    minAspectRatio: 3.0,
    adaptiveBlockSize: 15,
    adaptiveC: 5,
    baseLineTolerance: 30,
  });

  // Paper size definitions in mm
  const PAPER_SIZES = {
    a4: { width: 210, height: 297, label: 'A4 (210×297mm)' },
    letter: { width: 215.9, height: 279.4, label: 'US Letter (8.5×11in)' },
    a5: { width: 148, height: 210, label: 'A5 (148×210mm)' },
  };

  // --- OpenCV Loading ---
  useEffect(() => {
    // Check if already loaded
    if (window.cv && window.cv.getBuildInformation) {
      setCvReady(true);
      return;
    }

    // Prevent double-loading in StrictMode
    if (cvLoadingStarted) {
      // Wait for the other instance to finish loading
      const checkInterval = setInterval(() => {
        if (window.cv && window.cv.getBuildInformation) {
          setCvReady(true);
          clearInterval(checkInterval);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }

    cvLoadingStarted = true;

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.5.4/opencv.js';
    script.async = true;
    script.onload = () => {
      // OpenCV takes a moment to init even after load
      if (window.cv && window.cv.getBuildInformation) {
        setCvReady(true);
      } else if (window.cv) {
        window.cv['onRuntimeInitialized'] = () => {
          setCvReady(true);
        };
      }
    };
    document.body.appendChild(script);
  }, []);

  // --- Image Handling ---
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        // Reset all state on new image
        setReferenceLine(null);
        setScaleFactor(null);
        setMeasurements([]);
        setCurrentLine(null);
        setCalcDiameterId('');
        setCalcLengthId('');
        // Reset perspective state
        setPaperCorners(null);
        setCorrectedImage(null);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- CV Logic: Detect Drill ---
  const detectDrill = () => {
    if (!window.cv || !cvReady || !image) return;
    setIsProcessing(true);

    // Give UI a moment to show loader
    setTimeout(() => {
        try {
            const cv = window.cv;
            const src = cv.imread(canvasRef.current);
            const gray = new cv.Mat();
            const blurred = new cv.Mat();
            const binary = new cv.Mat();

            // 1. Pre-process
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

            // 2. Threshold (Using Otsu's binarization for automatic thresholding)
            cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

            // 3. Find Contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            // 4. Find Largest Contour (The Drill)
            let maxArea = 0;
            let maxCnt = null;

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                // Filter small noise
                if (area > 500 && area > maxArea) {
                    maxArea = area;
                    maxCnt = cnt;
                }
            }

            if (maxCnt) {
                // 5. Get Rotated Rectangle (minAreaRect)
                const rect = cv.minAreaRect(maxCnt);

                const diameterPx = Math.min(rect.size.width, rect.size.height);
                const lengthPx = Math.max(rect.size.width, rect.size.height);

                // Calculate corner points of the rectangle for drawing lines
                const vertices = cv.RotatedRect.points(rect);

                // We need 4 points: p1, p2, p3, p4.
                const v = [
                    {x: vertices[0].x, y: vertices[0].y},
                    {x: vertices[1].x, y: vertices[1].y},
                    {x: vertices[2].x, y: vertices[2].y},
                    {x: vertices[3].x, y: vertices[3].y}
                ];

                // Calculate edge lengths to determine which side is which
                const d1 = Math.sqrt(Math.pow(v[0].x - v[1].x, 2) + Math.pow(v[0].y - v[1].y, 2));
                const d2 = Math.sqrt(Math.pow(v[1].x - v[2].x, 2) + Math.pow(v[1].y - v[2].y, 2));

                let diameterLine, lengthLine;

                // Midpoint helper
                const mid = (p1, p2) => ({ x: (p1.x + p2.x)/2, y: (p1.y + p2.y)/2 });

                // Assign diameter line to the shorter side, length line to the longer side
                if (d1 < d2) {
                    // d1 is diameter side (v0-v1)
                    diameterLine = { start: mid(v[0], v[1]), end: mid(v[2], v[3]) };
                    lengthLine = { start: mid(v[1], v[2]), end: mid(v[3], v[0]) };
                } else {
                    // d2 is diameter side (v1-v2)
                    diameterLine = { start: mid(v[1], v[2]), end: mid(v[3], v[0]) };
                    lengthLine = { start: mid(v[0], v[1]), end: mid(v[2], v[3]) };
                }

                // 6. Apply Measurements based on user input
                const inputD = parseFloat(autoDiameter);
                if (inputD > 0) {
                     const factor = diameterPx / inputD;
                     setScaleFactor(factor);

                     setReferenceLine({
                         start: diameterLine.start,
                         end: diameterLine.end,
                         realLength: inputD,
                         unit: autoUnit,
                         isDiameter: true
                     });

                     const realLength = lengthPx / factor;
                     setMeasurements([{
                         id: Date.now(),
                         start: lengthLine.start,
                         end: lengthLine.end,
                         value: realLength
                     }]);
                }
            } else {
                alert("Could not detect a clear object. Try a high-contrast background.");
            }

            // Cleanup OpenCV objects
            src.delete(); gray.delete(); blurred.delete(); binary.delete(); contours.delete(); hierarchy.delete();

        } catch (e) {
            console.error(e);
            alert("Error processing image. Ensure OpenCV is loaded.");
        }
        setIsProcessing(false);
    }, 100);
  };

  // --- CV Logic: Detect Paper ---
  const detectPaper = () => {
    if (!window.cv || !cvReady || !image) return;
    setIsDetectingPaper(true);

    setTimeout(() => {
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current);
        const gray = new cv.Mat();
        const blurred = new cv.Mat();
        const edges = new cv.Mat();
        const dilated = new cv.Mat();
        const hsv = new cv.Mat();
        const whiteMask = new cv.Mat();
        const maskedGray = new cv.Mat();

        // 1. Create a mask for white/light colored regions (paper detection)
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // White/light paper: very lenient to include shadowed areas
        // saturation < 100, value > 80
        const lowWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, 80, 0]);
        const highWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 100, 255, 0]);
        cv.inRange(hsv, lowWhite, highWhite, whiteMask);
        lowWhite.delete();
        highWhite.delete();

        // Morphological operations to clean up the mask - larger kernel to fill gaps from marker
        const maskKernel = cv.Mat.ones(15, 15, cv.CV_8U);
        // Close holes (multiple iterations to fill larger gaps)
        cv.morphologyEx(whiteMask, whiteMask, cv.MORPH_CLOSE, maskKernel, new cv.Point(-1, -1), 3);
        // Open to remove noise
        cv.morphologyEx(whiteMask, whiteMask, cv.MORPH_OPEN, maskKernel);
        maskKernel.delete();

        // 2. Convert to grayscale
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // 3. Apply the white mask to focus on paper region
        cv.bitwise_and(gray, whiteMask, maskedGray);

        // 4. Apply stronger Gaussian blur to reduce texture noise (wood grain, etc.)
        cv.GaussianBlur(maskedGray, blurred, new cv.Size(9, 9), 0);

        // Try multiple detection strategies
        let paperContour = null;
        let maxArea = 0;

        // STRATEGY 0: Find contours directly on the white mask (most reliable for white paper)
        {
          const contours = new cv.MatVector();
          const hierarchy = new cv.Mat();
          cv.findContours(whiteMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

          for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const peri = cv.arcLength(cnt, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

            if (approx.rows === 4) {
              const area = cv.contourArea(cnt);
              if (area > maxArea && area > (src.rows * src.cols * 0.02)) {
                const pts = [];
                for (let j = 0; j < 4; j++) {
                  pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
                }
                const width1 = Math.sqrt(Math.pow(pts[0].x - pts[1].x, 2) + Math.pow(pts[0].y - pts[1].y, 2));
                const width2 = Math.sqrt(Math.pow(pts[2].x - pts[3].x, 2) + Math.pow(pts[2].y - pts[3].y, 2));
                const height1 = Math.sqrt(Math.pow(pts[1].x - pts[2].x, 2) + Math.pow(pts[1].y - pts[2].y, 2));
                const height2 = Math.sqrt(Math.pow(pts[3].x - pts[0].x, 2) + Math.pow(pts[3].y - pts[0].y, 2));
                const avgWidth = (width1 + width2) / 2;
                const avgHeight = (height1 + height2) / 2;
                const aspectRatio = avgWidth / avgHeight;

                if (aspectRatio > 0.3 && aspectRatio < 3.0) {
                  maxArea = area;
                  paperContour = approx;
                }
              }
            }
          }
          contours.delete();
          hierarchy.delete();
        }

        // Strategy configs: [cannyLow, cannyHigh, dilateIterations, approxEpsilon]
        const strategies = [
          [30, 100, 2, 0.02],   // Lower thresholds with dilation
          [50, 150, 1, 0.02],   // Medium thresholds with some dilation
          [20, 80, 3, 0.03],    // Very low thresholds with more dilation
          [75, 200, 0, 0.02],   // Original strategy (fallback)
        ];

        for (const [cannyLow, cannyHigh, dilateIter, epsilon] of strategies) {
          if (paperContour) break;

          // 3. Canny edge detection
          cv.Canny(blurred, edges, cannyLow, cannyHigh);

          // 4. Dilate to connect broken edges
          if (dilateIter > 0) {
            const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), dilateIter);
            kernel.delete();
          } else {
            edges.copyTo(dilated);
          }

          // 5. Find contours
          const contours = new cv.MatVector();
          const hierarchy = new cv.Mat();
          cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

          // 6. Find the largest 4-sided contour (the paper)
          for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const peri = cv.arcLength(cnt, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, epsilon * peri, true);

            // Check if it's a quadrilateral with significant area (lowered to 2%)
            if (approx.rows === 4) {
              const area = cv.contourArea(cnt);
              if (area > maxArea && area > (src.rows * src.cols * 0.02)) {
                // Additional check: make sure it's roughly rectangular (not too skewed)
                const pts = [];
                for (let j = 0; j < 4; j++) {
                  pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
                }

                // Check aspect ratio is reasonable (between 0.3 and 3.0)
                const width1 = Math.sqrt(Math.pow(pts[0].x - pts[1].x, 2) + Math.pow(pts[0].y - pts[1].y, 2));
                const width2 = Math.sqrt(Math.pow(pts[2].x - pts[3].x, 2) + Math.pow(pts[2].y - pts[3].y, 2));
                const height1 = Math.sqrt(Math.pow(pts[1].x - pts[2].x, 2) + Math.pow(pts[1].y - pts[2].y, 2));
                const height2 = Math.sqrt(Math.pow(pts[3].x - pts[0].x, 2) + Math.pow(pts[3].y - pts[0].y, 2));

                const avgWidth = (width1 + width2) / 2;
                const avgHeight = (height1 + height2) / 2;
                const aspectRatio = avgWidth / avgHeight;

                if (aspectRatio > 0.3 && aspectRatio < 3.0) {
                  maxArea = area;
                  paperContour = approx;
                }
              }
            }
          }

          contours.delete();
          hierarchy.delete();
        }

        if (paperContour) {
          // Extract the 4 corner points
          const points = [];
          for (let i = 0; i < 4; i++) {
            points.push({
              x: paperContour.data32S[i * 2],
              y: paperContour.data32S[i * 2 + 1]
            });
          }

          // Order corners: top-left, top-right, bottom-right, bottom-left
          const orderedCorners = orderCorners(points);
          setPaperCorners(orderedCorners);
        } else {
          alert("Could not detect paper. Try adjusting paper position or manually drag corners after clicking 'Detect Paper' again.");
        }

        // Cleanup
        src.delete();
        gray.delete();
        blurred.delete();
        edges.delete();
        dilated.delete();
        hsv.delete();
        whiteMask.delete();
        maskedGray.delete();

      } catch (e) {
        console.error(e);
        alert("Error detecting paper. Please try again.");
      }
      setIsDetectingPaper(false);
    }, 100);
  };

  // Order corners: top-left, top-right, bottom-right, bottom-left
  const orderCorners = (points) => {
    // Sort by Y first (top vs bottom)
    const sorted = [...points].sort((a, b) => a.y - b.y);
    const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);

    return [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL
  };

  // Apply perspective correction
  const applyPerspectiveCorrection = () => {
    if (!window.cv || !cvReady || !image || !paperCorners) return;
    setIsDetectingPaper(true);

    setTimeout(() => {
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current);

        const paper = PAPER_SIZES[paperSize];
        // Use a scale factor for output resolution (pixels per mm)
        const scale = 3; // 3 pixels per mm = reasonable resolution
        const dstWidth = Math.round(paper.width * scale);
        const dstHeight = Math.round(paper.height * scale);

        // Source points (detected corners)
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          paperCorners[0].x, paperCorners[0].y,
          paperCorners[1].x, paperCorners[1].y,
          paperCorners[2].x, paperCorners[2].y,
          paperCorners[3].x, paperCorners[3].y
        ]);

        // Destination points (rectangular)
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          dstWidth, 0,
          dstWidth, dstHeight,
          0, dstHeight
        ]);

        // Get perspective transform matrix
        const M = cv.getPerspectiveTransform(srcTri, dstTri);

        // Apply the transform
        const dst = new cv.Mat();
        const dsize = new cv.Size(dstWidth, dstHeight);
        cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

        // Convert the result to an image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = dstWidth;
        tempCanvas.height = dstHeight;
        cv.imshow(tempCanvas, dst);

        // Create new Image from the corrected canvas
        const newImg = new Image();
        newImg.onload = () => {
          setCorrectedImage(newImg);
          // Auto-set scale factor based on paper size (pixels per mm)
          setScaleFactor(scale);
          setReferenceLine({
            start: { x: 0, y: 0 },
            end: { x: dstWidth, y: 0 },
            realLength: paper.width,
            unit: 'mm',
            isDiameter: false
          });
          setPaperCorners(null); // Clear corners after applying
        };
        newImg.src = tempCanvas.toDataURL();

        // Cleanup
        src.delete();
        dst.delete();
        srcTri.delete();
        dstTri.delete();
        M.delete();

      } catch (e) {
        console.error(e);
        alert("Error applying perspective correction.");
      }
      setIsDetectingPaper(false);
    }, 100);
  };

  // Reset perspective correction
  const resetPerspective = () => {
    setCorrectedImage(null);
    setPaperCorners(null);
    setReferenceLine(null);
    setScaleFactor(null);
    setMeasurements([]);
    setDetectedObject(null);
  };

  // Calibrate scale from paper corners without applying perspective correction
  const calibrateFromPaper = () => {
    if (!paperCorners) return;

    const paper = PAPER_SIZES[paperSize];

    // Calculate paper dimensions in pixels from detected corners
    // Top edge: TL to TR
    const topEdgePx = getDistance(paperCorners[0], paperCorners[1]);
    // Bottom edge: BL to BR
    const bottomEdgePx = getDistance(paperCorners[3], paperCorners[2]);
    // Left edge: TL to BL
    const leftEdgePx = getDistance(paperCorners[0], paperCorners[3]);
    // Right edge: TR to BR
    const rightEdgePx = getDistance(paperCorners[1], paperCorners[2]);

    // Average width and height in pixels
    const avgWidthPx = (topEdgePx + bottomEdgePx) / 2;
    const avgHeightPx = (leftEdgePx + rightEdgePx) / 2;

    // Calculate pixels per mm (average of horizontal and vertical)
    const pxPerMmWidth = avgWidthPx / paper.width;
    const pxPerMmHeight = avgHeightPx / paper.height;
    const avgPxPerMm = (pxPerMmWidth + pxPerMmHeight) / 2;

    setScaleFactor(avgPxPerMm);
    setReferenceLine({
      start: paperCorners[0],
      end: paperCorners[1],
      realLength: paper.width,
      unit: 'mm',
      isDiameter: false
    });

    // Clear paper corners overlay but keep the scale
    setPaperCorners(null);
  };

  // --- CV Logic: Detect Object ---
  const detectObject = () => {
    if (!window.cv || !cvReady || !image) return;
    // Need either corrected image OR calibrated scale from paper
    if (!correctedImage && !scaleFactor) return;
    setIsDetectingObject(true);

    setTimeout(() => {
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current);
        const hsv = new cv.Mat();
        const objectMask = new cv.Mat();

        // Convert to HSV
        cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
        cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

        // Find non-white regions (objects on paper)
        // White: low saturation, high value. Object: NOT white
        const lowWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, 180, 0]);
        const highWhite = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 40, 255, 0]);
        cv.inRange(hsv, lowWhite, highWhite, objectMask);
        lowWhite.delete();
        highWhite.delete();

        // Invert: we want the object (non-white)
        cv.bitwise_not(objectMask, objectMask);

        // Clean up mask
        const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(objectMask, objectMask, cv.MORPH_OPEN, kernel);
        cv.morphologyEx(objectMask, objectMask, cv.MORPH_CLOSE, kernel);
        kernel.delete();

        // Find contours
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(objectMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Find largest contour
        let maxArea = 0;
        let maxContour = null;

        for (let i = 0; i < contours.size(); i++) {
          const cnt = contours.get(i);
          const area = cv.contourArea(cnt);
          // Filter small noise (minimum 100 pixels)
          if (area > maxArea && area > 100) {
            maxArea = area;
            maxContour = cnt;
          }
        }

        if (maxContour) {
          // Get rotated bounding rectangle
          const rect = cv.minAreaRect(maxContour);

          // Calculate dimensions in mm (scale = 3 px/mm from perspective correction)
          const scale = scaleFactor || 3; // pixels per mm
          const widthMm = Math.min(rect.size.width, rect.size.height) / scale;
          const heightMm = Math.max(rect.size.width, rect.size.height) / scale;

          // Get corner points of the rotated rect
          const vertices = cv.RotatedRect.points(rect);

          setDetectedObject({
            center: { x: rect.center.x, y: rect.center.y },
            size: { width: rect.size.width, height: rect.size.height },
            angle: rect.angle,
            vertices: vertices,
            widthMm: widthMm,
            heightMm: heightMm
          });
        } else {
          alert("No object detected on paper.");
          setDetectedObject(null);
        }

        // Cleanup
        src.delete();
        hsv.delete();
        objectMask.delete();
        contours.delete();
        hierarchy.delete();

      } catch (e) {
        console.error(e);
        alert("Error detecting object.");
      }
      setIsDetectingObject(false);
    }, 100);
  };

  // --- Jig Mode CV: Ruler Detection ---
  const detectRulers = () => {
    if (!window.cv || !cvReady || !image) return;
    setIsProcessing(true);

    setTimeout(() => {
      const mats = [];
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current); mats.push(src);
        const gray = new cv.Mat(); mats.push(gray);
        const edges = new cv.Mat(); mats.push(edges);
        const lines = new cv.Mat(); mats.push(lines);

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
        cv.Canny(gray, edges, 50, 150);

        // Detect line segments via Hough Transform
        const minLineLength = Math.min(src.cols, src.rows) * 0.15;
        cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 80, minLineLength, 15);

        // Classify lines as horizontal or vertical
        const horizontalLines = [];
        const verticalLines = [];
        for (let i = 0; i < lines.rows; i++) {
          const x1 = lines.data32S[i * 4];
          const y1 = lines.data32S[i * 4 + 1];
          const x2 = lines.data32S[i * 4 + 2];
          const y2 = lines.data32S[i * 4 + 3];
          const angle = Math.abs(Math.atan2(y2 - y1, x2 - x1)) * (180 / Math.PI);

          if (angle < 20) {
            horizontalLines.push({ x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) });
          } else if (angle > 70 && angle < 110) {
            verticalLines.push({ x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) });
          }
        }

        // Find ruler candidates by clustering parallel lines
        const xRulerResult = findRulerCandidate(gray, horizontalLines, 'x', src);
        const yRulerResult = findRulerCandidate(gray, verticalLines, 'y', src);

        if (xRulerResult) setXRuler(xRulerResult);
        if (yRulerResult) setYRuler(yRulerResult);

        if (!xRulerResult && !yRulerResult) {
          alert('Could not detect rulers. Try manual calibration or ensure rulers are visible with good contrast.');
        }

      } catch (e) {
        console.error('Ruler detection error:', e);
        alert('Error detecting rulers: ' + e.message);
      } finally {
        mats.forEach(m => m.delete());
      }
      setIsProcessing(false);
    }, 100);
  };

  const findRulerCandidate = (gray, lines, axis, src) => {
    if (lines.length < 2) return null;

    // Sort lines by length (longest first)
    lines.sort((a, b) => b.length - a.length);

    // Try the longest lines as ruler candidates
    // A ruler is a long straight region with regular tick marks
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i];
      const tickResult = detectTickMarks(gray, line, axis, src);
      if (tickResult && tickResult.ticks.length >= 5) {
        return tickResult;
      }
    }

    // Fallback: use the two longest lines as ruler endpoints
    if (lines.length >= 1) {
      const longest = lines[0];
      const start = { x: longest.x1, y: longest.y1 };
      const end = { x: longest.x2, y: longest.y2 };
      const lengthPx = Math.hypot(end.x - start.x, end.y - start.y);
      const defaultLengthMm = 400; // 40 cm default
      return {
        line: { start, end },
        ticks: [{ px: 0, mm: 0 }, { px: lengthPx, mm: defaultLengthMm }],
        scalePxPerMm: lengthPx / defaultLengthMm,
        length: defaultLengthMm,
      };
    }

    return null;
  };

  const detectTickMarks = (gray, line, axis, src) => {
    const cv = window.cv;
    const mats = [];

    try {
      // Extract a narrow strip of pixels along the line
      const stripWidth = 30; // pixels perpendicular to the ruler direction
      const x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;

      let profile = [];

      if (axis === 'x') {
        // Horizontal ruler: extract horizontal strip, compute column averages
        const minX = Math.max(0, Math.min(x1, x2));
        const maxX = Math.min(src.cols - 1, Math.max(x1, x2));
        const centerY = Math.round((y1 + y2) / 2);
        const yStart = Math.max(0, centerY - Math.floor(stripWidth / 2));
        const yEnd = Math.min(src.rows - 1, centerY + Math.floor(stripWidth / 2));

        // Extract region of interest
        const roi = gray.roi(new cv.Rect(minX, yStart, maxX - minX, yEnd - yStart));
        mats.push(roi);

        // Compute column-wise average (1D intensity profile along X)
        for (let col = 0; col < roi.cols; col++) {
          let sum = 0;
          for (let row = 0; row < roi.rows; row++) {
            sum += roi.ucharAt(row, col);
          }
          profile.push({ pos: minX + col, value: sum / roi.rows });
        }
      } else {
        // Vertical ruler: extract vertical strip, compute row averages
        const minY = Math.max(0, Math.min(y1, y2));
        const maxY = Math.min(src.rows - 1, Math.max(y1, y2));
        const centerX = Math.round((x1 + x2) / 2);
        const xStart = Math.max(0, centerX - Math.floor(stripWidth / 2));
        const xEnd = Math.min(src.cols - 1, centerX + Math.floor(stripWidth / 2));

        const roi = gray.roi(new cv.Rect(xStart, minY, xEnd - xStart, maxY - minY));
        mats.push(roi);

        // Compute row-wise average (1D intensity profile along Y)
        for (let row = 0; row < roi.rows; row++) {
          let sum = 0;
          for (let col = 0; col < roi.cols; col++) {
            sum += roi.ucharAt(row, col);
          }
          profile.push({ pos: minY + row, value: sum / roi.cols });
        }
      }

      if (profile.length < 50) return null;

      // Smooth the profile with a simple moving average
      const smoothed = smoothProfile(profile.map(p => p.value), 5);

      // Find local minima (dark tick marks on light background)
      const minDistance = 15; // minimum pixels between ticks
      const ticks_px = findLocalMinima(smoothed, minDistance, 20);

      if (ticks_px.length < 3) return null;

      // Map tick pixel indices back to image coordinates
      const tickPositions = ticks_px.map(idx => profile[idx].pos);

      // Compute spacings between consecutive ticks
      const spacings = [];
      for (let i = 1; i < tickPositions.length; i++) {
        spacings.push(Math.abs(tickPositions[i] - tickPositions[i - 1]));
      }

      // Find median spacing (= 1 cm = 10mm in real world)
      const medianSpacing = median(spacings);

      // Filter out ticks whose spacing deviates >40% from median
      const filteredTicks = [tickPositions[0]];
      for (let i = 1; i < tickPositions.length; i++) {
        const spacing = Math.abs(tickPositions[i] - tickPositions[i - 1]);
        if (Math.abs(spacing - medianSpacing) / medianSpacing < 0.4) {
          filteredTicks.push(tickPositions[i]);
        }
      }

      if (filteredTicks.length < 3) return null;

      // Assign real-world values: each tick = 1 cm = 10 mm
      const ticks = filteredTicks.map((px, i) => ({ px, mm: i * 10 }));

      // Compute scale factor via linear regression
      const scalePxPerMm = medianSpacing / 10; // pixels per mm

      // Construct ruler line endpoints
      const start = axis === 'x'
        ? { x: filteredTicks[0], y: Math.round((y1 + y2) / 2) }
        : { x: Math.round((x1 + x2) / 2), y: filteredTicks[0] };
      const end = axis === 'x'
        ? { x: filteredTicks[filteredTicks.length - 1], y: Math.round((y1 + y2) / 2) }
        : { x: Math.round((x1 + x2) / 2), y: filteredTicks[filteredTicks.length - 1] };

      return {
        line: { start, end },
        ticks,
        scalePxPerMm,
        length: ticks[ticks.length - 1].mm,
      };
    } catch (e) {
      console.error('Tick detection error:', e);
      return null;
    } finally {
      mats.forEach(m => m.delete());
    }
  };

  // --- Jig Mode CV: Base Line Detection ---
  const detectBaseLine = () => {
    if (!window.cv || !cvReady || !image) return;
    setIsProcessing(true);

    setTimeout(() => {
      const mats = [];
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current); mats.push(src);
        const gray = new cv.Mat(); mats.push(gray);
        const edges = new cv.Mat(); mats.push(edges);
        const lines = new cv.Mat(); mats.push(lines);

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);
        cv.Canny(gray, edges, 50, 150);

        // Focus on the lower 60% of the image (where the base typically is)
        const roiY = Math.floor(src.rows * 0.4);
        const roiHeight = src.rows - roiY;
        const roi = edges.roi(new cv.Rect(0, roiY, src.cols, roiHeight));
        mats.push(roi);

        cv.HoughLinesP(roi, lines, 1, Math.PI / 180, 60, src.cols * 0.2, 20);

        // Find the topmost strong horizontal line in the ROI
        let bestY = Infinity;

        for (let i = 0; i < lines.rows; i++) {
          const x1 = lines.data32S[i * 4];
          const y1 = lines.data32S[i * 4 + 1];
          const x2 = lines.data32S[i * 4 + 2];
          const y2 = lines.data32S[i * 4 + 3];
          const angle = Math.abs(Math.atan2(y2 - y1, x2 - x1)) * (180 / Math.PI);
          const length = Math.hypot(x2 - x1, y2 - y1);

          if (angle < 15 && length > src.cols * 0.15) {
            const avgY = (y1 + y2) / 2 + roiY;
            if (avgY < bestY) {
              bestY = avgY;
            }
          }
        }

        if (bestY < Infinity) {
          const baseY = Math.round(bestY);
          let mmValue = 0;
          if (yRuler && yRuler.ticks.length >= 2) {
            mmValue = (baseY - yRuler.ticks[0].px) / yRuler.scalePxPerMm;
          }
          setBaseLine({ y: baseY, mmValue });
        } else {
          const fallbackY = Math.round(src.rows * 0.75);
          setBaseLine({ y: fallbackY, mmValue: 0 });
          alert('Could not auto-detect base line. Drag the white dashed line to the correct position.');
        }

      } catch (e) {
        console.error('Base line detection error:', e);
        alert('Error detecting base line: ' + e.message);
      } finally {
        mats.forEach(m => m.delete());
      }
      setIsProcessing(false);
    }, 100);
  };

  // --- Jig Mode CV: Multi-Drill Detection ---
  const detectDrillsJig = () => {
    if (!window.cv || !cvReady || !image || !yRuler || !baseLine) return;
    setIsProcessing(true);

    setTimeout(() => {
      const mats = [];
      try {
        const cv = window.cv;
        const src = cv.imread(canvasRef.current); mats.push(src);
        const gray = new cv.Mat(); mats.push(gray);
        const binary = new cv.Mat(); mats.push(binary);

        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        // Adaptive threshold handles non-uniform lighting
        cv.adaptiveThreshold(
          gray, binary, 255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY_INV,
          jigDetectionParams.adaptiveBlockSize,
          jigDetectionParams.adaptiveC
        );

        // Vertical kernel to separate touching drills
        const vertKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 7));
        mats.push(vertKernel);
        const eroded = new cv.Mat(); mats.push(eroded);
        const dilated = new cv.Mat(); mats.push(dilated);
        cv.erode(binary, eroded, vertKernel, new cv.Point(-1, -1), 1);
        cv.dilate(eroded, dilated, vertKernel, new cv.Point(-1, -1), 1);

        // Standard cleanup
        const closeKernel = cv.Mat.ones(5, 5, cv.CV_8U); mats.push(closeKernel);
        cv.morphologyEx(dilated, dilated, cv.MORPH_CLOSE, closeKernel);

        // Find contours
        const contours = new cv.MatVector(); mats.push(contours);
        const hierarchy = new cv.Mat(); mats.push(hierarchy);
        cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const drills = [];
        const tolerance = jigDetectionParams.baseLineTolerance;

        for (let i = 0; i < contours.size(); i++) {
          const cnt = contours.get(i);
          const area = cv.contourArea(cnt);
          if (area < jigDetectionParams.minContourArea) continue;

          const rect = cv.minAreaRect(cnt);
          const w = Math.min(rect.size.width, rect.size.height);
          const h = Math.max(rect.size.width, rect.size.height);
          const aspectRatio = h / w;
          if (aspectRatio < jigDetectionParams.minAspectRatio) continue;

          const vertices = cv.RotatedRect.points(rect);
          const vArr = Array.from({ length: 4 }, (_, j) => ({
            x: vertices[j].x, y: vertices[j].y
          }));

          const bottomY = Math.max(...vArr.map(v => v.y));
          const topY = Math.min(...vArr.map(v => v.y));
          const centerX = rect.center.x;

          // Check proximity to base line
          if (Math.abs(bottomY - baseLine.y) > tolerance) continue;

          const heightPx = baseLine.y - topY;
          const heightMm = heightPx / yRuler.scalePxPerMm;

          // Skip negative or tiny heights
          if (heightMm < 10) continue;

          const category = heightMm < categoryThresholds.shortMax ? 'A'
            : heightMm < categoryThresholds.mediumMax ? 'B' : 'C';

          drills.push({
            id: 0,
            rect: { center: rect.center, size: rect.size, angle: rect.angle },
            vertices: vArr,
            topY, bottomY, centerX, heightPx, heightMm, category,
          });
        }

        // Sort left to right and assign IDs
        drills.sort((a, b) => a.centerX - b.centerX);
        drills.forEach((d, idx) => { d.id = idx + 1; });

        setDetectedDrills(drills);

        if (drills.length === 0) {
          alert('No drills detected. Try adjusting the sensitivity or base line position.');
        }

      } catch (e) {
        console.error('Drill detection error:', e);
        alert('Error detecting drills: ' + e.message);
      } finally {
        mats.forEach(m => { try { m.delete(); } catch (_) {} });
      }
      setIsProcessing(false);
    }, 100);
  };

  // --- Jig Mode Helpers ---
  const smoothProfile = (values, windowSize) => {
    const result = [];
    const half = Math.floor(windowSize / 2);
    for (let i = 0; i < values.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
        sum += values[j];
        count++;
      }
      result.push(sum / count);
    }
    return result;
  };

  const findLocalMinima = (values, minDistance, minProminence) => {
    const minima = [];
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
        // Check prominence: difference from surrounding peaks
        let leftMax = values[i], rightMax = values[i];
        for (let j = Math.max(0, i - minDistance); j < i; j++) leftMax = Math.max(leftMax, values[j]);
        for (let j = i + 1; j <= Math.min(values.length - 1, i + minDistance); j++) rightMax = Math.max(rightMax, values[j]);
        const prominence = Math.min(leftMax - values[i], rightMax - values[i]);
        if (prominence >= minProminence) {
          // Check minimum distance from last accepted minimum
          if (minima.length === 0 || i - minima[minima.length - 1] >= minDistance) {
            minima.push(i);
          }
        }
      }
    }
    return minima;
  };

  const median = (arr) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  // --- Geometry Helpers ---
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  // --- Homography Utilities (for grid projection) ---
  const solveLinearSystem = (A, b) => {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      let pivotRow = i;
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(M[j][i]) > Math.abs(M[pivotRow][i])) pivotRow = j;
      }
      const temp = M[i];
      M[i] = M[pivotRow];
      M[pivotRow] = temp;

      if (Math.abs(M[i][i]) < 1e-12) return null;

      const pivot = M[i][i];
      for (let j = i; j <= n; j++) M[i][j] /= pivot;

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k][i];
          for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
        }
      }
    }
    return M.map(row => row[n]);
  };

  const computeHomography = (srcPoints, dstPoints) => {
    if (srcPoints.length !== 4 || dstPoints.length !== 4) return null;
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const sx = srcPoints[i].x;
      const sy = srcPoints[i].y;
      const dx = dstPoints[i].x;
      const dy = dstPoints[i].y;
      A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
      b.push(dx);
      A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
      b.push(dy);
    }
    const h = solveLinearSystem(A, b);
    if (!h) return null;
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  };

  const applyHomography = (H, p) => {
    const rho = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
    return {
      x: (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / rho,
      y: (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / rho
    };
  };

  const applyInverseHomography = (H, p) => {
    const det = (
      H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) -
      H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) +
      H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0])
    );
    if (Math.abs(det) < 1e-12) return null;
    const invH = [
      [(H[1][1] * H[2][2] - H[1][2] * H[2][1]) / det, (H[0][2] * H[2][1] - H[0][1] * H[2][2]) / det, (H[0][1] * H[1][2] - H[0][2] * H[1][1]) / det],
      [(H[1][2] * H[2][0] - H[1][0] * H[2][2]) / det, (H[0][0] * H[2][2] - H[0][2] * H[2][0]) / det, (H[0][2] * H[1][0] - H[0][0] * H[1][2]) / det],
      [(H[1][0] * H[2][1] - H[1][1] * H[2][0]) / det, (H[0][1] * H[2][0] - H[0][0] * H[2][1]) / det, (H[0][0] * H[1][1] - H[0][1] * H[1][0]) / det]
    ];
    return applyHomography(invH, p);
  };

  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  // --- Corner Dragging Handlers ---
  const findNearestCorner = (coords, threshold = 30) => {
    if (!paperCorners) return null;
    for (let i = 0; i < paperCorners.length; i++) {
      const dist = getDistance(coords, paperCorners[i]);
      if (dist < threshold) return i;
    }
    return null;
  };

  const handleCornerDrag = (e) => {
    if (draggingCorner === null || !paperCorners) return;
    const coords = getCanvasCoordinates(e);
    const newCorners = [...paperCorners];
    newCorners[draggingCorner] = coords;
    setPaperCorners(newCorners);
  };

  // --- Drawing Handlers ---
  const startDrawing = (e) => {
    if (!image) return;
    const coords = getCanvasCoordinates(e);

    // Check if clicking on a corner for dragging
    if (paperCorners) {
      const cornerIdx = findNearestCorner(coords);
      if (cornerIdx !== null) {
        setDraggingCorner(cornerIdx);
        return;
      }
    }

    // Don't allow drawing while corners are shown
    if (paperCorners) return;

    // Jig mode: check if clicking near the base line for dragging
    if (jigMode && baseLine && Math.abs(coords.y - baseLine.y) < 15) {
      setDraggingBaseLine(true);
      return;
    }

    // In jig mode, only allow drawing when in manual ruler mode
    if (jigMode && !jigDrawingRuler) return;

    setIsDrawing(true);
    setCurrentLine({ start: coords, end: coords });
  };

  const draw = (e) => {
    // Handle corner dragging
    if (draggingCorner !== null) {
      handleCornerDrag(e);
      return;
    }

    // Handle base line dragging
    if (draggingBaseLine) {
      const coords = getCanvasCoordinates(e);
      let mmValue = 0;
      if (yRuler && yRuler.ticks.length >= 2) {
        mmValue = (coords.y - yRuler.ticks[0].px) / yRuler.scalePxPerMm;
      }
      setBaseLine({ y: coords.y, mmValue });
      return;
    }

    if (!isDrawing || !currentLine) return;
    const coords = getCanvasCoordinates(e);
    setCurrentLine({ ...currentLine, end: coords });
  };

  const endDrawing = () => {
    // End corner dragging
    if (draggingCorner !== null) {
      setDraggingCorner(null);
      return;
    }

    // End base line dragging — recalculate all drill heights
    if (draggingBaseLine) {
      setDraggingBaseLine(false);
      if (detectedDrills.length > 0 && yRuler) {
        setDetectedDrills(prev => prev.map(drill => {
          const heightPx = baseLine.y - drill.topY;
          const heightMm = heightPx / yRuler.scalePxPerMm;
          const category = heightMm < categoryThresholds.shortMax ? 'A'
            : heightMm < categoryThresholds.mediumMax ? 'B' : 'C';
          return { ...drill, heightPx, heightMm, category };
        }));
      }
      return;
    }

    if (!isDrawing || !currentLine) return;
    setIsDrawing(false);

    const dist = getDistance(currentLine.start, currentLine.end);
    if (dist < 5) {
      setCurrentLine(null);
      return;
    }

    // Jig Mode: manual ruler drawing
    if (jigMode && jigDrawingRuler) {
      const lengthPx = dist;
      const defaultLengthMm = 400;
      const rulerData = {
        line: { start: currentLine.start, end: currentLine.end },
        ticks: [{ px: 0, mm: 0 }, { px: lengthPx, mm: defaultLengthMm }],
        scalePxPerMm: lengthPx / defaultLengthMm,
        length: defaultLengthMm,
      };
      if (jigDrawingRuler === 'x') {
        setXRuler(rulerData);
      } else {
        setYRuler(rulerData);
      }
      setJigDrawingRuler(null);
      setCurrentLine(null);
      return;
    }

    if (!referenceLine) {
      // Reset the checkbox state for a fresh reference line
      setRefIsDiameter(false);
      setInputModalOpen(true);
    } else {
      const realValue = dist / scaleFactor;
      const newMeasurement = {
        id: Date.now(),
        start: currentLine.start,
        end: currentLine.end,
        value: realValue
      };

      const newMeasurements = [...measurements, newMeasurement];
      setMeasurements(newMeasurements);

      if (!referenceLine.isDiameter) {
          if (!calcDiameterId && newMeasurements.length === 1) {
             setCalcDiameterId(newMeasurement.id.toString());
          } else if (!calcLengthId && newMeasurements.length === 2) {
             setCalcLengthId(newMeasurement.id.toString());
          }
      }

      setCurrentLine(null);
    }
  };

  const confirmReference = () => {
    const val = parseFloat(refInputVal);
    if (isNaN(val) || val <= 0) return;

    const pixelDist = getDistance(currentLine.start, currentLine.end);
    const factor = pixelDist / val;

    setScaleFactor(factor);
    setReferenceLine({
      start: currentLine.start,
      end: currentLine.end,
      realLength: val,
      unit: refInputUnit,
      isDiameter: refIsDiameter
    });

    setInputModalOpen(false);
    setCurrentLine(null);
  };

  const requestReset = () => {
    setResetModalOpen(true);
  };

  const confirmReset = () => {
    setReferenceLine(null);
    setScaleFactor(null);
    setMeasurements([]);
    setCurrentLine(null);
    setCalcDiameterId('');
    setCalcLengthId('');
    setResetModalOpen(false);
  };

  // --- Jig Mode Toggle ---
  const resetJigState = () => {
    setXRuler(null);
    setYRuler(null);
    setBaseLine(null);
    setDetectedDrills([]);
    setSelectedDrillId(null);
    setJigDrawingRuler(null);
    setDraggingBaseLine(false);
    setCategoryThresholds({ shortMax: 200, mediumMax: 300 });
    setJigDetectionParams({
      minContourArea: 1000,
      minAspectRatio: 3.0,
      adaptiveBlockSize: 15,
      adaptiveC: 5,
      baseLineTolerance: 30,
    });
  };

  const resetStandardState = () => {
    setReferenceLine(null);
    setScaleFactor(null);
    setMeasurements([]);
    setCurrentLine(null);
    setCalcDiameterId('');
    setCalcLengthId('');
    setPaperCorners(null);
    setCorrectedImage(null);
    setDetectedObject(null);
  };

  const toggleJigMode = (enabled) => {
    if (enabled === jigMode) return;
    setJigMode(enabled);
    if (enabled) {
      resetStandardState();
    } else {
      resetJigState();
    }
  };

  const deleteMeasurement = (id) => {
    setMeasurements(measurements.filter(m => m.id !== id));
    if (calcDiameterId === id.toString()) setCalcDiameterId('');
    if (calcLengthId === id.toString()) setCalcLengthId('');
  };

  const toggleReferenceType = () => {
      if (referenceLine) {
          setReferenceLine({
              ...referenceLine,
              isDiameter: !referenceLine.isDiameter
          });
      }
  };

  const getAreaUnit = (unit) => {
    switch(unit) {
      case 'cm': return 'cm²';
      case 'mm': return 'mm²';
      case 'm': return 'm²';
      case 'in': return 'sq in';
      case 'ft': return 'sq ft';
      default: return 'sq units';
    }
  };

  const calculateManualSurfaceArea = () => {
    const diameter = measurements.find(m => m.id.toString() === calcDiameterId)?.value || 0;
    const length = measurements.find(m => m.id.toString() === calcLengthId)?.value || 0;
    return (Math.PI * diameter * length).toFixed(2);
  };

  const calculateAutoSurfaceArea = (length) => {
      return (Math.PI * referenceLine.realLength * length).toFixed(2);
  };

  // --- Rendering Loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const displayImage = correctedImage || image;

    // Update canvas size if using corrected image
    if (correctedImage && (canvas.width !== correctedImage.naturalWidth || canvas.height !== correctedImage.naturalHeight)) {
      canvas.width = correctedImage.naturalWidth;
      canvas.height = correctedImage.naturalHeight;
    } else if (!correctedImage && (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight)) {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(displayImage, 0, 0);

    const drawLine = (start, end, color, width = 3, isDashed = false) => {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (isDashed) ctx.setLineDash([10, 5]);
      else ctx.setLineDash([]);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(start.x, start.y, width * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, width * 1.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawLabel = (start, end, text, color) => {
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        const padding = 6;
        const textWidth = ctx.measureText(text).width;

        ctx.fillRect(midX - textWidth/2 - padding, midY - 10 - padding, textWidth + padding*2, 20 + padding);
        ctx.strokeRect(midX - textWidth/2 - padding, midY - 10 - padding, textWidth + padding*2, 20 + padding);

        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, midX, midY);
        ctx.restore();
    };

    // Draw paper corners if detected (before applying correction)
    if (paperCorners && !correctedImage) {
      ctx.save();

      // Draw semi-transparent overlay outside the paper
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cut out the paper area
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(paperCorners[0].x, paperCorners[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(paperCorners[i].x, paperCorners[i].y);
      }
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Draw the paper outline
      ctx.beginPath();
      ctx.moveTo(paperCorners[0].x, paperCorners[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(paperCorners[i].x, paperCorners[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Draw corner handles
      const cornerLabels = ['TL', 'TR', 'BR', 'BL'];
      paperCorners.forEach((corner, idx) => {
        // Outer circle
        ctx.beginPath();
        ctx.arc(corner.x, corner.y, 15, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cornerLabels[idx], corner.x, corner.y);
      });

      // Draw perspective grid overlay
      if (showGrid) {
        const paper = PAPER_SIZES[paperSize];
        const worldCorners = [
          { x: 0, y: 0 },
          { x: paper.width, y: 0 },
          { x: paper.width, y: paper.height },
          { x: 0, y: paper.height }
        ];

        const H = computeHomography(
          paperCorners.map(c => ({ x: c.x, y: c.y })),
          worldCorners
        );

        if (H) {
          ctx.save();
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
          ctx.lineWidth = 1;
          const gridCount = 10;

          for (let i = 0; i <= gridCount; i++) {
            // Vertical lines
            const p1 = applyInverseHomography(H, { x: i * paper.width / gridCount, y: 0 });
            const p2 = applyInverseHomography(H, { x: i * paper.width / gridCount, y: paper.height });
            if (p1 && p2) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }

            // Horizontal lines
            const q1 = applyInverseHomography(H, { x: 0, y: i * paper.height / gridCount });
            const q2 = applyInverseHomography(H, { x: paper.width, y: i * paper.height / gridCount });
            if (q1 && q2) {
              ctx.beginPath();
              ctx.moveTo(q1.x, q1.y);
              ctx.lineTo(q2.x, q2.y);
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }
    }

    if (referenceLine && !paperCorners) {
      drawLine(referenceLine.start, referenceLine.end, '#3b82f6', 4);
      let label = `REF: ${referenceLine.realLength} ${referenceLine.unit}`;
      if (referenceLine.isDiameter) label = `Ø: ${referenceLine.realLength} ${referenceLine.unit}`;
      drawLabel(referenceLine.start, referenceLine.end, label, '#3b82f6');
    } else if (currentLine && !scaleFactor && !paperCorners) {
      drawLine(currentLine.start, currentLine.end, '#3b82f6', 4, true);
    }

    measurements.forEach((m, idx) => {
      const isSelected = !referenceLine?.isDiameter && (m.id.toString() === calcDiameterId || m.id.toString() === calcLengthId);
      const color = isSelected ? '#10b981' : '#ef4444';

      drawLine(m.start, m.end, color, 3);
      drawLabel(m.start, m.end, `${m.value.toFixed(2)} ${referenceLine?.unit}`, color);
    });

    if (currentLine && scaleFactor && !paperCorners) {
      drawLine(currentLine.start, currentLine.end, '#ef4444', 3, true);
      const dist = getDistance(currentLine.start, currentLine.end);
      const val = dist / scaleFactor;
      drawLabel(currentLine.start, currentLine.end, `${val.toFixed(2)} ${referenceLine?.unit}`, '#ef4444');
    }

    // Draw detected object bounding box
    if (detectedObject && detectedObject.vertices) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b'; // Amber
      ctx.lineWidth = 3;
      ctx.setLineDash([]);

      // Draw rotated rectangle
      ctx.beginPath();
      ctx.moveTo(detectedObject.vertices[0].x, detectedObject.vertices[0].y);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(detectedObject.vertices[i].x, detectedObject.vertices[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw corner dots
      ctx.fillStyle = '#f59e0b';
      detectedObject.vertices.forEach(v => {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw dimension labels
      const v = detectedObject.vertices;
      const midTop = { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2 };
      const midLeft = { x: (v[0].x + v[3].x) / 2, y: (v[0].y + v[3].y) / 2 };

      // Height label (longer dimension)
      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const heightLabel = `${detectedObject.heightMm.toFixed(1)}mm`;
      const widthLabel = `${detectedObject.widthMm.toFixed(1)}mm`;

      // Draw height label with background
      const heightMetrics = ctx.measureText(heightLabel);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(midLeft.x - heightMetrics.width/2 - 4, midLeft.y - 10, heightMetrics.width + 8, 20);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(heightLabel, midLeft.x, midLeft.y);

      // Draw width label with background
      const widthMetrics = ctx.measureText(widthLabel);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(midTop.x - widthMetrics.width/2 - 4, midTop.y - 10, widthMetrics.width + 8, 20);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(widthLabel, midTop.x, midTop.y);

      ctx.restore();
    }

    // --- Jig Mode Canvas Rendering ---
    if (jigMode) {
      ctx.save();

      // Draw ruler lines
      const drawRuler = (ruler, axis) => {
        if (!ruler) return;
        const { line, ticks } = ruler;

        // Main ruler line
        ctx.strokeStyle = '#06B6D4'; // cyan
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(line.start.x, line.start.y);
        ctx.lineTo(line.end.x, line.end.y);
        ctx.stroke();

        // Tick marks
        ticks.forEach((tick) => {
          const tickLen = (tick.mm % 50 === 0) ? 16 : (tick.mm % 10 === 0) ? 10 : 6;
          let tx, ty, tx2, ty2;

          if (axis === 'x') {
            tx = tick.px;
            ty = line.start.y - tickLen;
            tx2 = tick.px;
            ty2 = line.start.y + tickLen;
          } else {
            tx = line.start.x - tickLen;
            ty = tick.px;
            tx2 = line.start.x + tickLen;
            ty2 = tick.px;
          }

          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx2, ty2);
          ctx.strokeStyle = '#06B6D4';
          ctx.lineWidth = (tick.mm % 50 === 0) ? 2 : 1;
          ctx.stroke();

          // Labels every 5 cm (50 mm)
          if (tick.mm % 50 === 0) {
            const label = `${tick.mm / 10}`;
            ctx.fillStyle = '#06B6D4';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (axis === 'x') {
              ctx.fillText(label, tick.px, line.start.y - tickLen - 10);
            } else {
              ctx.fillText(label, line.start.x - tickLen - 14, tick.px);
            }
          }
        });
      };

      drawRuler(xRuler, 'x');
      drawRuler(yRuler, 'y');

      // Draw base line
      if (baseLine) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.beginPath();
        ctx.moveTo(0, baseLine.y);
        ctx.lineTo(canvas.width, baseLine.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('BASE LINE', 10, baseLine.y - 4);
      }

      // Draw detected drills
      const CATEGORY_COLORS = { A: '#3B82F6', B: '#F59E0B', C: '#EF4444' };

      detectedDrills.forEach((drill) => {
        const isSelected = selectedDrillId === drill.id;
        const color = isSelected ? '#22C55E' : CATEGORY_COLORS[drill.category];

        // Draw bounding box
        if (drill.vertices && drill.vertices.length === 4) {
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(drill.vertices[0].x, drill.vertices[0].y);
          for (let i = 1; i < 4; i++) {
            ctx.lineTo(drill.vertices[i].x, drill.vertices[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        // Draw label above drill
        const label = `#${drill.id}: ${Math.round(drill.heightMm)}mm (${drill.category})`;
        ctx.font = 'bold 12px sans-serif';
        const metrics = ctx.measureText(label);
        const labelX = drill.centerX - metrics.width / 2 - 4;
        const labelY = drill.topY - 22;

        ctx.fillStyle = color;
        ctx.fillRect(labelX, labelY, metrics.width + 8, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, drill.centerX, labelY + 9);
      });

      // Draw current line (manual ruler drawing)
      if (currentLine && jigDrawingRuler) {
        ctx.strokeStyle = '#06B6D4';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(currentLine.start.x, currentLine.start.y);
        ctx.lineTo(currentLine.end.x, currentLine.end.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

  }, [image, correctedImage, referenceLine, measurements, currentLine, scaleFactor, calcDiameterId, calcLengthId, paperCorners, detectedObject, showGrid, paperSize, jigMode, xRuler, yRuler, baseLine, detectedDrills, selectedDrillId, jigDrawingRuler]);


  return (
    <div className="flex flex-col h-screen bg-gray-50 text-slate-800 font-sans">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2">
          <Ruler className="text-blue-600" size={24} />
          <h1 className="text-xl font-bold tracking-tight text-gray-900">PhotoScale Estimator</h1>
        </div>
        <div className="flex gap-3 items-center">
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => toggleJigMode(false)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${!jigMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Standard
              </button>
              <button
                onClick={() => toggleJigMode(true)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${jigMode ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Jig Mode
              </button>
            </div>
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer transition shadow-sm">
                <Upload size={18} />
                <span className="font-medium text-sm">Upload Image</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            </label>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div ref={containerRef} className="flex-1 bg-gray-100 relative overflow-auto flex items-center justify-center p-4">
          {!image ? (
            <div className="text-center p-10 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50/50">
              <Upload className="mx-auto text-gray-400 mb-3" size={48} />
              <h3 className="text-lg font-medium text-gray-700">No image loaded</h3>
              <p className="text-gray-500 mb-4 text-sm">Upload an image to start measuring</p>
              <label className="px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                Select File
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
          ) : (
            <div className="relative shadow-2xl rounded-sm overflow-hidden" style={{ cursor: paperCorners ? 'move' : jigMode && jigDrawingRuler ? 'crosshair' : jigMode ? 'ns-resize' : 'crosshair' }}>
               <canvas
                ref={canvasRef}
                width={correctedImage ? correctedImage.naturalWidth : image.naturalWidth}
                height={correctedImage ? correctedImage.naturalHeight : image.naturalHeight}
                style={{
                    maxWidth: '100%',
                    maxHeight: '80vh',
                    display: 'block',
                    touchAction: 'none'
                }}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={endDrawing}
                onMouseLeave={endDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={endDrawing}
              />
              {!referenceLine && !inputModalOpen && !measurements.length && !paperCorners && !correctedImage && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-900/80 backdrop-blur text-white px-4 py-2 rounded-full text-sm font-medium pointer-events-none animate-pulse">
                  Draw line manually OR use Auto-Detect
                </div>
              )}
              {paperCorners && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-emerald-900/80 backdrop-blur text-white px-4 py-2 rounded-full text-sm font-medium pointer-events-none">
                  Drag corners to adjust → Calibrate (upright) or Flatten (flat)
                </div>
              )}
              {correctedImage && !referenceLine && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-emerald-600/90 backdrop-blur text-white px-4 py-2 rounded-full text-sm font-medium pointer-events-none">
                  ✓ Perspective corrected — Draw to measure
                </div>
              )}
              {(isProcessing || isDetectingPaper) && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex flex-col items-center justify-center text-blue-800 z-50">
                      <Loader2 size={48} className="animate-spin mb-2" />
                      <span className="font-semibold">{isDetectingPaper ? 'Detecting Paper...' : jigMode ? 'Detecting Rulers...' : 'Detecting Drill Shape...'}</span>
                  </div>
              )}
            </div>
          )}
        </div>

        <div className="w-80 bg-white border-l border-gray-200 flex flex-col z-10 shadow-xl overflow-hidden">

          {jigMode ? (
            <>
            {/* === JIG MODE SIDEBAR === */}

            {/* Calibration Section */}
            <div className="p-4 bg-orange-50 border-b border-orange-100">
                <h2 className="text-sm font-bold text-orange-900 mb-3 flex items-center gap-2">
                    <Crosshair size={16} /> Calibration
                </h2>
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">X-Ruler:</span>
                        {xRuler ? (
                            <span className="font-mono text-orange-700">{xRuler.scalePxPerMm.toFixed(2)} px/mm</span>
                        ) : (
                            <span className="text-gray-400">Not detected</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Y-Ruler:</span>
                        {yRuler ? (
                            <span className="font-mono text-orange-700">{yRuler.scalePxPerMm.toFixed(2)} px/mm</span>
                        ) : (
                            <span className="text-gray-400">Not detected</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-600">Base Line:</span>
                        {baseLine ? (
                            <span className="font-mono text-orange-700">Set (y={baseLine.y}px)</span>
                        ) : (
                            <span className="text-gray-400">Not detected</span>
                        )}
                    </div>
                    {xRuler && yRuler && Math.abs(xRuler.scalePxPerMm - yRuler.scalePxPerMm) / Math.max(xRuler.scalePxPerMm, yRuler.scalePxPerMm) > 0.05 && (
                        <div className="bg-amber-100 rounded p-2 text-[10px] text-amber-700 flex items-center gap-1">
                            <AlertTriangle size={12} />
                            Perspective: X/Y scales differ by {(Math.abs(xRuler.scalePxPerMm - yRuler.scalePxPerMm) / Math.max(xRuler.scalePxPerMm, yRuler.scalePxPerMm) * 100).toFixed(1)}%
                        </div>
                    )}
                    <button
                        onClick={detectRulers}
                        disabled={!image || !cvReady || isProcessing}
                        className="w-full h-[34px] px-3 bg-orange-600 text-white rounded-md text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                        {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                        {xRuler ? 'Re-detect Rulers' : 'Detect Rulers'}
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setJigDrawingRuler(jigDrawingRuler === 'x' ? null : 'x')}
                            disabled={!image}
                            className={`flex-1 h-[28px] px-2 rounded-md text-[10px] font-semibold flex items-center justify-center gap-1 transition ${
                                jigDrawingRuler === 'x'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <Ruler size={10} />
                            {jigDrawingRuler === 'x' ? 'Drawing X...' : 'Draw X-Ruler'}
                        </button>
                        <button
                            onClick={() => setJigDrawingRuler(jigDrawingRuler === 'y' ? null : 'y')}
                            disabled={!image}
                            className={`flex-1 h-[28px] px-2 rounded-md text-[10px] font-semibold flex items-center justify-center gap-1 transition ${
                                jigDrawingRuler === 'y'
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                        >
                            <Ruler size={10} />
                            {jigDrawingRuler === 'y' ? 'Drawing Y...' : 'Draw Y-Ruler'}
                        </button>
                    </div>
                    {jigDrawingRuler && (
                        <p className="text-[10px] text-cyan-600">Draw a line along the {jigDrawingRuler.toUpperCase()}-axis ruler (0 to 40cm)</p>
                    )}
                    <button
                        onClick={detectBaseLine}
                        disabled={!image || !cvReady || isProcessing}
                        className="w-full h-[30px] px-3 bg-gray-600 text-white rounded-md text-[10px] font-semibold hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                        {baseLine ? 'Re-detect Base Line' : 'Detect Base Line'}
                    </button>
                    {baseLine && (
                        <p className="text-[10px] text-gray-500">Drag the white dashed line on the canvas to adjust</p>
                    )}
                </div>
                {!cvReady && <p className="text-[10px] text-gray-400 mt-1">Initializing Computer Vision Engine...</p>}
            </div>

            {/* Detection Section */}
            <div className="p-4 bg-orange-50/50 border-b border-orange-100">
                <h2 className="text-sm font-bold text-orange-900 mb-3 flex items-center gap-2">
                    <Crosshair size={16} /> Detection
                </h2>
                <div className="space-y-2">
                    <div>
                        <label className="text-[10px] uppercase font-bold text-orange-400 mb-0.5 block">Min. Contour Area</label>
                        <input
                            type="range"
                            min="200"
                            max="5000"
                            step="100"
                            value={jigDetectionParams.minContourArea}
                            onChange={(e) => setJigDetectionParams(p => ({ ...p, minContourArea: Number(e.target.value) }))}
                            className="w-full accent-orange-600"
                        />
                        <span className="text-[10px] text-gray-500 font-mono">{jigDetectionParams.minContourArea}px</span>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold text-orange-400 mb-0.5 block">Min. Aspect Ratio</label>
                        <input
                            type="range"
                            min="1.5"
                            max="8"
                            step="0.5"
                            value={jigDetectionParams.minAspectRatio}
                            onChange={(e) => setJigDetectionParams(p => ({ ...p, minAspectRatio: Number(e.target.value) }))}
                            className="w-full accent-orange-600"
                        />
                        <span className="text-[10px] text-gray-500 font-mono">{jigDetectionParams.minAspectRatio}:1</span>
                    </div>
                    <button
                        onClick={detectDrillsJig}
                        disabled={!xRuler || !yRuler || !baseLine || isProcessing}
                        className="w-full h-[34px] px-3 bg-orange-600 text-white rounded-md text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                        {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                        Detect Drills
                    </button>
                </div>
            </div>

            {/* Results Section */}
            <div className="p-4 border-b border-gray-100 bg-white">
                <h2 className="font-semibold text-gray-900 mb-1">Results</h2>
                <p className="text-xs text-gray-500">
                    {detectedDrills.length > 0
                        ? `${detectedDrills.length} drills detected`
                        : 'No drills detected yet'}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                {detectedDrills.length > 0 && (
                    <>
                        {/* Drill Table */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="text-left px-2 py-1.5 font-semibold text-gray-600">#</th>
                                        <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Height</th>
                                        <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Cat</th>
                                        <th className="px-2 py-1.5"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detectedDrills.map((drill) => (
                                        <tr
                                            key={drill.id}
                                            className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedDrillId === drill.id ? 'bg-green-50' : ''}`}
                                            onClick={() => setSelectedDrillId(selectedDrillId === drill.id ? null : drill.id)}
                                        >
                                            <td className="px-2 py-1.5 font-mono">{drill.id}</td>
                                            <td className="px-2 py-1.5 font-mono">{Math.round(drill.heightMm)} mm</td>
                                            <td className="px-2 py-1.5">
                                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${
                                                    drill.category === 'A' ? 'bg-blue-500' :
                                                    drill.category === 'B' ? 'bg-amber-500' : 'bg-red-500'
                                                }`}>
                                                    {drill.category}
                                                </span>
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDetectedDrills(prev => prev.filter(d => d.id !== drill.id));
                                                    }}
                                                    className="text-gray-300 hover:text-red-500"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Category Summary */}
                        <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                            <div className="flex justify-between"><span className="text-blue-600 font-semibold">A (Short &lt;{categoryThresholds.shortMax}mm):</span><span className="font-mono">{detectedDrills.filter(d => d.category === 'A').length}</span></div>
                            <div className="flex justify-between"><span className="text-amber-600 font-semibold">B (Medium {categoryThresholds.shortMax}–{categoryThresholds.mediumMax}mm):</span><span className="font-mono">{detectedDrills.filter(d => d.category === 'B').length}</span></div>
                            <div className="flex justify-between"><span className="text-red-600 font-semibold">C (Long &gt;{categoryThresholds.mediumMax}mm):</span><span className="font-mono">{detectedDrills.filter(d => d.category === 'C').length}</span></div>
                            <div className="flex justify-between border-t border-gray-200 pt-1 mt-1"><span className="font-bold text-gray-700">Total:</span><span className="font-mono font-bold">{detectedDrills.length}</span></div>
                        </div>
                    </>
                )}

                {/* Category Thresholds */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <h3 className="text-xs font-bold text-gray-700 mb-2">Category Thresholds</h3>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] text-gray-600 w-20">Short max:</label>
                            <input
                                type="number"
                                value={categoryThresholds.shortMax}
                                onChange={(e) => setCategoryThresholds(t => ({ ...t, shortMax: Number(e.target.value) }))}
                                className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded bg-white w-16"
                            />
                            <span className="text-[10px] text-gray-400">mm</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-[10px] text-gray-600 w-20">Medium max:</label>
                            <input
                                type="number"
                                value={categoryThresholds.mediumMax}
                                onChange={(e) => setCategoryThresholds(t => ({ ...t, mediumMax: Number(e.target.value) }))}
                                className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded bg-white w-16"
                            />
                            <span className="text-[10px] text-gray-400">mm</span>
                        </div>
                    </div>
                </div>

                {/* Export */}
                {detectedDrills.length > 0 && (
                    <button
                        onClick={() => {
                            const header = 'Index\tHeight(mm)\tCategory';
                            const rows = detectedDrills.map(d => `${d.id}\t${Math.round(d.heightMm)}\t${d.category}`);
                            navigator.clipboard.writeText([header, ...rows].join('\n'));
                        }}
                        className="w-full h-[34px] px-3 bg-gray-700 text-white rounded-md text-xs font-semibold hover:bg-gray-800 flex items-center justify-center gap-1"
                    >
                        Copy to Clipboard
                    </button>
                )}
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-400 flex gap-2 shrink-0">
                <Info size={14} className="shrink-0 text-gray-300"/>
                <p>Place drills in the jig with rulers visible along both axes.</p>
            </div>
            </>
          ) : (
            <>
            {/* === STANDARD MODE SIDEBAR === */}

            {/* Perspective Correction Panel */}
            <div className="p-4 bg-emerald-50 border-b border-emerald-100 relative">
                <h2 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2">
                    <FileImage size={16} /> Perspective Correction
                </h2>

                {/* State 1: No calibration yet - show paper detection */}
                {!correctedImage && !scaleFactor && (
                  <div className="space-y-2">
                    <div>
                        <label className="text-[10px] uppercase font-bold text-emerald-400 mb-0.5 block">Paper Size</label>
                        <select
                            value={paperSize}
                            onChange={(e) => setPaperSize(e.target.value)}
                            className="w-full text-sm px-2 py-1.5 rounded-md border border-emerald-200 focus:ring-1 focus:ring-emerald-500 outline-none bg-white"
                        >
                            {Object.entries(PAPER_SIZES).map(([key, val]) => (
                                <option key={key} value={key}>{val.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={detectPaper}
                            disabled={!image || !cvReady || isDetectingPaper}
                            className="flex-1 h-[34px] px-3 bg-emerald-600 text-white rounded-md text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                        >
                            {isDetectingPaper ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                            {paperCorners ? 'Re-detect' : 'Detect Paper'}
                        </button>

                        {paperCorners && (
                            <>
                                <button
                                    onClick={calibrateFromPaper}
                                    disabled={isDetectingPaper}
                                    className="flex-1 h-[34px] px-3 bg-amber-500 text-white rounded-md text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                    title="Set scale from paper without cropping - use for upright objects"
                                >
                                    <Ruler size={14} />
                                    Calibrate
                                </button>
                                <button
                                    onClick={applyPerspectiveCorrection}
                                    disabled={isDetectingPaper}
                                    className="flex-1 h-[34px] px-3 bg-emerald-700 text-white rounded-md text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                    title="Flatten perspective - use for objects lying ON the paper"
                                >
                                    <Check size={14} />
                                    Flatten
                                </button>
                            </>
                        )}
                    </div>

                    {paperCorners && (
                        <div className="text-[10px] text-emerald-600 space-y-1">
                            <p className="flex items-center gap-1">
                                <Move size={10} />
                                Drag corners to adjust
                            </p>
                            <p><strong>Calibrate:</strong> For upright objects (keeps full image)</p>
                            <p><strong>Flatten:</strong> For objects lying on paper</p>
                            <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={showGrid}
                                    onChange={(e) => setShowGrid(e.target.checked)}
                                    className="w-3.5 h-3.5 text-emerald-600 rounded border-emerald-300 focus:ring-emerald-500"
                                />
                                <span>Show perspective grid</span>
                            </label>
                        </div>
                    )}
                  </div>
                )}

                {/* State 2: Calibrated from paper (no correction applied) */}
                {!correctedImage && scaleFactor && (
                  <div className="space-y-3">
                    <div className="bg-amber-100 rounded-lg p-2 text-xs text-amber-700 flex items-center gap-2">
                        <Check size={14} />
                        Scale calibrated from {PAPER_SIZES[paperSize].label}
                        <span className="ml-auto font-mono">{scaleFactor.toFixed(2)} px/mm</span>
                    </div>

                    <button
                        onClick={detectObject}
                        disabled={isDetectingObject}
                        className="w-full h-[34px] px-3 bg-amber-500 text-white rounded-md text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                        {isDetectingObject ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                        Detect Object
                    </button>

                    {detectedObject && (
                        <div className="bg-white rounded-lg p-3 border border-amber-200">
                            <div className="text-[10px] uppercase font-bold text-amber-600 mb-2">Detected Object</div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-gray-500 text-xs">Height:</span>
                                    <div className="font-mono font-bold text-amber-700">{detectedObject.heightMm.toFixed(1)} mm</div>
                                </div>
                                <div>
                                    <span className="text-gray-500 text-xs">Width:</span>
                                    <div className="font-mono font-bold text-amber-700">{detectedObject.widthMm.toFixed(1)} mm</div>
                                </div>
                            </div>
                        </div>
                    )}

                    <p className="text-[10px] text-gray-500">Or draw lines manually to measure</p>

                    <button
                        onClick={resetPerspective}
                        className="w-full text-xs text-emerald-600 hover:text-emerald-800 flex items-center justify-center gap-1"
                    >
                        <RefreshCcw size={12} />
                        Reset Calibration
                    </button>
                  </div>
                )}

                {/* State 3: Perspective corrected (flattened) */}
                {correctedImage && (
                  <div className="space-y-3">
                    <div className="bg-emerald-100 rounded-lg p-2 text-xs text-emerald-700 flex items-center gap-2">
                        <Check size={14} />
                        Paper corrected ({PAPER_SIZES[paperSize].label})
                    </div>

                    <button
                        onClick={detectObject}
                        disabled={isDetectingObject}
                        className="w-full h-[34px] px-3 bg-amber-500 text-white rounded-md text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                    >
                        {isDetectingObject ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
                        Detect Object
                    </button>

                    {detectedObject && (
                        <div className="bg-white rounded-lg p-3 border border-amber-200">
                            <div className="text-[10px] uppercase font-bold text-amber-600 mb-2">Detected Object</div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                    <span className="text-gray-500 text-xs">Height:</span>
                                    <div className="font-mono font-bold text-amber-700">{detectedObject.heightMm.toFixed(1)} mm</div>
                                </div>
                                <div>
                                    <span className="text-gray-500 text-xs">Width:</span>
                                    <div className="font-mono font-bold text-amber-700">{detectedObject.widthMm.toFixed(1)} mm</div>
                                </div>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={resetPerspective}
                        className="w-full text-xs text-emerald-600 hover:text-emerald-800 flex items-center justify-center gap-1"
                    >
                        <RefreshCcw size={12} />
                        Reset Correction
                    </button>
                  </div>
                )}

                {!cvReady && <p className="text-[10px] text-gray-400 mt-1">Initializing Computer Vision Engine...</p>}
            </div>

            {/* Auto Detect Panel */}
            <div className="p-4 bg-indigo-50 border-b border-indigo-100 relative">
                {referenceLine && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <button
                            onClick={requestReset}
                            className="text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1.5 rounded shadow-sm border border-indigo-600 transition flex items-center gap-1"
                        >
                            <RefreshCcw size={12} />
                            Reset to use Auto-Detect
                        </button>
                    </div>
                )}
                <h2 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
                    <Crosshair size={16} /> Auto-Detect Drill
                </h2>

                <div className="flex gap-2 items-end">
                    <div className="flex-1">
                        <label className="text-[10px] uppercase font-bold text-indigo-400 mb-0.5 block">Known Diameter</label>
                        <div className="flex">
                            <input
                                type="number"
                                value={autoDiameter}
                                onChange={(e) => setAutoDiameter(e.target.value)}
                                className={`w-full text-sm px-2 py-1.5 rounded-l-md border-y border-l focus:ring-1 focus:ring-indigo-500 outline-none ${!autoDiameter ? 'border-indigo-300 bg-indigo-50' : 'border-indigo-200'}`}
                                placeholder="e.g. 10.0"
                                disabled={!!referenceLine}
                            />
                            <select
                                value={autoUnit}
                                onChange={(e) => setAutoUnit(e.target.value)}
                                className="bg-white border border-indigo-200 rounded-r-md text-xs px-1 text-gray-600 outline-none"
                                disabled={!!referenceLine}
                            >
                                <option value="mm">mm</option>
                                <option value="cm">cm</option>
                            </select>
                        </div>
                    </div>
                    <button
                        onClick={detectDrill}
                        disabled={!image || !cvReady || !autoDiameter || !!referenceLine}
                        className="h-[34px] px-3 bg-indigo-600 text-white rounded-md text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                        {cvReady ? 'Find & Measure' : 'Loading CV...'}
                    </button>
                </div>
                {!cvReady && <p className="text-[10px] text-gray-400 mt-1">Initializing Computer Vision Engine...</p>}
            </div>

            <div className="p-4 border-b border-gray-100 bg-white">
                <h2 className="font-semibold text-gray-900 mb-1">Measurements</h2>
                <p className="text-xs text-gray-500">
                    {!referenceLine
                        ? "Waiting for calibration..."
                        : `Scale: 1 ${referenceLine.unit} = ${(scaleFactor || 0).toFixed(2)}px`}
                </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                {referenceLine && (
                     <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 relative overflow-hidden group/ref">
                        {referenceLine.isDiameter && (
                             <div className="absolute top-0 right-0 bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-bl">DIAMETER</div>
                        )}
                        <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Reference</span>
                            <div className="flex gap-1">
                                <button
                                    onClick={toggleReferenceType}
                                    className={`text-blue-400 hover:text-blue-700 p-0.5 rounded transition ${referenceLine.isDiameter ? 'bg-blue-200 text-blue-700' : ''}`}
                                    title={referenceLine.isDiameter ? "Unmark as Diameter" : "Mark as Diameter (Enable Auto-Calc)"}
                                >
                                    <Circle size={14} />
                                </button>
                                <button onClick={requestReset} className="text-blue-400 hover:text-blue-600" title="Reset Reference">
                                    <RefreshCcw size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="text-lg font-mono font-medium text-blue-900">
                            {referenceLine.realLength} <span className="text-sm text-blue-700">{referenceLine.unit}</span>
                        </div>
                        <div className="text-xs text-blue-400 mt-1">
                            {referenceLine.isDiameter
                                ? "Using as Diameter for Area Calc"
                                : "Standard Length Reference"}
                        </div>
                     </div>
                )}

                {measurements.map((m, idx) => (
                    <div key={m.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:border-gray-300 transition group">
                        <div className="flex justify-between items-start">
                            <div className="flex-1">
                                <div className="text-xs text-gray-500 mb-0.5">
                                    {referenceLine.isDiameter ? 'Length' : `Measurement #${idx + 1}`}
                                </div>
                                <div className="text-lg font-mono text-gray-800">
                                    {m.value.toFixed(2)} <span className="text-sm text-gray-500">{referenceLine.unit}</span>
                                </div>

                                {referenceLine.isDiameter && (
                                    <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col">
                                        <span className="text-[10px] uppercase text-emerald-600 font-bold mb-0.5 flex items-center gap-1">
                                            <Cylinder size={10} /> Surface Area
                                        </span>
                                        <span className="font-mono font-bold text-emerald-700 text-sm">
                                            {calculateAutoSurfaceArea(m.value)} {getAreaUnit(referenceLine.unit)}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => deleteMeasurement(m.id)}
                                className="p-1.5 rounded text-gray-300 hover:bg-red-50 hover:text-red-500 transition"
                                title="Delete"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}

                {referenceLine && !referenceLine.isDiameter && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-3">
                        <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                            <Calculator size={16} /> Surface Area (Manual)
                        </h3>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                 <label className="text-xs font-medium text-gray-600 w-16">Diameter:</label>
                                 <select
                                    value={calcDiameterId}
                                    onChange={(e) => setCalcDiameterId(e.target.value)}
                                    className="flex-1 text-sm border-gray-200 rounded-md py-1 px-2 text-gray-700 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                 >
                                    <option value="">Select...</option>
                                    {measurements.map((m, i) => (
                                        <option key={m.id} value={m.id}>#{i+1}: {m.value.toFixed(1)}</option>
                                    ))}
                                 </select>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                 <label className="text-xs font-medium text-gray-600 w-16">Length:</label>
                                 <select
                                    value={calcLengthId}
                                    onChange={(e) => setCalcLengthId(e.target.value)}
                                    className="flex-1 text-sm border-gray-200 rounded-md py-1 px-2 text-gray-700 focus:ring-blue-500 focus:border-blue-500 bg-white"
                                 >
                                    <option value="">Select...</option>
                                    {measurements.map((m, i) => (
                                        <option key={m.id} value={m.id}>#{i+1}: {m.value.toFixed(1)}</option>
                                    ))}
                                 </select>
                            </div>

                            {calcDiameterId && calcLengthId ? (
                                 <div className="mt-3 bg-white rounded-lg p-3 text-center border border-emerald-200 shadow-sm ring-1 ring-emerald-500/20">
                                    <div className="text-xs text-emerald-600 uppercase tracking-wide font-semibold mb-1">Surface Area</div>
                                    <div className="text-xl font-bold text-emerald-900">
                                        {calculateManualSurfaceArea()}
                                        <span className="text-sm font-normal text-emerald-700 ml-1">{getAreaUnit(referenceLine.unit)}</span>
                                    </div>
                                 </div>
                            ) : (
                                 <div className="text-xs text-gray-400 text-center italic mt-2">
                                    Select Diameter and Length above
                                 </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="p-3 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-400 flex gap-2 shrink-0">
                <Info size={14} className="shrink-0 text-gray-300"/>
                <p>Ensure high contrast background for Auto-Detect.</p>
            </div>
            </>
          )}
        </div>
      </div>

      {inputModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="bg-blue-600 p-4 text-white flex items-center gap-2">
                    <Ruler size={20} />
                    <h3 className="font-semibold">Calibrate Scale</h3>
                </div>
                <div className="p-6">
                    <p className="text-sm text-gray-600 mb-4">
                        Set the size of the line you just drew.
                    </p>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Real Size</label>
                            <input
                                type="number"
                                autoFocus
                                value={refInputVal}
                                onChange={(e) => setRefInputVal(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-lg"
                                placeholder="e.g. 10.0"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
                            <select
                                value={refInputUnit}
                                onChange={(e) => setRefInputUnit(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                            >
                                <option value="cm">cm</option>
                                <option value="mm">mm</option>
                                <option value="in">inches</option>
                                <option value="ft">feet</option>
                                <option value="m">meters</option>
                            </select>
                        </div>

                        <div className="pt-2 border-t border-gray-100">
                             <label className="flex items-start gap-2 cursor-pointer p-2 hover:bg-gray-50 rounded-lg transition select-none">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={refIsDiameter}
                                        onChange={(e) => setRefIsDiameter(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-1"
                                    />
                                </div>
                                <div>
                                    <span className="block text-sm font-medium text-gray-900">Use this as Diameter</span>
                                    <span className="block text-xs text-gray-500">Auto-calculates surface area for subsequent length measurements.</span>
                                </div>
                             </label>
                        </div>
                    </div>

                    <div className="mt-6 flex gap-3">
                         <button
                            onClick={() => {
                                setInputModalOpen(false);
                                setCurrentLine(null);
                                setRefInputVal('');
                                setRefIsDiameter(false);
                            }}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmReference}
                            disabled={!refInputVal}
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Check size={16} />
                            Set Scale
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {resetModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="bg-red-600 p-4 text-white flex items-center gap-2">
                    <AlertTriangle size={20} />
                    <h3 className="font-semibold">Reset All?</h3>
                </div>
                <div className="p-6">
                    <p className="text-sm text-gray-600 mb-6">
                        This will delete your reference scale and all current measurements. This action cannot be undone.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => setResetModalOpen(false)}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmReset}
                            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm flex justify-center items-center gap-2"
                        >
                            <Trash2 size={16} />
                            Reset
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default PhotoScaleApp;
