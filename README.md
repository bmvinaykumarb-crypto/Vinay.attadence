# Smart Lab Attendance — Flask version

Converted from a single-file Streamlit app (`attend.py`) into a proper
Flask backend + HTML/CSS/JS frontend.

## What changed structurally (and why)

Streamlit and Flask work very differently, so this isn't a line-for-line
port — it's a rebuild that preserves the exact same **rules and features**:

| Concern | Streamlit original | Flask version |
|---|---|---|
| UI updates | Whole script reruns top-to-bottom on every interaction (`st.rerun()`) | Normal REST endpoints (`/api/...`) called via `fetch()`, page updates via JS |
| State | `st.session_state` | Flask `session` (server-side, cookie-based) for role/subject; everything else re-fetched from CSV per request |
| Camera / webcam | Server opened the machine's webcam directly with `cv2.VideoCapture(0)` and streamed frames into `st.empty()` — only works if the Streamlit process and the webcam are the same machine | Browser's camera via `getUserMedia`, snapshots are POSTed to the server as image files. This is the correct model for a real multi-user web app, since in Flask the **browser**, not the server, owns the webcam. |
| Live blink/liveness detection | A `while` loop reading webcam frames in-process, computing EAR/MAR each frame | Not carried over 1:1 (see "Not ported" below) — face matching logic itself (encodings, `compare_faces`, tolerance) is identical |
| Geolocation gate | `streamlit_js_eval.get_geolocation()` blocking the whole app via `st.stop()` | Same gate, done with the browser Geolocation API + a `/api/verify-location` check, blocking the app UI until verified |
| Popups / balloons | `st.balloons()`, custom HTML modal via `st.markdown` | Same modal HTML/CSS, shown via JS, auto-dismisses after 3s |

## Preserved exactly

- CSV-backed storage: `lab_attendance.csv`, `student_registry.csv`, `registered_faces/`
- `mark_attendance()` rules (one entry per lab/day, Fri/Sun exception allowing 2/day — kept as written in the original, including what looks like a bug: the comment says "Friday and Saturday" but the code checks weekday `6` which is Sunday, not Saturday)
- Face registration & matching (`face_recognition` encodings, tolerance thresholds)
- QR code generation (`qrcode`) and decoding (`cv2.QRCodeDetector`)
- Geofencing (`geopy.distance.geodesic`, 15m radius around the same college coordinates)
- Faculty login (`faculty123` password) vs. student default role
- All three student tabs / three faculty tabs and their functionality
- Subject list, year/semester grouping
- Records view: filter by date/subject, delete single/date/all, CSV export

## Not ported as-is

The original's **auto-scan webcam loops** (`auto_scan_qr_from_camera`,
`auto_scan_face_from_camera`) opened the *server's* webcam directly and ran
a live blink-detection state machine frame-by-frame. That only makes sense
when the Streamlit server and the user are the same machine. In a real
Flask deployment the webcam belongs to each visitor's browser, so:

- QR and face scanning now work via **browser camera capture** (`getUserMedia`) → single snapshot → POST to `/api/scan-qr` / `/api/scan-face`.
- The eye-blink liveness state machine (EAR/MAR/yaw calculations, blink-based challenge) was not reimplemented client-side. The face-matching logic it depended on (`face_recognition.compare_faces`) is fully preserved and used by `/api/scan-face`; only the "prove you're not a static photo" blink challenge is not carried forward, since it needs redesigning around a live video stream in the browser (e.g. a JS face-landmark library) rather than being a mechanical port.

## Running it

```bash
cd flask_app
pip install -r requirements.txt
# face_recognition/dlib can be slow/tricky to install — the app degrades
# gracefully (FACE_RECOGNITION_AVAILABLE=False) and QR-only mode still works
python app.py
```

Visit `http://localhost:5000`. Grant location permission (defaults to the
same college coordinates/15m radius as the original — edit
`COLLEGE_LOCATION` in `app.py` for testing from elsewhere).

## File layout

```
flask_app/
├── app.py                  # All routes + ported business logic
├── requirements.txt
├── Dockerfile              # Container definition
├── docker-compose.yml      # Orchestrates Flask + PostgreSQL
├── templates/
│   └── index.html          # Single-page shell
└── static/
    ├── css/style.css
    └── js/app.js            # Tabs, camera capture, API calls, rendering
```

## Docker Setup

### Option 1: Run with Docker Compose (Flask + PostgreSQL)

```bash
docker compose up --build
```
This automatically boots up both the **PostgreSQL** database service and the **Flask application** service on port `4000`.

### Option 2: Pull pre-built image from GitHub Container Registry

```bash
docker pull ghcr.io/bmvinaykumarb-crypto/vinay.attadence:latest
docker run -p 4000:4000 ghcr.io/bmvinaykumarb-crypto/vinay.attadence:latest
```

