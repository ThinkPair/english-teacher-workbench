const a=require('miniprogram-automator'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname, '../..'),core=require(root+'/miniprogram/lib/core.js');
const out=path.join(__dirname,'evidence-0.4.0'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9420'}),mocked=[],errors=[],checks=[];let p;
 const until=async fn=>{for(let i=0;i<60;i++){if(await fn())return;await sleep(250)}throw Error('condition timed out')};
 const chart=async()=>{const c=await p.$('#groupLinesChart');await until(async()=>!!await c.data('chartImage')||await c.data('chartFailed'));assert.equal(await c.data('chartFailed'),false);return c;};
 const shot=async name=>{await sleep(400);await m.screenshot({path:path.join(out,name+'.png')})};
 m.on('exception',e=>errors.push(e));
 try{
  await until(()=>m.evaluate(()=>{const app=getApp();if(!app)return false;app.__groupQA={};return true;}));
  for(const[name,fn]of Object.entries({getStorageInfoSync:function(){return{keys:Object.keys(getApp().__groupQA),currentSize:0,limitSize:10240}},getStorageSync:function(key){return getApp().__groupQA[key]},setStorageSync:function(key,value){getApp().__groupQA[key]=value}})){await m.mockWxMethod(name,fn);mocked.push(name);}
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');await chart();
  const pie=await p.$('#categoryPie');await until(async()=>!!await pie.data('chartImage'));await shot('10-final-home');await m.pageScrollTo(270);await shot('11-final-number-leaders');
  assert.equal((await p.data('comparison.series')).length,4);checks.push('最终源码小学4线默认态绘图成功，编号位于真实点或由引导线关联');
  const legend=await p.$$('.series-legend-item');await legend[3].tap();await until(async()=>(await p.data('comparisonFocusId'))==='demo-student-d');await chart();await shot('12-final-focused-leader');
  checks.push('实际点击第4名突出86分，其他3条线保留');
  await m.pageScrollTo(0);const categories=await p.$$('.composition-group');await categories[1].tap();await until(async()=>(await p.data('comparison.max'))===120);await chart();await shot('13-final-middle-120');
  checks.push('最终初中3条线与120分轴正常，切类清除旧高亮');
  const stress=core.createDatabase(false);stress.categories=[{id:'zero-full',name:'同日零分满分验证',total:100}];
  for(let i=0;i<3;i++){stress.students.push({id:'same-'+i,name:'同日样本'+i+'（虚构）',grade:'七年级',className:'',note:'',subject:'英语',isExample:true,categoryId:'zero-full'});stress.scores.push({id:'point-'+i,studentId:'same-'+i,subject:'英语',title:'同日测评',date:core.today(),score:i===0?0:100,total:100,note:''});}
  await m.evaluate(raw=>{getApp().__groupQA={'student-manager-lite.v3.archive':raw}},core.exportDatabase(stress));
  p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');await chart();assert.equal(await p.data('comparison.pointCount'),3);await shot('14-same-date-zero-full');
  checks.push('同日零分满分为同一横坐标的真实点，缺少跨日记录不画假趋势');
  assert.equal(errors.length,0);const flow=JSON.parse(fs.readFileSync(path.join(out,'flow-result.json'),'utf8'));assert.equal(flow.checks.length,12);
  flow.finalVisualChecks=checks;flow.finalVisualErrors=errors;flow.finalVisualAt=new Date().toISOString();flow.finalSourceRecheck=true;
  fs.writeFileSync(path.join(out,'flow-result.json'),JSON.stringify(flow,null,2));console.log(JSON.stringify({passed:checks.length,errors:errors.length}));
 }finally{for(const name of mocked)await m.restoreWxMethod(name).catch(()=>{});m.disconnect();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
