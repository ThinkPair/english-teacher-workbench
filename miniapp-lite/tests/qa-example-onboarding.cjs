'use strict';
// Synthetic in-memory wx storage only; never reads official WeChat storage.
const test=require('node:test'),assert=require('node:assert/strict');
const {KEY,PERSONAL,DEMO,event,snapshot,harness,emptyHarness,personal}=require('./qa-native-harness.cjs');
const C=require('../miniprogram/lib/core.js');
const empty=version=>({schemaVersion:version,revision:7,...(version===4?{categories:[]}:{}),students:[],scores:[],tags:[],plans:[]});

test('a truly fresh install with no archive keys creates ten visible example records',()=>{
 const h=harness();h.page.onLoad();assert.equal(h.page._db.students.length,10);assert.equal(h.page._db.scores.length,40);assert.ok(h.page._db.students.every(s=>s.isExample));assert.equal(h.page.data.totals.examples,10);assert.equal(h.page.data.rows.length,4);assert.equal(h.state.writes.length,1);assert.ok(h.store.has(KEY));
});
test('a valid empty legacy personal store intentionally remains empty and does not receive automatic examples',()=>{
 const raw=snapshot(empty(2)),h=harness({[PERSONAL]:raw,[DEMO]:'SYNTHETIC_OLD_EXAMPLE_STORE'});h.page.onLoad();assert.equal(h.page._db.students.length,0);assert.equal(h.page._db.schemaVersion,4);assert.equal(h.page.data.totals.examples,0);assert.equal(h.page.data.rows.length,0);assert.equal(h.store.has(KEY),false);assert.equal(h.store.get(PERSONAL),raw);assert.equal(h.state.writes.length,0);
});
for(const version of [3,4])test('existing empty archive version '+version+' suppresses automatic seed without touching original bytes',()=>{
 const raw=snapshot(empty(version)),h=harness({[KEY]:raw});h.page.onLoad();assert.equal(h.page._db.students.length,0);assert.equal(h.page.data.totals.examples,0);assert.equal(h.page.data.rows.length,0);assert.equal(h.store.get(KEY),raw);assert.equal(h.state.writes.length,0);
});
test('a returning teacher archive retains their records and does not silently append example data',()=>{
 const original=personal(),raw=original.store.get(KEY),before=snapshot(original.page._db);const h=harness(Object.fromEntries(original.store));h.page.onLoad();assert.equal(snapshot(h.page._db),before);assert.equal(h.page._db.students.length,1);assert.equal(h.page._db.students[0].isExample,false);assert.equal(h.page.data.totals.examples,0);assert.equal(h.store.get(KEY),raw);assert.equal(h.state.writes.length,0);
});
test('deleting the initial examples remains durable across restart and never triggers implicit resurrection',async()=>{
 const h=harness();h.page.onLoad();for(const id of Array.from(h.page._db.students,s=>s.id)){h.page.onOpenStudent(event({id}));await h.page.onDeleteStudent();}const raw=h.store.get(KEY),reopened=harness(Object.fromEntries(h.store));reopened.page.onLoad();assert.equal(reopened.page._db.students.length,0);assert.equal(reopened.page._db.scores.length,0);assert.equal(reopened.store.get(KEY),raw);assert.equal(reopened.state.writes.length,0);
});
test('explicit core append creates an independent ten-student snapshot and advances revision exactly once',()=>{
 const db=C.createDatabase(false);db.revision=19;const before=snapshot(db),next=C.addExampleStudents(db);assert.equal(snapshot(db),before);assert.notEqual(next,db);assert.equal(next.revision,20);
 assert.deepEqual(['students','scores','tags','plans'].map(k=>next[k].length),[10,40,8,1]);assert.equal(next.categories.length,3);assert.ok(next.students.every(s=>s.isExample));assert.equal(C.validateDatabase(next).students.length,10);
});
test('seed-looking real names and colliding old seed ids are preserved while all new associations use fresh ids',()=>{
 const db=C.createDatabase(true);for(const s of db.students)s.isExample=false;const before=snapshot(db),oldIds=new Set(['categories','students','scores','tags','plans'].flatMap(k=>db[k].map(r=>r.id))),next=C.addExampleStudents(db);assert.equal(snapshot(db),before);
 for(const table of ['categories','students','scores','tags','plans'])assert.equal(snapshot(next[table].slice(0,db[table].length)),snapshot(db[table]));assert.equal(next.students.length,20);assert.equal(next.scores.length,80);
 const added=next.students.slice(db.students.length),newStudents=new Set(added.map(s=>s.id));assert.ok(added.every(s=>s.isExample&&!oldIds.has(s.id)));for(const table of ['scores','tags','plans'])for(const row of next[table].slice(db[table].length)){assert.ok(!oldIds.has(row.id));assert.ok(newStudents.has(row.studentId));}
 const ids=['categories','students','scores','tags','plans'].flatMap(k=>next[k].map(r=>r.id));assert.equal(new Set(ids).size,ids.length);
});
test('same normalized category names reuse their actual totals without changing old categories or grades',()=>{
 let db=C.saveCategory(C.createDatabase(false),{name:'小 学 英语',total:80});db=C.saveCategory(db,{name:'初中英语',total:135});db=C.saveCategory(db,{name:'高中英语',total:0.03});db=C.saveStudent(db,{name:'SYNTHETIC_REAL',subject:'英语',grade:'七年级',categoryId:db.categories[1].id});db=C.saveScore(db,{studentId:db.students[0].id,title:'SYNTHETIC_REAL_SCORE',date:'2026-10-06',score:87,total:120});const before=snapshot(db),next=C.addExampleStudents(db);
 assert.equal(snapshot(db),before);assert.deepEqual(next.categories,db.categories);assert.deepEqual(next.students[0],db.students[0]);assert.deepEqual(next.scores[0],db.scores[0]);const sample=C.createDatabase(true),added=next.students.slice(1);
 for(let i=0;i<added.length;i++){const owner=added[i],target=next.categories.find(c=>c.id===owner.categoryId),rows=next.scores.filter(s=>s.studentId===owner.id),base=sample.scores.filter(s=>s.studentId===sample.students[i].id);assert.equal(rows.length,4);for(let j=0;j<4;j++){assert.equal(rows[j].total,target.total);assert.equal(rows[j].score,Math.min(target.total,Math.round(base[j].score/base[j].total*target.total*100)/100));assert.ok(rows[j].score>=0&&rows[j].score<=rows[j].total);}}
});
test('partial matching categories are reused and only missing example categories are added',()=>{
 const db=C.saveCategory(C.createDatabase(false),{name:'初中英语',total:110}),next=C.addExampleStudents(db);assert.equal(next.categories.length,3);assert.deepEqual(next.categories[0],db.categories[0]);assert.equal(next.students.filter(s=>s.categoryId===db.categories[0].id).length,3);
});
test('an existing single example blocks another batch without mutating or replacing any record',()=>{
 let db=C.createDatabase(true);for(const s of db.students)s.isExample=false;db.students[4].isExample=true;const before=snapshot(db);assert.throws(()=>C.addExampleStudents(db),/示例/);assert.equal(snapshot(db),before);
});
test('student capacity failure is atomic and does not leave some added categories or sample records',()=>{
 const db=C.createDatabase(false);db.students=Array.from({length:491},(_,i)=>({id:'SYNTHETIC_S'+i,name:'SYNTHETIC_REAL_'+i,grade:'',className:'',note:'',subject:'英语',isExample:false,categoryId:''}));C.validateDatabase(db);const before=snapshot(db);assert.throws(()=>C.addExampleStudents(db),/最多|容量/);assert.equal(snapshot(db),before);
});
test('category capacity failure is atomic even when the source archive itself is valid',()=>{
 const db=C.createDatabase(false);db.categories=Array.from({length:98},(_,i)=>({id:'SYNTHETIC_C'+i,name:'SYNTHETIC_CATEGORY_'+i,total:100}));C.validateDatabase(db);const before=snapshot(db);assert.throws(()=>C.addExampleStudents(db),/最多|容量/);assert.equal(snapshot(db),before);
});
test('revision overflow or malformed input cannot be repaired by appending examples',()=>{
 const max=C.createDatabase(false);max.revision=Number.MAX_SAFE_INTEGER;const before=snapshot(max);assert.throws(()=>C.addExampleStudents(max));assert.equal(snapshot(max),before);
 const malformed=C.createDatabase(false);malformed.categories=[{id:'SYNTHETIC_BAD',name:'SYNTHETIC_BAD',total:0}];assert.throws(()=>C.addExampleStudents(malformed));assert.equal(malformed.categories[0].total,0);
});
test('explicit append from a legacy empty home saves v4 to the new key while retaining old bytes',()=>{
 const raw=snapshot(empty(2)),h=harness({[PERSONAL]:raw});h.page.onLoad();h.page.onAddExamples();assert.equal(h.page._db.students.length,10);assert.equal(h.page._db.schemaVersion,4);assert.equal(h.page.data.rows.length,4);assert.equal(h.store.get(PERSONAL),raw);assert.equal(JSON.parse(h.store.get(KEY)).schemaVersion,4);
});
test('explicit append on an old empty archive is visible immediately and survives restart',()=>{
 const h=harness({[KEY]:snapshot(empty(3))});h.page.onLoad();h.page.onAddExamples();assert.equal(h.page._db.students.length,10);assert.equal(h.page.data.rows.length,4);const raw=h.store.get(KEY),reopened=harness(Object.fromEntries(h.store));reopened.page.onLoad();assert.equal(reopened.page._db.students.length,10);assert.equal(reopened.store.get(KEY),raw);assert.equal(reopened.state.writes.length,0);
});
test('append preserves existing teacher data and clears filters that would hide the new examples',async()=>{
 const h=personal(),before=snapshot(h.page._db.students[0]);await h.page.onHome();h.page.onSearch(event({},'SYNTHETIC_NO_MATCH'));h.page.onListFilter(event({filter:'todo'}));assert.equal(h.page.data.rows.length,0);h.page.onAddExamples();assert.equal(h.page._db.students.length,11);assert.equal(snapshot(h.page._db.students[0]),before);assert.equal(h.page.data.query,'');assert.equal(h.page.data.listFilter,'all');assert.equal(h.page.data.groupKey,h.page._db.students.find(s=>s.isExample).categoryId);assert.equal(h.page.data.rows.length,4);assert.ok(h.page.data.rows.every(s=>s.isExample));
});
test('repeated clicks and guarded reentry cannot add a second example batch',()=>{
 const h=emptyHarness();h.page._addingExamples=true;h.page.onAddExamples();assert.equal(h.page._db.students.length,0);h.page._addingExamples=false;h.page.onAddExamples();const raw=h.store.get(KEY),writes=h.state.writes.length;h.page.onAddExamples();assert.equal(h.page._db.students.length,10);assert.equal(h.state.writes.length,writes);assert.equal(h.store.get(KEY),raw);assert.equal(h.page.data.addingExamples,false);
});
test('append write failure preserves raw data, current filters and retryability',()=>{
 const h=emptyHarness();h.page.onSearch(event({},'SYNTHETIC_FILTER'));h.page.onListFilter(event({filter:'todo'}));const raw=h.store.get(KEY),before=snapshot(h.page._db),group=h.page.data.groupKey;h.state.writeFailure=true;h.page.onAddExamples();assert.equal(h.store.get(KEY),raw);assert.equal(snapshot(h.page._db),before);assert.equal(h.page.data.query,'SYNTHETIC_FILTER');assert.equal(h.page.data.listFilter,'todo');assert.equal(h.page.data.groupKey,group);assert.equal(h.page.data.addingExamples,false);assert.equal(h.page._addingExamples,false);assert.match(h.page.data.error,/保存失败/);
 h.state.writeFailure=false;h.page.onAddExamples();assert.equal(h.page._db.students.length,10);assert.equal(h.page.data.rows.length,4);
});
test('native byte-limit failure leaves an otherwise valid existing archive completely intact',()=>{
 let db,raw;const limit=900*1024;
 for(let n=120;n<170;n++){
  const candidate=C.createDatabase(false);candidate.students=Array.from({length:n},(_,i)=>({id:'SYNTHETIC_LARGE_'+i,name:'SYNTHETIC_REAL_'+i,grade:'七年级',className:'',note:'测'.repeat(2000),subject:'英语',isExample:false,categoryId:''}));const text=C.exportDatabase(candidate);
  if(Buffer.byteLength(text)<=limit&&Buffer.byteLength(C.exportDatabase(C.addExampleStudents(candidate)))>limit){db=candidate;raw=text;break;}
 }
 assert.ok(db,'fixture must fit before append and exceed the native limit after append');const h=harness({[KEY]:raw});h.page.onLoad();const before=snapshot(h.page._db);h.page.onAddExamples();assert.equal(h.store.get(KEY),raw);assert.equal(snapshot(h.page._db),before);assert.equal(h.page._db.students.filter(s=>s.isExample).length,0);assert.match(h.page.data.error,/容量|上限/);assert.equal(h.state.writes.length,0);assert.equal(h.page.data.addingExamples,false);
});
test('append rejects a stale disk snapshot without overwriting another writer records',()=>{
 const h=emptyHarness(),external=h.core.saveStudent(h.page._db,h.parse('{"name":"SYNTHETIC_EXTERNAL","subject":"英语"}')),raw=h.core.exportDatabase(external);h.store.set(KEY,raw);h.page.onAddExamples();assert.equal(h.store.get(KEY),raw);assert.equal(h.page._db.students.length,0);assert.match(h.page.data.error,/没有覆盖/);assert.equal(h.page._addingExamples,false);
});
test('a forged append action while a form, dirty draft or blocked archive is open does nothing',()=>{
 const h=personal();h.page.onAddScore();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_DRAFT'));const raw=h.store.get(KEY),draft=snapshot(h.page.data.form),context=snapshot(h.page._draftContext);h.page.onAddExamples();assert.equal(h.store.get(KEY),raw);assert.equal(snapshot(h.page.data.form),draft);assert.equal(snapshot(h.page._draftContext),context);
 h.page.data.view='list';h.page.onAddExamples();assert.equal(h.store.get(KEY),raw);assert.equal(snapshot(h.page.data.form),draft);const broken=harness({[KEY]:'SYNTHETIC_BAD'});broken.page.onLoad();broken.page.onAddExamples();assert.equal(broken.store.get(KEY),'SYNTHETIC_BAD');assert.equal(broken.state.writes.length,0);
});
test('deleted examples return only after explicit append, with fresh ids and no duplicate categories',async()=>{
 const h=harness();h.page.onLoad();const ids=Array.from(h.page._db.students,s=>s.id);for(const id of ids){h.page.onOpenStudent(event({id}));await h.page.onDeleteStudent();}const reopened=harness(Object.fromEntries(h.store));reopened.page.onLoad();assert.equal(reopened.page._db.students.length,0);assert.equal(reopened.page._db.categories.length,3);reopened.page.onAddExamples();assert.equal(reopened.page._db.students.length,10);assert.equal(reopened.page._db.categories.length,3);assert.ok(reopened.page._db.students.every(s=>!ids.includes(s.id)));
});
