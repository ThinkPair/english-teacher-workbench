'use strict';

const colorOf = value => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#E4774D';
const dayTime = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
};
const concise = value => {
  const rounded = number => String(Math.round(number * 10) / 10);
  if (value >= 100000000) return rounded(value / 100000000) + '亿';
  if (value >= 10000) return rounded(value / 10000) + '万';
  if (value >= 1000) return rounded(value / 1000) + 'k';
  if (value > 0 && value < 0.1) return value.toPrecision(2);
  return rounded(value);
};

Component({
  properties: {
    series: { type: Array, value: [] },
    max: { type: Number, value: 100 },
    unit: { type: String, value: '%' },
    focusId: { type: String, value: '' },
    height: { type: Number, value: 230 }
  },
  data: { chartImage: '', chartFailed: false, chartBusy: false, hasData: false, renderHeight: 230, renderPaintId: 0 },
  observers: { 'series,max,unit,focusId,height': function () { this._schedule(); } },
  lifetimes: {
    ready() { this._ready = true; this._schedule(); },
    detached() { this._ready = false; this._paintId = (this._paintId || 0) + 1; }
  },
  pageLifetimes: { show() { this._schedule(); }, resize() { this._schedule(); } },
  methods: {
    _current(paintId) { return this._ready && paintId === this._paintId; },
    _schedule() {
      if (!this._ready) return;
      const paintId = this._paintId = (this._paintId || 0) + 1;
      const height = Number.isFinite(this.data.height) && this.data.height > 0 ? Math.max(120, Math.min(1000, this.data.height)) : 230;
      this.setData({ chartImage: '', chartFailed: false, chartBusy: true, renderHeight: height, renderPaintId: paintId });
      wx.nextTick(() => { if (this._current(paintId)) this._draw(paintId); });
    },
    _fail(paintId) {
      if (this._current(paintId)) this.setData({ chartImage: '', chartFailed: true, chartBusy: false });
    },
    _draw(paintId) {
      if (!this._current(paintId)) return;
      const max = typeof this.data.max === 'number' && Number.isFinite(this.data.max) && this.data.max > 0 ? this.data.max : 100;
      const unit = this.data.unit === '分' ? '分' : '%';
      const series = (Array.isArray(this.data.series) ? this.data.series : []).map((item, index) => {
        if (!item) return null;
        const points = (Array.isArray(item.points) ? item.points : []).map((point, order) => {
          if (!point || typeof point.value !== 'number' || !Number.isFinite(point.value) || point.value < 0 || point.value > max) return null;
          const time = dayTime(point.date);
          return time === null ? null : { time, value: point.value, date: point.date, order };
        }).filter(Boolean).sort((a, b) => a.time - b.time || a.order - b.order);
        const dash = (Array.isArray(item.dash) ? item.dash : []).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 40).slice(0, 8);
        return { id: item.id, number: index + 1, color: colorOf(item.color), dash: dash.some(value => value > 0) ? dash : [], points };
      }).filter(item => item && item.points.length);
      this.setData({ hasData: series.length > 0 });
      if (!series.length) { this.setData({ chartBusy: false }); return; }
      const focusId = series.some(item => item.id === this.data.focusId) ? this.data.focusId : '';
      let minTime = Infinity, maxTime = -Infinity;
      series.forEach(item => item.points.forEach(point => { minTime = Math.min(minTime, point.time); maxTime = Math.max(maxTime, point.time); }));
      try {
        this.createSelectorQuery().select('#groupLines').fields({ node: true, size: true }).exec(result => {
          if (!this._current(paintId)) return;
          try {
            const measured = result && result[0];
            if (!measured || !measured.node || !Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.width < 100 || measured.height < 80) {
              this._fail(paintId); return;
            }
            const { node, width, height } = measured;
            const ctx = node.getContext('2d');
            if (!ctx) { this._fail(paintId); return; }
            const device = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
            const dpr = device && Number.isFinite(device.pixelRatio) && device.pixelRatio > 0 ? device.pixelRatio : 1;
            node.width = Math.round(width * dpr); node.height = Math.round(height * dpr);
            ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
            const ticks = [0, max / 2, max];
            const left = Math.min(74, Math.max(34, Math.max.apply(null, ticks.map(value => concise(value).length)) * 7 + 11));
            const right = 32, top = 24, bottom = 28, plotWidth = width - left - right, plotHeight = height - top - bottom;
            if (plotWidth < 20 || plotHeight < 20) { this._fail(paintId); return; }
            ctx.font = '12px sans-serif'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 1;
            ticks.forEach(value => {
              const y = top + (1 - value / max) * plotHeight;
              ctx.setLineDash([]); ctx.strokeStyle = '#E9ECF1'; ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
              ctx.fillStyle = '#737C89'; ctx.textAlign = 'right'; ctx.fillText(concise(value), left - 7, y);
            });
            ctx.fillStyle = '#737C89'; ctx.fillText(unit, left - 7, 9);
            const prepared = series.map(item => Object.assign({}, item, { coords: item.points.map(point => ({
              x: minTime === maxTime ? left + plotWidth / 2 : left + (point.time - minTime) / (maxTime - minTime) * plotWidth,
              y: top + (1 - point.value / max) * plotHeight, value: point.value
            })) }));
            // Draw all populated archives. Highlighting only changes emphasis,
            // never truncates the cohort or manufactures a missing zero.
            const order = focusId ? prepared.filter(item => item.id !== focusId).concat(prepared.filter(item => item.id === focusId)) : prepared;
            order.forEach(item => {
              const focused = item.id === focusId;
              ctx.globalAlpha = focusId && !focused ? 0.22 : 0.94;
              ctx.strokeStyle = item.color; ctx.fillStyle = item.color;
              ctx.lineWidth = focused ? 3 : 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(item.dash);
              if (item.coords.length > 1) {
                ctx.beginPath();
                item.coords.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
                ctx.stroke();
              }
              ctx.setLineDash([]);
              item.coords.forEach(point => {
                ctx.beginPath(); ctx.arc(point.x, point.y, focused ? 3.5 : 2.5, 0, Math.PI * 2);
                ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = item.color; ctx.lineWidth = focused ? 2 : 1.6; ctx.stroke();
              });
            });
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            // The page legend identifies every learner. Only a focused line
            // receives an endpoint callout; the complete cohort stays drawn.
            const annotations = focusId ? prepared.filter(item => item.id === focusId) : [];
            annotations.forEach(item => {
              const last = item.coords[item.coords.length - 1];
              const text = '#' + item.number + ' ' + concise(last.value) + unit;
              const x = Math.min(width - 4, Math.max(last.x + 25, text.length * 7 + 4));
              const labelTop = top - 10;
              const labelBottom = height - bottom - 4;
              const labelY = Math.max(labelTop, Math.min(labelBottom, last.y - 12));
              ctx.font = '600 12px sans-serif';
              ctx.textAlign = 'right';
              if (Math.abs(labelY - last.y) > 0.5) {
                // A displaced number is a callout, not another score point.
                // Start its thin, matching-color leader at the actual endpoint.
                const measuredText = typeof ctx.measureText === 'function' ? ctx.measureText(text) : null;
                const textWidth = measuredText && Number.isFinite(measuredText.width) ? measuredText.width : text.length * 6.6;
                const anchorX = Math.max(x - textWidth + 2, Math.min(x - 2, last.x));
                const anchorY = labelY + (last.y >= labelY ? 6 : -6);
                ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(anchorX, anchorY);
                ctx.setLineDash([]); ctx.strokeStyle = item.color; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.76; ctx.stroke();
                ctx.globalAlpha = 1;
              }
              ctx.fillStyle = item.color; ctx.textBaseline = 'middle'; ctx.fillText(text, x, labelY);
            });
            const spansYears = new Date(minTime).getUTCFullYear() !== new Date(maxTime).getUTCFullYear();
            const label = time => {
              const date = new Date(time).toISOString().slice(0, 10);
              return (spansYears ? date.slice(2) : date.slice(5)).replace(/-/g, '/');
            };
            ctx.font = '12px sans-serif'; ctx.fillStyle = '#737C89'; ctx.textBaseline = 'alphabetic';
            if (minTime === maxTime) {
              ctx.textAlign = 'center'; ctx.fillText(label(minTime), left + plotWidth / 2, height - 7);
            } else {
              ctx.textAlign = 'left'; ctx.fillText(label(minTime), left, height - 7);
              if (plotWidth >= (spansYears ? 250 : 180)) { ctx.textAlign = 'center'; ctx.fillText(label((minTime + maxTime) / 2), left + plotWidth / 2, height - 7); }
              ctx.textAlign = 'right'; ctx.fillText(label(maxTime), width - right, height - 7);
            }
            this._export(node, paintId);
          } catch (error) { this._fail(paintId); }
        });
      } catch (error) { this._fail(paintId); }
    },
    _export(node, paintId) {
      const exportFrame = () => {
        if (!this._current(paintId)) return;
        try {
          wx.canvasToTempFilePath({ canvas: node, destWidth: node.width, destHeight: node.height, fileType: 'png',
            success: result => {
              if (!this._current(paintId)) return;
              if (!result || typeof result.tempFilePath !== 'string' || !result.tempFilePath) { this._fail(paintId); return; }
              this.setData({ chartImage: result.tempFilePath, chartFailed: false, chartBusy: false });
            }, fail: () => this._fail(paintId)
          }, this);
        } catch (error) { this._fail(paintId); }
      };
      if (typeof node.requestAnimationFrame === 'function') node.requestAnimationFrame(exportFrame); else wx.nextTick(exportFrame);
    },
    _onImageError(event) {
      const id = Number(event && event.currentTarget && event.currentTarget.dataset.paint);
      if (this._current(id)) this._fail(id);
    }
  }
});
