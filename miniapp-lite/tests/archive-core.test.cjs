'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/core.js');
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function base(subject = '数学') { return core.saveStudent(core.createDatabase(), { name: '虚构单科学员', grade: '七年级', subject }); }
function score(studentId, extra = {}) { return { studentId, title: '虚构练习', date: '2026-10-06', score: 40, total: 50, ...extra }; }
function tag(studentId, extra = {}) { return { studentId, type: 'weak', label: '虚构观察', observedOn: '2026-10-06', ...extra }; }
function legacy(version = 2) {
  return {
    schemaVersion: version, revision: 17,
    students: [
      { id: 'old-a', name: '旧虚构学员 A', grade: '七年级', className: '应保留的旧班级', note: '原备注' },
      { id: 'old-b', name: '旧虚构学员 B', grade: '八年级', className: '', note: '' }
    ],
    scores: [{ id: 'old-score', studentId: 'old-a', title: '虚构英语标题不能猜科', date: '2026-10-01', score: 12.5, total: 20, note: '原分数备注', subject: '数学' }],
    tags: [{ id: 'old-tag', studentId: 'old-a', type: 'weak', label: '分数运算', note: '原标签依据', observedOn: '2026-10-02', status: 'active', subject: '数学' }],
    plans: [{ id: 'old-plan', studentId: 'old-a', title: '原跟进', body: '保留计划正文', dueDate: '', status: 'done', result: '原结果', sourceEvidence: ['原快照不推导科目'] }]
  };
}

test('new archives default safely for old callers and retain the existing public API', () => {
  const db = core.saveStudent(core.createDatabase(), { name: '虚构兼容学员' });
  assert.equal(db.schemaVersion, 4);
  assert.equal(db.students[0].subject, '');
  assert.equal(db.students[0].isExample, false);
  assert.equal(db.students[0].className, '');
  assert.equal(core.createDatabase(false).students.length, 0);
  assert.equal(Object.hasOwn(db.students[0], 'subjects'), false);
  assert.equal(globalThis.StudentCore, core);
});

test('v1 and v2 migrate one explicit subject without touching old records, ids or revisions', () => {
  for (const version of [1, 2]) {
    const original = freeze(legacy(version));
    const migrated = core.validateDatabase(original);
    assert.equal(migrated.schemaVersion, 4);
    assert.equal(migrated.revision, 17);
    assert.deepEqual(migrated.students, original.students.map((row, index) => ({ ...row, subject: index ? '' : '数学', isExample: false, categoryId: '' })));
    assert.deepEqual(migrated.categories, []);
    for (const table of ['scores', 'tags', 'plans']) assert.deepEqual(migrated[table], original[table]);
    assert.deepEqual(core.importDatabase(JSON.stringify(original)), migrated);
    assert.equal(original.schemaVersion, version);
    assert.equal(Object.hasOwn(original.students[0], 'subject'), false);
  }
});

test('legacy derivation uses normalized explicit subjects but never semantic aliases or display names', () => {
  const one = legacy(); one.scores[0].subject = '  Math  '; one.tags[0].subject = 'ＭＡＴＨ';
  assert.equal(core.validateDatabase(one).students[0].subject, 'Math');
  const mixed = legacy(); mixed.scores[0].subject = 'Math'; mixed.tags[0].subject = '数学';
  const result = core.validateDatabase(mixed);
  assert.equal(result.students[0].subject, '');
  assert.deepEqual(result.scores, mixed.scores);
  assert.deepEqual(result.tags, mixed.tags);
  const unknown = legacy(1);
  delete unknown.scores[0].subject; delete unknown.tags[0].subject;
  unknown.students[0].name = '示例数学学员';
  assert.equal(core.validateDatabase(unknown).students[0].subject, '');
  assert.equal(core.validateDatabase(unknown).students[0].isExample, false);
});

test('legacy tag-only subjects include resolved observations and never cross student ownership', () => {
  const db = legacy();
  db.scores[0].subject = '';
  db.tags[0].status = 'resolved';
  db.tags.push({ ...db.tags[0], id: 'old-tag-b', studentId: 'old-b', subject: '英语' });
  const result = core.validateDatabase(db);
  assert.equal(result.students[0].subject, '数学');
  assert.equal(result.students[1].subject, '英语');
  db.tags.push({ ...db.tags[0], id: 'old-tag-mixed', subject: '语文' });
  assert.equal(core.validateDatabase(db).students[0].subject, '');
});

test('schema3 does not re-derive explicitly unclassified archives on read, export or save', () => {
  let db = base(''), id = db.students[0].id;
  db = core.saveScore(db, score(id, { subject: '数学' }));
  db = core.saveTag(db, tag(id, { subject: '数学' }));
  assert.equal(core.validateDatabase(db).students[0].subject, '');
  assert.equal(core.importDatabase(core.exportDatabase(db)).students[0].subject, '');
  const saved = core.saveStudent(db, { ...db.students[0], note: '仅改备注' });
  assert.equal(saved.students[0].subject, '');
});

test('schema3 imports require the archive subject and a real boolean example flag', () => {
  for (const key of ['subject', 'isExample']) {
    const db = base(); delete db.students[0][key];
    assert.throws(() => core.validateDatabase(db), /学科|示例/);
    assert.throws(() => core.importDatabase(JSON.stringify(db)), /学科|示例/);
  }
  for (const value of [null, 0, 1, '', 'false', [], {}]) {
    const db = base(); db.students[0].isExample = value;
    assert.throws(() => core.validateDatabase(db), /示例/);
    assert.throws(() => core.saveStudent(base(), { name: '虚构学员', isExample: value }), /示例/);
  }
});

test('archive subject has strict type, length and control validation and strips unrelated fields', () => {
  assert.equal(base('科'.repeat(50)).students[0].subject.length, 50);
  assert.equal(base('  Math   Studies  ').students[0].subject, 'Math Studies');
  for (const value of [null, false, 0, [], {}, '科'.repeat(51), '数\0学']) {
    assert.throws(() => base(value), /学科/);
    const db = base(); db.students[0].subject = value;
    assert.throws(() => core.validateDatabase(db), /学科/);
  }
  const db = base(); db.students[0].subjects = ['不采用的数组']; db.students[0].secret = '剥离';
  const result = core.validateDatabase(db);
  assert.equal(Object.hasOwn(result.students[0], 'subjects'), false);
  assert.equal(Object.hasOwn(result.students[0], 'secret'), false);
});

test('old UI edits preserve subject, example flag and hidden className without mutating input', () => {
  let db = base();
  db = core.saveStudent(db, { ...db.students[0], className: '旧班级保留', isExample: true });
  const input = { id: db.students[0].id, name: '虚构修改称呼', grade: '八年级', note: '新备注' };
  const before = core.exportDatabase(db), saved = core.saveStudent(freeze(db), freeze(input));
  assert.equal(saved.students[0].subject, '数学');
  assert.equal(saved.students[0].isExample, true);
  assert.equal(saved.students[0].className, '旧班级保留');
  assert.equal(saved.revision, db.revision + 1);
  assert.equal(core.exportDatabase(db), before);
  const cleared = core.saveStudent(saved, { ...saved.students[0], subject: '', isExample: false, className: '' });
  assert.equal(cleared.students[0].subject, '');
  assert.equal(cleared.students[0].isExample, false);
  assert.equal(cleared.students[0].className, '');
});

test('new scores inherit only an omitted subject; explicit empty remains unclassified', () => {
  const db = base(), id = db.students[0].id;
  assert.equal(core.saveScore(db, score(id)).scores[0].subject, '数学');
  assert.equal(core.saveScore(db, score(id, { subject: '' })).scores[0].subject, '');
  assert.equal(core.saveTag(db, tag(id)).tags[0].subject, '', 'unspecified tag remains general');
  assert.throws(() => core.saveScore(db, score(id, { subject: null })), /科目/);
  assert.throws(() => core.saveScore(db, score('missing')), /所属学员|孤立/);
});

test('old score edits retain even an empty subject while the archive has a known subject', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id, { subject: '' }));
  const input = { ...db.scores[0], score: 41 }; delete input.subject;
  const saved = core.saveScore(db, input);
  assert.equal(saved.scores[0].subject, '');
  assert.equal(saved.scores[0].score, 41);
  const classified = core.saveScore(saved, { ...saved.scores[0], subject: '数学' });
  assert.equal(classified.scores[0].subject, '数学');
});

test('a selected archive subject rejects different nonempty score and tag subjects atomically', () => {
  const db = freeze(base()), id = db.students[0].id, before = core.exportDatabase(db);
  assert.throws(() => core.saveScore(db, score(id, { subject: '英语' })), /学科.*不一致/);
  assert.throws(() => core.saveTag(db, tag(id, { subject: '英语' })), /学科.*不一致/);
  assert.equal(core.exportDatabase(db), before);
  const withScore = core.saveScore(db, score(id));
  assert.throws(() => core.saveScore(withScore, { ...withScore.scores[0], subject: '英语' }), /不一致/);
  const withTag = core.saveTag(db, tag(id, { subject: '数学' }));
  assert.throws(() => core.saveTag(withTag, { ...withTag.tags[0], subject: '英语' }), /不一致/);
  const badImport = clone(withScore); badImport.scores[0].subject = '英语';
  assert.throws(() => core.importDatabase(JSON.stringify(badImport)), /不一致/);
});

test('archive subject matching uses the existing normalization without guessing aliases', () => {
  const db = base('Math'), id = db.students[0].id;
  assert.doesNotThrow(() => core.saveScore(db, score(id, { subject: 'ＭＡＴＨ' })));
  assert.doesNotThrow(() => core.saveTag(db, tag(id, { subject: 'm a t h' })));
  assert.throws(() => core.saveScore(db, score(id, { subject: '数学' })), /不一致/);
});

test('changing the archive subject never rewrites known historical records or evidence', () => {
  let db = base(), id = db.students[0].id;
  db = core.saveScore(db, score(id));
  db = core.saveTag(db, tag(id, { subject: '数学', status: 'resolved' }));
  db = core.savePlan(db, { studentId: id, title: '虚构跟进', body: '保留观察', sourceEvidence: ['数学原快照'] });
  const before = core.exportDatabase(db);
  assert.throws(() => core.saveStudent(db, { ...db.students[0], subject: '英语' }), /先整理.*历史/);
  assert.equal(core.exportDatabase(db), before);
  const pending = core.saveStudent(db, { ...db.students[0], subject: '' });
  for (const table of ['scores', 'tags', 'plans']) assert.deepEqual(pending[table], db[table]);
  assert.equal(pending.students[0].subject, '');
});

test('archives with only unclassified scores may be assigned a subject without rewriting scores', () => {
  let db = base(''), id = db.students[0].id;
  db = core.saveScore(db, score(id, { subject: '' }));
  const saved = core.saveStudent(db, { ...db.students[0], subject: '英语' });
  assert.equal(saved.students[0].subject, '英语');
  assert.equal(saved.scores[0].subject, '');
  assert.match(core.suggestions(saved, id, '2026-10-06')[0].title, /未分类/);
});

test('mixed legacy archives remain intact and cannot silently select only one historical subject', () => {
  const old = legacy(); old.tags[0].subject = '英语';
  const db = core.validateDatabase(old), id = db.students[0].id;
  assert.equal(db.students[0].subject, '');
  for (const subject of ['数学', '英语']) assert.throws(() => core.saveStudent(db, { ...db.students[0], subject }), /不一致/);
  const more = core.saveScore(db, score(id, { subject: '语文' }));
  assert.equal(more.students[0].subject, '');
  const ideas = core.suggestions(more, id, '2026-10-06');
  for (const idea of ideas.filter(row => row.key.startsWith('score-'))) assert.ok(idea.evidence.every(row => row.startsWith(idea.title.includes('语文') ? '【语文】' : '【数学】')));
});

test('legacy corrupt records still reject before any migration result is accepted', () => {
  for (const damage of [
    db => { db.scores[0].score = '12.5'; },
    db => { db.scores[0].date = '2026-02-30'; },
    db => { db.tags[0].studentId = 'missing'; },
    db => { db.tags.push({ ...db.tags[0], id: 'conflict', type: 'strong' }); },
    db => { delete db.students[0].className; },
    db => { db.students[1].id = db.students[0].id; }
  ]) {
    const db = legacy(); damage(db); const before = JSON.stringify(db);
    assert.throws(() => core.validateDatabase(freeze(db)));
    assert.equal(JSON.stringify(db), before);
  }
});

test('new fields reject accessors without executing them and imported extras cannot pollute objects', () => {
  for (const key of ['subject', 'isExample', 'className']) {
    let called = false;
    const input = { name: '虚构学员' };
    Object.defineProperty(input, key, { get() { called = true; return key === 'isExample' ? false : ''; } });
    assert.throws(() => core.saveStudent(core.createDatabase(), input), /动态读取/);
    assert.equal(called, false);
  }
  const db = base();
  const row = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  Object.assign(row, db.students[0]); db.students[0] = row;
  const saved = core.importDatabase(core.exportDatabase(db));
  assert.equal(Object.hasOwn(saved.students[0], '__proto__'), false);
  assert.equal(Object.hasOwn(saved.students[0], 'constructor'), false);
  assert.equal({}.polluted, undefined);
});

test('v4 exports roundtrip all canonical fields independently and reject unsupported versions', () => {
  const db = core.validateDatabase(legacy());
  const text = core.exportDatabase(db), restored = core.importDatabase(text);
  assert.equal(JSON.parse(text).schemaVersion, 4);
  assert.deepEqual(restored, db);
  restored.students[0].className = '外部修改'; restored.plans[0].sourceEvidence[0] = '外部修改';
  assert.notEqual(restored.students[0].className, db.students[0].className);
  assert.notEqual(restored.plans[0].sourceEvidence[0], db.plans[0].sourceEvidence[0]);
  for (const version of [0, 5, '3', '4', null]) assert.throws(() => core.validateDatabase({ ...db, schemaVersion: version }), /版本/);
});

test('first-use English examples have ten removable archives in three categories and four scores each', () => {
  const db = core.createDatabase(true), groups = new Map();
  assert.equal(db.students.length, 10);
  assert.equal(db.scores.length, 40);
  for (const student of db.students) {
    assert.equal(student.isExample, true);
    assert.match(student.name, /虚构/);
    assert.match(student.note, /可删除/);
    assert.equal(student.className, '');
    const category = db.categories.find(row => row.id === student.categoryId);
    const group = category.name;
    groups.set(group, (groups.get(group) || 0) + 1);
    const scores = db.scores.filter(row => row.studentId === student.id);
    assert.equal(scores.length, 4);
    assert.equal(new Set(scores.map(row => row.date)).size, 4);
    assert.ok(scores.every(row => row.subject === student.subject && row.date <= core.today() && row.total === category.total));
  }
  assert.deepEqual(Object.fromEntries(groups), { '小学英语': 4, '初中英语': 3, '高中英语': 3 });
  let removed = db;
  for (const student of db.students) removed = core.deleteStudent(removed, student.id);
  for (const table of ['students', 'scores', 'tags', 'plans']) assert.equal(removed[table].length, 0);
  assert.equal(core.importDatabase(core.exportDatabase(removed)).students.length, 0, 'empty archive never reseeds on validation');
  assert.equal(core.createDatabase(false).students.length, 0);
});
