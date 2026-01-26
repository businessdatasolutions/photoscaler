# Product Requirement Document (PRD): PhotoScale Estimator

| Field | Value |
|-------|-------|
| **Document Version** | 2.0 |
| **Status** | Living Document |
| **Product Name** | PhotoScale Estimator (Code Name: One-Measure) |
| **Last Updated** | January 26, 2026 |

---

## 1. Executive Summary

The PhotoScale Estimator is a web-based digital utility designed to extract dimensional data from static images. By utilizing a single known reference measurement, the system calculates linear dimensions and surface areas of objects. Version 2.0 introduces Computer Vision (CV) capabilities to automatically detect specific objects (e.g., drill bits) and enables specialized calculations for industrial coating applications, specifically cylindrical surface area.

---

## 2. Goals & Objectives

- **Primary Goal:** Enable users to derive unknown dimensions and surface areas from an image using a single reference point.
- **Advanced Goal:** Automate the measurement process for specific object types (drills) using client-side computer vision.
- **Target Audience:** Industrial coaters, hobbyists, and users needing quick estimates without physical access to the object.

---

## 3. Functional Requirements

### 3.1 Input Processing

#### FR 1.0 – Image Ingestion
- The system must provide an interface for users to upload images (JPEG, PNG).
- Images must be rendered onto an interactive HTML5 Canvas.

#### FR 1.1 – Reference Calibration
- **Manual Mode:** Users must be able to draw a line to define a known distance.
- **Diameter Toggle:** Users can designate the reference line specifically as a "Diameter."
- **Data Entry:** Users input a numeric value and unit (mm, cm, in, ft, m).

### 3.2 Dimensional Analysis Engine

#### FR 2.0 – Scale Calculation
- **Logic:** $Scale Factor = \frac{Known Real Value}{Pixel Distance}$

#### FR 2.1 – Linear Measurement
- Users can draw multiple lines after calibration.
- System calculates real-world length using the Scale Factor.

#### FR 2.2 – Surface Area Calculation (Cylindrical)
- **Manual Mode:** Users select two existing measurements (one for Diameter, one for Length) from a dropdown to calculate surface area.
- **Auto-Diameter Mode:** If the reference is flagged as "Diameter," the system automatically calculates Surface Area for any subsequent line drawn (treating the new line as Length).
- **Formula:** $Area = \pi \times Diameter \times Length$

### 3.3 Computer Vision (Auto-Detect)

#### FR 3.0 – Automated Object Detection
- **Library:** OpenCV.js (Client-side execution)
- **Workflow:**
  1. User inputs a known diameter.
  2. System processes image (Grayscale → Blur → Threshold → Find Contours).
  3. System identifies the target object (largest contour).
  4. System fits a "Rotated Rectangle" to the object.
- **Auto-Calibration:** The system automatically assigns the object's width to the known diameter to establish the scale.
- **Auto-Measurement:** The system automatically measures the object's length and calculates surface area.

### 3.4 Output & Display

#### FR 4.0 – Interactive Overlay
- **Reference:** Displayed in Blue.
- **Measurements:** Displayed in Red (or Green when selected).
- **Labels:** All lines must have floating text labels with values and units.

#### FR 4.1 – Data Panel
- Sidebar must list all active measurements.
- Calculated Surface Area must be displayed clearly with squared units (e.g., $mm^2$).

---

## 4. Technical Constraints & Architecture

| Aspect | Specification |
|--------|---------------|
| **Platform** | Web Application (React.js + Vite) |
| **Styling** | Tailwind CSS |
| **Image Processing** | Client-side only (Canvas API + OpenCV.js). No images are sent to a server (privacy-preserving). |
| **Performance** | CV operations must run asynchronously to avoid blocking the UI thread. |
| **Accuracy Disclaimer** | The system must warn users that results are estimates affected by perspective, lens distortion, and segmentation quality. |

---

## 5. User Flows

### Flow A: Manual Measurement
1. User uploads image.
2. User draws line on known object → Sets length (e.g., "5cm").
3. User draws line on target object.
4. System displays length.

### Flow B: Surface Area (Drill Bit)
1. User uploads image of drill.
2. User draws line across drill width.
3. In modal, user enters Diameter (e.g., "10mm") and checks "Use as Diameter".
4. User draws line along drill length.
5. System displays Length AND Surface Area instantly.

### Flow C: Auto-Detect (CV)
1. User uploads image (high contrast background recommended).
2. User enters known Diameter in "Auto-Detect" panel.
3. User clicks "Find & Measure".
4. System detects drill, calibrates scale based on width, and reports length/area.

---

## 6. Future Improvements (V3)

- **Homography/Perspective Correction:** Allow users to define a 4-point plane (e.g., a piece of paper) to correct for camera tilt.
- **Multi-Object Detection:** Detect multiple drill bits in a single frame.
- **Export:** Generate a PDF report of measurements.
