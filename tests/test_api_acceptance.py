"""Black-box acceptance checks against the agreed teacher workflow.

No request here uses real student data or an external model service.
"""

from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
import time
import threading
from uuid import uuid4
import zipfile

import pytest

from conftest import PNG


PERSONAL = {"X-Workspace": "personal"}
DEMO = {"X-Workspace": "demo"}
SECRET = "sk-qa-fictional-secret-do-not-expose-938410"


def ok(response, expected=(200, 201, 202)):
    assert response.status_code in expected, (response.status_code, response.text)
    return response.json()


def student(client, name="QA虚构学生甲", headers=PERSONAL):
    return ok(client.post("/api/students", headers=headers, json={
        "name": name, "grade": "七年级", "school": "QA虚构学校", "notes": "仅为自动验收创建", "target_score": 90,
    }))


def exam(client, sid, *, score=72, kind="school", title="QA虚构月考", headers=PERSONAL):
    return ok(client.post(f"/api/students/{sid}/exams", headers=headers, json={
        "title": title, "exam_date": "2026-10-04", "kind": kind, "full_score": 100,
        "school_score": score, "notes": "仅有部分题目，学校总分可与题目合计不同",
    }))


def question(*, reviewed=True, school_score=2, ai_score=9, max_score=10):
    return {
        "id": str(uuid4()), "number": "1", "stem": "QA sample: I ___ a student.",
        "student_answer": "is", "correct_answer": "am", "school_score": school_score,
        "max_score": max_score, "ai_score": ai_score, "knowledge_tag": "be动词",
        "error_reason": "待老师核实：主谓一致", "teacher_note": "老师已核实原题",
        "needs_review": not reviewed, "reviewed": reviewed, "source_page": 1,
        "source_attachment_id": None,
    }


def edit_exam(client, row, *, questions=None, headers=PERSONAL, **changes):
    fields = ("revision", "title", "exam_date", "kind", "full_score", "school_score", "notes", "questions")
    body = {key: row[key] for key in fields}
    if questions is not None:
        body["questions"] = questions
    body.update(changes)
    return client.put(f"/api/exams/{row['id']}", headers=headers, json=body)


def confirmed_exam(client, sid, **kwargs):
    row = exam(client, sid, **kwargs)
    row = ok(edit_exam(client, row, questions=[question()]))
    return ok(client.post(f"/api/exams/{row['id']}/confirm", headers=PERSONAL, json={"revision": row["revision"]}))


def upload(client, eid, *, headers=PERSONAL):
    return ok(client.post(f"/api/exams/{eid}/attachments", headers=headers, files=[("files", ("qa-fixture.png", PNG, "image/png"))]))


def configure(client, stub, *, headers=PERSONAL, key=SECRET):
    return ok(client.put("/api/settings", headers=headers, json={
        "base_url": stub.base_url, "model": "local-text-stub", "vision_model": "local-vision-stub", "api_key": key,
    }))


def finished_job(client, started, *, headers=PERSONAL):
    if started["status"] in ("failed", "succeeded"):
        return started
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        row = ok(client.get(f"/api/jobs/{started['id']}", headers=headers))
        if row["status"] in ("failed", "succeeded"):
            return row
        time.sleep(0.03)
    pytest.fail("Local test job did not finish within eight seconds")


def test_personal_is_empty_and_demo_seed_never_leaks(client):
    initial = ok(client.get("/api/bootstrap", headers=PERSONAL))
    assert initial["workspace"] == "personal"
    assert initial["students"] == []
    assert initial["stats"]["confirmed_exams"] == 0
    demo = ok(client.get("/api/bootstrap", headers=DEMO))
    assert demo["workspace"] == "demo"
    assert demo["students"], "Demo must contain explicitly fictional examples"
    assert ok(client.get("/api/students", headers=PERSONAL)) == []
    sid = demo["students"][0]["id"]
    assert client.get(f"/api/students/{sid}", headers=PERSONAL).status_code == 404


def test_workspace_data_isolated_while_teacher_model_config_is_shared(client, model_stub):
    first = student(client)
    paper = upload(client, exam(client, first["id"])["id"])
    plan = ok(client.post(f"/api/students/{first['id']}/plans/manual", headers=PERSONAL, json={"title": "QA计划", "content": "仅当前学生"}))
    configure(client, model_stub)
    for route in (f"/students/{first['id']}", f"/exams/{paper['id']}"):
        assert client.get("/api" + route, headers=DEMO).status_code == 404
    assert client.patch(f"/api/plans/{plan['id']}", headers=DEMO, json={"content": "不应写入"}).status_code == 404
    attachment = paper["attachments"][0]
    assert "workspace=personal" in attachment["url"]
    assert all("workspace=personal" in url for url in attachment["page_urls"])
    assert client.get(f"/api/files/{attachment['id']}?workspace=demo").status_code == 404
    assert client.get(f"/api/files/{attachment['id']}?workspace=personal").status_code == 200
    demo_settings = ok(client.get("/api/settings", headers=DEMO))
    assert demo_settings["has_api_key"] is True
    assert demo_settings["base_url"] == model_stub.base_url
    assert demo_settings["model"] == "local-text-stub"
    assert SECRET not in json.dumps(demo_settings)


def test_student_history_and_cross_student_plan_source_are_separate(client):
    a, b = student(client, "QA虚构甲"), student(client, "QA虚构乙")
    paper = confirmed_exam(client, a["id"], score=72)
    detail_a = ok(client.get(f"/api/students/{a['id']}", headers=PERSONAL))
    detail_b = ok(client.get(f"/api/students/{b['id']}", headers=PERSONAL))
    assert len(detail_a["exams"]) == 1
    assert detail_b["exams"] == []
    assert detail_b["plans"] == []
    assert detail_b["weak_points"] == []
    denied = client.post(f"/api/students/{b['id']}/plans/manual", headers=PERSONAL, json={"exam_id": paper["id"], "title": "越界计划", "content": "应拒绝"})
    assert denied.status_code in (400, 403, 404, 422)
    assert ok(client.get(f"/api/students/{b['id']}", headers=PERSONAL))["plans"] == []


def test_unconfirmed_rows_do_not_enter_confirmed_history(client):
    s = student(client)
    row = exam(client, s["id"], score=88)
    row = ok(edit_exam(client, row, questions=[question(reviewed=False)]))
    summary = ok(client.get("/api/students", headers=PERSONAL))[0]
    assert summary["latest_score"] is None
    assert summary["weak_tags"] == []
    detail = ok(client.get(f"/api/students/{s['id']}", headers=PERSONAL))
    assert detail["weak_points"] == []
    assert ok(client.get("/api/bootstrap", headers=PERSONAL))["stats"]["confirmed_exams"] == 0


@pytest.mark.parametrize("kind", ["school", "practice"])
def test_confirmation_requires_questions_review_and_teacher_score(client, kind):
    s = student(client)
    row = exam(client, s["id"], score=None, kind=kind)
    def attempt(current):
        return client.post(f"/api/exams/{current['id']}/confirm", headers=PERSONAL, json={"revision": current["revision"]})
    assert attempt(row).status_code in (400, 409, 422)
    row = ok(edit_exam(client, row, questions=[question(reviewed=True)]))
    assert attempt(row).status_code in (400, 409, 422), "AI score cannot replace teacher-confirmed total"
    row = ok(edit_exam(client, row, school_score=72, questions=[question(reviewed=False)]))
    assert attempt(row).status_code in (400, 409, 422)
    row = ok(edit_exam(client, row, questions=[question(reviewed=True)]))
    result = ok(attempt(row))
    assert result["status"] == "confirmed"
    assert result["school_score"] == 72
    assert result["questions"][0]["school_score"] == 2
    assert result["questions"][0]["ai_score"] == 9
    latest = ok(client.get("/api/students", headers=PERSONAL))[0]
    assert latest["latest_score"] == (72 if kind == "school" else None), (
        "Only a school exam updates school-score history; practice retains its own teacher score"
    )


def test_revision_conflicts_and_invalid_scores_do_not_partially_save(client):
    s = student(client)
    original = exam(client, s["id"])
    changed = ok(edit_exam(client, original, title="已保存的新标题", questions=[question()]))
    rejected = edit_exam(client, original, title="旧页面覆盖尝试")
    assert rejected.status_code == 409
    assert client.post(f"/api/exams/{changed['id']}/confirm", headers=PERSONAL, json={"revision": original["revision"]}).status_code == 409
    invalid = edit_exam(client, changed, title="不应部分保存", questions=[question(school_score=11, max_score=10)])
    assert invalid.status_code in (400, 422)
    current = ok(client.get(f"/api/exams/{changed['id']}", headers=PERSONAL))
    assert current["revision"] == changed["revision"]
    assert current["title"] == "已保存的新标题"
    assert current["questions"][0]["school_score"] == 2


@pytest.mark.parametrize("mutation", ["edit", "attachment"])
def test_confirmed_change_reopens_review_and_stales_existing_plan(client, mutation):
    s = student(client)
    row = confirmed_exam(client, s["id"])
    plan = ok(client.post(f"/api/students/{s['id']}/plans/manual", headers=PERSONAL, json={
        "exam_id": row["id"], "title": "以已确认试卷为依据", "content": "先复习第1题",
    }))
    assert plan["stale"] is False
    changed = ok(edit_exam(client, row, school_score=75)) if mutation == "edit" else upload(client, row["id"])
    assert changed["status"] == "review"
    assert changed["revision"] > row["revision"]
    detail = ok(client.get(f"/api/students/{s['id']}", headers=PERSONAL))
    linked = next(item for item in detail["plans"] if item["id"] == plan["id"])
    assert linked["stale"] is True
    assert ok(client.get("/api/students", headers=PERSONAL))[0]["latest_score"] is None


def test_invalid_upload_is_rejected_without_exam_mutation(client):
    s = student(client)
    row = exam(client, s["id"])
    response = client.post(f"/api/exams/{row['id']}/attachments", headers=PERSONAL, files=[("files", ("pretend.png", b"<html>not an image</html>", "image/png"))])
    assert response.status_code in (400, 413, 415, 422)
    current = ok(client.get(f"/api/exams/{row['id']}", headers=PERSONAL))
    assert current["attachments"] == []
    assert current["revision"] == row["revision"]


def test_unconfigured_ai_cannot_generate_pretend_results(client):
    s = student(client)
    row = upload(client, exam(client, s["id"])["id"])
    response = client.post(f"/api/exams/{row['id']}/recognize", headers=PERSONAL, json={})
    assert response.status_code in (400, 409, 422)
    current = ok(client.get(f"/api/exams/{row['id']}", headers=PERSONAL))
    assert current["questions"] == []
    assert current["status"] != "confirmed"
    response = client.post(f"/api/students/{s['id']}/plans", headers=PERSONAL, json={"exam_id": row["id"]})
    assert response.status_code in (400, 409, 422)
    assert ok(client.get(f"/api/students/{s['id']}", headers=PERSONAL))["plans"] == []


def test_settings_never_return_key_and_empty_input_preserves_it(client, model_stub):
    configured = configure(client, model_stub)
    assert configured["has_api_key"] is True
    assert "api_key" not in configured
    assert SECRET not in json.dumps(configured)
    for route in ("/api/settings", "/api/bootstrap"):
        assert SECRET not in client.get(route, headers=PERSONAL).text
    kept = configure(client, model_stub, key="")
    assert kept["has_api_key"] is True
    cleared = ok(client.put("/api/settings", headers=PERSONAL, json={
        "base_url": model_stub.base_url, "model": "local-text-stub", "vision_model": "local-vision-stub", "clear_api_key": True,
    }))
    assert cleared["has_api_key"] is False


@pytest.mark.parametrize("mode", ["malformed_json", "provider_error"])
def test_failed_recognition_preserves_teacher_data_and_redacts_key(client, model_stub, mode):
    s = student(client)
    row = upload(client, exam(client, s["id"], score=61)["id"])
    row = ok(edit_exam(client, row, questions=[question(reviewed=False, school_score=2)]))
    configure(client, model_stub)
    if mode == "malformed_json":
        model_stub.answer("This is not structured question JSON.")
    else:
        model_stub.fail(f"Provider rejected credential {SECRET}")
    started = ok(client.post(f"/api/exams/{row['id']}/recognize", headers=PERSONAL, json={}))
    result = finished_job(client, started)
    assert result["status"] == "failed"
    assert SECRET not in json.dumps(result)
    current = ok(client.get(f"/api/exams/{row['id']}", headers=PERSONAL))
    assert current["school_score"] == 61
    assert current["questions"] == row["questions"]
    assert current["revision"] == row["revision"]
    assert ok(client.get("/api/bootstrap", headers=PERSONAL))["stats"]["confirmed_exams"] == 0
    assert len(model_stub.requests) == 1


def test_successful_stub_recognition_remains_unconfirmed_and_preserves_school_total(client, model_stub):
    s = student(client)
    row = upload(client, exam(client, s["id"], score=64)["id"])
    configure(client, model_stub)
    suggestion = question(reviewed=True, school_score=10, ai_score=10)
    suggestion["source_attachment_id"] = row["attachments"][0]["id"]
    model_stub.answer({"title": "AI试图改标题", "school_score": 100, "questions": [suggestion]})
    job = finished_job(client, ok(client.post(f"/api/exams/{row['id']}/recognize", headers=PERSONAL, json={})))
    assert job["status"] == "succeeded", job
    current = ok(client.get(f"/api/exams/{row['id']}", headers=PERSONAL))
    assert current["status"] == "review"
    assert current["school_score"] == 64
    assert current["title"] == row["title"]
    assert current["questions"] and all(item["reviewed"] is False for item in current["questions"])
    assert ok(client.get("/api/students", headers=PERSONAL))[0]["latest_score"] is None
    assert client.get(f"/api/jobs/{job['id']}", headers=DEMO).status_code == 404
    assert len(model_stub.requests) == 1
    assert model_stub.requests[0]["path"] == "/v1/chat/completions"
    assert model_stub.requests[0]["body"]["model"] == "local-vision-stub"


def test_provider_connection_test_is_real_local_http_and_redacts_error(client, model_stub):
    configure(client, model_stub)
    model_stub.answer("连接测试成功")
    result = ok(client.post("/api/settings/test", headers=PERSONAL, json={}))
    assert result["ok"] is True
    assert len(model_stub.requests) == 1
    model_stub.fail(f"Bad credential: {SECRET}")
    result = ok(client.post("/api/settings/test", headers=PERSONAL, json={}))
    assert result["ok"] is False
    assert SECRET not in json.dumps(result)


def test_backup_contains_consistent_data_and_original_but_no_key(client, model_stub, tmp_path):
    s = student(client, "QA备份虚构学生")
    row = upload(client, exam(client, s["id"])["id"])
    configure(client, model_stub)
    other_workspace = student(client, "QA备份不应包含示例工作区学生", headers=DEMO)
    response = client.get("/api/backup", headers=PERSONAL)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as bundle:
        members = bundle.namelist()
        assert members
        assert not any("settings" in name.lower() or "secret" in name.lower() for name in members)
        blobs = {name: bundle.read(name) for name in members if not name.endswith("/")}
        assert all(SECRET.encode() not in body for body in blobs.values())
        assert PNG in blobs.values(), "Original image should survive export unchanged"
        databases = [(name, body) for name, body in blobs.items() if body.startswith(b"SQLite format 3")]
        assert len(databases) == 1
        db_path = tmp_path / "backup-verification.sqlite"
        db_path.write_bytes(databases[0][1])
        with sqlite3.connect(db_path) as connection:
            assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            dump = "\n".join(connection.iterdump())
        assert s["id"] in dump
        assert row["id"] in dump
        assert other_workspace["id"] not in dump
        assert SECRET not in dump


def test_late_recognition_cannot_overwrite_a_new_teacher_revision(client, model_stub):
    s = student(client)
    row = upload(client, exam(client, s["id"])["id"])
    configure(client, model_stub)
    entered, release = threading.Event(), threading.Event()
    draft = question(reviewed=False)
    draft["source_attachment_id"] = row["attachments"][0]["id"]
    model_stub.answer({"questions": [draft]}, gate=(entered, release))
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(client.post, f"/api/exams/{row['id']}/recognize", headers=PERSONAL, json={})
        try:
            assert entered.wait(timeout=4), "Backend did not call the local vision stub"
            edited = ok(edit_exam(client, row, school_score=83, title="老师在等待时更正"))
        finally:
            release.set()
        job = finished_job(client, ok(pending.result(timeout=8)))
    assert job["status"] == "failed", "A response based on an older revision must be discarded"
    current = ok(client.get(f"/api/exams/{row['id']}", headers=PERSONAL))
    assert current["revision"] == edited["revision"]
    assert current["school_score"] == 83
    assert current["title"] == "老师在等待时更正"
    assert current["questions"] == []


def test_ai_plan_uses_only_confirmed_current_student_records(client, model_stub):
    a, b = student(client, "QA当前学生"), student(client, "QA其他学生")
    current = confirmed_exam(client, a["id"], title="QA_ONLY_A_CONFIRMED")
    exam(client, a["id"], title="QA_EXCLUDE_A_DRAFT")
    confirmed_exam(client, b["id"], title="QA_EXCLUDE_B_CONFIRMED")
    configure(client, model_stub)
    model_stub.answer({"title": "本地模拟教案", "content": "依据 QA_ONLY_A_CONFIRMED 第1题，0–5分钟复测be动词；这是接口模拟，不代表模型质量。"})
    job = finished_job(client, ok(client.post(f"/api/students/{a['id']}/plans", headers=PERSONAL, json={})))
    assert job["status"] == "succeeded", job
    assert len(model_stub.requests) == 1
    transmitted = json.dumps(model_stub.requests[0]["body"], ensure_ascii=False)
    assert "QA_ONLY_A_CONFIRMED" in transmitted
    assert "QA_EXCLUDE_A_DRAFT" not in transmitted
    assert "QA_EXCLUDE_B_CONFIRMED" not in transmitted
    plans = ok(client.get(f"/api/students/{a['id']}", headers=PERSONAL))["plans"]
    assert len(plans) == 1 and plans[0]["source"] == "ai" and plans[0]["stale"] is False
    assert ok(client.get(f"/api/students/{b['id']}", headers=PERSONAL))["plans"] == []
    edited = ok(edit_exam(client, current, school_score=73))
    assert edited["status"] == "review"
    assert ok(client.get(f"/api/students/{a['id']}", headers=PERSONAL))["plans"][0]["stale"] is True


def test_invalid_ai_plan_does_not_create_any_plan(client, model_stub):
    s = student(client)
    current = confirmed_exam(client, s["id"])
    configure(client, model_stub)
    model_stub.answer({"title": "缺少正文不能造假"})
    job = finished_job(client, ok(client.post(f"/api/students/{s['id']}/plans", headers=PERSONAL, json={"exam_id": current["id"]})))
    assert job["status"] == "failed"
    assert ok(client.get(f"/api/students/{s['id']}", headers=PERSONAL))["plans"] == []


def test_question_cannot_reference_another_students_original_file(client):
    a, b = student(client, "QA原图甲"), student(client, "QA原图乙")
    a_exam = upload(client, exam(client, a["id"])["id"])
    b_exam = exam(client, b["id"])
    wrong_source = question()
    wrong_source["source_attachment_id"] = a_exam["attachments"][0]["id"]
    response = edit_exam(client, b_exam, questions=[wrong_source])
    assert response.status_code in (400, 403, 404, 422)
    current = ok(client.get(f"/api/exams/{b_exam['id']}", headers=PERSONAL))
    assert current["questions"] == [] and current["revision"] == b_exam["revision"]


def test_rerecognition_preserves_entered_school_question_score_and_teacher_note(client, model_stub):
    s = student(client)
    paper = upload(client, exam(client, s["id"], score=67)["id"])
    prior = question(reviewed=False, school_score=3, max_score=10, ai_score=None)
    prior["teacher_note"] = "QA老师手工核实的批改意见"
    prior["source_attachment_id"] = paper["attachments"][0]["id"]
    paper = ok(edit_exam(client, paper, questions=[prior]))
    configure(client, model_stub)
    rewritten = question(reviewed=True, school_score=20, max_score=20, ai_score=20)
    rewritten["source_attachment_id"] = paper["attachments"][0]["id"]
    model_stub.answer({"school_score": 100, "questions": [rewritten]})
    job = finished_job(client, ok(client.post(f"/api/exams/{paper['id']}/recognize", headers=PERSONAL, json={})))
    assert job["status"] == "succeeded", job
    current = ok(client.get(f"/api/exams/{paper['id']}", headers=PERSONAL))
    q = current["questions"][0]
    assert current["school_score"] == 67
    assert q["id"] == prior["id"]
    assert q["school_score"] == 3 and q["max_score"] == 10
    assert q["teacher_note"] == prior["teacher_note"]
    assert q["reviewed"] is False
    assert q["ai_score"] is None or q["ai_score"] <= q["max_score"]


def test_over_limit_pdf_is_not_silently_partially_sent_to_model(client, model_stub):
    import fitz
    s = student(client)
    paper = exam(client, s["id"])
    with fitz.open() as pdf:
        for number in range(9):
            page = pdf.new_page(width=120, height=120)
            page.insert_text((10, 30), f"QA fictional page {number + 1}", fontsize=7)
        content = pdf.tobytes()
    configure(client, model_stub)
    uploaded = ok(client.post(f"/api/exams/{paper['id']}/attachments", headers=PERSONAL, files=[("files", ("qa-nine-pages.pdf", content, "application/pdf"))]))
    assert len(uploaded["attachments"][0]["page_urls"]) == 9
    assert not model_stub.requests, "Uploading alone must never send student material to a model"
    response = client.post(f"/api/exams/{paper['id']}/recognize", headers=PERSONAL, json={})
    assert response.status_code in (400, 413, 422)
    assert "8" in response.json()["detail"]
    assert not model_stub.requests, "Oversize jobs must be refused before any page is transmitted"
    current = ok(client.get(f"/api/exams/{paper['id']}", headers=PERSONAL))
    assert current["questions"] == [] and current["revision"] == uploaded["revision"]
