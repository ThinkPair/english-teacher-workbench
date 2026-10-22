'use strict';

const colorOf = value => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#E4774D';

Component({
  properties: {
    slices: { type: Array, value: [] },
    selectedKey: { type: String, value: '' },
    height: { type: Number, value: 150 }
  },
  data: { chartImage: '', chartFailed: false, chartBusy: false, hasData: false, renderHeight: 150, renderPaintId: 0 },
  observers: { 'slices,selectedKey,height': function () { this._schedule(); } },
  lifetimes: {
    ready() { this._ready = true; this._schedule(); },
    detached() { this._ready = false; this._paintId = (this._paintId || 0) + 1; }
  },
  pageLifetimes: { show() { this._schedule(); }, resize() { this._schedule(); } },
  methods: {
    _current(paintId) { return this._ready && paintId === this._paintId; },
    _schedule() {
      if (!this._ready) return;
      // Invalidate at property-change time, before the next layout tick.
      const paintId = this._paintId = (this._paintId || 0) + 1;
      const height = Number.isFinite(this.data.height) && this.data.height > 0 ? Math.max(80, Math.min(1000, this.data.height)) : 150;
      this.setData({ chartImage: '', chartFailed: false, chartBusy: true, renderHeight: height, renderPaintId: paintId });
      wx.nextTick(() => { if (this._current(paintId)) this._draw(paintId); });
    },
    _fail(paintId) {
      if (this._current(paintId)) this.setData({ chartImage: '', chartFailed: true, chartBusy: false });
    },
    _draw(paintId) {
      if (!this._current(paintId)) return;
      const slices = (Array.isArray(this.data.slices) ? this.data.slices : [])
        .filter(item => item && typeof item.count === 'number' && Number.isFinite(item.count) && item.count > 0)
        .map(item => ({ key: item.key, count: item.count, color: colorOf(item.color) }));
      this.setData({ hasData: slices.length > 0 });
      if (!slices.length) { this.setData({ chartBusy: false }); return; }
      const selectedKey = this.data.selectedKey;
      try {
        this.createSelectorQuery().select('#pie').fields({ node: true, size: true }).exec(result => {
          if (!this._current(paintId)) return;
          try {
            const measured = result && result[0];
            if (!measured || !measured.node || !Number.isFinite(measured.width) || !Number.isFinite(measured.height) || measured.width < 30 || measured.height < 30) {
              this._fail(paintId); return;
            }
            const { node, width, height } = measured;
            const ctx = node.getContext('2d');
            if (!ctx) { this._fail(paintId); return; }
            const device = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
            const dpr = device && Number.isFinite(device.pixelRatio) && device.pixelRatio > 0 ? device.pixelRatio : 1;
            node.width = Math.round(width * dpr); node.height = Math.round(height * dpr);
            ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
            const cx = width / 2, cy = height / 2, radius = Math.max(1, Math.min(width, height) / 2 - 8);
            // Normalized weights avoid overflow if caller-provided counts are large.
            const largest = Math.max.apply(null, slices.map(item => item.count));
            const sum = slices.reduce((value, item) => value + item.count / largest, 0);
            let angle = -Math.PI / 2;
            const sectors = slices.map((item, index) => {
              const start = angle;
              angle = index === slices.length - 1 ? Math.PI * 1.5 : angle + item.count / largest / sum * Math.PI * 2;
              return Object.assign({}, item, { start, end: angle });
            });
            const paint = (sector, selected) => {
              // Move only the selected sector; preserve every sector's radius
              // and count-proportional angle, with no inner cutout.
              const offset = selected && sectors.length > 1 ? 2.5 : 0;
              const midAngle = (sector.start + sector.end) / 2;
              const centerX = cx + Math.cos(midAngle) * offset, centerY = cy + Math.sin(midAngle) * offset;
              ctx.beginPath();
              if (sectors.length > 1) ctx.moveTo(centerX, centerY);
              ctx.arc(centerX, centerY, radius, sector.start, sector.end, false);
              ctx.closePath(); ctx.fillStyle = sector.color; ctx.fill();
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
            };
            sectors.filter(item => item.key !== selectedKey).forEach(item => paint(item, false));
            sectors.filter(item => item.key === selectedKey).forEach(item => paint(item, true));
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
            },
            fail: () => this._fail(paintId)
          }, this);
        } catch (error) { this._fail(paintId); }
      };
      if (typeof node.requestAnimationFrame === 'function') node.requestAnimationFrame(exportFrame);
      else wx.nextTick(exportFrame);
    },
    _onImageError(event) {
      const id = Number(event && event.currentTarget && event.currentTarget.dataset.paint);
      if (this._current(id)) this._fail(id);
    }
  }
});
