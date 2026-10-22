# UI 独立复核记录

日期：2026-10-05。范围：`frontend/src/ModalFrame.tsx`、后端手动教案创建字段与原子保存、`tests/test_ui_save_contract.py`；后续扩展只读复核 `App.tsx`、`styles.css`、资料库与针对性练习组件。本记录由独立 QA 写入；产品文件未修改。

当前结论：本轮发现 3 项功能问题，均已由实现负责人修复。弹窗生命周期修复通过可执行的隔离回归检查；其他两项已完成源码闭环，实际交互和布局仍以 root 浏览器验收为准。本 QA 未进行浏览器、真实 API、真实模型或发布验收。

## 已发现的问题

### 已修复 P1：多层弹窗按父层先于子层清理，会留下整页 inert 和滚动锁

位置：`frontend/src/ModalFrame.tsx:23-30,63-69`（初次复核版本）。

每层分别保存 `body.style.overflow` 与其他 body 子元素的 `inert` 快照，再在自身卸载时恢复。第二层保存到的是第一层已锁定的状态。如果同一次卸载先执行父层 cleanup，再执行子层 cleanup，子层就把应用根节点重新设为 `inert=true`，并把 `overflow` 恢复为 `hidden`；此时所有弹窗 host 均已删除，应用无法再接受正常交互。

本地安装的 React 19 中，`react-dom-client.development.js` 的函数组件删除分支先调用 `commitHookLayoutUnmountEffects`，随后调用 `recursivelyTraverseDeletionEffects`，因此 React 嵌套组件同时卸载确实可能出现父先子后的 cleanup 顺序。独立弹窗同批关闭也不应依赖调用方恰好按 LIFO 排序。

可执行证据：`node tests/modal_lifecycle_probe.cjs`。脚本转译并执行实际 ModalFrame 组件与 cleanup，使用最小 DOM 桩，无浏览器、无网络、无服务端口。

初次运行结果：

```json
{
  "lifo": {"rootInert": false, "bodyOverflow": "", "remainingHosts": 0},
  "parentThenChild": {"rootInert": true, "bodyOverflow": "hidden", "remainingHosts": 0}
}
```

断言失败：`parentThenChild: application must not remain inert`。这是生命周期状态算法复现，**不是浏览器 UI 交互结果**。具体产品入口是否能触发同批卸载仍需主验收确认。

修复复核：现实现由 module shared `modalStack / backgroundInert / originalOverflow / originalFocus` 管理，增删时按当前活动层重算 inert，最后一层退出恢复背景。2026-10-05 重跑 probe 的四项断言均通过：两层 LIFO、两层父先子后、三层混合移除、保留原 `overflow: scroll`。结果都没有残留 host，背景 root 均恢复非 inert。probe 为支持新实现增加了 `querySelector` DOM 桩；并非绕过产品逻辑。

### 已修复 P2：练习卷缺少总分时显示可以归档，与后端要求不一致

初次位置：`App.tsx:143-144,158` 仅为学校卷检查空 `school_score`；`backend/main.py:284-285` 对学校卷和练习卷均要求教师确认总分。练习卷全题核对后仍留空总分时，界面曾显示可归档并启用按钮，提交才收到 400。

修复复核：`confirmExam` 增加空总分前置定位；归档提示、下一步跳转和按钮禁用条件均已统一覆盖练习卷。练习卷使用“老师确认总分”文案。源码契约已一致；实际点击定位与提示验收待 root。

### 已修复 P2：长练习预览没有内部滚动容器

初次位置：`Practice.tsx` 的 `WorksheetPreview` 直接使用 `.worksheet-preview-tools` 与 `.worksheet-screen`，不走 `.modal-body`；新的 `.modal` 使用 flex column 和 `overflow:hidden`，原 `.worksheet-screen` 仅定义背景和内边距，长内容会超出并被裁切。

修复复核：`library.css:83-84` 已为工具栏设置 `flex-shrink:0`，为 `.worksheet-screen` 设置 `min-height:0; overflow-y:auto; flex:1`。同时打印样式隐藏 body 直属 modal host，打印内容通过独立 `.practice-print-host` 输出。源码闭环完成；末题可达、低高度窗口和实际打印预览仍待 root。

## 已完成的检查

- Portal：内容放入 body 直属 host，避免应用祖先层叠上下文裁切；每次 cleanup 删除 host。
- 焦点：首个可编辑字段优先，退回可聚焦控件或 dialog；Tab 每次实时计算可聚焦元素；有 focusin 防逃逸；恢复触发焦点前验证连接和 inert。
- 嵌套日常 LIFO 关闭：生命周期桩中状态恢复正确。真实浏览器 Tab、Escape、鼠标、屏幕阅读器均未由本 QA 执行。
- 忙碌状态：Escape、遮罩和关闭按钮都有 busy 限制；监听器通过 ref 读取最新回调与 busy，不依赖重新绑定。
- 异步内容：焦点列表在每次 Tab 时重新计算，可纳入后加入的字段。设置弹窗先加载后显示表单，初始 focus 会先落在关闭按钮；内容到达后首次 Tab 应进入表单，需浏览器验证。
- `ManualPlan` 的 `lesson_note`、`review_date`、`review_result` 在请求 schema 中一次校验，并在同一数据库 transaction 的同一 plan 写入中保存。日期转 ISO 字符串，空日期保存为 null，既有字段默认值兼容原调用。
- 手动教案在保存前核对学生存在、来源试卷所属学生，错误发生时 transaction 回滚。
- 新建手动教案前端现在用一次 `/plans/manual` 请求提交正文和全部跟进字段。失败保留编辑器输入，成功取得持久化 ID 后切为编辑既有记录；档案刷新失败另行提示，不重新创建教案。
- 试卷校对：修改答案、分值、错因等会重置该题的 reviewed；保存前检查数值与必填元数据；未完成校对时提供下一步定位。正文修改失败保留本地 dirty 状态。
- 资料库：保存草稿与确认入库分开；确认前会先保存 dirty 草稿，确认失败保留已保存草稿及其版本；元数据弹窗与未保存题目切换有保护。
- 推荐与原页请求带独立序号，迟到结果不覆盖新查询；推荐范围变化会标记尚未应用并禁用保存；历史读取失败与候选读取失败分开；来源图失败保留重试/单独打开路径。
- 学生与教师打印使用独立内容分支，学生 Worksheet 分支不输出答案与解析；本项为源码判断，未实际生成打印 PDF。

## 实际运行的验证

`tests/test_ui_save_contract.py`：**2 passed**，测试使用隔离临时数据目录与 FastAPI TestClient，未访问真实模型或运行中的 8769/8773 服务。

1. 单次创建请求保存标题、内容、上课记录、复测日期与复测结果，并从学生详情读取。
2. 非法复测日期得到 422，学生详情中没有残留半成品教案。

仅有一条 Starlette/httpx 的弃用告警，与本次保存结果无关。

## 主验收仍需覆盖

- lifecycle probe 已完成回归；仍需同批打开/关闭、StrictMode、父组件卸载的实际浏览器验收。
- 两层弹窗：子层关闭后焦点回父层原触发按钮，父层仍锁住背景；父层退出后焦点和滚动恢复。
- 空列表、异步加载完成、加载失败、busy 开始/结束时，Tab/Shift+Tab 均不逃到背景，关闭语义与提示一致。
- 验证下层按钮不能点击、背景不能滚动，Escape 一次只关闭顶层，遮罩按下不会误关内层或清除未保存输入。
- 检查浏览器渲染中的宽/窄弹窗、长表单、移动窄屏和内层预览，不以源码判断替代布局验收。
- 实际验证新建教案单次保存包含跟进字段，注入失败时保留输入，重试不重复创建；实际验证练习卷空总分的引导与定位。
- 学生和教师长练习预览均可滚动到末题；窄屏/低高度下打印按钮可达，实际打印输出无应用背景和弹窗遮罩。

