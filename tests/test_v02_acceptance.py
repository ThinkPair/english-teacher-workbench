"""v0.2 acceptance: fictional source materials, isolated disk, local HTTP AI stub.

These checks validate transport and workflow invariants, not real OCR accuracy.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import io
import json
import sqlite3
import threading
from uuid import uuid4
import zipfile

import fitz
import pytest

from conftest import PNG
from test_api_acceptance import (
    DEMO, PERSONAL, SECRET, configure, edit_exam, exam, finished_job, ok,
    question, student,
)


def pdf_bytes(pages=3, prefix="QA fictional material"):
    with fitz.open() as pdf:
        for number in range(1, pages + 1):
            page = pdf.new_page(width=240, height=240)
            page.insert_text((15, 35), f"{prefix} PAGE-{number:03}", fontsize=8)
        return pdf.tobytes()


def material(client, *, pages=3, title="QA虚构原题资料", kind="past_paper",
             grade="七年级", headers=PERSONAL, files=None):
    if files is None:
        files = [("files", ("qa-material.pdf", pdf_bytes(pages), "application/pdf"))]
    return ok(client.post("/api/library/documents", headers=headers, data={
        "title": title, "kind": kind, "grade": grade, "edition": "QA版本",
        "term": "上学期", "unit": "Unit 1", "year": "2026", "region": "QA虚构地区",
        "notes": "测试样本，不是外部真实真题",
    }, files=files))


def bank_question(client, doc, *, confirm=True, number="1", tag="三单",
                  headers=PERSONAL, **overrides):
    body = {
        "document_id": doc["id"], "source_page": 1, "source_end_page": 1,
        "number": number, "context": "QA reading: Tom is a student. He walks to school.",
        "stem": "How does Tom go to school?", "options": ["A. On foot", "B. By bus"],
        "answer": "A", "explanation": "The passage says that he walks.",
        "knowledge_tags": [tag], "difficulty": "easy", "max_score": 2,
    }
    body.update(overrides)
    row = ok(client.post("/api/bank/questions", headers=headers, json=body))
    assert row["status"] == "draft"
    if confirm:
        row = ok(client.post(f"/api/bank/questions/{row['id']}/confirm", headers=headers,
                             json={"revision": row["revision"]}))
    return row


def bank_edit(client, row, *, headers=PERSONAL, **changes):
    fields = ("revision", "source_page", "source_end_page", "number", "context", "stem",
              "options", "answer", "explanation", "knowledge_tags", "difficulty", "max_score")
    body = {key: row[key] for key in fields}
    body.update(changes)
    return client.put(f"/api/bank/questions/{row['id']}", headers=headers, json=body)


def scored_paper(client, sid, *, tag="三单", score=0, ai_score=10,
                 confirm=True, kind="school", total=72, headers=PERSONAL):
    row = exam(client, sid, score=total, kind=kind, headers=headers)
    q = question(reviewed=confirm, school_score=score, ai_score=ai_score)
    q["knowledge_tag"] = tag
    q["stem"] = f"QA evidence for {tag}"
    row = ok(edit_exam(client, row, questions=[q], headers=headers))
    if confirm:
        row = ok(client.post(f"/api/exams/{row['id']}/confirm", headers=headers,
                             json={"revision": row["revision"]}))
    return row


def recommend(client, sid, *, headers=PERSONAL, **params):
    return ok(client.get(f"/api/students/{sid}/recommendations", headers=headers, params=params))


def save_set(client, sid, questions, *, headers=PERSONAL, title="QA针对性练习"):
    return ok(client.post(f"/api/students/{sid}/practice-sets", headers=headers, json={
        "title": title, "question_ids": [q["id"] for q in questions],
    }))


def extract_payload(*, number="1", page=1, **overrides):
    row = {"source_page": page, "source_end_page": page, "number": number,
           "context": "QA shared passage. Amy reads books every day.",
           "stem": "What does Amy do?", "options": ["A. Reads books", "B. Swims"],
           "answer": "A", "explanation": "Reads books.", "knowledge_tags": ["三单"],
           "difficulty": "easy", "max_score": 2}
    row.update(overrides)
    return {"questions": [row]}


def extract(client, doc, pages, *, headers=PERSONAL):
    started = ok(client.post(f"/api/library/documents/{doc['id']}/extract", headers=headers,
                            json={"revision": doc["revision"], "pages": pages}))
    return finished_job(client, started, headers=headers)


def test_v02_large_pdf_import_is_lazy_searchable_and_complete(client, monkeypatch, model_stub):
    configure(client, model_stub)
    calls = []
    render = fitz.Page.get_pixmap

    def tracked_render(page, *args, **kwargs):
        calls.append(page.number)
        return render(page, *args, **kwargs)

    monkeypatch.setattr(fitz.Page, "get_pixmap", tracked_render)
    payload = pdf_bytes(60, "QA-LAZY-SOURCE")
    doc = material(client, files=[("files", ("qa-sixty-pages.pdf", payload, "application/pdf"))])
    assert doc["page_count"] == 60 and doc["text_page_count"] == 60
    assert calls == [], "Import must not rasterize the entire textbook"
    assert model_stub.requests == [], "Import must not send materials to a model"
    listing = ok(client.get(f"/api/library/documents/{doc['id']}/pages", headers=PERSONAL,
                            params={"page": 59, "page_size": 1}))
    assert listing["total"] == 60 and [p["page"] for p in listing["items"]] == [59]
    assert calls == []
    page = listing["items"][0]
    assert page["has_text"] and "PAGE-059" in page["text_excerpt"]
    assert "workspace=personal" in page["preview_url"]
    assert client.get(page["preview_url"]).status_code == 200
    assert calls == [58], "Only the requested PDF page should be rasterized"
    found = ok(client.get("/api/library/search", headers=PERSONAL,
                          params={"q": "PAGE-059", "document_id": doc["id"]}))
    assert found["total"] == 1 and found["items"][0]["page"] == 59
    assert client.get(doc["files"][0]["url"]).content == payload
    assert client.get(f"/api/library/documents/{doc['id']}/pages/61/image?workspace=personal").status_code in (400, 404, 422)


def test_v02_multiple_pdfs_and_photos_share_correct_global_page_numbers(client):
    first, second = pdf_bytes(2, "QA-FIRST"), pdf_bytes(3, "QA-SECOND")
    doc = material(client, files=[
        ("files", ("first.pdf", first, "application/pdf")),
        ("files", ("scan.png", PNG, "image/png")),
        ("files", ("second.pdf", second, "application/pdf")),
    ])
    assert doc["page_count"] == 6 and doc["text_page_count"] == 5
    assert [(f["page_start"], f["page_count"]) for f in doc["files"]] == [(1, 2), (3, 1), (4, 3)]
    listing = ok(client.get(f"/api/library/documents/{doc['id']}/pages", headers=PERSONAL,
                            params={"page": 1, "page_size": 20}))
    assert [p["page"] for p in listing["items"]] == list(range(1, 7))
    assert listing["items"][2]["has_text"] is False
    assert "QA-SECOND" in listing["items"][3]["text_excerpt"]
    for file, original in zip(doc["files"], [first, PNG, second]):
        assert client.get(file["url"]).content == original
    for page in listing["items"]:
        assert client.get(page["preview_url"]).status_code == 200
    found = ok(client.get("/api/library/search", headers=PERSONAL,
                          params={"q": "QA-SECOND", "document_id": doc["id"]}))
    assert {p["page"] for p in found["items"]} == {4, 5, 6}


@pytest.mark.parametrize("invalid", [b"%PDF-invalid", b"<svg xmlns='http://www.w3.org/2000/svg'/>"])
def test_v02_invalid_material_batch_is_atomic(client, data_root, invalid):
    before = ok(client.get("/api/library/documents", headers=PERSONAL))
    response = client.post("/api/library/documents", headers=PERSONAL,
                           data={"title": "QA必须整体拒绝", "kind": "past_paper"}, files=[
        ("files", ("valid.png", PNG, "image/png")),
        ("files", ("corrupt.pdf", invalid, "application/pdf")),
    ])
    assert response.status_code in (400, 413, 422)
    assert ok(client.get("/api/library/documents", headers=PERSONAL)) == before
    assert not [p for p in data_root.rglob("*") if p.is_file() and not p.name.startswith("workspace.sqlite3")]


def test_v02_library_bank_practice_and_source_urls_are_workspace_isolated(client):
    a = student(client)
    doc = material(client)
    q = bank_question(client, doc)
    saved = save_set(client, a["id"], [q])
    assert client.get(f"/api/library/documents/{doc['id']}", headers=DEMO).status_code == 404
    assert client.get(f"/api/library/documents/{doc['id']}/pages", headers=DEMO).status_code == 404
    assert client.get(f"/api/library/files/{doc['files'][0]['id']}?workspace=demo").status_code == 404
    assert client.get(f"/api/library/documents/{doc['id']}/pages/1/image?workspace=demo").status_code == 404
    assert client.put(f"/api/bank/questions/{q['id']}", headers=DEMO,
                      json={k: q[k] for k in ("revision", "source_page", "source_end_page", "number", "context", "stem", "options", "answer", "explanation", "knowledge_tags", "difficulty", "max_score")}).status_code == 404
    assert client.post(f"/api/bank/questions/{q['id']}/confirm", headers=DEMO,
                       json={"revision": q["revision"]}).status_code == 404
    assert client.get(f"/api/practice-sets/{saved['id']}", headers=DEMO).status_code == 404
    assert client.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=DEMO, json={}).status_code == 404
    assert all(d["id"] != doc["id"] for d in ok(client.get("/api/library/documents", headers=DEMO)))
    assert all(b["id"] != q["id"] for b in ok(client.get("/api/bank/questions", headers=DEMO)))
    other = student(client, "QA另一空间学生", headers=DEMO)
    denied = client.post(f"/api/students/{other['id']}/practice-sets", headers=DEMO,
                         json={"title": "禁止跨库", "question_ids": [q["id"]]})
    assert denied.status_code in (400, 404, 422)
    search = ok(client.get("/api/library/search", headers=DEMO, params={"q": "QA fictional material"}))
    assert all(item["document_id"] != doc["id"] for item in search["items"])


def test_v02_bank_confirmation_source_validation_revision_and_reopen(client):
    doc = material(client, pages=2)
    row = bank_question(client, doc, confirm=False, answer="", knowledge_tags=[])
    assert client.post(f"/api/bank/questions/{row['id']}/confirm", headers=PERSONAL,
                       json={"revision": row["revision"]}).status_code in (400, 422)
    row = ok(bank_edit(client, row, answer="A", knowledge_tags=["三单"]))
    for page, end in [(0, 1), (1, 3), (2, 1)]:
        assert bank_edit(client, row, source_page=page, source_end_page=end).status_code in (400, 422)
    foreign = material(client, title="QA不能迁移题源")
    assert bank_edit(client, row, document_id=foreign["id"]).status_code in (400, 422)
    unchanged = next(q for q in ok(client.get("/api/bank/questions", headers=PERSONAL)) if q["id"] == row["id"])
    assert unchanged["revision"] == row["revision"]
    confirmed = ok(client.post(f"/api/bank/questions/{row['id']}/confirm", headers=PERSONAL,
                               json={"revision": row["revision"]}))
    updated = ok(bank_edit(client, confirmed, stem="QA corrected stem"))
    assert updated["status"] == "draft" and updated["revision"] > confirmed["revision"]
    assert bank_edit(client, confirmed, stem="stale replacement").status_code == 409
    assert client.post(f"/api/bank/questions/{updated['id']}/confirm", headers=PERSONAL,
                       json={"revision": confirmed["revision"]}).status_code == 409
    current = ok(client.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))
    assert current["question_count"] == 1 and current["confirmed_question_count"] == 0
    changed = ok(client.patch(f"/api/library/documents/{doc['id']}", headers=PERSONAL,
                              json={"revision": current["revision"], "title": "QA metadata correction"}))
    assert changed["revision"] > current["revision"]
    assert client.patch(f"/api/library/documents/{doc['id']}", headers=PERSONAL,
                        json={"revision": current["revision"], "title": "stale"}).status_code == 409


def test_v02_recommendations_only_current_students_confirmed_school_lost_marks(client, model_stub):
    configure(client, model_stub)
    a, b = student(client, "QA目标学生"), student(client, "QA不相关学生")
    evidence = scored_paper(client, a["id"], tag="三单", score=0, ai_score=10)
    scored_paper(client, a["id"], tag="be动词", score=10, ai_score=0)
    scored_paper(client, a["id"], tag="冠词", score=None, ai_score=0)
    scored_paper(client, a["id"], tag="介词", confirm=False)
    scored_paper(client, a["id"], tag="阅读理解", kind="practice")
    scored_paper(client, b["id"], tag="过去时")
    doc = material(client)
    eligible = bank_question(client, doc, tag="第三人称单数")
    for index, tag in enumerate(["be动词", "冠词", "介词", "阅读理解", "过去时"], start=2):
        bank_question(client, doc, number=str(index), tag=tag)
    bank_question(client, doc, number="draft", confirm=False)
    foreign_grade = bank_question(client, material(client, grade="九年级"), number="9")
    textbook = bank_question(client, material(client, kind="textbook"), number="book")
    result = recommend(client, a["id"], count=8)
    assert result["student_id"] == a["id"]
    assert [i["question"]["id"] for i in result["items"]] == [eligible["id"]]
    assert result["requested"] == 8 and result["available"] == 1 and result["shortage"] == 7
    assert len(result["weak_points"]) == 1
    assert result["weak_points"][0]["tag"] in ("三单", "第三人称单数")
    item = result["items"][0]
    assert item["matched_tags"] and item["evidence"] and item["reason"]
    assert item["question"]["context"] == eligible["context"]
    assert item["question"]["options"] == eligible["options"]
    assert "QA不相关学生" not in json.dumps(result, ensure_ascii=False)
    broader = recommend(client, a["id"], count=8, include_other_grades=True)
    assert {i["question"]["id"] for i in broader["items"]} == {eligible["id"], foreign_grade["id"]}
    assert next(i for i in broader["items"] if i["question"]["id"] == foreign_grade["id"])["reason"] != ""
    all_kinds = recommend(client, a["id"], count=8, kind="all")
    assert {i["question"]["id"] for i in all_kinds["items"]} == {eligible["id"], textbook["id"]}
    assert model_stub.requests == [], "Automatic selection must not generate filler questions"
    # Reopening the only relevant school record immediately removes its authority.
    ok(edit_exam(client, evidence, notes="QA老师正在更正"))
    assert recommend(client, a["id"])["items"] == []


def test_v02_no_weakness_or_no_match_reports_real_shortage(client, model_stub):
    configure(client, model_stub)
    a = student(client)
    doc = material(client)
    bank_question(client, doc, tag="三单")
    fresh = recommend(client, a["id"], count=5)
    assert fresh["items"] == [] and fresh["weak_points"] == []
    assert fresh["available"] == 0 and fresh["shortage"] == 5 and fresh["message"]
    scored_paper(client, a["id"], tag="条件状语从句")
    no_match = recommend(client, a["id"], count=5)
    assert no_match["items"] == [] and no_match["available"] == 0 and no_match["shortage"] == 5
    assert no_match["message"] and model_stub.requests == []
    for count in [0, 31]:
        assert client.get(f"/api/students/{a['id']}/recommendations", headers=PERSONAL,
                          params={"count": count}).status_code in (400, 422)


def test_v02_practice_snapshot_preserves_passage_options_sources_and_blanks_retest(client):
    a, b = student(client, "QA练习目标甲"), student(client, "QA另一学生乙")
    original = scored_paper(client, a["id"], total=73)
    doc = material(client, pages=2)
    q1 = bank_question(client, doc, source_page=1, source_end_page=2)
    q2 = bank_question(client, doc, number="2", stem="Which sentence is true?", context=q1["context"])
    saved = save_set(client, a["id"], [q1, q2])
    assert len(saved["items"]) == 2 and saved["linked_exam_id"] is None
    assert ok(client.get(f"/api/students/{b['id']}/practice-sets", headers=PERSONAL)) == []
    for item, row in zip(saved["items"], [q1, q2]):
        assert item["bank_question_id"] == row["id"]
        assert item["question"] == row
        assert item["document_title"] == doc["title"]
        assert "workspace=personal" in item["source_url"]
        assert client.get(item["source_url"]).status_code == 200
        assert item["evidence"] and item["matched_tags"]
    ok(bank_edit(client, q1, answer="B", context="QA新版文章不应覆盖旧练习"))
    readback = ok(client.get(f"/api/practice-sets/{saved['id']}", headers=PERSONAL))
    assert readback["items"] == saved["items"]
    retest = ok(client.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
    assert retest["student_id"] == a["id"] and retest["kind"] == "practice"
    assert retest["status"] != "confirmed" and retest["school_score"] is None
    assert retest["full_score"] == q1["max_score"] + q2["max_score"]
    assert retest["attachments"] == []
    assert doc["title"] in retest["notes"]
    for item in retest["questions"]:
        assert item["student_answer"] == ""
        assert item["school_score"] is None and item["ai_score"] is None
        assert item["reviewed"] is False and item["source_attachment_id"] is None
        assert q1["context"] in item["stem"]
        assert all(option in item["stem"] for option in q1["options"])
        assert item["correct_answer"] == "A"
        assert item["knowledge_tag"]
        assert not any(key.startswith("_") for key in item)
    repeated = ok(client.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
    assert repeated["id"] == retest["id"]
    linked = ok(client.get(f"/api/practice-sets/{saved['id']}", headers=PERSONAL))
    assert linked["linked_exam_id"] == retest["id"] and linked["linked_exam"]["id"] == retest["id"]
    assert ok(client.get(f"/api/exams/{original['id']}", headers=PERSONAL)) == original


def test_v02_completed_retest_excludes_bank_id_and_does_not_replace_school_score(client):
    a = student(client)
    scored_paper(client, a["id"], total=71)
    row = bank_question(client, material(client))
    saved = save_set(client, a["id"], [row])
    assert [i["question"]["id"] for i in recommend(client, a["id"])["items"]] == [row["id"]]
    retest = ok(client.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
    assert recommend(client, a["id"])["available"] == 1, "A draft worksheet is not completed practice"
    q = dict(retest["questions"][0], student_answer="B", school_score=0, reviewed=True, needs_review=False)
    retest = ok(edit_exam(client, retest, questions=[q], school_score=0, exam_date="2026-10-31"))
    retest = ok(client.post(f"/api/exams/{retest['id']}/confirm", headers=PERSONAL,
                            json={"revision": retest["revision"]}))
    assert recommend(client, a["id"])["items"] == [], "Completion must follow persisted private bank mapping"
    summary = next(s for s in ok(client.get("/api/students", headers=PERSONAL)) if s["id"] == a["id"])
    assert summary["latest_score"] == 71 and summary["latest_exam_date"] == "2026-10-04"
    # Corrections reopen the practice, so it no longer proves completion.
    ok(edit_exam(client, retest, notes="QA更正复测，尚未重新确认"))
    assert recommend(client, a["id"])["available"] == 1


def test_v02_practice_set_rejects_draft_duplicates_empty_and_injected_fields(client):
    a = student(client)
    doc = material(client)
    draft = bank_question(client, doc, confirm=False)
    ready = bank_question(client, doc, number="2")
    bodies = [
        {"title": "QA", "question_ids": [draft["id"]]},
        {"title": "QA", "question_ids": [ready["id"], ready["id"]]},
        {"title": "QA", "question_ids": []},
        {"title": " ", "question_ids": [ready["id"]]},
        {"title": "QA", "question_ids": [ready["id"]], "student_id": "other-student",
         "evidence": ["Injected unrelated student"], "school_score": 99},
    ]
    for body in bodies:
        response = client.post(f"/api/students/{a['id']}/practice-sets", headers=PERSONAL, json=body)
        assert response.status_code in (400, 404, 422), response.text
    assert ok(client.get(f"/api/students/{a['id']}/practice-sets", headers=PERSONAL)) == []


def test_v02_extraction_sends_only_selected_page_and_preserves_shared_passage(client, model_stub):
    configure(client, model_stub)
    doc = material(client, pages=12)
    payload = extract_payload(page=10)
    payload["questions"].append(dict(payload["questions"][0], number="2", stem="A second question"))
    model_stub.answer(payload)
    job = extract(client, doc, [10])
    assert job["status"] == "succeeded" and job["kind"] == "extract"
    assert job["result"]["added"] == 2
    rows = ok(client.get("/api/bank/questions", headers=PERSONAL, params={"document_id": doc["id"]}))
    assert len(rows) == 2 and all(q["status"] == "draft" for q in rows)
    assert all(q["source_page"] == 10 and q["context"] == payload["questions"][0]["context"] for q in rows)
    assert all(q["options"] == payload["questions"][0]["options"] for q in rows)
    assert not any("student_answer" in q for q in rows)
    images = [part for message in model_stub.requests[0]["body"]["messages"]
              for part in message.get("content", []) if isinstance(part, dict) and part.get("type") == "image_url"]
    assert len(images) == 1
    # Teacher-edited existing question must survive repeat extraction.
    changed = ok(bank_edit(client, rows[0], stem="QA老师已校正文案"))
    refreshed_doc = ok(client.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))
    model_stub.answer(payload)
    duplicate = extract(client, refreshed_doc, [10])
    assert duplicate["status"] == "succeeded"
    assert duplicate["result"]["added"] == 0 and duplicate["result"]["skipped"] == 2
    current = ok(client.get("/api/bank/questions", headers=PERSONAL, params={"document_id": doc["id"]}))
    assert len(current) == 2
    assert next(q for q in current if q["id"] == changed["id"])["stem"] == changed["stem"]


@pytest.mark.parametrize("pages", [[], [1, 1], list(range(1, 10)), [13]])
def test_v02_extraction_rejects_invalid_selection_without_model_call(client, model_stub, pages):
    configure(client, model_stub)
    doc = material(client, pages=12)
    response = client.post(f"/api/library/documents/{doc['id']}/extract", headers=PERSONAL,
                           json={"revision": doc["revision"], "pages": pages})
    assert response.status_code in (400, 422)
    assert model_stub.requests == []
    assert ok(client.get("/api/bank/questions", headers=PERSONAL)) == []


@pytest.mark.parametrize("payload", ["not valid JSON", {"questions": []}, extract_payload(page=3)])
def test_v02_bad_or_out_of_selection_extraction_does_not_create_fake_questions(client, model_stub, payload):
    configure(client, model_stub)
    doc = material(client, pages=3)
    model_stub.answer(payload)
    job = extract(client, doc, [1])
    assert job["status"] == "failed", job
    assert job["message"]
    assert ok(client.get("/api/bank/questions", headers=PERSONAL)) == []


def test_v02_late_extraction_cannot_overwrite_new_document_revision(client, model_stub):
    configure(client, model_stub)
    doc = material(client)
    entered, release = threading.Event(), threading.Event()
    model_stub.answer(extract_payload(), gate=(entered, release))
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(extract, client, doc, [1])
        try:
            assert entered.wait(timeout=5)
            changed = ok(client.patch(f"/api/library/documents/{doc['id']}", headers=PERSONAL,
                                      json={"revision": doc["revision"], "title": "QA处理期间修订"}))
        finally:
            release.set()
        result = pending.result(timeout=10)
    assert result["status"] == "failed"
    assert ok(client.get("/api/bank/questions", headers=PERSONAL)) == []
    assert ok(client.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))["revision"] == changed["revision"]


def test_v02_backup_contains_library_originals_and_snapshot_without_previews_or_settings(client, model_stub, tmp_path):
    configure(client, model_stub)
    a = student(client)
    original = pdf_bytes(2, "QA-BACKUP-SOURCE")
    doc = material(client, files=[("files", ("backup.pdf", original, "application/pdf"))])
    ready = bank_question(client, doc)
    saved = save_set(client, a["id"], [ready])
    source = saved["items"][0]["source_url"]
    assert client.get(source).status_code == 200  # Populate an actual preview cache.
    response = client.get("/api/backup", headers=PERSONAL)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "workspace.sqlite3" in names
        assert not any("settings" in name.lower() or "preview" in name.lower() or "cache" in name.lower() for name in names)
        blobs = [archive.read(name) for name in names if not name.endswith("/")]
        assert original in blobs
        assert not any(SECRET.encode() in blob for blob in blobs)
        path = tmp_path / "v02-backup.sqlite3"
        path.write_bytes(archive.read("workspace.sqlite3"))
    with sqlite3.connect(path) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        dump = "\n".join(database.iterdump())
        assert doc["id"] in dump and ready["id"] in dump and saved["id"] in dump


def test_v02_encrypted_and_over_page_limit_pdf_are_rejected_without_partial_records(client):
    with fitz.open() as document:
        document.new_page()
        encrypted = document.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256,
                                    owner_pw="qa-owner-password", user_pw="qa-user-password")
    too_long = pdf_bytes(501, "QA oversized")
    for payload in [encrypted, too_long]:
        response = client.post("/api/library/documents", headers=PERSONAL,
                               data={"title": "QA拒绝文件", "kind": "textbook"},
                               files=[("files", ("not-accepted.pdf", payload, "application/pdf"))])
        assert response.status_code in (400, 413, 422)
    assert ok(client.get("/api/library/documents", headers=PERSONAL)) == []


def test_v02_model_transport_error_is_redacted_and_creates_no_bank_rows(client, model_stub):
    configure(client, model_stub)
    doc = material(client)
    model_stub.fail(f"QA model unavailable {SECRET}")
    job = extract(client, doc, [1])
    assert job["status"] == "failed" and SECRET not in json.dumps(job)
    assert ok(client.get("/api/bank/questions", headers=PERSONAL)) == []


def test_v02_concurrent_extractions_cannot_create_duplicate_bank_questions(client, model_stub):
    configure(client, model_stub)
    doc = material(client)
    entered, release = threading.Event(), threading.Event()
    model_stub.answer(extract_payload(), gate=(entered, release))
    model_stub.answer(extract_payload())
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(extract, client, doc, [1])
        second = None
        try:
            assert entered.wait(timeout=5)
            second = pool.submit(client.post, f"/api/library/documents/{doc['id']}/extract",
                                 headers=PERSONAL, json={"revision": doc["revision"], "pages": [1]})
        finally:
            release.set()
        primary = first.result(timeout=10)
        response = second.result(timeout=10)
    assert primary["status"] == "succeeded"
    if response.status_code in (200, 201, 202):
        repeated = finished_job(client, response.json())
        assert repeated["status"] in ("succeeded", "failed")
    else:
        assert response.status_code in (400, 409)
    rows = ok(client.get("/api/bank/questions", headers=PERSONAL,
                         params={"document_id": doc["id"]}))
    assert len(rows) == 1


def test_v02_retest_sources_follow_immutable_snapshot_and_question_ids_not_position_or_client_claims(client):
    a, b = student(client, "QA题源学生甲"), student(client, "QA题源学生乙")
    doc_a = material(client, pages=3, title="QA甲练习原始资料名")
    first = bank_question(client, doc_a, source_page=1, source_end_page=2)
    second = bank_question(client, doc_a, number="2", source_page=3, source_end_page=3)
    saved_a = save_set(client, a["id"], [first, second])
    retest_a = ok(client.post(f"/api/practice-sets/{saved_a['id']}/to-exam", headers=PERSONAL, json={}))
    q1, q2 = retest_a["questions"]
    sources = retest_a["question_sources"]
    assert set(sources) == {q1["id"], q2["id"]}
    assert sources[q1["id"]]["document_title"] == doc_a["title"]
    assert (sources[q1["id"]]["source_page"], sources[q1["id"]]["source_end_page"]) == (1, 2)
    assert sources[q2["id"]]["source_page"] == 3
    for source in sources.values():
        assert "workspace=personal" in source["url"]
        assert client.get(source["url"]).status_code == 200
        assert client.get(source["url"].replace("workspace=personal", "workspace=demo")).status_code == 404
    assert client.get(f"/api/exams/{retest_a['id']}", headers=DEMO).status_code == 404

    # A changed source-bank record or renamed document cannot rewrite assignment history.
    ok(bank_edit(client, first, source_page=3, source_end_page=3, answer="B"))
    current_doc = ok(client.get(f"/api/library/documents/{doc_a['id']}", headers=PERSONAL))
    ok(client.patch(f"/api/library/documents/{doc_a['id']}", headers=PERSONAL,
                    json={"revision": current_doc["revision"], "title": "QA后改资料名"}))
    unchanged = ok(client.get(f"/api/exams/{retest_a['id']}", headers=PERSONAL))
    assert unchanged["question_sources"] == sources

    # Drop the first question and insert a new manual one. Position and editable page
    # fields must not fabricate a mapping; the remaining mapped ID still points to p3.
    new_question = dict(q1, id=str(uuid4()), number="new", stem="QA新增无题库映射的手工题")
    retained = dict(q2, number="1", source_page=1)
    changed_a = ok(edit_exam(client, unchanged, questions=[new_question, retained]))
    assert changed_a["question_sources"] == {q2["id"]: sources[q2["id"]]}
    assert q1["id"] not in changed_a["question_sources"]
    assert new_question["id"] not in changed_a["question_sources"]

    # Library materials may be reused by a teacher, but mappings belong to a
    # particular student's saved assignment. Reusing A's question ID in B is not proof.
    doc_b = material(client, title="QA乙独立来源")
    bank_b = bank_question(client, doc_b)
    saved_b = save_set(client, b["id"], [bank_b])
    retest_b = ok(client.post(f"/api/practice-sets/{saved_b['id']}/to-exam", headers=PERSONAL, json={}))
    own_b = retest_b["questions"][0]
    changed_b = ok(edit_exam(client, retest_b, questions=[dict(q1), own_b]))
    assert set(changed_b["question_sources"]) == {own_b["id"]}
    assert changed_b["question_sources"][own_b["id"]]["document_title"] == doc_b["title"]
    assert all(doc_a["id"] not in item["url"] for item in changed_b["question_sources"].values())
    assert not any(key.startswith("_") for key in changed_b)

    # Read-only derived metadata must not expand the writable Question/Exam schemas.
    with_source = dict(own_b, source_url=sources[q1["id"]]["url"])
    assert edit_exam(client, changed_b, questions=[with_source]).status_code == 422
    assert edit_exam(client, changed_b, question_sources=sources).status_code == 422
    final_b = ok(client.get(f"/api/exams/{changed_b['id']}", headers=PERSONAL))
    assert final_b["revision"] == changed_b["revision"]
    assert final_b["question_sources"] == changed_b["question_sources"]
    ordinary = exam(client, a["id"])
    assert ordinary["question_sources"] == {}

