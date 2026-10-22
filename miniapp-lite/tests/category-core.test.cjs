'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/core.js');
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function categorized(total = 120) {
  let db = core.saveCategory(core.createDatabase(), { name: '虚构初中英语', total });
  return core.saveStudent(db, { name: '虚构学员', grade: '七年级', subject: '英语', categoryId: db.categories[0].id });
}
function score(studentId, extra = {}) { return { studentId, title: '虚构测评', date: '2026-10-06', score: 80, ...extra }; }
function legacy(version) {
  const db = {
    schemaVersion: version, revision: 23,
    students: [
      { id: 'old-a', name: '虚构学员 A', grade: '七年级', className: '旧班级', note: '保留备注' },
      { id: 'old-b', name: '虚构学员 B', grade: '八年级', className: '', note: '' }
    ],
    scores: [{ id: 'old-score', studentId: 'old-a', subject: '数学', title: '原测评', date: '2026-10-01', score: 70, total: 120, note: '原满分120' }],
    tags: [{ id: 'old-tag', studentId: 'old-a', subject: '数学', type: 'weak', label: '分数', note: '原依据', observedOn: '2026-10-01', status: 'active' }],
    plans: [{ id: 'old-plan', studentId: 'old-a', title: '原计划', body: '原正文', dueDate: '', status: 'done', result: '原结果', sourceEvidence: ['原数学证据'] }]
  };
  if (version === 3) {
    db.students[0].subject = ''; db.students[0].isExample = true;
    db.students[1].subject = '语文'; db.students[1].isExample = false;
  }
  return db;
}

test('fresh empty database includes categories and exposes only the intended category mutations', () => {
  assert.deepEqual(core.createDatabase().categories, []);
  assert.equal(typeof core.saveCategory, 'function');
  assert.equal(typeof core.removeCategory, 'function');
  assert.equal(globalThis.StudentCore, core);
  const db = core.saveStudent(core.createDatabase(), { name: '虚构未分类学员' });
  assert.equal(db.students[0].categoryId, '');
});

test('category creation and editing are immutable, canonical and increment revision once', () => {
  const original = freeze(core.createDatabase());
  const db = core.saveCategory(original, freeze({ name: '  虚构  英语  ', total: '120.5', extra: '剥离' }));
  assert.deepEqual(original.categories, []);
  assert.equal(db.revision, 1);
  assert.deepEqual(Object.keys(db.categories[0]), ['id', 'name', 'total']);
  assert.equal(db.categories[0].name, '虚构 英语');
  assert.equal(db.categories[0].total, 120.5);
  const edited = core.saveCategory(freeze(db), { ...db.categories[0], name: '改名', total: 150 });
  assert.equal(edited.categories.length, 1);
  assert.equal(edited.categories[0].id, db.categories[0].id);
  assert.equal(edited.revision, 2);
  assert.equal(db.categories[0].total, 120.5);
});

test('category names reject normalized duplicates in creation, editing and import', () => {
  let db = core.saveCategory(core.createDatabase(), { name: 'English A', total: 100 });
  for (const name of ['ｅｎｇｌｉｓｈ　ａ', ' englisha ', 'E n g l i s h A']) {
    assert.throws(() => core.saveCategory(db, { name, total: 150 }), /同名分类/);
  }
  db = core.saveCategory(db, { name: '另一分类', total: 120 });
  const before = core.exportDatabase(db);
  assert.throws(() => core.saveCategory(db, { ...db.categories[1], name: 'ENGLISHA' }), /同名分类/);
  assert.equal(core.exportDatabase(db), before);
  const raw = clone(db); raw.categories[1].name = 'ＥｎｇｌｉｓｈＡ';
  assert.throws(() => core.importDatabase(JSON.stringify(raw)), /同名分类/);
  assert.doesNotThrow(() => core.saveCategory(db, { ...db.categories[0], name: ' English A ', total: 101 }));
});

test('category names and totals enforce type, length, control and finite positive bounded values', () => {
  for (const name of ['', ' ', null, false, 12, [], {}, '类'.repeat(51), '坏\0名称']) {
    assert.throws(() => core.saveCategory(core.createDatabase(), { name, total: 100 }), /分类名称/);
  }
  assert.doesNotThrow(() => core.saveCategory(core.createDatabase(), { name: '类'.repeat(50), total: 1000000 }));
  assert.doesNotThrow(() => core.saveCategory(core.createDatabase(), { name: '小数满分', total: 0.5 }));
  for (const total of [0, -1, 1000000.1, NaN, Infinity, -Infinity, null, false, [], {}, '', ' ', 'abc', '0x10', '1e999']) {
    assert.throws(() => core.saveCategory(core.createDatabase(), { name: '虚构分类', total }), /满分|数字/);
  }
  const raw = categorized(); raw.categories[0].total = '120';
  assert.throws(() => core.validateDatabase(raw), /有限数字/);
});

test('unknown and malformed category ids never become new categories or successful deletions', () => {
  const db = categorized(), before = core.exportDatabase(db);
  assert.throws(() => core.saveCategory(db, { id: 'missing', name: '虚构', total: 100 }), /不存在/);
  assert.throws(() => core.removeCategory(db, 'missing'), /不存在/);
  for (const id of ['', null, false, [], {}]) {
    assert.throws(() => core.saveCategory(db, { id, name: '虚构', total: 100 }), /编号/);
    assert.throws(() => core.removeCategory(db, id), /编号/);
  }
  assert.equal(core.exportDatabase(db), before);
});

test('unassigned is reserved only for category ids and cannot collide with the dashboard fallback', () => {
  const db = categorized(), before = core.exportDatabase(db);
  for (const reservedId of ['unassigned', ' unassigned ']) {
    const raw = clone(db);
    raw.categories[0].id = reservedId;
    raw.students[0].categoryId = reservedId;
    assert.throws(() => core.validateDatabase(raw), /未分类保留/);
    assert.throws(() => core.importDatabase(JSON.stringify(raw)), /未分类保留/);
    assert.throws(() => core.saveCategory(raw, { id: reservedId, name: '修改', total: 100 }), /未分类保留/);
    assert.throws(() => core.saveCategory(db, { id: reservedId, name: '新增', total: 100 }), /不存在|未分类保留/);
  }
  assert.equal(core.exportDatabase(db), before);
  const otherRecord = clone(db);
  otherRecord.students[0].id = 'unassigned';
  assert.equal(core.validateDatabase(otherRecord).students[0].id, 'unassigned');
});

test('occupied category deletion requires moving students and never cascades records', () => {
  let db = categorized(), id = db.students[0].id, categoryId = db.categories[0].id;
  db = core.saveScore(db, score(id));
  const before = core.exportDatabase(db);
  assert.throws(() => core.removeCategory(freeze(db), categoryId), /先将学员移出/);
  assert.equal(core.exportDatabase(db), before);
  const moved = core.saveStudent(db, { ...db.students[0], categoryId: '' });
  const removed = core.removeCategory(moved, categoryId);
  assert.equal(removed.categories.length, 0);
  assert.deepEqual(removed.students, moved.students);
  assert.deepEqual(removed.scores, db.scores);
  assert.equal(removed.revision, moved.revision + 1);
});

test('deleting a student leaves its category intact and then permits empty-category deletion', () => {
  const db = categorized(), categoryId = db.categories[0].id;
  const removed = core.deleteStudent(db, db.students[0].id);
  assert.deepEqual(removed.categories, db.categories);
  assert.equal(core.removeCategory(removed, categoryId).categories.length, 0);
});

test('student category omission preserves an edit while explicit empty moves to unclassified', () => {
  const db = categorized(), input = { ...db.students[0], note: '只改备注' }; delete input.categoryId;
  const next = core.saveStudent(freeze(db), freeze(input));
  assert.equal(next.students[0].categoryId, db.categories[0].id);
  assert.equal(core.saveStudent(next, { ...next.students[0], categoryId: '' }).students[0].categoryId, '');
  assert.equal(db.students[0].note, '');
});

test('student categories require known references and strict strings on import', () => {
  const db = categorized(), before = core.exportDatabase(db);
  for (const categoryId of ['missing', null, false, 0, [], {}, 'c'.repeat(101)]) {
    assert.throws(() => core.saveStudent(db, { ...db.students[0], categoryId }), /分类/);
    const raw = clone(db); raw.students[0].categoryId = categoryId;
    assert.throws(() => core.validateDatabase(raw), /分类/);
  }
  const raw = clone(db); delete raw.students[0].categoryId;
  assert.throws(() => core.importDatabase(JSON.stringify(raw)), /分类/);
  assert.equal(core.exportDatabase(db), before);
});

test('only new scores with omitted total inherit a category default', () => {
  const db = categorized(120), id = db.students[0].id;
  assert.equal(core.saveScore(db, score(id)).scores[0].total, 120);
  assert.equal(core.saveScore(db, score(id, { total: 100 })).scores[0].total, 100);
  assert.equal(core.saveScore(db, score(id, { total: '150' })).scores[0].total, 150);
  for (const total of [null, '', false, 0, NaN, Infinity]) {
    assert.throws(() => core.saveScore(db, score(id, { total })), /数字|满分/);
  }
  assert.throws(() => core.saveScore(db, score(id, { score: 121 })), /满分/);
  const raw = core.saveScore(db, score(id)); delete raw.scores[0].total;
  assert.throws(() => core.validateDatabase(raw), /满分/);
});

test('uncategorized scores need an explicit total and never silently default to 100', () => {
  const db = core.saveStudent(core.createDatabase(), { name: '虚构未分类', subject: '英语' }), id = db.students[0].id;
  assert.throws(() => core.saveScore(db, score(id)), /满分/);
  assert.equal(core.saveScore(db, score(id, { total: 150 })).scores[0].total, 150);
});

test('changing a category default affects future defaults and leaves all stored scores untouched', () => {
  let db = categorized(120), id = db.students[0].id;
  db = core.saveScore(db, score(id));
  const changed = core.saveCategory(db, { ...db.categories[0], total: 150, name: '重命名分类' });
  assert.deepEqual(changed.scores, db.scores);
  assert.deepEqual(changed.students, db.students);
  const next = core.saveScore(changed, score(id));
  assert.deepEqual(next.scores.map(row => row.total), [120, 150]);
  const oldEdit = { ...next.scores[0], note: '遗漏满分' }; delete oldEdit.total;
  assert.throws(() => core.saveScore(next, oldEdit), /满分/);
  assert.equal(core.saveScore(next, { ...next.scores[0], note: '保留满分' }).scores[0].total, 120);
});

test('moving a student changes only future defaults, never historical denominators or ownership', () => {
  let db = categorized(120), id = db.students[0].id;
  db = core.saveScore(db, score(id));
  db = core.saveCategory(db, { name: '虚构高中英语', total: 150 });
  const moved = core.saveStudent(db, { ...db.students[0], categoryId: db.categories[1].id });
  assert.deepEqual(moved.scores, db.scores);
  const next = core.saveScore(moved, score(id));
  assert.deepEqual(next.scores.map(row => row.total), [120, 150]);
  assert.ok(next.scores.every(row => row.studentId === id));
});

test('v1/v2 migration adds no categories and preserves old totals while retaining earlier subject derivation', () => {
  for (const version of [1, 2]) {
    const old = freeze(legacy(version)), next = core.validateDatabase(old);
    assert.equal(next.schemaVersion, 4);
    assert.deepEqual(next.categories, []);
    assert.equal(next.revision, old.revision);
    assert.ok(next.students.every(row => row.categoryId === '' && row.isExample === false));
    assert.equal(next.students[0].subject, '数学');
    assert.equal(next.students[1].subject, '');
    for (const table of ['scores', 'tags', 'plans']) assert.deepEqual(next[table], old[table]);
    assert.equal(Object.hasOwn(old.students[0], 'categoryId'), false);
  }
});

test('v3 migration preserves explicit subject and isExample instead of deriving from scores or names', () => {
  const old = freeze(legacy(3)), next = core.importDatabase(JSON.stringify(old));
  assert.deepEqual(next.categories, []);
  assert.deepEqual(next.students, old.students.map(row => ({ ...row, categoryId: '' })));
  assert.equal(next.students[0].subject, '', 'do not derive Math from known historical score in v3');
  assert.equal(next.students[0].isExample, true);
  assert.equal(next.students[1].subject, '语文');
  assert.equal(next.revision, 23);
  for (const table of ['scores', 'tags', 'plans']) assert.deepEqual(next[table], old[table]);
  assert.deepEqual(core.validateDatabase(next), next);
});

test('all legacy versions retain previously valid very large score totals without coercion or new ceilings', () => {
  for (const version of [1, 2, 3]) {
    const old = legacy(version); old.scores[0].total = Number.MAX_VALUE;
    const migrated = core.validateDatabase(old);
    assert.equal(migrated.scores[0].total, Number.MAX_VALUE);
    assert.equal(core.importDatabase(core.exportDatabase(migrated)).scores[0].total, Number.MAX_VALUE);
  }
});

test('v3 damaged subject/example fields and all legacy data damage still reject on migration', () => {
  for (const damage of [
    db => { delete db.students[0].subject; }, db => { db.students[0].isExample = 'true'; },
    db => { db.scores[0].total = 0; }, db => { db.scores[0].studentId = 'missing'; },
    db => { db.scores[0].date = '2026-02-30'; }, db => { db.students[1].id = 'old-a'; }
  ]) {
    const old = legacy(3); damage(old); const before = JSON.stringify(old);
    assert.throws(() => core.importDatabase(before));
    assert.equal(JSON.stringify(old), before);
  }
});

test('v4 strictly validates complete categories and rejects ids duplicated across any table', () => {
  for (const categories of [undefined, null, {}, 'text', [null], new Array(1)]) {
    const db = categorized(); db.categories = categories;
    assert.throws(() => core.validateDatabase(db));
  }
  for (const damage of [
    db => { db.categories.push({ ...db.categories[0] }); },
    db => { db.categories[0].id = db.students[0].id; },
    db => { delete db.categories[0].name; }, db => { delete db.categories[0].total; }
  ]) { const db = categorized(); damage(db); assert.throws(() => core.validateDatabase(db)); }
});

test('category and membership accessors cannot execute, and extras/prototype keys are stripped', () => {
  for (const key of ['name', 'total']) {
    let called = false; const input = { name: '虚构分类', total: 100 };
    Object.defineProperty(input, key, { get() { called = true; return key === 'name' ? '坏' : 100; } });
    assert.throws(() => core.saveCategory(core.createDatabase(), input), /动态读取/);
    assert.equal(called, false);
  }
  const db = categorized(); let called = false;
  const input = { ...db.students[0] }; Object.defineProperty(input, 'categoryId', { get() { called = true; return ''; } });
  assert.throws(() => core.saveStudent(db, input), /动态读取/); assert.equal(called, false);
  const row = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"secret":"discard"}');
  Object.assign(row, db.categories[0]); db.categories[0] = row;
  const clean = core.validateDatabase(db);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(clean.categories[0]), ['id', 'name', 'total']);
});

test('category capacity and revision overflow reject atomically', () => {
  const db = core.createDatabase();
  db.categories = Array.from({ length: 100 }, (_, index) => ({ id: 'category-' + index, name: '分类' + index, total: 100 }));
  const frozen = freeze(db), before = core.exportDatabase(frozen);
  assert.throws(() => core.saveCategory(frozen, { name: '第101类', total: 120 }), /分类记录最多/);
  assert.equal(core.exportDatabase(frozen), before);
  const tooMany = clone(db); tooMany.categories.push({ id: 'extra', name: '额外', total: 100 });
  assert.throws(() => core.validateDatabase(tooMany), /分类记录最多/);
  const fullRevision = clone(db); fullRevision.revision = Number.MAX_SAFE_INTEGER;
  assert.throws(() => core.saveCategory(fullRevision, { ...fullRevision.categories[0], total: 120 }), /修订号/);
  assert.throws(() => core.removeCategory(fullRevision, fullRevision.categories[0].id), /修订号/);
  assert.equal(fullRevision.categories.length, 100);
});

test('v4 categories and membership roundtrip as independent canonical data', () => {
  const db = categorized(), output = core.exportDatabase(db), copy = core.importDatabase(output);
  assert.equal(JSON.parse(output).schemaVersion, 4);
  assert.deepEqual(copy, db);
  copy.categories[0].total = 150; copy.students[0].categoryId = '';
  assert.equal(db.categories[0].total, 120);
  assert.notEqual(db.students[0].categoryId, '');
});

test('ten fictional examples use normal CRUD with editable categories, forty scaled scores and removable students', () => {
  const demo = core.createDatabase(true);
  assert.equal(demo.students.length, 10);
  assert.equal(demo.scores.length, 40);
  assert.ok(demo.tags.length >= 6 && demo.tags.length <= 10);
  assert.deepEqual(demo.categories.map(row => [row.name, row.total]), [['小学英语', 100], ['初中英语', 120], ['高中英语', 150]]);
  assert.deepEqual(demo.categories.map(cat => demo.students.filter(row => row.categoryId === cat.id).length), [4, 3, 3]);
  for (const student of demo.students) {
    assert.equal(student.isExample, true); assert.equal(student.subject, '英语');
    const total = demo.categories.find(row => row.id === student.categoryId).total;
    const scores = demo.scores.filter(row => row.studentId === student.id);
    assert.equal(scores.length, 4);
    assert.ok(scores.every(row => row.total === total && row.score >= 0 && row.score <= total));
  }
  const editStudent = core.saveStudent(demo, { ...demo.students[0], name: '修改后的虚构示例', categoryId: demo.categories[1].id });
  assert.equal(editStudent.students[0].name, '修改后的虚构示例');
  assert.deepEqual(editStudent.scores, demo.scores);
  const editScore = core.saveScore(editStudent, { ...editStudent.scores[0], score: 50 });
  assert.equal(editScore.scores[0].score, 50);
  const editTag = core.saveTag(editScore, { ...editScore.tags[0], note: '更新虚构依据' });
  const editPlan = core.savePlan(editTag, { ...editTag.plans[0], result: '虚构完成', status: 'done' });
  assert.equal(editPlan.plans[0].status, 'done');
  let empty = editPlan;
  for (const student of demo.students) empty = core.deleteStudent(empty, student.id);
  for (const category of demo.categories) empty = core.removeCategory(empty, category.id);
  assert.deepEqual(core.validateDatabase(empty).students, []);
  assert.deepEqual(core.validateDatabase(empty).categories, []);
  assert.deepEqual(core.createDatabase(false).categories, []);
});
