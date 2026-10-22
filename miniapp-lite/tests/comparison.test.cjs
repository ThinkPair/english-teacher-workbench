'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/core.js');
const { buildComparison, palette } = require('../miniprogram/lib/comparison.js');
const today = '2026-10-06';
const opts = extra => ({ groupKey: 'group-a', today, ...extra });
function fixture() {
  const db = core.createDatabase();
  db.categories = [{ id: 'group-a', name: '虚构分类甲', total: 100 }, { id: 'group-b', name: '虚构分类乙', total: 120 }];
  return db;
}
function student(db, id, subject = '英语', categoryId = 'group-a', extra = {}) {
  db.students.push({ id, name: `虚构${id}`, grade: '七年级', className: '', note: '', subject, isExample: false, categoryId, ...extra });
  return id;
}
function score(db, studentId, id, extra = {}) {
  db.scores.push({ id, studentId, subject: '英语', title: '虚构测评', date: '2026-10-01', score: 80, total: 100, note: '', ...extra });
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test('empty group has no invented lines and uses its configured scale', () => {
  const db = fixture();
  const model = buildComparison(db, opts({ groupKey: 'group-b' }));
  assert.deepEqual(model.series, []);
  assert.deepEqual(model.subjectOptions, []);
  assert.equal(model.recordCount, 0);
  assert.equal(model.pointCount, 0);
  assert.equal(model.max, 120);
  assert.equal(model.mode, 'score');
  assert.equal(model.unit, '分');
  assert.equal(model.mixedTotals, false);
});

test('comparison covers every class member regardless of query or pending-plan filter', () => {
  const db = fixture();
  for (let index = 0; index < 12; index += 1) { const id = student(db, `s${index}`); score(db, id, `p${index}`); }
  student(db, 'outside', '英语', 'group-b');
  const all = buildComparison(db, opts());
  assert.equal(all.series.length, 12);
  assert.equal(all.plottedCount, 12);
  assert.equal(all.recordCount, 12);
  assert.deepEqual(buildComparison(db, opts({ query: '没有匹配', todoOnly: true })), all);
});

test('subject options normalize unicode, spacing and case without guessing semantic aliases', () => {
  const db = fixture();
  student(db, 'math', '数学'); student(db, 'english1', ' 英 语 '); student(db, 'english2', '英语');
  student(db, 'latin1', 'ＥＮＧＬＩＳＨ'); student(db, 'latin2', ' English '); student(db, 'unknown', '');
  const result = buildComparison(db, opts());
  assert.deepEqual(result.subjectOptions.map(row => [row.key, row.count]), [['数学', 1], ['英语', 2], ['english', 2]]);
  assert.equal(result.subjectKey, '英语');
  assert.equal(result.studentCount, 2);
  assert.equal(result.recordCount, 6);
  assert.equal(result.unknownCount, 1);
  assert.equal(result.unplottedCount, 2);
  assert.match(result.notice, /1 份档案学科待整理/);
});

test('valid subject selection switches independently and invalid choice falls back to English', () => {
  const db = fixture();
  student(db, 'math', '数学'); student(db, 'english', '英语');
  score(db, 'math', 'math-score', { subject: '数学', score: 90 }); score(db, 'english', 'english-score');
  const selected = buildComparison(db, opts({ subjectKey: ' 数 学 ' }));
  assert.equal(selected.subjectKey, '数学'); assert.deepEqual(selected.series.map(row => row.id), ['math']);
  assert.equal(selected.pointCount, 1);
  assert.equal(buildComparison(db, opts({ subjectKey: '不存在' })).subjectKey, '英语');
});

test('without English the first explicit subject is selected, not inferred from names or grade', () => {
  const db = fixture();
  student(db, 'unknown', '', 'group-a', { name: '英语示例名称' });
  score(db, 'unknown', 'english-record');
  student(db, 'chinese', '语文'); student(db, 'math', '数学');
  const model = buildComparison(db, opts());
  assert.equal(model.subjectKey, '语文'); assert.equal(model.unknownCount, 1);
  assert.deepEqual(model.series.map(row => row.id), ['chinese']);
  assert.equal(model.pointCount, 0);
});

test('unknown subjects never draw even if their stored scores contain a subject', () => {
  const db = fixture(); student(db, 'unknown', ''); score(db, 'unknown', 'known-score');
  const result = buildComparison(db, opts({ subjectKey: '英语' }));
  assert.equal(result.subjectKey, ''); assert.equal(result.unknownCount, 1);
  assert.equal(result.studentCount, 0); assert.equal(result.pointCount, 0);
  assert.deepEqual(result.series, []);
});

test('unassigned selection is exact and unknown group ids do not fall into another class', () => {
  const db = fixture(); student(db, 'classified'); student(db, 'unclassified', '英语', '');
  assert.deepEqual(buildComparison(db, { today }).series.map(row => row.id), ['unclassified']);
  assert.equal(buildComparison(db, opts({ groupKey: 'unassigned' })).max, 100);
  assert.equal(buildComparison(db, opts({ groupKey: 'missing' })).recordCount, 0);
});

test('same actual totals use raw points and ignore later category-default changes', () => {
  const db = fixture(); student(db, 'a'); student(db, 'b');
  score(db, 'a', 'a1', { score: 96, total: 120 }); score(db, 'b', 'b1', { score: 108, total: 120 });
  db.categories[0].total = 150;
  const model = buildComparison(db, opts());
  assert.equal(model.mode, 'score'); assert.equal(model.unit, '分'); assert.equal(model.max, 120);
  assert.equal(model.series[0].points[0].value, 96);
  assert.equal(model.series[1].points[0].value, 108);
  assert.equal(model.series[0].latestText, '96 / 120 分');
});

test('mixed actual totals across students use rounded percentages and explain the conversion', () => {
  const db = fixture(); student(db, 'a'); student(db, 'b');
  score(db, 'a', 'a1', { score: 80, total: 120 }); score(db, 'b', 'b1', { score: 80, total: 100 });
  const model = buildComparison(db, opts());
  assert.equal(model.mode, 'rate'); assert.equal(model.unit, '%'); assert.equal(model.max, 100);
  assert.equal(model.mixedTotals, true); assert.equal(model.pointCount, 2);
  assert.equal(model.series[0].points[0].value, 66.7);
  assert.equal(model.series[1].points[0].value, 80);
  assert.match(model.notice, /历史满分不一致.*已按得分率/);
  assert.equal(model.series[0].latestText, '66.7%（80 / 120）');
});

test('mixed totals within one student also select percentage mode', () => {
  const db = fixture(); student(db, 'a');
  score(db, 'a', 'a1', { total: 120 }); score(db, 'a', 'a2', { total: 100 });
  assert.equal(buildComparison(db, opts()).mode, 'rate');
});

test('only the final six visible points determine the scale, not older or excluded totals', () => {
  const db = fixture(); student(db, 'a');
  score(db, 'a', 'old', { date: '2026-09-01', total: 150 });
  for (let n = 1; n <= 6; n += 1) score(db, 'a', `p${n}`, { date: `2026-10-0${n}` });
  score(db, 'a', 'future', { date: '2026-10-07', total: 120 });
  score(db, 'a', 'other-subject', { subject: '数学', total: 110 });
  score(db, 'a', 'unclassified-subject', { subject: '', total: 200 });
  const model = buildComparison(db, opts());
  assert.equal(model.pointCount, 6); assert.equal(model.max, 100); assert.equal(model.mode, 'score');
  assert.deepEqual(model.series[0].points.map(row => row.id), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
});

test('same-day records retain their actual date and deterministic id order', () => {
  const db = fixture(); student(db, 'a');
  score(db, 'a', 'b'); score(db, 'a', 'a'); score(db, 'a', 'c', { date: '2026-10-06' });
  const points = buildComparison(db, opts()).series[0].points;
  assert.deepEqual(points.map(row => row.id), ['a', 'b', 'c']);
  assert.deepEqual(points.map(row => row.date), ['2026-10-01', '2026-10-01', '2026-10-06']);
});

test('missing exams create no zero or joined placeholder points and remain in legend', () => {
  const db = fixture(); student(db, 'with-score'); student(db, 'absent');
  score(db, 'with-score', 'first', { date: '2026-09-01' }); score(db, 'with-score', 'last', { date: '2026-10-06' });
  const model = buildComparison(db, opts());
  assert.equal(model.studentCount, 2); assert.equal(model.plottedCount, 1); assert.equal(model.unplottedCount, 1);
  assert.equal(model.pointCount, 2);
  assert.deepEqual(model.series[1].points, []); assert.equal(model.series[1].latestText, '暂无成绩');
  assert.deepEqual(model.series[0].points.map(row => row.date), ['2026-09-01', '2026-10-06']);
});

test('zero scores and very small positive totals remain real records with valid finite scales', () => {
  const db = fixture(); student(db, 'a'); student(db, 'b');
  score(db, 'a', 'zero', { score: 0, total: Number.MIN_VALUE });
  score(db, 'b', 'tiny-full', { score: Number.MIN_VALUE, total: Number.MIN_VALUE });
  const same = buildComparison(db, opts());
  assert.equal(same.max, Number.MIN_VALUE); assert.equal(same.mode, 'score');
  assert.equal(same.series[0].points[0].value, 0); assert.equal(same.plottedCount, 2);
  score(db, 'a', 'normal', { score: 50, total: 100 });
  const mixed = buildComparison(db, opts());
  assert.equal(mixed.mode, 'rate'); assert.equal(mixed.series[1].points[0].value, 100);
  assert.ok(mixed.series.flatMap(row => row.points).every(row => Number.isFinite(row.value)));
});

test('valid enormous historical totals do not overflow percentage conversion', () => {
  const db = fixture(); student(db, 'a'); student(db, 'b');
  score(db, 'a', 'huge', { score: Number.MAX_VALUE, total: Number.MAX_VALUE });
  score(db, 'b', 'regular', { score: 50, total: 100 });
  const model = buildComparison(db, opts());
  assert.equal(model.series[0].points[0].value, 100); assert.equal(model.series[1].points[0].value, 50);
});

test('invalid or absent marks, zero totals and impossible dates are excluded rather than made zero', () => {
  const db = fixture(); student(db, 'a');
  const invalid = [{ score: undefined }, { score: null }, { score: '' }, { score: NaN }, { score: Infinity },
    { score: -1 }, { score: 101 }, { total: 0 }, { total: -1 }, { total: Infinity }, { total: '100' },
    { date: '2026-02-29' }, { date: '2026-13-01' }, { date: '0000-01-01' }, { date: '2026-10-1' }];
  invalid.forEach((extra, index) => score(db, 'a', `bad${index}`, extra));
  score(db, 'a', 'valid', { score: 0 });
  const model = buildComparison(db, opts());
  assert.equal(model.pointCount, 1); assert.deepEqual(model.series[0].points.map(row => row.id), ['valid']);
});

test('no visible scores use category scale without inventing points, including tiny defaults', () => {
  const db = fixture(); student(db, 'a'); db.categories[0].total = 0.25;
  score(db, 'a', 'future', { date: '2026-10-07' });
  const result = buildComparison(db, opts());
  assert.equal(result.max, 0.25); assert.equal(result.unplottedCount, 1); assert.equal(result.pointCount, 0);
  assert.deepEqual(result.series[0].points, []);
});

test('palette and line styles depend on global student position, not selected group or subject', () => {
  const db = fixture(); student(db, 'outside', '数学', 'group-b');
  for (let n = 0; n < 10; n += 1) student(db, `s${n}`, n % 2 ? '英语' : '数学');
  const math = buildComparison(db, opts({ subjectKey: '数学' }));
  const english = buildComparison(db, opts({ subjectKey: '英语' }));
  const all = [...math.series, ...english.series];
  all.forEach(row => {
    const index = db.students.findIndex(student => student.id === row.id);
    assert.equal(row.color, palette[index % palette.length]);
  });
  assert.deepEqual(all.find(row => row.id === 's0').dash, []);
  assert.deepEqual(all.find(row => row.id === 's8').dash, [6, 3]);
  assert.equal(Object.isFrozen(palette), true);
});

test('selection and output do not mutate input or expose shared nested arrays', () => {
  const db = fixture(); student(db, 'a', '英语', 'group-a', { isExample: true }); score(db, 'a', 'a1');
  const original = JSON.stringify(db); const options = deepFreeze(opts()); deepFreeze(db);
  const model = buildComparison(db, options);
  assert.equal(model.series[0].isExample, true);
  model.series[0].points[0].score = 1; model.series[0].dash.push(999); model.subjectOptions[0].count = 999;
  assert.equal(JSON.stringify(db), original);
  const again = buildComparison(db, opts());
  assert.equal(again.series[0].points[0].score, 80); assert.deepEqual(again.series[0].dash, []);
  assert.equal(again.subjectOptions[0].count, 1);
});

test('invalid archive shapes and an invalid cutoff date fail with readable errors', () => {
  for (const db of [null, {}, { students: [], scores: [] }]) assert.throws(() => buildComparison(db, opts()), /档案数据格式/);
  for (const date of ['', null, '2026-02-29', '2026-1-01']) assert.throws(() => buildComparison(fixture(), opts({ today: date })), /对比日期/);
});
