'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {KEY,PERSONAL,DEMO,event,snapshot,harness,personal,prepareImport,legacy}=require('./qa-native-harness.cjs');
test('a valid empty legacy personal archive never receives the ten examples',()=>{
 const old={...legacy(),students:[],scores:[],tags:[],plans:[]},raw=snapshot(old),h=harness({[PERSONAL]:raw,[DEMO]:'SYNTHETIC_OLD_DEMO'});h.page.onLoad();
 assert.equal(h.page._db.students.length,0);assert.equal(h.page._db.schemaVersion,4);assert.equal(h.store.has(KEY),false);assert.equal(h.store.get(PERSONAL),raw);assert.equal(h.store.get(DEMO),'SYNTHETIC_OLD_DEMO');assert.equal(h.state.writes.length,0);assert.ok(!h.state.reads.includes(DEMO));
});
test('corrupt legacy personal remains blocked instead of falling back to old demo or new examples',()=>{
 const h=harness({[PERSONAL]:'SYNTHETIC_BAD_PERSONAL',[DEMO]:'SYNTHETIC_OLD_DEMO'});h.page.onLoad();assert.equal(h.page._db,null);assert.equal(h.page.data.blocked,true);assert.equal(h.page.data.view,'backup');assert.equal(h.page._raw,'SYNTHETIC_BAD_PERSONAL');assert.equal(h.store.has(KEY),false);assert.equal(h.state.writes.length,0);
});
test('corrupt new archive takes precedence over a valid legacy personal archive',()=>{
 const old=snapshot(legacy()),h=harness({[KEY]:'SYNTHETIC_BAD_ARCHIVE',[PERSONAL]:old});h.page.onLoad();assert.equal(h.page._db,null);assert.equal(h.page.data.blocked,true);assert.equal(h.page._raw,'SYNTHETIC_BAD_ARCHIVE');assert.equal(h.store.get(PERSONAL),old);assert.ok(!h.state.reads.includes(PERSONAL));assert.equal(h.state.writes.length,0);
});
test('existing empty new archive remains authoritative and is not reseeded on reload',()=>{
 const empty=snapshot({schemaVersion:3,revision:91,students:[],scores:[],tags:[],plans:[]}),h=harness({[KEY]:empty,[PERSONAL]:snapshot(legacy())});h.page.onLoad();h.page._loadSpace('archive');assert.equal(h.page._db.students.length,0);assert.equal(h.page._db.revision,91);assert.equal(h.store.get(KEY),empty);assert.equal(h.state.writes.length,0);
});
for(const fault of ['infoFailure','readFailure'])test('initial '+fault+' blocks without silently generating data',()=>{
 const raw=snapshot(legacy()),h=harness({[PERSONAL]:raw});h.state[fault]=true;h.page.onLoad();assert.equal(h.page._db,null);assert.equal(h.page.data.blocked,true);assert.equal(h.state.writes.length,0);assert.equal(h.store.has(KEY),false);assert.equal(h.store.get(PERSONAL),raw);assert.equal(h.page.data.canCopyRaw,false);
});
test('initial example creation failure never exposes unsaved example records',()=>{
 const h=harness();h.state.writeFailure=true;h.page.onLoad();assert.equal(h.page._db,null);assert.equal(h.page.data.blocked,true);assert.equal(h.page.data.rows.length,0);assert.equal(h.store.size,0);
});
test('first legacy edit migration writes only after success and preserves original legacy keys',()=>{
 const raw=snapshot(legacy()),h=harness({[PERSONAL]:raw,[DEMO]:'SYNTHETIC_DEMO'});h.page.onLoad();const before=snapshot(h.page._db);assert.equal(h.store.has(KEY),false);
 h.page.onOpenStudent(event({id:'OLD'}));h.page.onEditStudent();h.page.onFieldInput(event({field:'note'},'SYNTHETIC_EDIT'));h.state.writeFailure=true;h.page.onSaveForm();
 assert.equal(snapshot(h.page._db),before);assert.equal(h.store.has(KEY),false);assert.equal(h.store.get(PERSONAL),raw);assert.ok(h.page._draftContext);assert.equal(h.page.data.form.note,'SYNTHETIC_EDIT');
 h.state.writeFailure=false;h.page.onSaveForm();assert.equal(JSON.parse(h.store.get(KEY)).revision,9);assert.equal(h.store.get(PERSONAL),raw);assert.equal(h.store.get(DEMO),'SYNTHETIC_DEMO');assert.equal(h.state.writes.length,1);
});
test('external legacy edit before the first save stops stale migration',()=>{
 const old=legacy(),h=harness({[PERSONAL]:snapshot(old)});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));h.page.onEditStudent();h.page.onFieldInput(event({field:'note'},'SYNTHETIC_STALE'));
 old.students[0].note='SYNTHETIC_EXTERNAL';const external=snapshot(old);h.store.set(PERSONAL,external);h.page.onSaveForm();assert.equal(h.store.has(KEY),false);assert.equal(h.store.get(PERSONAL),external);assert.match(h.page.data.error,/没有覆盖/);
});
test('deleting all ten examples persists an empty archive and restart does not reseed',async()=>{
 const h=harness();h.page.onLoad();const ids=h.page._db.students.map(s=>s.id);
 for(const id of ids){h.page.onOpenStudent(event({id}));await h.page.onDeleteStudent();}
 assert.equal(h.page._db.students.length,0);for(const table of ['scores','tags','plans'])assert.equal(h.page._db[table].length,0);
 const reopened=harness(Object.fromEntries(h.store));reopened.page.onLoad();assert.equal(reopened.page._db.students.length,0);assert.equal(reopened.state.writes.length,0);
});
test('old demo only is preserved, never merged, and requires explicit confirmation to export',async()=>{
 const raw='SYNTHETIC_OLD_DEMO_WITH_USER_ADDITIONS',h=harness({[DEMO]:raw});h.page.onLoad();assert.equal(h.page._db.students.length,10);assert.equal(h.page.data.legacyDemoAvailable,true);assert.equal(h.state.clipboard.length,0);const archive=h.store.get(KEY);
 h.state.confirm=false;await h.page.onExportLegacyDemo();assert.equal(h.state.clipboard.length,0);h.state.confirm=true;await h.page.onExportLegacyDemo();assert.equal(h.state.clipboard[0],raw);assert.equal(h.store.get(KEY),archive);assert.equal(h.store.get(DEMO),raw);
});
test('corrupt new archive allows explicit raw backup and replacement without touching old personal',async()=>{
 const raw='SYNTHETIC_CORRUPT_ARCHIVE',old=snapshot(legacy()),h=harness({[KEY]:raw,[PERSONAL]:old});h.page.onLoad();await h.page.onCopyRaw();assert.equal(h.state.clipboard[0],raw);
 const replacement=h.core.saveStudent(h.core.createDatabase(false),h.parse('{"name":"SYNTHETIC_RECOVERED","grade":"七年级","subject":"数学"}'));prepareImport(h,replacement);await h.page.onApplyImport();assert.equal(h.page.data.blocked,false);assert.equal(h.page._db.students.length,1);assert.equal(h.page._db.revision,1);assert.equal(h.store.get(PERSONAL),old);
});
test('reload read failure retains current database and actionable editable draft',async()=>{
 const h=personal();h.page.onAddScore();h.page.onFieldInput(event({field:'title'},'SYNTHETIC_DRAFT'));const before=snapshot(h.page._db);h.state.infoFailure=true;await h.page.onReload();
 assert.equal(snapshot(h.page._db),before);assert.equal(h.page.data.view,'form');assert.ok(h.page._draftContext);assert.equal(h.page.data.form.title,'SYNTHETIC_DRAFT');assert.match(h.page.data.error,/读取/);
});
test('oversized but valid restore retains old archive, checked backup and replacement text',async()=>{
 const h=personal(),old=h.store.get(KEY),incoming={schemaVersion:4,revision:0,categories:[],students:[],scores:[],tags:[],plans:[]};for(let i=0;i<170;i++)incoming.students.push({id:'SYNTHETIC_BIG_'+i,name:'合成学员'+i,grade:'七年级',subject:'数学',isExample:false,categoryId:'',className:'',note:'测'.repeat(2000)});
 const text=snapshot(incoming);h.core.importDatabase(text);assert.ok(Buffer.byteLength(text)>900*1024);h.page.onImportInput(event({},text));h.page.onCheckImport();h.page.onImportAgree(event({},['replace']));await h.page.onApplyImport();assert.equal(h.store.get(KEY),old);assert.equal(h.page.data.importText,text);assert.ok(h.page.data.importPreview);assert.match(h.page.data.error,/容量|上限/);
});
