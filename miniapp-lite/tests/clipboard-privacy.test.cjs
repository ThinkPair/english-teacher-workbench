'use strict';
// Synthetic callback tests only: never connects to WeChat or reads real storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/core.js');
const { harness, KEY, PERSONAL, DEMO, snapshot, legacy } = require('./qa-native-harness.cjs');

function fixture(kind) {
  const h = harness({
    [KEY]: kind === 'raw' ? 'SYNTHETIC_CORRUPT_ARCHIVE' : core.exportDatabase(core.createDatabase(true)),
    [PERSONAL]: snapshot(legacy()),
    [DEMO]: 'SYNTHETIC_OLD_DEMO_WITH_USER_ADDITIONS'
  });
  h.page.onLoad();
  h.run('globalThis.qaClipboardPending = []; wx.setClipboardData = options => qaClipboardPending.push(options);');
  return h;
}

const methods = { normal: 'onExport', raw: 'onCopyRaw', legacy: 'onExportLegacyDemo' };
for (const [kind, method] of Object.entries(methods)) {
  for (const errno of [103, 104]) {
    test(`${kind} export: success, privacy rejection ${errno}, success clears opposing messages without changing records`, async () => {
      const h = fixture(kind);
      const storedBefore = snapshot([...h.store]);
      const databaseBefore = snapshot(h.page._db);
      const writesBefore = h.state.writes.length;
      const assertUnchanged = () => {
        assert.equal(snapshot([...h.store]), storedBefore, 'current and legacy storage must stay unchanged');
        assert.equal(snapshot(h.page._db), databaseBefore, 'in-memory records and revision must stay unchanged');
        assert.equal(h.state.writes.length, writesBefore, 'copying must not persist an archive');
      };
      const invoke = async () => {
        const modalCount = h.state.modals.length;
        await h.page[method]();
        assert.equal(h.state.modals.length, modalCount + 1, 'every export must retain the explicit confirmation');
        assert.equal(h.run('qaClipboardPending.length'), 1, 'confirmation must reach exactly one clipboard call');
        assertUnchanged();
      };

      // Include an existing error so a successful retry must clear it, even on
      // the recovery screen where onLoad may already have reported bad data.
      h.page.setData({ error: 'SYNTHETIC_PREVIOUS_COPY_ERROR', notice: '' });
      await invoke();
      const exportedText = h.run('qaClipboardPending[0].data');
      assert.equal(typeof exportedText, 'string');
      h.run("qaClipboardPending.shift().success({errMsg: 'setClipboardData:ok'});");
      assert.match(h.page.data.notice, /已复制/);
      assert.equal(h.page.data.error, '', 'success must remove the previous failure message');
      assertUnchanged();

      await invoke();
      assert.equal(h.run('qaClipboardPending[0].data'), exportedText);
      h.run(`qaClipboardPending.shift().fail({errno: ${errno}, errMsg: 'setClipboardData:fail privacy authorization denied'});`);
      assert.match(h.page.data.error, /复制未完成|复制失败/);
      assert.equal(h.page.data.notice, '', 'rejection must remove the previous copied-success message');
      assertUnchanged();

      await invoke();
      assert.equal(h.run('qaClipboardPending[0].data'), exportedText);
      h.run("qaClipboardPending.shift().success({errMsg: 'setClipboardData:ok'});");
      assert.match(h.page.data.notice, /已复制/);
      assert.equal(h.page.data.error, '', 'retry success must remove the privacy rejection message');
      assert.equal(h.run('qaClipboardPending.length'), 0);
      assertUnchanged();
    });
  }
}
