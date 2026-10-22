---
type: implementation_reference
layer: product
status: active
validity: current
retrieval: on_demand
privacy: private
effective_from: '2026-10-06T10:32:44+08:00'
updated: '2026-10-07'
confidence: confirmed
---

# 学员手记 · 英语教师工具 0.6.1 候选合同

**2026-10-07 上架进度：** 个人主体已由用户确认及后台读回。0.6.1 已上传开发版本（227979 bytes），修正复制失败时残留成功提示的问题；本版 168 项合成回归通过；名称“学员手记”、头像与简介已保存；服务类目“工具 > 办公”显示“已通过”并已设为主营。后台仍显示未备案、未认证；认证提示不影响后续版本发布。用户已表示点完隐私确认；实际进入指引设置页，原选项“完全不处理信息”与代码不符，已切换到“处理信息”，但确认按钮仍不可用，尚未展开明细或验证保存。不得再把同一初始协议当作待用户确认，也不得认定隐私声明已完成。手机验收、体验版配置、代码提审及发布未完成。见 [上传记录](release/upload-receipt-0.6.1.json)、[后台设置记录](release/backend-setup-receipt-20261007.json) 与 [类目办理记录](release/backend-category-receipt-20261007.json)。

当前首个小程序聚焦小学、初中、高中英语教师的实际教学记录。每份档案仍只对应一个学科，本版新建固定英语，首页用实心饼图展示自定义分类的全库占比，选择分类后在一张共享日期轴的图中展示当前科目全部学员；年级是档案个人字段，不再作为固定分组。公开定位不包含私人身份，名称“学员手记”已于 10-07 在后台完成设置。通用核心可供以后其他项目复用，但本轮不启动其他项目。信息结构、图表及视觉以 [design-contract.md](design-contract.md) 为准，开发不代表教学成效、采用或付费验证。

0.6.0 默认采用 A「清白橙」方向：浅灰底 #F6F7F9、白色卡片 #FFFFFF、深灰标题 #202631、正文 #303642、次要文字 #737C89、行动色 #CB4A20。首页标题为“我的学员”，入口为“新增学员”和“分类设置”，分类与成绩图更紧凑；详情、分类、表单、备份和帮助沿用同一套视觉。继续使用随包 Tabler Outline 图标，业务流程和 schema 4 数据规则不变。使用 Tabler 官方 MIT Outline 图标的本地 PNG 数据，不在运行时联网获取；完整许可见 [UI_ICONS_LICENSE.txt](miniprogram/lib/UI_ICONS_LICENSE.txt)，来源和离线复建由 scripts/build_ui_icons.py 维护。

0.5.0 的大面积暖白、焦橙、深棕方案已被用户否定；其预览和测试只作历史证据。0.6.0 是新的候选方向，尚不能称为获用户视觉认可；当前生成、验证及手机状态统一见验收记录。历史入口为 [0.5.0 开发预览码](release/微信开发预览码-0.5.0.png)。

本版预览入口为 [0.6.0 开发预览码](release/微信开发预览码-0.6.0.png)，生成与验收状态以 [当前验收记录](验收记录.md) 为准；入口不作为通过回执。

## 交付与边界
- 微信原生小程序工程 miniprogram/ 为主交付；web/ 保留为旧辅助体验，不承诺与原生新界面功能等价。
- 单教师、单设备、单档案库，移除 demo/personal 显式空间切换。Native 新建要求称呼、年级，学科显示并固定为英语，不显示班级；预选当前分类，允许另选分类或未分类。保存后进入档案详情。此为本版 UI 默认，不能用它覆盖旧档案或导入记录的科目。
- 仅首次无新库且无旧个人库时放入 10 份可编辑删除的英语示例：小学英语 4 份、初中英语 3 份、高中英语 3 份，分类默认满分分别为 100/120/150，每份 4 条动态日期成绩，共 40 条成绩、8 标签、1 个英语计划。类别及满分可自定义，示例年级不限制可用范围；标签覆盖词汇、语法、阅读、习惯与强项，材料来自教师选择的已学内容。已有空库不自动补示例，删空不自动重种。自 0.3.1 起，首页无示例时提供“添加 10 个示例学员”按钮，点击后原子追加；无需清缓存或覆盖旧库。
- 统计单位为“份档案”，按 ID 识别，不按姓名合并、不声称去重人数。当前按 categoryId 归组，空值为未分类；构成以全部档案为准，包含示例。年级保留个人字段，存量不同科目保留，不能改成英语后混画。
- 不含登录、收费、家长/学生端、试卷识别、题库、自动组卷、外部 AI、网络请求及云同步。
- 已完成注册，AppID `touristappid` 已配置。本机开发者工具 2.02.2608080、服务端口、登录和自动化连接已准备。历史 0.3.0 分类版核心 87/87、独立 QA 210/210、旧辅助 web 10 项通过；官方模拟器 20 项实际流程（17 主流程 + 3 导航/空库续验）与根、独立两路截图视觉复核通过。模拟器存储为合成 mock，不代表手机真实持久化通过。[开发预览码 0.3.0](release/微信开发预览码-0.3.0.png) 已生成，CLI preview 成功，代码包 128610 bytes；0.2.0 回执及预览保留为历史。以上结果属于 0.3.0，不作为 0.3.1 新增入口、0.4.0 新首页或 0.5.0/0.6.0 视觉更新的验收结果。0.6.0 开发版本已上传；手机、审核及发布未完成，后台显示未认证、未备案，类目待确认；根 Agent 更新 [验收记录](验收记录.md)。
- 用户于 2026-10-07 明确确认注册为个人主体，账号设置已读回个人主体；使用场景如实写教师学员管理，工具—办公类目申请已通过，代码审核及教育应用备案适用性仍单独确认。收费、定价、云同步与公开发布需完成对应准备，不因本轮开发自动开通。
- 本轮保留 0.4.0 已确认的单档单科、分类默认满分、标签、待跟进及帮助，以及全库分类实心饼图、本类当前科目全员共享日期轴折线和紧凑档案名册；仅统一视觉与页面空间。详情仍保留个人 score-line 图。原生流程补充从成绩记观察、复用同依据已有待跟进计划、完成后进入空白复测记录；这些流程已通过历史 0.3.0 官方模拟器检查，手机行为另验。保持教师对建议的判断权，完成计划不自动生成成绩或解除标签。

## 通用数据结构与接口（core.js，纯 JS，CommonJS + globalThis.StudentCore）

所有数组记录均使用字符串 id；日期 YYYY-MM-DD，日期校验必须真实存在。数据库为：
`{schemaVersion:4, revision:0, categories:[], students:[], scores:[], tags:[], plans:[]}`。仅接受版本 1/2/3/4，导出统一为 4；旧程序不能反向恢复新版格式。

- category: `{id,name,total}`。name 必填、1–50 字，保存时修整首尾并合并连续空白；按 NFKC、大小写及移除空白后的名称比较去重。total 为正有限数字，最大 1000000；默认满分只用于后续新成绩，分类总数不超过 100。ID 在全部记录中唯一；分类 ID 不得使用系统为“未分类”保留的 unassigned（其他类型记录不受此保留词限制）。
- student: `{id,name,grade,className,note,subject,isExample,categoryId}`。name 必填、最多 100 字，grade/className 最多 100 字，note 最多 2000 字。subject 为最多 50 字的字符串，isExample 为严格布尔值，className 隐藏保留。categoryId 为最多 100 字的字符串，空串表示未分类，非空必须引用已有分类。版本 3/4 读取时 subject/isExample 不可缺失；版本 4 的 categoryId 也不可缺失。核心新建为兼容旧调用方允许省略 subject/isExample/categoryId，分别默认空串/false/空串。Native 新增要求称呼、年级，并明确传入 subject='英语'；核心不把旧记录默认改英语。
- score: `{id,studentId,title,date,score,total,note,subject}`，title/date 必填，0 <= score <= total，total > 0。subject 最多 50 字；新建省略时继承档案学科，显式空串保留未分类；旧记录编辑省略时保留原科目。仅新建且完全省略 total 时继承所属分类默认满分；未分类时仍须传满分，显式值优先且须合法，空串/null 不触发默认。编辑仍须提供原或修改后的 total，不在编辑时重取分类默认。历史成绩只沿用原有有限正数约束，不增加分类的 1000000 上限；分数拒绝空输入，不自动标记掌握度。
- tag: `{id,studentId,type,label,note,observedOn,status,subject}`，type = weak/strong/habit，status = active/resolved；label/observedOn 必填，subject 最多 50 字，新建省略为空串，空值为通用观察。active 的同学员、同科目、同标签、同类型不重复；同科目知识点 active weak 与 strong 冲突时抛出可读错误，先调整旧标签。科目规范化用于比较，不私自合并科目别名。
- plan: `{id,studentId,title,body,dueDate,status,result,sourceEvidence}`，title/body 必填，dueDate 可空，status = todo/done；result 默认空；sourceEvidence 字符串数组，是保存当时的证据快照。

暴露这些同步函数：
- `createDatabase(demo = false)`：false/省略返回所有数组为空的库，true 返回上述 3 分类与 10 份示例、40 成绩、8 标签、1 计划；日期以今天为参照。何时播种由存储层判断，读取/校验空库不播种。
- `addExampleStudents(db)`：供用户明确点击首页按钮后调用；先全量校验并克隆，再一次性追加 10 份示例、40 成绩、8 标签、1 计划。存在任一 isExample=true 的档案时整批拒绝，不补齐或重复追加。按规范化分类名复用已有分类，保留原默认满分；缺少时才新增分类。示例成绩按原得分比例适配目标分类满分。所有新增记录重新生成不冲突的 ID 并映射引用，不依赖 demo ID、不覆盖旧记录；成功 revision 加一，校验/容量等失败不产生部分修改。删除示例后不自动调用本函数。
- `saveCategory(db, input) / removeCategory(db, id)`：新增/编辑分类，删除被任何学员引用的分类时拒绝并提示先移出学员；绝不级联删除学员。
- `saveStudent(db, input) / deleteStudent(db, id)`
- `saveScore(db, input) / deleteScore(db, id)`
- `saveTag(db, input) / deleteTag(db, id)`
- `savePlan(db, input) / deletePlan(db, id)`
- save 函数 input.id 不传为新增，传 id 为编辑，传未知 id 则报错。全部 mutation 返回新 db，不改输入。删除学员级联删除关联记录，UI 必须确认。
- `suggestions(db, studentId, today?)`：返回 `[{key,title,body,evidence:[]}]`；可追溯到标签、记录；空档案给补充观察建议。根据 weak/strong/habit 生成具体可执行动作。不同考试只描述得分率，不判定教学因果/能力变化，不自动新增标签/计划。
- `validateDatabase(input)`：校验完整形状、类型、长度与引用，拒绝重复 ID/分类名、非法分类引用、越界成绩、非法日期、跨档案改挂、孤儿及已选科档案内不同非空科目；返回清理后的版本 4 克隆，剥离多余字段。仅接受版本 1/2/3/4，v4 严格校验 categories 及 categoryId。
- `exportDatabase(db)`：JSON 字符串，严格校验后导出。
- `importDatabase(text)`：JSON 解析与全量校验，失败不改原库。备份包含全部分类及其默认满分、档案和关联记录；UI 预检显示分类数量，恢复完整替换当前库，须确认并允许先备份，不自动合并。核心不单独提供 summary/preview API。
- `today()`：本地日期。

编辑已有成绩/标签/计划时 studentId 必须等于原记录，不能重挂其他学员。Core 保存时统一将字符串数值输入转换为数字（成绩 score/total、分类 total），拒绝空或非数字；导入/校验必须为数字类型。所有 save 输入字段显式校验并归一化，无默默补造日期或学生。

编辑学员时完全省略 subject/isExample/className/categoryId 必须保留原值；显式空串或 false 才按传入值处理。移动到另一分类、清空分类或修改分类满分都不改任何历史成绩的得分/满分。档案已有明确 subject 时，成绩/标签不能使用另一非空科目，空通用标签及未分类成绩可保留。修改档案学科与已有明确成绩/标签冲突时整体拒绝并提示整理历史，不能暗改历史。

版本 1/2 先全量校验，再提取该档案全部成绩/标签明确的非空科目。按 NFKC、大小写及空白规范化去重，只有唯一值才赋给 student.subject；多个或没有则留空待整理。不猜测语义别名、姓名、题目或标签，不拆档、不复制。保留编号、revision、className 和全部原记录；isExample 默认 false，不凭名称识别旧示例。版本 3 迁移及版本 4 读取不重新推导 subject/isExample。版本 1/2/3 迁移统一添加 categories=[] 和 student.categoryId=''，不按年级猜分类，不补新示例，不更改历史 score.total。

原有安全边界不变：原子不可变修改、成功修改 revision 加一、动态读取字段及原型污染保护。容量为分类 100、学员 500、成绩/标签各 10000、计划 5000，规范化 JSON 长度上限 2 Mi 字符；原生存储另设 900 KiB 写入边界。失败不发布部分状态。

编辑已有成绩/标签时，旧调用方省略 subject 保留已有科目；显式空串表示清空，非字符串不得吞错。成绩建议只引用同科记录；未分类仅帮助整理，不猜科。明确英语才应用英语启发式，动作使用已学材料并由教师确认。兼容核心保留其他学科门控及语文“过去”不触发英语时态的保护，不表示本版开放多科新建或启动其他项目。

## 首页对比数据接口（comparison.js，只读）

`buildComparison(db, {groupKey, subjectKey, today})` 返回 `{subjectKey,subjectLabel,subjectOptions,series,unit,max,mode,recordCount,studentCount,plottedCount,unplottedCount,unknownCount,pointCount,mixedTotals,notice}`，另导出稳定配色 `palette`。`subjectOptions` 为 `{key,label,count}`；`series` 含 `{id,name,grade,isExample,color,dash,points,latestText}`，每个 point 保留 `{id,date,title,score,total,value}`。此模块不修改库。

- groupKey 为 category.id 或 unassigned；recordCount 是本类全部档案，不受 query/todo 影响。当前科目全员进入 series，包括无成绩者，不默认截断到前 N 人。
- 科目按档案 subject 的 NFKC、大小写及空白规范化比较，不合并未知语义别名；默认英语，否则首个明确学科，可选择其他科目分别显示。unknownCount 是本类空学科档案数，不从成绩反推科目、不画未知科目线。studentCount 是当前科目档案数，plottedCount/unplottedCount 分别是有/无有效点的数量。
- 每人取最后 6 条合法、非未来、同科成绩，按 date、id 排序；同日保留相同 date，不制造缺考/缺失的 0 分。颜色与线型按全库档案位置稳定；点击名字只突出目标线，保留其余线。
- 仅最终绘制 points 的实际 total 参与量纲判断：全部一致时 mode=score、unit=分、value=原 score、max=实际 total；不同才 mode=rate、unit=%、value=得分率保留 1 位、max=100，并提示历史满分不一致。无点时用分类默认满分或 100 设置空轴，不制造线；分类满分变更不重算历史。

## 原生单库存储

- 存储键继续为 `student-manager-lite.v3.archive`，内容升级至 schema 4，不再建新键迁移层。已有此键优先使用；不存在时优先读旧 `student-manager-lite.v1.personal`，旧个人空库也有效。
- 读取旧库只做内存校验迁移，首次成功保存或恢复时才写新键；旧 personal/demo 键保留，不自动合并，不把旧示例作为个人库容错。
- 仅 archive 键和旧 personal 键都不存在时自动播种新示例；任何既有键（包括空库）都不触发自动播种。首页无示例时可由用户主动添加 10 份示例；删除后重启不自动复活，不要求清缓存，不覆盖旧库。
- 写入成功才更新状态；读写失败、损坏或内容变化提示恢复/重读，不自动清库。提交和异步确认固定档案/记录上下文，恢复使用当前库递增修订号。
- 旧辅助浏览器不承诺原生单库与表单等价；仍须保留其存储冲突保护。测试只用合成数据，不读真实旧键或桌面运行档案。

## 页面最小验收
以下为验收要求，完成情况以 [验收记录](验收记录.md) 为准，不代表全部已在微信真机通过。

“我的学员”首页的紧凑分类实心饼图以全库档案为分母，包含示例；扇区用白线分隔，选中外移 2.5px，图例显示勾选。图例选择分类后，下方 170px 高的共享日期轴折线默认展示本类当前科目全部学员。姓名图例不加描边；默认无末端编号或引导线，点姓名聚焦才显示该学员终值，其他线不隐藏；无成绩学员保留图例，缺失不当 0。query/todo 只筛更下方紧凑名册，不改变全库饼图或全类折线。分类分组 key 为 category.id 或 'unassigned'，暴露 name/label/total/count/exampleCount/ratio；未分类的 total 为 null。科目分别选图，未知学科待整理、不画线；绘制点实际满分一致用原分，不同才用得分率。详情个人 score-line 保持原有语义。

0.6.0 需核对全页清白橙配色、紧凑图表、图例与聚焦终值显示，并继续保留 0.4.0 的业务检查：实心饼图全库占比、图例选类、全员共享日期轴、点名保留其他线、量纲按实际绘制点切换、异学科与未知科目隔离、名册筛选不改全类图。验证分类新增/编辑/重名/占用删除保护、新建预选分类并进入详情、满分默认与历史不变、成绩记观察、同依据待跟进计划复用、完成后空白复测、新建/编辑/级联删除、标签/计划、全量备份恢复、坏库与写入失败、旧库迁移、清空后重启、帮助返回草稿、窄屏与大字。历史 0.3.0 核心 87/87、独立 QA 210/210 及官方模拟器 20 项实际流程通过，实际截图已由根与独立复核通过。模拟器使用合成 mock 存储，手机真实持久化、键盘与剪贴板须单独验收。
