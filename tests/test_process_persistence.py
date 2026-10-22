"""Actual process restarts, not merely refreshing a page or Python object."""

import threading

from test_api_acceptance import (
    PERSONAL, SECRET, configure, confirmed_exam, exam, ok, question, student, upload,
)


def test_saved_teacher_records_files_plan_and_settings_survive_process_restart(live_server, model_stub):
    process, api = live_server()
    try:
        s = student(api, "QA重启虚构学生")
        paper = confirmed_exam(api, s["id"], score=79)
        plan = ok(api.post(f"/api/students/{s['id']}/plans/manual", headers=PERSONAL, json={"exam_id": paper["id"], "title": "QA持久化教案", "content": "保留已确认数据及课后复测。"}))
        plan = ok(api.patch(f"/api/plans/{plan['id']}", headers=PERSONAL, json={"lesson_note": "QA已完成复测", "review_date": "2026-10-11", "review_result": "需要再练"}))
        original = upload(api, exam(api, s["id"], title="QA附图草稿")["id"])["attachments"][0]
        configure(api, model_stub)
    finally:
        api.close()
        process.kill()
        process.wait(timeout=5)
    _restarted, api = live_server()
    try:
        detail = ok(api.get(f"/api/students/{s['id']}", headers=PERSONAL))
        assert detail["name"] == "QA重启虚构学生"
        actual = ok(api.get(f"/api/exams/{paper['id']}", headers=PERSONAL))
        assert actual["status"] == "confirmed" and actual["school_score"] == 79
        assert actual["questions"] == paper["questions"]
        actual_plan = next(p for p in detail["plans"] if p["id"] == plan["id"])
        assert actual_plan["lesson_note"] == "QA已完成复测"
        assert actual_plan["review_date"] == "2026-10-11"
        assert actual_plan["review_result"] == "需要再练"
        assert api.get(original["url"]).status_code == 200
        settings = ok(api.get("/api/settings", headers=PERSONAL))
        assert settings["has_api_key"] is True
        assert SECRET not in str(settings)
    finally:
        api.close()


def test_interrupted_model_job_fails_after_process_restart(live_server, model_stub):
    process, api = live_server()
    entered, release = threading.Event(), threading.Event()
    try:
        s = student(api)
        paper = upload(api, exam(api, s["id"])["id"])
        configure(api, model_stub)
        draft = question(reviewed=False)
        draft["source_attachment_id"] = paper["attachments"][0]["id"]
        model_stub.answer({"questions": [draft]}, gate=(entered, release))
        job = ok(api.post(f"/api/exams/{paper['id']}/recognize", headers=PERSONAL, json={}))
        assert entered.wait(timeout=4)
    finally:
        api.close()
        process.kill()
        process.wait(timeout=5)
        release.set()
    _restarted, api = live_server()
    try:
        recovered = ok(api.get(f"/api/jobs/{job['id']}", headers=PERSONAL))
        assert recovered["status"] == "failed"
        actual = ok(api.get(f"/api/exams/{paper['id']}", headers=PERSONAL))
        assert actual["questions"] == []
        assert actual["status"] != "confirmed"
    finally:
        api.close()
