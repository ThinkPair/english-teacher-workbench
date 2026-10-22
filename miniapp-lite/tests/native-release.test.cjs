'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,KEY,PERSONAL,event,snapshot,harness,emptyHarness,personal,addScore,addTag,legacy}=require('./qa-native-harness.cjs');
test('group composition counts archives and example membership; selecting a group does not alter data',()=>{
 const h=harness();h.page.onLoad();const old=h.store.get(KEY);assert.equal(h.page.data.totals.records,10);assert.equal(h.page.data.totals.examples,10);assert.equal(h.page.data.groups.length,3);
 for(const group of h.page.data.groups){h.page.onSelectGroup(event({key:group.key}));assert.equal(h.page.data.rows.length,group.count);assert.ok(h.page.data.rows.every(r=>r.categoryName===group.name&&r.subject==='英语'&&r.isExample));assert.equal(h.store.get(KEY),old);}
});
test('new English archive in another category becomes visible without changing another archive',()=>{
 const h=personal(),first=snapshot(h.page._db.students[0]);h.page.onAddCategory();h.page.onFieldInput(event({field:'name'},'SYNTHETIC_CATEGORY'));h.page.onFieldInput(event({field:'total'},'120'));h.page.onSaveForm();h.page.onAddStudent();for(const[field,value]of Object.entries({name:'SYNTHETIC_OTHER_GRADE',grade:'八年级'}))h.page.onFieldInput(event({field},value));h.page.onSaveForm();
 assert.equal(h.page._db.students.length,2);assert.equal(snapshot(h.page._db.students[0]),first);assert.equal(h.page.data.rows.length,1);assert.equal(h.page.data.rows[0].name,'SYNTHETIC_OTHER_GRADE');assert.equal(h.page.data.rows[0].isExample,false);assert.equal(h.page.data.rows[0].subject,'英语');
});
test('single-subject score creation inherits archive and later forged cross-subject save is refused',()=>{
 const h=personal();addScore(h);assert.equal(h.page._db.scores[0].subject,'英语');const old=h.store.get(KEY);h.page.onAddScore();for(const[field,value]of Object.entries({title:'SYNTHETIC_FORGED',subject:'数学',score:'10',total:'100'}))h.page.onFieldInput(event({field},value));assert.equal(h.page.data.form.subject,'英语');h.page.data.form.subject='数学';h.page.onSaveForm();assert.equal(h.store.get(KEY),old);assert.match(h.page.data.error,/学科|科目/);
});
for(const grade of ['一年级','九年级','高三'])test('English default supports a non-demo school grade: '+grade,()=>{
 const h=emptyHarness();h.page.onAddStudent();assert.equal(h.page.data.form.subject,'英语');assert.equal(h.page.data.formSubjectFixed,true);
 h.page.onFieldInput(event({field:'name'},'SYNTHETIC_STAGE'));h.page.onFieldInput(event({field:'grade'},grade));h.page.onSaveForm();
 assert.equal(h.page._db.students.length,1);assert.equal(h.page._db.students[0].grade,grade);assert.equal(h.page._db.students[0].subject,'英语');assert.equal(h.page._db.students[0].isExample,false);
});
test('new archive English default cannot be bypassed through field events or a forged form subject',()=>{
 const h=emptyHarness();h.page.onAddStudent();h.page.onFieldInput(event({field:'subject'},'数学'));assert.equal(h.page.data.form.subject,'英语');
 h.page.onFieldInput(event({field:'isExample'},true));assert.equal(h.page.data.form.isExample,false);h.page.onFieldInput(event({field:'name'},'SYNTHETIC_FIXED'));h.page.onFieldInput(event({field:'grade'},'高二'));
 h.page.data.form.subject='数学';h.page.onSaveForm();assert.equal(h.page._db.students[0].subject,'英语');assert.equal(h.page.data.rows[0].subject,'英语');
});
test('normal English score and knowledge tag inherit owner without a subject entry step',()=>{
 const h=personal();addScore(h);addTag(h);assert.equal(h.page._db.scores[0].subject,'英语');assert.equal(h.page._db.tags[0].subject,'英语');assert.equal(h.page._db.tags[0].studentId,h.page._db.students[0].id);
 const raw=h.store.get(KEY);h.page.onAddTag(event({type:'strong'}));h.page.onFieldInput(event({field:'label'},'SYNTHETIC_OTHER_TOPIC'));h.page.onFieldInput(event({field:'subject'},'数学'));assert.equal(h.page.data.form.subject,'英语');h.page.data.form.subject='数学';h.page.onSaveForm();assert.equal(h.store.get(KEY),raw);assert.match(h.page.data.error,/科目|学科/);
});
test('English positioning does not force legacy non-English archive or its new records to English',()=>{
 const old=legacy(),raw=snapshot(old),h=harness({[PERSONAL]:raw});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));addScore(h);addTag(h);
 assert.equal(h.page._db.students[0].subject,'数学');assert.ok(h.page._db.scores.every(s=>s.subject==='数学'));assert.equal(h.page._db.tags[0].subject,'数学');assert.equal(h.store.get(PERSONAL),raw);
 h.page.onAddTag(event({type:'weak'}));assert.equal(h.page.data.quickTagLabels.length,0);const draft=snapshot(h.page.data.form);h.page.onQuickTag(event({label:'一般过去时'}));assert.equal(snapshot(h.page.data.form),draft);
});
test('editing unknown old scores and general old tags under an English archive preserves their blank subjects',()=>{
 const old=legacy();old.scores[0].subject='英语';old.scores.push({...old.scores[0],id:'OLD-U',subject:''});old.tags.push({id:'OLD-T',studentId:'OLD',subject:'',type:'habit',label:'SYNTHETIC_OLD_HABIT',note:'',observedOn:'2026-10-06',status:'active'});
 const h=harness({[PERSONAL]:snapshot(old)});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));assert.equal(h.page.data.student.subject,'英语');
 for(const[kind,id]of [['score','OLD-U'],['tag','OLD-T']]){h.page.onEditRecord(event({kind,id}));assert.equal(h.page.data.form.subject,'');h.page.onFieldInput(event({field:'note'},'SYNTHETIC_NOTE_ONLY'));h.page.onSaveForm();assert.equal(h.page._db[kind==='score'?'scores':'tags'].find(r=>r.id===id).subject,'');}
 assert.equal(h.page.data.chart.length,1);assert.equal(h.page._db.scores.length,2);
});
test('tag scope switches only explicitly between current archive and general observation',()=>{
 const h=personal();h.page.onAddTag(event({type:'habit'}));assert.equal(h.page.data.form.subject,'');h.page.onTagScope(event({scope:'archive'}));assert.equal(h.page.data.form.subject,'英语');h.page.onTagScope(event({scope:'数学'}));assert.equal(h.page.data.form.subject,'英语');
 h.page.onTagScope(event({scope:'general'}));h.page.onFieldInput(event({field:'label'},'SYNTHETIC_GENERAL'));h.page.onSaveForm();assert.equal(h.page._db.tags[0].subject,'');
 h.page.onAddScore();const score=snapshot(h.page.data.form);h.page.onTagScope(event({scope:'general'}));assert.equal(snapshot(h.page.data.form),score);
});
test('quick tags remain editable drafts, reject unknown labels, and do not duplicate saved active tags',()=>{
 const h=personal();h.page.onAddTag(event({type:'weak'}));assert.equal(h.page.data.quickTagLabels.length,4);const label=h.page.data.quickTagLabels[0],raw=h.store.get(KEY);
 h.page.onQuickTag(event({label:'SYNTHETIC_FORGED_CHIP'}));assert.equal(h.page.data.form.label,'');h.page.onQuickTag(event({label}));assert.equal(h.page.data.form.label,label);assert.equal(h.page._dirty,true);assert.equal(h.store.get(KEY),raw);h.page.onSaveForm();assert.equal(h.page._db.tags.length,1);
 h.page.onAddTag(event({type:'weak'}));h.page.onQuickTag(event({label}));h.page.onSaveForm();assert.equal(h.page._db.tags.length,1);assert.match(h.page.data.error,/已有|标签/);
 h.page.onFieldInput(event({field:'label'},'SYNTHETIC_TEACHER_EDITED'));h.page.onSaveForm();assert.equal(h.page._db.tags.length,2);
});
test('tag type changes refresh quick choices and reject stale or overlong labels without saving',()=>{
 const h=personal();h.page.onAddTag(event({type:'weak'}));const old=h.page.data.quickTagLabels[0];h.page.onTagType(event({},'2'));assert.equal(h.page.data.form.type,'habit');assert.equal(h.page.data.quickTagLabels.length,2);h.page.onQuickTag(event({label:old}));assert.equal(h.page.data.form.label,'');
 h.page.onQuickTag(event({label:h.page.data.quickTagLabels[0]}));assert.ok(h.page.data.form.label);h.page.onFieldInput(event({field:'label'},'长'.repeat(81)));h.page.onSaveForm();assert.equal(h.page._db.tags.length,0);assert.match(h.page.data.error,/长度|80|过长/);
});
test('a quick-tag draft stays attached to its original archive even if the visible student object changes',()=>{
 const h=harness();h.page.onLoad();const a=h.page._db.students[0],b=h.page._db.students[1];h.page.onOpenStudent(event({id:a.id}));h.page.onAddTag(event({type:'strong'}));h.page.onFieldInput(event({field:'label'},'SYNTHETIC_PINNED_DRAFT'));
 h.page.data.student=b;h.page.data.form.studentId=b.id;h.page.onSaveForm();const tag=h.page._db.tags.find(t=>t.label==='SYNTHETIC_PINNED_DRAFT');assert.ok(tag);assert.equal(tag.studentId,a.id);
});
test('legacy mixed-subject charts never combine subjects, while all legacy rows remain accessible',()=>{
 const old=legacy();old.scores.push({...old.scores[0],id:'OLD-E',subject:'英语',title:'SYNTHETIC_ENGLISH'});const h=harness({[PERSONAL]:snapshot(old)});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));
 assert.equal(h.page.data.student.subject,'');assert.equal(h.page.data.scores.length,2);assert.equal(h.page.data.chart.length,0);assert.match(h.page.data.chartMessage,/待整理|核对/);
 const math=h.page.data.scoreSubjectOptions.findIndex(o=>o.value==='数学');h.page.onScoreSubject(event({},String(math)));assert.equal(h.page.data.visibleScores.length,1);assert.equal(h.page.data.visibleScores[0].subject,'数学');assert.equal(h.page.data.chart.length,0);assert.equal(h.page._db.scores.length,2);
});
test('unclassified old scores are not relabeled or mixed into a known-subject line',()=>{
 const old=legacy();old.scores.push({...old.scores[0],id:'OLD-U',subject:'',title:'SYNTHETIC_UNKNOWN'});const h=harness({[PERSONAL]:snapshot(old)});h.page.onLoad();h.page.onOpenStudent(event({id:'OLD'}));assert.equal(h.page.data.student.subject,'数学');assert.equal(h.page.data.scores.length,2);assert.equal(h.page.data.chart.length,1);assert.equal(h.page.data.chart[0].id,'OLD-S');assert.equal(h.page._db.scores.find(s=>s.id==='OLD-U').subject,'');
});
test('todo and search filters apply inside a group and completing the final plan removes its todo card',async()=>{
 const h=harness();h.page.onLoad();const id=h.page._db.plans[0].studentId,student=h.page._db.students.find(s=>s.id===id),group=h.page.data.groups.find(g=>g.key===student.categoryId);
 h.page.onSelectGroup(event({key:group.key}));h.page.onListFilter(event({filter:'todo'}));assert.deepEqual(Array.from(h.page.data.rows,r=>r.id),[id]);h.page.onSearch(event({},'SYNTHETIC_NO_MATCH'));assert.equal(h.page.data.rows.length,0);h.page.onSearch(event({},''));
 h.page.onOpenStudent(event({id}));assert.equal(h.page.data.detailTab,'plans');h.page.onEditRecord(event({kind:'complete',id:h.page._db.plans[0].id}));h.page.onFieldInput(event({field:'result'},'SYNTHETIC_COMPLETE'));h.page.onSaveForm();await h.page.onHome();assert.equal(h.page.data.rows.length,0);assert.equal(h.page.data.totals.todo,0);
});
test('source has no network, login, payment, clipboard-read or public sharing capability',()=>{
 const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.js$/.test(e.name))files.push(p);}}walk(root);
 const forbidden=/\bwx\s*\.\s*(?:request|uploadFile|downloadFile|connectSocket|login|requestPayment|requestVirtualPayment|getClipboardData)\s*\(|\bwx\s*\.\s*cloud\b|\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bonShareAppMessage\s*[:(]|\bonShareTimeline\s*[:(]/;
 for(const file of files)assert.ok(!forbidden.test(fs.readFileSync(file,'utf8')),path.relative(root,file)+' needs a new privacy review');
 const markup=fs.readFileSync(path.join(root,'pages/index/index.wxml'),'utf8');assert.ok(!/bindtap="onSwitchSpace"|data-field="className"/.test(markup));assert.ok(/score-line/.test(markup));
});
