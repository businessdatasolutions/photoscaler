# Product Requirement Document (PRD): PhotoScale Estimator

| Field | Value |
|-------|-------|
| **Document Version** | 3.0 |
| **Status** | Living Document |
| **Product Name** | PhotoScale Estimator (Code Name: One-Measure) |
| **Last Updated** | January 28, 2026 |

---

## 1. Executive Summary

The PhotoScale Estimator is a web-based digital utility designed to extract dimensional data from static images. By utilizing a known reference measurement (manual line or detected paper), the system calculates linear dimensions and surface areas of objects. Version 3.0 introduces automatic paper detection, perspective correction, and object detection capabilities for measuring both flat and upright objects.

---

## 2. Goals & Objectives

- **Primary Goal:** Enable users to derive unknown dimensions and surface areas from an image using a single reference point.
- **Advanced Goal:** Automate scale calibration using standard paper sizes (A4, Letter, A5) as reference.
- **New in V3:** Support measurement of upright objects (like standing markers) by calibrating scale without cropping the image.
- **Target Audience:** Industrial coaters, hobbyists, photographers, and users needing quick estimates without physical access to the object.

---

## 3. Functional Requirements

### 3.1 Input Processing

#### FR 1.0 – Image Ingestion
- The system must provide an interface for users to upload images (JPEG, PNG).
- Images must be rendered onto an interactive HTML5 Canvas.

#### FR 1.1 – Reference Calibration (Manual)
- **Manual Mode:** Users can draw a line to define a known distance.
- **Diameter Toggle:** Users can designate the reference line specifically as a "Diameter."
- **Data Entry:** Users input a numeric value and unit (mm, cm, in, ft, m).

### 3.2 Paper Detection & Calibration (NEW in V3)

#### FR 2.0 – Automatic Paper Detection
- **Library:** OpenCV.js (Client-side execution)
- **Detection Method:**
  1. Convert image to HSV color space
  2. Create mask for white/light regions (saturation < 100, value > 80)
  3. Apply morphological operations to clean mask
  4. Find quadrilateral contours
  5. Order corners as TL, TR, BR, BL
- **Supported Paper Sizes:** A4 (210×297mm), US Letter (8.5×11in), A5 (148×210mm)

#### FR 2.1 – Corner Adjustment
- Users can drag detected corners to fine-tune paper boundaries
- Visual feedback with labeled corner handles (TL, TR, BR, BL)
- Semi-transparent overlay highlights detected paper area

#### FR 2.2 – Two Calibration Modes
After paper detection, users choose between:

| Mode | Use Case | Behavior |
|------|----------|----------|
| **Calibrate** | Upright objects (e.g., standing marker) | Sets scale from paper dimensions, keeps full original image |
| **Flatten** | Flat objects on paper | Applies perspective correction, crops to paper boundaries |

### 3.3 Dimensional Analysis Engine

#### FR 3.0 – Scale Calculation
- **From Manual Reference:** $Scale = \frac{Pixel Distance}{Known Value}$
- **From Paper (Calibrate):** Average of horizontal and vertical pixel-per-mm ratios
- **From Paper (Flatten):** Fixed 3 pixels per mm based on output resolution

#### FR 3.1 – Linear Measurement
- Users can draw multiple lines after calibration
- System calculates real-world length using the Scale Factor
- Live preview of measurement while drawing

#### FR 3.2 – Surface Area Calculation (Cylindrical)
- **Manual Mode:** Users select two measurements (Diameter + Length) from dropdown
- **Auto-Diameter Mode:** If reference is flagged as "Diameter," automatically calculates surface area for subsequent measurements
- **Formula:** $Area = \pi \times Diameter \times Length$

### 3.4 Object Detection (NEW in V3)

#### FR 4.0 – Automated Object Detection
- **Trigger:** "Detect Object" button (available after calibration)
- **Detection Method:**
  1. HSV threshold to find non-white regions
  2. Invert mask to isolate colored objects
  3. Morphological cleanup (open/close)
  4. Find largest contour
  5. Fit rotated bounding rectangle
- **Output:** Height and width in mm, visual bounding box on canvas

### 3.5 Computer Vision (Auto-Detect Cylindrical Object)

#### FR 5.0 – Automated Cylindrical Object Detection
- **Target Objects:** Long cylindrical objects (e.g., markers, pens, tubes, rods) standing perpendicular to the reference plane
- **Workflow:**
  1. User inputs a known diameter of the cylindrical object
  2. System processes image (Grayscale → Blur → Otsu Threshold → Find Contours)
  3. System identifies target object (largest contour)
  4. System fits a "Rotated Rectangle" to the object
- **Auto-Calibration:** The shorter dimension (width) is assigned to the known diameter to establish scale
- **Auto-Measurement:** The longer dimension (length) is calculated and cylindrical surface area computed

### 3.6 Output & Display

#### FR 6.0 – Interactive Overlay
| Element | Color | Description |
|---------|-------|-------------|
| Paper corners | Green | Draggable handles with TL/TR/BR/BL labels |
| Reference line | Blue | Calibration reference with value label |
| Measurements | Red | Additional measurements (Green when selected) |
| Detected object | Amber | Bounding box with dimension labels |

#### FR 6.1 – Data Panel (Sidebar)
- Perspective Correction panel with paper size selector
- Calibration status indicator with px/mm value
- Detected object dimensions display
- Measurement list with delete capability
- Surface Area calculator (manual selection)

---

## 4. Technical Constraints & Architecture

| Aspect | Specification |
|--------|---------------|
| **Platform** | Web Application (React.js + Vite) |
| **Styling** | Tailwind CSS |
| **Image Processing** | Client-side only (Canvas API + OpenCV.js). No images are sent to a server (privacy-preserving). |
| **Performance** | CV operations run asynchronously with loading indicators to avoid perceived UI blocking. |
| **Browser Support** | Modern browsers with WebAssembly support (Chrome, Firefox, Safari, Edge) |
| **Accuracy Disclaimer** | Results are estimates affected by perspective, lens distortion, and detection quality. |

---

## 5. User Flows

### Flow A: Manual Measurement
1. User uploads image
2. User draws line on known object → Sets length (e.g., "5cm")
3. User draws line on target object
4. System displays length

### Flow B: Surface Area (Cylindrical Object)
1. User uploads image of cylindrical object standing on reference plane
2. User draws line across the object's width (diameter)
3. In modal, user enters Diameter (e.g., "10mm") and checks "Use as Diameter"
4. User draws line along the object's length
5. System displays Length AND cylindrical Surface Area instantly

### Flow C: Auto-Detect Cylindrical Object (CV)
1. User uploads image of cylindrical object on high-contrast background
2. User enters known Diameter in "Auto-Detect" panel
3. User clicks "Find & Measure"
4. System detects object, calibrates scale based on diameter, and reports length/surface area

### Flow D: Paper Calibration for Upright Objects (NEW)
1. User uploads image with object standing on paper
2. User selects paper size (A4/Letter/A5)
3. User clicks "Detect Paper"
4. System detects paper corners (user can adjust by dragging)
5. User clicks "Calibrate"
6. System sets scale, keeps full image
7. User clicks "Detect Object" or draws measurements manually
8. System displays object dimensions

### Flow E: Paper Calibration with Perspective Correction (NEW)
1. User uploads image with object lying flat on paper
2. User selects paper size (A4/Letter/A5)
3. User clicks "Detect Paper"
4. System detects paper corners (user can adjust by dragging)
5. User clicks "Flatten"
6. System applies perspective transform, crops to paper
7. User draws measurements on flattened image
8. System displays measurements with automatic scale (3 px/mm)

---

## 6. Future Improvements (V4)

- **Multi-Object Detection:** Detect and measure multiple objects in a single frame
- **Export:** Generate PDF report of measurements
- **Camera Capture:** Direct camera input (mobile devices)
- **Calibration Presets:** Save and reuse common reference objects
- **Angle Measurement:** Measure angles between lines
- **Undo/Redo:** History stack for measurement actions
