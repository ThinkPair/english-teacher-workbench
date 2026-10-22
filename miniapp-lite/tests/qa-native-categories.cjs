'use strict';
// Synthetic wx state only. No connection to the official IDE or device storage.
const test=require('node:test'),assert=require('node:assert/strict');
const {KEY,event,snapshot,harness,emptyHarness,personal,addScore,addTag,prepareImport}=require('./qa-native-harness.cjs');
function field(h,key,value){h.page.onFieldInput(event({field:key},value));}
function category(h,name='SYNTHETIC_CATEGORY',total='120'){h.page.onAddCategory();field(h,'name',name);field(h,'total',total);h.page.onSaveForm();return h.page._db.categories.find(c=>c.name===name);}
function student(h,name='SYNTHETIC_STUDENT'){h.page.onAddStudent();field(h,'name',name);field(h,'grade','七年级');h.page.onSaveForm();return h.page._db.students.find(s=>s.name===name);}
test('category setup selects the empty category and a new student continues directly in that archive',()=>{
 const h=emptyHarness(),c=category(h);assert.equal(h.page.data.view,'list');assert.equal(h.page.data.groupKey,c.id);assert.equal(h.page.data.emptyCategory,true);assert.equal(h.page.data.rows.length,0);
 h.page.onAddStudent();assert.equal(h.page.data.form.categoryId,c.id);field(h,'name','SYNTHETIC_NEW');field(h,'grade','七年级');h.page.onSaveForm();assert.equal(h.page.data.view,'detail');assert.equal(h.page.data.detailTab,'scores');assert.equal(h.page.data.student.categoryId,c.id);
 h.page.onAddScore();assert.equal(h.page.data.form.total,120);assert.equal(h.page.data.form.score,'');assert.match(h.page.data.formTotalHint,/默认满分/);
});
test('category write failure preserves the old database and editable form; one retry creates only one category',()=>{
 const h=emptyHarness(),raw=h.store.get(KEY),before=snapshot(h.page._db);h.state.writeFailure=true;category(h);assert.equal(h.store.get(KEY),raw);assert.equal(snapshot(h.page._db),before);assert.equal(h.page.data.form.total,'120');assert.ok(h.page._draftContext);assert.equal(h.page.data.view,'form');
 h.state.writeFailure=false;h.page.onSaveForm();assert.equal(h.page._db.categories.length,1);assert.equal(h.page.data.view,'list');assert.equal(h.page.data.selectedGroup.key,h.page._db.categories[0].id);
});
test('changing category defaults and moving archives preserve saved scores and update only later drafts',()=>{
 const h=emptyHarness(),c=category(h),s=student(h);addScore(h,{total:'120',score:'60'});const old=snapshot(h.page._db.scores);
 h.page.onEditCategory(event({id:c.id}));field(h,'total','150');h.page.onSaveForm();assert.equal(snapshot(h.page._db.scores),old);h.page.onOpenStudent(event({id:s.id}));h.page.onAddScore();assert.equal(h.page.data.form.total,150);
 h.page.onEditRecord(event({kind:'score',id:h.page._db.scores[0].id}));assert.equal(h.page.data.form.total,120);field(h,'note','SYNTHETIC_EDIT_ONLY');h.page.onSaveForm();assert.equal(h.page._db.scores[0].total,120);
 h.page.onEditStudent();h.page.onStudentCategory(event({},'0'));h.page.onSaveForm();assert.equal(h.page._db.students[0].categoryId,'');assert.equal(h.page._db.scores[0].total,120);h.page.onAddScore();assert.equal(h.page.data.form.total,100);assert.match(h.page.data.formTotalHint,/尚未分类/);
});
test('category picker ignores invalid indices and forged orphan references never save',()=>{
 const h=emptyHarness(),c=category(h);h.page.onAddStudent();for(const value of ['-1','1.5','999','NaN'])h.page.onStudentCategory(event({},value));assert.equal(h.page.data.form.categoryId,c.id);
 field(h,'name','SYNTHETIC_BAD_REF');field(h,'grade','八年级');h.page.data.form.categoryId='SYNTHETIC_ORPHAN';const raw=h.store.get(KEY);h.page.onSaveForm();assert.equal(h.store.get(KEY),raw);assert.equal(h.page._db.students.length,0);assert.match(h.page.data.error,/分类/);
});
test('referenced category deletion explains the move requirement and never deletes learner history',async()=>{
 const h=emptyHarness(),c=category(h),s=student(h);addScore(h);const before=h.store.get(KEY);await h.page.onDeleteCategory(event({id:c.id}));assert.equal(h.store.get(KEY),before);assert.equal(h.state.modals.length,0);assert.match(h.page.data.error,/移到|移出/);
 h.page.onOpenStudent(event({id:s.id}));h.page.onEditStudent();h.page.onStudentCategory(event({},'0'));h.page.onSaveForm();const score=snapshot(h.page._db.scores);h.state.confirm=false;await h.page.onDeleteCategory(event({id:c.id}));assert.equal(h.page._db.categories.length,1);
 h.state.confirm=true;await h.page.onDeleteCategory(event({id:c.id}));assert.equal(h.page._db.categories.length,0);assert.equal(h.page._db.students.length,1);assert.equal(snapshot(h.page._db.scores),score);
});
test('a delayed category deletion confirmation cannot overwrite an external change',async()=>{
 const h=emptyHarness(),c=category(h);h.state.deferModal=true;const pending=h.page.onDeleteCategory(event({id:c.id}));const external=h.core.saveCategory(h.page._db,h.parse(snapshot({...c,total:150}))),raw=h.core.exportDatabase(external);h.store.set(KEY,raw);h.resolveModal(true);await pending;assert.equal(h.store.get(KEY),raw);assert.match(h.page.data.error,/没有覆盖/);
});
test('category management navigation retains a dirty score if leaving is canceled',async()=>{
 const h=personal();h.page.onAddScore();field(h,'title','SYNTHETIC_DIRTY');h.state.confirm=false;const context=snapshot(h.page._draftContext);await h.page.onManageCategories();assert.equal(h.page.data.view,'form');assert.equal(h.page.data.form.title,'SYNTHETIC_DIRTY');assert.equal(snapshot(h.page._draftContext),context);
});
test('restoring schema4 previews categories, replaces rather than merges, and exports version4 references',async()=>{
 const h=emptyHarness();category(h);student(h);const incoming=h.core.createDatabase(true);prepareImport(h,incoming);assert.equal(h.page.data.importPreview.categories,3);await h.page.onApplyImport();assert.equal(h.page._db.categories.length,3);assert.equal(h.page._db.students.length,10);await h.page.onExport();const restored=JSON.parse(h.state.clipboard.at(-1));assert.equal(restored.schemaVersion,4);assert.equal(restored.categories.length,3);assert.ok(restored.students.every(s=>restored.categories.some(c=>c.id===s.categoryId)));
});
test('score-to-observation opens a dated evidence draft without saving or inventing a weakness',()=>{
 const h=personal();addScore(h);const score=h.page._db.scores[0],raw=h.store.get(KEY),tagCount=h.page._db.tags.length;h.page.onObserveScore(event({id:score.id}));assert.equal(h.page.data.formKind,'tag');assert.equal(h.page.data.form.type,'weak');assert.equal(h.page.data.form.label,'');assert.equal(h.page._dirty,true);assert.equal(h.store.get(KEY),raw);assert.equal(h.page._db.tags.length,tagCount);
 for(const text of [score.title,score.date,score.score+' / '+score.total])assert.ok(h.page.data.form.note.includes(text));h.page.onSaveForm();assert.equal(h.page._db.tags.length,tagCount);field(h,'label','SYNTHETIC_OBSERVATION');field(h,'note',h.page.data.form.note+'SYNTHETIC_TEACHER_OBSERVATION');h.page.onSaveForm();assert.equal(h.page._db.tags.length,tagCount+1);assert.equal(h.page._db.tags.at(-1).studentId,score.studentId);
});
test('score-observation and retest actions reject foreign archive ids and retest rejects unfinished plans',()=>{
 const h=harness();h.page.onLoad();const a=h.page._db.students[0].id,b=h.page._db.students[1].id,foreignScore=h.page._db.scores.find(s=>s.studentId===b);h.page.onOpenStudent(event({id:a}));const raw=h.store.get(KEY);h.page.onObserveScore(event({id:foreignScore.id}));assert.equal(h.page._draftContext,null);
 const plan=h.page._db.plans[0];h.page.onRetestPlan(event({id:plan.id}));assert.equal(h.page._draftContext,null);h.page.onEditRecord(event({kind:'complete',id:plan.id}));field(h,'result','SYNTHETIC_DONE');h.page.onSaveForm();h.page.onOpenStudent(event({id:b}));const after=h.store.get(KEY);h.page.onRetestPlan(event({id:plan.id}));assert.equal(h.page._draftContext,null);assert.equal(h.store.get(KEY),after);assert.notEqual(after,raw);
});
test('same-evidence pending recommendation reopens the teacher-edited plan instead of creating duplicates',()=>{
 const h=personal();addTag(h);let idea=h.page.data.ideas.find(i=>i.key.startsWith('tag-'));h.page.onUseIdea(event({key:idea.key}));field(h,'body','SYNTHETIC_TEACHER_PLAN');field(h,'dueDate','2026-10-20');h.page.onSaveForm();const id=h.page._db.plans[0].id;
 idea=h.page.data.ideas.find(i=>i.key.startsWith('tag-'));assert.equal(idea.existingPlanId,id);h.page.onUseIdea(event({key:idea.key}));assert.equal(h.page._draftContext.recordId,id);assert.equal(h.page.data.form.body,'SYNTHETIC_TEACHER_PLAN');assert.equal(h.page.data.form.dueDate,'2026-10-20');h.page.onSaveForm();assert.equal(h.page._db.plans.length,1);assert.equal(h.page._db.plans[0].id,id);
});
test('recommendation reuse ignores a forged foreign plan hint and does not match another archive',()=>{
 const h=personal();addTag(h);const idea=h.page.data.ideas.find(i=>i.key.startsWith('tag-'));let db=h.core.saveStudent(h.page._db,h.parse('{"name":"SYNTHETIC_FOREIGN","grade":"七年级","subject":"英语"}'));const other=db.students.at(-1).id;
 db=h.core.savePlan(db,h.parse(snapshot({studentId:other,title:idea.title,body:'SYNTHETIC_FOREIGN_PLAN',sourceEvidence:Array.from(idea.evidence)})));h.page._writeDatabase(db,'archive');const foreign=db.plans[0].id,visible=h.page.data.ideas.find(i=>i.key===idea.key);visible.existingPlanId=foreign;h.page.onUseIdea(event({key:idea.key}));assert.equal(h.page._draftContext.recordId,null);h.page.onSaveForm();assert.equal(h.page._db.plans.length,2);assert.equal(h.page._db.plans.find(p=>p.id===foreign).body,'SYNTHETIC_FOREIGN_PLAN');
});
test('completing a plan neither changes tags nor creates scores; retest starts blank with the current category default',()=>{
 const h=emptyHarness();category(h,'SYNTHETIC_CATEGORY','150');const s=student(h);addTag(h);const idea=h.page.data.ideas.find(i=>i.key.startsWith('tag-'));h.page.onUseIdea(event({key:idea.key}));h.page.onSaveForm();const plan=h.page._db.plans[0],tags=snapshot(h.page._db.tags);
 h.page.onEditRecord(event({kind:'complete',id:plan.id}));field(h,'result','SYNTHETIC_ACTUAL_OBSERVATION');h.page.onSaveForm();assert.equal(h.page._db.plans[0].status,'done');assert.equal(h.page._db.scores.length,0);assert.equal(snapshot(h.page._db.tags),tags);assert.equal(h.page.data.completedPlanId,plan.id);
 const raw=h.store.get(KEY);h.page.onRetestPlan(event({id:plan.id}));assert.equal(h.page.data.form.title,'跟进复测');assert.equal(h.page.data.form.score,'');assert.equal(h.page.data.form.total,150);assert.equal(h.page._draftContext.studentId,s.id);assert.equal(h.store.get(KEY),raw);h.page.onSaveForm();assert.equal(h.store.get(KEY),raw);
 field(h,'score','0');h.page.onSaveForm();assert.equal(h.page._db.scores.length,1);assert.equal(h.page._db.scores[0].score,0);assert.equal(h.page._db.plans[0].result,'SYNTHETIC_ACTUAL_OBSERVATION');assert.equal(snapshot(h.page._db.tags),tags);assert.equal(h.page.data.rows[0].latestTitle,'跟进复测');assert.equal(h.page.data.rows[0].latestDate,h.page._db.scores[0].date);
});
test('a failed retest save keeps the completed plan and retryable empty-score draft intact',()=>{
 const h=personal();h.page.onAddPlan();field(h,'title','SYNTHETIC_PLAN');field(h,'body','SYNTHETIC_BODY');h.page.onSaveForm();const id=h.page._db.plans[0].id;h.page.onEditRecord(event({kind:'complete',id}));field(h,'result','SYNTHETIC_DONE');h.page.onSaveForm();h.page.onRetestPlan(event({id}));field(h,'score','50');const before=h.store.get(KEY);h.state.writeFailure=true;h.page.onSaveForm();assert.equal(h.store.get(KEY),before);assert.equal(h.page._db.scores.length,0);assert.equal(h.page._db.plans[0].status,'done');assert.equal(h.page.data.form.score,'50');assert.ok(h.page._draftContext);
});
