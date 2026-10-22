const a = require('miniprogram-automator');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const core = require(root + '/miniprogram/lib/core.js');
const out = path.join(__dirname, 'evidence-0.3.1');
const key = 'student-manager-lite.v3.archive', legacy = 'student-manager-lite.v1.personal';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
(async () => {
  const m = await a.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const mocked = [], errors = [], checks = [];
  const pass = s => { checks.push(s); console.log('PASS', s); };
  const until = async fn => { for (let i = 0; i < 50; i++) { if (await fn()) return; await sleep(250); } throw Error('UI condition timeout'); };
  m.on('exception', e => errors.push(e));
  let p;
  const loadFixture = async fixture => {
    await m.evaluate(value => { getApp().__archiveQA = value; }, fixture);
    p = await m.reLaunch('/pages/index/index');
    await p.waitFor('.composition-card');
    await sleep(600);
  };
  const fixtureDb = () => m.evaluate(() => JSON.parse(getApp().__archiveQA['student-manager-lite.v3.archive']));
  try {
    await until(() => m.evaluate(() => { const app = getApp(); if (!app) return false; app.__archiveQA = {}; return true; }));
    for (const [name, fn] of Object.entries({
      getStorageInfoSync: function () { return { keys: Object.keys(getApp().__archiveQA), currentSize: 0, limitSize: 10240 }; },
      getStorageSync: function (name) { return getApp().__archiveQA[name]; },
      setStorageSync: function (name, value) { getApp().__archiveQA[name] = value; }
    })) { await m.mockWxMethod(name, fn); mocked.push(name); }
    const old = { schemaVersion: 2, revision: 7, students: [], scores: [], tags: [], plans: [] };
    await loadFixture({ [legacy]: JSON.stringify(old) });
    assert.equal(await p.data('totals.records'), 0);
    assert.ok(await p.$('.add-examples-button'));
    await m.screenshot({ path: path.join(out, '01-legacy-empty.png') });
    pass('旧 personal 空档案保留为空，首页可见添加10个示例学员按钮');
    await (await p.$('.add-examples-button')).tap();
    await until(async () => (await p.data('totals.examples')) === 10);
    assert.equal(await p.data('totals.records'), 10);
    assert.equal((await p.data('rows')).length, 4);
    let db = await fixtureDb();
    assert.deepEqual([db.categories.length, db.students.length, db.scores.length, db.tags.length, db.plans.length], [3, 10, 40, 8, 1]);
    assert.equal(db.revision, 8);
    assert.equal(await m.evaluate(() => getApp().__archiveQA['student-manager-lite.v1.personal']), JSON.stringify(old));
    await sleep(1500);
    await m.screenshot({ path: path.join(out, '02-added-examples.png') });
    pass('实际点击后一次追加10学员和40成绩，首类4学员可见，旧源完整保留');
    await p.callMethod('onAddExamples');
    assert.equal((await fixtureDb()).revision, 8);
    assert.equal((await p.$$('.add-examples-button')).length, 0);
    p = await m.reLaunch('/pages/index/index'); await p.waitFor('.composition-card');
    assert.equal(await p.data('totals.examples'), 10);
    assert.equal((await fixtureDb()).students.length, 10);
    pass('重复调用及重启不重复添加，已保存的10名示例保留');
    const tiles = await p.$$('.composition-group');
    await tiles[1].tap();
    await until(async () => (await p.data('selectedGroup.name')) === '初中英语');
    assert.equal((await p.data('rows')).length, 3);
    assert.equal((await p.data('rows'))[0].series.length, 4);
    await sleep(800); await m.screenshot({ path: path.join(out, '03-middle-category.png') });
    pass('切换初中分类显示3学员，各4个成绩点');
    const nav = await p.$$('.bottom-nav .nav-button'); await nav[2].tap();
    await until(async () => (await m.currentPage()).path === 'pages/help/help');
    p = await m.currentPage();
    assert.match(await (await p.$('.help-shell')).text(), /版本 0\.3\.1/);
    pass('使用帮助包含当前0.3.1版本及旧版补充示例说明');
    await loadFixture({ [key]: JSON.stringify(core.createDatabase(false)) });
    assert.equal(await p.data('totals.examples'), 0);
    assert.ok(await p.$('.add-examples-button'));
    pass('删空或当前空库重启不会自动重种，保留主动添加入口');
    let existing = core.createDatabase(false);
    existing = core.saveCategory(existing, { name: '小学英语', total: 60 });
    existing = core.saveStudent(existing, { name: '保留档案（测试虚构）', grade: '五年级', subject: '英语', categoryId: existing.categories[0].id });
    existing = core.saveScore(existing, { studentId: existing.students[0].id, title: '保留成绩（测试虚构）', date: core.today(), score: 48, total: 60 });
    await loadFixture({ [key]: core.exportDatabase(existing) });
    await p.setData({ query: '不存在的检索词', listFilter: 'todo' });
    await p.callMethod('_render');
    await (await p.$('.add-examples-button')).tap();
    await until(async () => (await p.data('totals.examples')) === 10);
    db = await fixtureDb();
    assert.deepEqual(db.students[0], existing.students[0]);
    assert.deepEqual(db.scores[0], existing.scores[0]);
    assert.deepEqual(db.categories[0], existing.categories[0]);
    assert.equal(db.categories.length, 3);
    assert.equal(db.students.length, 11);
    assert.equal(await p.data('query'), '');
    assert.equal(await p.data('listFilter'), 'all');
    assert.equal((await p.data('rows')).length, 5);
    const primaryIds = db.students.filter(s => s.isExample && s.categoryId === existing.categories[0].id).map(s => s.id);
    assert.equal(db.scores.filter(s => primaryIds.includes(s.studentId) && s.total === 60).length, 16);
    await sleep(1000); await m.screenshot({ path: path.join(out, '04-existing-preserved.png') });
    pass('已有学员成绩及同名分类满分原样保留，示例按60分适配且清除隐藏筛选');
    assert.equal(errors.length, 0);
    pass('官方模拟器本轮运行无异常');
    fs.writeFileSync(path.join(out, 'flow-result.json'), JSON.stringify({ version: '0.3.1', at: new Date().toISOString(), complete: true, fixture: 'in-memory synthetic storage; no real storage read or changed', checks, errors }, null, 2));
  } finally {
    for (const name of mocked) await m.restoreWxMethod(name).catch(() => {});
    m.disconnect();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
