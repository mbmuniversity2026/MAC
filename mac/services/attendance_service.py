"""Attendance service — face registration, verification, and attendance marking.

Face recognition uses insightface (ArcFace, buffalo_sc model) via ONNX Runtime on CPU.
Embeddings are 512-dimensional float32 vectors, compared via cosine similarity.
Threshold ~0.35 cosine similarity → same person (tuned for buffalo_sc).

Fallback: if insightface fails to load (first-run model download, no internet), the
registration succeeds but comparison always returns (True, 0.80) so attendance works
even without the ML model. A warning is logged.
"""

import base64
import hashlib
import io
import json
import logging
import os
import struct
from datetime import datetime, date, timezone
from typing import Optional

import numpy as np
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from mac.models.attendance import FaceTemplate, AttendanceSession, AttendanceRecord
from mac.models.user import User

log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
FACE_PHOTOS_DIR = "/app/uploads/attendance/faces"
INSIGHTFACE_HOME = os.environ.get("INSIGHTFACE_HOME", "/opt/insightface_models")

# Cosine similarity threshold for same-person match (buffalo_sc ArcFace).
# 0.30 → very lenient, 0.40 → strict, 0.35 → balanced.
FACE_MATCH_THRESHOLD = float(os.environ.get("FACE_MATCH_THRESHOLD", "0.35"))

# Embedding dtype/shape — buffalo_sc gives 512D float32
EMBED_DIM = 512
EMBED_DTYPE = np.float32


# ── Lazy-loaded insightface app ────────────────────────────────────────────────
_face_app = None
_face_app_failed = False


def _get_face_app():
    """Lazily initialise insightface FaceAnalysis. Thread-safe for asyncio (single-threaded)."""
    global _face_app, _face_app_failed
    if _face_app is not None:
        return _face_app
    if _face_app_failed:
        return None
    try:
        from insightface.app import FaceAnalysis
        os.makedirs(INSIGHTFACE_HOME, exist_ok=True)
        app = FaceAnalysis(
            name="buffalo_sc",
            root=INSIGHTFACE_HOME,
            providers=["CPUExecutionProvider"],
        )
        # det_size 320x320 is fast on CPU; use 640x640 for higher accuracy
        app.prepare(ctx_id=0, det_size=(320, 320))
        _face_app = app
        log.info("insightface FaceAnalysis ready (buffalo_sc, CPU)")
        return _face_app
    except Exception as exc:
        log.warning("insightface unavailable — face comparison will use fallback: %s", exc)
        _face_app_failed = True
        return None


# ── Image helpers ─────────────────────────────────────────────────────────────

def _utcnow():
    return datetime.now(timezone.utc)


def _decode_base64_image(b64_string: str) -> bytes:
    """Strip data URL prefix and decode base64."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    return base64.b64decode(b64_string)


def _hash_image(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def _bytes_to_img(image_bytes: bytes):
    """Decode image bytes to BGR numpy array for insightface."""
    import cv2
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def _embedding_to_bytes(embedding: np.ndarray) -> bytes:
    """Serialise float32 embedding to raw bytes (2048 bytes for 512D)."""
    return embedding.astype(EMBED_DTYPE).tobytes()


def _bytes_to_embedding(data: bytes) -> Optional[np.ndarray]:
    """Deserialise bytes back to float32 numpy array."""
    if not data or len(data) != EMBED_DIM * 4:
        return None
    return np.frombuffer(data, dtype=EMBED_DTYPE).copy()


# ── Core face functions ────────────────────────────────────────────────────────

def _compute_face_embedding(image_bytes: bytes) -> tuple[Optional[bytes], Optional[str]]:
    """Detect face and compute ArcFace embedding.

    Returns (embedding_bytes, error_message).
    embedding_bytes is None on failure.
    """
    app = _get_face_app()
    if app is None:
        # No insightface — use deterministic hash-based pseudo-embedding as fallback
        # This allows the system to function but won't provide real face matching.
        log.warning("Using hash fallback for face embedding (insightface unavailable)")
        h = hashlib.sha512(image_bytes).digest()  # 64 bytes
        # Expand to 512 floats by repeating + normalising
        arr = np.frombuffer(h * 8, dtype=np.uint8).astype(EMBED_DTYPE)[:EMBED_DIM]
        arr = arr / (np.linalg.norm(arr) + 1e-6)
        return _embedding_to_bytes(arr), None

    img = _bytes_to_img(image_bytes)
    if img is None:
        return None, "Could not decode image — please use JPEG or PNG"

    try:
        faces = app.get(img)
    except Exception as exc:
        log.error("insightface detection error: %s", exc)
        return None, "Face analysis failed — please try again"

    if not faces:
        return None, "No face detected — ensure your face is clearly visible in the frame"

    if len(faces) > 1:
        return None, "Multiple faces detected — only one person should be in frame"

    face = faces[0]

    # Quality check: face bounding box should be reasonably large
    box = face.bbox  # [x1, y1, x2, y2]
    face_w = box[2] - box[0]
    face_h = box[3] - box[1]
    img_h, img_w = img.shape[:2]
    face_ratio = (face_w * face_h) / (img_w * img_h + 1e-6)
    if face_ratio < 0.02:
        return None, "Face too small — move closer to the camera"

    embedding = face.embedding  # 512D float32
    if embedding is None:
        return None, "Could not extract face features — please retake photo"

    # L2-normalise for cosine similarity
    norm = np.linalg.norm(embedding)
    if norm > 0:
        embedding = embedding / norm

    return _embedding_to_bytes(embedding), None


def _compare_embeddings(stored_bytes: bytes, live_bytes: bytes) -> tuple[bool, float]:
    """Compare two face embeddings. Returns (is_match, confidence_0_to_1).

    Cosine similarity on L2-normalised vectors = dot product.
    Map similarity 0..1 → confidence 0..100% non-linearly for nicer display.
    """
    e1 = _bytes_to_embedding(stored_bytes)
    e2 = _bytes_to_embedding(live_bytes)
    if e1 is None or e2 is None:
        return False, 0.0

    app = _get_face_app()
    if app is None:
        # Fallback: exact same image = same hash → same embedding (demo only)
        cosine_sim = float(np.dot(e1, e2))
        is_same = cosine_sim > 0.99  # Only matches if literally identical image
        return is_same, float(cosine_sim)

    cosine_sim = float(np.dot(e1, e2))  # Both are L2-normalised
    # Clamp to [0, 1] (can be slightly negative for very different faces)
    cosine_sim = max(0.0, min(1.0, cosine_sim))
    is_match = cosine_sim >= FACE_MATCH_THRESHOLD

    # Map cosine similarity to a 0–1 confidence value for display
    # Threshold (0.35) → 0.5 confidence; 0.7+ → 0.95+ confidence
    if cosine_sim < FACE_MATCH_THRESHOLD:
        confidence = cosine_sim / FACE_MATCH_THRESHOLD * 0.5
    else:
        span = 1.0 - FACE_MATCH_THRESHOLD
        confidence = 0.5 + ((cosine_sim - FACE_MATCH_THRESHOLD) / span) * 0.5

    return is_match, round(confidence, 4)


# ── Photo storage ─────────────────────────────────────────────────────────────

def _save_face_photo(user_id: str, image_bytes: bytes) -> Optional[str]:
    """Save face JPEG to FACE_PHOTOS_DIR. Returns relative path or None on error."""
    try:
        import cv2
        os.makedirs(FACE_PHOTOS_DIR, exist_ok=True)
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return None
        # Resize to max 320px wide for storage efficiency
        h, w = img.shape[:2]
        if w > 320:
            scale = 320 / w
            img = cv2.resize(img, (320, int(h * scale)))
        filename = f"{user_id}.jpg"
        path = os.path.join(FACE_PHOTOS_DIR, filename)
        cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return f"faces/{filename}"
    except Exception as exc:
        log.error("Face photo save failed for user %s: %s", user_id, exc)
        return None


def get_face_photo_path(user_id: str) -> Optional[str]:
    """Return absolute path to stored face photo, or None if not found."""
    path = os.path.join(FACE_PHOTOS_DIR, f"{user_id}.jpg")
    return path if os.path.exists(path) else None


# ── Face Registration ─────────────────────────────────────────────────────────

async def register_face(db: AsyncSession, user_id: str, face_image_b64: str) -> dict:
    """Register / update face template for a user. Stores embedding + photo."""
    image_bytes = _decode_base64_image(face_image_b64)
    photo_hash = _hash_image(image_bytes)

    embedding_bytes, error = _compute_face_embedding(image_bytes)
    if error:
        return {"success": False, "message": error}
    if not embedding_bytes:
        return {"success": False, "message": "Could not extract face features"}

    # Save face photo for admin/faculty display
    photo_path = _save_face_photo(user_id, image_bytes)

    # Upsert face template
    existing = await db.execute(
        select(FaceTemplate).where(FaceTemplate.user_id == user_id)
    )
    template = existing.scalar_one_or_none()

    if template:
        template.face_encoding = embedding_bytes
        template.photo_hash = photo_hash
        template.face_photo_path = photo_path
        template.updated_at = _utcnow()
    else:
        template = FaceTemplate(
            user_id=user_id,
            face_encoding=embedding_bytes,
            photo_hash=photo_hash,
            face_photo_path=photo_path,
        )
        db.add(template)

    await db.flush()

    app_available = _get_face_app() is not None
    return {
        "success": True,
        "message": "Face registered successfully",
        "quality": "high" if app_available else "basic",
        "note": None if app_available else "Face recognition model loading — comparison will be available shortly",
    }


async def get_face_template(db: AsyncSession, user_id: str) -> Optional[FaceTemplate]:
    result = await db.execute(
        select(FaceTemplate).where(FaceTemplate.user_id == user_id)
    )
    return result.scalar_one_or_none()


# ── Attendance Sessions ────────────────────────────────────────────────────────

async def create_session(
    db: AsyncSession,
    title: str,
    department: str,
    opened_by: str,
    session_date: date,
    subject: Optional[str] = None,
) -> AttendanceSession:
    session = AttendanceSession(
        title=title,
        department=department,
        subject=subject,
        session_date=session_date,
        opened_by=opened_by,
    )
    db.add(session)
    await db.flush()
    return session


async def close_session(db: AsyncSession, session_id: str) -> bool:
    result = await db.execute(
        select(AttendanceSession).where(AttendanceSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        return False
    session.is_open = False
    session.closed_at = _utcnow()
    return True


async def get_session(db: AsyncSession, session_id: str) -> Optional[AttendanceSession]:
    result = await db.execute(
        select(AttendanceSession)
        .options(selectinload(AttendanceSession.records))
        .where(AttendanceSession.id == session_id)
    )
    return result.scalar_one_or_none()


async def list_sessions(
    db: AsyncSession,
    department: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = 1,
    per_page: int = 20,
) -> tuple[list[AttendanceSession], int]:
    query = select(AttendanceSession)
    count_query = select(func.count(AttendanceSession.id))

    if department:
        query = query.where(AttendanceSession.department == department)
        count_query = count_query.where(AttendanceSession.department == department)
    if date_from:
        query = query.where(AttendanceSession.session_date >= date_from)
        count_query = count_query.where(AttendanceSession.session_date >= date_from)
    if date_to:
        query = query.where(AttendanceSession.session_date <= date_to)
        count_query = count_query.where(AttendanceSession.session_date <= date_to)

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.order_by(AttendanceSession.session_date.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), total


# ── Mark Attendance ────────────────────────────────────────────────────────────

async def mark_attendance(
    db: AsyncSession,
    session_id: str,
    user_id: str,
    face_image_b64: str,
    ip_address: Optional[str] = None,
) -> dict:
    """Mark attendance with real face verification.

    Pipeline:
    1. Session open + not already marked
    2. Face template exists
    3. Compute live embedding from submitted photo
    4. Compare with stored embedding (cosine similarity)
    5. Accept if confidence >= FACE_MATCH_THRESHOLD
    """
    session = await db.execute(
        select(AttendanceSession).where(AttendanceSession.id == session_id)
    )
    att_session = session.scalar_one_or_none()
    if not att_session or not att_session.is_open:
        return {"success": False, "message": "Session is not open"}

    existing = await db.execute(
        select(AttendanceRecord).where(
            AttendanceRecord.session_id == session_id,
            AttendanceRecord.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        return {"success": False, "message": "Attendance already marked for this session"}

    template = await get_face_template(db, user_id)
    if not template:
        return {"success": False, "message": "Face not registered. Please register your face first."}

    image_bytes = _decode_base64_image(face_image_b64)
    live_embedding, error = _compute_face_embedding(image_bytes)

    if error:
        return {"success": False, "message": error}
    if not live_embedding:
        return {"success": False, "message": "Could not extract face from live photo — please retake"}

    face_verified, confidence = _compare_embeddings(template.face_encoding, live_embedding)

    if not face_verified:
        pct = round(confidence * 100, 1)
        return {
            "success": False,
            "message": f"Face did not match your registered photo (confidence {pct}%). "
                       "Ensure good lighting and look directly at the camera.",
            "confidence": confidence,
        }

    record = AttendanceRecord(
        session_id=session_id,
        user_id=user_id,
        face_match_confidence=confidence,
        face_verified=True,
        photo_hash=_hash_image(image_bytes),
        ip_address=ip_address,
    )
    db.add(record)
    await db.flush()

    return {
        "success": True,
        "message": "Attendance marked successfully",
        "confidence": confidence,
        "verified": True,
        "record_id": record.id,
    }


# ── Reports ────────────────────────────────────────────────────────────────────

async def get_session_report(db: AsyncSession, session_id: str) -> dict:
    """Full attendance report for a session."""
    session = await get_session(db, session_id)
    if not session:
        return None

    records = session.records
    user_ids = [r.user_id for r in records]
    users_map = {}
    if user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u for u in users_result.scalars().all()}

    # Fetch face templates for photo paths
    templates_map = {}
    if user_ids:
        tmpl_result = await db.execute(
            select(FaceTemplate).where(FaceTemplate.user_id.in_(user_ids))
        )
        templates_map = {t.user_id: t for t in tmpl_result.scalars().all()}

    enriched_records = []
    for r in records:
        user = users_map.get(r.user_id)
        tmpl = templates_map.get(r.user_id)
        enriched_records.append({
            "id": r.id,
            "session_id": r.session_id,
            "user_id": r.user_id,
            "student_name": user.name if user else None,
            "roll_number": user.roll_number if user else None,
            "department": user.department if user else None,
            "face_match_confidence": r.face_match_confidence,
            "face_verified": r.face_verified,
            "face_photo_path": tmpl.face_photo_path if tmpl else None,
            "ip_address": r.ip_address,
            "marked_at": r.marked_at.isoformat(),
        })

    return {
        "session": {
            "id": session.id,
            "title": session.title,
            "department": session.department,
            "subject": session.subject,
            "session_date": session.session_date.isoformat(),
            "is_open": session.is_open,
            "opened_by": session.opened_by,
            "opened_at": session.opened_at.isoformat(),
            "closed_at": session.closed_at.isoformat() if session.closed_at else None,
            "record_count": len(records),
        },
        "records": enriched_records,
        "total_present": len(records),
    }


async def get_student_summary(
    db: AsyncSession, department: Optional[str] = None
) -> list[dict]:
    """Per-student attendance summary across all sessions."""
    query = select(AttendanceSession)
    if department:
        query = query.where(AttendanceSession.department == department)
    sessions_result = await db.execute(query)
    sessions = list(sessions_result.scalars().all())
    total_sessions = len(sessions)
    if total_sessions == 0:
        return []

    session_ids = [s.id for s in sessions]
    result = await db.execute(
        select(
            AttendanceRecord.user_id,
            func.count(AttendanceRecord.id).label("attended"),
        )
        .where(AttendanceRecord.session_id.in_(session_ids))
        .group_by(AttendanceRecord.user_id)
    )
    attendance_map = {row.user_id: row.attended for row in result.all()}

    users_result = await db.execute(
        select(User).where(User.id.in_(list(attendance_map.keys())))
    )
    users = list(users_result.scalars().all())

    # Fetch face templates for photo paths
    if users:
        tmpl_result = await db.execute(
            select(FaceTemplate).where(FaceTemplate.user_id.in_([u.id for u in users]))
        )
        templates_map = {t.user_id: t for t in tmpl_result.scalars().all()}
    else:
        templates_map = {}

    summaries = []
    for user in users:
        attended = attendance_map.get(user.id, 0)
        tmpl = templates_map.get(user.id)
        summaries.append({
            "user_id": user.id,
            "student_name": user.name,
            "roll_number": user.roll_number,
            "department": user.department,
            "face_photo_path": tmpl.face_photo_path if tmpl else None,
            "total_sessions": total_sessions,
            "sessions_attended": attended,
            "attendance_pct": round((attended / total_sessions) * 100, 1) if total_sessions > 0 else 0,
        })

    return sorted(summaries, key=lambda x: x["attendance_pct"], reverse=True)


async def get_marked_session_ids(db: AsyncSession, user_id: str, for_date: date) -> set:
    sessions_result = await db.execute(
        select(AttendanceSession.id).where(AttendanceSession.session_date == for_date)
    )
    session_ids = [row[0] for row in sessions_result.all()]
    if not session_ids:
        return set()
    records_result = await db.execute(
        select(AttendanceRecord.session_id).where(
            AttendanceRecord.user_id == user_id,
            AttendanceRecord.session_id.in_(session_ids),
        )
    )
    return {row[0] for row in records_result.all()}


async def get_admin_overview(
    db: AsyncSession,
    department: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = 1,
    per_page: int = 30,
) -> dict:
    """Enriched overview: sessions with opener name, student records, confidence stats."""
    sessions, total = await list_sessions(
        db, department=department, date_from=date_from, date_to=date_to,
        page=page, per_page=per_page,
    )
    if not sessions:
        return {"sessions": [], "total": 0, "page": page, "per_page": per_page}

    session_ids = [s.id for s in sessions]
    opener_ids = list({s.opened_by for s in sessions})

    openers_result = await db.execute(select(User).where(User.id.in_(opener_ids)))
    openers_map = {u.id: u for u in openers_result.scalars().all()}

    records_result = await db.execute(
        select(AttendanceRecord)
        .where(AttendanceRecord.session_id.in_(session_ids))
        .order_by(AttendanceRecord.marked_at.desc())
    )
    all_records = list(records_result.scalars().all())

    student_ids = list({r.user_id for r in all_records})
    students_map: dict = {}
    templates_map: dict = {}
    if student_ids:
        students_result = await db.execute(select(User).where(User.id.in_(student_ids)))
        students_map = {u.id: u for u in students_result.scalars().all()}
        tmpl_result = await db.execute(
            select(FaceTemplate).where(FaceTemplate.user_id.in_(student_ids))
        )
        templates_map = {t.user_id: t for t in tmpl_result.scalars().all()}

    records_by_session: dict = {}
    for r in all_records:
        records_by_session.setdefault(r.session_id, []).append(r)

    enriched = []
    for s in sessions:
        opener = openers_map.get(s.opened_by)
        recs = records_by_session.get(s.id, [])
        avg_confidence = (sum(r.face_match_confidence for r in recs) / len(recs)) if recs else None
        enriched.append({
            "id": s.id,
            "title": s.title,
            "department": s.department,
            "subject": s.subject,
            "session_date": s.session_date.isoformat(),
            "is_open": s.is_open,
            "opened_at": s.opened_at.isoformat(),
            "closed_at": s.closed_at.isoformat() if s.closed_at else None,
            "opened_by_id": s.opened_by,
            "opened_by_name": opener.name if opener else "Unknown",
            "opened_by_email": opener.email if opener else None,
            "record_count": len(recs),
            "avg_confidence": round(avg_confidence * 100, 1) if avg_confidence else None,
            "students": [
                {
                    "record_id": r.id,
                    "user_id": r.user_id,
                    "name": students_map[r.user_id].name if r.user_id in students_map else "Unknown",
                    "roll_number": students_map[r.user_id].roll_number if r.user_id in students_map else None,
                    "department": students_map[r.user_id].department if r.user_id in students_map else None,
                    "face_verified": r.face_verified,
                    "confidence": round(r.face_match_confidence * 100, 1),
                    "face_photo_path": templates_map[r.user_id].face_photo_path if r.user_id in templates_map else None,
                    "marked_at": r.marked_at.isoformat(),
                    "ip_address": r.ip_address,
                }
                for r in recs
            ],
        })

    return {"sessions": enriched, "total": total, "page": page, "per_page": per_page}
