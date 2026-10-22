"""Opt-in black-box desktop ZIP audit; server lifecycle is owned by PowerShell.

Only fictional fixtures and a local model transport stub are used.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sqlite3
import time
import traceback
import zipfile

import httpx

from conftest import ModelStub, PNG
from test_api_acceptance import PERSONAL, DEMO, ok, student, edit_exam
import test_v02_acceptance as v02


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("initial", "restart"))
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    entries = []
    snapshot_path = args.audit / "workflow-snapshot.json"

    def run(name, check):
        started = time.monotonic()
        try:
            detail = check()
            entries.append({"check": name, "status": "PASS", "seconds": round(time.monotonic() - started, 3), "detail": detail})
            print("PASS " + name, flush=True)
        except Exception:
            entries.append({"check": name, "status": "FAIL", "traceback": traceback.format_exc()})
            print("FAIL " + name + "\n" + traceback.format_exc(), flush=True)

    with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=30, trust_env=False) as api:
        def basic():
            health = ok(api.get("/api/health"))
            assert health == {"ok": True, "app": "english-teacher", "version": "0.2.0"}
            root = api.get("/")
            assert root.status_code == 200 and "<div id=\"root\"" in root.text
            assets = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css))"', root.text)
            assert len(assets) >= 2, root.text
            for path in assets:
                response = api.get(path)
                assert response.status_code == 200 and len(response.content) > 100
            schema = ok(api.get("/openapi.json"))
            for endpoint in ("/api/students", "/api/library/documents", "/api/bank/questions", "/api/backup"):
                assert endpoint in schema["paths"]
            return {"health": health, "static_assets": assets, "api_path_count": len(schema["paths"])}
        run("Bundled health, frontend JS/CSS, and API schema", basic)

        if args.phase == "initial":
            def empty_and_isolated():
                initial = ok(api.get("/api/bootstrap", headers=PERSONAL))
                assert initial["students"] == []
                assert ok(api.get("/api/library/documents", headers=PERSONAL)) == []
                demo = ok(api.get("/api/bootstrap", headers=DEMO))
                assert demo["students"]
                assert ok(api.get("/api/students", headers=PERSONAL)) == []
                assert api.get(f"/api/students/{demo['students'][0]['id']}", headers=PERSONAL).status_code == 404
                return {"personal_initial_students": 0, "demo_students": len(demo["students"])}
            run("Clean personal workspace and fictional demo isolation", empty_and_isolated)

            def workflow():
                pupil = student(api, "QA桌面ZIP独立验收虚构学生")
                school = v02.scored_paper(api, pupil["id"], tag="三单", total=73)
                pdf = v02.pdf_bytes(60, "QA-DESKTOP-ZIP-SOURCE")
                doc = v02.material(api, kind="past_paper", files=[
                    ("files", ("qa-60-pages.pdf", pdf, "application/pdf")),
                    ("files", ("qa-photo.png", PNG, "image/png")),
                ])
                assert doc["page_count"] == 61 and doc["text_page_count"] == 60
                for file, payload in zip(doc["files"], (pdf, PNG)):
                    assert api.get(file["url"]).content == payload
                    assert api.get(file["url"].replace("workspace=personal", "workspace=demo")).status_code == 404
                pages = ok(api.get(f"/api/library/documents/{doc['id']}/pages", headers=PERSONAL, params={"page": 59, "page_size": 3}))
                assert [p["page"] for p in pages["items"]] == [59, 60, 61]
                for page in pages["items"]:
                    preview = api.get(page["preview_url"])
                    assert preview.status_code == 200 and preview.headers["content-type"].startswith("image/")
                found = ok(api.get("/api/library/search", headers=PERSONAL, params={"q": "PAGE-059", "document_id": doc["id"]}))
                assert found["total"] == 1 and found["items"][0]["page"] == 59
                bank = v02.bank_question(api, doc, source_page=59, source_end_page=60)
                recommendations = v02.recommend(api, pupil["id"], count=3)
                assert [i["question"]["id"] for i in recommendations["items"]] == [bank["id"]]
                assert recommendations["shortage"] == 2
                saved = v02.save_set(api, pupil["id"], [bank])
                retest = ok(api.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
                assert retest["school_score"] is None and retest["status"] != "confirmed"
                assert all(q["student_answer"] == "" and not q["reviewed"] for q in retest["questions"])
                assert api.get(f"/api/exams/{retest['id']}", headers=DEMO).status_code == 404
                assert api.get(f"/api/practice-sets/{saved['id']}", headers=DEMO).status_code == 404
                snapshot = {"student": pupil, "school": school, "document": doc, "bank": bank, "practice": saved, "retest": retest,
                            "source_sha256": [hashlib.sha256(p).hexdigest() for p in (pdf, PNG)]}
                snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
                return {"source_pages": 61, "search_hit_page": 59, "recommendation_count": 1, "shortage": 2, "retest_question_count": len(retest["questions"])}
            run("PDF+image import, originals, search, confirmed bank, recommendation, practice and retest", workflow)

            checks = [
                v02.test_v02_multiple_pdfs_and_photos_share_correct_global_page_numbers,
                v02.test_v02_library_bank_practice_and_source_urls_are_workspace_isolated,
                v02.test_v02_bank_confirmation_source_validation_revision_and_reopen,
                v02.test_v02_practice_snapshot_preserves_passage_options_sources_and_blanks_retest,
                v02.test_v02_practice_set_rejects_draft_duplicates_empty_and_injected_fields,
                v02.test_v02_retest_sources_follow_immutable_snapshot_and_question_ids_not_position_or_client_claims,
            ]
            for check in checks:
                run(check.__name__, lambda check=check: check(api))

            def completed_retest():
                # Unlike the pytest fixture, this deployed server retains all previous
                # checks. A unique knowledge tag prevents unrelated bank rows from
                # invalidating the single-question expectation in this scenario.
                tag = "QA独立复测知识点20261005"
                pupil = student(api, "QA完成复测虚构学生")
                v02.scored_paper(api, pupil["id"], tag=tag, total=71)
                row = v02.bank_question(api, v02.material(api), tag=tag)
                saved = v02.save_set(api, pupil["id"], [row])
                assert [item["question"]["id"] for item in v02.recommend(api, pupil["id"])["items"]] == [row["id"]]
                retest = ok(api.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))
                assert v02.recommend(api, pupil["id"])["available"] == 1
                answer = dict(retest["questions"][0], student_answer="B", school_score=0, reviewed=True, needs_review=False)
                retest = ok(edit_exam(api, retest, questions=[answer], school_score=0, exam_date="2026-10-31"))
                retest = ok(api.post(f"/api/exams/{retest['id']}/confirm", headers=PERSONAL, json={"revision": retest["revision"]}))
                assert v02.recommend(api, pupil["id"])["items"] == []
                summary = next(item for item in ok(api.get("/api/students", headers=PERSONAL)) if item["id"] == pupil["id"])
                assert summary["latest_score"] == 71 and summary["latest_exam_date"] == "2026-10-04"
                ok(edit_exam(api, retest, notes="QA更正复测，尚未重新确认"))
                assert v02.recommend(api, pupil["id"])["available"] == 1
            run("Completed retest excludes its bank source, preserves school score and reopens after edit", completed_retest)

            def model_transport():
                stub = ModelStub()
                try:
                    v02.test_v02_extraction_sends_only_selected_page_and_preserves_shared_passage(api, stub)
                    return {"local_stub_requests": len(stub.requests), "real_model_quality_tested": False}
                finally:
                    stub.close()
            run("Bundled PDF extraction transport with local fictional stub; teacher edit survives repeated extraction", model_transport)
        else:
            def persisted():
                stored = json.loads(snapshot_path.read_text(encoding="utf-8"))
                pupil, doc, saved, retest = (stored[k] for k in ("student", "document", "practice", "retest"))
                assert ok(api.get(f"/api/students/{pupil['id']}", headers=PERSONAL))["name"] == pupil["name"]
                current_doc = ok(api.get(f"/api/library/documents/{doc['id']}", headers=PERSONAL))
                assert current_doc["page_count"] == 61
                for file, expected in zip(current_doc["files"], stored["source_sha256"]):
                    assert hashlib.sha256(api.get(file["url"]).content).hexdigest() == expected
                readback = ok(api.get(f"/api/practice-sets/{saved['id']}", headers=PERSONAL))
                assert readback["items"] == saved["items"] and readback["linked_exam_id"] == retest["id"]
                assert ok(api.post(f"/api/practice-sets/{saved['id']}/to-exam", headers=PERSONAL, json={}))["id"] == retest["id"]
                restored = ok(api.get(f"/api/exams/{retest['id']}", headers=PERSONAL))
                assert restored["questions"] == retest["questions"]
                assert restored["question_sources"] == retest["question_sources"]
                for source in restored["question_sources"].values():
                    assert api.get(source["url"]).status_code == 200
                school = ok(api.get(f"/api/exams/{stored['school']['id']}", headers=PERSONAL))
                assert school["status"] == "confirmed" and school["school_score"] == 73
                assert api.get(f"/api/students/{pupil['id']}", headers=DEMO).status_code == 404
                return {"student": "fictional", "source_hashes_preserved": True, "practice_snapshot_preserved": True, "school_score": 73}
            run("Real EXE restart preserves source files, student, practice snapshot, source mapping and school score", persisted)

        def backup_check():
            response = api.get("/api/backup", headers=PERSONAL)
            assert response.status_code == 200
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                names = archive.namelist()
                assert "workspace.sqlite3" in names and not any("settings" in name or "preview" in name for name in names)
                target = args.audit / f"{args.phase}-backup.sqlite3"
                target.write_bytes(archive.read("workspace.sqlite3"))
                with sqlite3.connect(target) as conn:
                    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                assert any(name.startswith("library/") for name in names)
            return {"backup_entries": len(names), "integrity_check": "ok", "settings_excluded": True}
        run("Backup includes durable originals and consistent database, excludes settings and previews", backup_check)

    result = {"phase": args.phase, "port": args.port, "checks": entries, "passed": sum(row["status"] == "PASS" for row in entries), "failed": sum(row["status"] == "FAIL" for row in entries)}
    (args.audit / f"{args.phase}-results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "failed": result["failed"]}), flush=True)
    raise SystemExit(bool(result["failed"]))


if __name__ == "__main__":
    main()
