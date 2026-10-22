'use strict';
const core = require('./core.js');
const keyOf = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const rate = row => Math.round(row.score / row.total * 1000) / 10;

function seriesForStudent(db, studentId, today) {
  const student = db.students.find(row => row.id === studentId);
  if (!student) return [];
  const subject = keyOf(student.subject);
  return db.scores.filter(row => row.studentId === studentId && keyOf(row.subject) === subject && row.date <= (today || core.today()))
    .slice().sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).slice(-6)
    .map(row => ({id:row.id,date:row.date,title:row.title,score:row.score,total:row.total,rate:rate(row)}));
}

function buildDashboard(db, options) {
  options = options || {};
  const groupsMap = new Map();
  const groupKey = student => student.categoryId || 'unassigned';
  (db.categories || []).forEach(category => groupsMap.set(category.id, {
    key:category.id,name:category.name,label:category.name,total:category.total,count:0,exampleCount:0,ratio:0
  }));
  const pending = new Map();
  db.plans.forEach(plan => { if (plan.status === 'todo') pending.set(plan.studentId, (pending.get(plan.studentId) || 0) + 1); });
  db.students.forEach(student => {
    const key = groupKey(student);
    if (!groupsMap.has(key)) groupsMap.set(key, {key,name:'未分类',label:'未分类',total:null,count:0,exampleCount:0,ratio:0});
    const group = groupsMap.get(key);
    group.count += 1; if (student.isExample === true) group.exampleCount += 1;
  });
  if(!groupsMap.size)groupsMap.set('unassigned',{key:'unassigned',name:'未分类',label:'未分类',total:null,count:0,exampleCount:0,ratio:0});
  const groups = Array.from(groupsMap.values());
  groups.forEach(group => {group.ratio = db.students.length ? Math.round(group.count/db.students.length*100) : 0;});
  const selectedGroup = groups.find(group => group.key === options.groupKey) || groups[0] || null;
  const query = String(options.query || '').trim().toLowerCase();
  const cards = db.students.filter(student => selectedGroup && groupKey(student) === selectedGroup.key)
    .filter(student => !query || [student.name,student.grade,student.subject].join(' ').toLowerCase().includes(query))
    .filter(student => !options.todoOnly || pending.get(student.id)>0)
    .map(student => {
      const series=seriesForStudent(db,student.id,options.today);
      const latest=series[series.length-1];
      const scoreCount=db.scores.filter(s=>s.studentId===student.id).length;
      const chartEmptyTitle=scoreCount?'暂无可展示的同科成绩':'还没有成绩记录';
      const chartEmptyHint=scoreCount?'已有记录保留在档案中，请核对科目与日期':'记下第一次测评，从这里开始';
      const category=groupsMap.get(groupKey(student));
      return {id:student.id,name:student.name,grade:student.grade || '年级待填',subject:student.subject || '学科待整理',categoryName:category.name,defaultTotal:category.total,isExample:student.isExample===true,todo:pending.get(student.id)||0,scoreCount,latestTitle:latest?latest.title:'',latestDate:latest?latest.date:'',latestText:latest?`${latest.score} / ${latest.total}`:scoreCount?`已记 ${scoreCount} 条`:'尚无成绩',latestRate:latest?`${latest.rate}%`:'—',series,chartEmptyTitle,chartEmptyHint};
    });
  return {groups,selectedKey:selectedGroup?selectedGroup.key:'',selectedGroup,cards,totals:{records:db.students.length,groups:groups.length,examples:db.students.filter(s=>s.isExample===true).length,todo:db.plans.filter(p=>p.status==='todo').length}};
}
module.exports={buildDashboard,seriesForStudent};
