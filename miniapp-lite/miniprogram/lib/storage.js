'use strict';
const core=require('./core.js');
const KEY='student-manager-lite.v3.archive';
const LEGACY={personal:'student-manager-lite.v1.personal',demo:'student-manager-lite.v1.demo'};
const LIMIT=900*1024;
const bytes=text=>{let size=0;for(const char of text){const point=char.codePointAt(0);size+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;}return size;};
function keys(wx){
  const info=wx.getStorageInfoSync();
  if(!info||!Array.isArray(info.keys))throw new Error('暂时无法读取本机档案，请重试。');
  return info.keys;
}
function read(wx){
  const list=keys(wx);
  const source=list.includes(KEY)?KEY:list.includes(LEGACY.personal)?LEGACY.personal:KEY;
  const present=list.includes(source);
  const raw=present?wx.getStorageSync(source):undefined;
  return {present,raw,token:source+':'+(present?JSON.stringify(raw):'missing'),legacy:source===LEGACY.personal,legacyDemoAvailable:list.includes(LEGACY.demo)};
}
function commit(wx,db,expectedToken){
  const clean=core.validateDatabase(db),raw=core.exportDatabase(clean);
  if(bytes(raw)>LIMIT)throw new Error('档案已接近本地容量上限，本次未保存；请先备份再整理。');
  if(read(wx).token!==expectedToken)throw new Error('档案已发生变化，本次没有覆盖。请保留未提交文字，再重新读取档案。');
  try{wx.setStorageSync(KEY,raw);}catch(error){throw new Error('本地保存失败，请保留填写内容并检查设备存储后重试。');}
  return {present:true,raw,token:KEY+':'+JSON.stringify(raw),legacy:false};
}
function legacyRaw(wx,kind){
  if(!Object.prototype.hasOwnProperty.call(LEGACY,kind))throw new Error('旧档案类型无效');
  if(!keys(wx).includes(LEGACY[kind]))throw new Error('本机没有这份旧版记录。');
  return wx.getStorageSync(LEGACY[kind]);
}
module.exports={KEY,read,commit,legacyRaw};
