'use strict';

const core = require('./core.js');
const palette = Object.freeze(['#E4774D', '#4D7CE8', '#8A70D6', '#2C9E9B', '#D88637', '#CF6B89', '#6374AF', '#6B9380']);
const dashPatterns = [[], [6, 3], [2, 3], [8, 3, 2, 3]];
const keyOf = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '';
const labelOf = value => value.trim().replace(/\s+/g, ' ');

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function validScore(row) {
  return row && typeof row.id === 'string' && typeof row.title === 'string' && validDate(row.date) &&
    typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 &&
    typeof row.total === 'number' && Number.isFinite(row.total) && row.total > 0 && row.score <= row.total;
}

function compareRows(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// This is a read-only projection of the archive. Storage/import validation remains in core.
function buildComparison(db, options) {
  if (!db || !Array.isArray(db.students) || !Array.isArray(db.scores) || !Array.isArray(db.categories)) {
    throw new Error('档案数据格式不正确，请先重新读取或检查备份');
  }
  options = options || {};
  const today = options.today === undefined ? core.today() : options.today;
  if (!validDate(today)) throw new Error('对比日期请使用实际存在的年-月-日');
  const groupKey = typeof options.groupKey === 'string' && options.groupKey ? options.groupKey : 'unassigned';
  const category = db.categories.find(row => row.id === groupKey);
  const members = db.students.map((student, index) => ({ student, index }))
    .filter(row => (row.student.categoryId || 'unassigned') === groupKey);
  const subjects = new Map();
  let unknownCount = 0;
  members.forEach(({ student }) => {
    const key = keyOf(student.subject);
    if (!key) { unknownCount += 1; return; }
    if (!subjects.has(key)) subjects.set(key, { key, label: labelOf(student.subject), count: 0 });
    subjects.get(key).count += 1;
  });
  const subjectOptions = Array.from(subjects.values());
  const requestedKey = keyOf(options.subjectKey);
  const selected = subjects.get(requestedKey) || subjects.get('英语') || subjectOptions[0];
  const subjectKey = selected ? selected.key : '';
  const subjectLabel = selected ? selected.label : '';
  const selectedMembers = subjectKey ? members.filter(({ student }) => keyOf(student.subject) === subjectKey) : [];
  const scoresByStudent = new Map(selectedMembers.map(({ student }) => [student.id, []]));
  db.scores.forEach(row => {
    if (!validScore(row) || row.date > today || keyOf(row.subject) !== subjectKey) return;
    const rows = scoresByStudent.get(row.studentId);
    if (rows) rows.push(row);
  });
  const totals = new Set();
  let pointCount = 0;
  scoresByStudent.forEach((rows, id) => {
    const visible = rows.slice().sort(compareRows).slice(-6);
    visible.forEach(row => totals.add(row.total));
    pointCount += visible.length;
    scoresByStudent.set(id, visible);
  });
  const mixedTotals = totals.size > 1;
  const mode = mixedTotals ? 'rate' : 'score';
  const unit = mixedTotals ? '%' : '分';
  const fallbackTotal = category && Number.isFinite(category.total) && category.total > 0 ? category.total : 100;
  const max = mixedTotals ? 100 : totals.size ? Array.from(totals)[0] : fallbackTotal;
  const series = selectedMembers.map(({ student, index }) => {
    const points = scoresByStudent.get(student.id).map(row => ({
      id: row.id, date: row.date, title: row.title, score: row.score, total: row.total,
      // Divide first: score * 100 may overflow for valid, very large historical totals.
      value: mixedTotals ? Math.round((row.score / row.total) * 1000) / 10 : row.score
    }));
    const latest = points[points.length - 1];
    return {
      id: student.id, name: student.name, grade: student.grade, isExample: student.isExample === true,
      color: palette[index % palette.length],
      dash: dashPatterns[Math.floor(index / palette.length) % dashPatterns.length].slice(),
      points,
      latestText: !latest ? '暂无成绩' : mixedTotals ? `${latest.value}%（${latest.score} / ${latest.total}）` : `${latest.score} / ${latest.total} 分`
    };
  });
  const plottedCount = series.filter(row => row.points.length > 0).length;
  const notices = [];
  if (mixedTotals) notices.push('历史满分不一致，已按得分率展示。');
  if (!members.length) notices.push('本类暂无档案。');
  else if (!selected) notices.push('本类尚无明确学科，请先整理档案学科。');
  else if (!pointCount) notices.push('当前学科暂无可展示的成绩。');
  if (unknownCount) notices.push(`有 ${unknownCount} 份档案学科待整理，未纳入折线。`);
  return {
    subjectKey, subjectLabel, subjectOptions, series, unit, max, mode,
    recordCount: members.length, studentCount: selectedMembers.length,
    plottedCount, unplottedCount: selectedMembers.length - plottedCount,
    unknownCount, pointCount, mixedTotals, notice: notices.join(' ')
  };
}

module.exports = Object.freeze({ buildComparison, palette });
