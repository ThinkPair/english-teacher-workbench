'use strict';

Page({
  data: { error: '' },
  onBack() {
    wx.navigateBack({ delta: 1,
      fail: () => this.setData({ error: '暂时无法返回，请使用微信左上角的返回按钮。' })
    });
  }
});
