"""
Smart Lab Attendance — Flask version
Converted from a Streamlit script. Core logic (attendance rules, face
registry, QR generation/decoding, geofencing) is preserved; anything that
relied on Streamlit's rerun-based UI or a server-side webcam loop has been
rebuilt as normal HTTP endpoints + browser-side camera access (getUserMedia),
since Flask has no equivalent of Streamlit's `st.empty()` live video loop.
"""
import os
import json
import math
import time
import warnings
from io import BytesIO
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
from PIL import Image
from flask import (
    Flask, render_template, request, jsonify, session,
    send_file, redirect, url_for
)
# pyrefly: ignore [missing-import]
from flask_sqlalchemy import SQLAlchemy
from geopy.distance import geodesic

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import face_recognition
    FACE_RECOGNITION_AVAILABLE = True
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    import qrcode
    QRCODE_AVAILABLE = True
except ImportError:
    QRCODE_AVAILABLE = False


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
CSV_FILE = BASE_DIR / "lab_attendance.csv"
STUDENT_REGISTRY_FILE = BASE_DIR / "student_registry.csv"
FACULTY_REGISTRY_FILE = BASE_DIR / "faculty_registry.csv"
FACULTY_ASSIGNMENTS_FILE = BASE_DIR / "faculty_assignments.csv"
REGISTERED_FACES_DIR = BASE_DIR / "registered_faces"

COLLEGE_LOCATION = (15.273740544380276, 76.37742920897117)
ALLOWED_RADIUS_METERS = 40
FACULTY_PASSWORD = "faculty123"
ADMIN_PASSWORD = "admin@123"
STUDENT_PASSWORD = "student@123"  # common password for all students

SUBJECTS_BY_YEAR_SEM = {
    "1st Year": {
        "1st Sem": ["C Programing", "DigitalLogics"],
        "2nd Sem": ["Cpp", "DataStructure"],
    },
    "2nd Year": {
        "3rd Sem": ["DBMS", "JAVA", "WebDesigen"],
        "4th Sem": ["Python", "Operating System", "Computer Graphics"],
    },
    "3rd Year": {
        "5th Sem": ["PHP", "DAA", "C#"],
        "6th Sem": ["AIML"],
    },
}

ALL_SUBJECTS = [
    "Python", "Operating System", "Computer Graphics", "DataStructure", "Cpp",
    "DBMS", "DigitalLogics", "JAVA", "WebDesigen", "C Programing",
    "R Programing", "C.prog", "MAD", "WCMS",
]

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

db_url = os.environ.get("DATABASE_URL")
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url or f"sqlite:///{BASE_DIR / 'lab_attendance.db'}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# --------------------------------------------------------------------------
# Database Models
# --------------------------------------------------------------------------
class AttendanceRecord(db.Model):
    __tablename__ = "lab_attendance"
    id = db.Column(db.Integer, primary_key=True)
    roll_number = db.Column(db.String(100), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    time = db.Column(db.String(20), nullable=False)
    lab = db.Column(db.String(100), nullable=False)


class StudentRegistry(db.Model):
    __tablename__ = "student_registry"
    id = db.Column(db.Integer, primary_key=True)
    roll_number = db.Column(db.String(100), unique=True, nullable=False)
    registration_date = db.Column(db.String(50))
    face_encoding = db.Column(db.Text)
    face_path = db.Column(db.String(255))


class FacultyRegistry(db.Model):
    __tablename__ = "faculty_registry"
    id = db.Column(db.String(100), primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    department = db.Column(db.String(100))
    added_date = db.Column(db.String(50))


class FacultyAssignment(db.Model):
    __tablename__ = "faculty_assignments"
    id = db.Column(db.String(100), primary_key=True)
    faculty_id = db.Column(db.String(100), nullable=False)
    faculty_name = db.Column(db.String(150), nullable=False)
    year = db.Column(db.String(50), nullable=False)
    semester = db.Column(db.String(50), nullable=False)
    subject = db.Column(db.String(100), nullable=False)
    assigned_date = db.Column(db.String(50))


class ClassSession(db.Model):
    """A live class session opened by a faculty member.
    Students can mark attendance while is_active=True."""
    __tablename__ = "class_sessions"
    id = db.Column(db.Integer, primary_key=True)
    faculty_id = db.Column(db.String(100), nullable=False)   # email used as faculty id
    faculty_name = db.Column(db.String(150), nullable=False)
    subject = db.Column(db.String(100), nullable=False)
    year = db.Column(db.String(50), default="")
    semester = db.Column(db.String(50), default="")
    date = db.Column(db.String(20), nullable=False)
    opened_at = db.Column(db.String(20), nullable=False)
    closed_at = db.Column(db.String(20), default="")
    is_active = db.Column(db.Boolean, default=True, nullable=False)

def init_db():
    REGISTERED_FACES_DIR.mkdir(exist_ok=True)
    with app.app_context():
        db.create_all()
        # Seed existing CSV data if SQL tables are currently empty
        if AttendanceRecord.query.count() == 0 and CSV_FILE.exists():
            try:
                csv_df = pd.read_csv(CSV_FILE)
                for _, row in csv_df.iterrows():
                    db.session.add(AttendanceRecord(
                        roll_number=str(row["Roll Number"]),
                        date=str(row["Date"]),
                        time=str(row["Time"]),
                        lab=str(row["Lab"])
                    ))
                db.session.commit()
            except Exception as e:
                db.session.rollback()

        if StudentRegistry.query.count() == 0 and STUDENT_REGISTRY_FILE.exists():
            try:
                csv_df = pd.read_csv(STUDENT_REGISTRY_FILE)
                for _, row in csv_df.iterrows():
                    db.session.add(StudentRegistry(
                        roll_number=str(row["Roll Number"]),
                        registration_date=str(row.get("Registration Date", "")),
                        face_encoding=str(row.get("Face Encoding", "")),
                        face_path=str(row.get("Face Path", ""))
                    ))
                db.session.commit()
            except Exception as e:
                db.session.rollback()

        if FacultyRegistry.query.count() == 0 and FACULTY_REGISTRY_FILE.exists():
            try:
                csv_df = pd.read_csv(FACULTY_REGISTRY_FILE)
                for _, row in csv_df.iterrows():
                    db.session.add(FacultyRegistry(
                        id=str(row["ID"]),
                        name=str(row["Name"]),
                        email=str(row["Email"]),
                        department=str(row.get("Department", "")),
                        added_date=str(row.get("Added Date", ""))
                    ))
                db.session.commit()
            except Exception as e:
                db.session.rollback()

        if FacultyAssignment.query.count() == 0 and FACULTY_ASSIGNMENTS_FILE.exists():
            try:
                csv_df = pd.read_csv(FACULTY_ASSIGNMENTS_FILE)
                for _, row in csv_df.iterrows():
                    db.session.add(FacultyAssignment(
                        id=str(row["ID"]),
                        faculty_id=str(row["Faculty ID"]),
                        faculty_name=str(row["Faculty Name"]),
                        year=str(row["Year"]),
                        semester=str(row["Semester"]),
                        subject=str(row["Subject"]),
                        assigned_date=str(row.get("Assigned Date", ""))
                    ))
                db.session.commit()
            except Exception as e:
                db.session.rollback()


def load_data():
    records = AttendanceRecord.query.all()
    data = [{
        "Roll Number": r.roll_number,
        "Date": r.date,
        "Time": r.time,
        "Lab": r.lab
    } for r in records]
    return pd.DataFrame(data, columns=["Roll Number", "Date", "Time", "Lab"])


def load_student_registry():
    students = StudentRegistry.query.all()
    data = [{
        "Roll Number": s.roll_number,
        "Registration Date": s.registration_date or "",
        "Face Encoding": s.face_encoding or "",
        "Face Path": s.face_path or ""
    } for s in students]
    return pd.DataFrame(data, columns=["Roll Number", "Registration Date", "Face Encoding", "Face Path"])


def save_student_registry(df):
    pass


def serialize_face_encoding(encoding):
    if encoding is None:
        return ""
    return json.dumps(encoding.tolist())


def deserialize_face_encoding(encoding_str):
    if not isinstance(encoding_str, str) or not encoding_str.strip():
        return None
    try:
        return np.array(json.loads(encoding_str))
    except Exception:
        return None


def load_faculty_registry():
    faculties = FacultyRegistry.query.all()
    data = [{
        "ID": f.id,
        "Name": f.name,
        "Email": f.email,
        "Department": f.department or "",
        "Added Date": f.added_date or ""
    } for f in faculties]
    return pd.DataFrame(data, columns=["ID", "Name", "Email", "Department", "Added Date"])


def save_faculty_registry(df):
    pass


def load_faculty_assignments():
    assignments = FacultyAssignment.query.all()
    data = [{
        "ID": a.id,
        "Faculty ID": a.faculty_id,
        "Faculty Name": a.faculty_name,
        "Year": a.year,
        "Semester": a.semester,
        "Subject": a.subject,
        "Assigned Date": a.assigned_date or ""
    } for a in assignments]
    return pd.DataFrame(data, columns=["ID", "Faculty ID", "Faculty Name", "Year", "Semester", "Subject", "Assigned Date"])


def save_faculty_assignments(df):
    pass


def is_within_range(lat, lon):
    distance = geodesic(COLLEGE_LOCATION, (lat, lon)).meters
    return distance <= ALLOWED_RADIUS_METERS, distance


def mark_attendance(roll_number, lab):
    if not roll_number:
        return False, "Roll number cannot be empty."

    now = datetime.now()
    current_date = now.strftime("%Y-%m-%d")
    current_time = now.strftime("%H:%M:%S")
    day_of_week = now.weekday()  # 0=Monday ... 4=Friday, 5=Saturday, 6=Sunday

    existing_in_lab = AttendanceRecord.query.filter_by(
        roll_number=str(roll_number), date=current_date, lab=lab
    ).first()
    if existing_in_lab:
        return False, f"Attendance already marked for {roll_number} in {lab} today."

    existing_today = AttendanceRecord.query.filter_by(
        roll_number=str(roll_number), date=current_date
    ).all()
    existing_count = len(existing_today)

    max_attendances = 2 if day_of_week in [4, 6] else 1

    if existing_count >= max_attendances:
        existing_labs = list(set([r.lab for r in existing_today]))
        existing_labs_str = ", ".join(existing_labs)
        return False, (
            f"You can't attend {lab} because you have already reached the maximum "
            f"attendances ({max_attendances}) for today. Recorded for: {existing_labs_str}."
        )

    new_record = AttendanceRecord(
        roll_number=str(roll_number),
        date=current_date,
        time=current_time,
        lab=lab
    )
    db.session.add(new_record)
    db.session.commit()
    return True, f"Successfully marked attendance for {roll_number} in {lab} at {current_time}."


def enroll_student(roll_number, face_image_file=None):
    if not roll_number:
        return False, "Roll number cannot be empty."

    existing = StudentRegistry.query.filter_by(roll_number=str(roll_number)).first()
    if existing:
        return False, f"Roll number {roll_number} is already registered."

    serialized_encoding = ""
    image_path = ""
    if FACE_RECOGNITION_AVAILABLE:
        if face_image_file is None:
            return False, "Face photo is required for enrollment."
        try:
            image = Image.open(face_image_file).convert("RGB")
            image_np = np.array(image)
            face_encodings = face_recognition.face_encodings(image_np)
            if not face_encodings:
                return False, "No face detected in the photo. Please capture/upload a clear picture of your face."
            if len(face_encodings) > 1:
                return False, "Multiple faces detected. Please make sure only one person is in the frame."
            serialized_encoding = serialize_face_encoding(face_encodings[0])

            REGISTERED_FACES_DIR.mkdir(exist_ok=True)
            image_filename = f"{roll_number}.jpg"
            image_path = str(REGISTERED_FACES_DIR / image_filename)
            image.save(image_path, "JPEG")
        except Exception as e:
            return False, f"Failed to process face: {str(e)}"

    new_student = StudentRegistry(
        roll_number=str(roll_number),
        registration_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        face_encoding=serialized_encoding,
        face_path=image_path
    )
    db.session.add(new_student)
    db.session.commit()
    return True, f"Student {roll_number} registered successfully! QR Code generated below."


def match_face(face_image_file, tolerance=0.55):
    if not FACE_RECOGNITION_AVAILABLE:
        return None, "Face recognition library is not available."
    try:
        image = Image.open(face_image_file).convert("RGB")
        image_np = np.array(image)

        face_encodings = face_recognition.face_encodings(image_np)
        if not face_encodings:
            return None, "No face detected in the image. Please make sure your face is clearly visible."
        if len(face_encodings) > 1:
            return None, "Multiple faces detected. Please make sure only one person is in the frame."

        unknown_encoding = face_encodings[0]

        df = load_student_registry()
        if df.empty:
            return None, "No students registered in the database."

        known_encodings, known_rolls = [], []
        for _, row in df.iterrows():
            enc = deserialize_face_encoding(row.get("Face Encoding", ""))
            if enc is not None:
                known_encodings.append(enc)
                known_rolls.append(str(row["Roll Number"]))

        if not known_encodings:
            return None, "No registered face encodings found in the database. Please enroll students first."

        matches = face_recognition.compare_faces(known_encodings, unknown_encoding, tolerance=tolerance)
        face_distances = face_recognition.face_distance(known_encodings, unknown_encoding)

        if True in matches:
            best_match_idx = int(np.argmin(face_distances))
            if matches[best_match_idx]:
                return known_rolls[best_match_idx], None

        return None, "Face did not match any registered student in the database."
    except Exception as e:
        return None, f"Error processing face: {str(e)}"


def generate_qr_code_image(roll_number: str):
    if QRCODE_AVAILABLE:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(roll_number)
        qr.make(fit=True)
        return qr.make_image(fill_color="black", back_color="white")
    else:
        from PIL import ImageDraw
        img = Image.new("RGB", (200, 200), color="white")
        draw = ImageDraw.Draw(img)
        draw.text((10, 90), roll_number, fill="black")
        return img


def decode_qr_code(image_file):
    if not CV2_AVAILABLE:
        return None, "OpenCV is not available for QR decoding."
    try:
        file_bytes = np.asarray(bytearray(image_file.read()), dtype=np.uint8)
        image_file.seek(0)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        if img is None:
            return None, "Failed to load image. Make sure it is a valid image format."
        detector = cv2.QRCodeDetector()
        data, bbox, _ = detector.detectAndDecode(img)
        if data:
            return data, None
        return None, "No QR Code detected in the image."
    except Exception as e:
        return None, f"Error decoding QR Code: {str(e)}"


# --------------------------------------------------------------------------
# Session bootstrap
# --------------------------------------------------------------------------
@app.before_request
def ensure_session_defaults():
    session.setdefault("user_role", "student")
    session.setdefault("username", "Student")
    session.setdefault("selected_subject", "C Programing")


init_db()


# --------------------------------------------------------------------------
# Page routes
# --------------------------------------------------------------------------
@app.route("/")
def index():
    """Front portal — login chooser for Student / Faculty / Admin."""
    return render_template(
        "portal.html",
        face_recognition_available=FACE_RECOGNITION_AVAILABLE,
    )


@app.route("/app")
def main_app():
    """Full attendance management app (Faculty & Admin).
    Students who are not faculty/admin are redirected to the portal."""
    if session.get("user_role") not in ("faculty", "admin"):
        return redirect(url_for("index"))
    return render_template(
        "index.html",
        user_role=session["user_role"],
        username=session["username"],
        subjects_by_year_sem=SUBJECTS_BY_YEAR_SEM,
        all_subjects=ALL_SUBJECTS,
        selected_subject=session.get("selected_subject", "C Programing"),
        face_recognition_available=FACE_RECOGNITION_AVAILABLE,
        allowed_radius=ALLOWED_RADIUS_METERS,
        college_lat=COLLEGE_LOCATION[0],
        college_lon=COLLEGE_LOCATION[1],
    )


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
@app.post("/api/faculty-login")
def faculty_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    if not email:
        return jsonify(success=False, message="Please enter a valid Email."), 400
    if password != FACULTY_PASSWORD:
        return jsonify(success=False, message="Incorrect password. Hint: faculty123"), 401

    session["user_role"] = "faculty"
    session["username"] = email
    return jsonify(success=True, role="faculty", username=email)


@app.post("/api/admin-login")
def admin_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    if not email:
        return jsonify(success=False, message="Please enter a valid Email."), 400
    if password != ADMIN_PASSWORD:
        return jsonify(success=False, message="Incorrect admin password."), 401

    session["user_role"] = "admin"
    session["username"] = email
    return jsonify(success=True, role="admin", username=email)


@app.post("/api/logout")
def logout():
    session["user_role"] = "student"
    session["username"] = "Student"
    return jsonify(success=True)


# --------------------------------------------------------------------------
# Location verification
# --------------------------------------------------------------------------
@app.post("/api/verify-location")
def verify_location():
    data = request.get_json(force=True)
    try:
        lat = float(data["lat"])
        lon = float(data["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify(success=False, message="Invalid coordinates."), 400

    within_range, distance = is_within_range(lat, lon)
    return jsonify(
        success=True,
        within_range=within_range,
        distance=round(distance, 1),
        allowed_radius=ALLOWED_RADIUS_METERS,
    )


# --------------------------------------------------------------------------
# Subject selection
# --------------------------------------------------------------------------
@app.post("/api/select-subject")
def select_subject():
    data = request.get_json(force=True)
    subject = data.get("subject", "")
    session["selected_subject"] = subject
    return jsonify(success=True, selected_subject=subject)


# --------------------------------------------------------------------------
# Attendance marking (manual / QR / face — all funnel through mark_attendance)
# --------------------------------------------------------------------------
@app.post("/api/mark-attendance")
def api_mark_attendance():
    data = request.get_json(force=True)
    roll_number = (data.get("roll_number") or "").strip()
    lab = data.get("lab") or session.get("selected_subject", "")

    if not roll_number:
        return jsonify(success=False, message="Please enter a roll number."), 400

    registry = load_student_registry()
    registered_rolls = registry["Roll Number"].astype(str).tolist()
    if registered_rolls and roll_number not in registered_rolls:
        return jsonify(
            success=False,
            message=f"Roll Number '{roll_number}' is not registered in the student database. Register them first.",
        )

    success, msg = mark_attendance(roll_number, lab)
    return jsonify(success=success, message=msg, roll_number=roll_number)


@app.post("/api/scan-qr")
def api_scan_qr():
    """Decode a QR image (upload or camera snapshot) and mark attendance."""
    if "image" not in request.files:
        return jsonify(success=False, message="No image provided."), 400

    lab = request.form.get("lab") or session.get("selected_subject", "")
    roll_number, err = decode_qr_code(request.files["image"])
    if not roll_number:
        return jsonify(success=False, message=f"QR Decoding failed: {err}")

    registry = load_student_registry()
    registered_rolls = registry["Roll Number"].astype(str).tolist()
    if registered_rolls and roll_number not in registered_rolls:
        return jsonify(
            success=False,
            message=f"Student '{roll_number}' is not registered in the student database. Register them first.",
            roll_number=roll_number,
        )

    success, msg = mark_attendance(roll_number, lab)
    return jsonify(success=success, message=msg, roll_number=roll_number)


@app.post("/api/scan-face")
def api_scan_face():
    """
    Match a face snapshot against the registry and mark attendance.
    Requires a recent liveness verification (within 30 seconds).
    """
    if not FACE_RECOGNITION_AVAILABLE:
        return jsonify(success=False, message="Face recognition library is not available."), 400
    if "image" not in request.files:
        return jsonify(success=False, message="No image provided."), 400

    # Enforce liveness token
    liveness_ts = session.get("liveness_verified_at")
    LIVENESS_WINDOW_SECONDS = 30
    if not liveness_ts or (time.time() - liveness_ts) > LIVENESS_WINDOW_SECONDS:
        return jsonify(
            success=False,
            message="Liveness verification required. Please complete the liveness challenge first.",
        )

    lab = request.form.get("lab") or session.get("selected_subject", "")
    roll_number, err = match_face(request.files["image"])
    if not roll_number:
        return jsonify(success=False, message=f"Face verification failed: {err}")

    # Consume the liveness token so it can't be reused
    session.pop("liveness_verified_at", None)

    success, msg = mark_attendance(roll_number, lab)
    return jsonify(success=success, message=msg, roll_number=roll_number)


@app.post("/api/liveness-check")
def api_liveness_check():
    """
    Multi-signal liveness check. Returns:
      - ear: Eye Aspect Ratio (for blink detection)
      - mar: Mouth Aspect Ratio (for mouth-open detection)
      - yaw: Estimated head yaw angle in degrees (for head-turn detection)
    """
    if not FACE_RECOGNITION_AVAILABLE:
        return jsonify(success=False, message="Face recognition library is not available."), 400
    if "image" not in request.files:
        return jsonify(success=False, message="No image provided."), 400

    try:
        image = Image.open(request.files["image"]).convert("RGB")
        image_np = np.array(image)

        landmarks_list = face_recognition.face_landmarks(image_np)
        if not landmarks_list:
            return jsonify(success=False, message="No face detected", ear=None, mar=None, yaw=None)

        landmarks = landmarks_list[0]

        # --- EAR (Eye Aspect Ratio) ---
        def calculate_ear(eye):
            A = math.dist(eye[1], eye[5])
            B = math.dist(eye[2], eye[4])
            C = math.dist(eye[0], eye[3])
            if C == 0:
                return 0.0
            return (A + B) / (2.0 * C)

        avg_ear = None
        if "left_eye" in landmarks and "right_eye" in landmarks:
            left_ear = calculate_ear(landmarks["left_eye"])
            right_ear = calculate_ear(landmarks["right_eye"])
            avg_ear = (left_ear + right_ear) / 2.0

        # --- MAR (Mouth Aspect Ratio) ---
        avg_mar = None
        if "top_lip" in landmarks and "bottom_lip" in landmarks:
            top_lip = landmarks["top_lip"]
            bottom_lip = landmarks["bottom_lip"]
            # Vertical distances: use inner lip points
            # top_lip[9] (inner top center), bottom_lip[9] (inner bottom center)
            # top_lip[10], bottom_lip[10], top_lip[8], bottom_lip[8]
            try:
                A = math.dist(top_lip[9], bottom_lip[9])    # center vertical
                B = math.dist(top_lip[10], bottom_lip[10])  # left-center vertical
                C = math.dist(top_lip[8], bottom_lip[8])    # right-center vertical
                D = math.dist(top_lip[0], top_lip[6])       # horizontal mouth width
                if D == 0:
                    avg_mar = 0.0
                else:
                    avg_mar = (A + B + C) / (2.0 * D)
            except (IndexError, TypeError):
                avg_mar = None

        # --- Head Yaw Estimation ---
        # Uses the horizontal offset of the nose tip relative to the midpoint
        # of the two eye centers, normalized by inter-eye distance.
        yaw = None
        if "left_eye" in landmarks and "right_eye" in landmarks and "nose_bridge" in landmarks:
            try:
                left_eye_center = (
                    sum(p[0] for p in landmarks["left_eye"]) / len(landmarks["left_eye"]),
                    sum(p[1] for p in landmarks["left_eye"]) / len(landmarks["left_eye"]),
                )
                right_eye_center = (
                    sum(p[0] for p in landmarks["right_eye"]) / len(landmarks["right_eye"]),
                    sum(p[1] for p in landmarks["right_eye"]) / len(landmarks["right_eye"]),
                )
                eye_mid_x = (left_eye_center[0] + right_eye_center[0]) / 2.0
                inter_eye_dist = math.dist(left_eye_center, right_eye_center)

                nose_tip = landmarks["nose_bridge"][-1]  # bottom of bridge ≈ nose tip
                if inter_eye_dist > 0:
                    # Positive = face turned right, Negative = face turned left
                    offset_ratio = (nose_tip[0] - eye_mid_x) / inter_eye_dist
                    yaw = offset_ratio * 45.0  # rough degrees estimate
            except (IndexError, TypeError, ZeroDivisionError):
                yaw = None

        return jsonify(success=True, ear=avg_ear, mar=avg_mar, yaw=yaw)
    except Exception as e:
        return jsonify(success=False, message=str(e), ear=None, mar=None, yaw=None)


@app.post("/api/liveness-complete")
def api_liveness_complete():
    """
    Called by the frontend after all liveness challenges pass.
    Sets a short-lived session token so /api/scan-face knows
    liveness was recently verified.
    """
    session["liveness_verified_at"] = time.time()
    return jsonify(success=True, message="Liveness verified.")


# --------------------------------------------------------------------------
# Student enrollment
# --------------------------------------------------------------------------
@app.post("/api/enroll-student")
def api_enroll_student():
    roll_number = (request.form.get("roll_number") or "").strip()
    if not roll_number:
        return jsonify(success=False, message="Please enter a valid Roll Number."), 400

    face_file = request.files.get("face_image")
    if FACE_RECOGNITION_AVAILABLE and face_file is None:
        return jsonify(success=False, message="Please capture or upload a face photo for the student."), 400

    success, message = enroll_student(roll_number, face_file)
    return jsonify(success=success, message=message, roll_number=roll_number)


# --------------------------------------------------------------------------
# QR code image generation/download
# --------------------------------------------------------------------------
@app.get("/api/qr-code/<roll_number>")
def api_qr_code(roll_number):
    img = generate_qr_code_image(roll_number)
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    download = request.args.get("download") == "1"
    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=download,
        download_name=f"{roll_number}_qrcode.png" if download else None,
    )


# --------------------------------------------------------------------------
# Registry (faculty view)
# --------------------------------------------------------------------------
@app.get("/api/students")
def api_students():
    df = load_student_registry()
    if df.empty:
        return jsonify(students=[])

    records = []
    for _, row in df.iterrows():
        enc = row.get("Face Encoding", "")
        records.append({
            "roll_number": str(row["Roll Number"]),
            "registration_date": row.get("Registration Date", ""),
            "face_registered": isinstance(enc, str) and len(enc.strip()) > 10,
            "face_path": row.get("Face Path", ""),
        })
    return jsonify(students=records)


# --------------------------------------------------------------------------
# Attendance records (faculty view)
# --------------------------------------------------------------------------
@app.get("/api/records")
def api_records():
    df = load_data()
    date_str = request.args.get("date") or datetime.now().strftime("%Y-%m-%d")
    lab_filter = request.args.get("lab", "All")

    filtered = df[df["Date"] == date_str]
    if lab_filter != "All":
        filtered = filtered[filtered["Lab"] == lab_filter]

    filtered = filtered.copy()
    filtered["Lab"] = filtered["Lab"].apply(
        lambda x: x + " (2nd sem)" if x in ["DataStructure", "Cpp"] else x
    )

    by_subject = {}
    for subject in sorted(filtered["Lab"].unique()):
        subj_records = filtered[filtered["Lab"] == subject].sort_values("Time", ascending=False)
        by_subject[subject] = subj_records[["Roll Number", "Time", "Lab"]].to_dict(orient="records")

    day_of_week = datetime.strptime(date_str, "%Y-%m-%d").weekday()
    max_allowed = 2 if day_of_week in [4, 5] else 1

    available_dates = sorted(df["Date"].unique(), reverse=True)[:10]

    return jsonify(
        date=date_str,
        total_records=len(filtered),
        total_students=int(filtered["Roll Number"].nunique()) if not filtered.empty else 0,
        day_name=datetime.strptime(date_str, "%Y-%m-%d").strftime("%A"),
        max_allowed=max_allowed,
        by_subject=by_subject,
        available_dates=list(available_dates),
    )


@app.get("/api/records/all")
def api_records_all():
    df = load_data()
    lab_filter = request.args.get("lab", "All")
    filtered = df if lab_filter == "All" else df[df["Lab"] == lab_filter]
    filtered = filtered.copy()
    filtered["Lab"] = filtered["Lab"].apply(
        lambda x: x + " (2nd sem)" if x in ["DataStructure", "Cpp"] else x
    )

    by_date = {}
    for date in sorted(filtered["Date"].unique(), reverse=True):
        date_records = filtered[filtered["Date"] == date].sort_values("Time", ascending=False)
        by_date[date] = date_records[["Roll Number", "Time", "Lab"]].to_dict(orient="records")

    return jsonify(by_date=by_date)


@app.get("/api/records/download")
def api_records_download():
    df = load_data()
    date_str = request.args.get("date")
    lab_filter = request.args.get("lab", "All")
    scope = request.args.get("scope", "filtered")  # 'filtered' or 'all'

    if scope == "all":
        out = df if lab_filter == "All" else df[df["Lab"] == lab_filter]
        filename = "all_attendance_records.csv"
    else:
        out = df[df["Date"] == date_str] if date_str else df
        if lab_filter != "All":
            out = out[out["Lab"] == lab_filter]
        filename = f"attendance_records_{date_str or 'all'}.csv"

    buf = BytesIO()
    out.to_csv(buf, index=False)
    buf.seek(0)
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=filename)


@app.post("/api/records/delete")
def api_records_delete():
    """Delete a single record by Roll Number + Time (+ Lab)."""
    data = request.get_json(force=True)
    roll_number = data.get("roll_number")
    time_str = data.get("time")
    lab = data.get("lab")

    query = AttendanceRecord.query.filter_by(roll_number=str(roll_number), time=time_str)
    if lab:
        base_lab = lab.replace(" (2nd sem)", "")
        query = query.filter_by(lab=base_lab)

    records = query.all()
    if not records:
        return jsonify(success=False, message="Record not found."), 404

    for r in records:
        db.session.delete(r)
    db.session.commit()
    return jsonify(success=True, message=f"Deleted record for {roll_number}")


@app.post("/api/records/delete-date")
def api_records_delete_date():
    data = request.get_json(force=True)
    date_str = data.get("date")
    AttendanceRecord.query.filter_by(date=date_str).delete()
    db.session.commit()
    return jsonify(success=True, message=f"Deleted all records for {date_str}")


@app.post("/api/records/delete-all")
def api_records_delete_all():
    data = request.get_json(force=True) or {}
    if (data.get("confirm") or "").strip().upper() != "DELETE":
        return jsonify(success=False, message="Type DELETE exactly to confirm."), 400
    AttendanceRecord.query.delete()
    db.session.commit()
    return jsonify(success=True, message="Deleted all attendance records")


# --------------------------------------------------------------------------
# Summary metrics
# --------------------------------------------------------------------------
@app.get("/api/summary")
def api_summary():
    df = load_data()
    today_str = datetime.now().strftime("%Y-%m-%d")
    return jsonify(
        total_records=len(df),
        today_count=int(df[df["Date"] == today_str].shape[0]),
        unique_students=int(df["Roll Number"].nunique()) if not df.empty else 0,
    )


# --------------------------------------------------------------------------
# Admin: Faculty management
# --------------------------------------------------------------------------
@app.get("/api/admin/faculty")
def api_admin_faculty_list():
    df = load_faculty_registry()
    records = []
    for _, row in df.iterrows():
        records.append({
            "id": str(row["ID"]),
            "name": str(row["Name"]),
            "email": str(row["Email"]),
            "department": str(row.get("Department", "")),
            "added_date": str(row.get("Added Date", "")),
        })
    return jsonify(faculty=records)


@app.post("/api/admin/faculty")
def api_admin_faculty_add():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    department = (data.get("department") or "").strip()

    if not name or not email:
        return jsonify(success=False, message="Name and Email are required."), 400

    if FacultyRegistry.query.filter_by(email=email).first():
        return jsonify(success=False, message=f"Faculty with email '{email}' already exists."), 400

    new_id = str(int(time.time() * 1000))
    new_faculty = FacultyRegistry(
        id=new_id,
        name=name,
        email=email,
        department=department,
        added_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )
    db.session.add(new_faculty)
    db.session.commit()
    return jsonify(success=True, message=f"Faculty '{name}' added successfully.", id=new_id)


@app.post("/api/admin/faculty/<faculty_id>/delete")
def api_admin_faculty_delete(faculty_id):
    fac = FacultyRegistry.query.filter_by(id=str(faculty_id)).first()
    if not fac:
        return jsonify(success=False, message="Faculty not found."), 404

    faculty_name = fac.name
    db.session.delete(fac)
    FacultyAssignment.query.filter_by(faculty_id=str(faculty_id)).delete()
    db.session.commit()
    return jsonify(success=True, message=f"Faculty '{faculty_name}' and their assignments deleted.")


# --------------------------------------------------------------------------
# Admin: Faculty-to-class assignments
# --------------------------------------------------------------------------
@app.get("/api/admin/assignments")
def api_admin_assignments_list():
    df = load_faculty_assignments()
    records = []
    for _, row in df.iterrows():
        records.append({
            "id": str(row["ID"]),
            "faculty_id": str(row["Faculty ID"]),
            "faculty_name": str(row["Faculty Name"]),
            "year": str(row["Year"]),
            "semester": str(row["Semester"]),
            "subject": str(row["Subject"]),
            "assigned_date": str(row.get("Assigned Date", "")),
        })
    return jsonify(assignments=records)


@app.post("/api/admin/assignments")
def api_admin_assignment_add():
    data = request.get_json(force=True)
    faculty_id = (data.get("faculty_id") or "").strip()
    year = (data.get("year") or "").strip()
    semester = (data.get("semester") or "").strip()
    subject = (data.get("subject") or "").strip()

    if not faculty_id or not year or not semester or not subject:
        return jsonify(success=False, message="All fields are required."), 400

    fac = FacultyRegistry.query.filter_by(id=faculty_id).first()
    if not fac:
        return jsonify(success=False, message="Faculty not found."), 404
    faculty_name = fac.name

    dup = FacultyAssignment.query.filter_by(year=year, semester=semester, subject=subject).first()
    if dup:
        return jsonify(
            success=False,
            message=f"Subject '{subject}' in {year} / {semester} is already assigned to '{dup.faculty_name}'.",
        ), 400

    new_id = str(int(time.time() * 1000))
    new_assign = FacultyAssignment(
        id=new_id,
        faculty_id=faculty_id,
        faculty_name=faculty_name,
        year=year,
        semester=semester,
        subject=subject,
        assigned_date=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )
    db.session.add(new_assign)
    db.session.commit()
    return jsonify(success=True, message=f"'{faculty_name}' assigned to {subject} ({year} / {semester}).")


@app.post("/api/admin/assignments/<assignment_id>/delete")
def api_admin_assignment_delete(assignment_id):
    assign = FacultyAssignment.query.filter_by(id=str(assignment_id)).first()
    if not assign:
        return jsonify(success=False, message="Assignment not found."), 404

    db.session.delete(assign)
    db.session.commit()
    return jsonify(success=True, message="Assignment removed.")


# --------------------------------------------------------------------------
# Admin: Student records by year & semester
# --------------------------------------------------------------------------
@app.get("/api/admin/students")
def api_admin_students():
    year = request.args.get("year", "")
    semester = request.args.get("semester", "")

    df = load_data()
    if df.empty:
        return jsonify(records=[], total=0)

    # Filter by subjects that belong to the selected year/semester
    if year and semester and year in SUBJECTS_BY_YEAR_SEM:
        sems = SUBJECTS_BY_YEAR_SEM[year]
        if semester in sems:
            subjects = sems[semester]
            df = df[df["Lab"].isin(subjects)]
        else:
            return jsonify(records=[], total=0)
    elif year and year in SUBJECTS_BY_YEAR_SEM:
        all_subs = []
        for sem_subs in SUBJECTS_BY_YEAR_SEM[year].values():
            all_subs.extend(sem_subs)
        df = df[df["Lab"].isin(all_subs)]

    if df.empty:
        return jsonify(records=[], total=0)

    by_subject = {}
    for subject in sorted(df["Lab"].unique()):
        subj_df = df[df["Lab"] == subject].sort_values(["Date", "Time"], ascending=[False, False])
        by_subject[subject] = subj_df[["Roll Number", "Date", "Time", "Lab"]].to_dict(orient="records")

    return jsonify(
        records=by_subject,
        total=len(df),
        unique_students=int(df["Roll Number"].nunique()),
    )


@app.get("/api/admin/students/download")
def api_admin_students_download():
    year = request.args.get("year", "")
    semester = request.args.get("semester", "")

    df = load_data()

    if year and semester and year in SUBJECTS_BY_YEAR_SEM:
        sems = SUBJECTS_BY_YEAR_SEM[year]
        if semester in sems:
            subjects = sems[semester]
            df = df[df["Lab"].isin(subjects)]
    elif year and year in SUBJECTS_BY_YEAR_SEM:
        all_subs = []
        for sem_subs in SUBJECTS_BY_YEAR_SEM[year].values():
            all_subs.extend(sem_subs)
        df = df[df["Lab"].isin(all_subs)]

    filename = f"students_{year}_{semester}.csv".replace(" ", "_") if year else "all_students.csv"
    buf = BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=filename)
@app.get("/api/admin/student-report/download")
def api_admin_student_report_download():
    roll_number = request.args.get("roll_number", "").strip()
    subject = request.args.get("subject", "").strip()
    month = request.args.get("month", "").strip() # Format: YYYY-MM
    date = request.args.get("date", "").strip() # Format: YYYY-MM-DD

    df = load_data()

    if roll_number:
        # Filter by roll number
        df = df[df["Roll Number"].astype(str) == roll_number]

    # Filter by subject
    if subject and subject != "All Subjects":
        df = df[df["Lab"] == subject]

    # Filter by date or month
    if date:
        df = df[df["Date"] == date]
    elif month:
        df = df[df["Date"].str.startswith(month)]

    filename = f"report_{roll_number}"
    if subject and subject != "All Subjects":
        filename += f"_{subject.replace(' ', '')}"
    if date:
        filename += f"_{date}"
    elif month:
        filename += f"_{month}"
    filename += ".csv"

    buf = BytesIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=filename)


# --------------------------------------------------------------------------
# Student Login & Dashboard
# --------------------------------------------------------------------------
@app.get("/student-login")
def student_login_page():
    """Serve the student login page (separate from main app).
    If credentials already verified (step 1 done), go straight to step 2.
    If fully verified, redirect to dashboard.
    """
    if session.get("student_verified") and session.get("student_roll"):
        return redirect(url_for("student_dashboard"))
    # Detect if coming from portal (step 1 already done)
    start_step = 2 if session.get("student_roll") and not session.get("student_verified") else 1
    return render_template(
        "student_login.html",
        college_lat=COLLEGE_LOCATION[0],
        college_lon=COLLEGE_LOCATION[1],
        allowed_radius=ALLOWED_RADIUS_METERS,
        face_recognition_available=FACE_RECOGNITION_AVAILABLE,
        start_step=start_step,
    )


@app.post("/api/student-login")
def api_student_login():
    """Step 1: Verify roll number exists in registry + check common password."""
    data = request.get_json(force=True)
    roll_number = (data.get("roll_number") or "").strip()
    password = data.get("password") or ""

    if not roll_number:
        return jsonify(success=False, message="Please enter your Roll Number."), 400
    if password != STUDENT_PASSWORD:
        return jsonify(success=False, message="Incorrect password."), 401

    # Check that the roll number exists in the student registry
    student = StudentRegistry.query.filter_by(roll_number=roll_number).first()
    if not student:
        return jsonify(
            success=False,
            message=f"Roll Number '{roll_number}' is not registered. Please contact your administrator."
        ), 404

    # Check if a face encoding exists for this student
    has_face = bool(student.face_encoding and len(student.face_encoding.strip()) > 10)

    # Store roll in session for subsequent steps
    session["student_roll"] = roll_number
    session["student_verified"] = False
    session["student_location_ok"] = False

    return jsonify(
        success=True,
        roll_number=roll_number,
        has_face=has_face,
        message="Credentials verified. Proceeding to location check."
    )


@app.post("/api/student-verify-location")
def api_student_verify_location():
    """Step 2: Verify the student is within the college geofence."""
    if not session.get("student_roll"):
        return jsonify(success=False, message="Please complete Step 1 first."), 403

    data = request.get_json(force=True)
    try:
        lat = float(data["lat"])
        lon = float(data["lon"])
    except (KeyError, TypeError, ValueError):
        return jsonify(success=False, message="Invalid coordinates."), 400

    within_range, distance = is_within_range(lat, lon)
    if within_range:
        session["student_location_ok"] = True

    return jsonify(
        success=True,
        within_range=within_range,
        distance=round(distance, 1),
        allowed_radius=ALLOWED_RADIUS_METERS,
    )


@app.post("/api/student-verify-face")
def api_student_verify_face():
    """
    Step 3: Match the uploaded face snapshot ONLY against the face encoding
    stored for the currently logged-in student (identified by session roll number).
    This is a 1:1 targeted match — not a search across all students.
    """
    if not FACE_RECOGNITION_AVAILABLE:
        return jsonify(success=False, message="Face recognition is not available on this server."), 400

    roll_number = session.get("student_roll")
    if not roll_number:
        return jsonify(success=False, message="Please complete Step 1 (credentials) first."), 403

    if not session.get("student_location_ok"):
        return jsonify(success=False, message="Please complete Step 2 (location) first."), 403

    if "image" not in request.files:
        return jsonify(success=False, message="No image provided."), 400

    # Fetch the registered encoding for THIS specific student only
    student = StudentRegistry.query.filter_by(roll_number=roll_number).first()
    if not student:
        return jsonify(success=False, message="Student not found."), 404

    registered_encoding = deserialize_face_encoding(student.face_encoding or "")
    if registered_encoding is None:
        return jsonify(
            success=False,
            message="No face enrolled for this student. Please contact your administrator."
        ), 400

    try:
        image = Image.open(request.files["image"]).convert("RGB")
        image_np = np.array(image)

        face_encodings = face_recognition.face_encodings(image_np)
        if not face_encodings:
            return jsonify(success=False, message="No face detected. Please look directly at the camera."), 400
        if len(face_encodings) > 1:
            return jsonify(success=False, message="Multiple faces detected. Please ensure only your face is in the frame."), 400

        unknown_encoding = face_encodings[0]

        # 1-vs-1 targeted match
        matches = face_recognition.compare_faces([registered_encoding], unknown_encoding, tolerance=0.55)
        face_distance = face_recognition.face_distance([registered_encoding], unknown_encoding)[0]

        if matches[0]:
            # Mark student as fully verified in session
            session["student_verified"] = True
            session["user_role"] = "student"
            session["username"] = roll_number
            confidence = round((1 - float(face_distance)) * 100, 1)
            return jsonify(
                success=True,
                roll_number=roll_number,
                confidence=confidence,
                message=f"Face verified! Welcome, {roll_number}."
            )
        else:
            confidence = round((1 - float(face_distance)) * 100, 1)
            return jsonify(
                success=False,
                message=f"Face did not match the registered face for Roll Number {roll_number}. Please try again.",
                confidence=confidence
            ), 401

    except Exception as e:
        return jsonify(success=False, message=f"Error processing face: {str(e)}"), 500


@app.get("/student-dashboard")
def student_dashboard():
    """Personal student dashboard — requires full 3-step verification.
    All data is passed server-side so the page works even if the JS fetch
    cannot re-authenticate (avoids blank page after redirect)."""
    if not session.get("student_verified") or not session.get("student_roll"):
        return redirect(url_for("student_login_page"))

    roll_number = session["student_roll"]

    # Fetch all records for this student
    records_raw = AttendanceRecord.query.filter_by(roll_number=roll_number).order_by(
        AttendanceRecord.date.desc(), AttendanceRecord.time.desc()
    ).all()

    today_str = datetime.now().strftime("%Y-%m-%d")
    records = []
    for r in records_raw:
        records.append({
            "date": r.date,
            "time": r.time,
            "lab": r.lab,
            "is_today": r.date == today_str,
        })

    today_records = [r for r in records if r["is_today"]]
    today_count = len(today_records)

    # Group by subject
    by_subject = {}
    for rec in records:
        subj = rec["lab"]
        if subj not in by_subject:
            by_subject[subj] = []
        by_subject[subj].append(rec)

    return render_template(
        "student_dashboard.html",
        roll_number=roll_number,
        all_subjects=ALL_SUBJECTS,
        subjects_by_year_sem=SUBJECTS_BY_YEAR_SEM,
        records=records,
        today_records=today_records,
        today_count=today_count,
        total=len(records),
        by_subject=by_subject,
        subjects_attended=len(by_subject),
        today_str=today_str,
    )



@app.get("/api/student/my-records")
def api_student_my_records():
    """Return only the attendance records for the currently logged-in student."""
    if not session.get("student_verified") or not session.get("student_roll"):
        return jsonify(success=False, message="Not authenticated."), 403

    roll_number = session["student_roll"]
    records = AttendanceRecord.query.filter_by(roll_number=roll_number).order_by(
        AttendanceRecord.date.desc(), AttendanceRecord.time.desc()
    ).all()

    today_str = datetime.now().strftime("%Y-%m-%d")
    data = []
    for r in records:
        data.append({
            "date": r.date,
            "time": r.time,
            "lab": r.lab,
            "is_today": r.date == today_str
        })

    today_count = sum(1 for r in data if r["is_today"])

    # Group by subject
    by_subject = {}
    for rec in data:
        subj = rec["lab"]
        if subj not in by_subject:
            by_subject[subj] = []
        by_subject[subj].append(rec)

    return jsonify(
        success=True,
        roll_number=roll_number,
        total=len(data),
        today_count=today_count,
        records=data,
        by_subject=by_subject,
    )


@app.post("/api/student-logout")
def api_student_logout():
    """Clear student session."""
    session.pop("student_roll", None)
    session.pop("student_verified", None)
    session.pop("student_location_ok", None)
    session["user_role"] = "student"
    session["username"] = "Student"
    return jsonify(success=True)


# --------------------------------------------------------------------------
# Live Class Sessions — Faculty routes
# --------------------------------------------------------------------------

def _require_faculty():
    """Return (faculty_id, faculty_name) if logged in as faculty/admin, else None."""
    role = session.get("user_role")
    if role not in ("faculty", "admin"):
        return None, None
    fid = session.get("username", "")
    # Try to get display name from registry
    fac = FacultyRegistry.query.filter_by(email=fid).first()
    fname = fac.name if fac else fid
    return fid, fname


@app.post("/api/faculty/sessions/open")
def api_faculty_open_session():
    """Faculty opens a live class session for a subject."""
    fid, fname = _require_faculty()
    if not fid:
        return jsonify(success=False, message="Faculty login required."), 403

    data = request.get_json(force=True)
    subject = (data.get("subject") or "").strip()
    year    = (data.get("year") or "").strip()
    semester= (data.get("semester") or "").strip()

    if not subject:
        return jsonify(success=False, message="Subject is required."), 400

    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    time_str  = now.strftime("%H:%M:%S")

    # Check if same faculty already has an active session for this subject today
    existing = ClassSession.query.filter_by(
        faculty_id=fid, subject=subject, date=today_str, is_active=True
    ).first()
    if existing:
        return jsonify(
            success=False,
            message=f"You already have an active session for '{subject}'. Please close it first."
        ), 400

    new_session = ClassSession(
        faculty_id=fid,
        faculty_name=fname,
        subject=subject,
        year=year,
        semester=semester,
        date=today_str,
        opened_at=time_str,
        is_active=True,
    )
    db.session.add(new_session)
    db.session.commit()
    return jsonify(
        success=True,
        session_id=new_session.id,
        message=f"Live session opened for '{subject}'. Students can now mark attendance.",
        subject=subject,
        opened_at=time_str,
    )


@app.post("/api/faculty/sessions/<int:session_id>/close")
def api_faculty_close_session(session_id):
    """Faculty closes a live class session."""
    fid, _ = _require_faculty()
    if not fid:
        return jsonify(success=False, message="Faculty login required."), 403

    cs = ClassSession.query.filter_by(id=session_id).first()
    if not cs:
        return jsonify(success=False, message="Session not found."), 404
    if cs.faculty_id != fid:
        return jsonify(success=False, message="You can only close your own sessions."), 403
    if not cs.is_active:
        return jsonify(success=False, message="Session already closed."), 400

    cs.is_active = False
    cs.closed_at = datetime.now().strftime("%H:%M:%S")
    db.session.commit()

    # How many students marked attendance in this session
    count = AttendanceRecord.query.filter_by(
        lab=cs.subject, date=cs.date
    ).count()

    return jsonify(
        success=True,
        message=f"Session for '{cs.subject}' closed.",
        subject=cs.subject,
        attendance_count=count,
    )


@app.get("/api/faculty/sessions")
def api_faculty_sessions():
    """Return today's sessions for the logged-in faculty member."""
    fid, _ = _require_faculty()
    if not fid:
        return jsonify(success=False, message="Faculty login required."), 403

    today_str = datetime.now().strftime("%Y-%m-%d")
    sessions = ClassSession.query.filter_by(
        faculty_id=fid, date=today_str
    ).order_by(ClassSession.opened_at.desc()).all()

    result = []
    for s in sessions:
        # Count students who marked attendance in this session
        count = AttendanceRecord.query.filter_by(
            lab=s.subject, date=s.date
        ).count()
        result.append({
            "id": s.id,
            "subject": s.subject,
            "year": s.year,
            "semester": s.semester,
            "opened_at": s.opened_at,
            "closed_at": s.closed_at or "",
            "is_active": s.is_active,
            "attendance_count": count,
        })
    return jsonify(success=True, sessions=result)


# --------------------------------------------------------------------------
# Live Class Sessions — Student routes
# --------------------------------------------------------------------------

@app.get("/api/student/live-sessions")
def api_student_live_sessions():
    """Return all currently active class sessions (visible to any verified student)."""
    # Students don't need to be logged in to poll — sessions are public broadcast
    today_str = datetime.now().strftime("%Y-%m-%d")
    sessions = ClassSession.query.filter_by(
        date=today_str, is_active=True
    ).order_by(ClassSession.opened_at.desc()).all()

    result = []
    for s in sessions:
        result.append({
            "id": s.id,
            "subject": s.subject,
            "year": s.year,
            "semester": s.semester,
            "faculty_name": s.faculty_name,
            "opened_at": s.opened_at,
        })
    return jsonify(success=True, sessions=result)


@app.post("/api/student/mark-live-attendance")
def api_student_mark_live_attendance():
    """Student marks attendance for an active live session.
    Requires the student to be fully verified (3-step login complete)."""
    if not session.get("student_verified") or not session.get("student_roll"):
        return jsonify(success=False, message="Please complete the student login first."), 403

    data = request.get_json(force=True)
    session_id = data.get("session_id")

    if not session_id:
        return jsonify(success=False, message="Session ID is required."), 400

    cs = ClassSession.query.filter_by(id=int(session_id), is_active=True).first()
    if not cs:
        return jsonify(
            success=False,
            message="This class session is no longer active or does not exist."
        ), 404

    roll_number = session["student_roll"]

    # Check if student is registered
    student = StudentRegistry.query.filter_by(roll_number=roll_number).first()
    if not student:
        return jsonify(
            success=False,
            message=f"Roll Number '{roll_number}' is not registered. Please contact your administrator."
        ), 404

    # Mark attendance (reuses existing business logic)
    ok, msg = mark_attendance(roll_number, cs.subject)
    return jsonify(success=ok, message=msg, roll_number=roll_number, subject=cs.subject)


if __name__ == "__main__":
    # Use ssl_context='adhoc' to enable HTTPS for local network testing.
    # This is required because modern browsers block Geolocation on HTTP connections
    # unless it's strictly localhost.
    app.run(debug=True, host="0.0.0.0", port=4000, ssl_context="adhoc")
