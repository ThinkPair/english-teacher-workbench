'use strict';
// Independent category and migration attacks. Synthetic objects only.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../miniprogram/lib/core.js'),D=require('../miniprogram/lib/dashboard.js'),S=require('../miniprogram/lib/storage.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const snap=x=>JSON.stringify(x);
function setup(){
 let db=C.createDatabase(false);for(const[name,total]of [['SYNTHETIC_PRIMARY',100],['SYNTHETIC_HIGH',150],['SYNTHETIC_EMPTY',120]])db=C.saveCategory(db,{name,total});
 for(const categoryId of [db.categories[0].id,db.categories[1].id,''])db=C.saveStudent(db,{name:'SYNTHETIC_SAME_NAME',grade:'五年级',subject:'英语',categoryId});
 return db;
}
function addScore(db,studentId,total=100){return C.saveScore(db,{studentId,title:'SYNTHETIC_EXAM',date:'2026-10-06',score:50,total});}
function oldV3(){
 let db=setup();db=addScore(db,db.students[0].id,2000000);db.students[0].subject='';db.students[0].isExample=true;db.students[1].subject='数学';
 db.schemaVersion=3;delete db.categories;for(const row of db.students)delete row.categoryId;return db;
}
test('v3 migration preserves an explicit blank subject, example flag and historical full marks without re-inferring',()=>{
 const old=oldV3(),before=snap(old),next=C.importDatabase(before);assert.equal(next.schemaVersion,4);assert.equal(next.revision,old.revision);assert.equal(snap(old),before);assert.deepEqual(next.categories,[]);
 assert.deepEqual(next.students.map(({categoryId,...row})=>row),old.students);assert.ok(next.students.every(s=>s.categoryId===''));assert.deepEqual(next.scores,old.scores);assert.equal(next.students[0].subject,'');assert.equal(next.students[0].isExample,true);assert.equal(next.students[1].subject,'数学');
});
test('schema4 backup round-trip preserves categories, references and all records as independent values',()=>{
 let db=setup();db=addScore(db,db.students[0].id);const restored=C.importDatabase(C.exportDatabase(db));assert.equal(restored.schemaVersion,4);assert.deepEqual(restored,db);restored.categories[0].total=123;assert.equal(db.categories[0].total,100);
});
test('updating a category or moving a student changes new-score defaults without rewriting old scores or plan evidence',()=>{
 let db=setup(),student=db.students[0];db=addScore(db,student.id,100);db=C.savePlan(db,{studentId:student.id,title:'SYNTHETIC_PLAN',body:'SYNTHETIC_BODY',sourceEvidence:['SYNTHETIC_50/100']});const oldScores=snap(db.scores),oldPlans=snap(db.plans);
 db=C.saveCategory(db,{...db.categories[0],total:120});assert.equal(snap(db.scores),oldScores);assert.equal(snap(db.plans),oldPlans);
 const input={studentId:student.id,title:'SYNTHETIC_NEW',date:'2026-10-06',score:50};db=C.saveScore(db,input);assert.equal(db.scores.at(-1).total,120);
 db=C.saveStudent(db,{...db.students[0],categoryId:db.categories[1].id});db=C.saveScore(db,input);assert.equal(db.scores.at(-1).total,150);assert.equal(snap(db.scores[0]),snap(JSON.parse(oldScores)[0]));assert.equal(snap(db.plans),oldPlans);
});
test('explicit per-exam full marks override defaults while an omitted edit full mark is not silently rebased',()=>{
 let db=setup(),id=db.students[0].id;db=addScore(db,id,60);assert.equal(db.scores[0].total,60);const before=snap(db),edit={...db.scores[0]};delete edit.total;assert.throws(()=>C.saveScore(db,edit));assert.equal(snap(db),before);
});
for(const value of [0,-1,1000001,'',null,Infinity,NaN,{},[]])test('invalid category full marks are rejected atomically: '+String(value),()=>{
 const db=setup(),before=snap(db);assert.throws(()=>C.saveCategory(db,{name:'SYNTHETIC_INVALID',total:value}));assert.equal(snap(db),before);
 const incoming=clone(db);incoming.categories[0].total=value;assert.throws(()=>C.validateDatabase(incoming));
});
test('category names normalize width, case and whitespace for uniqueness on save and import',()=>{
 let db=C.saveCategory(C.createDatabase(false),{name:'  English  A  ',total:'120'});assert.equal(db.categories[0].name,'English A');assert.equal(db.categories[0].total,120);const before=snap(db);
 assert.throws(()=>C.saveCategory(db,{name:'ＥＮＧＬＩＳＨＡ',total:100}));assert.equal(snap(db),before);const incoming=clone(db);incoming.categories.push({id:'SYNTHETIC_OTHER_ID',name:'e n g l i s h a',total:150});assert.throws(()=>C.importDatabase(snap(incoming)));
});
test('category capacity allows 100 and rejects the 101st without changing existing records',()=>{
 let db=C.createDatabase(false);db.categories=Array.from({length:100},(_,i)=>({id:'SYNTHETIC_C'+i,name:'SYNTHETIC_CATEGORY_'+i,total:100}));db=C.validateDatabase(db);const before=snap(db);assert.throws(()=>C.saveCategory(db,{name:'SYNTHETIC_EXTRA',total:100}));assert.equal(snap(db),before);
});
test('category ids cannot collide with record ids or the unassigned display sentinel',()=>{
 const db=setup(),incoming=clone(db);incoming.categories[0].id=incoming.students[0].id;assert.throws(()=>C.importDatabase(snap(incoming)));
 const sentinel=C.createDatabase(false);sentinel.categories=[{id:'unassigned',name:'SYNTHETIC_REAL_CATEGORY',total:120}];assert.throws(()=>C.validateDatabase(sentinel),/保留|分类编号|unassigned/);
});
test('v4 requires category arrays and explicit valid student references; old fields cannot bypass validation',()=>{
 const db=setup();for(const value of [undefined,null,{},'']){const incoming=clone(db);incoming.categories=value;assert.throws(()=>C.validateDatabase(incoming));}
 for(const value of [undefined,null,123,'SYNTHETIC_ORPHAN']){const incoming=clone(db);incoming.students[0].categoryId=value;assert.throws(()=>C.validateDatabase(incoming));}
 const before=snap(db);assert.throws(()=>C.saveStudent(db,{...db.students[0],categoryId:'SYNTHETIC_ORPHAN'}));assert.equal(snap(db),before);
});
test('category data rejects holes and dynamic accessors without invoking getter code',()=>{
 const db=setup(),hole=clone(db);delete hole.categories[0];assert.throws(()=>C.validateDatabase(hole));let invoked=0;const input={name:'SYNTHETIC_GETTER'};Object.defineProperty(input,'total',{get(){invoked++;return 100;}});assert.throws(()=>C.saveCategory(db,input));assert.equal(invoked,0);
});
test('referenced category deletion is refused; moving the archive out permits deletion without deleting its history',()=>{
 let db=setup();db=addScore(db,db.students[0].id);const id=db.categories[0].id,before=snap(db);assert.throws(()=>C.removeCategory(db,id));assert.equal(snap(db),before);
 db=C.saveStudent(db,{...db.students[0],categoryId:''});const scores=snap(db.scores);db=C.removeCategory(db,id);assert.equal(db.students.length,3);assert.equal(snap(db.scores),scores);assert.equal(db.students[0].categoryId,'');
});
test('empty categories are selectable and unassigned appears only when needed or no categories exist',()=>{
 let db=C.createDatabase(false),dash=D.buildDashboard(db,{});assert.equal(dash.groups[0].key,'unassigned');db=C.saveCategory(db,{name:'SYNTHETIC_EMPTY',total:120});dash=D.buildDashboard(db,{groupKey:db.categories[0].id});assert.equal(dash.groups.length,1);assert.equal(dash.selectedKey,db.categories[0].id);assert.equal(dash.cards.length,0);assert.equal(dash.groups[0].ratio,0);
 db=C.saveStudent(db,{name:'SYNTHETIC_UNASSIGNED',subject:'英语'});dash=D.buildDashboard(db,{groupKey:'unassigned'});assert.equal(dash.groups.length,2);assert.equal(dash.cards.length,1);assert.equal(dash.cards[0].defaultTotal,null);assert.equal(dash.selectedGroup.name,'未分类');
});
test('same-name archives remain independent across categories and filters never rewrite composition totals',()=>{
 const db=setup(),before=snap(db),dash=D.buildDashboard(db,{groupKey:db.categories[1].id,query:'SYNTHETIC_SAME_NAME'});assert.equal(dash.totals.records,3);assert.equal(dash.groups.length,4);assert.equal(dash.cards.length,1);assert.equal(dash.cards[0].id,db.students[1].id);assert.equal(snap(db),before);
});
test('category rename preserves selected identity and per-exam latest title/date remain traceable',()=>{
 let db=setup();db=addScore(db,db.students[0].id);const id=db.categories[0].id;db=C.saveCategory(db,{...db.categories[0],name:'SYNTHETIC_RENAMED',total:99});const dash=D.buildDashboard(db,{groupKey:id,today:'2026-10-06'});
 assert.equal(dash.selectedKey,id);assert.equal(dash.selectedGroup.name,'SYNTHETIC_RENAMED');assert.equal(dash.cards[0].latestTitle,'SYNTHETIC_EXAM');assert.equal(dash.cards[0].latestDate,'2026-10-06');assert.equal(dash.cards[0].latestText,'50 / 100');assert.equal(dash.cards[0].latestRate,'50%');
});
test('schema3 on the retained storage key stays byte-identical until a successful schema4 save',()=>{
 const raw=snap(oldV3()),disk=new Map([[S.KEY,raw]]);let fail=true;const wx={getStorageInfoSync:()=>({keys:[...disk.keys()]}),getStorageSync:k=>disk.get(k),setStorageSync(k,v){if(fail)throw Error('SYNTHETIC_WRITE');disk.set(k,v);}};
 const read=S.read(wx),db=C.importDatabase(read.raw);assert.equal(disk.get(S.KEY),raw);assert.throws(()=>S.commit(wx,db,read.token));assert.equal(disk.get(S.KEY),raw);fail=false;S.commit(wx,db,read.token);const stored=C.importDatabase(disk.get(S.KEY));assert.equal(stored.schemaVersion,4);assert.deepEqual(stored.scores,JSON.parse(raw).scores);assert.equal(stored.students[0].subject,'');
});
