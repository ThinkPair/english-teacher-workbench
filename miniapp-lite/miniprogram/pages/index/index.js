'use strict';

const core = require('../../lib/core.js');
const icons = require('../../lib/ui-icons.js');
const storage = require('../../lib/storage.js');
const dashboard = require('../../lib/dashboard.js');
const comparisonModel = require('../../lib/comparison.js');
const TYPES = [
  { key: 'weak', label: '薄弱知识点', hint: '记录还需练习的具体内容', tone: 'amber' },
  { key: 'strong', label: '强项知识点', hint: '记录可继续发挥的长处', tone: 'green' },
  { key: 'habit', label: '学习习惯', hint: '记录课堂与练习中的观察', tone: 'purple' }
];
const clone = value => JSON.parse(JSON.stringify(value));
const byDate = field => (a, b) => b[field].localeCompare(a[field]);
const labelFor = () => '本机档案';
const rate = score => Math.round(score.score / score.total * 1000) / 10;
const normalizeSubject = subject => String(subject || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const englishQuickTags = (subject, type) => ['英语', '英文', 'english'].indexOf(normalizeSubject(subject)) === -1 ? []
  : (type === 'habit' ? ['作业订正', '主动复习'] : ['词汇拼写', '一般过去时', '阅读定位', '听力辨音']);
const safeMessage = error => error && error.message ? error.message : '操作未完成，请稍后重试。';
// Leave headroom under WeChat's 1 MB limit per storage key.
const MAX_NATIVE_BYTES = 900 * 1024;
const utf8Bytes = text => {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
};

Page({
  data: {
    icons,
    space: 'archive', spaceLabel: '本机档案', view: 'list', detailTab: 'scores',
    query: '', listFilter: 'all', groupKey: '', groups: [], selectedGroup: null, emptyCategory: false, rows: [],
    totals: { records: 0, groups: 0, examples: 0, todo: 0 }, stats: { students: 0, scores: 0, todo: 0 },
    comparison: { series: [], subjectOptions: [], recordCount: 0, studentCount: 0, plottedCount: 0, unplottedCount: 0, unknownCount: 0, pointCount: 0, max: 100, unit: '分' },
    comparisonSubjectKey: '', comparisonSubjectNames: [], comparisonSubjectIndex: 0,
    comparisonFocusId: '', comparisonFocus: null,
    comparisonLegendHeight: 0, compositionLegendHeight: 222,
    student: null, scores: [], visibleScores: [], chart: [], chartMessage: '', chartSubject: '',
    scoreSubjectValue: null, scoreSubjectIndex: 0,
    scoreSubjectOptions: [{ value: null, label: '全部科目 / 项目' }], scoreSubjectNames: ['全部科目 / 项目'],
    tagGroups: [], plans: [], ideas: [], completedPlanId: '',
    error: '', notice: '', blocked: false, canCopyRaw: false, legacyDemoAvailable: false, addingExamples: false,
    form: {}, formKind: '', formTitle: '', formStudentName: '', formIsEdit: false,
    formSubjectFixed: false, formArchiveSubject: '', quickTagLabels: [],
    categories: [], categoryOptions: [{ id: '', label: '未分类' }], categoryNames: ['未分类'], categoryIndex: 0,
    studentCategoryName: '未分类', studentCategoryTotal: null, formTotalHint: '',
    typeNames: TYPES.map(type => type.label), typeIndex: 0,
    importText: '', importPreview: null, importConfirmed: false
  },

  onLoad() {
    this._db = null;
    this._space = 'archive';
    this._diskToken = null;
    this._raw = undefined;
    this._draftContext = null;
    this._dirty = false;
    this._loadSpace('archive');
  },

  _readDisk() { return storage.read(wx); },

  _loadSpace(space) {
    if (space !== 'archive') return;
    let disk;
    try { disk = this._readDisk(space); }
    catch (error) {
      this.setData({ error: '无法读取本地档案；没有改动已有记录。请重试。', notice: '' });
      if (!this._db) this.setData({ blocked: true, view: 'backup' });
      return;
    }
    let db;
    try {
      db = disk.present
        ? (typeof disk.raw === 'string' ? core.importDatabase(disk.raw) : core.validateDatabase(disk.raw))
        : core.createDatabase(true);
    } catch (error) {
      this._db = null;
      this._space = space;
      this._diskToken = disk.token;
      this._raw = disk.raw;
      this._draftContext = null;
      this._dirty = false;
      this._resetImport();
      this.setData({
        space, spaceLabel: labelFor(space), blocked: true, view: 'backup',
        canCopyRaw: true, legacyDemoAvailable: !!disk.legacyDemoAvailable,
        student: null, rows: [], groups: [], groupKey: '', selectedGroup: null, emptyCategory: false,
        categories: [], categoryOptions: [{ id: '', label: '未分类' }], categoryNames: ['未分类'], categoryIndex: 0,
        studentCategoryName: '未分类', studentCategoryTotal: null,
        totals: { records: 0, groups: 0, examples: 0, todo: 0 },
        scores: [], visibleScores: [], chart: [], chartMessage: '', chartSubject: '', plans: [], ideas: [], tagGroups: [], completedPlanId: '',
        scoreSubjectValue: null, scoreSubjectIndex: 0, listFilter: 'all',
        scoreSubjectOptions: [{ value: null, label: '全部科目 / 项目' }], scoreSubjectNames: ['全部科目 / 项目'],
        stats: { students: 0, scores: 0, todo: 0 },
        error: '这份档案暂时无法打开：' + safeMessage(error) + '。原内容已保留，请先备份再恢复。', notice: ''
      });
      return;
    }
    if (!disk.present) {
      try {
        const legacyDemoAvailable = disk.legacyDemoAvailable;
        disk = Object.assign(storage.commit(wx, db, disk.token), { legacyDemoAvailable });
      } catch (error) {
        this.setData({ error: '本机暂时无法保存，尚未建立新档案。请检查设备存储后重试。', notice: '' });
        if (!this._db) this.setData({ blocked: true, view: 'backup' });
        return;
      }
    }
    this._db = db;
    this._space = space;
    this._diskToken = disk.token;
    this._raw = disk.raw;
    this._draftContext = null;
    this._dirty = false;
    this._resetImport();
    this.setData({
      space, spaceLabel: labelFor(space), blocked: false, canCopyRaw: false, legacyDemoAvailable: !!disk.legacyDemoAvailable,
      view: 'list', query: '', listFilter: 'all', groupKey: '', scoreSubjectValue: null, student: null, error: '', notice: ''
    });
    this._render();
  },

  _checkDisk(expectedSpace) {
    if (this._space !== expectedSpace) throw new Error('当前档案已变化，请返回后重新操作。');
    const disk = this._readDisk(expectedSpace);
    if (disk.token !== this._diskToken) {
      throw new Error('档案已发生变化，本次没有覆盖。请先保存未提交的文字，再到备份与恢复中重新读取档案。');
    }
  },

  _writeDatabase(next, expectedSpace) {
    const clean = core.validateDatabase(next);
    const text = core.exportDatabase(clean);
    if (utf8Bytes(text) > MAX_NATIVE_BYTES) {
      throw new Error('本机档案已接近本地容量上限，本次没有保存。请先导出备份，再整理旧记录后重试。');
    }
    this._checkDisk(expectedSpace);
    const disk = storage.commit(wx, clean, this._diskToken);
    // Publish state only after the synchronous storage write succeeds.
    this._db = clean;
    this._raw = disk.raw;
    this._diskToken = disk.token;
    this.setData({ blocked: false, canCopyRaw: false, error: '' });
    this._render();
  },

  _render() {
    if (!this._db) return;
    const db = this._db;
    const summary = dashboard.buildDashboard(db, { groupKey: this.data.groupKey, query: this.data.query, todoOnly: this.data.listFilter === 'todo' });
    const groups = summary.groups.map((group, index) => Object.assign({}, group, {
      color: comparisonModel.palette[index % comparisonModel.palette.length],
      ratio: db.students.length ? Math.round(group.count / db.students.length * 1000) / 10 : 0
    }));
    const comparison = comparisonModel.buildComparison(db, { groupKey: summary.selectedKey, subjectKey: this.data.comparisonSubjectKey });
    comparison.series = comparison.series.map((item, index) => Object.assign({}, item, { number: index + 1 }));
    const comparisonFocus = comparison.series.find(item => item.id === this.data.comparisonFocusId) || null;
    const rows = summary.cards.map(item => Object.assign({}, item, { initial: Array.from(item.name)[0] || '学' }));
    const selectedId = this.data.student && this.data.student.id;
    const student = db.students.find(item => item.id === selectedId) || null;
    const categories = (db.categories || []).map(item => Object.assign({}, item, {
      studentCount: db.students.filter(row => row.categoryId === item.id).length
    }));
    const categoryOptions = [{ id: '', label: '未分类' }].concat(categories.map(item => ({ id: item.id, label: item.name + ' · 默认满分 ' + item.total })));
    const studentCategory = student && categories.find(item => item.id === student.categoryId);
    let scores = [], visibleScores = [], chart = [], tagGroups = [], plans = [], ideas = [];
    let chartMessage = '', chartSubject = '', scoreSubjectValue = this.data.scoreSubjectValue;
    let scoreSubjectOptions = [{ value: null, label: '全部科目 / 项目' }];
    if (student) {
      scores = db.scores.filter(item => item.studentId === student.id).sort(byDate('date'))
        .map(item => Object.assign({}, item, { rate: rate(item), subjectLabel: item.subject || '未分类' }));
      const subjects = Array.from(new Set(scores.map(item => item.subject || ''))).sort((a, b) => a.localeCompare(b));
      scoreSubjectOptions = scoreSubjectOptions.concat(subjects.map(subject => ({ value: subject, label: subject || '未分类' })));
      if (scoreSubjectValue !== null && subjects.indexOf(scoreSubjectValue) === -1) scoreSubjectValue = null;
      visibleScores = scoreSubjectValue === null ? scores : scores.filter(item => (item.subject || '') === scoreSubjectValue);
      chart = dashboard.seriesForStudent(db, student.id);
      chartSubject = student.subject || '未分类成绩';
      if (!student.subject) chartMessage = '这份旧档案的学科待整理。图表仅保留未分类成绩，其他科目仍在下方记录中；请先核对记录，再编辑档案。';
      else if (scores.some(item => normalizeSubject(item.subject) !== normalizeSubject(student.subject))) {
        chartMessage = '图表只展示这份档案的学科。旧版其他科目和未分类成绩仍保留在下方，请逐条核对整理。';
      }
      tagGroups = TYPES.map(type => {
        const tags = db.tags.filter(item => item.studentId === student.id && item.type === type.key)
          .map(item => Object.assign({}, item, { subjectLabel: item.subject || '通用' }))
          .sort((a, b) => (a.status === b.status ? b.observedOn.localeCompare(a.observedOn) : a.status === 'active' ? -1 : 1));
        return Object.assign({}, type, { tags, activeCount: tags.filter(item => item.status === 'active').length });
      });
      plans = db.plans.filter(item => item.studentId === student.id).map(item => Object.assign({}, item, {
        isOverdue: item.status === 'todo' && !!item.dueDate && item.dueDate < core.today()
      })).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'todo' ? -1 : 1;
        return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
      });
      ideas = core.suggestions(db, student.id).map(idea => {
        const existing = plans.find(plan => plan.status === 'todo' && plan.title === idea.title && JSON.stringify(plan.sourceEvidence) === JSON.stringify(idea.evidence));
        return Object.assign({}, idea, { existingPlanId: existing ? existing.id : '' });
      });
    } else {
      scoreSubjectValue = null;
    }
    this.setData({ rows, groups, groupKey: summary.selectedKey, selectedGroup: summary.selectedGroup, totals: summary.totals,
      // Reserve a second name line for long categories without clipping the
      // final visible category's count. More than three categories still scroll.
      compositionLegendHeight: Math.max(222, groups.slice(0, 3).reduce((height, group) =>
        height + (String(group.name || group.label).length > 10 ? 112 : 74), 0)),
      comparison, comparisonSubjectKey: comparison.subjectKey, comparisonSubjectNames: comparison.subjectOptions.map(item => item.label + ' · ' + item.count + ' 份'),
      comparisonSubjectIndex: Math.max(0, comparison.subjectOptions.findIndex(item => item.key === comparison.subjectKey)),
      comparisonFocus, comparisonFocusId: comparisonFocus ? comparisonFocus.id : '',
      comparisonLegendHeight: Math.min(3, Math.ceil(comparison.series.length / 2)) * 102,
      emptyCategory: !!summary.selectedGroup && !summary.selectedGroup.count && summary.selectedGroup.key !== 'unassigned',
      student, scores, visibleScores, chart, chartMessage, chartSubject, tagGroups, plans, ideas,
      completedPlanId: plans.some(item => item.id === this.data.completedPlanId && item.status === 'done') ? this.data.completedPlanId : '',
      categories, categoryOptions, categoryNames: categoryOptions.map(item => item.label),
      categoryIndex: Math.max(0, categoryOptions.findIndex(item => item.id === (this.data.form.categoryId || ''))),
      studentCategoryName: studentCategory ? studentCategory.name : '未分类', studentCategoryTotal: studentCategory ? studentCategory.total : null,
      scoreSubjectValue, scoreSubjectOptions,
      scoreSubjectIndex: Math.max(0, scoreSubjectOptions.findIndex(option => option.value === scoreSubjectValue)),
      scoreSubjectNames: scoreSubjectOptions.map(option => option.label),
      stats: { students: db.students.length, scores: db.scores.length, todo: db.plans.filter(item => item.status === 'todo').length }
    });
  },

  _confirm(title, content, confirmText) {
    return new Promise(resolve => wx.showModal({
      title, content, confirmText: confirmText || '确认', cancelText: '取消', confirmColor: '#CB4A20',
      success: result => resolve(!!result.confirm), fail: () => resolve(false)
    }));
  },

  async _leaveDraft() {
    if (this.data.view === 'form' && this._dirty) {
      if (!await this._confirm('放弃本次修改？', '尚未保存的内容会丢失，已有档案不受影响。', '放弃修改')) return false;
    }
    return true;
  },

  _closeDraft() {
    this._draftContext = null;
    this._dirty = false;
  },

  onSelectGroup(event) {
    const key = event.currentTarget.dataset.key;
    if (!this.data.groups.some(group => group.key === key)) return;
    this.setData({ groupKey: key, comparisonSubjectKey: '', comparisonFocusId: '', query: '', listFilter: 'all' });
    this._render();
  },

  onComparisonSubject(event) {
    if (!this._db || this.data.blocked || this.data.view !== 'list') return;
    const index = Number(event.detail.value);
    const option = this.data.comparison.subjectOptions[index];
    if (!Number.isInteger(index) || !option) return;
    this.setData({ comparisonSubjectKey: option.key, comparisonFocusId: '' });
    this._render();
  },

  onFocusSeries(event) {
    if (!this._db || this.data.blocked || this.data.view !== 'list') return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.comparison.series.some(item => item.id === id)) return;
    const focusId = this.data.comparisonFocusId === id ? '' : id;
    this.setData({ comparisonFocusId: focusId, comparisonFocus: this.data.comparison.series.find(item => item.id === focusId) || null });
  },

  onClearSeriesFocus() { this.setData({ comparisonFocusId: '', comparisonFocus: null }); },

  onOpenComparisonStudent() {
    if (!this._db || this.data.blocked || this.data.view !== 'list' || this._dirty || this._draftContext || !this.data.comparisonFocusId) return;
    this.onOpenStudent({ currentTarget: { dataset: { id: this.data.comparisonFocusId } } });
    this.setData({ detailTab: 'scores' });
  },

  onAddExamples() {
    // This home-page action must never replace an open form or a dirty draft.
    if (this._addingExamples || !this._db || this.data.blocked || this.data.view !== 'list' || this._draftContext || this._dirty) return;
    if (this._db.students.some(item => item.isExample === true)) return;
    this._addingExamples = true;
    this.setData({ addingExamples: true, error: '', notice: '' });
    try {
      const previousIds = new Set(this._db.students.map(item => item.id));
      const next = core.addExampleStudents(this._db);
      const added = next.students.filter(item => item.isExample === true && !previousIds.has(item.id));
      this._writeDatabase(next, this._space);
      this.setData({ query: '', listFilter: 'all', groupKey: added.length ? (added[0].categoryId || 'unassigned') : this.data.groupKey,
        notice: '已添加 ' + added.length + ' 份示例档案，可直接编辑或删除。原有记录保持不变。', error: '' });
      this._render();
    } catch (error) {
      this.setData({ error: safeMessage(error), notice: '' });
    } finally {
      this._addingExamples = false;
      this.setData({ addingExamples: false });
    }
  },

  onSearch(event) { this.setData({ query: event.detail.value }); this._render(); },

  onListFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (['all', 'todo'].indexOf(filter) === -1) return;
    this.setData({ listFilter: filter });
    this._render();
  },

  onScoreSubject(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !this.data.scoreSubjectOptions[index]) return;
    this.setData({ scoreSubjectValue: this.data.scoreSubjectOptions[index].value });
    this._render();
  },

  onHelp() {
    // A stacked page keeps this page and its unsaved form intact on return.
    wx.navigateTo({ url: '/pages/help/help',
      fail: () => this.setData({ error: '使用帮助暂时未能打开，当前档案与填写内容都保留着，请重试。' })
    });
  },

  async onHome() {
    if (await this._leaveDraft()) {
      this._closeDraft();
      this.setData({ view: this.data.blocked ? 'backup' : 'list', error: '', notice: '' });
    }
  },

  async onBackup() {
    if (await this._leaveDraft()) {
      this._closeDraft();
      this.setData({ view: 'backup', error: '', notice: '' });
    }
  },

  async onManageCategories() {
    if (!this._db || !await this._leaveDraft()) return;
    this._closeDraft();
    this.setData({ view: 'categories', error: '', notice: '' });
    this._render();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onAddCategory() { this._openForm('category'); },

  onEditCategory(event) {
    if (!this._db) return;
    const category = (this._db.categories || []).find(item => item.id === event.currentTarget.dataset.id);
    if (category) this._openForm('category', category);
  },

  onViewCategory(event) {
    if (!this._db) return;
    const id = event.currentTarget.dataset.id;
    if (!(this._db.categories || []).some(item => item.id === id)) return;
    this.setData({ view: 'list', groupKey: id, query: '', listFilter: 'all', error: '', notice: '' });
    this._render();
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  async onDeleteCategory(event) {
    if (!this._db) return;
    const category = (this._db.categories || []).find(item => item.id === event.currentTarget.dataset.id);
    if (!category) return;
    const count = this._db.students.filter(item => item.categoryId === category.id).length;
    if (count) {
      this.setData({ error: '“' + category.name + '”中还有 ' + count + ' 份学员档案。请先编辑学员，将他们移到其他分类或未分类，再删除这个分类。', notice: '' });
      return;
    }
    const space = this._space, revision = this._db.revision;
    if (!await this._confirm('删除这个分类？', '“' + category.name + '”中没有学员。删除后，新增档案将不能再选择这个分类。', '确认删除')) return;
    try {
      if (!this._db || space !== this._space || revision !== this._db.revision) throw new Error('档案已变化，请重新确认分类。');
      this._writeDatabase(core.removeCategory(this._db, category.id), space);
      this.setData({ notice: '分类已删除', error: '' });
    } catch (error) { this.setData({ error: safeMessage(error), notice: '' }); }
  },

  onOpenStudent(event) {
    if (!this._db) return;
    const student = this._db.students.find(item => item.id === event.currentTarget.dataset.id);
    if (!student) return;
    this.setData({ student, view: 'detail', detailTab: this.data.listFilter === 'todo' ? 'plans' : 'scores', scoreSubjectValue: null, completedPlanId: '', error: '', notice: '' });
    this._render();
  },

  onTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (['scores', 'tags', 'plans', 'ideas'].indexOf(tab) !== -1) this.setData({ detailTab: tab, error: '', notice: '' });
  },

  _openForm(kind, record, options) {
    if (!this._db) return;
    options = options || {};
    const student = this.data.student;
    if (kind !== 'student' && kind !== 'category' && !student) return;
    const categories = this._db.categories || [];
    const selectedCategory = categories.find(item => item.id === this.data.groupKey);
    const studentCategory = student && categories.find(item => item.id === student.categoryId);
    let form;
    if (record) form = clone(record);
    else if (kind === 'category') form = { name: '', total: 100 };
    else if (kind === 'student') form = { name: '', grade: '', subject: '英语', categoryId: selectedCategory ? selectedCategory.id : '', note: '', isExample: false };
    else if (kind === 'score') form = { title: '', subject: student.subject || '', date: core.today(), score: '', total: studentCategory ? studentCategory.total : 100, note: '' };
    else if (kind === 'tag') form = { type: options.type || 'weak', subject: options.type === 'habit' ? '' : (student.subject || ''), label: '', note: '', observedOn: core.today(), status: 'active' };
    else form = { title: '', body: '', dueDate: '', status: 'todo', result: '', sourceEvidence: [] };
    if (options.idea) {
      form.title = options.idea.title;
      form.body = options.idea.body;
      form.sourceEvidence = options.idea.evidence.slice();
    }
    if (kind === 'tag' && options.scoreObservation) {
      const score = options.scoreObservation;
      form.note = '参考成绩：' + score.title + '\n日期：' + score.date + '\n学科：' + (score.subject || '未分类')
        + '\n得分：' + score.score + ' / ' + score.total + '（得分率 ' + rate(score) + '%）\n本次观察：';
    }
    if (kind === 'score' && options.retest) form.title = '跟进复测';
    this._draftContext = {
      space: this._space, revision: this._db.revision,
      studentId: kind === 'category' ? null : kind === 'student' ? (record ? record.id : null) : student.id,
      recordId: record ? record.id : null,
      archiveSubject: student && kind !== 'student' && kind !== 'category' ? (student.subject || '') : '',
      returnTab: this.data.detailTab,
      returnView: kind === 'category' ? 'categories' : this.data.view === 'list' ? 'list' : 'detail'
    };
    this._dirty = !!(options.idea || options.scoreObservation || options.retest);
    const archiveSubject = student && kind !== 'student' && kind !== 'category' ? (student.subject || '') : '';
    const formSubjectFixed = kind === 'student' ? !record : !!archiveSubject &&
      (kind === 'score' || kind === 'tag') && (!record || normalizeSubject(form.subject) === normalizeSubject(archiveSubject) || (kind === 'tag' && !form.subject));
    const names = { student: '学员档案', category: '学员分类', score: '成绩', tag: '观察标签', plan: '跟进计划', complete: '完成记录' };
    this.setData({
      view: 'form', form, formKind: kind,
      formTitle: kind === 'complete' ? '记录跟进结果' : (record ? '编辑' : '新增') + names[kind],
      formStudentName: student && kind !== 'student' && kind !== 'category' ? student.name : '', formIsEdit: !!record,
      formSubjectFixed, formArchiveSubject: archiveSubject,
      categoryIndex: Math.max(0, this.data.categoryOptions.findIndex(item => item.id === (form.categoryId || ''))),
      formTotalHint: kind !== 'score' ? '' : record ? '保留这次成绩原来的满分，分类设置不会改动历史成绩。'
        : studentCategory ? '已带入“' + studentCategory.name + '”的默认满分，可按本次试卷修改。' : '这份档案尚未分类，先带入满分 100；可按本次试卷修改，或在学员档案中设置分类。',
      quickTagLabels: kind === 'tag' ? englishQuickTags(form.subject || archiveSubject, form.type) : [],
      typeIndex: Math.max(0, TYPES.findIndex(type => type.key === form.type)), error: '', notice: ''
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  onAddStudent() { this._openForm('student'); },
  onEditStudent() { if (this.data.student) this._openForm('student', this.data.student); },
  onAddScore() { this._openForm('score'); },
  onAddTag(event) { this._openForm('tag', null, { type: event.currentTarget.dataset.type || 'weak' }); },
  onAddPlan() { this._openForm('plan'); },

  onObserveScore(event) {
    if (!this._db || !this.data.student) return;
    const score = this._db.scores.find(item => item.id === event.currentTarget.dataset.id && item.studentId === this.data.student.id);
    if (score) this._openForm('tag', null, { type: 'weak', scoreObservation: score });
  },

  onRetestPlan(event) {
    if (!this._db || !this.data.student) return;
    const plan = this._db.plans.find(item => item.id === event.currentTarget.dataset.id && item.studentId === this.data.student.id && item.status === 'done');
    if (plan) this._openForm('score', null, { retest: plan });
  },

  onEditRecord(event) {
    if (!this._db || !this.data.student) return;
    const kind = event.currentTarget.dataset.kind;
    const table = { score: 'scores', tag: 'tags', plan: 'plans', complete: 'plans' }[kind];
    if (!table) return;
    const record = this._db[table].find(item => item.id === event.currentTarget.dataset.id && item.studentId === this.data.student.id);
    if (record) this._openForm(kind, record);
  },

  onUseIdea(event) {
    if (!this._db || !this.data.student) return;
    const idea = this.data.ideas.find(item => item.key === event.currentTarget.dataset.key);
    if (!idea) return;
    const existing = this._db.plans.find(plan => plan.studentId === this.data.student.id && plan.status === 'todo'
      && plan.title === idea.title && JSON.stringify(plan.sourceEvidence) === JSON.stringify(idea.evidence));
    if (existing) this._openForm('plan', existing);
    else this._openForm('plan', null, { idea });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (['name', 'grade', 'note', 'title', 'subject', 'date', 'score', 'total', 'label', 'observedOn', 'body', 'dueDate', 'result'].indexOf(field) === -1) return;
    if (field === 'subject' && this.data.formSubjectFixed) return;
    this._dirty = true;
    const update = { ['form.' + field]: event.detail.value, error: '' };
    if (field === 'subject' && this.data.formKind === 'tag') update.quickTagLabels = englishQuickTags(event.detail.value || this.data.formArchiveSubject, this.data.form.type);
    this.setData(update);
  },

  onTagType(event) {
    const index = Number(event.detail.value);
    if (!TYPES[index]) return;
    this._dirty = true;
    this.setData({ typeIndex: index, 'form.type': TYPES[index].key,
      quickTagLabels: englishQuickTags(this.data.form.subject || this.data.formArchiveSubject, TYPES[index].key), error: '' });
  },

  onStudentCategory(event) {
    const index = Number(event.detail.value);
    if (!this._draftContext || this.data.formKind !== 'student' || !Number.isInteger(index) || !this.data.categoryOptions[index]) return;
    this._dirty = true;
    this.setData({ categoryIndex: index, 'form.categoryId': this.data.categoryOptions[index].id, error: '' });
  },

  onTagScope(event) {
    const context = this._draftContext;
    const scope = event.currentTarget.dataset.scope;
    if (!context || this.data.formKind !== 'tag' || !this.data.formSubjectFixed || ['archive', 'general'].indexOf(scope) === -1) return;
    this._dirty = true;
    this.setData({ 'form.subject': scope === 'archive' ? context.archiveSubject : '',
      quickTagLabels: englishQuickTags(context.archiveSubject, this.data.form.type), error: '' });
  },

  onQuickTag(event) {
    const label = event.currentTarget.dataset.label;
    if (!this._draftContext || this.data.formKind !== 'tag' || this.data.quickTagLabels.indexOf(label) === -1) return;
    this._dirty = true;
    this.setData({ 'form.label': label, error: '' });
  },

  onClearDueDate() { this._dirty = true; this.setData({ 'form.dueDate': '' }); },

  async onCancelForm() {
    const context = this._draftContext;
    if (!await this._leaveDraft()) return;
    this._closeDraft();
    this.setData({ view: context ? context.returnView : 'list', error: '', notice: '' });
  },

  onSaveForm() {
    const context = this._draftContext;
    if (!context || !this._db) return;
    try {
      if (context.space !== this._space || context.revision !== this._db.revision) throw new Error('档案已变化，请返回后重新打开这条记录。');
      const kind = this.data.formKind;
      const input = clone(this.data.form);
      if (kind === 'student' && !context.recordId) input.subject = '英语';
      if (kind === 'student' && (!String(input.name || '').trim() || !String(input.grade || '').trim() || !String(input.subject || '').trim())) {
        throw new Error(context.recordId ? '请填写学员称呼、年级和学科；旧档案请按实际记录整理。' : '请填写学员称呼和年级；新档案的学科为英语。');
      }
      delete input.id;
      delete input.studentId;
      if (context.recordId) input.id = context.recordId;
      if (kind !== 'student' && kind !== 'category') input.studentId = context.studentId;
      if (kind === 'complete') input.status = 'done';
      const save = { student: core.saveStudent, category: core.saveCategory, score: core.saveScore, tag: core.saveTag, plan: core.savePlan, complete: core.savePlan }[kind];
      const next = save(this._db, input);
      const createdStudent = kind === 'student' && !context.recordId
        ? next.students.find(item => !this._db.students.some(existing => existing.id === item.id)) : null;
      // Focus the saved archive's category so it does not disappear
      // behind the previously selected group after returning to the home page.
      let savedGroupKey = this.data.groupKey;
      if (kind === 'student') {
        savedGroupKey = input.categoryId || 'unassigned';
      } else if (kind === 'category') {
        const savedCategory = context.recordId ? next.categories.find(item => item.id === context.recordId)
          : next.categories.find(item => !(this._db.categories || []).some(existing => existing.id === item.id));
        if (savedCategory) savedGroupKey = savedCategory.id;
      }
      this._writeDatabase(next, context.space);
      this._draftContext = null;
      this._dirty = false;
      const detailTab = createdStudent ? 'scores' : { score: 'scores', tag: 'tags', plan: 'plans', complete: 'plans' }[kind] || context.returnTab;
      this.setData({ view: kind === 'category' ? 'list' : createdStudent ? 'detail' : context.returnView, detailTab, groupKey: savedGroupKey,
        notice: kind === 'category' ? '分类已保存。默认满分只用于以后新增成绩，已有成绩不变。'
          : createdStudent ? '档案已建立，可以记录第一条成绩或观察标签。' : '已保存到' + labelFor(context.space), error: '' });
      if (createdStudent) this.setData({ student: createdStudent });
      if (kind === 'complete') this.setData({ completedPlanId: context.recordId });
      if (kind === 'category') this.setData({ query: '', listFilter: 'all' });
      this._render();
    } catch (error) { this.setData({ error: safeMessage(error), notice: '' }); }
  },

  async onDeleteStudent() {
    if (!this._db || !this.data.student) return;
    const student = clone(this.data.student), space = this._space, revision = this._db.revision;
    const n = table => this._db[table].filter(item => item.studentId === student.id).length;
    const text = '将删除“' + student.name + '”及其 ' + n('scores') + ' 条成绩、' + n('tags') + ' 个标签、' + n('plans') + ' 条计划。删除后只能通过已有备份恢复。';
    if (!await this._confirm('删除这份学员档案？', text, '确认删除')) return;
    try {
      if (!this._db || space !== this._space || revision !== this._db.revision) throw new Error('档案已变化，请重新确认删除范围。');
      this._writeDatabase(core.deleteStudent(this._db, student.id), space);
      this.setData({ student: null, view: 'list', notice: '这份学员档案及关联记录已删除', error: '' });
    } catch (error) { this.setData({ error: safeMessage(error) }); }
  },

  async onDeleteRecord(event) {
    if (!this._db || !this.data.student) return;
    const kind = event.currentTarget.dataset.kind, id = event.currentTarget.dataset.id;
    const table = { score: 'scores', tag: 'tags', plan: 'plans' }[kind];
    if (!table) return;
    const record = this._db[table].find(item => item.id === id && item.studentId === this.data.student.id);
    if (!record) return;
    const space = this._space, revision = this._db.revision;
    if (!await this._confirm('删除这条记录？', '“' + (record.title || record.label) + '”将从当前档案中删除。已保存计划中的依据快照会保留。', '确认删除')) return;
    try {
      if (!this._db || space !== this._space || revision !== this._db.revision) throw new Error('档案已变化，请重新确认。');
      const remove = { score: core.deleteScore, tag: core.deleteTag, plan: core.deletePlan }[kind];
      this._writeDatabase(remove(this._db, id), space);
      this.setData({ notice: '记录已删除', error: '' });
    } catch (error) { this.setData({ error: safeMessage(error) }); }
  },

  async onToggleTag(event) {
    if (!this._db || !this.data.student) return;
    const tag = this._db.tags.find(item => item.id === event.currentTarget.dataset.id && item.studentId === this.data.student.id);
    if (!tag) return;
    const space = this._space, revision = this._db.revision, next = clone(tag);
    next.status = tag.status === 'active' ? 'resolved' : 'active';
    if (!await this._confirm(next.status === 'resolved' ? '解除当前标签？' : '恢复当前标签？',
      next.status === 'resolved' ? '观察记录会保留，后续建议不再把它作为当前标签。这不等于系统判断学员已掌握。' : '这条观察会重新用于生成建议，请确认它仍符合现状。', '确认')) return;
    try {
      if (!this._db || space !== this._space || revision !== this._db.revision) throw new Error('档案已变化，请重新确认。');
      this._writeDatabase(core.saveTag(this._db, next), space);
      this.setData({ notice: next.status === 'resolved' ? '标签已解除，观察记录仍保留' : '标签已恢复', error: '' });
    } catch (error) { this.setData({ error: safeMessage(error) }); }
  },

  async onReopenPlan(event) {
    if (!this._db || !this.data.student) return;
    const plan = this._db.plans.find(item => item.id === event.currentTarget.dataset.id && item.studentId === this.data.student.id);
    if (!plan) return;
    const space = this._space, revision = this._db.revision, next = clone(plan);
    if (!await this._confirm('重新跟进这项计划？', '计划将回到待跟进，已有结果会保留，可继续修改。', '重新跟进')) return;
    try {
      if (!this._db || space !== this._space || revision !== this._db.revision) throw new Error('档案已变化，请重新确认。');
      next.status = 'todo';
      this._writeDatabase(core.savePlan(this._db, next), space);
      this.setData({ notice: '已恢复为待跟进', error: '' });
    } catch (error) { this.setData({ error: safeMessage(error) }); }
  },

  async onExport() {
    if (!this._db) return;
    const space = this._space;
    let text;
    try { this._checkDisk(space); text = core.exportDatabase(this._db); }
    catch (error) { this.setData({ error: safeMessage(error) }); return; }
    if (!await this._confirm('复制完整档案备份？', '将把' + labelFor(space) + '的全部分类、学员、成绩、标签和计划复制到系统剪贴板，可能含个人信息。请只粘贴到你信任的私人位置，勿发到群聊或公开文档。', '确认复制')) return;
    wx.setClipboardData({
      data: text,
      success: () => this.setData({ notice: labelFor(space) + '备份已复制。请在私人位置粘贴保存；剪贴板本身不是持久备份。', error: '' }),
      fail: () => this.setData({ error: '复制未完成，档案没有改变。请重试。', notice: '' })
    });
  },

  async onCopyRaw() {
    if (!this.data.canCopyRaw || this._raw === undefined) return;
    const text = typeof this._raw === 'string' ? this._raw : JSON.stringify(this._raw);
    if (!await this._confirm('复制暂时无法打开的原内容？', '原内容可能包含全部学员信息。复制仅用于私人保留或排查，不代表它已经是可恢复的有效备份。请勿公开。', '确认复制')) return;
    wx.setClipboardData({ data: text,
      success: () => this.setData({ notice: '原内容已复制，请另存于私人位置。当前档案未被改动。', error: '' }),
      fail: () => this.setData({ error: '复制失败，原内容仍保留在本地。', notice: '' })
    });
  },

  async onExportLegacyDemo() {
    let text;
    try {
      const raw = storage.legacyRaw(wx, 'demo');
      text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (typeof text !== 'string') throw new Error('旧版示例记录无法复制为文字，原内容没有改变。');
    } catch (error) { this.setData({ error: safeMessage(error), notice: '' }); return; }
    if (!await this._confirm('复制旧版示例记录？', '旧版示例空间可能包含你后来填写的资料。本次仅复制其原内容，不合并到本机档案，也不证明内容可恢复。请保存到可信的私人位置。', '确认复制')) return;
    wx.setClipboardData({ data: text,
      success: () => this.setData({ notice: '旧版示例记录已复制，请另存为私人备份。本机档案没有改变。', error: '' }),
      fail: () => this.setData({ error: '复制未完成，旧版记录仍保留在本机。', notice: '' })
    });
  },

  _resetImport() {
    this._importDb = null;
    this._importTextSnapshot = null;
    this.setData({ importText: '', importPreview: null, importConfirmed: false });
  },

  onImportInput(event) {
    this._importDb = null;
    this._importTextSnapshot = null;
    this.setData({ importText: event.detail.value, importPreview: null, importConfirmed: false, error: '', notice: '' });
  },

  onCheckImport() {
    try {
      const db = core.importDatabase(this.data.importText);
      this._importDb = db;
      this._importTextSnapshot = this.data.importText;
      this.setData({ importPreview: {
        students: db.students.length, scores: db.scores.length, tags: db.tags.length, plans: db.plans.length, categories: (db.categories || []).length,
        currentStudents: this._db ? this._db.students.length : '无法读取'
      }, importConfirmed: false, error: '', notice: '备份格式检查通过，尚未恢复。请核对内容与数量。' });
    } catch (error) {
      this._importDb = null;
      this.setData({ importPreview: null, importConfirmed: false, error: '未恢复：' + safeMessage(error), notice: '' });
    }
  },

  onImportAgree(event) { this.setData({ importConfirmed: event.detail.value.indexOf('replace') !== -1 }); },

  async onApplyImport() {
    if (!this._importDb || this._importTextSnapshot !== this.data.importText || !this.data.importConfirmed) {
      this.setData({ error: '请先检查备份，并确认完整替换本机档案。' }); return;
    }
    const space = this._space, token = this._diskToken;
    const next = clone(this._importDb);
    next.revision = this._db ? this._db.revision + 1 : 1;
    const count = next.students.length;
    if (!await this._confirm('完整替换' + labelFor(space) + '？',
      '恢复后本机档案将变为备份里的 ' + count + ' 份学员档案、' + next.categories.length + ' 个分类及关联记录，现有内容不会合并。若还未导出原档案，请取消并先备份。', '确认替换')) return;
    try {
      if (space !== this._space || token !== this._diskToken) throw new Error('当前档案已变化，请重新检查备份。');
      this._writeDatabase(next, space);
      this._resetImport();
      this.setData({ student: null, view: 'list', query: '', listFilter: 'all', groupKey: '', scoreSubjectValue: null, notice: '已恢复到' + labelFor(space) + '，请核对学员与记录。', error: '' });
      this._render();
    } catch (error) { this.setData({ error: safeMessage(error), notice: '' }); }
  },

  async onReload() {
    if (!await this._confirm('重新读取本地档案？', '将读取设备当前保存的内容。未提交的导入文字会清空；已保存的记录不会被删除。', '重新读取')) return;
    this._loadSpace(this._space);
  }
});
