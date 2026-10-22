'use strict';
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'miniprogram/lib/core.js'),'utf8');
const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
let passed=0,failed=0;
function env(initial={}) {
  const disk=new Map(Object.entries(initial)), dom=new Map(), handlers={}, windowHandlers={}, downloads=[];
  const faults={get:null,set:null};
  function elem(selector) {
    if(!dom.has(selector)) dom.set(selector,{innerHTML:'',textContent:'',value:'',open:false,files:[],dataset:{},classList:{add(){},remove(){}},addEventListener(type,fn){handlers[selector+':'+type]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){},setSelectionRange(){},scrollIntoView(){},click(){},remove(){}});
    return dom.get(selector);
  }
  const document={querySelector(s){if(s==='#record-form'&&!elem('#editor').innerHTML.includes('id="record-form"'))return null;return elem(s);},addEventListener(type,fn){handlers['document:'+type]=fn;},body:{appendChild(){}},createElement(){return {click(){downloads.push(this);},remove(){}};}};
  const sandbox={document,localStorage:{getItem(k){if(faults.get)throw Error(faults.get);return disk.has(k)?disk.get(k):null;},setItem(k,v){if(faults.set)throw Error(faults.set);disk.set(k,String(v));}},setTimeout(){return 1;},clearTimeout(){},confirm(){return true;},Blob:class{constructor(parts){this.parts=parts;}},URL:{createObjectURL(){return 'blob:synthetic';},revokeObjectURL(){}},console};
  sandbox.window=sandbox;sandbox.window.addEventListener=(type,fn)=>windowHandlers[type]=fn;
  const context=vm.createContext(sandbox);
  vm.runInContext('class FormData { constructor(form) { this.rows = Object.entries(form?.values || {}); } [Symbol.iterator]() { return this.rows[Symbol.iterator](); } };',context);
  vm.runInContext(core,context);
  const instrumented=app.replace(/  load\(\);\s*\}\(\)\);\s*$/, '  load(); window.__qa={snapshot:()=>JSON.stringify({mode,db,expectedRaw,selectedId,stale,loadError,formContext}),load,persist,action,openEditor,saveForm,render,closeEditor};\n}());');
  assert.notEqual(instrumented,app,'instrumentation anchor missing');
  vm.runInContext(instrumented,context);
  return {disk,dom,handlers,windowHandlers,faults,downloads,run:s=>vm.runInContext(s,context),state(){return JSON.parse(vm.runInContext('__qa.snapshot()',context));},html(){return elem('#app').innerHTML;},toast(){return elem('#toast').textContent;},element:elem};
}
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
const demoKey='student-manager-lite.v1.demo', personalKey='student-manager-lite.v1.personal';
(async()=>{
await test('demo/personal are different physical keys',()=>{
 const e=env();assert.ok(e.state().db.students.length);
 e.run('__qa.action({dataset:{action:"mode",value:"personal"}})');
 assert.deepEqual(e.state().db.students,[]);assert.notEqual(e.disk.get(demoKey),e.disk.get(personalKey));
});
await test('save failure preserves state and stored data',()=>{
 const e=env();const before=e.state(),raw=e.disk.get(demoKey);e.faults.set='SYNTHETIC_QUOTA_FAILURE';
 assert.throws(()=>e.run('__qa.persist(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"SYNTHETIC_NEW"}))'),/SYNTHETIC_QUOTA_FAILURE/);
 assert.deepEqual(e.state(),before);assert.equal(e.disk.get(demoKey),raw);
});
await test('external update without storage event blocks overwrite',()=>{
 const e=env();const changed=e.run('StudentCore.exportDatabase(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"SYNTHETIC_EXTERNAL"}))');e.disk.set(demoKey,changed);
 assert.throws(()=>e.run('__qa.persist(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"SYNTHETIC_LOCAL"}))'),/另一窗口/);
 assert.equal(e.disk.get(demoKey),changed);
});
await test('storage event marks state stale and blocks write',()=>{
 const e=env();e.windowHandlers.storage({key:demoKey});assert.equal(e.state().stale,true);
 assert.throws(()=>e.run('__qa.persist(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"SYNTHETIC_LOCAL"}))'),/另一窗口/);
});
await test('corrupt formal store never seeds demo or resets it',()=>{
 const e=env({[personalKey]:'SYNTHETIC_CORRUPT_JSON'});e.run('__qa.action({dataset:{action:"mode",value:"personal"}})');
 assert.equal(e.state().db,null);assert.equal(e.disk.get(personalKey),'SYNTHETIC_CORRUPT_JSON');assert.ok(e.html().includes('档案暂时无法读取'));
});
await test('invalid restore is atomic',async()=>{
 const e=env(),before=e.state(),raw=e.disk.get(demoKey);
 await e.handlers['#restore-file:change']({target:{files:[{size:5,text:async()=>'{bad'}]}});
 assert.deepEqual(e.state(),before);assert.equal(e.disk.get(demoKey),raw);assert.ok(e.toast().includes('未导入'));
});
await test('restore uses current revision not source revision',async()=>{
 const e=env();e.run('__qa.persist(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"SYNTHETIC_NEW"}))');
 const before=e.state().db.revision, incoming=e.run('JSON.stringify({...StudentCore.createDatabase(false),revision:999999})');
 await e.handlers['#restore-file:change']({target:{files:[{size:incoming.length,text:async()=>incoming}]}});
 assert.equal(e.state().db.revision,before+1);assert.equal(e.state().db.students.length,0);
});
await test('pending restore cannot land in a different space',async()=>{
 const e=env(),incoming=e.run('StudentCore.exportDatabase(StudentCore.createDatabase(false))');let resolve;
 const pending=e.handlers['#restore-file:change']({target:{files:[{size:incoming.length,text:()=>new Promise(r=>{resolve=r;})}]}});
 e.run('__qa.action({dataset:{action:"mode",value:"personal"}})');const raw=e.disk.get(personalKey);resolve(incoming);await pending;
 assert.equal(e.disk.get(personalKey),raw);assert.ok(e.toast().includes('空间已经切换'));
});
await test('dynamic content is escaped across render and editor',()=>{
 const e=env();e.run('__qa.persist(StudentCore.saveStudent(JSON.parse(__qa.snapshot()).db,{name:"<img src=x onerror=alert(1)>",note:"</textarea><svg onload=alert(2)>"}));__qa.action({dataset:{action:"select",id:JSON.parse(__qa.snapshot()).db.students.slice(-1)[0].id}});__qa.action({dataset:{action:"edit-student"}})');
 const output=e.html()+e.element('#editor').innerHTML;
 assert.ok(!output.includes('<img src=x'));assert.ok(!output.includes('<svg onload='));assert.ok(output.includes('&lt;img'));
});
await test('read failure after space switch must not offer other space raw backup',()=>{
 const e=env();const old=e.state().expectedRaw;e.faults.get='SYNTHETIC_READ_FAILURE';
 e.run('__qa.action({dataset:{action:"mode",value:"personal"}})');
 assert.equal(e.state().mode,'personal');assert.equal(e.state().db,null);
 assert.notEqual(e.state().expectedRaw,old,'personal error state retained demo raw data; export-raw would export the previous space');
 assert.ok(!e.html().includes('data-action="export-raw"'),'unreadable space still exposes a raw-export button');
 e.run('__qa.action({dataset:{action:"export-raw"}})');
 assert.equal(e.downloads.length,0,'direct raw-export action downloaded other-space data');
});
console.log(JSON.stringify({suite:'independent-web-storage-attacks',passed,failed,syntheticDataOnly:true,realBrowserStorageAccessed:false}));
process.exitCode=failed?1:0;
})();

