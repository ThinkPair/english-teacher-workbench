---
type: implementation_reference
layer: product
status: active
validity: current
retrieval: on_demand
privacy: private
effective_from: '2026-10-06'
---

# 学员手记 0.6.0：白色工作台与克制橙色重点

## Design target
- Product: 学员手记英语教师微信原生小程序；名称未完成平台核名
- Screen: 档案首页、个人档案、分类管理、全部录入表单、备份、使用帮助
- Surface and viewport: 微信手机原生，主验390×844逻辑像素；窄屏320宽与大字布局补查
- Intended user: 覆盖小学、初中、高中的英语教师；公开文案不写私人身份
- 30-second outcome: 用饼图看清分类占比，选类后在同一张折线图比较本类全部同科学员，再突出一位并进入档案
- Primary action: 选分类，在全类图中突出查看一名学员
- Supporting actions: 填称呼和年级新建英语档案并预选当前分类、无示例时主动添加10个示例学员、维护分类和默认满分、记成绩与观察、建议转计划、备份

## Visual anchors
- Primary style anchor: D:/个人资料与项目/02_工作资产与参赛/生意有谱-界面截图/02-数据看板.png，已实际打开；用户明确选择生意有谱方向
- Primary anchor role: 沿用参考的主次操作、统一控件与留白节奏；用户已否定其机械暖色移植，因此画布改冷白、文字深灰、行动色少量橙色；适配原生手机单列
- Secondary anchor 1: 同文件夹01-问题看板.png，已实际打开
- Secondary anchor 1 role: 分组控件与主次操作关系，桌面侧栏不搬到手机
- Secondary anchor 2: 同文件夹04-对话页-AI回答带方法引用.png
- Secondary anchor 2 role: 依据与下一步动作的分区，由独立设计审查实际打开
- Negative reference: tests/wechat-simulator-0.5.0/01-home-warm-pie.png，用户最新拒绝的大面积黄褐、文字粗重及层层套框；0.4绿色同样不是正向锚；保留其已确认的饼图及全员折线逻辑
- Rejected traits: 示例与正式切换；新档案要求班级；首页一人一张孤立趋势图；不同满分或学科直接混比

## Information hierarchy
- Visual hero: 当前分类全部同科学员共享坐标的多序列折线图，每人一条线
- First eye-line: 分类饼图和带数量占比的分类图例，选中项清楚
- Second eye-line: 当前类成绩对比、共同分值尺度和学员图例
- Third eye-line: 紧凑档案名册、搜索、待跟进和个人详情入口
- Deliberately de-emphasized: 示例仅在档案标记，帮助解释；不在首页显示教程长文
- Off-screen or later routes: 使用帮助与备份恢复，详细成绩、标签和计划在个人档案内

## Visual tokens
- Grid and margins: 手机单列；外边距32rpx，卡内28–32rpx，卡间24rpx；图例两列，长分类不挤占按钮
- Spacing scale: 8/12/16/24/32rpx
- Chinese type family and weights: PingFang SC / Microsoft YaHei / 系统字体；正文400，标题600
- Numeric type family and weights: 系统sans-serif，成绩与计数600
- Type scale: 首页标题42rpx/600，分组30rpx/600，正文28rpx/400，说明23–24rpx；图表标签12px；主标题#202631，正文#303642，次要文字#737C89
- Canvas color: #F6F7F9
- Surface colors: #FFFFFF / #F3F5F8
- Primary accent: #CB4A20
- Data category colors: 橙#E4774D、蓝#4D7CE8、金#8A70D6、紫#2C9E9B、青#D88637、砖红#CF6B89、灰蓝#6374AF、褐#6B9380；数据色只在饼图、折线和对应图例，编号/虚实线辅助识别
- State colors: 示例浅米色文字徽标；错误#AD4535；成功#437562，均有文字；不把绿色继续用作品牌色
- Radius: 卡24rpx，输入14rpx，按钮16rpx，胶囊仅用于小状态
- Border: 1rpx #E9ECF1
- Shadow, blur, and texture: 卡片无阴影，白色表面配极细冷灰边线，无模糊、纹理和渐变
- Icon family and stroke: 采用MIT许可Tabler Outline统一描边图标，用本地静态资产；不再用符号充当导航、搜索或新增图标
- Memorable brand move: 90%左右白与冷灰基底，橙色只占少量操作和选中状态；正文深灰，数据颜色明净，取消姓名图例常驻描边

## Chart system
- Hero chart and purpose: 本类全部同科学员共用横纵轴，各取最近6条非未来同科成绩，每人一条线；用户明确要求全部，因此覆盖Skill默认最多三条线的建议，不截断学员
- Supporting chart 1 and purpose: 实心饼图按分类档案数绘制，占比以全库档案数为分母；零人数分类仍可在文字图例选择，不伪造面积
- Supporting chart 2 and purpose: 个人详情保留score-line单人成绩得分率图，首页group-lines用于本类比较
- Stroke and marker language: 普通线约2px、选中约3px，单点仍可见；色和虚实线辅助姓名编号识别，不用平滑插值
- Grid and axis language: 所有入图记录满分一致则纵轴0至共同满分（分）；不一致自动用0至100得分率（%）并说明。横轴共享真实日期间距，同日同x，不把各人的第N次强行对齐
- Label and annotation language: 轴带单位；图例显示编号、姓名、最新原分；只对突出序列显示末点值，避免多学员端点文字碰撞；完整明细在档案内
- Hover and selection: 饼图旁图例选分类；点学员图例突出曲线，再点恢复全显；下方按钮打开该档案。名册搜索与待跟进只筛名册，图始终本类全部，明示范围
- Empty and missing states: 0条显示待记录；1条仅一个点不画趋势；未来日期/不同学科不纳入当前折线；不把缺失当0

## Data semantics
- Event units: 每条成绩是一场测评；共同实际满分一致时比较原分，不一致时按各次分母折算百分比。满分相同也不代表卷面难度相同，不推断能力或教学效果；分类默认满分仍只预填，不改历史
- Person units: 每份档案单科，本版新档固定英语；按ID计档案份数，重名不合并，不声称去重人数；categoryId决定分类，年级保留个人字段
- Order units: 不涉及订单
- Revenue units: 不涉及收入
- Conversion denominators: 构成占比以当前全部档案数为分母，包含明确标记的示例；不显示转化率
- Cross-source deduplication rule: ID识别档案，不按姓名合并；不自动合并旧示例与正式库；分类名按规范化值去重，分类ID不得占用系统保留的unassigned
- Evidence states: 手工录入；示例虚构；已有/导入历史不静默改英语，旧多科无唯一学科时提示待整理、不混线；旧1/2/3迁移后分类为空，档案归未分类，v3学科与示例标记不重推导
- Demo-data label: 新示例isExample=true、可普通编辑删除；首次无archive库及旧personal才放10份英语示例，小学英语4/初中英语3/高中英语3，分类默认满分100/120/150，每档4成绩，共40成绩/8标签/1计划；分类可自定义、年级不限制，已有空库或删空不自动再生成；0.3.1首页无示例时显示“添加10个示例学员”，点击后原子追加，复用同名分类并保留其满分、示例成绩按比例适配，不清缓存、不覆盖旧档案

## Interaction
- Default time range: 每人最近6条非未来同科成绩，同图按真实日期排序；缺少测评不补0、不按序号假定同一次考试
- Filters: 分类同时控制对比图和名册；搜索/待跟进仅筛名册。旧档案不同学科分开选取，未知学科提示未入图。饼图计数始终全库，不随名册筛选变化
- Primary interaction flow: 档案首页→饼图图例选类→全类成绩同图→点姓名突出→开个人档案继续记成绩/观察/跟进；分类管理和主动追加示例保留
- Drill-down target: 同一份单学科档案，保留返回时的组选择
- Keyboard and focus expectations: 新建填称呼/年级并可选分类，固定显示英语；其他年级可用，历史科目保留；分类名称和默认满分可维护，占用分类须先移出学员才可删除；手机键盘需真机验收，模拟器检查输入保存
- Responsive fallback: 320宽仍单列；长中文换行，折线按容器重绘；图形缺失时原始数值仍可读

## Working UI versus sales image
- Working UI priorities: 真实操作、构成清楚、成绩可读、旧档案不丢、没有多余首屏教程
- Sales image priorities: 本轮不制作宣传物料
- Elements allowed only in sales image: 不适用；不加营销设备模型和口号

## Implementation
- Existing runtime or template: 当前原生miniprogram工程，保留真实AppID与本地数据安全包装；schema4读1/2/3/4，继续使用student-manager-lite.v3.archive键；全量备份包含分类，恢复整体替换
- Chart implementation: category-pie与group-lines新增组件，score-line保留个人详情；均Canvas2D离屏生成本机临时图→普通image避免遮住导航；comparison纯函数聚合，不改存储或联网
- Token implementation: app.wxss统一语义色和空间变量，页面与图表共享中性白底规范，保留已验证的原生button/input尺寸规则
- Fonts and asset sources: 操作系统中文字体；Tabler Outline官方MIT图标，随包本地保存，无运行时外部请求
- Realistic data source: 同库虚构10份英语档案，每档4次成绩；小学英语4/初中英语3/高中英语3，默认满分100/120/150，共40成绩/8标签/1英语计划；标签覆盖词汇/语法/阅读/习惯/强项，教师按学段选已学材料；真实数据不进入测试

## QA acceptance
- Primary reference viewport: 实际微信模拟器390×844；桌面主锚用于视觉语言，不伪称桌面与手机像素级复刻，另用当前与新版同尺寸手机截图核对层级
- Thumbnail test: 上饼图分类、下一张全类折线图，主图层级明显，无多张个人趋势卡和欢迎长文
- Long-label test: 长称呼/年级/分类名、固定英语和历史科目、重名均能显示且不错误合并；不把示例年级或分类作为可用范围
- Zero, missing, and extreme-value test: 无档案、空分类、占用分类删除拒绝、重复分类拒绝、默认满分变更历史不变、单点、0/100%得分率、未分类、未来/同日成绩、含分类备份恢复、导入损坏/写入失败与旧1/2/3迁移
- Reference-comparison passes: 宏观信息结构、微观对齐、数据压力三轮；以真实微信截图和操作回执为证据
- Accessibility checks possible from implementation: 文字数值与标签不依赖颜色或canvas；读屏与真实手机字体缩放不冒称通过

本轮修订依据：用户再次否定0.5.0审美；此前功能通过不等于用户认可视觉。本轮先用同一原生首页做「清白橙」和「冷白蓝」两种强调色对照，均遵守同一信息层级，默认交付更接近指定参考的清白橙。变更限视觉展示，不改变学生、成绩、分类、备份语义。实际模拟器样张作为实现证据，不使用生成效果图冒充。

最终实现验证：130项回归、官方12项多人图与10项全页流程通过，另核验帮助按钮文案；实际预览码已生成。清白橙为默认交付候选，用户视觉认可仍待反馈，细节见design-qa.md。
