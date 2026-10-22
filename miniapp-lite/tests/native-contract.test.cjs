'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {KEY,PERSONAL,DEMO,event,snapshot,harness,emptyHarness,personal,addScore,addTag,prepareImport,legacy}=require('./qa-native-harness.cjs');

test('native starts one archive with ten labeled examples, without exposing a space switch',()=>{
 const h=harness();assert.equal(Object.keys(h.app).length,0);h.page.onLoad();
 assert.equal(h.page._space,'archive');assert.equal(h.page._db.students.length,10);assert.ok(h.page._db.students.every(s=>s.isExample===true));assert.equal(typeof h.page.onSwitchSpace,'undefined');
 assert.ok(h.store.has(KEY));assert.equal(h.store.has(PERSONAL),false);assert.equal(h.store.has(DEMO),false);
});
test('new student requires name and grade, defaults to English without subject input, and is not an example',()=>{
 const h=emptyHarness();h.page.onAddStudent();h.page.onFieldInput(event({field:'name'},'SYNTHETIC_NEW'));h.page.onSaveForm();assert.equal(h.page._db.students.length,0);assert.match(h.page.data.error,/年级|学科/);
 h.page.onFieldInput(event({field:'grade'},'七年级'));h.page.onSaveForm();assert.equal(h.page._db.students.length,1);assert.equal(h.page._db.students[0].subject,'英语');assert.equal(h.page._db.students[0].isExample,false);assert.equal(h.page.data.rows[0].id,h.page._db.students[0].id);
});
test('hidden legacy class survives editing; className is not a writable native form field',()=>{
 const h=harness({[PERSONAL]:snapshot(legacy())});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));h.page.onEditStudent();
 h.page.onFieldInput(event({field:'className'},'SYNTHETIC_FORGED_CLASS'));h.page.onFieldInput(event({field:'note'},'SYNTHETIC_EDIT'));h.page.onSaveForm();
 assert.equal(h.page._db.students[0].className,'SYNTHETIC_HIDDEN');assert.equal(h.page._db.students[0].subject,'数学');assert.equal(h.page._db.students[0].isExample,false);
});
test('write failure preserves old database and editable draft; retry adds exactly one record',()=>{
 const h=personal(),before=snapshot(h.page._db),disk=h.store.get(KEY),revision=h.page._db.revision;
 h.state.writeFailure=true;addScore(h,{score:'0'});assert.equal(snapshot(h.page._db),before);assert.equal(h.store.get(KEY),disk);assert.equal(h.page.data.view,'form');assert.ok(h.page._draftContext);assert.equal(h.page.data.form.score,'0');assert.match(h.page.data.error,/保存失败/);
 h.state.writeFailure=false;h.page.onSaveForm();assert.equal(h.page._db.scores.length,1);assert.equal(h.page._db.scores[0].score,0);assert.equal(h.page._db.scores[0].subject,'英语');assert.equal(h.page._db.revision,revision+1);
});
test('blank numbers and impossible dates are rejected while the draft stays editable',()=>{
 const h=personal();h.page.onAddScore();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_DATE'));h.page.onFieldInput(event({field:'total'},'100'));h.page.onSaveForm();assert.equal(h.page._db.scores.length,0);
 h.page.onFieldInput(event({field:'score'},'50'));h.page.onFieldInput(event({field:'date'},'2026-02-30'));h.page.onSaveForm();assert.match(h.page.data.error,/日期/);assert.equal(h.page.data.form.date,'2026-02-30');
 h.page.onFieldInput(event({field:'date'},'2026-02-28'));h.page.onSaveForm();assert.equal(h.page._db.scores[0].date,'2026-02-28');
});
test('draft context overrides forged ids and external disk changes block stale edits',()=>{
 const h=personal();addScore(h);const original=h.page._db.scores[0];h.page.onEditRecord(event({kind:'score',id:original.id}));h.page.data.form.id='FORGED';h.page.data.form.studentId='FORGED';h.page.onFieldInput(event({field:'score'},'43'));h.page.onSaveForm();
 assert.equal(h.page._db.scores[0].id,original.id);assert.equal(h.page._db.scores[0].studentId,original.studentId);
 h.page.onEditRecord(event({kind:'score',id:original.id}));h.page.onFieldInput(event({field:'score'},'44'));
 const external=h.core.saveScore(h.page._db,h.parse(snapshot({...h.page._db.scores[0],score:45})));h.store.set(KEY,h.core.exportDatabase(external));h.page.onSaveForm();
 assert.equal(h.page._db.scores[0].score,43);assert.equal(JSON.parse(h.store.get(KEY)).scores[0].score,45);assert.equal(h.page.data.form.score,'44');assert.match(h.page.data.error,/没有覆盖/);
});
test('record edit and delete handlers cannot target a different archive',async()=>{
 const h=harness();h.page.onLoad();const a=h.page._db.students[0].id,b=h.page._db.students[1].id,foreign=h.page._db.scores.find(s=>s.studentId===b),before=h.store.get(KEY);
 h.page.onOpenStudent(event({id:a}));h.page.onEditRecord(event({kind:'score',id:foreign.id}));assert.equal(h.page._draftContext,null);
 await h.page.onDeleteRecord(event({kind:'score',id:foreign.id}));assert.equal(h.store.get(KEY),before);assert.equal(h.state.modals.length,0);
});
test('same-archive tag conflict remains enforced when restoring a resolved weak tag',async()=>{
 const h=personal();addTag(h);const weak=h.page._db.tags[0].id;await h.page.onToggleTag(event({id:weak}));assert.equal(h.page._db.tags[0].status,'resolved');
 h.page.onEditRecord(event({kind:'tag',id:weak}));h.page.onFieldInput(event({field:'note'},'SYNTHETIC_RECHECK'));h.page.onSaveForm();assert.equal(h.page._db.tags[0].status,'resolved');addTag(h,'strong');
 const before=snapshot(h.page._db);await h.page.onToggleTag(event({id:weak}));assert.equal(snapshot(h.page._db),before);assert.match(h.page.data.error,/薄弱和强项/);
});
test('advice stays an editable draft, completion and reopening preserve its evidence and result',async()=>{
 const h=personal();addTag(h);const idea=h.page.data.ideas.find(i=>i.key.startsWith('tag-'));h.page.onUseIdea(event({key:idea.key}));assert.equal(h.page._db.plans.length,0);assert.equal(h.page._dirty,true);
 h.page.onFieldInput(event({field:'title'},'SYNTHETIC_FOLLOWUP'));h.page.onFieldInput(event({field:'dueDate'},'2026-10-09'));h.page.onClearDueDate();h.page.onSaveForm();
 const plan=h.page._db.plans[0];assert.equal(plan.dueDate,'');assert.equal(snapshot(plan.sourceEvidence),snapshot(idea.evidence));
 h.page.onEditRecord(event({kind:'complete',id:plan.id}));h.page.onFieldInput(event({field:'result'},'SYNTHETIC_ACTUAL_RESULT'));h.page.onSaveForm();assert.equal(h.page._db.plans[0].status,'done');
 await h.page.onReopenPlan(event({id:plan.id}));assert.equal(h.page._db.plans[0].status,'todo');assert.equal(h.page._db.plans[0].result,'SYNTHETIC_ACTUAL_RESULT');
});
test('cascade deletion requires confirmation, and a write failure leaves all associated data',async()=>{
 const h=personal();addScore(h);addTag(h);h.page.onAddPlan();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_PLAN'));h.page.onFieldInput(event({field:'body'},'SYNTHETIC_BODY'));h.page.onSaveForm();const before=snapshot(h.page._db);
 h.state.confirm=false;await h.page.onDeleteStudent();assert.equal(snapshot(h.page._db),before);h.state.confirm=true;h.state.writeFailure=true;await h.page.onDeleteStudent();assert.equal(snapshot(h.page._db),before);
 h.state.writeFailure=false;await h.page.onDeleteStudent();for(const table of ['students','scores','tags','plans'])assert.equal(h.page._db[table].length,0);
});
test('restore requires format check, replacement checkbox and confirmation; uses current revision',async()=>{
 const h=personal();addScore(h);const revision=h.page._db.revision,backup=h.core.createDatabase(false);backup.revision=99999;
 h.page.onImportInput(event({},h.core.exportDatabase(backup)));await h.page.onApplyImport();assert.equal(h.page._db.students.length,1);h.page.onCheckImport();await h.page.onApplyImport();assert.equal(h.page._db.students.length,1);
 h.page.onImportAgree(event({},['replace']));h.state.confirm=false;await h.page.onApplyImport();assert.equal(h.page._db.students.length,1);h.state.confirm=true;await h.page.onApplyImport();
 assert.equal(h.page._db.revision,revision+1);assert.equal(h.page._db.students.length,0);assert.equal(h.page.data.importText,'');
});
test('invalid, swapped-after-check or failed-write import does not replace the saved archive',async()=>{
 const h=personal(),before=snapshot(h.page._db),disk=h.store.get(KEY);h.page.onImportInput(event({},'{invalid'));h.page.onCheckImport();assert.equal(snapshot(h.page._db),before);
 prepareImport(h,h.core.createDatabase(false));h.page.data.importText='{}';await h.page.onApplyImport();assert.equal(snapshot(h.page._db),before);
 prepareImport(h,h.core.createDatabase(false));h.state.writeFailure=true;await h.page.onApplyImport();assert.equal(h.store.get(KEY),disk);assert.ok(h.page.data.importText);assert.ok(h.page.data.importPreview);
});
test('pending destructive confirmations cannot overwrite an externally changed archive',async()=>{
 for(const kind of ['delete','restore']){
  const h=personal();if(kind==='restore')prepareImport(h,h.core.createDatabase(false));h.state.deferModal=true;const pending=kind==='delete'?h.page.onDeleteStudent():h.page.onApplyImport();
  const external=h.core.saveStudent(h.page._db,h.parse('{"name":"SYNTHETIC_EXTERNAL","grade":"八年级","subject":"英语"}')),raw=h.core.exportDatabase(external);h.store.set(KEY,raw);
  h.resolveModal(true);await pending;assert.equal(h.store.get(KEY),raw);assert.match(h.page.data.error,/没有覆盖/);
 }
});
test('clipboard export is explicit and failed copying never claims success',async()=>{
 const h=personal();h.state.confirm=false;await h.page.onExport();assert.equal(h.state.clipboard.length,0);h.state.confirm=true;h.state.clipboardFailure=true;await h.page.onExport();assert.equal(h.state.clipboard.length,0);assert.match(h.page.data.error,/复制未完成/);
 h.state.clipboardFailure=false;await h.page.onExport();assert.equal(snapshot(JSON.parse(h.state.clipboard[0])),snapshot(h.page._db));assert.match(h.page.data.notice,/不是持久备份/);
});
test('canceling a dirty form keeps its values and archive unchanged',async()=>{
 const h=personal();h.page.onAddScore();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_UNSAVED'));const context=snapshot(h.page._draftContext),raw=h.store.get(KEY);h.state.confirm=false;
 await h.page.onCancelForm();assert.equal(h.page.data.view,'form');assert.equal(snapshot(h.page._draftContext),context);assert.equal(h.page._dirty,true);assert.equal(h.store.get(KEY),raw);
});
test('opening help or failing navigation preserves an unsaved draft and does not copy records',()=>{
 const h=personal();h.page.onAddScore();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_HELP_DRAFT'));const context=snapshot(h.page._draftContext),draft=snapshot(h.page.data.form),writes=h.state.writes.length;
 h.page.onHelp();assert.equal(h.state.routes.at(-1),'/pages/help/help');h.state.navigateFailure=true;h.page.onHelp();assert.equal(snapshot(h.page._draftContext),context);assert.equal(snapshot(h.page.data.form),draft);assert.equal(h.page._dirty,true);assert.equal(h.state.writes.length,writes);assert.equal(h.state.clipboard.length,0);
});
test('changing an archive subject cannot silently rewrite existing score subjects',()=>{
 const h=personal();addScore(h);const before=h.store.get(KEY);h.page.onEditStudent();h.page.onFieldInput(event({field:'subject'},'数学'));h.page.onSaveForm();assert.equal(h.store.get(KEY),before);assert.equal(h.page.data.view,'form');assert.match(h.page.data.error,/科目不一致|学科/);
});
