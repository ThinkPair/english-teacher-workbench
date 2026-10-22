import json
import sqlite3
import tempfile
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import ai, storage as s
from .demo import ensure_demo
from .media import MAX_FILE_SIZE, MAX_RECOGNITION_PAGES, attachment_public, media_path, validate_and_store
from .schemas import Confirm, ExamCreate, ExamSave, ManualPlan, PlanPatch, PlanRequest, SettingsInput, StudentCreate, StudentPatch


@asynccontextmanager
async def lifespan(application):
    for workspace in ("demo", "personal"):
        with s.transaction(workspace) as db:
            for job in s.records(db, "jobs"):
                if job["status"] in ("queued", "running"):
                    job.update(status="failed", message="上次运行中断，请检查记录后重新发起", result=None)
                    s.put(db, "jobs", job)
    yield


app = FastAPI(title="英语班主任工作台", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def local_origin_guard(request: Request, call_next):
    # Vite uses a same-origin proxy; the packaged app binds only to loopback.
    if request.url.hostname not in ("127.0.0.1", "localhost", "::1", "testserver"):
        return JSONResponse({"detail": "仅允许本机访问"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and request.url.path.startswith("/api"):
        parsed = urlsplit(origin)
        if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != request.headers.get("host", "").lower():
            return JSONResponse({"detail": "拒绝跨站请求"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Do not reflect body values (in particular API keys) in validation errors.
    fields = ", ".join(".".join(map(str, e["loc"][1:])) for e in exc.errors()[:5])
    return JSONResponse({"detail": f"输入字段不合法：{fields}。请检查日期、必填项及分数范围。"}, status_code=422)


def workspace(x_workspace: str = Header(default="personal")):
    value = s.check_workspace(x_workspace)
    if value == "demo":
        ensure_demo()
        from .library_demo import ensure_library_demo
        ensure_library_demo()
    return value


def summary(exam):
    return {**{k: v for k, v in exam.items() if k not in ("questions", "attachments") and not k.startswith("_")}, "question_count": len(exam["questions"]), "pending_count": sum(not q["reviewed"] for q in exam["questions"])}


def full_exam(db, exam, ws):
    question_sources = {}
    set_id = exam.get("_practice_set_id")
    bank_map = exam.get("_bank_question_map", {})
    if set_id and bank_map:
        try:
            practice = s.get(db, "practice_sets", set_id)
        except HTTPException:
            practice = None
        if practice and practice["student_id"] == exam["student_id"] and practice.get("linked_exam_id") == exam["id"]:
            from .library_media import page_url
            snapshots = {item["bank_question_id"]: item for item in practice["items"]}
            for question in exam["questions"]:
                item = snapshots.get(bank_map.get(question["id"]))
                if not item:
                    continue
                source = item["question"]
                try:
                    document = s.get(db, "documents", source["document_id"])
                except HTTPException:
                    continue
                start, end = source["source_page"], source["source_end_page"]
                if not 1 <= start <= end <= document["page_count"]:
                    continue
                question_sources[question["id"]] = {"document_title": item["document_title"], "source_page": start, "source_end_page": end, "url": page_url(document["id"], start, ws)}
    return {**s.safe_record(exam), "attachments": [attachment_public(a, ws) for a in s.records(db, "attachments", "exam_id", exam["id"] )], "question_sources": question_sources}


def sorted_exams(db, student_id=None):
    exams = s.records(db, "exams", "student_id", student_id) if student_id else s.records(db, "exams")
    return sorted(exams, key=lambda e: (e["exam_date"], e["created_at"]), reverse=True)


def weak_points(exams):
    points = {}
    for exam in exams:
        if exam["status"] != "confirmed" or exam["kind"] != "school":
            continue
        for q in exam["questions"]:
            # AI suggestions alone never establish a learning deficit.
            score = q.get("school_score")
            if not q.get("reviewed") or score is None or score >= q["max_score"]:
                continue
            tag = q["knowledge_tag"].strip() or "待归类"
            entry = points.setdefault(tag, {"tag": tag, "count": 0, "evidence": []})
            entry["count"] += 1
            entry["evidence"].append(f"{exam['exam_date']} · {exam['title']} · 第 {q['number']} 题")
    return sorted(points.values(), key=lambda p: p["count"], reverse=True)


def student_list(db):
    result = []
    for student in s.records(db, "students"):
        exams = sorted_exams(db, student["id"])
        confirmed = [e for e in exams if e["status"] == "confirmed"]
        school_exams = [e for e in confirmed if e["kind"] == "school"]
        latest = school_exams[0] if school_exams else None
        result.append({**student, "exam_count": len(confirmed), "latest_score": latest["school_score"] if latest else None, "latest_full_score": latest["full_score"] if latest else None, "latest_exam_date": latest["exam_date"] if latest else None, "pending_count": sum(e["status"] != "confirmed" for e in exams), "weak_tags": [p["tag"] for p in weak_points(confirmed)]})
    return sorted(result, key=lambda st: st["created_at"], reverse=True)


def validate_question_sources(db, exam_id, questions):
    attachments = {a["id"]: a for a in s.records(db, "attachments", "exam_id", exam_id)}
    seen = set()
    for q in questions:
        q["id"] = q["id"] or s.uid()
        if q["id"] in seen:
            raise HTTPException(400, "题目 ID 重复")
        seen.add(q["id"])
        source = q.get("source_attachment_id")
        if source and (source not in attachments or q["source_page"] > attachments[source]["_pages"]):
            raise HTTPException(400, "题目原图不属于本卷或页码无效")


@app.get("/api/health")
def health():
    return {"ok": True, "version": "0.2.0", "app": "english-teacher"}


@app.get("/api/bootstrap")
def bootstrap(ws=Depends(workspace)):
    with s.transaction(ws) as db:
        students = student_list(db)
        exams = sorted_exams(db)
        settings = s.read_settings(ws)
        return {"workspace": ws, "students": students, "stats": {"students": len(students), "confirmed_exams": sum(e["status"] == "confirmed" for e in exams), "pending_exams": sum(e["status"] != "confirmed" for e in exams), "plans": len(s.records(db, "plans"))}, "ai": {"configured": ai.configured(settings), "model": settings["model"], "vision_model": settings["vision_model"]}, "recent_exams": [summary(e) for e in exams[:8]]}


@app.get("/api/students")
def list_students(ws=Depends(workspace)):
    with s.transaction(ws) as db:
        return student_list(db)


@app.post("/api/students")
def create_student(data: StudentCreate, ws=Depends(workspace)):
    record = {"id": s.uid(), **data.model_dump(), "created_at": s.now()}
    with s.transaction(ws) as db:
        s.put(db, "students", record)
    return record


@app.get("/api/students/{student_id}")
def get_student(student_id: str, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        record = s.get(db, "students", student_id)
        exams = sorted_exams(db, student_id)
        points = weak_points(exams)
        count = sum(e["status"] == "confirmed" for e in exams)
        text = f"已有 {count} 份老师确认的试卷。" if count else "尚无已确认试卷；待校对内容不会计入学情。"
        if points:
            text += " 当前需要复测：" + "、".join(p["tag"] for p in points[:3]) + "。"
        return {**record, "exams": [summary(e) for e in exams], "plans": [s.safe_record(p) for p in sorted(s.records(db, "plans", "student_id", student_id), key=lambda p: p["created_at"], reverse=True)], "weak_points": points, "summary": text}


@app.patch("/api/students/{student_id}")
def patch_student(student_id: str, data: StudentPatch, ws=Depends(workspace)):
    changes = data.model_dump(exclude_unset=True)
    for field in ("name", "grade", "school", "notes"):
        if field in changes and changes[field] is None:
            raise HTTPException(422, "文本字段不能为 null")
    with s.transaction(ws) as db:
        record = s.get(db, "students", student_id)
        updated = {**record, **changes}
        try:
            StudentCreate.model_validate({k: updated[k] for k in StudentCreate.model_fields})
        except Exception:
            raise HTTPException(422, "学生资料格式不合法")
        s.put(db, "students", updated)
        return updated


@app.post("/api/students/{student_id}/exams")
def create_exam(student_id: str, data: ExamCreate, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        s.get(db, "students", student_id)
        exam = {"id": s.uid(), "student_id": student_id, **data.model_dump(mode="json"), "status": "draft", "revision": 1, "created_at": s.now(), "questions": []}
        s.put(db, "exams", exam)
        return full_exam(db, exam, ws)


@app.get("/api/exams/{exam_id}")
def get_exam(exam_id: str, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        return full_exam(db, s.get(db, "exams", exam_id), ws)


@app.put("/api/exams/{exam_id}")
def save_exam(exam_id: str, data: ExamSave, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        exam = s.get(db, "exams", exam_id)
        if exam["revision"] != data.revision:
            raise HTTPException(409, "这份试卷已更新，请重新加载后再保存")
        changes = data.model_dump(mode="json", exclude={"revision"})
        validate_question_sources(db, exam_id, changes["questions"])
        was_confirmed = exam["status"] == "confirmed"
        exam.update(changes)
        exam["revision"] += 1
        exam["status"] = "review" if exam["questions"] or was_confirmed else "draft"
        s.mark_plans_stale(db, exam)
        s.put(db, "exams", exam)
        return full_exam(db, exam, ws)


@app.post("/api/exams/{exam_id}/attachments")
async def upload_attachments(exam_id: str, request: Request, ws=Depends(workspace)):
    form = await request.form(max_files=8, max_fields=10)
    uploads = form.getlist("files") or form.getlist("files[]")
    if not uploads or len(uploads) > 8 or any(not hasattr(f, "read") for f in uploads):
        raise HTTPException(400, "请上传 1–8 个文件（字段 files 或 files[]）")
    contents = []
    for item in uploads:
        raw = await item.read(MAX_FILE_SIZE + 1)
        contents.append((item.filename or "paper", raw))
        await item.close()
    with s.transaction(ws) as db:
        exam = s.get(db, "exams", exam_id)
        if len(s.records(db, "attachments", "exam_id", exam_id)) + len(contents) > 8:
            raise HTTPException(400, "每份试卷最多 8 个文件，请另建试卷")
        for filename, raw in contents:
            attachment = validate_and_store(ws, exam_id, filename, raw)
            s.put(db, "attachments", attachment)
        exam["revision"] += 1
        if exam["status"] == "confirmed":
            exam["status"] = "review"
        s.mark_plans_stale(db, exam)
        s.put(db, "exams", exam)
        return full_exam(db, exam, ws)


@app.get("/api/files/{file_id}")
def get_file(file_id: str, workspace: str = Query(default="personal")):
    ws = s.check_workspace(workspace)
    with s.transaction(ws) as db:
        attachment = s.get(db, "attachments", file_id)
    return FileResponse(media_path(ws, attachment), media_type=attachment["mime"], filename=attachment["filename"], content_disposition_type="inline", headers={"Content-Security-Policy": "sandbox"})


@app.get("/api/files/{file_id}/pages/{page}")
def get_page(file_id: str, page: int, workspace: str = Query(default="personal")):
    ws = s.check_workspace(workspace)
    with s.transaction(ws) as db:
        attachment = s.get(db, "attachments", file_id)
    if attachment["mime"] != "application/pdf" or not 1 <= page <= attachment["_pages"]:
        raise HTTPException(404, "不存在此预览页")
    return FileResponse(media_path(ws, attachment, page), media_type="image/png")


@app.post("/api/exams/{exam_id}/confirm")
def confirm_exam(exam_id: str, data: Confirm, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        exam = s.get(db, "exams", exam_id)
        if exam["revision"] != data.revision:
            raise HTTPException(409, "试卷版本已变化，请重新加载并校对")
        if exam["school_score"] is None:
            raise HTTPException(400, "请填写学校总分或老师确认得分，AI 建议不能代替最终成绩")
        if not exam["questions"] or any(not q["reviewed"] for q in exam["questions"]):
            raise HTTPException(400, "至少录入一道题，并逐题完成老师校对后才能确认")
        if exam["status"] != "confirmed":
            exam["revision"] += 1
            exam["status"] = "confirmed"
            for q in exam["questions"]:
                q["needs_review"] = False
            s.mark_plans_stale(db, exam)
            s.put(db, "exams", exam)
        return full_exam(db, exam, ws)


def create_job(kind, **private):
    return {"id": s.uid(), "status": "queued", "kind": kind, "message": "已排队", "result": None, "_created_at": s.now(), **{"_" + k: v for k, v in private.items()}}


def job_failed(ws, job_id, message):
    with s.transaction(ws) as db:
        job = s.get(db, "jobs", job_id)
        job.update(status="failed", message=message, result=None)
        s.put(db, "jobs", job)


def run_recognition(ws, job_id, settings):
    try:
        with s.transaction(ws) as db:
            job = s.get(db, "jobs", job_id)
            exam = s.get(db, "exams", job["_exam_id"])
            attachments = s.records(db, "attachments", "exam_id", exam["id"])
            if exam["revision"] != job["_revision"] or exam["status"] == "confirmed":
                raise RuntimeError("试卷已修改，旧识别任务已取消")
            job.update(status="running", message="正在识别原卷，完成后仍需老师校对")
            s.put(db, "jobs", job)
        questions = ai.recognize(settings, ws, exam, attachments)
        with s.transaction(ws) as db:
            latest = s.get(db, "exams", exam["id"])
            if latest["revision"] != job["_revision"] or latest["status"] == "confirmed":
                raise RuntimeError("识别期间试卷已修改，旧结果未覆盖当前记录")
            latest["questions"] = questions
            latest["revision"] += 1
            latest["status"] = "review"
            s.mark_plans_stale(db, latest)
            s.put(db, "exams", latest)
            job.update(status="succeeded", message="识别完成，请逐题核对；尚未计入正式学情", result={"exam_id": latest["id"], "revision": latest["revision"]})
            s.put(db, "jobs", job)
    except (RuntimeError, HTTPException) as exc:
        # RuntimeError messages are our own fixed messages, never provider bodies.
        job_failed(ws, job_id, str(exc) if isinstance(exc, RuntimeError) else str(exc.detail))
    except Exception:
        job_failed(ws, job_id, "识别失败，原有数据保持不变；请检查模型配置和文件")


@app.post("/api/exams/{exam_id}/recognize")
def recognize_exam(exam_id: str, tasks: BackgroundTasks, ws=Depends(workspace)):
    settings = ai.require_settings(ws, vision=True)
    with s.transaction(ws) as db:
        exam = s.get(db, "exams", exam_id)
        if exam["status"] == "confirmed":
            raise HTTPException(400, "已确认试卷不能直接重新识别；请先编辑并保存")
        attachments = s.records(db, "attachments", "exam_id", exam_id)
        if not attachments:
            raise HTTPException(400, "请先上传试卷原图或 PDF")
        pages = sum(a["_pages"] for a in attachments)
        if pages > MAX_RECOGNITION_PAGES:
            raise HTTPException(400, f"本卷共有 {pages} 页，单次识别最多 {MAX_RECOGNITION_PAGES} 页。未发送任何页面，请将材料拆成不超过 8 页的试卷后重试")
        for existing in s.records(db, "jobs"):
            if existing["kind"] == "recognize" and existing.get("_exam_id") == exam_id and existing.get("_revision") == exam["revision"] and existing["status"] in ("queued", "running"):
                return s.safe_record(existing)
        job = create_job("recognize", exam_id=exam_id, revision=exam["revision"])
        s.put(db, "jobs", job)
    tasks.add_task(run_recognition, ws, job["id"], settings)
    return s.safe_record(job)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        return s.safe_record(s.get(db, "jobs", job_id))


def plan_record(student_id, exam_id, title, content, source, exams):
    revisions = {e["id"]: e["revision"] for e in exams}
    return {"id": s.uid(), "student_id": student_id, "exam_id": exam_id, "title": title, "content": content, "source": source, "source_revision": revisions.get(exam_id), "stale": any(e["status"] != "confirmed" for e in exams), "created_at": s.now(), "lesson_note": "", "review_date": None, "review_result": "", "_source_revisions": revisions}


def run_plan(ws, job_id, settings):
    try:
        with s.transaction(ws) as db:
            job = s.get(db, "jobs", job_id)
            student = s.get(db, "students", job["_student_id"])
            exams = [s.get(db, "exams", eid) for eid in job["_source_revisions"]]
            if any(e["status"] != "confirmed" or e["revision"] != job["_source_revisions"][e["id"]] for e in exams):
                raise RuntimeError("教案来源已变化，请按最新已确认试卷重新生成")
            job.update(status="running", message="正在根据老师确认的试卷生成教案")
            s.put(db, "jobs", job)
        title, content = ai.generate_plan(settings, student, exams)
        with s.transaction(ws) as db:
            for original in exams:
                current = s.get(db, "exams", original["id"])
                if current["status"] != "confirmed" or current["revision"] != original["revision"]:
                    raise RuntimeError("生成期间来源试卷已修改，未保存旧教案，请重新生成")
            plan = plan_record(student["id"], job.get("_exam_id"), title, content, "ai", exams)
            s.put(db, "plans", plan)
            job.update(status="succeeded", message="教案已生成，可继续编辑并记录上课结果", result={"plan_id": plan["id"], "plan": s.safe_record(plan)})
            s.put(db, "jobs", job)
    except (RuntimeError, HTTPException) as exc:
        job_failed(ws, job_id, str(exc) if isinstance(exc, RuntimeError) else str(exc.detail))
    except Exception:
        job_failed(ws, job_id, "教案生成失败，未创建教案；请检查模型配置")


@app.post("/api/students/{student_id}/plans")
def generate_plan(student_id: str, data: PlanRequest, tasks: BackgroundTasks, ws=Depends(workspace)):
    settings = ai.require_settings(ws)
    with s.transaction(ws) as db:
        s.get(db, "students", student_id)
        if data.exam_id:
            exam = s.get(db, "exams", data.exam_id)
            if exam["student_id"] != student_id:
                raise HTTPException(400, "试卷不属于当前学生")
            exams = [exam] if exam["status"] == "confirmed" else []
        else:
            exams = [e for e in sorted_exams(db, student_id) if e["status"] == "confirmed"]
        if not exams:
            raise HTTPException(400, "请先确认至少一份该学生的试卷")
        job = create_job("plan", student_id=student_id, exam_id=data.exam_id, source_revisions={e["id"]: e["revision"] for e in exams})
        s.put(db, "jobs", job)
    tasks.add_task(run_plan, ws, job["id"], settings)
    return s.safe_record(job)


@app.post("/api/students/{student_id}/plans/manual")
def manual_plan(student_id: str, data: ManualPlan, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        s.get(db, "students", student_id)
        exams = []
        if data.exam_id:
            exam = s.get(db, "exams", data.exam_id)
            if exam["student_id"] != student_id:
                raise HTTPException(400, "试卷不属于当前学生")
            exams = [exam]
        plan = plan_record(student_id, data.exam_id, data.title, data.content, "teacher", exams)
        plan.update(lesson_note=data.lesson_note, review_date=data.review_date.isoformat() if data.review_date else None, review_result=data.review_result)
        s.put(db, "plans", plan)
        return s.safe_record(plan)


@app.patch("/api/plans/{plan_id}")
def update_plan(plan_id: str, data: PlanPatch, ws=Depends(workspace)):
    changes = data.model_dump(exclude_unset=True, mode="json")
    if any(changes.get(key) is None for key in ("title", "content", "lesson_note", "review_result") if key in changes):
        raise HTTPException(422, "教案文本字段不能为 null")
    with s.transaction(ws) as db:
        plan = s.get(db, "plans", plan_id)
        plan.update(changes)
        s.put(db, "plans", plan)
        return s.safe_record(plan)


@app.get("/api/settings")
def get_settings(ws=Depends(workspace)):
    return s.safe_settings(s.read_settings(ws))


@app.put("/api/settings")
def set_settings(data: SettingsInput, ws=Depends(workspace)):
    settings = s.read_settings(ws)
    settings.update(base_url=ai.validate_base_url(data.base_url), model=data.model.strip(), vision_model=data.vision_model.strip(), timeout_seconds=data.timeout_seconds)
    if data.clear_api_key:
        settings["api_key"] = ""
    elif data.api_key and data.api_key.strip():
        settings["api_key"] = data.api_key.strip()
    s.write_settings(ws, settings)
    return s.safe_settings(settings)


@app.post("/api/settings/test")
def test_settings(ws=Depends(workspace)):
    settings = ai.require_settings(ws)
    try:
        ai.chat(settings, [{"role": "user", "content": "Reply with OK."}])
        return {"ok": True, "message": "文本模型连接成功；此测试尚未验证识图能力"}
    except RuntimeError as exc:
        return {"ok": False, "message": str(exc)}


@app.get("/api/backup")
def backup(tasks: BackgroundTasks, ws=Depends(workspace)):
    temp = tempfile.TemporaryDirectory(prefix="teacher-backup-")
    try:
        root = Path(temp.name)
        source = s.connect(ws)
        target = sqlite3.connect(root / "workspace.sqlite3")
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        snapshot = sqlite3.connect(root / "workspace.sqlite3")
        rows = snapshot.execute("SELECT payload FROM attachments").fetchall()
        library_rows = snapshot.execute("SELECT payload FROM library_files").fetchall()
        snapshot.close()
        output = root / f"teacher-{ws}-backup.zip"
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(root / "workspace.sqlite3", "workspace.sqlite3")
            for row in rows:
                attachment = json.loads(row[0])
                path = media_path(ws, attachment)
                archive.write(path, f"attachments/{attachment['_directory']}/original")
            from .library_media import file_path
            for row in library_rows:
                library_file = json.loads(row[0])
                archive.write(file_path(ws, library_file), f"library/{library_file['document_id']}/{library_file['_filename']}")
        tasks.add_task(temp.cleanup)
        return FileResponse(output, media_type="application/zip", filename=output.name, background=tasks)
    except Exception:
        temp.cleanup()
        raise


from .library import router as library_router
from .practice import router as practice_router

app.include_router(library_router)
app.include_router(practice_router)

DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}")
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "接口不存在")
    candidate = (DIST / path).resolve()
    if candidate.is_relative_to(DIST.resolve()) and candidate.is_file():
        return FileResponse(candidate)
    index = DIST / "index.html"
    if not index.is_file():
        return JSONResponse({"detail": "前端尚未构建，请先完成 frontend 构建"}, status_code=503)
    return FileResponse(index)
