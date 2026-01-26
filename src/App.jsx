import React, { useState, useRef, useEffect } from 'react';
import { Upload, Ruler, Trash2, RefreshCcw, Info, Check, MousePointer2, AlertTriangle, Calculator, Cylinder, Crosshair, Loader2, Circle } from 'lucide-react';

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

  // --- Geometry Helpers ---
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
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

  // --- Drawing Handlers ---
  const startDrawing = (e) => {
    if (!image) return;
    const coords = getCanvasCoordinates(e);
    setIsDrawing(true);
    setCurrentLine({ start: coords, end: coords });
  };

  const draw = (e) => {
    if (!isDrawing || !currentLine) return;
    const coords = getCanvasCoordinates(e);
    setCurrentLine({ ...currentLine, end: coords });
  };

  const endDrawing = () => {
    if (!isDrawing || !currentLine) return;
    setIsDrawing(false);

    const dist = getDistance(currentLine.start, currentLine.end);
    if (dist < 5) {
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

    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);

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

    if (referenceLine) {
      drawLine(referenceLine.start, referenceLine.end, '#3b82f6', 4);
      let label = `REF: ${referenceLine.realLength} ${referenceLine.unit}`;
      if (referenceLine.isDiameter) label = `Ø: ${referenceLine.realLength} ${referenceLine.unit}`;
      drawLabel(referenceLine.start, referenceLine.end, label, '#3b82f6');
    } else if (currentLine && !scaleFactor) {
      drawLine(currentLine.start, currentLine.end, '#3b82f6', 4, true);
    }

    measurements.forEach((m, idx) => {
      const isSelected = !referenceLine.isDiameter && (m.id.toString() === calcDiameterId || m.id.toString() === calcLengthId);
      const color = isSelected ? '#10b981' : '#ef4444';

      drawLine(m.start, m.end, color, 3);
      drawLabel(m.start, m.end, `${m.value.toFixed(2)} ${referenceLine?.unit}`, color);
    });

    if (currentLine && scaleFactor) {
      drawLine(currentLine.start, currentLine.end, '#ef4444', 3, true);
      const dist = getDistance(currentLine.start, currentLine.end);
      const val = dist / scaleFactor;
      drawLabel(currentLine.start, currentLine.end, `${val.toFixed(2)} ${referenceLine?.unit}`, '#ef4444');
    }

  }, [image, referenceLine, measurements, currentLine, scaleFactor, calcDiameterId, calcLengthId]);


  return (
    <div className="flex flex-col h-screen bg-gray-50 text-slate-800 font-sans">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2">
          <Ruler className="text-blue-600" size={24} />
          <h1 className="text-xl font-bold tracking-tight text-gray-900">PhotoScale Estimator</h1>
        </div>
        <div className="flex gap-3">
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
            <div className="relative shadow-2xl rounded-sm overflow-hidden" style={{ cursor: isDrawing ? 'crosshair' : 'crosshair' }}>
               <canvas
                ref={canvasRef}
                width={image.naturalWidth}
                height={image.naturalHeight}
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
              {!referenceLine && !inputModalOpen && !measurements.length && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-900/80 backdrop-blur text-white px-4 py-2 rounded-full text-sm font-medium pointer-events-none animate-pulse">
                  Draw line manually OR use Auto-Detect
                </div>
              )}
              {isProcessing && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex flex-col items-center justify-center text-blue-800 z-50">
                      <Loader2 size={48} className="animate-spin mb-2" />
                      <span className="font-semibold">Detecting Drill Shape...</span>
                  </div>
              )}
            </div>
          )}
        </div>

        <div className="w-80 bg-white border-l border-gray-200 flex flex-col z-10 shadow-xl overflow-hidden">

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
            </div>

            {referenceLine && !referenceLine.isDiameter && (
                <div className="bg-gray-50 border-t border-gray-200 p-4">
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

            <div className="p-3 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-400 flex gap-2">
                <Info size={14} className="shrink-0 text-gray-300"/>
                <p>Ensure high contrast background for Auto-Detect.</p>
            </div>
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
