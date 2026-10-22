(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StudentCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  var VERSION = 4;
  var MAX_JSON = 2 * 1024 * 1024;
  var CAPACITY = { categories: 100, students: 500, scores: 10000, tags: 10000, plans: 5000 };
  var TABLES = ['categories', 'students', 'scores', 'tags', 'plans'];
  var TITLES = { categories: '分类', students: '学员', scores: '成绩', tags: '标签', plans: '计划' };
  var sequence = 0;
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  function fail(message) { throw new Error(message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '必须是对象');
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(label + '格式不正确');
    return value;
  }
  function field(value, key) {
    var descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!own(descriptor, 'value')) fail('数据不能包含动态读取字段');
    return descriptor.value;
  }
  function text(value, label, max, required) {
    if (typeof value !== 'string') fail(label + '必须是文字');
    if (value.length > max) fail(label + '最多 ' + max + ' 个字符');
    var clean = value.trim();
    if (required && !clean) fail('请填写' + label);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) fail(label + '含有不支持的控制字符');
    return clean;
  }
  function optional(input, key, fallback, saving) {
    var value = field(input, key);
    return value === undefined && saving ? fallback : value;
  }
  function id(value, label) { return text(value, label || '记录编号', 100, true); }
  function choice(value, choices, label) {
    if (choices.indexOf(value) === -1) fail(label + '不正确，请重新选择');
    return value;
  }
  function date(value, label, blank) {
    if (blank && value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(label + '请使用 年-月-日 格式');
    var year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(label + '不是实际存在的日期');
    return value;
  }
  function number(value, label, saving) {
    if (saving && typeof value === 'string') {
      var trimmed = value.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) fail(label + '请填写有效数字，不能留空');
      value = Number(trimmed);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(label + '必须是有限数字');
    return value === 0 ? 0 : value;
  }
  function evidence(value) {
    if (!Array.isArray(value) || value.length > 30) fail('证据快照必须是最多 30 条的文字列表');
    var result = [];
    for (var index = 0; index < value.length; index += 1) result.push(text(field(value, String(index)), '单条证据', 500, true));
    return result;
  }
  function subject(input, previousSubject) {
    var value = field(input, 'subject');
    if (value === undefined) value = previousSubject === undefined ? '' : previousSubject;
    return text(value, '科目', 50, false).replace(/\s+/g, ' ');
  }
  function record(table, input, saving, recordId, previous, inputVersion, defaultTotal) {
    object(input, TITLES[table]);
    var result = { id: recordId === undefined ? id(field(input, 'id')) : recordId };
    if (table === 'categories') {
      if (result.id === 'unassigned') fail('分类编号 unassigned 为未分类保留，请更换分类编号');
      result.name = text(field(input, 'name'), '分类名称', 50, true).replace(/\s+/g, ' ');
      result.total = number(field(input, 'total'), '分类默认满分', saving);
      if (result.total <= 0 || result.total > 1000000) fail('分类默认满分须大于 0 且不超过 1000000');
    } else if (table === 'students') {
      result.name = text(field(input, 'name'), '学员称呼', 100, true);
      result.grade = text(optional(input, 'grade', '', saving), '年级', 100, false);
      result.className = text(optional(input, 'className', previous ? previous.className : '', saving), '班级', 100, false);
      result.note = text(optional(input, 'note', '', saving), '学员备注', 2000, false);
      result.subject = inputVersion < 3 ? '' : text(optional(input, 'subject', previous ? previous.subject : '', saving), '学员学科', 50, false).replace(/\s+/g, ' ');
      result.isExample = inputVersion < 3 ? false : optional(input, 'isExample', previous ? previous.isExample : false, saving);
      if (typeof result.isExample !== 'boolean') fail('示例标记必须明确为是或否');
      result.categoryId = inputVersion < 4 ? '' : text(optional(input, 'categoryId', previous ? previous.categoryId : '', saving), '所属分类编号', 100, false);
    } else {
      result.studentId = id(field(input, 'studentId'), '所属学员');
      if (table === 'scores') {
        result.subject = subject(input, previous ? previous.subject : undefined);
        result.title = text(field(input, 'title'), '考试名称', 200, true);
        result.date = date(field(input, 'date'), '考试日期', false);
        result.score = number(field(input, 'score'), '得分', saving);
        result.total = number(optional(input, 'total', defaultTotal, saving), '满分', saving);
        if (result.total <= 0 || result.score < 0 || result.score > result.total) fail('满分须大于 0，得分须在 0 与满分之间');
        result.note = text(optional(input, 'note', '', saving), '成绩备注', 2000, false);
      } else if (table === 'tags') {
        result.subject = subject(input, previous ? previous.subject : undefined);
        result.type = choice(field(input, 'type'), ['weak', 'strong', 'habit'], '标签类型');
        result.label = text(field(input, 'label'), '标签名称', 80, true).replace(/\s+/g, ' ');
        result.note = text(optional(input, 'note', '', saving), '标签备注', 2000, false);
        result.observedOn = date(field(input, 'observedOn'), '观察日期', false);
        result.status = choice(optional(input, 'status', 'active', saving), ['active', 'resolved'], '标签状态');
      } else {
        result.title = text(field(input, 'title'), '计划标题', 200, true);
        result.body = text(field(input, 'body'), '计划内容', 8000, true);
        result.dueDate = date(optional(input, 'dueDate', '', saving), '跟进日期', true);
        result.status = choice(optional(input, 'status', 'todo', saving), ['todo', 'done'], '计划状态');
        result.result = text(optional(input, 'result', '', saving), '跟进结果', 4000, false);
        result.sourceEvidence = evidence(optional(input, 'sourceEvidence', [], saving));
      }
    }
    return result;
  }
  function labelKey(label) {
    var normalized = typeof label.normalize === 'function' ? label.normalize('NFKC') : label;
    return normalized.replace(/\s+/g, '').toLowerCase();
  }
  function validateDatabase(input) {
    object(input, '档案');
    var inputVersion = field(input, 'schemaVersion');
    if (inputVersion !== 1 && inputVersion !== 2 && inputVersion !== 3 && inputVersion !== VERSION) fail('档案版本不兼容，仅支持版本 1、2、3 和 4；旧版本会自动升级');
    var revision = field(input, 'revision');
    if (!Number.isSafeInteger(revision) || revision < 0) fail('档案修订号必须是非负安全整数');
    var clean = { schemaVersion: VERSION, revision: revision, categories: [], students: [], scores: [], tags: [], plans: [] };
    var ids = new Set();
    TABLES.forEach(function (table) {
      var rows = table === 'categories' && inputVersion < 4 ? [] : field(input, table);
      if (!Array.isArray(rows)) fail(TITLES[table] + '记录必须是列表');
      if (rows.length > CAPACITY[table]) fail(TITLES[table] + '记录最多 ' + CAPACITY[table] + ' 条，请先整理或导出');
      // Indexed iteration also rejects holes in caller-created arrays.
      for (var index = 0; index < rows.length; index += 1) {
        var row = record(table, field(rows, String(index)), false, undefined, undefined, inputVersion);
        if (ids.has(row.id)) fail('记录编号重复，请检查导入档案');
        ids.add(row.id);
        clean[table].push(row);
      }
    });
    var categoryIds = new Set(), categoryNames = new Set();
    clean.categories.forEach(function (category) {
      var nameKey = labelKey(category.name);
      if (categoryNames.has(nameKey)) fail('已有同名分类，请编辑原分类或使用不同名称');
      categoryNames.add(nameKey);
      categoryIds.add(category.id);
    });
    clean.students.forEach(function (student) {
      if (student.categoryId && !categoryIds.has(student.categoryId)) fail('学员找不到所属分类，请重新选择分类或移至未分类');
    });
    var students = new Map(clean.students.map(function (student) { return [student.id, student]; }));
    ['scores', 'tags', 'plans'].forEach(function (table) {
      clean[table].forEach(function (row) {
        if (!students.has(row.studentId)) fail(TITLES[table] + '记录找不到所属学员，不能保存孤立记录');
      });
    });
    // Only legacy imports derive the archive subject, and only from explicitly
    // recorded subjects. Version 3+ choices must not be re-derived.
    if (inputVersion < 3) {
      var known = new Map();
      ['scores', 'tags'].forEach(function (table) {
        clean[table].forEach(function (row) {
          if (!row.subject) return;
          var values = known.get(row.studentId) || new Map();
          var key = labelKey(row.subject);
          if (!values.has(key)) values.set(key, row.subject);
          known.set(row.studentId, values);
        });
      });
      clean.students.forEach(function (student) {
        var values = known.get(student.id);
        if (values && values.size === 1) student.subject = values.values().next().value;
      });
    }
    ['scores', 'tags'].forEach(function (table) {
      clean[table].forEach(function (row) {
        var owner = students.get(row.studentId);
        if (owner.subject && row.subject && labelKey(owner.subject) !== labelKey(row.subject)) {
          fail('学员档案学科与已有' + TITLES[table] + '科目不一致，请先整理不同科目的历史记录，不能自动改写');
        }
      });
    });
    var active = new Map();
    clean.tags.forEach(function (tag) {
      if (tag.status !== 'active') return;
      var key = JSON.stringify([tag.studentId, labelKey(tag.subject), labelKey(tag.label)]);
      var types = active.get(key) || new Set();
      if (types.has(tag.type)) fail('同一学员在同一科目已有这个有效标签，请编辑原标签');
      if ((tag.type === 'weak' && types.has('strong')) || (tag.type === 'strong' && types.has('weak'))) fail('同一科目的同一知识点不能同时标为薄弱和强项，请先调整或解除旧标签');
      types.add(tag.type);
      active.set(key, types);
    });
    if (JSON.stringify(clean).length > MAX_JSON) fail('档案内容超过本地容量上限，请先导出并整理');
    return clean;
  }
  function newId(db, table) {
    var ids = new Set();
    TABLES.forEach(function (key) { db[key].forEach(function (row) { ids.add(row.id); }); });
    var result;
    do {
      sequence += 1;
      result = (table === 'categories' ? 'category' : table.slice(0, -1)) + '_' + Date.now().toString(36) + '_' + sequence.toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    } while (ids.has(result));
    return result;
  }
  function nextRevision(db) {
    if (db.revision >= Number.MAX_SAFE_INTEGER) fail('档案修订号已达上限，暂时无法继续保存');
    db.revision += 1;
  }
  function save(table, inputDb, input) {
    var db = validateDatabase(inputDb);
    object(input, TITLES[table]);
    var supplied = field(input, 'id');
    var recordId = supplied === undefined ? newId(db, table) : id(supplied);
    var index = supplied === undefined ? -1 : db[table].findIndex(function (row) { return row.id === recordId; });
    if (supplied !== undefined && index < 0) fail('要编辑的' + TITLES[table] + '不存在，请重新打开记录');
    var previous = index >= 0 ? db[table][index] : undefined;
    var defaultTotal;
    if (!previous && table === 'scores') {
      var parentId = field(input, 'studentId');
      previous = db.students.find(function (student) { return student.id === parentId; });
      if (previous && previous.categoryId) {
        var category = db.categories.find(function (row) { return row.id === previous.categoryId; });
        defaultTotal = category.total;
      }
    }
    var next = record(table, input, true, recordId, previous, undefined, defaultTotal);
    if (index >= 0 && ['scores', 'tags', 'plans'].indexOf(table) !== -1 && next.studentId !== db[table][index].studentId) fail('已有记录不能改挂到其他学员，请在正确学员下另建记录');
    if (index < 0) db[table].push(next);
    else db[table][index] = next;
    nextRevision(db);
    return validateDatabase(db);
  }
  function remove(table, inputDb, recordId) {
    var db = validateDatabase(inputDb);
    recordId = id(recordId);
    if (!db[table].some(function (row) { return row.id === recordId; })) fail('要删除的' + TITLES[table] + '不存在，请重新打开记录');
    if (table === 'categories' && db.students.some(function (student) { return student.categoryId === recordId; })) fail('该分类仍有学员，请先将学员移出分类，再删除分类');
    db[table] = db[table].filter(function (row) { return row.id !== recordId; });
    if (table === 'students') {
      ['scores', 'tags', 'plans'].forEach(function (key) {
        db[key] = db[key].filter(function (row) { return row.studentId !== recordId; });
      });
    }
    nextRevision(db);
    return validateDatabase(db);
  }
  function localDate(value) {
    return String(value.getFullYear()).padStart(4, '0') + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }
  function today() { return localDate(new Date()); }
  function relativeDate(days) {
    var value = new Date();
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + days);
    return localDate(value);
  }
  function createDatabase(demo) {
    if (demo !== undefined && typeof demo !== 'boolean') fail('示例模式必须明确为是或否');
    var db = { schemaVersion: VERSION, revision: 0, categories: [], students: [], scores: [], tags: [], plans: [] };
    if (!demo) return db;
    db.categories = [
      { id: 'demo-category-primary', name: '小学英语', total: 100 },
      { id: 'demo-category-middle', name: '初中英语', total: 120 },
      { id: 'demo-category-high', name: '高中英语', total: 150 }
    ];
    var groups = [
      ['四年级', 0], ['五年级', 0], ['五年级', 0], ['六年级', 0],
      ['七年级', 1], ['八年级', 1], ['九年级', 1],
      ['高一', 2], ['高二', 2], ['高三', 2]
    ];
    var marks = [[62, 70, 68, 76], [82, 79, 85, 87], [66, 72, 71, 79], [88, 84, 89, 86], [58, 65, 63, 72], [76, 81, 78, 84], [71, 75, 73, 80], [63, 69, 67, 74], [84, 81, 86, 89], [73, 77, 76, 82]];
    var days = [-21, -14, -7, -2];
    groups.forEach(function (group, index) {
      var suffix = String.fromCharCode(97 + index);
      var studentId = 'demo-student-' + suffix;
      var category = db.categories[group[1]];
      db.students.push({ id: studentId, name: '示例学员 ' + suffix.toUpperCase() + '（虚构）', grade: group[0], className: '', note: '这是可编辑、可删除的虚构示例，不是真实学生资料。', subject: '英语', isExample: true, categoryId: category.id });
      days.forEach(function (offset, scoreIndex) {
        db.scores.push({ id: 'demo-score-' + suffix + (scoreIndex + 1), studentId: studentId, subject: '英语', title: '示例英语练习 ' + (scoreIndex + 1), date: relativeDate(offset), score: Math.round(marks[index][scoreIndex] * category.total) / 100, total: category.total, note: '虚构记录；不同练习难度可能不同，不据此判断能力或教学效果。' });
      });
    });
    db.tags = [
      { id: 'demo-tag-a1', studentId: 'demo-student-a', subject: '英语', type: 'weak', label: '词汇拼写', note: '虚构观察：本次能认读部分小学已学词，遮住后拼写还需要提示。材料由老师按实际进度选择。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-b1', studentId: 'demo-student-b', subject: '英语', type: 'strong', label: '词汇运用', note: '虚构观察：本次能用已学词汇说出简单句，仍需老师换熟悉情境复看。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-c1', studentId: 'demo-student-c', subject: '英语', type: 'weak', label: '一般现在时', note: '虚构观察：在老师选定的已学短句中，主语与动词形式仍需核对。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-d1', studentId: 'demo-student-d', subject: '英语', type: 'strong', label: '阅读信息定位', note: '虚构观察：本次能在已学短文中找到原文依据，仍需老师换问题复看。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-e1', studentId: 'demo-student-e', subject: '英语', type: 'habit', label: '英语练习后检查', note: '虚构观察：可尝试提交前核对题号、拼写与漏答。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-f1', studentId: 'demo-student-f', subject: '英语', type: 'weak', label: '阅读理解', note: '虚构观察：在老师选定的已学篇章中，概括段落时仍需回到原文标出依据。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-h1', studentId: 'demo-student-h', subject: '英语', type: 'weak', label: '篇章阅读', note: '虚构观察：需要结合已学篇章，用原文支持对段落关系的解释。', observedOn: relativeDate(-2), status: 'active' },
      { id: 'demo-tag-i1', studentId: 'demo-student-i', subject: '英语', type: 'strong', label: '写作表达', note: '虚构观察：本次能用已学句式表达观点，仍需教师换题复看。', observedOn: relativeDate(-2), status: 'active' }
    ];
    db.plans = [{ id: 'demo-plan-a1', studentId: 'demo-student-a', title: '示例（英语）：词汇拼写短练习与复看', body: '从已学英语材料挑选 5 个词，先读音义，再遮住单词回忆拼写；留下不确定的 1–2 个，下次课再试并记录具体困难。', dueDate: relativeDate(3), status: 'todo', result: '', sourceEvidence: ['虚构示例：老师在 ' + relativeDate(-2) + ' 记录了英语科目的词汇拼写标签。'] }];
    return validateDatabase(db);
  }
  function addExampleStudents(inputDb) {
    // Merge on a validated clone so even a capacity or revision error is atomic.
    var db = validateDatabase(inputDb);
    if (db.students.some(function (student) { return student.isExample; })) fail('档案里已有示例学员，请直接查看、编辑或删除');
    var seed = createDatabase(true), categoryMap = new Map(), studentMap = new Map();
    seed.categories.forEach(function (source) {
      var target = db.categories.find(function (category) { return labelKey(category.name) === labelKey(source.name); });
      if (!target) {
        target = Object.assign({}, source, { id: newId(db, 'categories') });
        db.categories.push(target);
      }
      categoryMap.set(source.id, target);
    });
    seed.students.forEach(function (source) {
      var target = Object.assign({}, source, { id: newId(db, 'students'), categoryId: categoryMap.get(source.categoryId).id });
      db.students.push(target);
      studentMap.set(source.id, { id: target.id, category: categoryMap.get(source.categoryId) });
    });
    ['scores', 'tags', 'plans'].forEach(function (table) {
      seed[table].forEach(function (source) {
        var student = studentMap.get(source.studentId);
        var target = Object.assign({}, source, { id: newId(db, table), studentId: student.id });
        if (table === 'scores') {
          target.total = student.category.total;
          target.score = Math.min(target.total, Math.round(source.score / source.total * target.total * 100) / 100);
        }
        db[table].push(target);
      });
    });
    nextRevision(db);
    return validateDatabase(db);
  }
  function brief(note) { return note ? '；教师备注：' + note.slice(0, 160) + (note.length > 160 ? '…' : '') : ''; }
  function tagEvidence(tag) {
    var types = { weak: '薄弱观察', strong: '强项观察', habit: '学习习惯观察' };
    return '【' + (tag.subject || '通用') + '】' + types[tag.type] + '「' + tag.label + '」（' + tag.observedOn + '）' + brief(tag.note);
  }
  function weakAction(label, subjectName) {
    var scope = labelKey(subjectName);
    var english = /^(小学|初中|高中|大学)?(英语|英文)$/.test(scope) || /^(english|englishlanguage)$/.test(scope);
    var language = english || /^(小学|初中|高中|大学)?语文$/.test(scope) || /^(chinese|chineselanguage)$/.test(scope);
    var math = /^(小学|初中|高中|大学)?数学$/.test(scope) || /^(math|maths|mathematics)$/.test(scope);
    if (math) {
      if (/方程|不等式|代数|未知数|equation|algebra/i.test(label)) return '从已学材料选 3 道同类题，先写出等量或大小关系，再逐步变形并说出依据；把结果代回原题检查。下次换一个数再试，记录在哪一步需要提示。';
      if (/函数|图像|坐标|function|graph/i.test(label)) return '选一个已学关系，列出 3 组对应数值并在坐标图上标点，让学员解释图上的一个点；换一个输入值再核对，记录数值、式子与图像能否对应。';
      if (/几何|图形|三角|角|面积|周长|geometry/i.test(label)) return '选 2 道已学图形题，先画图并标出已知量与待求量，再列式、写单位；请学员说清所用条件。下次改变一个条件复看，记录具体卡住的步骤。';
      if (/分数|小数|百分|fraction|decimal|percent/i.test(label)) return '选 3 道同类短题，先说清数表示的份量，再写出每一步运算依据；用图示或估算核对结果范围。下次换 1 道相近题，记录是否仍需要相同步骤提示。';
      if (/应用|文字题|解决问题|比例|比值|wordproblem|ratio/i.test(label)) return '选 2 道已学情境题，先分别写出已知条件和要解决的问题，画出数量关系再列式；核对单位与结果是否符合题意，下次换一个条件复看。';
      if (/计算|运算|口算|乘|除|加减|正负|calculate|arithmetic/i.test(label)) return '选 3 道相关计算题，先检查符号与运算顺序，再逐步计算；用估算或逆运算核对结果。只记录本次出错的步骤，下次换数字再试。';
      return '从已学材料选 3 道相关数学短题，让学员先说已知条件与待求量，再列式或画图并说明一步依据；下次换 1 道相近题，核对仍需哪一步提示。';
    }
    if (english && /单词|词汇|拼写|vocab|spell/i.test(label)) return '从已学材料选 5 个相关词，先读音义，再遮住单词回忆拼写；把不确定的 1–2 个留下，下次课再试一次。记录具体错在哪里。';
    if (english && /时态|过去|现在|将来|三单|语法|动词|tense|grammar/i.test(label)) return '从已学材料选 3 个相关短句，让学员先圈时间或主语提示，再选择形式并说一句理由；下次换 1 个相近句子复看。记录需要哪一步提示。';
    if (language && /阅读|理解|read/i.test(label)) return '选一段已经学过的短文和 3 个相关问题，先定位关键词，再划出原文依据并说明答案；下次换 1 个问题复看。记录能否找到依据。';
    if (language && /听力|listen/i.test(label)) return '选已学材料中的一段短音频，先听关键词，第二遍核对一处信息；对照原文后再听一次。只记录本次听到与遗漏的内容，下次换一句复看。';
    if (language && /写作|作文|句子|write|writing/i.test(label)) return '围绕已学话题写 3–5 句，先核对是否表达完整，再集中检查一类相关问题；让学员修改 1 句并说明改动，下次保留一处相同检查。';
    return '从已学材料选 3 道与该标签相关的短题，先让学员独立尝试，再针对具体卡住的一步给提示；下次换 1 道相近题复看，记录是否仍需同样提示。';
  }
  function habitAction(label) {
    if (/检查|审题|漏|粗心|细心/.test(label)) return '约定提交前用 1 分钟核对题号、题目要求和漏答；这次只记录是否执行以及发现了什么，连续观察 2–3 次再调整，不给学员贴性格结论。';
    if (/作业|拖延|时间|专注/.test(label)) return '与学员约定一个可完成的小段：开始前写下本次一件事，专注做 5 分钟后自查；记录实际开始、完成和卡住的位置，下次一起调整长度。';
    return '把这个观察改写成一个看得见的小动作，与学员约定在本次练习的哪个环节做；结束后只记录是否做到了及需要什么支持，连续观察 2–3 次再调整。';
  }
  function byRecent(fieldName) {
    return function (a, b) {
      if (a[fieldName] !== b[fieldName]) return a[fieldName] < b[fieldName] ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    };
  }
  function rate(score) { return String(Math.round(score.score / score.total * 1000) / 10) + '%'; }
  function scoreEvidence(score) { return '【' + (score.subject || '未分类') + '】成绩「' + score.title + '」（' + score.date + '）：' + score.score + '/' + score.total + '，得分率 ' + rate(score); }
  function suggestions(inputDb, studentId, referenceDay) {
    var db = validateDatabase(inputDb);
    studentId = id(studentId, '所属学员');
    if (!db.students.some(function (student) { return student.id === studentId; })) fail('找不到该学员，请重新选择');
    var day = referenceDay === undefined ? today() : date(referenceDay, '参考日期', false);
    var tags = db.tags.filter(function (tag) { return tag.studentId === studentId && tag.status === 'active' && tag.observedOn <= day; }).sort(byRecent('observedOn'));
    var scores = db.scores.filter(function (score) { return score.studentId === studentId && score.date <= day; }).sort(byRecent('date'));
    var result = [];
    ['weak', 'strong', 'habit'].forEach(function (type) {
      tags.filter(function (tag) { return tag.type === type; }).slice(0, 3).forEach(function (tag) {
        var body, title;
        var prefix = '【' + (tag.subject || '通用') + '】';
        if (type === 'weak') { title = prefix + '小步练习：' + tag.label; body = '针对老师记录的' + prefix + '「' + tag.label + '」，' + weakAction(tag.label, tag.subject); }
        else if (type === 'strong') { title = prefix + '巩固与迁移：' + tag.label; body = '老师把' + prefix + '「' + tag.label + '」记为强项。先请学员解释 1 个已完成的例子，再换 1 个相近情境尝试；用这项熟悉的方法支持一个当前练习，记录能否独立完成，暂不把单次表现当作稳定掌握。'; }
        else { title = prefix + '一起试一个习惯：' + tag.label; body = '围绕老师记录的' + prefix + '「' + tag.label + '」，' + habitAction(tag.label); }
        result.push({ key: 'tag-' + tag.id, title: title, body: body, evidence: [tagEvidence(tag)] });
      });
    });
    if (scores.length) {
      var groups = new Map();
      scores.forEach(function (score) {
        var scope = labelKey(score.subject);
        if (!groups.has(scope)) groups.set(scope, []);
        groups.get(scope).push(score);
      });
      // List the three most recently observed subject groups, never compare across them.
      Array.from(groups.values()).slice(0, 3).forEach(function (group) {
        var latest = group[0], knownSubject = !!latest.subject;
        var prefix = '【' + (latest.subject || '未分类') + '】';
        var explanation = !knownSubject ? '这些记录尚未标注科目，当前仅回看这一份，不做前后比较；请先补充科目。' : group.length > 1 ? '同科另一份记录的得分率为 ' + rate(group[1]) + '；不同考试的难度与范围可能不同，不据此判断能力变化或教学效果。' : '单次总分不能说明具体知识点是否掌握。';
        result.push({ key: 'score-' + latest.id, title: prefix + '回看最近一次考试的具体题目', body: prefix + '最近记录「' + latest.title + '」的得分率为 ' + rate(latest) + '。' + explanation + '先对照原卷挑出 1–2 处具体表现，核实后再补充标签和下一次小练习。', evidence: group.slice(0, knownSubject ? 2 : 1).map(scoreEvidence) });
      });
    }
    if (!tags.length && !scores.length) {
      result.push({ key: 'observe-' + studentId, title: '先补充一条可以核对的观察', body: '先记录一次真实考试的得分与满分，或观察一项具体课堂表现并注明日期。写清学员做了什么、需要哪一步提示，再决定是否建立薄弱、强项或习惯标签；暂不推断能力。', evidence: ['截至 ' + day + '，该学员尚无可用于建议的成绩或有效标签记录。'] });
    }
    var due = db.plans.filter(function (plan) { return plan.studentId === studentId && plan.status === 'todo' && plan.dueDate && plan.dueDate <= day; }).sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0; });
    if (due.length) result.push({ key: 'followup-' + studentId, title: '回看已到跟进日期的计划', body: '有 ' + due.length + ' 条计划到了约定跟进日期。先和学员核对「' + due[0].title + '」实际做了什么，记录完成情况与需要的支持；未完成可调整内容或日期，不把逾期等同于学习态度。', evidence: due.slice(0, 3).map(function (plan) { return '待跟进计划「' + plan.title + '」，约定日期 ' + plan.dueDate; }) });
    return result;
  }
  function exportDatabase(db) { return JSON.stringify(validateDatabase(db), null, 2); }
  function importDatabase(value) {
    if (typeof value !== 'string') fail('请提供 JSON 格式的档案文字');
    if (!value.trim()) fail('导入内容为空');
    // Pretty-printed exports can be larger than their compact canonical form.
    if (value.length > MAX_JSON * 2) fail('导入内容过大，请选择本工具导出的适量档案');
    var parsed;
    try { parsed = JSON.parse(value); } catch (_) { fail('导入内容不是有效 JSON，原档案不会改变'); }
    return validateDatabase(parsed);
  }

  return Object.freeze({
    createDatabase: createDatabase,
    addExampleStudents: addExampleStudents,
    saveCategory: function (db, input) { return save('categories', db, input); },
    removeCategory: function (db, recordId) { return remove('categories', db, recordId); },
    saveStudent: function (db, input) { return save('students', db, input); },
    deleteStudent: function (db, recordId) { return remove('students', db, recordId); },
    saveScore: function (db, input) { return save('scores', db, input); },
    deleteScore: function (db, recordId) { return remove('scores', db, recordId); },
    saveTag: function (db, input) { return save('tags', db, input); },
    deleteTag: function (db, recordId) { return remove('tags', db, recordId); },
    savePlan: function (db, input) { return save('plans', db, input); },
    deletePlan: function (db, recordId) { return remove('plans', db, recordId); },
    suggestions: suggestions, validateDatabase: validateDatabase,
    exportDatabase: exportDatabase, importDatabase: importDatabase, today: today
  });
});
