# 双平台 UI 安装包独立完整性复核

结论：PASS；预期 package_revision：`20261005.2`。
复核时间（UTC）：2026-10-05T01:53:07+00:00

此检查直接读取 ZIP 与嵌套源码，不解压、不启动程序、不调用 AI、不读取正式学生资料。

## Windows：PASS

- 文件：`C:\Users\62574\Desktop\英语班主任工作台-Windows版-0.2.0.zip`
- 大小：48,631,824 字节；文件条目：303
- SHA-256：`704553085e53b978e8a90fdabaef0dab65d957bbd862fb8f5829afe7eb2f5291`

| 检查 | 结果 | 证据 |
|---|---|---|
| Package paths | PASS | No unsafe or duplicate members |
| Package CRC | PASS | All entries decompressed and passed CRC |
| Package root | PASS | EnglishTeacher |
| Package revision | PASS | 20261005.2 |
| Package metadata byte equality | PASS | Compared with current package-info.json |
| Package private-data files | PASS | No user runtime, settings, databases, environment or credential files |
| Package credential-pattern scan | PASS | No plausible sk-* credential or private-key header in application text |
| Frontend dist file set | PASS | 3 current files; missing=[]; extra=[] |
| Frontend dist byte equality | PASS | All packaged bytes equal current workspace files |
| Embedded source paths | PASS | No unsafe or duplicate members |
| Embedded source CRC | PASS | All entries decompressed and passed CRC |
| Embedded source private-data files | PASS | No user runtime, settings, databases, environment or credential files |
| Embedded source credential-pattern scan | PASS | No plausible sk-* credential or private-key header in application text |
| Embedded source required UI/backend/tests | PASS | ModalFrame, UI modules, atomic-save backend and verifier present |
| Embedded source backend | PASS | 12 files; missing=[]; extra=[]; changed=[] |
| Embedded source frontend/src | PASS | 13 files; missing=[]; extra=[]; changed=[] |
| Embedded source scripts | PASS | 11 files; missing=[]; extra=[]; changed=[] |
| Embedded source tests | PASS | 10 files; missing=[]; extra=[]; changed=[] |
| Embedded source revision | PASS | 20261005.2 |
| Windows executable byte equality | PASS | Compared with the current release executable; no executable launched |

前端资产逐字节比较：

| 文件 | 字节 | SHA-256 | 与当前一致 |
|---|---:|---|---|
| `assets/index-DdalnR5E.js` | 354399 | `e4d7921673e518fd8cce34f209af32738084e0fe2fe2b1184120d05b6a8af738` | 是 |
| `assets/index-DvuHa2uv.css` | 73965 | `fb98da98cd252e2bc464643044a81c28e2094449c09323d835a0a2fe6f40a589` | 是 |
| `index.html` | 529 | `77773a2ce5c16c0f3cde217ae13b82d682e5724c4a58623b67cce108a00fa6f6` | 是 |

## Mac：PASS

- 文件：`C:\Users\62574\Desktop\英语班主任工作台-Mac版-0.2.0-待实机验证.zip`
- 大小：117,548,926 字节；文件条目：5,024
- SHA-256：`f37326bc2fe85f28759f58eab0a933d0771424e4c5302ea6ca872497387c1508`

| 检查 | 结果 | 证据 |
|---|---|---|
| Package paths | PASS | No unsafe or duplicate members |
| Package CRC | PASS | All entries decompressed and passed CRC |
| Package root | PASS | EnglishTeacher-Mac |
| Package revision | PASS | 20261005.2 |
| Package metadata byte equality | PASS | Compared with current package-info.json |
| Package private-data files | PASS | No user runtime, settings, databases, environment or credential files |
| Package credential-pattern scan | PASS | No plausible sk-* credential or private-key header in application text |
| Frontend dist file set | PASS | 3 current files; missing=[]; extra=[] |
| Frontend dist byte equality | PASS | All packaged bytes equal current workspace files |
| Embedded source paths | PASS | No unsafe or duplicate members |
| Embedded source CRC | PASS | All entries decompressed and passed CRC |
| Embedded source private-data files | PASS | No user runtime, settings, databases, environment or credential files |
| Embedded source credential-pattern scan | PASS | No plausible sk-* credential or private-key header in application text |
| Embedded source required UI/backend/tests | PASS | ModalFrame, UI modules, atomic-save backend and verifier present |
| Embedded source backend | PASS | 12 files; missing=[]; extra=[]; changed=[] |
| Embedded source frontend/src | PASS | 13 files; missing=[]; extra=[]; changed=[] |
| Embedded source scripts | PASS | 11 files; missing=[]; extra=[]; changed=[] |
| Embedded source tests | PASS | 10 files; missing=[]; extra=[]; changed=[] |
| Embedded source revision | PASS | 20261005.2 |
| Mac runnable backend byte equality | PASS | 12 Python files checked; mismatches=[] |
| Mac native validation claim | PASS | Remains explicitly unverified on a real Mac |

前端资产逐字节比较：

| 文件 | 字节 | SHA-256 | 与当前一致 |
|---|---:|---|---|
| `assets/index-DdalnR5E.js` | 354399 | `e4d7921673e518fd8cce34f209af32738084e0fe2fe2b1184120d05b6a8af738` | 是 |
| `assets/index-DvuHa2uv.css` | 73965 | `fb98da98cd252e2bc464643044a81c28e2094449c09323d835a0a2fe6f40a589` | 是 |
| `index.html` | 529 | `77773a2ce5c16c0f3cde217ae13b82d682e5724c4a58623b67cce108a00fa6f6` | 是 |

## 检查边界

- `runtime/` 用户目录、settings.json、SQLite 数据库、环境配置和凭据文件均按归档路径检查；Mac 的 `runtimes/` Python 运行组件及 sqlite 动态库属于合法依赖。
- 应用文本另扫描常见 sk-* 密钥格式及私钥头；不输出匹配值。第三方依赖与测试夹具不做密钥模式推断，但仍检查敏感文件路径。此扫描不证明任意未知格式秘密绝不可能存在。
- 内嵌源码逐字节比较当前 backend、frontend/src、scripts、tests；前端检查同时要求文件集合相同，避免残留旧 bundle。
- Windows 可执行文件只与当前 release 成品比较，本检查不重新证明二进制编译过程；Mac 仍为待实机验证包。
