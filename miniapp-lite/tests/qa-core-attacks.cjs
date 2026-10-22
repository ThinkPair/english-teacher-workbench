'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require(path.join(__dirname, '..', 'miniprogram', 'lib', 'core.js'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }
const clone = x => JSON.parse(JSON.stringify(x));
function unchanged(db, fn) { const before = JSON.stringify(db); fn(); assert.equal(JSON.stringify(db), before, 'input database mutated'); }
function reject(db, fn) { const before = JSON.stringify(db); assert.throws(fn); assert.equal(JSON.stringify(db), before, 'rejected mutation changed input'); }
function setup() {
  let db = C.createDatabase(false);
  db = C.saveStudent(db, {name:'SYNTHETIC_A', grade:'测试年级', className:'测试班', note:''});
  const a = db.students.find(s=>s.name==='SYNTHETIC_A').id;
  db = C.saveStudent(db, {name:'SYNTHETIC_B', grade:'测试年级', className:'测试班', note:''});
  const b = db.students.find(s=>s.name==='SYNTHETIC_B').id;
  db = C.saveScore(db, {studentId:a,title:'EXAM_A_ONLY',date:'2026-10-06',score:60,total:100,note:''});
  db = C.saveScore(db, {studentId:b,title:'EXAM_B_SECRET',date:'2026-10-06',score:90,total:120,note:''});
  db = C.saveTag(db, {studentId:a,type:'weak',label:'A_ONLY_TOPIC',note:'',observedOn:'2026-10-06',status:'active'});
  db = C.saveTag(db, {studentId:b,type:'habit',label:'B_SECRET_HABIT',note:'',observedOn:'2026-10-06',status:'active'});
  db = C.savePlan(db, {studentId:a,title:'A_ONLY_PLAN',body:'仅供合成学员A',dueDate:'',status:'todo',result:'',sourceEvidence:['A evidence snapshot']});
  db = C.savePlan(db, {studentId:b,title:'B_SECRET_PLAN',body:'仅供合成学员B',dueDate:'',status:'todo',result:'',sourceEvidence:['B evidence snapshot']});
  return {db,a,b};
}
test('explicit empty construction stays empty and example construction is synthetic', () => {
  const db = C.createDatabase(false);
  for (const k of ['students','scores','tags','plans']) assert.deepEqual(db[k], []);
  const demo = C.createDatabase(true); assert.ok(demo.students.length); C.validateDatabase(demo);
  assert.deepEqual(C.createDatabase(false).students, []);
});
test('save does not mutate its input', () => {
  const db = C.createDatabase(false), input = {name:'SYNTHETIC_NEW',grade:'',className:'',note:''};
  const before = JSON.stringify(input);
  unchanged(db, () => assert.notEqual(C.saveStudent(db,input),db));
  assert.equal(JSON.stringify(input),before);
});
for (const kind of ['Score','Tag','Plan']) {
  const array = {Score:'scores',Tag:'tags',Plan:'plans'}[kind];
  test(kind + ' cannot be reassigned to another student', () => {
    const {db,a,b}=setup(), record=db[array].find(x=>x.studentId===a);
    reject(db,()=>C['save'+kind](db,{...record,studentId:b}));
  });
  test(kind + ' unknown edit id cannot become an insert', () => {
    const {db,a}=setup(), record=db[array].find(x=>x.studentId===a);
    reject(db,()=>C['save'+kind](db,{...record,id:'NONEXISTENT_SYNTHETIC_ID'}));
  });
  test(kind + ' orphan create is rejected', () => {
    const {db,a}=setup(), record=db[array].find(x=>x.studentId===a);
    const input={...record,studentId:'NONEXISTENT_SYNTHETIC_STUDENT'};delete input.id;
    reject(db,()=>C['save'+kind](db,input));
  });
}
test('delete cascades only the selected student', () => {
  const {db,a,b}=setup(); const before=clone(db), after=C.deleteStudent(db,a);
  assert.deepEqual(db,before); assert.ok(!after.students.some(x=>x.id===a));
  for (const key of ['scores','tags','plans']) {
    assert.ok(!after[key].some(x=>x.studentId===a));
    assert.deepEqual(after[key].filter(x=>x.studentId===b),before[key].filter(x=>x.studentId===b));
  }
});
for (const value of ['', '   ', NaN, Infinity, -1, 101, 'not-a-number']) test('reject invalid score '+String(value),()=>{
  const {db,a}=setup(); reject(db,()=>C.saveScore(db,{studentId:a,title:'TEST',date:'2026-10-06',score:value,total:100,note:''}));
});
for (const date of ['2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-10-00','2026-1-1','']) test('reject impossible date '+date,()=>{
  const {db,a}=setup(); reject(db,()=>C.saveScore(db,{studentId:a,title:'TEST',date,score:1,total:2,note:''}));
});
test('numeric strings accepted and canonicalized',()=>{
  const {db,a}=setup(); const after=C.saveScore(db,{studentId:a,title:'TEST',date:'2024-02-29',score:'0',total:'100',note:''});
  const saved=after.scores.find(s=>s.title==='TEST');assert.equal(saved.score,0);assert.equal(saved.total,100);
});
test('active opposite tag conflicts but other student does not',()=>{
  const {db,a,b}=setup();
  reject(db,()=>C.saveTag(db,{studentId:a,type:'strong',label:'A_ONLY_TOPIC',note:'',observedOn:'2026-10-06',status:'active'}));
  C.saveTag(db,{studentId:b,type:'strong',label:'A_ONLY_TOPIC',note:'',observedOn:'2026-10-06',status:'active'});
});
test('active duplicate tag rejected',()=>{
  const {db,a}=setup();
  reject(db,()=>C.saveTag(db,{studentId:a,type:'weak',label:'A_ONLY_TOPIC',note:'',observedOn:'2026-10-06',status:'active'}));
});
for (const [name,mutate] of [
  ['wrong version', db=>{db.schemaVersion=999;}],
  ['duplicate student id', db=>{db.students.push({...db.students[0]});}],
  ['duplicate score id', db=>{db.scores.push({...db.scores[0]});}],
  ['orphan relation', db=>{db.plans[0].studentId='UNKNOWN_SYNTHETIC_ID';}],
  ['impossible score', db=>{db.scores[0].score=999;}],
  ['impossible date', db=>{db.scores[0].date='2026-02-30';}],
  ['invalid tag type', db=>{db.tags[0].type='diagnosis';}],
  ['invalid plan state', db=>{db.plans[0].status='punished';}]
]) test('malformed restore rejected: '+name,()=>{
  const {db}=setup(), incoming=clone(db); mutate(incoming);
  reject(db,()=>C.importDatabase(JSON.stringify(incoming)));
});
test('malformed JSON leaves current data intact',()=>{
  const {db}=setup();reject(db,()=>C.importDatabase('{"students":'));
});
test('extra import fields are stripped',()=>{
  const {db}=setup(), incoming=clone(db);incoming.exfiltrate='SYNTHETIC_EXTRA';incoming.students[0].secret='SYNTHETIC_EXTRA';
  const clean=C.importDatabase(JSON.stringify(incoming));
  assert.ok(!Object.hasOwn(clean,'exfiltrate'));assert.ok(!Object.hasOwn(clean.students[0],'secret'));
});
test('validate clones nested structures',()=>{
  const {db}=setup(), clean=C.validateDatabase(db);
  clean.plans[0].sourceEvidence.push('changed clone');
  assert.ok(!db.plans[0].sourceEvidence.includes('changed clone'));
});
test('export round-trip holds only selected database',()=>{
  const {db}=setup();assert.deepEqual(C.importDatabase(C.exportDatabase(db)),C.validateDatabase(db));
});
test('suggestions cannot borrow another student evidence or mutate database',()=>{
  const {db,a}=setup(); unchanged(db,()=>{
    const list=C.suggestions(db,a,'2026-10-06'); assert.ok(Array.isArray(list)&&list.length);
    assert.ok(!JSON.stringify(list).includes('B_SECRET'));
    for(const item of list){assert.equal(typeof item.title,'string');assert.equal(typeof item.body,'string');assert.ok(Array.isArray(item.evidence));}
  });
});
test('empty student gets observation guidance without creating evidence',()=>{
  let db=C.createDatabase(false);db=C.saveStudent(db,{name:'SYNTHETIC_EMPTY',grade:'',className:'',note:''});
  unchanged(db,()=>assert.ok(C.suggestions(db,db.students[0].id,'2026-10-06').length));
  assert.equal(db.scores.length+db.tags.length+db.plans.length,0);
});

// Subject and migration attacks; schema 4 retains the relevant earlier safeguards.
function legacyFixture() {
  const {db}=setup(), old=clone(db); old.schemaVersion=1; old.revision=123;
  for(const row of [...old.scores,...old.tags]) delete row.subject;
  return old;
}
test('new database uses schema 4; v1 migration is lossless and does not mutate input',()=>{
  assert.equal(C.createDatabase(false).schemaVersion,4);
  const old=legacyFixture(),before=JSON.stringify(old),migrated=C.validateDatabase(old);
  assert.equal(JSON.stringify(old),before);assert.equal(migrated.schemaVersion,4);assert.equal(migrated.revision,123);
  for(const row of [...migrated.scores,...migrated.tags]) assert.equal(row.subject,'');
  const restored=clone(migrated);restored.schemaVersion=1;for(const row of [...restored.scores,...restored.tags])delete row.subject;
  assert.deepEqual(restored,old);
  assert.deepEqual(C.importDatabase(before),migrated);
  assert.deepEqual(C.importDatabase(C.exportDatabase(migrated)),migrated);
});
for(const [name,mutate] of [
 ['orphan',db=>{db.tags[0].studentId='SYNTHETIC_MISSING';}],
 ['duplicate across tables',db=>{db.scores[0].id=db.tags[0].id;}],
 ['bad date',db=>{db.scores[0].date='2026-02-30';}],
 ['bad revision',db=>{db.revision=-1;}],
 ['bad numeric type',db=>{db.scores[0].score='60';}],
 ['bad tag state',db=>{db.tags[0].status='unknown';}]
]) test('v1 migration does not bypass validation: '+name,()=>{
 const old=legacyFixture();mutate(old);const before=JSON.stringify(old);
 assert.throws(()=>C.validateDatabase(old));assert.throws(()=>C.importDatabase(before));assert.equal(JSON.stringify(old),before);
});
for(const kind of ['Score','Tag']) {
 const table=kind==='Score'?'scores':'tags';
 test(kind+' subject is optional, bounded, normalized, retained when omitted on edit',()=>{
  const {db}=setup(),record=db[table][0],saved=C['save'+kind](db,{...record,subject:'  TEST   SUBJECT  '});
  assert.equal(saved[table][0].subject,'TEST SUBJECT');
  const input={...saved[table][0],note:'SYNTHETIC_EDIT'};delete input.subject;
  const preserved=C['save'+kind](saved,input);assert.equal(preserved[table][0].subject,'TEST SUBJECT');
  const cleared=C['save'+kind](preserved,{...input,subject:''});assert.equal(cleared[table][0].subject,'');
  const boundary=C['save'+kind](db,{...record,subject:'科'.repeat(50)});assert.equal(boundary[table][0].subject.length,50);
 });
 for(const [label,value] of [['overlong','科'.repeat(51)],['null',null],['number',42],['object',{}],['array',[]],['control','SYNTHETIC\u0000SUBJECT']])
  test(kind+' rejects unsafe subject '+label+' on save and import',()=>{
   const {db}=setup(),record=db[table][0];reject(db,()=>C['save'+kind](db,{...record,subject:value}));
   const incoming=clone(db);incoming[table][0].subject=value;assert.throws(()=>C.importDatabase(JSON.stringify(incoming)));
  });
}
test('tag conflicts are scoped by student and normalized subject; cross-subject observations coexist',()=>{
 let {db,a,b}=setup();
 const input={studentId:a,type:'weak',label:'SYNTHETIC_SHARED_TOPIC',note:'',observedOn:'2026-10-06',status:'active'};
 db=C.saveTag(db,{...input,subject:' Math '});
 reject(db,()=>C.saveTag(db,{...input,type:'strong',subject:'ＭＡＴＨ'}));
 reject(db,()=>C.saveTag(db,{...input,subject:'m a t h'}));
 db=C.saveTag(db,{...input,type:'strong',subject:'English'});
 db=C.saveTag(db,{...input,type:'strong',subject:''});
 db=C.saveTag(db,{...input,type:'strong',subject:'Math',studentId:b});
 assert.equal(db.tags.filter(t=>t.label===input.label).length,4);
 const english=db.tags.find(t=>t.label===input.label&&t.subject==='English');
 reject(db,()=>C.saveTag(db,{...english,subject:'Math'}));
});
test('same-subject conflicting import is rejected even when the subject uses full-width letters',()=>{
 const {db,a}=setup();let seeded=C.saveTag(db,{studentId:a,type:'weak',label:'SYNTHETIC_TOPIC',subject:'Math',note:'',observedOn:'2026-10-06',status:'active'});
 const incoming=clone(seeded),first=incoming.tags.at(-1);incoming.tags.push({...first,id:'SYNTHETIC_CONFLICT_ID',subject:'ＭＡＴＨ',type:'strong'});
 assert.throws(()=>C.importDatabase(JSON.stringify(incoming)));
});
test('score suggestions never compare different subjects or combine unclassified exams',()=>{
 let db=C.saveStudent(C.createDatabase(false),{name:'SYNTHETIC_SUBJECT_A'}),a=db.students[0].id;
 for(const [subject,title,date,score]of [['数学','MATH_ONE','2026-10-01',20],['英语','ENGLISH_ONE','2026-10-02',80],['','UNCLASSIFIED_OLDER','2026-10-03',30],['','UNCLASSIFIED_LATEST','2026-10-04',60]])
  db=C.saveScore(db,{studentId:a,subject,title,date,score,total:100});
 const before=JSON.stringify(db),ideas=C.suggestions(db,a,'2026-10-06');assert.equal(JSON.stringify(db),before);
 for(const idea of ideas){
  const evidence=JSON.stringify(idea.evidence);
  assert.ok(!(evidence.includes('MATH_ONE')&&evidence.includes('ENGLISH_ONE')),'different subjects share a comparison');
  assert.ok(!(evidence.includes('UNCLASSIFIED_OLDER')&&evidence.includes('UNCLASSIFIED_LATEST')),'unclassified exams share a comparison');
 }
 assert.ok(ideas.some(i=>JSON.stringify(i.evidence).includes('数学')),'subject missing from math evidence');
 assert.ok(ideas.some(i=>JSON.stringify(i.evidence).includes('英语')),'subject missing from English evidence');
});
test('non-English subject does not trigger English tense exercise; evidence identifies subject',()=>{
 let db=C.saveStudent(C.createDatabase(false),{name:'SYNTHETIC_TAG_SUBJECT'}),a=db.students[0].id;
 db=C.saveTag(db,{studentId:a,type:'weak',label:'过去与现在的叙事',subject:'语文',observedOn:'2026-10-06'});
 const idea=C.suggestions(db,a,'2026-10-06').find(i=>i.key.startsWith('tag-'));
 assert.ok(idea);assert.ok(!/动词|时态|主语/.test(idea.body),'Chinese subject incorrectly uses English grammar action');
 assert.ok(JSON.stringify(idea).includes('语文'));
});
test('unclassified and migrated tags do not implicitly become English grammar advice',()=>{
 let db=C.saveStudent(C.createDatabase(false),{name:'SYNTHETIC_UNCLASSIFIED_TAG'}),a=db.students[0].id;
 db=C.saveTag(db,{studentId:a,type:'weak',label:'过去与现在的叙事',observedOn:'2026-10-06'});
 for(const input of [db,{...db,schemaVersion:1,tags:db.tags.map(({subject,...rest})=>rest)}]){
  const idea=C.suggestions(input,a,'2026-10-06').find(i=>i.key.startsWith('tag-'));
  assert.ok(idea);assert.ok(!/动词|时态|主语/.test(idea.body),'missing subject implicitly inferred English');
 }
});
console.log(JSON.stringify({suite:'independent-qa-core-attacks',passed,failed,syntheticDataOnly:true}));
process.exitCode = failed ? 1 : 0;

