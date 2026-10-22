# UI 改版最终 Windows ZIP 独立运行验收

日期：2026-10-05。结论：**PASS**。本轮直接运行从桌面最终 ZIP 解压得到的 EXE，未用源码服务代替成品。

## 验收对象

| 项目 | 实际结果 |
|---|---|
| 桌面 ZIP | `C:/Users/62574/Desktop/英语班主任工作台-Windows版-0.2.0.zip` |
| 应用版本 / 包修订 | `0.2.0 / 20261005.2` |
| ZIP 大小 / 文件数 | 48,631,824 字节 / 303 个条目 |
| ZIP SHA256 | `704553085e53b978e8a90fdabaef0dab65d957bbd862fb8f5829afe7eb2f5291` |
| EXE SHA256 | `5c3228d252329d77943f095167110ae23cc94d6939a80381e229b896e7dddf57` |
| 实际首页 JS | `/assets/index-DdalnR5E.js` |
| JS SHA256 | `e4d7921673e518fd8cce34f209af32738084e0fe2fe2b1184120d05b6a8af738` |
| 隔离验收目录 | `runtime/ui-desktop-final-20261005/` |
| 隔离数据目录 | 验收目录内 `isolated-data/` |
| 端口 | `8775` |

桌面 ZIP 在测试前复制为验收目录中的 `desktop-final.zip`；结束时再次核对原桌面 ZIP 哈希一致，未修改交付 ZIP。实际 HTTP 返回的 JS 字节同时与解压文件和项目当前 `frontend/dist` 中的同名产物一致。包内未发现 `runtime/`、`settings.json`、`workspace.sqlite3` 或 `application.log`。

## 运行结果

- `desktop_zip_reaudit.py initial`：**12 PASS，0 FAIL**。
- 停止首次 EXE、用相同隔离数据重新启动后，`desktop_zip_reaudit.py restart`：**3 PASS，0 FAIL**。
- 将现有 `test_ui_save_contract.py` 两个测试直接指向解压 EXE：**2 PASS，0 FAIL**。
- `/openapi.json` 中 `ManualPlan` 包含 `lesson_note`、`review_date`、`review_result`。
- 重启后额外读取手动教案，正文、标题、课后记录、复测日期及结果与重启前完整快照相等。

首次运行覆盖空个人空间与虚构示例隔离、60 页 PDF 加图片的原件保真与页预览、文本检索、题库确认与版本校验、推荐缺题说明、练习快照、复测来源映射、复测归档及重新开放资格、本机模型 stub 的指定页拆题和教师修改保护，以及备份数据库完整性。

重启检查确认学生、原件 SHA、61 页资料、练习快照、复测试卷 ID、题源映射及学校原始成绩保留，重复生成复测仍返回同一试卷。备份数据库完整性检查为 `ok`，备份不含模型设置及预览缓存。

单次手动教案创建测试确认跟进字段在同一请求保存；非法复测日期返回 422，未产生半成品教案。

## 进程与隔离

两次启动均使用隐藏窗口和 `--no-browser`，数据根通过仅用于子进程的 `TEACHER_DATA_DIR` 指向验收目录。首次 PID 为 `65552`，重启 PID 为 `53560`。停止前均核对进程路径确为本次独立解压 EXE。

最终清理结果：本次 EXE 剩余进程 **0**，8775 监听 **0**。未请求、重启或停止 8769/8773；未写正式运行数据。测试只使用虚构学生、虚构资料和本机 HTTP 模型 stub，未请求真实第三方模型。

## 证据与边界

机器收据：`release/ui-windows-final.json`。

验收目录内保留 `initial-results.json`、`restart-results.json`、`bundle-contract-results.json`、`bundle-restart-contract-results.json`、`workflow-snapshot.json`、`cleanup.json`，以及独立 ZIP 快照、解压 EXE、隔离数据库和日志。

本轮确认 Windows 最终交付包的运行、接口、成品一致性和重启持久化；不将静态资源可访问称为浏览器逐屏交互通过，不涉及真实模型质量、其他 Windows 机器或 macOS 原生运行。运行时仅出现已有 Starlette/httpx 与 PyMuPDF 弃用告警，没有测试失败。
