const a=require('miniprogram-automator'),fs=require('fs'),path=require('path');
const out=path.join(__dirname,'evidence-0.3.0-final');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9420'});const mocked=[];try{
 for(let i=0;i<60;i++){if(await m.evaluate(()=>{const app=getApp();if(!app)return false;app.__archiveQA={};return true;}))break;await sleep(300)}
 for(const [name,fn] of Object.entries({getStorageInfoSync:function(){return {keys:Object.keys(getApp().__archiveQA),currentSize:0,limitSize:10240};},getStorageSync:function(key){return getApp().__archiveQA[key];},setStorageSync:function(key,value){getApp().__archiveQA[key]=value;}})){await m.mockWxMethod(name,fn);mocked.push(name);}
 let p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');await sleep(900);
 await m.screenshot({path:path.join(out,'10-final-home.png')});
 console.log('composition',await(await p.$('.composition-card')).size());
 await m.pageScrollTo(190);await sleep(600);await m.screenshot({path:path.join(out,'11-final-cards.png')});
 await m.pageScrollTo(100000);await sleep(600);await m.screenshot({path:path.join(out,'12-bottom-chart.png')});
 // Synthetic stress archive: same-day 0/100 scores and long labels.
 await m.evaluate(()=>{const key='student-manager-lite.v3.archive';const db=JSON.parse(getApp().__archiveQA[key]);const s=db.students[0];s.name='用于检验长称呼与换行的虚构学员甲乙丙丁';s.grade='五年级（阅读专项）';s.subject='英语';db.categories[0].name='周末英语阅读与语法专项提升';s.categoryId=db.categories[0].id;db.scores=db.scores.filter(r=>r.studentId!==s.id);db.tags=db.tags.filter(r=>r.studentId!==s.id);db.plans=db.plans.filter(r=>r.studentId!==s.id);db.scores.push({id:'qa_zero',studentId:s.id,subject:s.subject,title:'同日测评一',date:'2026-10-05',score:0,total:100,note:''},{id:'qa_full',studentId:s.id,subject:s.subject,title:'同日测评二',date:'2026-10-05',score:120,total:120,note:''});db.revision++;getApp().__archiveQA[key]=JSON.stringify(db);});
 p=await m.reLaunch('/pages/index/index');await p.waitFor('.composition-card');const stress=(await p.data('groups')).find(g=>g.name.includes('专项'));await p.callMethod('onSelectGroup',{currentTarget:{dataset:{key:stress.key}}});await m.pageScrollTo(220);await sleep(700);await m.screenshot({path:path.join(out,'13-long-label-zero-full.png')});
 const card=await p.$('.student-card');console.log('stressCard',await card.size());
 console.log('PASS final visual checkpoints');
}finally{for(const name of mocked)await m.restoreWxMethod(name).catch(()=>{});m.disconnect();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
