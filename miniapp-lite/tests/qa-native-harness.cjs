'use strict';
// Reusable isolated wx mock; never reads the user's actual mini-program storage.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..','miniprogram');
const KEY='student-manager-lite.v3.archive';
const PERSONAL='student-manager-lite.v1.personal',DEMO='student-manager-lite.v1.demo';
const snapshot=value=>JSON.stringify(value);
const event=(dataset={},value)=>({currentTarget:{dataset},detail:{value}});
function harness(initial={}){
 const store=new Map(Object.entries(initial));let definition,app;
 const state={writes:[],reads:[],clipboard:[],routes:[],modals:[],pendingModals:[],infoFailure:false,readFailure:false,writeFailure:false,clipboardFailure:false,navigateFailure:false,deferModal:false,confirm:true};
 const context=vm.createContext({Page:value=>{definition=value;},App:value=>{app=value;},console});
 const parse=vm.runInContext('text=>JSON.parse(text)',context);
 context.wx={
  getStorageInfoSync(){if(state.infoFailure)throw Error('SYNTHETIC_INFO_FAILURE');return{keys:[...store.keys()]};},
  getStorageSync(key){state.reads.push(key);if(state.readFailure)throw Error('SYNTHETIC_READ_FAILURE');const value=store.get(key);return value&&typeof value==='object'?parse(snapshot(value)):value;},
  setStorageSync(key,value){if(state.writeFailure)throw Error('SYNTHETIC_WRITE_FAILURE');state.writes.push({key,value});store.set(key,value);},
  showModal(options){state.modals.push(options);if(state.deferModal)state.pendingModals.push(options);else options.success({confirm:state.confirm,cancel:!state.confirm});},
  setClipboardData(options){if(state.clipboardFailure)options.fail?.({errMsg:'SYNTHETIC_COPY_FAILURE'});else{state.clipboard.push(options.data);options.success?.();}},
  navigateTo(options){if(state.navigateFailure)options.fail?.({errMsg:'SYNTHETIC_NAV_FAILURE'});else{state.routes.push(options.url);options.success?.();}},
  pageScrollTo(){}
 };
 const cache=new Map();
 function load(file){
  file=path.resolve(file);assert.ok(file.startsWith(root+path.sep),'module outside native project');if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const fn=vm.runInContext('(function(module,exports,require){\n'+fs.readFileSync(file,'utf8')+'\n})',context,{filename:path.basename(file)});
  fn(module,module.exports,request=>load(path.resolve(path.dirname(file),request)));return module.exports;
 }
 const core=load(path.join(root,'lib/core.js'));
 vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),context,{filename:'app.js'});
 context.require=request=>load(path.resolve(root,'pages/index',request));
 vm.runInContext(fs.readFileSync(path.join(root,'pages/index/index.js'),'utf8'),context,{filename:'index.js'});
 const page=Object.create(definition);page.data=parse(snapshot(definition.data));
 page.setData=values=>{for(const[name,value]of Object.entries(values)){const parts=name.split('.');let target=page.data;for(const part of parts.slice(0,-1)){if(!target[part]||typeof target[part]!=='object')target[part]={};target=target[part];}target[parts.at(-1)]=value;}};
 context.page=page;
 return{page,core,store,state,app,parse,run:code=>vm.runInContext(code,context),resolveModal(confirm=true){const pending=state.pendingModals.shift();assert.ok(pending,'no modal is pending');pending.success({confirm,cancel:!confirm});}};
}
function emptyHarness(){
 const empty={schemaVersion:4,revision:0,categories:[],students:[],scores:[],tags:[],plans:[]};const h=harness({[KEY]:snapshot(empty)});h.page.onLoad();return h;
}
function personal(){
 const h=emptyHarness();h.page.onAddStudent();for(const[field,value]of Object.entries({name:'SYNTHETIC_TEACHER_ARCHIVE',grade:'七年级'}))h.page.onFieldInput(event({field},value));h.page.onSaveForm();
 assert.equal(h.page._db.students.length,1);assert.equal(h.page._db.students[0].subject,'英语');h.page.onOpenStudent(event({id:h.page._db.students[0].id}));return h;
}
function addScore(h,extra={}){h.page.onAddScore();for(const[field,value]of Object.entries({title:'SYNTHETIC_EXAM',score:'42',total:'50',...extra}))h.page.onFieldInput(event({field},value));h.page.onSaveForm();}
function addTag(h,type='weak',label='SYNTHETIC_TOPIC'){h.page.onAddTag(event({type}));h.page.onFieldInput(event({field:'label'},label));h.page.onSaveForm();}
function prepareImport(h,db){h.page.onImportInput(event({},h.core.exportDatabase(db)));h.page.onCheckImport();h.page.onImportAgree(event({},['replace']));}
function legacy(version=2){return{schemaVersion:version,revision:8,students:[{id:'OLD',name:'SYNTHETIC_LEGACY',grade:'七年级',className:'SYNTHETIC_HIDDEN',note:''}],scores:[{id:'OLD-S',studentId:'OLD',title:'SYNTHETIC_OLD_EXAM',date:'2026-10-06',score:40,total:50,note:'',...(version===2?{subject:'数学'}:{})}],tags:[],plans:[]};}
module.exports={root,KEY,PERSONAL,DEMO,event,snapshot,harness,emptyHarness,personal,addScore,addTag,prepareImport,legacy};
