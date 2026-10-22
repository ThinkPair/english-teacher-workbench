'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'miniprogram', 'components');
const clone = value => JSON.parse(JSON.stringify(value));

function harness(name, props = {}, settings = {}) {
  let definition;
  const jobs = [], exports = [], frames = [], contexts = [], measurements = [];
  const wx = {
    nextTick: callback => jobs.push(callback),
    getWindowInfo: () => ({ pixelRatio: 2 }),
    canvasToTempFilePath: options => {
      if (settings.exportThrows) throw new Error('synthetic export error');
      exports.push(options);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, name, 'index.js'), 'utf8'), { Component: value => { definition = value; }, wx, JSON, Date, Number, Array, Object });
  const defaults = Object.fromEntries(Object.entries(definition.properties).map(([key, value]) => [key, clone(value.value)]));
  const instance = Object.assign({ data: Object.assign(clone(definition.data), defaults, clone(props)) }, definition.methods);
  instance.setData = update => Object.assign(instance.data, update);
  instance.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; }, exec(callback) {
    if (settings.noNode) { callback([]); return; }
    const log = [], ctx = { log, globalAlpha: 1, _path: [], _dash: [] };
    for (const name of ['scale', 'clearRect']) ctx[name] = (...args) => log.push({ op: name, args });
    ctx.beginPath = () => { ctx._path = []; };
    for (const name of ['moveTo', 'lineTo', 'arc', 'closePath']) ctx[name] = (...args) => ctx._path.push({ op: name, args });
    ctx.setLineDash = values => { ctx._dash = Array.from(values); };
    ctx.stroke = () => log.push({ op: 'stroke', color: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha, dash: [...ctx._dash], path: clone(ctx._path) });
    ctx.fill = () => log.push({ op: 'fill', color: ctx.fillStyle, alpha: ctx.globalAlpha, path: clone(ctx._path) });
    ctx.fillText = (...args) => log.push({ op: 'text', color: ctx.fillStyle, font: ctx.font, args });
    const node = { getContext: () => ctx, requestAnimationFrame: callback => frames.push(callback) };
    const result = [{ node, width: settings.width || 350, height: instance.data.renderHeight || instance.data.height }];
    contexts.push(ctx); measurements.push(node);
    if (settings.deferQuery) jobs.push(() => callback(result)); else callback(result);
  } });
  const flush = () => { let remaining = 100; while (jobs.length || frames.length) { if (!remaining--) throw Error('unexpected infinite draw loop'); while (jobs.length) jobs.shift()(); while (frames.length) frames.shift()(); } };
  return { instance, definition, exports, contexts, measurements, jobs, frames, flush,
    ready() { definition.lifetimes.ready.call(instance); flush(); },
    update(update) { Object.assign(instance.data, clone(update)); instance._schedule(); },
    detach() { definition.lifetimes.detached.call(instance); }
  };
}
const point = (id, date, value) => ({ id, date, title: 'SYNTHETIC_EXAM', score: value, total: 100, value });
const series = (id, color, points, dash = []) => ({ id, name: 'SYNTHETIC_' + id, color, dash, points });
const paths = ctx => ctx.log.filter(item => item.op === 'stroke' && item.width >= 1.5 && item.path.some(part => part.op === 'lineTo') && item.color !== '#E9ECF1');
const dots = ctx => ctx.log.filter(item => item.op === 'stroke' && item.path.some(part => part.op === 'arc'));

test('pie uses count-proportional full-circle sectors, omits zero counts, and subtly offsets the selected category', () => {
  const h = harness('category-pie', { slices: [{ key: 'a', count: 4, color: '#123456' }, { key: 'b', count: 3, color: '#234567' }, { key: 'c', count: 3, color: '#345678' }, { key: 'z', count: 0, color: '#456789' }], selectedKey: 'b' });
  h.ready(); const ctx = h.contexts[0];
  const fills = ctx.log.filter(item => item.op === 'fill'); assert.equal(fills.length, 3);
  const spans = Object.fromEntries(fills.map(item => { const arc = item.path.find(part => part.op === 'arc'); return [item.color, arc.args[4] - arc.args[3]]; }));
  assert.ok(Math.abs(spans['#123456'] / (Math.PI * 2) - 0.4) < 1e-10);
  assert.ok(Math.abs(spans['#234567'] / (Math.PI * 2) - 0.3) < 1e-10);
  assert.ok(ctx.log.filter(item => item.op === 'stroke').every(item => item.color === '#FFFFFF' && item.width === 1.5));
  for (const fill of fills) {
    const arc = fill.path.find(part => part.op === 'arc').args;
    assert.equal(arc[2], 67, 'selection does not enlarge area or cut an inner hole');
    const offset = fill.color === '#234567' ? 2.5 : 0, midAngle = (arc[3] + arc[4]) / 2;
    assert.ok(Math.abs(arc[0] - (175 + Math.cos(midAngle) * offset)) < 1e-10);
    assert.ok(Math.abs(arc[1] - (75 + Math.sin(midAngle) * offset)) < 1e-10);
  }
  assert.equal(h.exports.length, 1); assert.equal(h.measurements[0].width, 700);
});

test('zero pie stays neutral without fabricated full disk or PNG export', () => {
  const h = harness('category-pie', { slices: [{ key: 'a', count: 0 }, { key: 'b', count: -1 }, { key: 'c', count: null }] });
  h.ready(); assert.equal(h.instance.data.hasData, false); assert.equal(h.instance.data.chartBusy, false); assert.equal(h.contexts.length, 0); assert.equal(h.exports.length, 0);
});

test('single pie category is a disk without a misleading radial split', () => {
  const h = harness('category-pie', { slices: [{ key: 'a', count: 7, color: '#123456' }], selectedKey: 'a' }); h.ready();
  const fill = h.contexts[0].log.find(item => item.op === 'fill'); assert.ok(fill.path.some(part => part.op === 'arc')); assert.ok(!fill.path.some(part => part.op === 'moveTo'));
  assert.deepEqual(fill.path.find(part => part.op === 'arc').args.slice(0, 2), [175, 75]);
});

test('all cohort series render, with shared true-date x and unchanged 0..max y', () => {
  const input = Array.from({ length: 12 }, (_, i) => series('S' + i, '#' + (0x110000 + i * 0x010101).toString(16), [point('P' + i, '2026-10-01', 20 + i), point('Q' + i, '2026-10-11', 60 + i)], [4, 2]));
  const h = harness('group-lines', { series: input, max: 100, unit: '%' }); h.ready();
  assert.equal(paths(h.contexts[0]).length, 12, 'no default first-three/first-N truncation'); assert.equal(dots(h.contexts[0]).length, 24);
  assert.ok(paths(h.contexts[0]).every(item => item.dash.join(',') === '4,2'));
  assert.ok(h.contexts[0].log.some(item => item.op === 'text' && item.args[0] === '100'));
});

test('date distances are proportional, same-day values share x, and inputs remain untouched', () => {
  const input = [series('A', '#123456', [point('c', '2026-10-11', 80), point('b', '2026-10-02', 50), point('a', '2026-10-01', 40)]), series('B', '#234567', [point('d', '2026-10-02', 30)])];
  const before = clone(input), h = harness('group-lines', { series: input }); h.ready();
  const line = paths(h.contexts[0])[0].path, xs = line.map(item => item.args[0]);
  assert.ok(Math.abs((xs[1] - xs[0]) / (xs[2] - xs[0]) - 0.1) < 1e-10);
  const single = dots(h.contexts[0]).filter(item => item.color === '#234567')[0].path.find(item => item.op === 'arc'); assert.equal(single.args[0], xs[1]);
  assert.deepEqual(input, before);
});

test('single points have no fabricated line and missing/invalid dates are not zero scores', () => {
  const h = harness('group-lines', { series: [series('A', '#123456', [point('a', '2026-10-01', 50)]), series('B', '#234567', []), series('C', '#345678', [point('b', '2026-02-31', 60), point('c', '2026-10-01', -1), point('d', '2026-10-01', 101)])] });
  h.ready(); assert.equal(paths(h.contexts[0]).length, 0); assert.equal(dots(h.contexts[0]).length, 1); assert.equal(h.exports.length, 1);
});

test('same-day multi-point records share x and focus changes emphasis without dropping lines', () => {
  const h = harness('group-lines', { series: [series('A', '#123456', [point('a', '2026-10-01', 20), point('b', '2026-10-01', 40)]), series('B', '#234567', [point('c', '2026-10-01', 70), point('d', '2026-10-02', 90)])], focusId: 'A', unit: '分' }); h.ready();
  const drawn = paths(h.contexts[0]); assert.equal(drawn.length, 2);
  const focused = drawn.find(item => item.color === '#123456'), rest = drawn.find(item => item.color === '#234567');
  assert.equal(focused.path[0].args[0], focused.path[1].args[0]); assert.ok(focused.width > rest.width); assert.ok(focused.alpha > rest.alpha);
  assert.ok(h.contexts[0].log.some(item => item.op === 'text' && item.args[0] === '#1 40分'));
});

test('large maxima use concise axis labels without clipping finite points', () => {
  const h = harness('group-lines', { series: [series('A', '#123456', [point('a', '2026-10-01', 1000000)])], max: 1000000, unit: '分' }); h.ready();
  assert.ok(h.contexts[0].log.some(item => item.op === 'text' && item.args[0] === '100万'));
  for (const dot of dots(h.contexts[0])) for (const value of dot.path[0].args) assert.ok(Number.isFinite(value));
});

for (const height of [230, 190, 170]) test('all cohort points remain, with endpoint values and true-point leaders only when focused at height ' + height, () => {
  const values = [76, 87, 79, 86], colors = ['#E4774D', '#4D7CE8', '#8A70D6', '#2C9E9B'];
  const input = values.map((value, index) => series('S' + index, colors[index], [point('a' + index, '2026-09-15', 60 + index), point('b' + index, '2026-10-04', value)]));
  const h = harness('group-lines', { series: input, max: 100, unit: '分', height }); h.ready();
  const ctx = h.contexts[0], dataPaths = paths(ctx); assert.equal(dataPaths.length, 4); assert.equal(dots(ctx).length, 8);
  assert.equal(ctx.log.filter(item => item.op === 'text' && /^#/.test(item.args[0])).length, 0, 'default identifiers stay in the complete page legend');
  assert.equal(ctx.log.filter(item => item.op === 'stroke' && item.width === 0.8 && item.path.some(part => part.op === 'lineTo')).length, 0);
  for (let index = 0; index < input.length; index++) {
    const focused = harness('group-lines', { series: input, max: 100, unit: '分', height, focusId: input[index].id }); focused.ready();
    const focusedCtx = focused.contexts[0], focusedPaths = paths(focusedCtx); assert.equal(focusedPaths.length, 4); assert.equal(dots(focusedCtx).length, 8);
    const labels = focusedCtx.log.filter(item => item.op === 'text' && /^#/.test(item.args[0])); assert.equal(labels.length, 1);
    const label = labels[0]; assert.equal(label.args[0], '#' + (index + 1) + ' ' + values[index] + '分');
    const leader = focusedCtx.log.find(item => item.op === 'stroke' && item.width === 0.8 && item.path.some(part => part.op === 'lineTo')); assert.ok(leader);
    assert.equal(leader.color, colors[index]);
    const dataPath = focusedPaths.find(item => item.color === colors[index]), last = dataPath.path.at(-1).args;
    assert.ok(Math.abs(last[1] - (24 + (1 - values[index] / 100) * (height - 52))) < 1e-10, 'the endpoint remains at its real 0..max position');
    assert.deepEqual(leader.path[0].args, last); assert.equal(leader.path[1].args[1], label.args[2] + 6);
    assert.ok(label.args[2] >= 14 && label.args[2] <= height - 32, 'focused value stays in the chart annotation bounds');
  }
});

test('focused value callout keeps its real value and a short leader to the true endpoint', () => {
  const h = harness('group-lines', { series: [series('A', '#123456', [point('a', '2026-10-01', 79), point('b', '2026-10-02', 86)])], focusId: 'A', unit: '分' }); h.ready();
  const ctx = h.contexts[0], line = paths(ctx)[0];
  const label = ctx.log.find(item => item.op === 'text' && item.args[0] === '#1 86分'); assert.ok(label);
  const leader = ctx.log.find(item => item.op === 'stroke' && item.color === '#123456' && item.width === 0.8 && item.path.some(part => part.op === 'lineTo'));
  assert.ok(leader); assert.deepEqual(leader.path[0].args, line.path[line.path.length - 1].args);
  assert.equal(leader.path[1].args[1], label.args[2] + 6); assert.equal(dots(ctx).length, 2);
});

test('compact white charts retain a solid selected pie and readable axes with outlined white-core points', () => {
  const pie = harness('category-pie', { height: 112, slices: [{ key: 'a', count: 4 }, { key: 'b', count: 3, color: '#4D7CE8' }], selectedKey: 'a' }, { width: 112 }); pie.ready();
  assert.equal(pie.measurements[0].height, 224);
  const sectors = pie.contexts[0].log.filter(item => item.op === 'fill'); assert.equal(sectors.length, 2);
  assert.ok(sectors.some(item => item.color === '#E4774D'));
  for (const sector of sectors) assert.equal(sector.path.find(part => part.op === 'arc').args[2], 48);
  assert.ok(pie.contexts[0].log.filter(item => item.op === 'stroke').every(item => item.color === '#FFFFFF' && item.width === 1.5));
  const lines = harness('group-lines', { height: 170, series: [series('a', '', [point('a', '2026-10-01', 0), point('b', '2026-10-02', 100)])] }, { width: 264 }); lines.ready();
  const ctx = lines.contexts[0]; assert.equal(lines.instance.data.chartFailed, false);
  assert.equal(paths(ctx)[0].color, '#E4774D'); assert.equal(paths(ctx)[0].width, 2);
  assert.ok(dots(ctx).every(item => item.color === '#E4774D' && item.width === 1.6));
  assert.ok(ctx.log.filter(item => item.op === 'fill').every(item => item.color === '#FFFFFF'));
  assert.ok(ctx.log.filter(item => item.op === 'text').every(item => /12px/.test(item.font)));
  assert.ok(ctx.log.some(item => item.op === 'stroke' && item.color === '#E9ECF1'));
  assert.ok(ctx.log.some(item => item.op === 'text' && item.color === '#737C89'));
});

test('individual archive chart uses the same orange stroke, neutral axes and white-core markers', () => {
  const h = harness('score-line', { points: [{ date: '2026-10-01', rate: 0 }, { date: '2026-10-02', rate: 100 }] }, { width: 264 }); h.ready();
  const ctx = h.contexts[0]; assert.equal(h.exports.length, 1); assert.equal(paths(ctx).length, 1);
  assert.equal(paths(ctx)[0].color, '#E4774D'); assert.equal(paths(ctx)[0].width, 2);
  assert.ok(dots(ctx).every(item => item.color === '#E4774D'));
  assert.ok(ctx.log.filter(item => item.op === 'fill').every(item => item.color === '#FFFFFF'));
  assert.ok(ctx.log.filter(item => item.op === 'text').every(item => /12px/.test(item.font)));
  const ys = dots(ctx).map(item => item.path.find(part => part.op === 'arc').args[1]); assert.deepEqual(ys, [93, 18]);
  assert.ok(ctx.log.some(item => item.op === 'text' && item.args[0] === '100%'));
});

for (const name of ['category-pie', 'group-lines']) {
  const props = name === 'category-pie' ? { slices: [{ key: 'a', count: 2, color: '#123456' }] } : { series: [series('a', '#123456', [point('a', '2026-10-01', 40)])] };
  test(name + ': property change invalidates export before its next draw tick', () => {
    const h = harness(name, props); h.ready(); const old = h.exports[0];
    h.update(name === 'category-pie' ? { selectedKey: 'a' } : { focusId: 'a' });
    old.success({ tempFilePath: 'SYNTHETIC_OLD.png' }); assert.equal(h.instance.data.chartImage, '');
    h.flush(); h.exports[1].success({ tempFilePath: 'SYNTHETIC_CURRENT.png' });
    old.fail(); old.success({ tempFilePath: 'SYNTHETIC_OLD_AGAIN.png' }); assert.equal(h.instance.data.chartImage, 'SYNTHETIC_CURRENT.png'); assert.equal(h.instance.data.chartFailed, false);
  });
  test(name + ': detached callbacks and stale image errors cannot publish or clear a newer frame', () => {
    const h = harness(name, props); h.ready(); const id = h.instance._paintId; h.exports[0].success({ tempFilePath: 'SYNTHETIC_FIRST.png' });
    h.update({ height: 240 }); h.flush(); h.exports[1].success({ tempFilePath: 'SYNTHETIC_SECOND.png' });
    h.instance._onImageError({ currentTarget: { dataset: { paint: id } } }); assert.equal(h.instance.data.chartImage, 'SYNTHETIC_SECOND.png');
    h.detach(); h.exports[1].success({ tempFilePath: 'SYNTHETIC_LATE.png' }); assert.equal(h.instance.data.chartImage, 'SYNTHETIC_SECOND.png');
  });
  test(name + ': failed export and missing canvas end loading with readable fallback', () => {
    const fail = harness(name, props, { exportThrows: true }); fail.ready(); assert.equal(fail.instance.data.chartFailed, true); assert.equal(fail.instance.data.chartBusy, false);
    const missing = harness(name, props, { noNode: true }); missing.ready(); assert.equal(missing.instance.data.chartFailed, true); assert.equal(missing.instance.data.chartBusy, false);
  });
  test(name + ': clear-to-empty prevents a former nonempty export reappearing', () => {
    const h = harness(name, props); h.ready(); const old = h.exports[0]; h.update(name === 'category-pie' ? { slices: [] } : { series: [] }); h.flush();
    old.success({ tempFilePath: 'SYNTHETIC_OBSOLETE.png' }); assert.equal(h.instance.data.chartImage, ''); assert.equal(h.instance.data.hasData, false); assert.equal(h.instance.data.chartBusy, false);
  });
  test(name + ': only last scheduled resize query exports a frame', () => {
    const h = harness(name, props, { deferQuery: true }); h.definition.lifetimes.ready.call(h.instance); h.update({ height: 210 }); h.update({ height: 220 }); h.flush();
    assert.equal(h.exports.length, 1); assert.equal(h.instance.data.renderHeight, 220);
  });
}
