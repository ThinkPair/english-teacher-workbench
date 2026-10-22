'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const corePath = path.join(__dirname, '../miniprogram/lib/core.js');
const core = require(corePath);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function base() { return core.saveStudent(core.createDatabase(), { name: '虚构学员 A', grade: '七年级' }); }
function score(studentId, extra = {}) { return { studentId, title: '虚构小测', date: '2026-10-06', score: 40, total: 50, ...extra }; }
function tag(studentId, extra = {}) { return { studentId, type: 'weak', label: '一般过去时', observedOn: '2026-10-06', ...extra }; }
function plan(studentId, extra = {}) { return { studentId, title: '虚构跟进', body: '核对 3 道已学短题，下次换 1 道复看。', ...extra }; }
function populated() {
  let db = base();
  const id = db.students[0].id;
  db = core.saveScore(db, score(id));
  db = core.saveTag(db, tag(id));
  return core.savePlan(db, plan(id, { sourceEvidence: ['虚构观察：过去时需要一次提示。'] }));
}

test('CommonJS and globalThis expose the same API; fresh empty databases are isolated', () => {
  assert.equal(globalThis.StudentCore, core);
  const a = core.createDatabase();
  const b = core.createDatabase(false);
  assert.deepEqual(a, { schemaVersion: 4, revision: 0, categories: [], students: [], scores: [], tags: [], plans: [] });
  a.students.push({ id: 'external' });
  assert.equal(b.students.length, 0);
  assert.throws(() => core.createDatabase('personal'), /示例模式/);
});

test('browser script works without require/module and demo dates follow the local clock', () => {
  const clock = new Date(2032, 0, 3, 12).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const sandbox = { Date: FixedDate };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(corePath, 'utf8'), sandbox);
  const api = sandbox.StudentCore;
  assert.equal(api.today(), '2032-01-03');
  const demo = JSON.parse(api.exportDatabase(api.createDatabase(true)));
  assert.equal(demo.revision, 0);
  assert.equal(demo.scores[0].date, '2031-12-13');
  assert.equal(demo.scores[1].date, '2031-12-20');
  assert.equal(demo.scores[3].date, '2032-01-01');
  assert.equal(demo.plans[0].dueDate, '2032-01-06');
  assert.ok(demo.students.every(row => row.name.includes('虚构')));
});

test('saving normalizes fields, strips extras, and never mutates frozen input or shares arrays', () => {
  const db = freeze(core.createDatabase());
  const input = freeze({ name: '  虚构学员 A  ', grade: '  七年级 ', ignored: { unsafe: true } });
  const saved = core.saveStudent(db, input);
  assert.equal(db.students.length, 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual(Object.keys(saved.students[0]), ['id', 'name', 'grade', 'className', 'note', 'subject', 'isExample', 'categoryId']);
  assert.equal(saved.students[0].name, '虚构学员 A');
  const next = core.savePlan(freeze(saved), freeze(plan(saved.students[0].id, { sourceEvidence: ['  虚构证据  '] })));
  next.plans[0].sourceEvidence.push('新快照');
  assert.equal(saved.plans.length, 0);
});

test('editing unknown ids is never silently treated as creation for any collection', () => {
  const db = populated(), id = db.students[0].id, original = core.exportDatabase(db);
  for (const [save, input] of [
    [core.saveStudent, { id: 'missing', name: '虚构学员' }],
    [core.saveScore, score(id, { id: 'missing' })],
    [core.saveTag, tag(id, { id: 'missing' })],
    [core.savePlan, plan(id, { id: 'missing' })]
  ]) assert.throws(() => save(db, input), /不存在/);
  assert.equal(core.exportDatabase(db), original);
});

test('explicit empty/null/nonstring ids are rejected instead of generating a new record', () => {
  for (const id of ['', ' ', null, 0, {}, []]) assert.throws(() => core.saveStudent(core.createDatabase(), { id, name: '虚构学员' }), /编号/);
});

test('valid edits preserve ids, increment revision exactly once, and replace the intended row', () => {
  let db = populated();
  const savedId = db.scores[0].id;
  const revision = db.revision;
  const next = core.saveScore(freeze(db), { ...db.scores[0], score: '41.5', total: '50' });
  assert.equal(next.scores.length, 1);
  assert.equal(next.scores[0].id, savedId);
  assert.equal(next.scores[0].score, 41.5);
  assert.equal(db.scores[0].score, 40);
  assert.equal(next.revision, revision + 1);
});

test('numeric form inputs accept decimals and zero, but reject coercion tricks, blanks, nonfinite and bounds', () => {
  const db = base(), id = db.students[0].id;
  for (const value of [0, '0', ' 0.5 ', '.5', '4e1']) {
    assert.equal(typeof core.saveScore(db, score(id, { score: value })).scores[0].score, 'number');
  }
  for (const value of ['', ' ', '\t', null, undefined, false, [], ['2'], {}, NaN, Infinity, -Infinity, 'Infinity', '0x10', '0b10', '1,000', '12分', '1e999']) {
    assert.throws(() => core.saveScore(db, score(id, { score: value })), /数字/);
  }
  for (const pair of [{ score: -1 }, { score: 51 }, { total: 0 }, { total: -2 }, { total: '' }]) assert.throws(() => core.saveScore(db, score(id, pair)), /数字|满分/);
});

test('all date fields validate actual Gregorian dates and do not invent missing dates', () => {
  const db = base(), id = db.students[0].id;
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.doesNotThrow(() => core.saveScore(db, score(id, { date })));
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '2026-01-00', '2026-1-01', ' 2026-01-01 ', '', undefined, 20261006]) {
    assert.throws(() => core.saveScore(db, score(id, { date })), /日期|格式/);
    assert.throws(() => core.saveTag(db, tag(id, { observedOn: date })), /日期|格式/);
  }
  assert.equal(core.savePlan(db, plan(id)).plans[0].dueDate, '');
  assert.throws(() => core.savePlan(db, plan(id, { dueDate: '2026-02-30' })), /日期/);
  assert.throws(() => core.suggestions(db, id, '2026-02-30'), /日期/);
});

test('orphan records and cross-student reassignment fail atomically for scores, tags and plans', () => {
  let db = populated();
  db = core.saveStudent(db, { name: '虚构学员 B' });
  const second = db.students[1].id, before = core.exportDatabase(db);
  for (const [save, row] of [[core.saveScore, db.scores[0]], [core.saveTag, db.tags[0]], [core.savePlan, db.plans[0]]]) {
    assert.throws(() => save(db, { ...row, studentId: second }), /改挂/);
    const { id, ...create } = row;
    assert.throws(() => save(db, { ...create, studentId: 'missing' }), /所属学员|孤立/);
  }
  assert.equal(core.exportDatabase(db), before);
});

test('active tags reject duplicate labels and weak/strong conflicts after case/width/space normalization', () => {
  const db = base(), id = db.students[0].id;
  const a = core.saveTag(db, tag(id, { label: 'Word Form' }));
  assert.throws(() => core.saveTag(a, tag(id, { label: 'ｗｏｒｄ　ｆｏｒｍ' })), /已有/);
  assert.throws(() => core.saveTag(a, tag(id, { label: 'WORDFORM', type: 'strong' })), /薄弱和强项/);
  const resolved = core.saveTag(a, { ...a.tags[0], status: 'resolved' });
  assert.doesNotThrow(() => core.saveTag(resolved, tag(id, { label: 'Word Form', type: 'strong' })));
  assert.doesNotThrow(() => core.saveTag(a, tag(id, { label: 'Word Form', type: 'habit' })));
});

test('same labels are independent across students and editing a tag excludes its own old version', () => {
  let db = base();
  db = core.saveStudent(db, { name: '虚构学员 B' });
  db = core.saveTag(db, tag(db.students[0].id));
  db = core.saveTag(db, tag(db.students[1].id, { type: 'strong' }));
  const next = core.saveTag(db, { ...db.tags[0], note: '虚构新观察' });
  assert.equal(next.tags.length, 2);
  assert.equal(next.tags[0].note, '虚构新观察');
});

test('student deletion cascades only that student; independent deletion leaves other evidence snapshots intact', () => {
  let db = populated();
  db = core.saveStudent(db, { name: '虚构学员 B' });
  const a = db.students[0].id, b = db.students[1].id;
  db = core.saveScore(db, score(b));
  db = core.saveTag(db, tag(b));
  db = core.savePlan(db, plan(b));
  const before = core.exportDatabase(db), revision = db.revision;
  const result = core.deleteStudent(freeze(db), a);
  assert.equal(result.revision, revision + 1);
  assert.equal(result.students.length, 1);
  for (const table of ['scores', 'tags', 'plans']) assert.ok(result[table].every(row => row.studentId === b));
  assert.equal(core.exportDatabase(db), before);
  const removedTag = core.deleteTag(db, db.tags[0].id);
  assert.deepEqual(removedTag.plans[0].sourceEvidence, db.plans[0].sourceEvidence);
  assert.equal(core.deleteScore(db, db.scores[0].id).scores.length, 1);
  assert.equal(core.deletePlan(db, db.plans[0].id).plans.length, 1);
  for (const remove of [core.deleteStudent, core.deleteScore, core.deleteTag, core.deletePlan]) assert.throws(() => remove(db, 'missing'), /不存在/);
});

test('export/import is a lossless independent canonical clone and full replacement does not merge records', () => {
  const db = populated(), saved = core.exportDatabase(db);
  const restored = core.importDatabase(saved);
  assert.deepEqual(restored, db);
  assert.notEqual(restored, db);
  restored.plans[0].sourceEvidence[0] = '外部改动';
  assert.notEqual(restored.plans[0].sourceEvidence[0], db.plans[0].sourceEvidence[0]);
  assert.equal(core.importDatabase(core.exportDatabase(core.createDatabase())).students.length, 0);
});

test('full validation rejects malformed shape, schema and revision instead of resetting data', () => {
  for (const value of [null, [], 'text', 1, new Date(), {}]) assert.throws(() => core.validateDatabase(value));
  for (const patch of [{ schemaVersion: 5 }, { schemaVersion: '1' }, { revision: -1 }, { revision: 0.5 }, { revision: '1' }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { students: null }, { tags: {} }]) {
    assert.throws(() => core.validateDatabase({ ...core.createDatabase(), ...patch }));
  }
  const missing = populated();
  delete missing.students[0].className;
  assert.throws(() => core.validateDatabase(missing), /班级/);
  const stringScore = populated();
  stringScore.scores[0].score = '40';
  assert.throws(() => core.validateDatabase(stringScore), /数字/);
});

test('imports validate every record, reject duplicates across tables, orphans, conflicting tags and bad dates', () => {
  const invalid = [];
  let db = populated(); db.students.push({ ...db.students[0] }); invalid.push(db);
  db = populated(); db.scores[0].id = db.students[0].id; invalid.push(db);
  db = populated(); db.plans[0].studentId = 'missing'; invalid.push(db);
  db = populated(); db.tags.push({ ...db.tags[0], id: 'different', type: 'strong' }); invalid.push(db);
  db = populated(); db.scores[0].date = '2026-02-30'; invalid.push(db);
  db = populated(); db.scores[0].score = 500; invalid.push(db);
  db = populated(); db.plans[0].status = 'unknown'; invalid.push(db);
  db = populated(); db.tags[0].status = 'unknown'; invalid.push(db);
  db = populated(); db.tags[0].type = 'unknown'; invalid.push(db);
  db = populated(); db.plans[0].sourceEvidence = [null]; invalid.push(db);
  for (const value of invalid) assert.throws(() => core.importDatabase(JSON.stringify(value)));
  for (const text of ['', ' ', '{', 'null', '[]', '{"schemaVersion":2}']) assert.throws(() => core.importDatabase(text));
});

test('extra fields and prototype-pollution keys are removed recursively without touching prototypes', () => {
  const db = populated();
  const raw = JSON.stringify(db).replace('"schemaVersion":4', '"schemaVersion":4,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"secret":"discard"');
  const parsed = JSON.parse(raw);
  parsed.students[0].extra = { nested: 'discard' };
  parsed.scores[0].extra = 'discard';
  parsed.tags[0].extra = 'discard';
  parsed.plans[0].extra = 'discard';
  const clean = core.validateDatabase(parsed);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(clean, '__proto__'), false);
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
  assert.equal(Object.hasOwn(clean, 'secret'), false);
  for (const table of ['students', 'scores', 'tags', 'plans']) assert.equal(Object.hasOwn(clean[table][0], 'extra'), false);
  const nullPrototype = Object.assign(Object.create(null), db);
  assert.deepEqual(core.validateDatabase(nullPrototype), db);
  assert.throws(() => core.validateDatabase(Object.assign(Object.create({ polluted: true }), db)), /格式/);
});

test('known accessor fields and sparse arrays fail rather than execute or become null records', () => {
  let called = false;
  const input = { get name() { called = true; return '虚构学员'; } };
  assert.throws(() => core.saveStudent(core.createDatabase(), input), /动态读取/);
  assert.equal(called, false);
  const sparse = core.createDatabase(); sparse.students = new Array(1);
  assert.throws(() => core.validateDatabase(sparse), /对象/);
  const db = base();
  assert.throws(() => core.savePlan(db, plan(db.students[0].id, { sourceEvidence: new Array(1) })), /文字/);
});

test('all important field length limits and nonstring/control inputs are enforced', () => {
  const db = base(), id = db.students[0].id;
  for (const input of [{ name: '' }, { name: ' ' }, { name: 1 }, { name: 'A'.repeat(101) }, { name: '虚构', grade: 'A'.repeat(101) }, { name: '虚构', className: 'A'.repeat(101) }, { name: '虚构', note: 'A'.repeat(2001) }, { name: '虚构\0学员' }]) assert.throws(() => core.saveStudent(db, input));
  for (const [save, input] of [
    [core.saveScore, score(id, { title: 'A'.repeat(201) })],
    [core.saveScore, score(id, { note: 'A'.repeat(2001) })],
    [core.saveTag, tag(id, { label: 'A'.repeat(81) })],
    [core.saveTag, tag(id, { note: 'A'.repeat(2001) })],
    [core.savePlan, plan(id, { title: 'A'.repeat(201) })],
    [core.savePlan, plan(id, { body: 'A'.repeat(8001) })],
    [core.savePlan, plan(id, { result: 'A'.repeat(4001) })],
    [core.savePlan, plan(id, { sourceEvidence: Array(31).fill('证据') })],
    [core.savePlan, plan(id, { sourceEvidence: ['A'.repeat(501)] })],
    [core.savePlan, plan(id, { sourceEvidence: [''] })]
  ]) assert.throws(() => save(db, input), /最多|证据|填写/);
});

test('collection and total content capacity limits apply to imports and mutations atomically', () => {
  for (const [table, limit] of Object.entries({ students: 500, scores: 10000, tags: 10000, plans: 5000 })) {
    const db = core.createDatabase(); db[table] = Array(limit + 1).fill(null);
    assert.throws(() => core.validateDatabase(db), /记录最多/);
  }
  const full = core.createDatabase();
  full.students = Array.from({ length: 500 }, (_, i) => ({ id: 'fiction-' + i, name: '虚构学员 ' + i, grade: '', className: '', note: '', subject: '', isExample: false, categoryId: '' }));
  freeze(full);
  assert.throws(() => core.saveStudent(full, { name: '超额虚构学员' }), /记录最多/);
  assert.equal(full.students.length, 500);
  const oversized = base(), studentId = oversized.students[0].id;
  oversized.plans = Array.from({ length: 300 }, (_, i) => ({ id: 'fiction-plan-' + i, studentId, title: '虚构计划', body: '字'.repeat(8000), dueDate: '', status: 'todo', result: '', sourceEvidence: [] }));
  assert.throws(() => core.validateDatabase(oversized), /容量/);
  assert.throws(() => core.importDatabase(' '.repeat(4 * 1024 * 1024) + '{}'), /过大/);
});

test('revision overflow fails without mutating the original database', () => {
  const db = base(); db.revision = Number.MAX_SAFE_INTEGER; freeze(db);
  assert.throws(() => core.saveStudent(db, { name: '虚构学员 B' }), /修订号/);
  assert.throws(() => core.deleteStudent(db, db.students[0].id), /修订号/);
  assert.equal(db.revision, Number.MAX_SAFE_INTEGER);
});

test('empty and resolved-only histories ask for concrete observation rather than invent diagnoses', () => {
  let db = base(), id = db.students[0].id;
  assert.match(core.suggestions(db, id, '2026-10-06')[0].body, /暂不推断能力/);
  db = core.saveTag(db, tag(id, { status: 'resolved' }));
  const suggestions = core.suggestions(freeze(db), id, '2026-10-06');
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].key, /^observe-/);
  assert.throws(() => core.suggestions(db, 'missing'), /找不到/);
});

test('weak/strong/habit suggestions are specific, evidence-linked, gentle and save as editable plan snapshots', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveTag(db, tag(id, { subject: '英语' }));
  db = core.saveTag(db, tag(id, { type: 'strong', label: '词汇拼写' }));
  db = core.saveTag(db, tag(id, { type: 'habit', label: '完成后检查' }));
  const before = core.exportDatabase(db);
  const suggestions = core.suggestions(freeze(db), id, '2026-10-06');
  assert.equal(suggestions.length, 3);
  assert.match(suggestions[0].body, /3 个相关短句/);
  assert.match(suggestions[1].body, /换 1 个相近情境/);
  assert.match(suggestions[2].body, /1 分钟/);
  assert.ok(suggestions.every(item => item.evidence.length && item.evidence[0].includes('2026-10-06')));
  assert.equal(core.exportDatabase(db), before);
  const suggestion = suggestions[0];
  const next = core.savePlan(db, { studentId: id, title: suggestion.title, body: suggestion.body, sourceEvidence: suggestion.evidence });
  suggestion.evidence[0] = '调用方后来改动';
  assert.notEqual(next.plans[0].sourceEvidence[0], suggestion.evidence[0]);
  assert.equal(db.plans.length, 0);
});

test('suggestions use each exam denominator and avoid causal/trend claims or cross-student evidence', () => {
  let db = base(), a = db.students[0].id;
  db = core.saveStudent(db, { name: '虚构学员 B' });
  const b = db.students[1].id;
  db = core.saveScore(db, score(a, { subject: '英语', title: '虚构旧卷', date: '2026-10-01', score: 72, total: 100 }));
  db = core.saveScore(db, score(a, { subject: '英语', title: '虚构新卷', score: 42, total: 50 }));
  db = core.saveScore(db, score(b, { title: '不应混入的虚构卷', score: 100, total: 100 }));
  db = core.saveTag(db, tag(b, { label: '不应混入的虚构标签' }));
  const suggestions = core.suggestions(db, a, '2026-10-06');
  const text = JSON.stringify(suggestions);
  assert.match(text, /84%/);
  assert.match(text, /72%/);
  assert.match(text, /不据此判断能力变化或教学效果/);
  assert.doesNotMatch(text, /不应混入|提高了|退步了|导致|诊断/);
});

test('future observations are not used early; due followups exclude completed, future and other students', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, { title: '未来虚构卷', date: '2026-10-07' }));
  db = core.saveTag(db, tag(id, { label: '未来观察', observedOn: '2026-10-07' }));
  db = core.savePlan(db, plan(id, { title: '待回看的虚构计划', dueDate: '2026-10-06' }));
  db = core.savePlan(db, plan(id, { title: '已完成虚构计划', dueDate: '2026-10-01', status: 'done' }));
  db = core.savePlan(db, plan(id, { title: '将来虚构计划', dueDate: '2026-10-07' }));
  const suggestions = core.suggestions(db, id, '2026-10-06');
  assert.equal(suggestions.length, 2);
  const text = JSON.stringify(suggestions);
  assert.match(text, /待回看的虚构计划/);
  assert.doesNotMatch(text, /未来虚构卷|未来观察|已完成虚构计划|将来虚构计划/);
  assert.match(text, /不把逾期等同于学习态度/);
});

test('suggestions limit each tag type to recent observations and output remains saveable', () => {
  let db = base(), id = db.students[0].id;
  for (let i = 1; i <= 6; i++) db = core.saveTag(db, tag(id, { label: '虚构知识点 ' + i, observedOn: '2026-10-0' + i, note: '虚构观察。'.repeat(200) }));
  const suggestions = core.suggestions(db, id, '2026-10-06');
  assert.equal(suggestions.length, 3);
  assert.match(suggestions[0].title, /虚构知识点 6/);
  for (const suggestion of suggestions) {
    assert.doesNotThrow(() => core.savePlan(db, { studentId: id, title: suggestion.title, body: suggestion.body, sourceEvidence: suggestion.evidence }));
  }
});
