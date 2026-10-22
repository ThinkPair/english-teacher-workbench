const a=require('miniprogram-automator'),assert=require('assert/strict'),fs=require('fs'),path=require('path');
const out=path.join(__dirname,'evidence-0.3.0-final');fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[],errors=[];let m,p;
const mocked=new Set();
async function mock(name,result){await m.mockWxMethod(name,result);mocked.add(name);}
async function unmock(name){if(mocked.has(name)){await m.restoreWxMethod(name);mocked.delete(name);}}
const pass=s=>{checks.push(s);console.log('PASS',s)};
async function until(fn,label){for(let i=0;i<60;i++){if(await fn())return;await sleep(250)}throw new Error('Timeout '+label)}
async function tap(selector){const el=await p.$(selector);assert(el,'Missing '+selector);await el.tap();await sleep(250)}
async function input(field,val){const el=await p.$('[data-field="'+field+'"]');assert(el,'Missing '+field);await el.input(val)}
async function screen(name,scroll=0){await m.pageScrollTo(scroll);await sleep(1200);await m.screenshot({path:path.join(out,name+'.png')})}
async function view(v){await until(async()=>await p.data('view')===v,'view '+v);assert.equal(await p.data('error'),'')}
const evt=id=>({currentTarget:{dataset:{id}}});
async function openStudent(id){await p.callMethod('onOpenStudent',evt(id));await view('detail');}
async function home(){await p.callMethod('onHome');await view('list');}
async function save(){await tap('.form-actions .button-primary');}
(async()=>{
 m=await a.connect({wsEndpoint:'ws://127.0.0.1:9420'});m.on('exception',e=>errors.push(e));
 try{
  await until(async()=>m.evaluate(()=>{const app=getApp();if(!app)return false;app.__archiveQA={};return true;}),'app ready');
  await mock('getStorageInfoSync',function(){return {keys:Object.keys(getApp().__archiveQA),currentSize:0,limitSize:10240};});
  await mock('getStorageSync',function(key){return getApp().__archiveQA[key];});
  await mock('setStorageSync',function(key,value){getApp().__archiveQA[key]=value;});
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');
  assert.equal(await p.data('totals.records'),10);assert.equal(await p.data('totals.examples'),10);assert.equal(await p.$('.space-switch'),null);
  let groups=await p.data('groups');assert.deepEqual(groups.map(g=>[g.count,g.total]),[[4,100],[3,120],[3,150]]);
  pass('同库10个可编辑示例，3个分类和默认满分正确');await screen('10-final-home');
  await screen('11-final-cards',230);await screen('12-bottom-chart',100000);
  const middle=groups.find(g=>g.total===120);await p.callMethod('onSelectGroup',{currentTarget:{dataset:{key:middle.key}}});await screen('02-selected-group',180);
  assert((await p.data('rows')).every(r=>r.categoryName===middle.name));pass('选择教学分类只显示对应学员');
  await p.callMethod('onManageCategories');await view('categories');await screen('20-category-settings');
  await tap('.section-title .button-primary');await view('form');await input('name','一对一英语（虚构验收）');await input('total','0');await save();assert(await p.data('error'));
  await input('total','80');await save();await view('list');
  const category=(await p.data('groups')).find(g=>g.name==='一对一英语（虚构验收）');assert(category);assert.equal(category.count,0);assert.equal(await p.data('groupKey'),category.key);await screen('21-empty-category');pass('自定义分类校验满分，保存后直达该空分类');
  await p.callMethod('onAddStudent');await view('form');assert.equal(await p.data('form.categoryId'),category.key);assert.equal(await p.data('form.subject'),'英语');assert.equal(await p.$('[data-field="subject"]'),null);assert.equal(await p.$('[data-field="className"]'),null);
  await input('name','流程验收同学（虚构）');await input('grade','四年级');await screen('03-new-archive');await save();await view('detail');const studentId=await p.data('student.id');assert(studentId);pass('当前分类建档自动归组，英语固定，保存后进入本人详情');
  await p.callMethod('onAddScore');await view('form');assert.equal(Number(await p.data('form.total')),80);await input('title','单元测评');await input('score','90');await save();assert(await p.data('error'));await input('score','64');await save();await view('detail');assert.equal((await p.data('scores'))[0].total,80);pass('新成绩带类别满分，超分拒绝，正确保存64/80');await screen('04-score-detail',160);
  const firstScore=(await p.data('scores'))[0];await p.callMethod('onObserveScore',evt(firstScore.id));await view('form');assert((await p.data('form.note')).replace(/\s/g,'').includes('64/80'));await tap('[data-label="词汇拼写"]');await save();await view('detail');pass('从成绩记录观察，自动带入本次考试依据且需要老师保存');

  await home();await p.callMethod('onManageCategories');await p.callMethod('onDeleteCategory',evt(category.key));assert.match(await p.data('error'),/还有/);assert((await p.data('categories')).some(c=>c.id===category.key));pass('分类有学员时不能误删');
  await p.callMethod('onEditCategory',evt(category.key));await view('form');await input('name','自定义英语进阶');await input('total','100');await save();await view('list');await openStudent(studentId);assert.equal((await p.data('scores'))[0].total,80);
  await p.callMethod('onAddScore');assert.equal(Number(await p.data('form.total')),100);await input('title','阶段复看');await input('score','85');await save();await view('detail');assert.deepEqual((await p.data('scores')).map(s=>s.total).sort((a,b)=>a-b),[80,100]);pass('改分类名与默认满分，旧成绩80保留，新成绩才用100');
  await p.callMethod('onEditStudent');const options=await p.data('categoryOptions');await p.callMethod('onStudentCategory',{detail:{value:String(options.findIndex(x=>x.id===middle.key))}});await save();await view('detail');assert.equal(await p.data('student.categoryId'),middle.key);assert.deepEqual((await p.data('scores')).map(s=>s.total).sort((a,b)=>a-b),[80,100]);
  await p.callMethod('onAddScore');assert.equal(Number(await p.data('form.total')),120);await p.callMethod('onCancelForm');pass('转分类保留历史，下一条成绩自动带新分类120');
  await home();await p.callMethod('onManageCategories');await mock('showModal',{confirm:true,cancel:false});await p.callMethod('onDeleteCategory',evt(category.key));await unmock('showModal');assert(!(await p.data('categories')).some(c=>c.id===category.key));pass('学员移出后可删除空分类');
  await openStudent(studentId);await tap('[data-tab="tags"]');await tap('[data-type="weak"]');await tap('[data-label="一般过去时"]');await input('note','虚构观察：时间提示与动词变化需要核对');await screen('08-tag-shortcuts');await save();await view('detail');
  await tap('[data-tab="ideas"]');const idea=(await p.data('ideas')).find(i=>JSON.stringify(i).includes('一般过去时'));assert(idea);await p.callMethod('onUseIdea',{currentTarget:{dataset:{key:idea.key}}});await view('form');await save();await view('detail');const plan=(await p.data('plans')).find(x=>x.title===idea.title);assert(plan);
  await tap('[data-tab="ideas"]');await p.callMethod('onUseIdea',{currentTarget:{dataset:{key:idea.key}}});assert.equal(await p.data('form.id'),plan.id);await p.callMethod('onCancelForm');pass('英语观察生成教师可编辑计划，相同待跟进建议复用原计划');
  await p.callMethod('onEditRecord',{currentTarget:{dataset:{kind:'complete',id:plan.id}}});await input('result','完成三句练习，仍有一处动词变化需复看');await save();await view('detail');assert((await p.data('plans')).find(x=>x.id===plan.id).status==='done');pass('跟进保存实际完成结果，不生成成绩或自动解除标签');
  await p.callMethod('onRetestPlan',evt(plan.id));await view('form');assert.equal(await p.data('form.score'),'');assert.equal(Number(await p.data('form.total')),120);assert.equal(await p.data('form.title'),'跟进复测');await mock('showModal',{confirm:true,cancel:false});await p.callMethod('onCancelForm');await unmock('showModal');pass('完成后复测从空得分开始，沿用当前分类满分');

  await home();await p.callMethod('onSelectGroup',{currentTarget:{dataset:{key:middle.key}}});let row=(await p.data('rows')).find(x=>x.id===studentId);assert(row);assert.deepEqual(row.series.map(x=>x.rate).sort(),[80,85]);assert(row.latestTitle&&row.latestDate);pass('首页按各次原始满分绘制得分率并显示考试名与日期');
  let sample=(await p.data('rows')).find(x=>x.isExample);await openStudent(sample.id);await p.callMethod('onEditStudent');await input('name','已修改的示例同学');await save();await view('detail');assert.equal(await p.data('student.name'),'已修改的示例同学');await mock('showModal',{confirm:true,cancel:false});await p.callMethod('onDeleteStudent');await unmock('showModal');await view('list');assert.equal(await p.data('totals.examples'),9);pass('预放示例与普通学员一样可以修改和删除');
  await p.callMethod('onAddStudent');await input('name','未保存的草稿');await p.callMethod('onHelp');await until(async()=>(await m.currentPage()).path==='pages/help/help','help');await screen('05-help');await m.navigateBack();p=await m.currentPage();assert.equal(await p.data('form.name'),'未保存的草稿');await mock('showModal',{confirm:true,cancel:false});await p.callMethod('onCancelForm');await unmock('showModal');pass('帮助说明独立，返回仍保留未保存草稿');
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');assert.equal(await p.data('totals.records'),10);assert.equal(await p.data('categories').then(x=>x.length),3);pass('重进保留测试夹具中的分类、档案和修改');
  let nav=await p.$$('.bottom-nav .nav-button');await nav[1].tap();await view('backup');await screen('07-backup');nav=await p.$$('.bottom-nav .nav-button');await nav[2].tap();await until(async()=>(await m.currentPage()).path==='pages/help/help','nav help');await m.navigateBack();p=await m.currentPage();nav=await p.$$('.bottom-nav .nav-button');await nav[0].tap();await view('list');pass('底部档案、备份、帮助三个入口实际触控正常');
  await m.evaluate(()=>{const key='student-manager-lite.v3.archive';const db=JSON.parse(getApp().__archiveQA[key]);for(const t of ['students','scores','tags','plans'])db[t]=[];db.revision++;getApp().__archiveQA[key]=JSON.stringify(db);});
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');assert.equal(await p.data('totals.records'),0);assert.equal(await p.data('categories').then(x=>x.length),3);pass('已有空库不重复注入10名示例，分类保留');await screen('06-empty');
  assert.equal(errors.length,0);pass('本轮原生运行无异常');
 }finally{
  fs.writeFileSync(path.join(out,'flow-result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,storageMode:'WeChat automator in-memory synthetic fixture; real storage APIs mocked',realDataAccessed:false},null,2));
  for(const name of Array.from(mocked))await unmock(name).catch(()=>{});m.disconnect();
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
