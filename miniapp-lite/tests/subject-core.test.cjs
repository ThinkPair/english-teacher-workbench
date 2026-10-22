'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/core.js');
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function base() { return core.saveStudent(core.createDatabase(), { name: '虚构跨学科学员 A' }); }
function score(studentId, subject, extra = {}) {
  return { studentId, subject, title: '虚构测验', date: '2026-10-06', score: 40, total: 50, ...extra };
}
function tag(studentId, subject, extra = {}) {
  return { studentId, subject, type: 'weak', label: '一般过去时', observedOn: '2026-10-06', ...extra };
}
function legacy() {
  return {
    schemaVersion: 1, revision: 37,
    students: [
      { id: 'fixture-student-a', name: '虚构旧学员 A', grade: '七年级', className: '虚构一班', note: '迁移保留原备注。' },
      { id: 'fixture-student-b', name: '虚构旧学员 B', grade: '', className: '', note: '' }
    ],
    scores: [
      { id: 'fixture-score-a', studentId: 'fixture-student-a', title: '数学虚构标题也不推断科目', date: '2024-02-29', score: 0, total: 100, note: '原成绩备注。' },
      { id: 'fixture-score-b', studentId: 'fixture-student-b', title: '虚构英文小测', date: '2026-10-01', score: 7.5, total: 10, note: '' }
    ],
    tags: [
      { id: 'fixture-tag-a', studentId: 'fixture-student-a', type: 'weak', label: '一般过去时', note: '原教师观察。', observedOn: '2026-10-01', status: 'active' },
      { id: 'fixture-tag-b', studentId: 'fixture-student-b', type: 'strong', label: '分数运算', note: '', observedOn: '2026-10-01', status: 'resolved' }
    ],
    plans: [{ id: 'fixture-plan-a', studentId: 'fixture-student-a', title: '虚构旧跟进', body: '保留原计划内容。', dueDate: '', status: 'done', result: '原完成记录。', sourceEvidence: ['旧证据：2026-10-01 的观察。'] }]
  };
}
function ideaFor(db, id) { return core.suggestions(db, id, '2026-10-06'); }

test('v1 migration is deterministic, nonmutating and preserves every canonical record and revision', () => {
  const original = freeze(legacy());
  const expected = clone(original);
  expected.schemaVersion = 4;
  expected.categories = [];
  expected.students.forEach(row => { row.subject = ''; row.isExample = false; row.categoryId = ''; });
  for (const table of ['scores', 'tags']) expected[table].forEach(row => { row.subject = ''; });
  const first = core.validateDatabase(original);
  const second = core.importDatabase(JSON.stringify(original));
  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.equal(original.schemaVersion, 1);
  assert.equal(original.revision, 37);
  assert.equal(Object.hasOwn(original.scores[0], 'subject'), false);
  assert.deepEqual(core.validateDatabase(first), first);
  first.plans[0].sourceEvidence[0] = '调用方后续改动';
  assert.equal(original.plans[0].sourceEvidence[0], '旧证据：2026-10-01 的观察。');
});

test('v1 migration never silently fixes damaged records, dangling ownership, conflicts or unsupported versions', () => {
  for (const corrupt of [
    db => { db.scores[0].score = '0'; },
    db => { db.scores[0].date = '2026-02-30'; },
    db => { db.tags[0].studentId = 'missing'; },
    db => { db.tags.push({ ...db.tags[0], id: 'fixture-other', type: 'strong' }); },
    db => { db.students.push({ ...db.students[0] }); },
    db => { delete db.plans[0].body; },
    db => { db.revision = -1; }
  ]) {
    const db = legacy(); corrupt(db);
    const before = JSON.stringify(db);
    assert.throws(() => core.importDatabase(before));
    assert.equal(JSON.stringify(db), before);
  }
  for (const version of [0, 5, '1', '2', '3', '4', null, 1.5]) assert.throws(() => core.validateDatabase({ ...legacy(), schemaVersion: version }), /版本/);
});

test('export always emits v4, roundtrips subjects and legacy evidence without inferring new data', () => {
  const migrated = core.importDatabase(JSON.stringify(legacy()));
  assert.equal(JSON.parse(core.exportDatabase(legacy())).schemaVersion, 4);
  assert.equal(migrated.scores[0].subject, '');
  assert.equal(migrated.tags[0].subject, '');
  let db = core.saveScore(migrated, { ...migrated.scores[0], subject: '数学' });
  db = core.saveTag(db, { ...db.tags[0], subject: '英语' });
  const exported = core.exportDatabase(db);
  assert.equal(JSON.parse(exported).schemaVersion, 4);
  assert.deepEqual(core.importDatabase(exported), db);
  assert.deepEqual(db.plans, migrated.plans);
  assert.equal(db.revision, 39);
});

test('record subject defaults to empty for an unclassified owner and is validated as a bounded string', () => {
  const db = base(), id = db.students[0].id;
  for (const [save, make] of [[core.saveScore, score], [core.saveTag, tag]]) {
    const table = save === core.saveScore ? 'scores' : 'tags';
    assert.equal(save(db, make(id, undefined))[table][0].subject, '');
    assert.equal(save(db, make(id, '  Math   Studies  '))[table][0].subject, 'Math Studies');
    assert.equal(save(db, make(id, '科'.repeat(50)))[table][0].subject.length, 50);
    for (const bad of [null, false, 123, [], {}, '科'.repeat(51), '数学\u0000']) assert.throws(() => save(db, make(id, bad)), /科目/);
    const canonical = save(db, make(id, '数学'));
    delete canonical[table][0].subject;
    assert.equal(core.validateDatabase(canonical)[table][0].subject, '');
  }
});

test('old UI edits missing subject retain it; explicit empty clears it and invalid edits are atomic', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, '数学'));
  db = core.saveTag(db, tag(id, '英语'));
  for (const [save, table] of [[core.saveScore, 'scores'], [core.saveTag, 'tags']]) {
    const oldInput = clone(db[table][0]); delete oldInput.subject;
    oldInput.note = '虚构旧界面编辑';
    const next = save(freeze(db), freeze(oldInput));
    assert.equal(next[table][0].subject, db[table][0].subject);
    assert.equal(next[table][0].note, '虚构旧界面编辑');
    assert.equal(next.revision, db.revision + 1);
    const cleared = save(next, { ...next[table][0], subject: '' });
    assert.equal(cleared[table][0].subject, '');
    const before = core.exportDatabase(next);
    assert.throws(() => save(next, { ...next[table][0], subject: null }), /科目/);
    assert.equal(core.exportDatabase(next), before);
  }
});

test('new subject validation does not execute accessor data or propagate pollution fields', () => {
  const db = base(), id = db.students[0].id;
  let called = false;
  const input = score(id, '数学');
  Object.defineProperty(input, 'subject', { get() { called = true; return '数学'; } });
  assert.throws(() => core.saveScore(db, input), /动态读取/);
  assert.equal(called, false);
  const legacyWithExtras = JSON.parse(JSON.stringify(legacy()).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}'));
  legacyWithExtras.scores[0].extra = '去除';
  const clean = core.validateDatabase(legacyWithExtras);
  assert.equal(Object.hasOwn(clean, '__proto__'), false);
  assert.equal(Object.hasOwn(clean.scores[0], 'extra'), false);
  assert.equal({}.polluted, undefined);
});

test('same labels can coexist across subjects, but normalized same-subject duplicates/conflicts cannot', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveTag(db, tag(id, 'English', { label: '理解' }));
  db = core.saveTag(db, tag(id, '数学', { label: '理解', type: 'strong' }));
  db = core.saveTag(db, tag(id, '', { label: '理解', type: 'strong' }));
  assert.equal(db.tags.length, 3);
  assert.throws(() => core.saveTag(db, tag(id, 'ＥＮＧＬＩＳＨ', { label: ' 理 解 ' })), /已有/);
  assert.throws(() => core.saveTag(db, tag(id, 'e n g l i s h', { label: '理解', type: 'strong' })), /同一科目.*薄弱和强项/);
  assert.doesNotThrow(() => core.saveTag(db, tag(id, '英语', { label: '理解', type: 'strong' })), 'semantic subject aliases must not be guessed');
});

test('moving or clearing a subject checks the destination conflict before publishing any update', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveTag(db, tag(id, '数学', { label: '理解', type: 'strong' }));
  db = core.saveTag(db, tag(id, '英语', { label: '理解', type: 'weak' }));
  db = core.saveTag(db, tag(id, '', { label: '理解', type: 'strong' }));
  const before = core.exportDatabase(db), weak = db.tags[1];
  assert.throws(() => core.saveTag(db, { ...weak, subject: '数学' }), /薄弱和强项/);
  assert.throws(() => core.saveTag(db, { ...weak, subject: '' }), /薄弱和强项/);
  assert.equal(core.exportDatabase(db), before);
  const resolved = core.saveTag(db, { ...db.tags[0], status: 'resolved' });
  assert.doesNotThrow(() => core.saveTag(resolved, { ...weak, subject: '数学' }));
});

test('same subject/label remains independent by student and import enforces the same conflict rules', () => {
  let db = base();
  db = core.saveStudent(db, { name: '虚构跨学科学员 B' });
  db = core.saveTag(db, tag(db.students[0].id, '数学', { label: '分数', type: 'weak' }));
  db = core.saveTag(db, tag(db.students[1].id, '数学', { label: '分数', type: 'strong' }));
  assert.deepEqual(core.importDatabase(core.exportDatabase(db)), db);
  const damaged = clone(db); damaged.tags[1].studentId = damaged.students[0].id;
  assert.throws(() => core.importDatabase(JSON.stringify(damaged)), /薄弱和强项/);
});

test('score advice groups each named subject separately and uses only that subject in rates/evidence', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, '英语', { title: '虚构英语旧卷', date: '2026-10-01', score: 72, total: 100 }));
  db = core.saveScore(db, score(id, '数学', { title: '虚构数学旧卷', date: '2026-10-02', score: 10, total: 20 }));
  db = core.saveScore(db, score(id, '英语', { title: '虚构英语新卷', date: '2026-10-03', score: 42, total: 50 }));
  db = core.saveScore(db, score(id, '数学', { title: '虚构数学新卷', date: '2026-10-04', score: 17, total: 20 }));
  const ideas = ideaFor(db, id).filter(item => item.key.startsWith('score-'));
  assert.equal(ideas.length, 2);
  const english = ideas.find(item => item.title.includes('英语'));
  const math = ideas.find(item => item.title.includes('数学'));
  assert.match(JSON.stringify(english), /84%/); assert.match(JSON.stringify(english), /72%/);
  assert.doesNotMatch(JSON.stringify(english), /数学|85%|50%/);
  assert.match(JSON.stringify(math), /85%/); assert.match(JSON.stringify(math), /50%/);
  assert.doesNotMatch(JSON.stringify(math), /英语|84%|72%/);
  assert.ok(ideas.every(item => item.evidence.length === 2 && item.body.includes('不据此判断能力变化或教学效果')));
});

test('unknown subject is not a comparable group; only its latest single record is used', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, '', { title: '可能不同科的虚构旧卷', date: '2026-10-01', score: 70, total: 100 }));
  db = core.saveScore(db, score(id, '', { title: '未分类虚构新卷', date: '2026-10-04', score: 40, total: 50 }));
  db = core.saveScore(db, score(id, '英语', { title: '英语虚构卷', date: '2026-10-05', score: 35, total: 50 }));
  const idea = ideaFor(db, id).find(item => item.title.includes('未分类'));
  assert.equal(idea.evidence.length, 1);
  assert.match(idea.body, /不做前后比较.*补充科目/);
  assert.doesNotMatch(JSON.stringify(idea), /可能不同科|英语|70%/);
});

test('normalization groups subject case/width variants without merging different semantic aliases', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, 'Math', { title: '虚构旧卷', date: '2026-10-01' }));
  db = core.saveScore(db, score(id, 'ＭＡＴＨ', { title: '虚构新卷', date: '2026-10-02' }));
  db = core.saveScore(db, score(id, '数学', { title: '不同文字科目标记的虚构卷', date: '2026-10-03' }));
  const ideas = ideaFor(db, id).filter(item => item.key.startsWith('score-'));
  assert.equal(ideas.length, 2);
  assert.equal(ideas.find(item => item.title.includes('ＭＡＴＨ')).evidence.length, 2);
  assert.equal(ideas.find(item => item.title.includes('数学')).evidence.length, 1);
});

test('score advice remains bounded by recent subjects and excludes future/other-student data', () => {
  let db = base(), id = db.students[0].id;
  for (const [index, subject] of ['英语', '数学', '语文', '物理'].entries()) db = core.saveScore(db, score(id, subject, { date: '2026-10-0' + (index + 1), title: '虚构' + subject }));
  db = core.saveScore(db, score(id, '化学', { date: '2026-10-07', title: '未来虚构化学' }));
  db = core.saveStudent(db, { name: '虚构第二学员' });
  db = core.saveScore(db, score(db.students[1].id, '美术', { title: '另一学员虚构美术' }));
  const ideas = ideaFor(db, id).filter(item => item.key.startsWith('score-'));
  assert.equal(ideas.length, 3);
  assert.match(ideas[0].title, /物理/);
  assert.doesNotMatch(JSON.stringify(ideas), /化学|美术|虚构英语/);
});

test('Chinese/history observations containing 过去 do not trigger English tense instructions', () => {
  for (const subject of ['语文', '初中语文', '历史', 'chinese']) {
    let db = base(), id = db.students[0].id;
    db = core.saveTag(db, tag(id, subject, { label: '表达过去的经历' }));
    const idea = ideaFor(db, id)[0];
    assert.match(idea.title, new RegExp(subject));
    assert.doesNotMatch(idea.body, /时间或主语|选择形式|动词|时态/);
    assert.match(idea.evidence[0], new RegExp(subject));
  }
});

test('explicit English tags retain the earlier useful tense action', () => {
  for (const subject of ['英语', '初中英语', 'English', 'ＥＮＧＬＩＳＨ']) {
    let db = base(), id = db.students[0].id;
    db = core.saveTag(db, tag(id, subject));
    const idea = ideaFor(db, id)[0];
    assert.match(idea.body, /圈时间或主语提示/);
    assert.match(idea.title, new RegExp(subject || '通用'));
  }
});

test('empty-subject tags, including migrated v1 records, never assume English from a label', () => {
  for (const label of ['一般过去时', '过去与现在的叙事', '词汇', '阅读理解', '听力', '写作']) {
    let db = base(), id = db.students[0].id;
    db = core.saveTag(db, tag(id, '', { label }));
    const idea = ideaFor(db, id)[0];
    assert.match(idea.title, /通用/);
    assert.match(idea.body, /与该标签相关的短题/);
    assert.doesNotMatch(idea.body, /圈时间|主语|选择形式|拼写|音频|3–5 句/);
  }
  const migrated = core.validateDatabase(legacy());
  const idea = ideaFor(migrated, migrated.students[0].id).find(item => item.key.startsWith('tag-'));
  assert.match(idea.title, /通用/);
  assert.doesNotMatch(idea.body, /主语|选择形式/);
});

test('math actions cover practical common topics with subject gating instead of language exercises', () => {
  for (const [label, action] of [
    ['分数运算', /数表示的份量/], ['小数计算', /图示或估算/],
    ['解一元方程', /代回原题检查/], ['不等式', /大小关系/],
    ['三角形几何', /画图并标出/], ['函数图像', /3 组对应数值/],
    ['应用题阅读理解', /数量关系再列式/], ['四则计算', /估算或逆运算/],
    ['本单元综合', /相关数学短题/]
  ]) {
    let db = base(), id = db.students[0].id;
    db = core.saveTag(db, tag(id, '数学', { label }));
    const idea = ideaFor(db, id)[0];
    assert.match(idea.body, action);
    assert.match(idea.title, /数学/);
    assert.doesNotMatch(idea.body, /主语|拼写|一段已经学过的短文/);
  }
});

test('subject-marked suggestions save independent plan evidence without adding a plan subject field', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveTag(db, tag(id, '数学', { label: '分数运算' }));
  const idea = ideaFor(db, id)[0];
  const next = core.savePlan(db, { studentId: id, title: idea.title, body: idea.body, sourceEvidence: idea.evidence });
  assert.equal(Object.hasOwn(next.plans[0], 'subject'), false);
  assert.match(next.plans[0].sourceEvidence[0], /数学/);
  const changed = core.saveTag(next, { ...next.tags[0], subject: '通识' });
  assert.match(changed.plans[0].sourceEvidence[0], /数学/);
  idea.evidence[0] = '调用方修改';
  assert.match(changed.plans[0].sourceEvidence[0], /数学/);
  assert.deepEqual(core.importDatabase(core.exportDatabase(changed)).plans, changed.plans);
});

test('maximum-length subject/tag/evidence still generate saveable suggestions', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveTag(db, tag(id, '科'.repeat(50), { label: '标'.repeat(80), note: '注'.repeat(2000) }));
  db = core.saveScore(db, score(id, '科'.repeat(50), { title: '测'.repeat(200) }));
  for (const idea of ideaFor(db, id)) {
    assert.ok(idea.title.length <= 200);
    assert.ok(idea.evidence.every(item => item.length <= 500));
    assert.doesNotThrow(() => core.savePlan(db, { studentId: id, title: idea.title, body: idea.body, sourceEvidence: idea.evidence }));
  }
});

test('fresh demo exposes English teaching archives without changing the empty database fallback', () => {
  const demo = core.createDatabase(true);
  assert.equal(demo.schemaVersion, 4);
  assert.ok(demo.students.every(row => row.subject === '英语'));
  for (const student of demo.students) assert.ok(demo.scores.filter(row => row.studentId === student.id).every(row => row.subject === student.subject));
  assert.ok(demo.students.every(row => row.name.includes('虚构')));
  assert.ok(demo.tags.every(row => row.subject === '英语'));
  assert.ok(demo.tags.some(row => row.type === 'weak' && /词汇/.test(row.label)));
  assert.ok(demo.tags.some(row => row.type === 'weak' && /一般现在时/.test(row.label)));
  assert.ok(demo.tags.some(row => row.type === 'weak' && /阅读/.test(row.label)));
  assert.ok(demo.tags.some(row => row.type === 'strong'));
  assert.ok(demo.tags.some(row => row.type === 'habit'));
  assert.match(demo.plans[0].title, /英语.*词汇/);
  assert.match(demo.plans[0].sourceEvidence[0], /英语.*词汇/);
  assert.equal(core.createDatabase(false).students.length, 0);
});
