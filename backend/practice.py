"""Deterministic, evidence-linked practice selection. This module never calls AI."""
import copy
import re
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from . import storage as s
from .library import workspace
from .library_media import document_public, page_url
from .library_schemas import PracticeCreate

router = APIRouter(prefix="/api")

TAG_ALIASES = {
    "三单": "第三人称单数", "第三人称单数形式": "第三人称单数", "动词第三人称单数": "第三人称单数", "thirdpersonsingular": "第三人称单数", "第三人称单数": "第三人称单数",
    "simplepresent": "一般现在时", "presentsimple": "一般现在时", "一般现在时": "一般现在时",
    "pasttense": "一般过去时", "simplepast": "一般过去时", "一般过去时": "一般过去时",
    "现在进行时态": "现在进行时", "presentcontinuous": "现在进行时", "现在进行时": "现在进行时",
    "复数名词": "名词复数", "名词的复数": "名词复数", "pluralnouns": "名词复数", "名词复数": "名词复数",
    "a/an": "不定冠词", "不定冠词": "不定冠词", "subjectverbagreement": "主谓一致", "主谓一致": "主谓一致",
}


def normalized(text):
    return re.sub(r"[\s()（）\-_:：]", "", str(text)).casefold()


def tag_keys(text):
    parts = [text, *re.split(r"[·•、，,;；|()（）]+", text)]
    return {TAG_ALIASES.get(normalized(part), normalized(part)) for part in parts if part.strip()}


def grade_key(grade):
    text = normalized(grade)
    labels = ((1, ("一年级", "grade1", "1年级")), (2, ("二年级", "grade2", "2年级")), (3, ("三年级", "grade3", "3年级")), (4, ("四年级", "grade4", "4年级")), (5, ("五年级", "grade5", "5年级")), (6, ("六年级", "grade6", "6年级")), (7, ("初中一年级", "初一", "七年级", "grade7", "7年级")), (8, ("初中二年级", "初二", "八年级", "grade8", "8年级")), (9, ("初中三年级", "初三", "九年级", "grade9", "9年级")), (10, ("高中一年级", "高一", "十年级", "grade10")), (11, ("高中二年级", "高二", "十一年级", "grade11")), (12, ("高中三年级", "高三", "十二年级", "grade12")))
    # Match longer labels first so 十一年级 is not mistaken for 一年级.
    expanded = sorted(((n, label) for n, aliases in labels for label in aliases), key=lambda v: len(v[1]), reverse=True)
    for number, label in expanded:
        if label in text:
            return f"grade-{number}"
    return text


def student_weak_points(db, student_id):
    points = {}
    for exam in s.records(db, "exams", "student_id", student_id):
        if exam["kind"] != "school" or exam["status"] != "confirmed":
            continue
        for question in exam["questions"]:
            score = question.get("school_score")
            tag = question.get("knowledge_tag", "").strip()
            if not question.get("reviewed") or score is None or score >= question["max_score"] or not tag:
                continue
            entry = points.setdefault(tag, {"tag": tag, "count": 0, "evidence": []})
            entry["count"] += 1
            entry["evidence"].append(f"{exam['exam_date']} · {exam['title']} · 第 {question['number']} 题（老师确认 {score:g}/{question['max_score']:g} 分）")
    return sorted(points.values(), key=lambda p: p["count"], reverse=True)


def matching_reason(question, document, student, weak):
    keys = set().union(*(tag_keys(t) for t in question["knowledge_tags"])) if question["knowledge_tags"] else set()
    matched = [p for p in weak if keys.intersection(tag_keys(p["tag"]))]
    tags = [p["tag"] for p in matched]
    evidence = list(dict.fromkeys(ev for p in matched for ev in p["evidence"]))
    reason = "匹配已确认学校卷的失分知识点：" + "、".join(tags) if tags else "老师手动选择；目前没有匹配的已确认学校卷失分证据"
    if not student.get("grade", "").strip():
        reason += "；学生年级未填写，尚未限制资料年级"
    elif grade_key(document["grade"]) == grade_key(student["grade"]):
        reason += "；与学生年级一致"
    else:
        reason += f"；跨年级资料（{document['grade'] or '资料年级未填'}），请老师核对适用性"
    return tags, evidence, reason


def completed_bank_ids(db, student_id):
    used = set()
    for exam in s.records(db, "exams", "student_id", student_id):
        if exam["kind"] == "practice" and exam["status"] == "confirmed":
            mapping = exam.get("_bank_question_map")
            if mapping is not None:
                used.update(mapping[q["id"]] for q in exam["questions"] if q["id"] in mapping)
            else:
                used.update(exam.get("_bank_question_ids", []))
    return used


@router.get("/students/{student_id}/recommendations")
def recommendations(student_id: str, count: int = Query(default=8, ge=1, le=30), kind: Literal["past_paper", "all"] = "past_paper", include_other_grades: bool = False, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        student = s.get(db, "students", student_id)
        weak = student_weak_points(db, student_id)
        used = completed_bank_ids(db, student_id)
        docs = {d["id"]: d for d in s.records(db, "documents")}
        candidates = []
        for question in s.records(db, "bank_questions"):
            if question["status"] != "confirmed" or question["id"] in used:
                continue
            document = docs[question["document_id"]]
            if kind != "all" and document["kind"] != kind:
                continue
            same_grade = grade_key(document["grade"]) == grade_key(student["grade"])
            if student["grade"].strip() and not include_other_grades and not same_grade:
                continue
            tags, evidence, reason = matching_reason(question, document, student, weak)
            if not tags:
                continue
            candidates.append({"question": question, "document": document_public(db, document, ws), "matched_tags": tags, "evidence": evidence, "reason": reason, "_same_grade": same_grade})
        candidates.sort(key=lambda item: (-int(item["_same_grade"]), -len(item["evidence"]), -len(item["matched_tags"]), {"easy": 0, "medium": 1, "hard": 2}[item["question"]["difficulty"]], item["question"]["created_at"], item["question"]["number"]))
        available = len(candidates)
        shortage = max(0, count - available)
        message = f"找到 {available} 道有来源且经老师确认的匹配题。"
        if not weak:
            message = "尚无已确认学校卷的失分知识点，暂不自动推荐；可先归档学校卷或手动选题。"
        elif shortage:
            message += f" 距离本次 {count} 题还缺 {shortage} 题；没有使用无关题或 AI 编题补足。"
        if not student["grade"].strip():
            message += " 学生年级未填写，当前包含各年级，请老师核对。"
        elif include_other_grades:
            message += " 已允许跨年级题，同年级优先。"
        return {"student_id": student_id, "weak_points": weak, "items": [s.safe_record(item) for item in candidates[:count]], "requested": count, "available": available, "shortage": shortage, "message": message}


def practice_public(db, record):
    from .main import summary
    result = s.safe_record(record)
    result["linked_exam"] = summary(s.get(db, "exams", record["linked_exam_id"])) if record.get("linked_exam_id") else None
    return result


@router.post("/students/{student_id}/practice-sets")
def create_practice_set(student_id: str, data: PracticeCreate, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        student = s.get(db, "students", student_id)
        weak = student_weak_points(db, student_id)
        items = []
        for question_id in data.question_ids:
            question = s.get(db, "bank_questions", question_id)
            if question["status"] != "confirmed":
                raise HTTPException(400, "只能把已经老师确认的题加入练习")
            doc = s.get(db, "documents", question["document_id"])
            tags, evidence, reason = matching_reason(question, doc, student, weak)
            items.append({"bank_question_id": question_id, "question": copy.deepcopy(question), "document_title": doc["title"], "document_kind": doc["kind"], "grade": doc["grade"], "source_url": page_url(doc["id"], question["source_page"], ws), "matched_tags": tags, "evidence": evidence, "reason": reason})
        record = {"id": s.uid(), "student_id": student_id, "title": data.title, "created_at": s.now(), "items": items, "linked_exam_id": None}
        s.put(db, "practice_sets", record)
        return practice_public(db, record)


@router.get("/students/{student_id}/practice-sets")
def list_practice_sets(student_id: str, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        s.get(db, "students", student_id)
        return [practice_public(db, p) for p in sorted(s.records(db, "practice_sets", "student_id", student_id), key=lambda p: p["created_at"], reverse=True)]


@router.get("/practice-sets/{set_id}")
def get_practice_set(set_id: str, ws=Depends(workspace)):
    with s.transaction(ws) as db:
        return practice_public(db, s.get(db, "practice_sets", set_id))


@router.post("/practice-sets/{set_id}/to-exam")
def to_exam(set_id: str, ws=Depends(workspace)):
    from .main import full_exam
    with s.transaction(ws) as db:
        practice = s.get(db, "practice_sets", set_id)
        if practice["linked_exam_id"]:
            return full_exam(db, s.get(db, "exams", practice["linked_exam_id"]), ws)
        questions, source_notes = [], []
        for index, item in enumerate(practice["items"], 1):
            bank = item["question"]
            stem = "\n\n".join(v for v in (bank["context"], bank["stem"], "\n".join(bank["options"])) if v)
            questions.append({"id": s.uid(), "number": str(index), "stem": stem, "student_answer": "", "correct_answer": bank["answer"], "school_score": None, "max_score": bank["max_score"], "ai_score": None, "knowledge_tag": " · ".join(bank["knowledge_tags"]), "error_reason": "", "teacher_note": "", "needs_review": True, "reviewed": False, "source_page": bank["source_page"], "source_attachment_id": None})
            source_notes.append(f"第 {index} 题：{item['document_title']}，第 {bank['source_page']}–{bank['source_end_page']} 页，原题号 {bank['number']}。")
        exam = {"id": s.uid(), "student_id": practice["student_id"], "title": practice["title"] + " · 复测", "exam_date": date.today().isoformat(), "kind": "practice", "full_score": sum(q["max_score"] for q in questions), "school_score": None, "notes": "来自已保存的针对性练习；标准答案为教师参考，不代表学生本次作答。\n" + "\n".join(source_notes), "status": "draft", "revision": 1, "created_at": s.now(), "questions": questions, "_practice_set_id": practice["id"], "_bank_question_ids": [item["bank_question_id"] for item in practice["items"]], "_bank_question_map": {q["id"]: item["bank_question_id"] for q, item in zip(questions, practice["items"])}}
        s.put(db, "exams", exam)
        practice["linked_exam_id"] = exam["id"]
        s.put(db, "practice_sets", practice)
        return full_exam(db, exam, ws)
