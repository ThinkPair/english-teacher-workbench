'use strict';
// Independent projection and native interaction QA, with 0.6.0 chart styling. Synthetic data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('../miniprogram/lib/core.js'),M=require('../miniprogram/lib/comparison.js');
const {root,KEY,event,snapshot,harness,emptyHarness}=require('./qa-native-harness.cjs');
function student(id,subject='英语',categoryId='C1',name='SYNTHETIC_SAME_NAME'){return{id,name,grade:'七年级',className:'',note:'',subject,isExample:false,categoryId};}
function score(id,studentId,date,value,total=100,subject='英语'){return{id,studentId,date,score:value,total,subject,title:'SYNTHETIC_EXAM_'+id,note:''};}
function fixture(){return C.validateDatabase({schemaVersion:4,revision:5,categories:[{id:'C1',name:'SYNTHETIC_SELECTED',total:150},{id:'C2',name:'SYNTHETIC_OTHER',total:120},{id:'CE',name:'SYNTHETIC_EMPTY',total:80}],
 students:[student('A'),student('B','英 语'),student('N','英语','C1','SYNTHETIC_NO_SCORE'),student('M','数学'),student('U',''),student('Z','英语','C2')],
 scores:[score('A1','A','2026-10-01',0),score('A2','A','2026-10-05',80),score('B1','B','2026-10-02',60),score('B2','B','2026-10-05',100),score('M1','M','2026-10-03',90,120,'数学'),score('U1','U','2026-10-04',70),score('Z1','Z','2026-10-05',80,120)],tags:[],
 plans:[{id:'P1',studentId:'A',title:'SYNTHETIC_TODO',body:'SYNTHETIC_BODY',dueDate:'',status:'todo',result:'',sourceEvidence:[]}]});}
function compare(db,extra={}){return M.buildComparison(db,{groupKey:'C1',today:'2026-10-06',...extra});}
function native(db=fixture()){const h=harness({[KEY]:snapshot(db)});h.page.onLoad();h.page.onSelectGroup(event({key:'C1'}));return h;}

test('selected category and normalized subject retain all members including names with no scores',()=>{
 const db=fixture(),before=snapshot(db),x=compare(db);assert.equal(snapshot(db),before);assert.equal(x.recordCount,5);assert.equal(x.studentCount,3);assert.equal(x.plottedCount,2);assert.equal(x.unplottedCount,1);assert.equal(x.unknownCount,1);assert.deepEqual(x.series.map(s=>s.id),['A','B','N']);assert.equal(x.series[2].points.length,0);assert.equal(x.series[2].latestText,'暂无成绩');assert.equal(x.series[0].name,x.series[1].name);assert.equal(x.pointCount,4);
});
test('group projection ignores query and todo filters and never borrows foreign or unknown-subject evidence',()=>{
 const db=fixture(),x=compare(db),filtered=compare(db,{query:'SYNTHETIC_NO_MATCH',todoOnly:true});assert.deepEqual(filtered,x);const ids=x.series.flatMap(s=>s.points.map(p=>p.id));assert.deepEqual(ids,['A1','A2','B1','B2']);assert.ok(!ids.includes('U1')&&!ids.includes('Z1')&&!ids.includes('M1'));
});
test('same actual full marks display raw scores even when the current category default is different',()=>{
 const db=fixture(),x=compare(db);assert.equal(x.mode,'score');assert.equal(x.unit,'分');assert.equal(x.max,100);assert.equal(x.mixedTotals,false);assert.equal(x.series[0].points[0].value,0);assert.equal(x.series[1].points.at(-1).value,100);
 db.categories[0].total=80;assert.deepEqual(compare(db),x);
});
test('one displayed historical full-mark difference switches every line to one percentage scale',()=>{
 const db=fixture();db.scores.find(s=>s.id==='A2').total=160;const before=snapshot(db),x=compare(db);assert.equal(x.mode,'rate');assert.equal(x.unit,'%');assert.equal(x.max,100);assert.equal(x.mixedTotals,true);assert.equal(x.series[0].points.at(-1).value,50);assert.equal(x.series[1].points.at(-1).value,100);assert.equal(snapshot(db),before);assert.match(x.notice,/满分不一致/);
});
test('future records and records outside each learner last six do not affect the displayed scale',()=>{
 const db=fixture();db.scores=db.scores.filter(s=>s.studentId!=='A');for(let i=1;i<=8;i++)db.scores.push(score('S'+i,'A','2026-09-'+String(i).padStart(2,'0'),50,i<3?120:100));db.scores.push(score('FUTURE','A','2099-01-01',100,150));const x=compare(db),a=x.series.find(s=>s.id==='A');assert.deepEqual(a.points.map(p=>p.id),['S3','S4','S5','S6','S7','S8']);assert.equal(x.mode,'score');assert.equal(x.max,100);
});
test('same-day observations keep stable date/id order and missing dates are never filled as zero',()=>{
 const db=fixture();db.scores.push(score('A0','A','2026-10-05',50));const x=compare(db),a=x.series.find(s=>s.id==='A');assert.deepEqual(a.points.map(p=>[p.id,p.date]),[['A1','2026-10-01'],['A0','2026-10-05'],['A2','2026-10-05']]);assert.equal(x.series.find(s=>s.id==='B').points.length,2);assert.equal(x.series.find(s=>s.id==='N').points.length,0);
});
test('subject selection does not merge semantic aliases or infer a subject for unknown archives',()=>{
 const db=fixture();db.students.push(student('ALIAS','English'));db.scores.push(score('EN1','ALIAS','2026-10-05',70,100,'English'));const en=compare(db,{subjectKey:'ＥＮＧＬＩＳＨ'});assert.equal(en.subjectKey,'english');assert.deepEqual(en.series.map(s=>s.id),['ALIAS']);const math=compare(db,{subjectKey:' 数 学 '});assert.deepEqual(math.series.map(s=>s.id),['M']);assert.equal(math.max,120);assert.equal(math.unknownCount,1);
});
test('unknown category and empty category do not fall back to another class data',()=>{
 const db=fixture();for(const groupKey of ['SYNTHETIC_MISSING','CE']){const x=compare(db,{groupKey});assert.equal(x.recordCount,0);assert.equal(x.studentCount,0);assert.equal(x.series.length,0);assert.equal(x.pointCount,0);assert.match(x.notice,/暂无档案/);}assert.equal(compare(db,{groupKey:'CE'}).max,80);
});
test('invalid score observations are excluded defensively and enormous finite scores do not overflow percentages',()=>{
 const db=fixture();db.scores.push(score('BAD_DATE','A','2026-02-30',50,150),score('TOO_HIGH','A','2026-10-02',101,100),score('NEG','A','2026-10-02',-1),score('ZERO_TOTAL','A','2026-10-02',0,0),score('INFINITE','A','2026-10-02',Infinity));const x=compare(db);assert.equal(x.pointCount,4);assert.equal(x.mode,'score');
 db.scores=[score('HUGE','A','2026-10-05',1e308,1e308),score('SMALL','B','2026-10-05',50,100)];const huge=compare(db);assert.equal(huge.mode,'rate');assert.deepEqual(huge.series.slice(0,2).map(s=>s.points[0].value),[100,50]);assert.ok(huge.series.flatMap(s=>s.points).every(p=>Number.isFinite(p.value)));
});
test('series identifiers and visual keys remain independent for more than eight learners',()=>{
 const db=fixture();db.students=Array.from({length:10},(_,i)=>student('SYNTHETIC_'+i));db.scores=[];const x=compare(db);assert.equal(x.series.length,10);assert.equal(new Set(x.series.map(s=>s.id)).size,10);assert.equal(x.series[0].color,x.series[8].color);assert.notDeepEqual(x.series[0].dash,x.series[8].dash);assert.ok(Object.isFrozen(M.palette));x.series[8].dash.push(999);assert.ok(!compare(db).series[8].dash.includes(999));
});

test('native search and todo filters affect only the roster, leaving pie composition and group lines intact',()=>{
 const h=native(),raw=h.store.get(KEY),groups=snapshot(h.page.data.groups),lines=snapshot(h.page.data.comparison);h.page.onSearch(event({},'SYNTHETIC_NO_MATCH'));assert.equal(h.page.data.rows.length,0);assert.equal(snapshot(h.page.data.groups),groups);assert.equal(snapshot(h.page.data.comparison),lines);h.page.onSearch(event({},''));h.page.onListFilter(event({filter:'todo'}));assert.deepEqual(Array.from(h.page.data.rows,r=>r.id),['A']);assert.equal(snapshot(h.page.data.comparison),lines);assert.equal(h.store.get(KEY),raw);
});
test('native highlighting keeps all plotted and unplotted series and toggles off without writing data',()=>{
 const h=native(),raw=h.store.get(KEY),before=snapshot(h.page.data.comparison.series);assert.equal(h.page.data.comparisonFocusId,'');h.page.onFocusSeries(event({id:'A'}));assert.equal(h.page.data.comparisonFocusId,'A');assert.equal(snapshot(h.page.data.comparison.series),before);h.page.onFocusSeries(event({id:'N'}));assert.equal(h.page.data.comparisonFocusId,'N');assert.equal(h.page.data.comparisonFocus.points.length,0);assert.equal(snapshot(h.page.data.comparison.series),before);h.page.onFocusSeries(event({id:'N'}));assert.equal(h.page.data.comparisonFocusId,'');h.page.onFocusSeries(event({id:'Z'}));assert.equal(h.page.data.comparisonFocusId,'');assert.equal(h.store.get(KEY),raw);
});
test('native subject and category changes clear stale highlighting and do not reuse previous-class lines',()=>{
 const h=native();h.page.onFocusSeries(event({id:'A'}));const index=h.page.data.comparison.subjectOptions.findIndex(s=>s.key==='数学');h.page.onComparisonSubject(event({},String(index)));assert.equal(h.page.data.comparisonFocusId,'');assert.deepEqual(Array.from(h.page.data.comparison.series,s=>s.id),['M']);h.page.onFocusSeries(event({id:'M'}));h.page.onSelectGroup(event({key:'C2'}));assert.equal(h.page.data.comparisonFocusId,'');assert.deepEqual(Array.from(h.page.data.comparison.series,s=>s.id),['Z']);assert.equal(h.page.data.comparison.subjectKey,'英语');
});
test('native highlighted archive opens by id despite identical names and preserves category on return',async()=>{
 const h=native();h.page.onFocusSeries(event({id:'B'}));h.page.onOpenComparisonStudent();assert.equal(h.page.data.student.id,'B');assert.equal(h.page.data.view,'detail');await h.page.onHome();assert.equal(h.page.data.groupKey,'C1');assert.equal(h.page.data.comparison.recordCount,5);
});
test('native category total edits leave historical scale intact and a moved student leaves the original comparison',()=>{
 const h=native();h.page.onEditCategory(event({id:'C1'}));h.page.onFieldInput(event({field:'total'},'90'));h.page.onSaveForm();assert.equal(h.page.data.comparison.max,100);assert.equal(h.page.data.comparison.mode,'score');h.page.onFocusSeries(event({id:'A'}));h.page.onOpenComparisonStudent();h.page.onEditStudent();const index=h.page.data.categoryOptions.findIndex(c=>c.id==='C2');h.page.onStudentCategory(event({},String(index)));h.page.onSaveForm();h.page.onSelectGroup(event({key:'C1'}));assert.ok(!h.page.data.comparison.series.some(s=>s.id==='A'));assert.equal(h.page.data.comparisonFocusId,'');assert.equal(h.page._db.scores.find(s=>s.id==='A2').total,100);
});
test('native empty categories and empty archive provide safe no-line states, then explicit examples populate the charts',()=>{
 const h=native();h.page.onSelectGroup(event({key:'CE'}));assert.equal(h.page.data.selectedGroup.count,0);assert.equal(h.page.data.comparison.pointCount,0);assert.equal(h.page.data.comparison.series.length,0);const fresh=emptyHarness();assert.equal(fresh.page.data.totals.records,0);assert.equal(fresh.page.data.comparison.series.length,0);assert.ok(fresh.page.data.groups.every(g=>g.count===0));fresh.page.onAddExamples();assert.equal(fresh.page.data.totals.records,10);assert.equal(fresh.page.data.comparison.series.length,4);assert.equal(fresh.page.data.comparison.pointCount,16);assert.equal(fresh.page.data.comparison.max,100);
});
test('native sample append clears hidden-roster filters while full-class comparison retains existing real records',()=>{
 const h=native();h.page.onSearch(event({},'SYNTHETIC_NO_MATCH'));h.page.onListFilter(event({filter:'todo'}));const old=snapshot(h.page._db.students.slice(0,6));h.page.onAddExamples();assert.equal(snapshot(h.page._db.students.slice(0,6)),old);assert.equal(h.page.data.totals.records,16);assert.equal(h.page.data.query,'');assert.equal(h.page.data.listFilter,'all');assert.equal(h.page.data.comparison.recordCount,4);assert.equal(h.page.data.comparison.series.length,4);
});
test('chart-to-archive navigation always opens scores even when the roster is filtered to follow-up',()=>{
 const h=native();h.page.onListFilter(event({filter:'todo'}));h.page.onFocusSeries(event({id:'B'}));h.page.onOpenComparisonStudent();assert.equal(h.page.data.student.id,'B');assert.equal(h.page.data.detailTab,'scores');assert.equal(h.page.data.view,'detail');
 const data=snapshot(h.page.data);h.page.onFocusSeries(event({id:'A'}));h.page.onComparisonSubject(event({},'1'));assert.equal(snapshot(h.page.data),data);
});

// No browser, device, network, real clipboard or real storage is used below.
function chartHarness(name,props,options={}){
 let definition;const calls=[],strokes=[],fills=[],arcs=[],labels=[],updates=[],exports=[],ticks=[],queries=[],frames=[];let segments=[];
 const style=()=>({color:ctx.strokeStyle,fill:ctx.fillStyle,alpha:ctx.globalAlpha,width:ctx.lineWidth,dash:[...(ctx.dash||[])]});
 const ctx={scale:(...args)=>calls.push(['scale',...args]),clearRect:(...args)=>calls.push(['clear',...args]),
  beginPath(){segments=[];},moveTo:(...args)=>segments.push(['move',...args]),lineTo:(...args)=>segments.push(['line',...args]),closePath:()=>segments.push(['close']),
  arc(...args){segments.push(['arc',...args]);arcs.push({args,style:style()});},
  fill(){fills.push({segments:segments.map(x=>x.slice()),style:style()});},stroke(){strokes.push({segments:segments.map(x=>x.slice()),style:style()});},
  setLineDash(values){this.dash=Array.from(values);},fillText(text,x,y){labels.push({text:String(text),x,y,style:style()});}};
 const node={getContext:()=>ctx};if(!options.noFrame)node.requestAnimationFrame=fn=>options.deferFrame?frames.push(fn):fn();
 const nextTick=fn=>options.deferTick?ticks.push(fn):fn();
 const context=vm.createContext({Component:value=>{definition=value;},wx:{nextTick,getWindowInfo:()=>({pixelRatio:2}),canvasToTempFilePath(request,owner){exports.push({request,owner});if(options.throwExport)throw Error('SYNTHETIC_EXPORT');if(!options.deferExport)request.success({tempFilePath:'SYNTHETIC_LOCAL_'+name+'.png'});}}});
 vm.runInContext(fs.readFileSync(path.join(root,'components',name,'index.js'),'utf8'),context);
 const defaults=Object.fromEntries(Object.entries(definition.properties).map(([key,value])=>[key,value.value]));
 const component={data:{...defaults,...definition.data,...props},setData(values){updates.push({...values});Object.assign(this.data,values);},createSelectorQuery(){return{select(){return this;},fields(){return this;},exec(cb){const complete=()=>cb(options.badMeasure?[]:[{node,width:options.width||320,height:options.height||230}]);if(options.deferQuery)queries.push(complete);else complete();}};}};
 Object.assign(component,definition.methods);definition.lifetimes.ready.call(component);
 return{component,node,calls,strokes,fills,arcs,labels,updates,exports,ticks,queries,frames,
  change(values){Object.assign(component.data,values);component._schedule();},detach(){definition.lifetimes.detached.call(component);}};
}
const chartPoint=(date,value)=>({id:'SYNTHETIC_'+date+'_'+value,date,title:'SYNTHETIC_EXAM',score:value,total:100,value});
const chartSeries=()=>[
 {id:'A',name:'SYNTHETIC_SAME_NAME',color:'#246c53',dash:[],points:[chartPoint('2026-10-01',0),chartPoint('2026-10-05',100)]},
 {id:'B',name:'SYNTHETIC_SAME_NAME',color:'#397ca8',dash:[6,3],points:[chartPoint('2026-10-02',50),chartPoint('2026-10-05',25)]},
 {id:'N',name:'SYNTHETIC_NO_SCORE',color:'#b07632',dash:[],points:[]}
];
const pieSlices=()=>[{key:'A',count:4,color:'#246c53'},{key:'B',count:3,color:'#397ca8'},{key:'C',count:3,color:'#b07632'},{key:'ZERO',count:0,color:'#8665a3'}];
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
function dataLines(h,color){return h.strokes.filter(s=>s.style.color===color&&s.segments.some(p=>p[0]==='line')&&[2,3].includes(s.style.width));}
function pointMarks(h,color){return h.strokes.filter(s=>s.style.color===color&&s.segments.some(p=>p[0]==='arc'));}
function assertCallouts(h,series){
 const leaders=h.strokes.filter(s=>series.some(row=>row.color===s.style.color)&&s.segments.some(p=>p[0]==='line')&&![2,3].includes(s.style.width));
 for(const leader of leaders){
  assert.equal(leader.style.width,0.8);assert.deepEqual(leader.style.dash,[]);assert.equal(leader.style.alpha,0.76);assert.equal(leader.segments.length,2);assert.equal(leader.segments[0][0],'move');assert.equal(leader.segments[1][0],'line');
  const index=series.findIndex(row=>row.color===leader.style.color),number=index+1;
  // White-theme markers use a white core. Their series identity is the colored
  // outline; still compare each leader with the actual final point geometry.
  const dots=pointMarks(h,leader.style.color);assert.ok(dots.length,'leader requires a real point in its own series');
  const endpoint=dots.at(-1).segments.find(p=>p[0]==='arc'),from=leader.segments[0],to=leader.segments[1];near(from[1],endpoint[1]);near(from[2],endpoint[2]);
  const label=h.labels.find(row=>row.text==='#'+number||row.text.startsWith('#'+number+' '));assert.ok(label,'leader requires its numbered label');assert.equal(label.style.fill,leader.style.color);assert.ok(Math.abs(to[2]-label.y)<=6.01);assert.ok(to[1]<=label.x&&to[1]>=label.x-label.text.length*7-4);
 }
 return leaders;
}

test('pie draws exactly the positive-count shares, includes the selected slice once and uses a solid disc',()=>{
 const slices=pieSlices(),before=snapshot(slices),h=chartHarness('category-pie',{slices,selectedKey:'B'});assert.equal(h.arcs.length,3);assert.equal(h.fills.length,3);
 const shares=new Map(h.fills.map(f=>[f.style.fill,f.segments.find(s=>s[0]==='arc')]));
 near(shares.get('#246c53')[5]-shares.get('#246c53')[4],Math.PI*2*0.4);near(shares.get('#397ca8')[5]-shares.get('#397ca8')[4],Math.PI*2*0.3);near(shares.get('#b07632')[5]-shares.get('#b07632')[4],Math.PI*2*0.3);
 assert.ok(h.fills.every(f=>f.segments.some(s=>s[0]==='move')));assert.equal(h.fills.at(-1).style.fill,'#397ca8');assert.ok(h.strokes.every(s=>s.style.width===1.5&&s.style.color==='#FFFFFF'));
 for(const fill of h.fills){const arc=fill.segments.find(s=>s[0]==='arc');near(arc[3],107);near(Math.hypot(arc[1]-160,arc[2]-115),fill.style.fill==='#397ca8'?2.5:0);}
 assert.equal(snapshot(slices),before);
});
test('pie counts stay finite for extreme weights and zero or invalid counts never create wedges',()=>{
 const h=chartHarness('category-pie',{slices:[{key:'A',count:1e308},{key:'B',count:1e308},{key:'ZERO',count:0},{key:'BAD',count:Infinity},{key:'NEG',count:-1}]});assert.equal(h.arcs.length,2);for(const a of h.arcs){assert.ok(a.args.every(v=>typeof v!=='number'||Number.isFinite(v)));near(a.args[4]-a.args[3],Math.PI);}
 const zero=chartHarness('category-pie',{slices:[{count:0}]});assert.equal(zero.exports.length,0);assert.equal(zero.arcs.length,0);assert.equal(zero.component.data.hasData,false);assert.equal(zero.component.data.chartBusy,false);
});
test('group chart aligns all learners on shared calendar coordinates, preserves zero and full marks, and invents no missing points',()=>{
 const series=chartSeries(),before=snapshot(series),h=chartHarness('group-lines',{series,max:100,unit:'分'});assert.equal(h.arcs.length,4);const [a0,a1,b0,b1]=h.arcs.map(a=>a.args);near(a1[0],b1[0]);near((b0[0]-a0[0])/(a1[0]-a0[0]),1/4);assert.ok(a0[1]>a1[1]);near((b0[1]-a1[1])/(a0[1]-a1[1]),1/2);assert.equal(snapshot(series),before);
 const paths=[...dataLines(h,'#246c53'),...dataLines(h,'#397ca8')];assert.equal(paths.length,2);assert.ok(paths.every(s=>s.style.width===2));assert.deepEqual(paths.find(s=>s.style.color==='#397ca8').style.dash,[6,3]);assert.equal(pointMarks(h,'#b07632').length,0);assert.equal(pointMarks(h,'#246c53').length,2);assert.equal(pointMarks(h,'#397ca8').length,2);assert.ok(h.fills.every(f=>f.style.fill==='#FFFFFF'));assert.ok(h.labels.some(x=>x.text==='分'));
 assert.deepEqual(paths[0].segments,[['move',a0[0],a0[1]],['line',a1[0],a1[1]]]);assert.deepEqual(paths[1].segments,[['move',b0[0],b0[1]],['line',b1[0],b1[1]]]);assert.equal(assertCallouts(h,series).length,0);assert.ok(!h.labels.some(row=>row.text.startsWith('#')));
 const dense=chartSeries().slice(0,2).concat([{id:'C',color:'#b07632',points:[chartPoint('2026-10-01',50),chartPoint('2026-10-05',79)]},{id:'D',color:'#8665a3',points:[chartPoint('2026-10-01',60),chartPoint('2026-10-05',86)]}]);dense[0].points.at(-1).value=76;dense[1].points.at(-1).value=87;const close=chartHarness('group-lines',{series:dense,max:100},{height:170});assert.equal(close.arcs.length,8);assert.equal(dense.reduce((n,row)=>n+dataLines(close,row.color).length,0),4);assert.equal(assertCallouts(close,dense).length,0);assert.ok(!close.labels.some(row=>row.text.startsWith('#')));
 const focused=chartHarness('group-lines',{series:dense,max:100,focusId:'D'},{height:170});assert.equal(focused.arcs.length,8);assert.equal(dense.reduce((n,row)=>n+dataLines(focused,row.color).length,0),4);assert.equal(assertCallouts(focused,dense).length,1);assert.deepEqual(focused.labels.filter(row=>row.text.startsWith('#')).map(row=>row.text),['#4 86%']);
});
test('group highlighting draws all existing points and lines while only reducing other-line opacity',()=>{
 const series=chartSeries(),h=chartHarness('group-lines',{series,max:100,unit:'分',focusId:'A'});assert.equal(h.arcs.length,4);const paths=h.strokes.filter(s=>s.segments.some(p=>p[0]==='line')&&[2,3].includes(s.style.width)&&['#246c53','#397ca8'].includes(s.style.color));assert.equal(paths.length,2);assert.equal(paths[0].style.color,'#397ca8');assert.equal(paths[0].style.alpha,0.22);assert.equal(paths[0].style.width,2);assert.equal(paths[1].style.color,'#246c53');assert.equal(paths[1].style.width,3);assert.ok(h.labels.some(x=>x.text==='#1 100分'));assert.equal(assertCallouts(h,series).length,1);
 const unplotted=chartHarness('group-lines',{series:chartSeries(),focusId:'N'});assert.equal(unplotted.arcs.length,4);assert.ok(unplotted.fills.every(f=>f.style.alpha===0.94));
});
test('single observation and same-day observations use one shared x without manufacturing a connecting series',()=>{
 const series=[{id:'A',color:'#246c53',points:[chartPoint('2026-10-05',0)]},{id:'B',color:'#397ca8',points:[chartPoint('2026-10-05',25),chartPoint('2026-10-05',100)]}];const h=chartHarness('group-lines',{series,max:100});assert.equal(h.arcs.length,3);assert.equal(new Set(h.arcs.map(a=>a.args[0])).size,1);assert.equal(dataLines(h,'#246c53').length,0);assert.equal(dataLines(h,'#397ca8').length,1);assert.equal(h.labels.filter(l=>l.text==='10/05').length,1);assert.equal(assertCallouts(h,series).length,0);
 const focused=chartHarness('group-lines',{series,max:100,focusId:'A'});assert.equal(focused.arcs.length,3);assert.equal(dataLines(focused,'#246c53').length,0);assert.equal(dataLines(focused,'#397ca8').length,1);const leaders=assertCallouts(focused,series);assert.equal(leaders.length,1);assert.equal(leaders[0].style.color,'#246c53');assert.ok(focused.labels.some(row=>row.text==='#1 0%'),'a focused zero score has a true value callout, never a fabricated trend line');
});
test('group chart excludes malformed points and keeps tiny or enormous valid scales within the viewport',()=>{
 for(const max of [0.03,1e308]){const h=chartHarness('group-lines',{series:[{id:'A',points:[chartPoint('2026-10-01',0),chartPoint('2026-10-05',max)]}],max,unit:'分'});assert.equal(h.arcs.length,2);for(const a of h.arcs){const [x,y]=a.args;assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=320&&y>=0&&y<=230);}assert.ok(h.labels.every(l=>!l.text.includes('Infinity')&&!l.text.includes('NaN')));}
 const h=chartHarness('group-lines',{series:[{id:'A',points:[chartPoint('2026-02-30',50),chartPoint('2026-10-01',-1),chartPoint('2026-10-01',101),chartPoint('2026-10-01',Infinity),chartPoint('2026-10-01',50)]}],max:100});assert.equal(h.arcs.length,1);
});
test('group chart keeps every learner after the eighth color and keeps original legend numbering across unplotted entries',()=>{
 const series=Array.from({length:12},(_,i)=>({id:'S'+i,color:M.palette[i%8],dash:i>=8?[6,3]:[],points:i===0?[]:[chartPoint('2026-10-05',i*5)]}));const h=chartHarness('group-lines',{series,max:100,focusId:'S11'});assert.equal(h.arcs.length,11);assert.ok(h.labels.some(l=>l.text==='#12 55%'));assert.ok(h.arcs.every(a=>a.args[0]===h.arcs[0].args[0]));
});

for(const [name,props,empty] of [['category-pie',{slices:pieSlices()}, {slices:[]}],['group-lines',{series:chartSeries(),max:100,unit:'分'}, {series:[]}]]){
 test(name+' exports only a local PNG after drawing and has an explicit failure/retry state',()=>{
  const h=chartHarness(name,props,{deferExport:true});assert.equal(h.exports.length,1);assert.equal(h.exports[0].owner,h.component);assert.equal(h.exports[0].request.canvas,h.node);assert.equal(h.exports[0].request.fileType,'png');assert.equal(h.exports[0].request.destWidth,640);assert.equal(h.exports[0].request.destHeight,460);h.exports[0].request.fail();assert.equal(h.component.data.chartFailed,true);assert.equal(h.component.data.chartBusy,false);h.change(props);h.exports[1].request.success({tempFilePath:'SYNTHETIC_RECOVERY.png'});assert.equal(h.component.data.chartImage,'SYNTHETIC_RECOVERY.png');assert.equal(h.component.data.chartFailed,false);
 });
 test(name+' invalidates stale export success/failure before the next layout tick and accepts only current images',()=>{
  const h=chartHarness(name,props,{deferExport:true,deferTick:true});h.ticks[0]();assert.equal(h.exports.length,1);h.change(props);const updates=h.updates.length;h.exports[0].request.success({tempFilePath:'SYNTHETIC_OLD.png'});h.exports[0].request.fail();assert.equal(h.updates.length,updates);h.ticks[1]();h.exports[1].request.success({tempFilePath:'SYNTHETIC_NEW.png'});const current=h.component.data.renderPaintId;h.component._onImageError(event({paint:current-1}));assert.equal(h.component.data.chartImage,'SYNTHETIC_NEW.png');h.component._onImageError(event({paint:current}));assert.equal(h.component.data.chartFailed,true);
 });
 test(name+' removes previous images on empty input and blocks late image resurrection',()=>{
  const h=chartHarness(name,props,{deferExport:true});h.exports[0].request.success({tempFilePath:'SYNTHETIC_OLD.png'});h.change(empty);assert.equal(h.component.data.chartImage,'');assert.equal(h.component.data.hasData,false);assert.equal(h.component.data.chartBusy,false);assert.equal(h.exports.length,1);const count=h.updates.length;h.exports[0].request.success({tempFilePath:'SYNTHETIC_LATE.png'});h.exports[0].request.fail();assert.equal(h.updates.length,count);
 });
 test(name+' ignores stale layout and animation callbacks after newer input or detachment',()=>{
  const h=chartHarness(name,props,{deferQuery:true,deferFrame:true});h.change(props);h.queries[0]();assert.equal(h.frames.length,0);h.queries[1]();assert.equal(h.frames.length,1);h.change(props);h.frames[0]();assert.equal(h.exports.length,0);h.queries[2]();assert.equal(h.frames.length,2);h.detach();const count=h.updates.length;h.frames[1]();assert.equal(h.exports.length,0);assert.equal(h.updates.length,count);
  const e=chartHarness(name,props,{deferExport:true});e.detach();const n=e.updates.length;e.exports[0].request.success({tempFilePath:'SYNTHETIC_DETACHED.png'});e.exports[0].request.fail();assert.equal(e.updates.length,n);
 });
 test(name+' handles missing canvas and export exceptions without an endless loading state',()=>{
  for(const options of [{badMeasure:true},{throwExport:true}]){const h=chartHarness(name,props,options);assert.equal(h.component.data.chartFailed,true);assert.equal(h.component.data.chartBusy,false);assert.equal(h.component.data.chartImage,'');}
  const h=chartHarness(name,props,{noFrame:true});assert.equal(h.exports.length,1);assert.ok(h.component.data.chartImage.startsWith('SYNTHETIC_LOCAL_'));
 });
}
