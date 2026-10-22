# First-version contract

Base /api; UTF-8 JSON, errors {detail:string}. Every data endpoint uses header `X-Workspace: demo|personal`, default personal. File URLs include `?workspace=demo|personal` for browser image/PDF elements. Record IDs and student data never cross workspaces. Model settings/API key belong to the single teacher and are shared across both spaces in ROOT/settings.json; backups exclude settings. One local teacher; students are records, not accounts. All IDs opaque UUID strings. Dates YYYY-MM-DD.

## Common types
- Student: {id,name,grade,school,notes,target_score:number|null,created_at}. GET student adds exams:ExamSummary[], plans:Plan[], weak_points:{tag,count,evidence:string[]}[], summary:string. Never derive these from unconfirmed exams. List students adds exam_count, latest_score:number|null, latest_full_score:number|null, latest_exam_date:string|null, pending_count, weak_tags:string[].
- Exam: {id,student_id,title,exam_date,kind:'school'|'practice',full_score:number,school_score:number|null,notes,status:'draft'|'review'|'confirmed',revision:number,created_at,questions:Question[],attachments:Attachment[]}.
- ExamSummary: Exam fields except questions/attachments, plus question_count,pending_count.
- Question: {id,number:string,stem,student_answer,correct_answer,school_score:number|null,max_score:number,ai_score:number|null,knowledge_tag,error_reason,teacher_note,needs_review:boolean,reviewed:boolean,source_page:number,source_attachment_id:string|null}. Empty text permitted; max_score >=0. Teacher-entered school score is authoritative; ai_score is suggestion only.
- Attachment: {id,filename,mime,size,url,page_urls:string[]} (all browser URLs carry workspace). Images page_urls=[url]; PDF pages rendered as PNG with bounded page count. Original remains downloadable.
- Plan: {id,student_id,exam_id:string|null,title,content:string,source:'ai'|'teacher',source_revision:number|null,stale:boolean,created_at,lesson_note:string,review_date:string|null,review_result:string}. AI plans only from confirmed records; teacher content editable.
- Job: {id,status:'queued'|'running'|'succeeded'|'failed',kind:'recognize'|'plan',message,result:object|null}. Interrupted jobs fail on restart. Never simulate successful AI.

## Endpoints
GET /health -> {ok:true,app:'english-teacher',version:'0.1.0'}
GET /bootstrap -> {workspace,students:StudentList[],stats:{students,confirmed_exams,pending_exams,plans},ai:{configured:boolean,model:string,vision_model:string},recent_exams:ExamSummary[]}. demo lazily seeds explicitly fictional fixtures and sample PDF; personal stays empty.
GET /students -> StudentList[]
POST /students {name,grade,school,notes?,target_score?} -> Student
GET /students/{id} -> Student detail above
PATCH /students/{id} fields -> Student
POST /students/{id}/exams {title,exam_date,kind,full_score,school_score?,notes?} -> Exam
GET /exams/{id} -> Exam
PUT /exams/{id} {revision,title,exam_date,kind,full_score,school_score,notes,questions:Question[]} -> Exam. 409 stale revision. On any edit of confirmed data reopen review, increment revision and mark associated plans stale. Atomic write. Invalid scores > max rejected; total question score need not equal reported school total (partial input allowed).
POST /exams/{id}/attachments multipart files[] -> Exam; up to 8 files, 20 MiB/file, jpg/jpeg/png/webp/pdf. Validate bytes; no HTML/SVG uploads. Increment revision and reopen review if changed.
GET /files/{id}?workspace=... -> original
GET /files/{id}/pages/{page}?workspace=... -> PDF PNG, page 1-based
POST /exams/{id}/recognize {} -> Job. Require configured model, attachments, nonconfirmed state. Process selected student/exam only, vision model and strict parsed structured JSON; store draft questions but no confirmed history. Recognizer must preserve school_score if teacher has already entered it; bad JSON/request failures mark job failed. Prevent stale jobs overwriting newer revisions.
POST /exams/{id}/confirm {revision} -> Exam. Require known school_score for both kinds (school original score / teacher-confirmed practice score); all questions reviewed; at least 1 question. Mark confirmed; plans from other revisions stale. Score mismatches should be visible to user but partial paper allowed. Reconfirmation after corrected data accepted.
GET /jobs/{id} -> Job
POST /students/{id}/plans {exam_id?:string} -> Job. Require confirmed exam(s), configured model. Generate Chinese actionable 45-minute English lesson plan with source question numbers and distinguish observation vs possible causes. No cross-student history. Save Plan.
POST /students/{id}/plans/manual {exam_id?,title,content,lesson_note?,review_date?,review_result?} -> Plan (all fields saved atomically; invalid date creates no record)
PATCH /plans/{id} {title?,content?,lesson_note?,review_date?,review_result?} -> Plan
GET /settings -> {base_url,model,vision_model,has_api_key,timeout_seconds}. Never return key.
PUT /settings {base_url,model,vision_model,api_key?:string,clear_api_key?:boolean} -> safe Settings. Empty key keeps existing. HTTPS provider endpoint, HTTP only loopback. Supports OpenAI-compatible chat/completions appended to base URL. Default https://api.deepseek.com, text and vision model deepseek-flash, no key until teacher configures. Defaults verified against provider vision docs on 2026-10-04.
POST /settings/test {} -> {ok:boolean,message:string} actual small text request; does not claim vision validated. Secrets redacted from errors.
GET /backup -> ZIP of current workspace DB and original attachments only, no settings/API keys. Use SQLite backup API for consistent snapshot.

## UX and errors
Frontend may provide manual entry if AI unconfigured. Visible demo badge must persist; do not silently seed personal workspace. Demo results clearly fictional, never pretend to call AI. Switch between demo and personal in sidebar. Setup panel lets operator configure service, model names, secret. It is OK to show a pending key requirement; never fake OCR.
App is Chinese, working surface, minimal teacher jargon. Main flow student list/detail -> upload/create -> paper review (original left, editable results right) -> confirm -> plan. Show save/unsaved/error status, loading/disabled buttons. No automatic requests that transmit photos on upload; only explicit recognize button. Plain source content, no unsafe HTML injection.
