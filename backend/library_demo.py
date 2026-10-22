"""Additive fictional teaching-library fixtures, only in the demo workspace."""
import io

import fitz

from . import storage as s
from .library_media import cleanup_new_material, persist_material, prepare_material


def demo_pdf(title, lines):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((45, 55), title, fontsize=16)
    page.insert_text((45, 86), "FICTIONAL EXAMPLE ONLY - not a real examination paper.", fontsize=11)
    y = 125
    for line in lines:
        if y > 765:
            page = doc.new_page()
            y = 55
        page.insert_text((45, y), line, fontsize=11)
        y += 23
    raw = doc.tobytes()
    doc.close()
    return io.BytesIO(raw)


def ensure_library_demo():
    with s.LOCK:
        with s.transaction("demo") as db:
            if db.execute("SELECT 1 FROM meta WHERE key='library_demo_v02'").fetchone():
                return
        prepared = []
        try:
            specs = [
                ({"kind": "past_paper", "title": "虚构练习卷示例 · 非真实真题", "grade": "七年级", "edition": "示例", "term": "上学期", "unit": "一般现在时", "year": "2026", "region": "虚构地区", "notes": "专供演示选题与复测流程，所有题和来源均为预置虚构样例。"}, "fictional-paper.pdf", ["1. Lily ___ to school every day. A. go B. goes C. going D. went", "2. My father ___ breakfast at seven. A. have B. has C. having D. had", "3. Tom often ___ football after school. (play)", "4. Amy ___ English every morning. (study)", "Reading: Ben lives near school. He walks there every day.", "5. How does Ben go to school? A. By bus B. On foot C. By car D. By bike", "6. There are two ___ in the bag. (book)", "7. Draft example: She ___ a red pen. (have)"]),
                ({"kind": "textbook", "title": "虚构教材片段 · 一般现在时", "grade": "初一", "edition": "示例版", "term": "上学期", "unit": "Unit 1", "year": "2026", "region": "", "notes": "虚构教材片段，仅用于本地检索和教学流程演示。"}, "fictional-textbook.pdf", ["Grammar: Simple present / third-person singular", "We add -s or -es after he, she, it in the simple present.", "A. Change the subject: I like apples. -> She ___ apples.", "B. He ___ TV every evening. (watch)"]),
                ({"kind": "past_paper", "title": "虚构五年级练习卷 · 非真实真题", "grade": "五年级", "edition": "示例", "term": "上学期", "unit": "日常表达", "year": "2026", "region": "虚构地区", "notes": "用于演示年级筛选，不是真实学校试卷。"}, "fictional-grade5.pdf", ["1. He ___ a new bag. (have)", "2. I have three ___. (pencil)"]),
            ]
            for metadata, filename, lines in specs:
                prepared.append(prepare_material("demo", metadata, [(filename, demo_pdf("TEACHING MATERIAL DEMO", lines))]))
            with s.transaction("demo") as db:
                for material in prepared:
                    persist_material(db, material)
                first, textbook, younger = [p[0]["id"] for p in prepared]
                rows = [
                    (first, "1", "Lily ___ to school every day.", ["A. go", "B. goes", "C. going", "D. went"], "B. goes", ["第三人称单数"], "confirmed", ""),
                    (first, "2", "My father ___ breakfast at seven.", ["A. have", "B. has", "C. having", "D. had"], "B. has", ["三单", "一般现在时"], "confirmed", ""),
                    (first, "3", "Tom often ___ football after school. (play)", [], "plays", ["第三人称单数"], "confirmed", ""),
                    (first, "4", "Amy ___ English every morning. (study)", [], "studies", ["第三人称单数", "词尾变化"], "confirmed", ""),
                    (first, "5", "How does Ben go to school?", ["A. By bus", "B. On foot", "C. By car", "D. By bike"], "B. On foot", ["阅读理解"], "confirmed", "Ben lives near school. He walks there every day."),
                    (first, "6", "There are two ___ in the bag. (book)", [], "books", ["名词复数"], "confirmed", ""),
                    (first, "7", "She ___ a red pen. (have)", [], "", ["三单"], "draft", ""),
                    (textbook, "A", "Change the subject: I like apples. → She ___ apples.", [], "likes", ["一般现在时", "第三人称单数"], "confirmed", "We add -s or -es after he, she, it in the simple present."),
                    (textbook, "B", "He ___ TV every evening. (watch)", [], "watches", ["三单"], "confirmed", ""),
                    (younger, "1", "He ___ a new bag. (have)", [], "has", ["三单"], "confirmed", ""),
                    (younger, "2", "I have three ___. (pencil)", [], "pencils", ["名词复数"], "confirmed", ""),
                ]
                for document_id, number, stem, options, answer, tags, status, context in rows:
                    question = {"id": s.uid(), "document_id": document_id, "source_page": 1, "source_end_page": 1, "number": number, "context": context, "stem": stem, "options": options, "answer": answer, "explanation": "预置虚构示例，请结合原题要求讲解。", "knowledge_tags": tags, "difficulty": "easy", "max_score": 1, "status": status, "revision": 1, "created_at": s.now()}
                    s.put(db, "bank_questions", question)
                db.execute("INSERT INTO meta(key,value) VALUES('library_demo_v02','1')")
        except BaseException:
            for material in prepared:
                cleanup_new_material("demo", material[0]["id"])
            raise
