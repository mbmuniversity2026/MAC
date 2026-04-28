"""Copy Check service — AI vision evaluation + plagiarism detection + PDF reports."""

import os
import json
import base64
import difflib
import pathlib
import asyncio
import textwrap
from datetime import datetime, timezone
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from mac.models.copy_check import CopyCheckSession, CopyCheckSheet, CopyCheckPlagiarism
from mac.models.user import StudentRegistry

UPLOADS_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / "uploads" / "copy_check"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ── Session CRUD ─────────────────────────────────────────

async def create_session(db: AsyncSession, user_id: str, data: dict) -> CopyCheckSession:
    sess = CopyCheckSession(
        created_by=user_id,
        subject=data["subject"],
        class_name=data.get("class_name", ""),
        department=data.get("department", "CSE"),
        total_marks=data.get("total_marks", 100),
        syllabus_text=data.get("syllabus_text"),
    )
    db.add(sess)
    await db.commit()
    await db.refresh(sess)
    return sess


async def get_sessions(db: AsyncSession, user_id: str, user_role: str, page=1, per_page=20):
    q = select(CopyCheckSession)
    if user_role not in ("admin", "faculty"):
        return [], 0
    if user_role == "faculty":
        q = q.where(CopyCheckSession.created_by == user_id)
    q = q.order_by(CopyCheckSession.created_at.desc())
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    q = q.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).scalars().all()
    return list(rows), total


async def get_session(db: AsyncSession, session_id: str) -> CopyCheckSession | None:
    return (await db.execute(select(CopyCheckSession).where(CopyCheckSession.id == session_id))).scalar_one_or_none()


async def get_sheets(db: AsyncSession, session_id: str) -> list[CopyCheckSheet]:
    rows = (await db.execute(
        select(CopyCheckSheet).where(CopyCheckSheet.session_id == session_id).order_by(CopyCheckSheet.student_roll)
    )).scalars().all()
    return list(rows)


async def get_sheet(db: AsyncSession, sheet_id: str) -> CopyCheckSheet | None:
    return (await db.execute(select(CopyCheckSheet).where(CopyCheckSheet.id == sheet_id))).scalar_one_or_none()


async def get_registered_students(db: AsyncSession, department: str | None = None):
    q = select(StudentRegistry)
    if department:
        q = q.where(StudentRegistry.department == department)
    q = q.order_by(StudentRegistry.roll_number)
    return list((await db.execute(q)).scalars().all())


# ── File Upload ──────────────────────────────────────────

async def save_sheet_file(session_id: str, student_roll: str, file_bytes: bytes, filename: str) -> str:
    session_dir = UPLOADS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{student_roll}_{filename}"
    path = session_dir / safe_name
    with open(path, "wb") as f:
        f.write(file_bytes)
    return str(path)


async def save_syllabus_file(session_id: str, file_bytes: bytes, filename: str) -> str:
    session_dir = UPLOADS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    path = session_dir / f"syllabus_{filename}"
    with open(path, "wb") as f:
        f.write(file_bytes)
    return str(path)


async def upsert_sheet(db: AsyncSession, session_id: str, student_roll: str,
                       student_name: str, department: str,
                       file_path: str, file_name: str) -> CopyCheckSheet:
    existing = (await db.execute(
        select(CopyCheckSheet).where(
            CopyCheckSheet.session_id == session_id,
            CopyCheckSheet.student_roll == student_roll,
        )
    )).scalar_one_or_none()

    if existing:
        existing.file_path = file_path
        existing.file_name = file_name
        existing.status = "uploaded"
        existing.ai_marks = None
        existing.ai_feedback = None
        existing.extracted_text = None
        existing.error_message = None
        existing.evaluated_at = None
        await db.commit()
        await db.refresh(existing)
        # Update session count
        sess = await get_session(db, session_id)
        if sess:
            sess.updated_at = datetime.now(timezone.utc)
            await db.commit()
        return existing
    else:
        sheet = CopyCheckSheet(
            session_id=session_id,
            student_roll=student_roll,
            student_name=student_name,
            department=department,
            file_path=file_path,
            file_name=file_name,
        )
        db.add(sheet)
        # Increment sheet count
        sess = await get_session(db, session_id)
        if sess:
            sess.sheet_count = (sess.sheet_count or 0) + 1
            sess.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(sheet)
        return sheet


# ── AI Evaluation ─────────────────────────────────────────

def _build_eval_prompt(subject: str, total_marks: int, syllabus_context: str | None) -> str:
    syllabus_section = ""
    if syllabus_context:
        syllabus_section = f"\n\nSYLLABUS / MARKING SCHEME:\n{syllabus_context[:3000]}"

    return f"""You are a professional examiner evaluating a student's handwritten answer sheet.

SUBJECT: {subject}
TOTAL MARKS: {total_marks}{syllabus_section}

Your tasks:
1. READ the handwritten answer sheet image carefully.
2. EXTRACT all written answers (transcribe them as plain text under "EXTRACTED ANSWERS:").
3. EVALUATE each answer for: correctness, completeness, clarity, and relevance.
4. ASSIGN marks fairly, awarding partial credit where appropriate.

Respond in this EXACT format:

EXTRACTED ANSWERS:
[Full transcription of all answers from the sheet]

EVALUATION:
[Question-by-question breakdown with marks awarded]

TOTAL MARKS: [number]/{total_marks}
OVERALL FEEDBACK: [2-3 sentences of constructive feedback]

Be fair, consistent, and detailed."""


async def evaluate_sheet(
    sheet: CopyCheckSheet,
    session: CopyCheckSession,
    http_client,
    llm_url: str,
) -> dict:
    """Call vision LLM to evaluate one sheet. Returns {marks, feedback, extracted_text}."""
    # Read image as base64
    try:
        with open(sheet.file_path, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode()
    except Exception as e:
        return {"marks": None, "feedback": f"File read error: {e}", "extracted_text": ""}

    # Determine mime type
    fname = sheet.file_name.lower()
    if fname.endswith(".png"):
        mime = "image/png"
    elif fname.endswith(".pdf"):
        mime = "application/pdf"
    else:
        mime = "image/jpeg"

    prompt = _build_eval_prompt(session.subject, session.total_marks, session.syllabus_text)

    payload = {
        "model": "auto",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ],
        }],
        "temperature": 0.1,
        "max_tokens": 3000,
    }

    try:
        resp = await http_client.post(llm_url, json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "") or data.get("response", "")
    except Exception as e:
        return {"marks": None, "feedback": f"LLM error: {e}", "extracted_text": ""}

    # Parse marks from reply
    marks = None
    import re
    m = re.search(r"TOTAL\s+MARKS:\s*(\d+(?:\.\d+)?)\s*/\s*\d+", reply, re.IGNORECASE)
    if m:
        try:
            marks = float(m.group(1))
            marks = min(marks, session.total_marks)
        except Exception:
            pass

    # Extract text portion
    extracted = ""
    ea_match = re.search(r"EXTRACTED ANSWERS:(.*?)(?:EVALUATION:|TOTAL MARKS:)", reply, re.IGNORECASE | re.DOTALL)
    if ea_match:
        extracted = ea_match.group(1).strip()

    return {"marks": marks, "feedback": reply, "extracted_text": extracted}


# ── Plagiarism Detection ─────────────────────────────────

def _similarity(a: str, b: str) -> float:
    """SequenceMatcher-based text similarity (0.0–1.0)."""
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _find_matching_blocks(a: str, b: str, min_length: int = 30) -> list[str]:
    """Return list of common substrings >= min_length chars."""
    matcher = difflib.SequenceMatcher(None, a, b)
    matches = []
    for block in matcher.get_matching_blocks():
        if block.size >= min_length:
            snippet = a[block.a: block.a + block.size].strip()
            if snippet:
                matches.append(snippet[:200])
    return matches[:10]


async def run_plagiarism_check(db: AsyncSession, session_id: str) -> list[CopyCheckPlagiarism]:
    """Compare all evaluated sheets pairwise. Return CopyCheckPlagiarism rows."""
    sheets = await get_sheets(db, session_id)
    done_sheets = [s for s in sheets if s.status == "done" and s.extracted_text]

    # Remove old plagiarism results for this session
    existing = (await db.execute(
        select(CopyCheckPlagiarism).where(CopyCheckPlagiarism.session_id == session_id)
    )).scalars().all()
    for row in existing:
        await db.delete(row)
    await db.flush()

    results = []
    for i in range(len(done_sheets)):
        for j in range(i + 1, len(done_sheets)):
            a = done_sheets[i]
            b = done_sheets[j]
            score = _similarity(a.extracted_text or "", b.extracted_text or "")
            blocks = _find_matching_blocks(a.extracted_text or "", b.extracted_text or "")
            if score >= 0.9:
                verdict = "confirmed"
            elif score >= 0.7:
                verdict = "suspected"
            else:
                verdict = "unlikely"

            row = CopyCheckPlagiarism(
                session_id=session_id,
                roll_a=a.student_roll,
                roll_b=b.student_roll,
                similarity_score=round(score, 3),
                matched_sections=json.dumps(blocks) if blocks else None,
                verdict=verdict,
            )
            db.add(row)
            results.append(row)

    # Mark session plagiarism_run = done
    sess = await get_session(db, session_id)
    if sess:
        sess.plagiarism_run = "1"
        sess.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return results


async def get_plagiarism_results(db: AsyncSession, session_id: str) -> list[CopyCheckPlagiarism]:
    rows = (await db.execute(
        select(CopyCheckPlagiarism)
        .where(CopyCheckPlagiarism.session_id == session_id)
        .order_by(CopyCheckPlagiarism.similarity_score.desc())
    )).scalars().all()
    return list(rows)


# ── PDF Report Generation ────────────────────────────────

def generate_pdf_report(session: CopyCheckSession, sheets: list[CopyCheckSheet],
                        plagiarism: list[CopyCheckPlagiarism]) -> bytes:
    """Generate a PDF report using fpdf2. Falls back to HTML bytes if fpdf2 not available."""
    try:
        from fpdf import FPDF

        class PDF(FPDF):
            def header(self):
                self.set_font("Helvetica", "B", 14)
                self.cell(0, 10, "MAC — Copy Check Report", align="C", new_x="LMARGIN", new_y="NEXT")
                self.set_font("Helvetica", "", 9)
                self.cell(0, 6, f"Subject: {session.subject} | Dept: {session.department} | "
                                f"Class: {session.class_name} | Total Marks: {session.total_marks}",
                          align="C", new_x="LMARGIN", new_y="NEXT")
                self.cell(0, 5, f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                          align="C", new_x="LMARGIN", new_y="NEXT")
                self.ln(3)
                self.set_line_width(0.4)
                self.line(10, self.get_y(), 200, self.get_y())
                self.ln(4)

            def footer(self):
                self.set_y(-12)
                self.set_font("Helvetica", "I", 8)
                self.cell(0, 8, f"Page {self.page_no()} — MAC Platform, MBM Engineering College", align="C")

        pdf = PDF(orientation="P", unit="mm", format="A4")
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.add_page()

        # ── Summary Table ──
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 8, "Student Marks Summary", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        col_w = [30, 70, 20, 70]
        headers = ["Roll No", "Name", f"Marks/{session.total_marks}", "Status"]
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(230, 230, 230)
        for w, h in zip(col_w, headers):
            pdf.cell(w, 7, h, border=1, fill=True)
        pdf.ln()

        pdf.set_font("Helvetica", "", 9)
        for s in sorted(sheets, key=lambda x: x.student_roll):
            marks_str = f"{s.ai_marks:.1f}" if s.ai_marks is not None else "—"
            pdf.cell(col_w[0], 7, s.student_roll[:18], border=1)
            pdf.cell(col_w[1], 7, s.student_name[:38], border=1)
            pdf.cell(col_w[2], 7, marks_str, border=1, align="C")
            pdf.cell(col_w[3], 7, s.status[:18], border=1)
            pdf.ln()

        # ── Plagiarism Section ──
        flagged = [p for p in plagiarism if p.verdict in ("confirmed", "suspected")]
        if flagged:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(0, 8, "⚠ Plagiarism / Similarity Report", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)

            pdf.set_font("Helvetica", "B", 9)
            pdf.set_fill_color(230, 230, 230)
            for w, h in zip([30, 30, 25, 25, 80], ["Roll A", "Roll B", "Similarity", "Verdict", "Matched Snippet"]):
                pdf.cell(w, 7, h, border=1, fill=True)
            pdf.ln()

            pdf.set_font("Helvetica", "", 8)
            for p in flagged:
                blocks = json.loads(p.matched_sections) if p.matched_sections else []
                snippet = blocks[0][:50] if blocks else ""
                pdf.cell(30, 7, p.roll_a[:18], border=1)
                pdf.cell(30, 7, p.roll_b[:18], border=1)
                pdf.cell(25, 7, f"{p.similarity_score * 100:.1f}%", border=1, align="C")
                pdf.cell(25, 7, p.verdict.upper(), border=1, align="C")
                pdf.cell(80, 7, snippet, border=1)
                pdf.ln()

        # ── Per-Student Detailed Feedback ──
        for s in sorted(sheets, key=lambda x: x.student_roll):
            if not s.ai_feedback:
                continue
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 11)
            pdf.cell(0, 8, f"Student: {s.student_name} ({s.student_roll})", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", "", 9)
            marks_str = f"{s.ai_marks:.1f}/{session.total_marks}" if s.ai_marks is not None else "Not evaluated"
            pdf.cell(0, 7, f"Marks: {marks_str} | Dept: {s.department}", new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
            # Wrap feedback text
            clean_feedback = (s.ai_feedback or "").replace("\r", "").strip()
            pdf.set_font("Helvetica", "", 8)
            for line in clean_feedback.split("\n"):
                wrapped = textwrap.wrap(line, width=110)
                if not wrapped:
                    pdf.ln(4)
                for wl in wrapped:
                    pdf.cell(0, 5, wl.encode("latin-1", "replace").decode("latin-1"), new_x="LMARGIN", new_y="NEXT")

        return bytes(pdf.output())

    except ImportError:
        # Fallback: return styled HTML as bytes
        return _generate_html_report(session, sheets, plagiarism)


def _generate_html_report(session: CopyCheckSession, sheets: list[CopyCheckSheet],
                          plagiarism: list[CopyCheckPlagiarism]) -> bytes:
    """HTML fallback report (can be printed to PDF from browser)."""
    flagged = [p for p in plagiarism if p.verdict in ("confirmed", "suspected")]
    rows = ""
    for s in sorted(sheets, key=lambda x: x.student_roll):
        marks = f"{s.ai_marks:.1f}" if s.ai_marks is not None else "—"
        rows += f"<tr><td>{s.student_roll}</td><td>{s.student_name}</td><td>{marks}/{session.total_marks}</td><td>{s.status}</td></tr>"

    plg = ""
    for p in flagged:
        blocks = json.loads(p.matched_sections) if p.matched_sections else []
        snippet = blocks[0][:60] if blocks else ""
        plg += f"<tr><td>{p.roll_a}</td><td>{p.roll_b}</td><td>{p.similarity_score*100:.1f}%</td><td>{p.verdict.upper()}</td><td>{snippet}</td></tr>"

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<title>MAC Copy Check Report — {session.subject}</title>
<style>body{{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:20px}}
h1{{color:#333;border-bottom:2px solid #333}}
h2{{color:#555;margin-top:30px}}
table{{width:100%;border-collapse:collapse;margin:10px 0}}
th{{background:#f0f0f0;padding:8px;text-align:left;border:1px solid #ccc}}
td{{padding:7px;border:1px solid #ddd}}
.warn{{background:#fff3cd}}.bad{{background:#f8d7da}}
@media print{{@page{{size:A4;margin:15mm}}}}
</style></head><body>
<h1>MAC Copy Check Report</h1>
<p><strong>Subject:</strong> {session.subject} &nbsp; <strong>Department:</strong> {session.department}
&nbsp; <strong>Class:</strong> {session.class_name} &nbsp; <strong>Total Marks:</strong> {session.total_marks}</p>
<p><em>Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}</em></p>
<h2>Student Marks Summary</h2>
<table><thead><tr><th>Roll No</th><th>Name</th><th>Marks</th><th>Status</th></tr></thead><tbody>{rows}</tbody></table>
{"<h2>⚠ Plagiarism Report</h2><table><thead><tr><th>Roll A</th><th>Roll B</th><th>Similarity</th><th>Verdict</th><th>Matched Snippet</th></tr></thead><tbody>" + plg + "</tbody></table>" if flagged else ""}
</body></html>"""
    return html.encode()
