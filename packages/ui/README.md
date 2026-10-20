# @lcdp/ui — B 端设计基线共享包

第 73 步建立：基线令牌单一事实源（片一）+ 共享组件与反馈约定落码（片二）。
admin / runtime / studio / renderer 四方消费；新代码不得在各端再自带下列能力的副本。

## 令牌（tokens.ts）

- 基线色值、圆角、主题（desktopTheme）、密度档只在此定义；各端 ConfigProvider 与
  手写样式一律引此。`.css` 文件无法引 TS，其值须与 tokens 保持一致、变更时两处同改。
- 值沿第 49/50 步基线，变更令牌值 = 变更全平台视觉，须单独拍板。

## 三态（states.tsx）

- 加载：`LoadingState`（block = 居中留白块；非 block = 行内 Spin，容器自备留白）。
- 空：`EmptyState`（antd Empty 简单图；缺省文案「暂无数据」，业务空态传具体描述）。
- 错误：见下「报错」——列表/页面级失败用页内 Alert 或 showError，不得静默。

## 分页（PageTable.tsx）

分页只有三式且必须显式选式：服务端分页 `serverPage`（唯一默认形态，固定
showSizeChanger + showTotal「共 N 条」）、客户端分页 `clientPageSize`、不分页
`noPagination`。计数文案确需特化（如「个资产」）经 `totalText` 覆盖。

## 状态呈现（status.tsx）

- 状态值一律经 `StatusTag` 渲染（pill 单点）。页面自有映射经 `meta`
  （值 → {text, tone}）传入；组件级覆盖经 `colors`（值 → tone）传入；
  无映射时走平台默认色板（待*→琥珀、已完成/已通过/已发布/已解决/正常/启用→绿、
  已支付/已发货/进行中/处理中→蓝、已驳回/已拒绝/失败/异常→红、草稿/未开始/
  已取消/已下线→灰，未知回退灰）。
- 状态的**中文文本映射**（英文枚举 → 中文）落 `mappings.ts` 的 `STATUS_TEXT`
  （`statusText()` 消费，未知回落「未知状态」）；审计动作键的中文映射同文件
  `AUDIT_ACTION_TEXT`。新增枚举/术语文案先查这两张表，不得在页面内散写。

## 报错（feedback.ts）

- 前端错误统一经 `showError(err)`：映射表优先（键 = err.code 或原始 message，
  片三填充）、未命中回落 err.message、空原文回落兜底文案。
- **禁止静默 catch**：请求失败必须可见（toast 或页内 Alert，与同页既有失败呈现同形）。
  例外仅限内部守卫型 catch（JSON 解析容错、表单 validateFields 中止、能力探测），
  须在代码注释或记账中注明属白名单。

## 确认（feedback.ts）

- 破坏性 / 不可逆操作（删除、下架、重置等）：`Modal.confirm`（经 `confirmDanger`
  封装，确认钮 danger）。
- 轻量、可撤销的操作：`Popconfirm`。
- 二者不得混用：同一动作全平台只许一种确认形态。

## 格式化（format.ts）

- 时间 `fmtTime`（zh-CN、hour12:false、失败回「—」或原样，口径见函数注释）、
  金额 `fmtAmount`（¥ + 两位小数）、错误文本 `errText` 只此一份实现，各端禁自带副本。
