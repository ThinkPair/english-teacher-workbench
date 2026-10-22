"""Local-only material ingest and on-demand previews; importing never calls AI."""
import io
import shutil
from pathlib import Path

import fitz
from fastapi import HTTPException
from PIL import Image, ImageOps

from . import storage as s

MAX_MATERIAL_BYTES = 100 * 1024 * 1024
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PAGES = 500
PAGE_TEXT_LIMIT = 100000


def library_root(ws):
    root = s.directory(ws) / "library"
    root.mkdir(exist_ok=True)
    return root.resolve()


def cleanup_new_material(ws, document_id):
    root = library_root(ws)
    candidate = (root / document_id).resolve()
    if candidate.parent != root or candidate == root:
        raise ValueError("invalid material cleanup target")
    if candidate.exists():
        shutil.rmtree(candidate)


def file_path(ws, record):
    root = library_root(ws)
    path = (root / record["document_id"] / record["_filename"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(404, "资料原件不存在")
    return path


def prepare_material(ws, metadata, uploads):
    """Validate all originals before starting a DB write. `uploads` are binary streams."""
    if not 1 <= len(uploads) <= 30:
        raise HTTPException(400, "一份资料需 1–30 个 PDF 或照片文件")
    document_id = s.uid()
    folder = library_root(ws) / document_id
    folder.mkdir()
    files, pages = [], []
    total_size = 0
    try:
        for filename, stream in uploads:
            name = Path(filename.replace("\\", "/")).name[:200]
            suffix = Path(name).suffix.lower()
            if suffix not in (".pdf", ".png", ".jpg", ".jpeg", ".webp"):
                raise HTTPException(400, "资料只接受真实 PDF、JPG、PNG、WebP")
            file_id = s.uid()
            dest = folder / f"{file_id}.original"
            size = 0
            stream.seek(0)
            with dest.open("wb") as target:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    total_size += len(chunk)
                    if total_size > MAX_MATERIAL_BYTES or (suffix != ".pdf" and size > MAX_IMAGE_BYTES):
                        raise HTTPException(400, "资料总量最多 100 MiB，单张照片最多 20 MiB")
                    target.write(chunk)
            if not size:
                raise HTTPException(400, "资料中包含空文件")
            page_start = len(pages) + 1
            if suffix == ".pdf":
                with dest.open("rb") as raw:
                    if not raw.read(5).startswith(b"%PDF-"):
                        raise HTTPException(400, "PDF 文件内容无效")
                try:
                    # Opening malformed PDFs by path can leave MuPDF's failed-open
                    # handle alive on Windows and prevent atomic batch cleanup.
                    # A bounded byte stream keeps that native handle off our files.
                    with fitz.open(stream=dest.read_bytes(), filetype="pdf") as pdf:
                        if pdf.is_encrypted or pdf.page_count < 1:
                            raise HTTPException(400, "不支持加密或没有页面的 PDF")
                        page_count = pdf.page_count
                        if len(pages) + page_count > MAX_PAGES:
                            raise HTTPException(400, "一份资料最多 500 页，请拆分后上传")
                        for local in range(page_count):
                            text = pdf[local].get_text("text")
                            pages.append({"document_id": document_id, "page": len(pages) + 1, "file_id": file_id, "file_page": local + 1, "text": text[:PAGE_TEXT_LIMIT], "text_truncated": len(text) > PAGE_TEXT_LIMIT})
                except HTTPException:
                    raise
                except Exception:
                    raise HTTPException(400, "PDF 损坏或无法完整读取，整份资料未导入") from None
                mime = "application/pdf"
            else:
                try:
                    with Image.open(dest) as image:
                        if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > 30_000_000:
                            raise ValueError()
                        mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image.format]
                        image.verify()
                except Exception:
                    raise HTTPException(400, "照片损坏、格式无效或超过 3000 万像素，整份资料未导入") from None
                page_count = 1
                pages.append({"document_id": document_id, "page": len(pages) + 1, "file_id": file_id, "file_page": 1, "text": "", "text_truncated": False})
                if len(pages) > MAX_PAGES:
                    raise HTTPException(400, "一份资料最多 500 页")
            files.append({"id": file_id, "document_id": document_id, "filename": name, "mime": mime, "size": size, "page_start": page_start, "page_count": page_count, "_filename": dest.name})
        document = {"id": document_id, **metadata, "revision": 1, "created_at": s.now(), "page_count": len(pages), "text_page_count": sum(bool(p["text"].strip()) for p in pages), "size": total_size}
        return document, files, pages
    except BaseException:
        cleanup_new_material(ws, document_id)
        raise


def persist_material(db, prepared):
    document, files, pages = prepared
    s.put(db, "documents", document)
    for file in files:
        s.put(db, "library_files", file)
    db.executemany("INSERT INTO document_pages(document_id,page,file_id,file_page,text,text_truncated) VALUES(?,?,?,?,?,?)", [(p["document_id"], p["page"], p["file_id"], p["file_page"], p["text"], int(p["text_truncated"])) for p in pages])


def page_url(document_id, page, ws):
    return f"/api/library/documents/{document_id}/pages/{page}/image?workspace={ws}"


def document_public(db, document, ws):
    files = []
    for record in sorted(s.records(db, "library_files", "document_id", document["id"]), key=lambda f: f["page_start"]):
        files.append({k: record[k] for k in ("id", "filename", "mime", "size", "page_start", "page_count")})
        files[-1]["url"] = f"/api/library/files/{record['id']}?workspace={ws}"
    questions = s.records(db, "bank_questions", "document_id", document["id"])
    return {**s.safe_record(document), "files": files, "question_count": len(questions), "confirmed_question_count": sum(q["status"] == "confirmed" for q in questions)}


def preview_path(ws, document_id, page):
    with s.transaction(ws) as db:
        document = s.get(db, "documents", document_id)
        if not 1 <= page <= document["page_count"]:
            raise HTTPException(404, "资料页码不存在")
        row = db.execute("SELECT * FROM document_pages WHERE document_id=? AND page=?", (document_id, page)).fetchone()
        if not row:
            raise HTTPException(404, "资料页面索引不存在")
        record = s.get(db, "library_files", row["file_id"])
    original = file_path(ws, record)
    if record["mime"] != "application/pdf":
        return original, record["mime"]
    cache = original.parent / "previews"
    dest = cache / f"page-{page}.png"
    with s.LOCK:
        if not dest.exists():
            cache.mkdir(exist_ok=True)
            try:
                with fitz.open(original) as pdf:
                    pg = pdf[row["file_page"] - 1]
                    scale = min(1.7, 1800 / max(pg.rect.width, pg.rect.height, 1))
                    pg.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).save(dest)
            except Exception:
                raise HTTPException(400, "本页预览生成失败，请检查原文件") from None
    return dest, "image/png"


def model_page(ws, document_id, page):
    path, _ = preview_path(ws, document_id, page)
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((2000, 2000))
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=88)
        return output.getvalue()
