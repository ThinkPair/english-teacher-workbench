"""Real process tests for v0.1 migration and v0.2 durable source snapshots."""

from __future__ import annotations

import io
import json
import sqlite3
import threading
from uuid import uuid4
import zipfile

from conftest import PNG
from test_api_acceptance import DEMO, PERSONAL, configure, ok, question, student
from test_v02_acceptance import (
    bank_question, extract_payload, material, pdf_bytes, save_set, scored_paper,
)


def write_v01_fixture(data_root, workspace="personal"):
    """Construct the shipped v0.1 schema explicitly, without v0.2 storage code."""
    folder = data_root / workspace
    folder.mkdir(parents=True)
    sid, eid, fid, pid = [str(uuid4()) for _ in range(4)]
    timestamp = "2026-10-04T00:00:00+00:00"
    pupil = {"id": sid, "name": "QA旧版虚构学生", "grade": "七年级", "school": "QA旧校",
             "notes": "此数据在v0.2迁移前已存在", "target_score": 90, "created_at": timestamp}
    item = question(reviewed=True, school_score=0, ai_score=5)
    item["source_attachment_id"] = fid
    paper = {"id": eid, "student_id": sid, "title": "QA旧版已确认学校卷", "exam_date": "2026-10-03",
             "kind": "school", "full_score": 100, "school_score": 76, "notes": "旧版记录应原样保留",
             "status": "confirmed", "revision": 3, "created_at": timestamp, "questions": [item]}
    attachment = {"id": fid, "exam_id": eid, "filename": "v01-original.png", "mime": "image/png",
                  "size": len(PNG), "_pages": 1, "_directory": fid}
    plan = {"id": pid, "student_id": sid, "exam_id": eid, "title": "QA旧版教案", "content": "旧版教案正文",
            "source": "teacher", "source_revision": 3, "stale": False, "created_at": timestamp,
            "lesson_note": "QA旧版课后笔记", "review_date": "2026-10-09", "review_result": "尚需复测",
            "_source_revisions": {eid: 3}}
    file_root = folder / "attachments" / fid
    file_root.mkdir(parents=True)
    (file_root / "original").write_bytes(PNG)
    with sqlite3.connect(folder / "workspace.sqlite3") as database:
        database.executescript("""
          CREATE TABLE students(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE exams(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), payload TEXT NOT NULL);
          CREATE INDEX exams_student ON exams(student_id);
          CREATE TABLE attachments(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id), payload TEXT NOT NULL);
          CREATE TABLE plans(id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id), payload TEXT NOT NULL);
          CREATE INDEX plans_student ON plans(student_id);
          CREATE TABLE jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        database.execute("INSERT INTO students VALUES(?,?)", (sid, json.dumps(pupil, ensure_ascii=False)))
        database.execute("INSERT INTO exams VALUES(?,?,?)", (eid, sid, json.dumps(paper, ensure_ascii=False)))
        database.execute("INSERT INTO attachments VALUES(?,?,?)", (fid, eid, json.dumps(attachment, ensure_ascii=False)))
        database.execute("INSERT INTO plans VALUES(?,?,?)", (pid, sid, json.dumps(plan, ensure_ascii=False)))
        if workspace == "demo":
            database.execute("INSERT INTO meta VALUES('demo_seeded','1')")
        tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {"students", "exams", "attachments", "plans", "jobs", "meta"}
    return pupil, paper, attachment, plan


def stop(process, api):
    api.close()
    process.kill()
    process.wait(timeout=5)


def test_v02_v01_database_upgrades_without_erasing_records_and_backup_is_consistent(data_root, live_server, tmp_path):
    pupil, paper, attachment, plan = write_v01_fixture(data_root)
    legacy_demo, *_ = write_v01_fixture(data_root, "demo")
    process, api = live_server()
    try:
        assert ok(api.get("/api/health"))["version"] == "0.2.0"
        detail = ok(api.get(f"/api/students/{pupil['id']}", headers=PERSONAL))
        assert detail["name"] == pupil["name"] and detail["notes"] == pupil["notes"]
        actual = ok(api.get(f"/api/exams/{paper['id']}", headers=PERSONAL))
        assert actual["questions"] == paper["questions"] and actual["status"] == "confirmed"
        assert actual["revision"] == 3 and actual["school_score"] == 76
        assert api.get(actual["attachments"][0]["url"]).content == PNG
        stored_plan = next(p for p in detail["plans"] if p["id"] == plan["id"])
        assert stored_plan["lesson_note"] == plan["lesson_note"] and stored_plan["review_result"] == plan["review_result"]
        assert ok(api.get("/api/library/documents", headers=PERSONAL)) == []
        assert ok(api.get("/api/bank/questions", headers=PERSONAL)) == []
        backup = api.get("/api/backup", headers=PERSONAL)
        assert backup.status_code == 200
        with zipfile.ZipFile(io.BytesIO(backup.content)) as archive:
            assert any(archive.read(name) == PNG for name in archive.namelist() if not name.endswith("/"))
            restored = tmp_path / "migrated-backup.sqlite3"
            restored.write_bytes(archive.read("workspace.sqlite3"))
        with sqlite3.connect(restored) as database:
            assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            assert json.loads(database.execute("SELECT payload FROM exams WHERE id=?", (paper["id"],)).fetchone()[0]) == paper
        # A pre-seeded demo database must receive only the new additive fixtures.
        demo1 = ok(api.get("/api/library/documents", headers=DEMO))
        demo2 = ok(api.get("/api/library/documents", headers=DEMO))
        assert demo1 and {d["id"] for d in demo1} == {d["id"] for d in demo2}
        assert {d["kind"] for d in demo1} == {"textbook", "past_paper"}
        assert all("虚构" in (d["title"] + d["notes"]) for d in demo1)
        demo_bank = ok(api.get("/api/bank/questions", headers=DEMO))
        assert {q["status"] for q in demo_bank} == {"draft", "confirmed"}
        assert any(s["id"] == legacy_demo["id"] for s in ok(api.get("/api/students", headers=DEMO)))
        assert len(ok(api.get("/api/students", headers=PERSONAL))) == 1
        assert ok(api.get("/api/library/documents", headers=PERSONAL)) == []
    finally:
        stop(process, api)


def test_v02_library_practice_snapshot_and_idempotent_exam_survive_real_restart(live_server):
    process, api = live_server()
    source_bytes = pdf_bytes(3, "QA-RESTART-LIBRARY")
    try:
        a = student(api)
        scored_paper(api, a["id"])
        doc = material(api, files=[("files", ("restart.pdf", source_bytes, "application/pdf"))])
        row = bank_question(api, doc)
        saved = save_set(api, a["id"], [row])
        retest = ok(api.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
    finally:
        stop(process, api)
    restarted, api = live_server()
    try:
        actual_doc = ok(api.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))
        assert actual_doc["page_count"] == 3 and actual_doc["title"] == doc["title"]
        assert api.get(actual_doc["files"][0]["url"]).content == source_bytes
        restored = ok(api.get(f"/api/practice-sets/{saved['id']}", headers=PERSONAL))
        assert restored["items"] == saved["items"] and restored["linked_exam_id"] == retest["id"]
        assert api.get(restored["items"][0]["source_url"]).status_code == 200
        assert ok(api.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))["id"] == retest["id"]
        paper = ok(api.get(f"/api/exams/{retest['id']}", headers=PERSONAL))
        assert paper["questions"] == retest["questions"] and paper["school_score"] is None
    finally:
        stop(restarted, api)


def test_v02_interrupted_extraction_fails_on_restart_without_partial_bank_rows(live_server, model_stub):
    process, api = live_server()
    entered, release = threading.Event(), threading.Event()
    try:
        configure(api, model_stub)
        doc = material(api)
        model_stub.answer(extract_payload(), gate=(entered, release))
        job = ok(api.post(f"/api/library/documents/{doc['id']}/extract", headers=PERSONAL,
                          json={"revision": doc["revision"], "pages": [1]}))
        assert entered.wait(timeout=5)
    finally:
        stop(process, api)
        release.set()
    restarted, api = live_server()
    try:
        actual = ok(api.get(f"/api/jobs/{job['id']}", headers=PERSONAL))
        assert actual["status"] == "failed"
        assert ok(api.get("/api/bank/questions", headers=PERSONAL,
                          params={"document_id": doc["id"]})) == []
        assert ok(api.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))["page_count"] == 3
    finally:
        stop(restarted, api)
