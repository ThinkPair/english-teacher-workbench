const a=require('miniprogram-automator'),assert=require('assert/strict'),fs=require('fs'),path=require('path');
const out=path.join(__dirname,'evidence-0.3.0-final'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9420'}),mocked=[],errors=[];m.on('exception',e=>errors.push(e));let p;const checks=[];
 const pass=s=>{console.log('PASS',s);checks.push(s)};
 try{
  for(let i=0;i<60;i++){if(await m.evaluate(()=>{const app=getApp();if(!app)return false;app.__archiveQA={};return true;}))break;await sleep(300)}
  for(const [name,fn]of Object.entries({getStorageInfoSync:function(){return{keys:Object.keys(getApp().__archiveQA),currentSize:0,limitSize:10240}},getStorageSync:function(key){return getApp().__archiveQA[key]},setStorageSync:function(key,value){getApp().__archiveQA[key]=value}})){await m.mockWxMethod(name,fn);mocked.push(name);}
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');await sleep(1200);
  console.log('step nav backup');let nav=await p.$$('.bottom-nav .nav-button');await nav[1].tap();await sleep(600);assert.equal(await p.data('view'),'backup');await sleep(300);await m.screenshot({path:path.join(out,'07-backup.png')});
  console.log('step nav help');nav=await p.$$('.bottom-nav .nav-button');await nav[2].tap();for(let i=0;i<30;i++){if((await m.currentPage()).path==='pages/help/help')break;await sleep(250);}assert.equal((await m.currentPage()).path,'pages/help/help');await m.screenshot({path:path.join(out,'05-help.png')});
  console.log('step return');await m.callWxMethod('navigateBack',{delta:1});for(let i=0;i<30;i++){if((await m.currentPage()).path==='pages/index/index')break;await sleep(250);}console.log('step returned');await sleep(1500);p=await m.currentPage();nav=await p.$$('.bottom-nav .nav-button');await nav[0].tap();await sleep(600);assert.equal(await p.data('view'),'list');pass('底部档案、备份、帮助三个入口实际触控正常');
  await m.evaluate(()=>{const key='student-manager-lite.v3.archive';const db=JSON.parse(getApp().__archiveQA[key]);for(const t of ['students','scores','tags','plans'])db[t]=[];db.revision++;getApp().__archiveQA[key]=JSON.stringify(db);});
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');assert.equal(await p.data('totals.records'),0);assert.equal(await p.data('categories').then(x=>x.length),3);await m.screenshot({path:path.join(out,'06-empty.png')});pass('已有空库不重复注入10名示例，分类保留');
  assert.equal(errors.length,0);pass('最终导航与空库原生运行无异常');
  const previous=JSON.parse(fs.readFileSync(path.join(out,'flow-result.json'),'utf8'));assert.equal(previous.errors.length,0);
  previous.segments=[{name:'category workflow',checks:previous.checks.length,note:'Workflow assertions passed; navigation transport timeout then tested separately after regular-view navigation fix.'},{name:'navigation and empty archive',checks:checks.length,at:new Date().toISOString()}];previous.checks.push(...checks);previous.at=new Date().toISOString();previous.errors.push(...errors);previous.complete=true;
  fs.writeFileSync(path.join(out,'flow-result.json'),JSON.stringify(previous,null,2));
 }finally{for(const name of mocked)await m.restoreWxMethod(name).catch(()=>{});m.disconnect();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
