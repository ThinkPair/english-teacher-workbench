import fitz

from . import storage as s
from .media import validate_and_store


def ensure_demo():
    with s.transaction("demo") as db:
        if db.execute("SELECT 1 FROM meta WHERE key='demo_seeded'").fetchone():
            return
        for name, grade, scores in (("林小禾（虚构）", "七年级", [71, 78, 84]), ("陈一诺（虚构）", "五年级", [82, 86])):
            student = {"id": s.uid(), "name": name, "grade": grade, "school": "示例学校（虚构）", "notes": "仅供体验的虚构学生与虚构成绩，不代表真实教学效果。", "target_score": 90, "created_at": s.now()}
            s.put(db, "students", student)
            for index, score in enumerate(scores):
                exam = {"id": s.uid(), "student_id": student["id"], "title": f"虚构英语单元测验 {index + 1}", "exam_date": f"2026-09-{7 + index * 7:02d}", "kind": "school", "full_score": 100, "school_score": score, "notes": "虚构示例，仅录入两道代表题，单题分数不等于学校总分。", "status": "confirmed", "revision": 1, "created_at": s.now(), "questions": []}
                exam["questions"] = [question("1", "She ___ to school every day. (go)", "go", "goes", "一般现在时 · 第三人称单数", 0, True), question("2", "There are two ___ on the desk. (book)", "books", "books", "名词复数", 5, True)]
                s.put(db, "exams", exam)
            if name.startswith("林"):
                exam = {"id": s.uid(), "student_id": student["id"], "title": "待校对示例 · 单元复测（虚构）", "exam_date": "2026-10-01", "kind": "school", "full_score": 100, "school_score": 86, "notes": "此记录是预置虚构示例，不是 AI 实时识别结果。请体验原卷对照、修改、确认。", "status": "review", "revision": 1, "created_at": s.now(), "questions": []}
                exam["questions"] = [question("1", "He ___ football every Sunday. (play)", "play", "plays", "一般现在时 · 第三人称单数", 0, False), question("2", "I have three ___. (pencil)", "pencils", "pencils", "名词复数", 5, False)]
                s.put(db, "exams", exam)
                doc = fitz.open()
                page = doc.new_page()
                page.insert_text((55, 65), "FICTIONAL DEMO - ENGLISH PAPER", fontsize=19)
                page.insert_text((55, 100), "Fictional student. Example only. Not an AI recognition result.", fontsize=11)
                page.insert_text((55, 150), "School reported total: 86 / 100 (only two questions shown)", fontsize=12)
                page.insert_text((55, 220), "1. He ___ football every Sunday. (play)", fontsize=14)
                page.insert_text((75, 250), "Student answer: play", fontsize=14)
                page.insert_text((75, 278), "Teacher: 0 / 5   Correct: plays", fontsize=12, color=(0.8, 0.1, 0.1))
                page.insert_text((55, 345), "2. I have three ___. (pencil)", fontsize=14)
                page.insert_text((75, 375), "Student answer: pencils", fontsize=14)
                page.insert_text((75, 403), "Teacher: 5 / 5", fontsize=12, color=(0.8, 0.1, 0.1))
                raw = doc.tobytes()
                doc.close()
                attachment = validate_and_store("demo", exam["id"], "fictional-demo-paper.pdf", raw)
                s.put(db, "attachments", attachment)
                for q in exam["questions"]:
                    q["source_attachment_id"] = attachment["id"]
                s.put(db, "exams", exam)
                plan = {"id": s.uid(), "student_id": student["id"], "exam_id": None, "title": "虚构示例 · 一般现在时巩固课", "content": "这是预置的虚构示例教案，不是 AI 生成结果。\n\n0–5 分钟：口头复测 go/goes、play/plays。\n5–15 分钟：对比 I play 与 He plays，圈出主语。\n15–30 分钟：完成 6 道主语替换题，每题解释词尾变化。\n30–40 分钟：用自己的日常活动写 3 句话。\n40–45 分钟：出口测 3 题，记录是否独立完成。\n\n依据：虚构英语单元测验第 1 题。可能原因需通过复测验证。", "source": "teacher", "source_revision": None, "stale": False, "created_at": s.now(), "lesson_note": "", "review_date": None, "review_result": "", "_source_revisions": {}}
                s.put(db, "plans", plan)
        db.execute("INSERT INTO meta(key,value) VALUES('demo_seeded','1')")


def question(number, stem, answer, correct, tag, score, reviewed):
    return {"id": s.uid(), "number": number, "stem": stem, "student_answer": answer, "correct_answer": correct, "school_score": score, "max_score": 5, "ai_score": None, "knowledge_tag": tag, "error_reason": "词尾形式与主语不一致；是否掌握规则需复测。" if score == 0 else "", "teacher_note": "虚构示例", "needs_review": not reviewed, "reviewed": reviewed, "source_page": 1, "source_attachment_id": None}
