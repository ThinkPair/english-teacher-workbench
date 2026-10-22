import base64
import ctypes
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

ROOT = Path(os.environ.get("TEACHER_DATA_DIR", Path(__file__).parent / "data")).resolve()
LOCK = threading.RLock()


def _windows_secret(value, *, decrypt=False):
    """Windows DPAPI: only the current OS user can decrypt the saved key."""
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(value)
    source = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    fn = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not fn(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise RuntimeError("本机密钥保护失败，请重新填写 API 密钥")
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel32.LocalFree(target.data)


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def check_workspace(value):
    if value not in ("demo", "personal"):
        raise HTTPException(400, "工作区只能是 demo 或 personal")
    return value


def directory(workspace):
    p = ROOT / check_workspace(workspace)
    p.mkdir(parents=True, exist_ok=True)
    (p / "attachments").mkdir(exist_ok=True)
    return p


def connect(workspace):
    db = sqlite3.connect(directory(workspace) / "workspace.sqlite3", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
      CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS exams_student ON exams(student_id);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS plans_student ON plans(student_id);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library_files(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS library_files_document ON library_files(document_id);
      CREATE TABLE IF NOT EXISTS document_pages(document_id TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL, file_id TEXT NOT NULL REFERENCES library_files(id), file_page INTEGER NOT NULL, text TEXT NOT NULL, text_truncated INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(document_id,page));
      CREATE TABLE IF NOT EXISTS bank_questions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bank_document ON bank_questions(document_id);
      CREATE TABLE IF NOT EXISTS practice_sets(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS practice_student ON practice_sets(student_id);
    """)
    db.commit()
    return db


@contextmanager
def transaction(workspace):
    db = connect(workspace)
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def get(db, table, record_id):
    row = db.execute(f"SELECT payload FROM {table} WHERE id=?", (record_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "未找到记录，可能位于其他工作区")
    return json.loads(row["payload"])


def records(db, table, field=None, value=None):
    query = f"SELECT payload FROM {table}"
    args = ()
    if field:
        query += f" WHERE {field}=?"
        args = (value,)
    return [json.loads(row["payload"]) for row in db.execute(query, args).fetchall()]


def put(db, table, record):
    fields = ["id", "payload"]
    args = [record["id"], json.dumps(record, ensure_ascii=False, allow_nan=False)]
    if table in ("exams", "plans", "practice_sets"):
        fields.append("student_id")
        args.append(record["student_id"])
    if table == "attachments":
        fields.append("exam_id")
        args.append(record["exam_id"])
    if table in ("library_files", "bank_questions"):
        fields.append("document_id")
        args.append(record["document_id"])
    placeholders = ",".join("?" for _ in fields)
    updates = ",".join(f"{f}=excluded.{f}" for f in fields if f != "id")
    db.execute(f"INSERT INTO {table} ({','.join(fields)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {updates}", args)


def mark_plans_stale(db, exam):
    for plan in records(db, "plans", "student_id", exam["student_id"]):
        sources = plan.get("_source_revisions", {})
        if plan.get("exam_id") == exam["id"] or exam["id"] in sources or plan.get("exam_id") is None:
            plan["stale"] = True
            put(db, "plans", plan)


def safe_record(record):
    return {k: v for k, v in record.items() if not k.startswith("_")}


def read_settings(workspace):
    ROOT.mkdir(parents=True, exist_ok=True)
    path = ROOT / "settings.json"
    defaults = {"base_url": "https://api.deepseek.com", "model": "deepseek-flash", "vision_model": "deepseek-flash", "api_key": "", "timeout_seconds": 90}
    if path.exists():
        saved = json.loads(path.read_text(encoding="utf-8"))
        encrypted = saved.pop("api_key_protected", None)
        if encrypted:
            try:
                saved["api_key"] = _windows_secret(base64.b64decode(encrypted), decrypt=True).decode("utf-8") if os.name == "nt" else ""
            except Exception:
                # A copied settings file is not usable under another Windows user.
                saved["api_key"] = ""
        defaults.update(saved)
    return defaults


def write_settings(workspace, settings):
    with LOCK:
        ROOT.mkdir(parents=True, exist_ok=True)
        dest = ROOT / "settings.json"
        temp = dest.with_suffix(".tmp")
        saved = dict(settings)
        if os.name == "nt":
            key = saved.pop("api_key", "")
            if key:
                saved["api_key_protected"] = base64.b64encode(_windows_secret(key.encode("utf-8"))).decode("ascii")
        temp.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
        try:
            temp.chmod(0o600)
        except OSError:
            pass
        temp.replace(dest)


def safe_settings(settings):
    return {"base_url": settings["base_url"], "model": settings["model"], "vision_model": settings["vision_model"], "has_api_key": bool(settings.get("api_key")), "timeout_seconds": settings["timeout_seconds"]}
