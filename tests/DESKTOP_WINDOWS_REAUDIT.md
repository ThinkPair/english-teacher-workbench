# 桌面 Windows ZIP 独立复验

日期：2026-10-05。范围：从用户桌面的实际 ZIP 干净解压，运行其中的 `EnglishTeacher.exe`；没有以源码服务替代交付 EXE。

结论：修订包 `0.2.0 / 20261005.1` 在本机 Windows 上通过本次复验。原包和修订包各完成 12 组首次运行检查、3 组真实终止后重启检查；修订包额外通过失效代理下首次启动与重复打开检查。本次未发现剩余阻断缺陷。

## 对象与独立性

| 对象 | 原桌面包 | 修订桌面包 |
|---|---|---|
| 文件 | `C:/Users/62574/Desktop/英语班主任工作台-Windows版-0.2.0.zip`（更新前留存） | 同名桌面文件（更新后留存） |
| ZIP SHA256 | `5b07a2cc7ef4bcefdfdb6fb1d116f6df14f96dd3f147b5f1417be9936f1c6af3` | `c2086b5197009446c16712636dda1a523aab44705aaefc4856129d3a7a2a4bfc` |
| EXE SHA256 | `094be6477f528893cbe9415f78cfeb5f2a8fb78e4141228e0ebd736717ce6e35` | `2831a2e6aeb188b56737141f5f35cc7724a7115e2066721350a871fe8f646a10` |
| 归档文件数 | 308 | 309 |
| 独立解压根（相对项目） | `build/desktop-zip-reaudit-20261005-original/unpacked/` | `build/desktop-zip-reaudit-20261005-revised/unpacked/` |
| 独立数据根 | 原包验收根内 `isolated-data-v2/` | 修订包验收根内 `workflow-data/`；代理用 `bad-proxy-data/` |
| 主流程端口 | 18769 | 18769（原包测试进程终止后复用） |

所有启动均隐藏窗口并使用 `--no-browser`。本轮没有请求 8769、没有写正式 `release/` 或 `EnglishTeacher/runtime`，没有真实学生资料，也没有请求外部模型。交付 ZIP 内未发现 `runtime/`、`settings.json`、`workspace.sqlite3` 或 `application.log`。

## 通过的检查

1. EXE 启动，健康响应为 `english-teacher / 0.2.0`；首页、实际引用的 JS/CSS 与主要 API schema 可访问。
2. 全新个人空间为空，示例空间有虚构学生；读取示例不会填充个人空间，跨空间学生读取返回 404。
3. 60 页虚构 PDF + 1 张真实 PNG 字节导入，共 61 页；原件逐字节匹配；59—61 页可预览；文本检索准确定位 PDF 第 59 页。
4. 多 PDF 与照片拼接后的全局页码正确，原件与页预览均可回溯。
5. 教材、题库、练习、文件 URL、学生和复测试卷的个人/示例隔离。
6. 题库草稿必须补齐并确认；非法来源页范围、陈旧修订号被拒绝；改题重新进入草稿。
7. 由学生已确认的学校卷弱项推荐已确认原题；缺题显示真实数量；建立练习并生成无成绩、未确认的复测卷。
8. 练习快照保留原文、选项、答案和来源；之后修改题库不改写已布置练习；重复转复测返回同一试卷。
9. 草稿题、重复题、空练习与客户端注入字段被拒绝。
10. 复测题源按不可变快照和题目 ID 关联；重排/新增手工题/其他学生题目不会伪造来源映射。
11. 已确认复测排除已练题，学校原始成绩不被复测成绩替换；修改复测后重新开放待练资格。
12. 使用纯本地 HTTP 模型 stub 验证 EXE 内抽题链路：仅发送所选页、保留共用文章与选项、重复抽题不覆盖老师修改。
13. 备份包含原件与一致的 SQLite 数据库；`PRAGMA integrity_check` 为 `ok`；不含设置和预览缓存。
14. 对 EXE 进程实际终止、重新启动后，学生、61 页教材、原件 SHA、练习快照、复测试卷 ID、题源映射与学校成绩仍一致。
15. 修订包在 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:9`、`NO_PROXY=''` 下首次启动成功，第二次启动正常退出并复用原服务；原服务继续健康。该项独立端口为 54014。

## 证据文件

- 可复跑黑箱测试：`tests/desktop_zip_reaudit.py`。
- 原包：`build/desktop-zip-reaudit-20261005-original/initial-results.json`（12 PASS）、`restart-results.json`（3 PASS）、`workflow-snapshot.json`、`source-original.zip`。
- 修订包：`build/desktop-zip-reaudit-20261005-revised/initial-results.json`（12 PASS）、`restart-results.json`（3 PASS）、`workflow-snapshot.json`、`source-revised.zip`。
- 修订包代理证据：`build/desktop-zip-reaudit-20261005-revised/bad-proxy-result.json`，调用现有 `scripts/verify_portable_launcher.py`，目标为本轮实际解压 EXE。
- 包清洁性：`build/desktop-zip-reaudit-20261005-revised/archive-cleanliness.json`。
- 清理收据：`build/desktop-zip-reaudit-20261005-revised/cleanup.json`，本轮测试进程剩余 0，18769 监听剩余 0。代理测试进程由其验证脚本的 `finally` 清理。

## 调试过程与边界

首次编排黑箱检查时直接复用了一个依赖“每例空数据库”的 pytest 用例；此前创建的题库记录让“只能推荐一题”的断言失败。已确认这是验收脚本的 fixture 污染，并改为本场景独有知识标签，在另一个全新数据根重跑原包全部检查，12/12 通过。首轮原始失败证据保留为 `initial-run-fixture-contamination.json`，没有把它记录成产品缺陷，也没有删除既有测试数据。

本轮检验的是 Windows 实际交付包运行、接口与持久化。首页资源通过不代表逐屏视觉/交互验收；没有执行真实第三方模型质量测试，没有验证所有 Windows 版本或其他机器。代理修复在本轮修订包实测通过；原包的正常工作链路通过不等于否定此前已发现的代理启动问题。
