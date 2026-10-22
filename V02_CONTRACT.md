# v0.2 教材、真题库与针对性练习接口合同（冻结）

保留 v0.1 API。全套新数据按 X-Workspace 隔离，每个空间的资料库供老师给不同学生复用。设置仍共享。已有 SQLite 原位增表，不清空数据。版本 0.2.0。所有文本 plain text，禁止渲染模型 HTML。日期 ISO。

## Materials

Document: {id,kind:'textbook'|'past_paper',title,grade,edition,term,unit,year,region,notes,revision:number,created_at,page_count:number,text_page_count:number,size:number,files:LibraryFile[],question_count:number,confirmed_question_count:number}
LibraryFile: {id,filename,mime,size,page_start:number,page_count:number,url:string}. All library URLs include ?workspace=demo|personal. Global document pages are 1-based and follow upload file order. Preserve complete file originals.

- GET /api/library/documents?kind=&grade=&q= -> Document[] (title and metadata filter; missing parameters all).
- POST /api/library/documents multipart title,kind,grade?,edition?,term?,unit?,year?,region?,notes?, **files** repeated -> Document. A document accepts PDF and/or multiple JPG/PNG/WebP photos, max 30 files / 100 MiB total / 500 total pages. Each image max 20MiB and 30M pixels. Validate actual bytes; encrypted/broken PDF rejected atomically; no orphan partial document. A one-file field file may optionally be accepted for convenience but frontend uses files. No AI request on import. Text PDF locally extracts bounded searchable page text; images/scans explicitly indicate no text. PDF previews are lazy, not 500 images rendered during upload.
- GET /api/library/documents/{id} -> Document.
- PATCH /api/library/documents/{id} {revision,title?,kind?,grade?,edition?,term?,unit?,year?,region?,notes?} -> Document (409 old revision).
- GET /api/library/documents/{id}/pages?page=1&page_size=20 -> {total:number,items:[{page:number,text_excerpt:string,has_text:boolean,preview_url:string}]}. Frontend may build preview URLs only as supplied here. For specific page use page=N&page_size=1.
- GET /api/library/documents/{id}/pages/{page}/image?workspace=... -> image.
- GET /api/library/files/{id}?workspace=... -> original.
- GET /api/library/search?q=&document_id= -> {items:[{document_id,title,page,snippet,preview_url}],total:number}. Search stored local page text, q required, bounded results. No claims of scanned-photo OCR when not performed.

## Bank questions

BankQuestion: {id,document_id,source_page:number,source_end_page:number,number:string,context:string,stem:string,options:string[],answer:string,explanation:string,knowledge_tags:string[],difficulty:'easy'|'medium'|'hard',max_score:number,status:'draft'|'confirmed',revision:number,created_at}. context preserves a full shared reading passage/dialogue/listening transcript if supplied; do not discard it when splitting questions. source_end_page >= source_page and valid within document. Unknown max_score defaults 1 and remains editable. Confirmation requires nonblank stem/answer, >=1 knowledge tag, valid source pages, max_score>0. Readable options retain labels A/B/C/D. No extracted student answer stored in bank.

- GET /api/bank/questions?document_id=&status=&q= -> BankQuestion[].
- POST /api/bank/questions {document_id,source_page,source_end_page?,number,context?,stem,options?,answer?,explanation?,knowledge_tags?,difficulty?,max_score?} -> BankQuestion always draft.
- PUT /api/bank/questions/{id} {revision,source_page,source_end_page,number,context,stem,options,answer,explanation,knowledge_tags,difficulty,max_score} -> BankQuestion; revision increments; edits reopen draft. Document immutable.
- POST /api/bank/questions/{id}/confirm {revision} -> confirmed BankQuestion.
- POST /api/library/documents/{id}/extract {revision,pages:number[]} -> Job kind='extract'. Unique 1–8 selected pages, valid within current document, configured vision API required; send only selected pages. Full prompt protects context/shared passages and page references; output structured JSON validated. All returned questions remain draft. No empty/mock successful extraction. Existing document+source_page+number questions skipped (teacher edits never overwritten); report added/skipped. Stale document revision/interrupted job cannot mutate current data. Concurrent duplicate extraction prevented/transactional dedup.
- GET /api/jobs/{id} remains existing persisted status. Result extract {document_id,added,skipped}.

## Personalized practice

- GET /api/students/{id}/recommendations?count=8&kind=past_paper&include_other_grades=false -> {student_id,weak_points:[{tag,count,evidence:string[]}],items:[{question:BankQuestion,document:Document,matched_tags:string[],evidence:string[],reason:string}],requested:number,available:number,shortage:number,message:string}.
- Only this student's confirmed school papers and teacher-confirmed lost marks establish automatic target weaknesses; unreviewed or AI-only marks never count. Match confirmed bank tags with explicit normalized aliases (e.g. 三单/第三人称单数) and explain deterministic results; never invent real-paper questions or infer mastery. Default kind=past_paper, optional all includes textbook exercises. Default student known grade/synonyms only; optional include_other_grades broadens with visible reason. Missing student grade may use all with explicit warning. Exclude bank questions already in completed (confirmed) practice exams; generated/uncompleted worksheets aren't evidence of completed practice. If insufficient, return true shortage, never pad with unrelated or AI-generated content. Count 1–30. Preserve full passages and options in question candidates.

PracticeSet: {id,student_id,title,created_at,items:[{bank_question_id,question:BankQuestion,document_title,document_kind,grade,source_url,matched_tags:string[],evidence:string[],reason:string}],linked_exam_id:string|null,linked_exam:ExamSummary|null}. Items are immutable snapshots captured at save, so later bank edits do not rewrite a printed assignment. No unrelated students' evidence. Bank question source_url is valid original-page URL. Title no blank. AI-generated variations are explicitly out of this iteration.

- POST /api/students/{id}/practice-sets {title,question_ids:string[]} -> PracticeSet. 1–30 unique confirmed bank question IDs; derive reasons server-side from current student; reject other-space/draft IDs. No caller-supplied student, source, answer or scoring data trusted.
- GET /api/students/{id}/practice-sets -> PracticeSet[].
- GET /api/practice-sets/{id} -> PracticeSet.
- POST /api/practice-sets/{id}/to-exam {} -> Exam. Idempotent: repeat returns same exam. Build new practice-kind exam from snapshot, all student_answer='', school_score=null, ai_score=null, reviewed=false; school_score total null; full_score=sum(max_score). Keep passage/options in stem and tags in knowledge_tag. Source is retained in exam notes and internal bank_question/set mapping; do not mislabel library sources as student-uploaded attachments. Then existing edit/confirmation/lesson flow records actual retest result. Selecting/printing is not proof of completion.

## Existing integrations

- Read-only Exam.question_sources: Record<exam_question_id,{document_title,source_page,source_end_page,url}> is derived from the immutable practice snapshot and internal question mapping. Rebuild URLs in the active workspace; require matching student and linked exam. Deleted/unmapped/manual questions receive no inferred source. This field is not accepted in ExamSave or Question input. Exam review opens the actual library original when available, rather than attempting to treat it as an exam attachment.

- Student detail includes practice_sets:PracticeSet[] (or frontend calls list). School score trend/latest must exclude kind=practice; retests remain visible in exam list, never replace latest school exam score.
- Backup ZIP includes consistent DB snapshot, exam original files and all library original files, excludes preview caches/API settings. No deletion endpoints necessary this iteration.
- Demo-only seed additive/idempotent even for v0.1 DB: explicitly fictional textbook plus fictional practice-paper source and confirmed/draft questions across tags/grades so UI can demonstrate ranking/shortage. Never call demo materials real external past papers. Personal data remains untouched.

## UX

Sidebar 教材与真题库. Metadata filter + material import; document page preview, keyword-page search, questions list, 手工录题, 选择页码交给AI拆题, draft review and confirm. Clear hint: storage alone isn't searchable question bank; teacher must confirm split questions. PDF/photo format both supported. Student page 针对性练习: recommended source questions + matching evidence + shortage, adjustable count/grade/type scope, selected questions save. Worksheet: student version contains questions/passages/options/writing space only; answer/explanation view or teacher print explicitly separate. Print route/function may add CSS @media print but must not leak answer nodes in student print; no source answer photo printed by default. Return to student/open source, then 开始记录复测 creates/reopens practice exam. Unsaved guards, busy forms disabled, async responses cannot cross student/workspace. No real API call during automated acceptance.
