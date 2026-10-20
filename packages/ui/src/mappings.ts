/**
 * 文案映射表（第 73 步片三落点，三张表之二：状态枚举 + 内部术语）。
 * 纪律：枚举/术语的用户可见文案只在此处定义，消费方不得再自带映射表；
 * 未命中时由调用方按场景回落（状态类回落「未知状态」，审计动作回落原键）。
 * 第三张表（错误码 → 用户文案）是 feedback.ts 的 ERROR_TEXT_MAP。
 */

/** 平台级状态枚举 → 中文（知识库状态/向量化、静态生成类型、通用流程态） */
export const STATUS_TEXT: Record<string, string> = {
  ready: "已就绪",
  pending: "处理中",
  pending_review: "待审核",
  failed: "失败",
  active: "已启用",
  disabled: "已禁用",
  incremental: "增量生成",
  full: "全量生成",
  running: "进行中",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已取消",
};

/** 状态枚举 → 用户文案；未知值回落 fallback（默认「未知状态」，不直显英文原文） */
export function statusText(
  value: unknown,
  fallback = "未知状态",
): string {
  if (typeof value !== "string" || value === "") return fallback;
  return STATUS_TEXT[value] ?? fallback;
}

/** 审计动作键 → 中文（高频先行；长尾未映射时消费方回落原键 Mono 呈现） */
export const AUDIT_ACTION_TEXT: Record<string, string> = {
  "auth.login": "登录",
  "admin.user_create": "新建用户",
  "admin.user_update": "编辑用户",
  "admin.user_delete": "删除用户",
  "admin.tenant_create": "新建租户",
  "admin.tenant_update": "编辑租户",
  "admin.tenant_delete": "删除租户",
  "admin.config_update": "更新系统配置",
  "admin.config_rebuild_vectors": "重建向量索引",
  "admin.agent_switch": "切换智能体开关",
  "admin.kb_create": "新建知识文档",
  "admin.kb_delete": "删除知识文档",
  "admin.kb_reembed": "重新向量化",
  "admin.kb_approve": "批准知识内容",
  "admin.kb_reject": "驳回知识内容",
  "app.create": "新建应用",
  "app.delete": "删除应用",
  "app.site_update": "更新站点设置",
  "app.status_change": "应用状态变更",
  "app.access_blocked": "应用访问被拦截",
  "asset.create": "上传资产",
  "asset.delete": "删除资产",
  "data.create": "新建数据",
  "data.update": "编辑数据",
  "data.delete": "删除数据",
  "design.save_draft": "保存设计草稿",
  "design.publish": "发布应用",
  "design.rollback": "回滚应用版本",
  "grant.create": "新建运营授权",
  "grant.revoke": "撤销运营授权",
  "member.register": "会员注册",
  "member.roles_update": "会员角色任命",
  "member.status_update": "会员状态变更",
  "member.password_reset": "会员重置密码",
  "member.checkout": "会员结算下单",
  "member.pay": "会员支付",
  "member.order_cancel": "会员取消订单",
  "member.sso.authorize": "会员单点登录授权",
  "member.sso.center_login": "会员中心登录",
  "member.sso.consent": "会员授权同意",
  "member.sso.exchange": "会员单点登录换票",
  "member.sso.revoke": "会员单点登录撤销",
  "pay.notify": "支付回调",
  "public.submission_approve": "审核通过提交",
  "public.submission_reject": "审核驳回提交",
  "setup.run": "执行初始化",
  "support.session_create": "新建咨询会话",
  "support.handoff": "转人工",
  "support.faq_draft": "沉淀 FAQ 草稿",
  "support.turnstile_unreachable": "人机验证不可达",
  "theme.upload": "上传主题",
  "theme.upload_rejected": "主题上传被拒",
  "workflow.webhook": "流程 Webhook 回调",
  "assistant.action.create": "助手动作创建",
  "ai.gate_blocked": "AI 熔断拦截",
};

/** 审计动作键 → 中文；未映射返回 null（消费方回落原键呈现，不伪造文案） */
export function auditActionText(action: unknown): string | null {
  if (typeof action !== "string" || action === "") return null;
  return AUDIT_ACTION_TEXT[action] ?? null;
}
