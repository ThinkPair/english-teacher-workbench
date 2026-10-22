---
type: local_validation_receipt
layer: product
status: archived
validity: historical
retrieval: on_demand
privacy: private
effective_from: '2026-10-06'
updated: '2026-10-06'
confidence: confirmed
---

# 学员手记 0.4.0 验证入口

- [独立QA与视觉复核](tests/qa-group-dashboard.md)、[35项机器回执](tests/qa-group-dashboard-summary.json)。
- 模型 tests/comparison.test.cjs 20项；组件 tests/group-chart-render.test.cjs 20项；兼容回归51项（追加示例23、分类14、存储14）。测试均为合成资料。
- [官方主流程12项及最终视觉4项](tests/wechat-simulator-0.4.0/flow-result.json)。
- [当前综合验收](验收记录.md)及[源码/预览绑定](release/official-validation-receipt-0.4.0.json)。

真实手机落盘未验证，未正式发布。[0.3.1历史QA](QA-0.3.1.md)及更早版本计数不累计成本轮结果。
