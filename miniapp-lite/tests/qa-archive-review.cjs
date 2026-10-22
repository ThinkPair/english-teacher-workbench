'use strict';
// Independent schema-4 archive QA. Every database and storage object is synthetic.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const C=require(path.join(root,'miniprogram/lib/core.js'));
const clone=value=>JSON.parse(JSON.stringify(value));
function oldStudent(id,name='SYNTHETIC_SAME_NAME') {
 return{id,name,grade:'七年级',className:'SYNTHETIC_HIDDEN_CLASS',note:'SYNTHETIC_NOTE'};
}
function score(id,studentId,subject,date='2026-10-06',value=50,total=100) {
 return{id,studentId,subject,title:'SYNTHETIC_EXAM_'+id,date,score:value,total,note:'SYNTHETIC_SCORE_NOTE'};
}
function tag(id,studentId,subject) {
 return{id,studentId,subject,type:'weak',label:'SYNTHETIC_TOPIC_'+id,note:'SYNTHETIC_TAG_NOTE',observedOn:'2026-10-06',status:'active'};
}
function legacy(version=2) {
 const db={schemaVersion:version,revision:37,
  students:[oldStudent('A'),oldStudent('B'),oldStudent('C'),oldStudent('D','示例字样也可能是老师自行命名的合成旧档案')],
  scores:[score('A1','A','Math'),score('A2','A','ＭＡＴＨ'),score('A3','A',''),score('B1','B','数学'),score('B2','B','英语'),score('C1','C','')],
  tags:[tag('AT','A','m a t h'),tag('BT','B','英语'),tag('DT','D','英语')],
  plans:[{id:'AP',studentId:'A',title:'SYNTHETIC_PLAN',body:'SYNTHETIC_BODY',dueDate:'2026-10-07',status:'todo',result:'SYNTHETIC_RESULT',sourceEvidence:['SYNTHETIC_OLD_SNAPSHOT']}]};
 if(version===1)for(const row of [...db.scores,...db.tags])delete row.subject;
 return db;
}
test('schema 4 initializes ten explicitly marked examples in editable categories with matching score totals',()=>{
 const db=C.createDatabase(true);assert.equal(db.schemaVersion,4);assert.equal(db.students.length,10);
 assert.equal(new Set(db.students.map(s=>s.id)).size,10);assert.ok(db.students.every(s=>s.isExample===true&&s.subject&&s.name.includes('虚构')));
 assert.deepEqual(db.categories.map(c=>[c.total,db.students.filter(s=>s.categoryId===c.id).length]),[[100,4],[120,3],[150,3]]);
 assert.ok(db.students.every(s=>s.subject==='英语'));assert.equal(db.scores.length,40);
 for(const student of db.students){const rows=db.scores.filter(s=>s.studentId===student.id);assert.equal(rows.length,4);assert.ok(rows.every(s=>s.subject===student.subject));}
 const id=db.students[0].id,after=C.deleteStudent(db,id);assert.equal(after.students.length,9);
 for(const table of ['scores','tags','plans'])assert.ok(after[table].every(r=>r.studentId!==id));
 assert.equal(C.importDatabase(C.exportDatabase(after)).students.length,9);assert.equal(db.students.length,10);
});
test('explicit empty database remains empty; example generation is not a validation fallback',()=>{
 const db=C.createDatabase(false);assert.equal(db.schemaVersion,4);
 for(const table of ['students','scores','tags','plans'])assert.equal(db[table].length,0);
 assert.equal(C.validateDatabase(db).students.length,0);
});
for(const version of [1,2])test('v'+version+' migration retains every original record, revision, hidden class and evidence',()=>{
 const old=legacy(version),before=JSON.stringify(old),db=C.validateDatabase(old);
 assert.equal(JSON.stringify(old),before);assert.equal(db.schemaVersion,4);assert.equal(db.revision,37);
 assert.deepEqual(db.students.map(({subject,isExample,categoryId,...row})=>row),old.students);
 assert.ok(db.students.every(s=>s.isExample===false));assert.deepEqual(db.plans,old.plans);
 for(const table of ['scores','tags']){
  const expected=old[table].map(r=>({...r,subject:r.subject||''}));assert.deepEqual(db[table],expected);
 }
 assert.deepEqual(C.importDatabase(before),db);assert.deepEqual(C.importDatabase(C.exportDatabase(db)),db);
});
test('v2 unique explicit normalized subject is inferred; mixed and unknown histories stay unresolved',()=>{
 const db=C.validateDatabase(legacy(2)),byId=id=>db.students.find(s=>s.id===id);
 assert.equal(byId('A').subject,'Math');assert.equal(byId('B').subject,'');assert.equal(byId('C').subject,'');assert.equal(byId('D').subject,'英语');
 assert.equal(db.scores.find(s=>s.id==='A3').subject,'','unknown exam must not be relabeled during migration');
 assert.equal(db.scores.find(s=>s.id==='B1').subject,'数学');assert.equal(db.scores.find(s=>s.id==='B2').subject,'英语');
 assert.equal(byId('D').isExample,false,'names must not be used to infer legacy example status');
});
test('v1 never infers subject from exam title, note, student name or plan snapshot',()=>{
 const old=legacy(1);old.students[0].name='SYNTHETIC_英语';old.scores[0].title='SYNTHETIC_数学';old.tags[0].note='英语';old.plans[0].sourceEvidence=['SYNTHETIC_数学'];
 assert.ok(C.validateDatabase(old).students.every(s=>s.subject===''));
});
test('migration does not merge same-name student records or borrow another archive subject',()=>{
 const db=C.validateDatabase(legacy(2));assert.equal(db.students.length,4);assert.equal(db.students.filter(s=>s.name==='SYNTHETIC_SAME_NAME').length,3);
 assert.equal(db.students.find(s=>s.id==='C').subject,'');assert.equal(db.scores.find(s=>s.id==='C1').studentId,'C');
});
for(const version of [1,2])for(const[name,change]of[
 ['orphan',db=>{db.scores[0].studentId='SYNTHETIC_MISSING';}],
 ['duplicate id',db=>{db.tags[0].id=db.students[0].id;}],
 ['bad date',db=>{db.scores[0].date='2026-02-30';}],
 ['bad score',db=>{db.scores[0].score=101;}],
 ['bad revision',db=>{db.revision=-1;}]
])test('v'+version+' migration rejects '+name+' without modifying input',()=>{
 const db=legacy(version);change(db);const before=JSON.stringify(db);assert.throws(()=>C.validateDatabase(db));assert.throws(()=>C.importDatabase(before));assert.equal(JSON.stringify(db),before);
});
test('editing old student preserves hidden class, archive subject and example flag when omitted',()=>{
 const db=C.validateDatabase(legacy(2));const before=JSON.stringify(db),student=db.students[0];
 const next=C.saveStudent(db,{id:student.id,name:'SYNTHETIC_RENAMED',grade:'八年级',note:student.note});
 assert.equal(JSON.stringify(db),before);assert.equal(next.students[0].className,student.className);assert.equal(next.students[0].subject,student.subject);assert.equal(next.students[0].isExample,false);
 const example=C.createDatabase(true),edited=C.saveStudent(example,{id:example.students[0].id,name:'SYNTHETIC_EDITED_EXAMPLE',grade:'八年级'});
 assert.equal(edited.students[0].isExample,true);assert.equal(edited.students[0].subject,example.students[0].subject);
});
test('assigning a mixed legacy archive to one subject cannot silently relabel or discard other records',()=>{
 const db=C.validateDatabase(legacy(2)),student=db.students.find(s=>s.id==='B'),before=JSON.stringify(db);
 assert.throws(()=>C.saveStudent(db,{...student,subject:'数学'}));assert.equal(JSON.stringify(db),before);
 const mixed=clone(db);mixed.students.find(s=>s.id==='B').subject='数学';assert.throws(()=>C.importDatabase(JSON.stringify(mixed)));
});
test('new score inherits archive subject while a conflicting explicit subject is rejected',()=>{
 let db=C.saveStudent(C.createDatabase(false),{name:'SYNTHETIC_ARCHIVE',grade:'七年级',subject:'数学'});const id=db.students[0].id;
 db=C.saveScore(db,{studentId:id,title:'SYNTHETIC_INHERITED',date:'2026-10-06',score:0,total:100});assert.equal(db.scores[0].subject,'数学');
 const before=JSON.stringify(db);assert.throws(()=>C.saveScore(db,{studentId:id,title:'SYNTHETIC_OTHER',subject:'英语',date:'2026-10-06',score:100,total:100}));assert.equal(JSON.stringify(db),before);
});
test('schema 4 rejects malformed example flags and overlong archive subjects',()=>{
 for(const flag of ['false',0,null,[]]){const db=C.createDatabase(true);db.students[0].isExample=flag;assert.throws(()=>C.importDatabase(JSON.stringify(db)));}
 const db=C.createDatabase(true);db.students[0].subject='科'.repeat(51);assert.throws(()=>C.importDatabase(JSON.stringify(db)));
});

const D=require(path.join(root,'miniprogram/lib/dashboard.js'));
const S=require(path.join(root,'miniprogram/lib/storage.js'));
const LEGACY_PERSONAL='student-manager-lite.v1.personal',LEGACY_DEMO='student-manager-lite.v1.demo';
function storage(initial={}){
 const disk=new Map(Object.entries(initial)),calls={reads:[],writes:[]},fault={info:false,read:false,write:false};
 const wx={
  getStorageInfoSync(){if(fault.info)throw Error('SYNTHETIC_INFO_FAILURE');return{keys:[...disk.keys()]};},
  getStorageSync(key){calls.reads.push(key);if(fault.read)throw Error('SYNTHETIC_READ_FAILURE');return disk.get(key);},
  setStorageSync(key,value){if(fault.write)throw Error('SYNTHETIC_WRITE_FAILURE');calls.writes.push([key,value]);disk.set(key,value);}
 };
 return{wx,disk,calls,fault};
}
test('composition counts ten archive ids, not exam rows; examples are counted explicitly',()=>{
 const db=C.createDatabase(true),before=JSON.stringify(db),dash=D.buildDashboard(db,{today:'2099-01-01'});
 assert.equal(dash.totals.records,10);assert.equal(dash.totals.examples,10);assert.equal(dash.groups.length,3);
 assert.deepEqual(dash.groups.map(g=>[g.count,g.exampleCount]),[[4,4],[3,3],[3,3]]);assert.equal(dash.groups.reduce((sum,g)=>sum+g.count,0),10);
 assert.equal(db.scores.length,40);assert.equal(JSON.stringify(db),before);
});
test('same-name archives remain separate in groups/cards; filters do not rewrite total counts',()=>{
 const db=C.validateDatabase(legacy(2)),dash=D.buildDashboard(db,{today:'2026-10-06'});
 assert.equal(dash.totals.records,4);assert.equal(dash.groups.reduce((n,g)=>n+g.count,0),4);
 const blank=dash.groups.find(g=>g.key==='unassigned');assert.equal(blank.count,4);
 const filtered=D.buildDashboard(db,{groupKey:blank.key,query:'SYNTHETIC_SAME_NAME',today:'2026-10-06'});
 assert.deepEqual(filtered.cards.map(c=>c.id),['A','B','C']);assert.equal(filtered.totals.records,4);
});
test('empty composition retains an unassigned entry point without fake cards, examples or percentages',()=>{
 const dash=D.buildDashboard(C.createDatabase(false),{groupKey:'SYNTHETIC_MISSING'});
 assert.equal(dash.groups.length,1);assert.equal(dash.groups[0].key,'unassigned');assert.equal(dash.groups[0].count,0);assert.equal(dash.groups[0].ratio,0);assert.deepEqual(dash.cards,[]);assert.equal(dash.selectedKey,'unassigned');
 assert.deepEqual(dash.totals,{records:0,groups:1,examples:0,todo:0});
});
test('category id groups retain differently named grades and subjects as distinct archives',()=>{
 let db=C.saveCategory(C.createDatabase(false),{name:'SYNTHETIC_CATEGORY',total:120});const categoryId=db.categories[0].id;
 for(const[name,grade,subject]of[['SYNTHETIC_1','七年级','Math'],['SYNTHETIC_2','七 年级','ＭＡＴＨ'],['SYNTHETIC_3','七年级','English']])db=C.saveStudent(db,{name,grade,subject,categoryId});
 const dash=D.buildDashboard(db,{});assert.equal(dash.groups.length,1);assert.equal(dash.groups[0].count,3);assert.equal(dash.cards.length,3);assert.equal(new Set(dash.cards.map(c=>c.id)).size,3);
});
test('series never borrows another archive, mismatching subject, unknown exam or future score',()=>{
 const db=C.validateDatabase(legacy(2));db.scores.push(score('A-FUTURE','A','Math','2099-01-01',99));
 const a=D.seriesForStudent(db,'A','2026-10-06');assert.deepEqual(a.map(p=>p.id),['A1','A2']);
 assert.deepEqual(D.seriesForStudent(db,'B','2026-10-06'),[],'unresolved multi-subject archive cannot chart mixed exams');
 assert.deepEqual(D.seriesForStudent(db,'C','2026-10-06').map(p=>p.id),['C1']);assert.deepEqual(D.seriesForStudent(db,'MISSING','2026-10-06'),[]);
});
test('a migrated archive with unplottable records never tells the teacher that no scores exist',()=>{
 const db=C.validateDatabase(legacy(2)),summary=D.buildDashboard(db,{today:'2026-10-06'}),group=summary.groups.find(g=>g.key==='unassigned');
 const card=D.buildDashboard(db,{groupKey:group.key,today:'2026-10-06'}).cards.find(c=>c.id==='B');
 assert.equal(card.scoreCount,2);assert.equal(card.series.length,0);assert.ok(!/尚无成绩|还没有成绩|没有成绩记录/.test(card.latestText));
});
test('series keeps last six by date/id, normalizes different full marks and leaves the database unchanged',()=>{
 let db=C.saveStudent(C.createDatabase(false),{name:'SYNTHETIC_CHART',subject:'数学',grade:'七年级'});const id=db.students[0].id;
 for(let i=9;i>=0;i--)db.scores.push(score('S'+i,id,'数学','2026-10-'+String(i+1).padStart(2,'0'),i===4?0:20,i===5?40:20));
 db=C.validateDatabase(db);const before=JSON.stringify(db),series=D.seriesForStudent(db,id,'2026-10-10');
 assert.deepEqual(series.map(p=>p.id),['S4','S5','S6','S7','S8','S9']);assert.equal(series[0].rate,0);assert.equal(series[1].rate,50);assert.equal(series.at(-1).rate,100);assert.equal(JSON.stringify(db),before);
});
test('duplicate exam dates are stable, and pending-plan filters intersect the selected group and query',()=>{
 const db=C.createDatabase(true);const id=db.students[0].id;db.scores.push(score('SYNTHETIC_Z',id,db.students[0].subject,'2026-10-06',0),score('SYNTHETIC_A',id,db.students[0].subject,'2026-10-06',100));
 const series=D.seriesForStudent(db,id,'2026-10-06'),same=series.filter(s=>s.date==='2026-10-06');assert.deepEqual(same.map(s=>s.id),['SYNTHETIC_A','SYNTHETIC_Z']);
 const all=D.buildDashboard(db,{}),group=all.groups.find(g=>g.key===db.students[0].categoryId);
 const dash=D.buildDashboard(db,{groupKey:group.key,todoOnly:true,query:db.students[0].name});assert.deepEqual(dash.cards.map(c=>c.id),[id]);assert.equal(dash.cards[0].todo,1);
 assert.equal(D.buildDashboard(db,{groupKey:group.key,todoOnly:true,query:'SYNTHETIC_NOT_FOUND'}).cards.length,0);
});
test('deleting a category last archive keeps the empty category and never resurrects examples',()=>{
 let db=C.createDatabase(true);const initial=D.buildDashboard(db,{}),key=initial.selectedKey;
 const ids=initial.cards.map(c=>c.id);for(const id of ids)db=C.deleteStudent(db,id);
 const next=D.buildDashboard(db,{groupKey:key});assert.equal(next.selectedKey,key);assert.equal(next.totals.records,6);assert.equal(next.totals.examples,6);assert.equal(next.cards.length,0);assert.equal(next.selectedGroup.count,0);
});
test('archive existing empty or corrupt takes precedence without touching legacy stores',()=>{
 for(const raw of [C.exportDatabase(C.createDatabase(false)),'SYNTHETIC_BAD_JSON']){
  const e=storage({[S.KEY]:raw,[LEGACY_PERSONAL]:JSON.stringify(legacy()),[LEGACY_DEMO]:'SYNTHETIC_OLD_DEMO'}),r=S.read(e.wx);
  assert.equal(r.raw,raw);assert.equal(r.legacy,false);assert.equal(r.present,true);assert.equal(r.legacyDemoAvailable,true);assert.deepEqual(e.calls.reads,[S.KEY]);assert.equal(e.calls.writes.length,0);
 }
});
test('legacy personal remains authoritative even when empty or corrupt; old demo is never merged/read implicitly',()=>{
 for(const raw of [JSON.stringify({...legacy(),students:[],scores:[],tags:[],plans:[]}),'SYNTHETIC_BROKEN_PERSONAL']){
  const e=storage({[LEGACY_PERSONAL]:raw,[LEGACY_DEMO]:'SYNTHETIC_OLD_DEMO'}),r=S.read(e.wx);
  assert.equal(r.raw,raw);assert.equal(r.present,true);assert.equal(r.legacy,true);assert.equal(r.legacyDemoAvailable,true);assert.deepEqual(e.calls.reads,[LEGACY_PERSONAL]);assert.equal(e.disk.has(S.KEY),false);
 }
});
test('only legacy demo is treated as no current archive, with raw export available only through explicit call',()=>{
 const raw='SYNTHETIC_OLD_DEMO',e=storage({[LEGACY_DEMO]:raw}),r=S.read(e.wx);
 assert.equal(r.present,false);assert.equal(r.legacy,false);assert.equal(r.raw,undefined);assert.equal(e.calls.reads.length,0);assert.equal(r.legacyDemoAvailable,true);
 assert.equal(S.legacyRaw(e.wx,'demo'),raw);assert.throws(()=>S.legacyRaw(e.wx,'__proto__'));assert.throws(()=>S.legacyRaw(e.wx,'personal'));assert.equal(e.calls.writes.length,0);
});
test('successful migration writes only new archive key and retains both legacy byte strings',()=>{
 const raw=JSON.stringify(legacy()),demo='SYNTHETIC_LEGACY_DEMO',e=storage({[LEGACY_PERSONAL]:raw,[LEGACY_DEMO]:demo}),r=S.read(e.wx);
 const next=S.commit(e.wx,C.importDatabase(r.raw),r.token);assert.equal(next.legacy,false);assert.equal(next.token,S.read(e.wx).token);
 assert.equal(JSON.parse(e.disk.get(S.KEY)).schemaVersion,4);assert.equal(e.disk.get(LEGACY_PERSONAL),raw);assert.equal(e.disk.get(LEGACY_DEMO),demo);assert.deepEqual(e.calls.writes.map(c=>c[0]),[S.KEY]);
});
for(const mode of ['info','read','write'])test('migration '+mode+' failure cannot create an archive or change old keys',()=>{
 const raw=JSON.stringify(legacy()),e=storage({[LEGACY_PERSONAL]:raw,[LEGACY_DEMO]:'SYNTHETIC_DEMO'}),r=S.read(e.wx);e.fault[mode]=true;
 assert.throws(()=>S.commit(e.wx,C.importDatabase(r.raw),r.token));assert.equal(e.disk.has(S.KEY),false);assert.equal(e.disk.get(LEGACY_PERSONAL),raw);assert.equal(e.disk.get(LEGACY_DEMO),'SYNTHETIC_DEMO');assert.equal(e.calls.writes.length,0);
});
test('first read failure is an error, never interpreted as an empty database',()=>{
 const e=storage({[LEGACY_PERSONAL]:JSON.stringify(legacy())});e.fault.info=true;assert.throws(()=>S.read(e.wx));e.fault.info=false;e.fault.read=true;assert.throws(()=>S.read(e.wx));assert.equal(e.calls.writes.length,0);
});
test('legacy personal edits or another writer creating archive abort a stale migration',()=>{
 for(const changed of [LEGACY_PERSONAL,S.KEY]){
  const raw=JSON.stringify(legacy()),e=storage({[LEGACY_PERSONAL]:raw}),r=S.read(e.wx);const external=C.exportDatabase(C.createDatabase(false));e.disk.set(changed,external);
  assert.throws(()=>S.commit(e.wx,C.importDatabase(r.raw),r.token));assert.equal(e.disk.get(changed),external);assert.equal(e.calls.writes.length,0);
 }
});
test('oversized migrated archive is rejected before any write and retains original source',()=>{
 const old={schemaVersion:2,revision:0,students:[],scores:[],tags:[],plans:[]};for(let i=0;i<170;i++)old.students.push({...oldStudent('SYNTHETIC_BIG_'+i),note:'测'.repeat(2000)});
 const raw=JSON.stringify(old),e=storage({[LEGACY_PERSONAL]:raw}),r=S.read(e.wx),db=C.importDatabase(raw);assert.ok(Buffer.byteLength(C.exportDatabase(db),'utf8')>900*1024);
 assert.throws(()=>S.commit(e.wx,db,r.token),/容量|上限/);assert.equal(e.disk.has(S.KEY),false);assert.equal(e.disk.get(LEGACY_PERSONAL),raw);assert.equal(e.calls.writes.length,0);
});
function drawHarness(points,width=240,height=116,options={}){
 let definition;const coordinates=[],labels=[],calls=[],updates=[],exports=[],frames=[],queries=[];
 const ctx={scale:(...v)=>calls.push(['scale',...v]),clearRect:(...v)=>calls.push(['clear',...v]),beginPath(){},moveTo:(...v)=>coordinates.push(v),lineTo:(...v)=>coordinates.push(v),stroke(){},fill(){},arc:(...v)=>{coordinates.push(v.slice(0,2));calls.push(['arc',...v]);},fillText:(text,x,y)=>{labels.push(text);coordinates.push([x,y]);}};
 const node={getContext:()=>ctx};if(!options.noFrame)node.requestAnimationFrame=fn=>{calls.push(['frame']);if(options.deferFrame)frames.push(fn);else fn();};
 const context=vm.createContext({Component:value=>{definition=value;},wx:{nextTick:fn=>{calls.push(['nextTick']);fn();},getWindowInfo:()=>({pixelRatio:2}),canvasToTempFilePath(request,owner){calls.push(['export']);exports.push({request,owner});if(!options.deferExport)request.success({tempFilePath:'SYNTHETIC_LOCAL_CHART.png'});}}});
 vm.runInContext(fs.readFileSync(path.join(root,'miniprogram/components/score-line/index.js'),'utf8'),context);
 const component={data:{...definition.data,points,height},_ready:true,setData(values){updates.push({...values});Object.assign(this.data,values);},createSelectorQuery(){return{select(){return this;},fields(){return this;},exec(cb){calls.push(['query']);const resolve=()=>cb([{node,width,height}]);if(options.deferQuery)queries.push(resolve);else resolve();}};}};
 Object.assign(component,definition.methods);component._draw();return{coordinates,labels,calls,node,component,updates,exports,frames,queries,redraw(next){component.data.points=next;component._draw();},detach(){definition.lifetimes.detached.call(component);}};
}
test('line rendering empty data produces no fake points or invalid coordinates',()=>{
 const h=drawHarness([]);assert.equal(h.coordinates.length,0);assert.equal(h.calls.filter(c=>c[0]==='arc').length,0);
});
for(const [name,points]of[
 ['single zero',[{date:'2026-10-06',rate:0}]],
 ['single full',[{date:'2026-10-06',rate:100}]],
 ['same day endpoints',[{date:'2026-10-06',rate:0},{date:'2026-10-06',rate:100}]],
 ['flat zero',[{date:'2026-10-01',rate:0},{date:'2026-10-06',rate:0}]],
 ['different full marks',[{date:'2026-10-01',rate:50},{date:'2026-10-06',rate:100}]]
])test('line canvas coordinates stay finite and within its viewport: '+name,()=>{
 const h=drawHarness(points);assert.equal(h.calls.filter(c=>c[0]==='arc').length,points.length);assert.ok(h.coordinates.length);
 for(const[x,y]of h.coordinates){assert.ok(Number.isFinite(x)&&Number.isFinite(y));assert.ok(x>=0&&x<=240&&y>=0&&y<=116,`out of bounds ${x},${y}`);}
 assert.equal(h.node.width,480);assert.equal(h.node.height,232);assert.ok(h.labels.includes(points.at(-1).rate+'%'));
});
test('line raster export is local, uses device-sized pixels and sets the regular-image source',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:50}]);assert.equal(h.exports.length,1);const {request,owner}=h.exports[0];
 assert.equal(request.canvas,h.node);assert.equal(request.destWidth,480);assert.equal(request.destHeight,232);assert.equal(request.fileType,'png');assert.equal(owner,h.component);
 assert.equal(h.component.data.chartImage,'SYNTHETIC_LOCAL_CHART.png');assert.equal(h.component.data.chartFailed,false);assert.ok(h.calls.findIndex(c=>c[0]==='frame')<h.calls.findIndex(c=>c[0]==='export'));
});
test('line export failure clears the previous image, reports failure and allows a later draw to succeed',()=>{
 const points=[{date:'2026-10-06',rate:50}],h=drawHarness(points,240,116,{deferExport:true});h.exports[0].request.success({tempFilePath:'SYNTHETIC_OLD.png'});h.redraw(points);assert.equal(h.component.data.chartImage,'');
 h.exports[1].request.fail();assert.equal(h.component.data.chartImage,'');assert.equal(h.component.data.chartFailed,true);h.redraw(points);assert.equal(h.component.data.chartFailed,false);
 h.exports[2].request.success({tempFilePath:'SYNTHETIC_RECOVERED.png'});assert.equal(h.component.data.chartImage,'SYNTHETIC_RECOVERED.png');assert.equal(h.component.data.chartFailed,false);
});
test('older asynchronous raster success or failure cannot replace the latest chart state',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:0}],240,116,{deferExport:true});h.redraw([{date:'2026-10-06',rate:100}]);h.exports[1].request.success({tempFilePath:'SYNTHETIC_NEW.png'});const count=h.updates.length;
 h.exports[0].request.success({tempFilePath:'SYNTHETIC_STALE.png'});h.exports[0].request.fail();assert.equal(h.updates.length,count);assert.equal(h.component.data.chartImage,'SYNTHETIC_NEW.png');assert.equal(h.component.data.chartFailed,false);
});
test('detached component ignores pending export success and failure without another state write',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:50}],240,116,{deferExport:true});h.detach();const count=h.updates.length;h.exports[0].request.success({tempFilePath:'SYNTHETIC_DETACHED.png'});h.exports[0].request.fail();assert.equal(h.updates.length,count);assert.equal(h.component.data.chartImage,'');assert.equal(h.component.data.chartFailed,false);
});
test('empty points remove an old image and invalidate late export callbacks',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:50}],240,116,{deferExport:true});h.exports[0].request.success({tempFilePath:'SYNTHETIC_OLD.png'});h.redraw([]);const count=h.updates.length;
 assert.equal(h.component.data.chartImage,'');assert.equal(h.component.data.chartFailed,false);assert.equal(h.exports.length,1);h.exports[0].request.success({tempFilePath:'SYNTHETIC_LATE.png'});h.exports[0].request.fail();assert.equal(h.updates.length,count);assert.equal(h.component.data.chartImage,'');
});
test('outdated selector results do not draw or export after a newer paint begins',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:0}],240,116,{deferQuery:true});h.redraw([{date:'2026-10-06',rate:100}]);h.queries[0]();assert.equal(h.coordinates.length,0);assert.equal(h.exports.length,0);h.queries[1]();assert.equal(h.exports.length,1);assert.ok(h.labels.includes('100%'));assert.ok(!h.labels.includes('0%'));
});
test('stale animation-frame callback cannot export an earlier paint',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:0}],240,116,{deferFrame:true});h.redraw([{date:'2026-10-06',rate:100}]);h.frames[0]();assert.equal(h.exports.length,0);h.frames[1]();assert.equal(h.exports.length,1);assert.equal(h.component.data.chartImage,'SYNTHETIC_LOCAL_CHART.png');
});
test('detaching before the animation frame prevents export and further state writes',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:50}],240,116,{deferFrame:true});h.detach();const count=h.updates.length;h.frames[0]();assert.equal(h.exports.length,0);assert.equal(h.updates.length,count);
});
test('canvas without requestAnimationFrame uses the next-tick export fallback',()=>{
 const h=drawHarness([{date:'2026-10-06',rate:50}],240,116,{noFrame:true});assert.equal(h.calls.filter(c=>c[0]==='frame').length,0);assert.equal(h.calls.filter(c=>c[0]==='nextTick').length,1);assert.equal(h.exports.length,1);assert.equal(h.component.data.chartImage,'SYNTHETIC_LOCAL_CHART.png');
});
