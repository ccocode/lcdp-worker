import type {
  DataSchema,
  PageSchema,
  PermissionSchema,
  PublicPolicy,
} from "@naka1205/schema";
import type {
  AggregateGroupItem,
  AssetLinkage,
  AssetMeta,
  EntityAccess,
  ListResult,
  Row,
  RuntimeAdapter,
  SelectOption,
  SupportTranscriptData,
  ViewFilter,
} from "@lcdp/renderer";

/**
 * 平台 api 客户端（M11 起经 Worker 网关 api.coode.cc.cd 转发回源；
 * M1–M10 的 service.coode.cc.cd 直连为临时形态，已收口）。
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.coode.cc.cd";

const TOKEN_KEY = "lcdp.token";
const USER_KEY = "lcdp.user";

export interface UserInfo {
  id: string;
  username: string;
  role: string;
  tenantId: string;
}

export interface AppInfo {
  id: string;
  name: string;
  scenario: string | null;
}

/** 当前用户在本应用的有效访问摘要（服务端按角色计算，前端透传渲染器做呈现门控） */
export interface MyAccess {
  entities: Record<string, EntityAccess>;
}

export interface Snapshot {
  app: AppInfo;
  data: DataSchema;
  pages: PageSchema[];
  /** 应用配置（主题令牌等），来自设计包的 appConfig；shell/globalVars 为 M10 起宽松读取（服务端原样回传配置体） */
  appConfig: {
    theme: Record<string, unknown>;
    /** 外壳形态：site = 站点型外壳，其余/缺省 = 系统外壳（M10） */
    shell?: string;
    /** 全局变量（站点外壳取 siteSearchRoute / siteFooter 等，M10） */
    globalVars?: Record<string, unknown>;
  } | null;
  /** 当前发布版本号（未发布为 null） */
  version: number | null;
  /** 已发布的权限配置（未发布权限时为 null → 旧行为全权） */
  permissions: PermissionSchema | null;
  /** 当前用户的有效访问摘要（透传渲染器 access 做呈现门控） */
  myAccess: MyAccess | null;
}

/** 站点目录项（第 68 步站点模型：应用即站点事实源，入口装配退役） */
export interface SiteDirectoryItem {
  id: string;
  name: string;
  scenario: string | null;
  isPrimary: boolean;
  boundHost: string | null;
  nameEn: string | null;
  /** 应用访问地址：绑定域名根路径，或默认域名 /<应用ID>/ */
  url: string;
}

/**
 * 站点解析结果（/site/current 与 /public/site.site 同形状）：
 * mode=app 时 app 为当前作用域应用，via 决定路径前缀（path 时前缀 = /<URL 首段>）；
 * mode=redirect 为根域——引导层整页跳 defaultHost 并保留路径；
 * mode=shell 为未托管 host 的兜底装配（目录中主应用 + 未绑应用）。
 */
export interface SiteInfo {
  mode: "app" | "member-center" | "shell" | "redirect";
  via: "bound" | "primary" | "path" | null;
  defaultHost: string;
  app: {
    id: string;
    name: string;
    nameEn: string | null;
    scenario: string | null;
    isPrimary: boolean;
    boundHost: string | null;
  } | null;
  siteMode: string;
  kind: string | null;
  apps: SiteDirectoryItem[];
}

/** 流程待办任务（GET /flow/todos）；record 为服务端按权限整形后的记录行 */
export interface FlowTodoTask {
  id: string;
  instanceId: string;
  workflowId: string;
  entity: string;
  recordId: string;
  nodeLabel: string;
  /** 或签 any / 会签 all */
  mode: "any" | "all";
  createdAt: string;
  instance: { createdByName: string; createdAt: string };
  record: Row;
}

/** 我处理过的任务（GET /flow/done），倒序 */
export interface FlowDoneTask {
  id: string;
  instanceId: string;
  workflowId: string;
  entity: string;
  recordId: string;
  nodeLabel: string;
  /** 本人的处理结果 */
  status: "approved" | "rejected";
  comment: string | null;
  actedAt: string;
  createdAt?: string;
  record: Row;
}

/** 我发起的流程实例（GET /flow/mine） */
export interface FlowMineInstance {
  id: string;
  workflowId: string;
  entity: string;
  recordId: string;
  status: "running" | "approved" | "rejected";
  currentNodeLabel: string | null;
  pendingAssignees: string[];
  createdAt: string;
  updatedAt: string;
  record: Row;
}

/** 流程事件（通知流与进度时间线共用） */
export interface FlowEvent {
  id: number | string;
  instanceId: string;
  /** start/task_created/approve/reject/urge/task_action/webhook/low_stock/complete/cc */
  kind: string;
  actor: string | null;
  /** actor 的显示名（服务端按 username 解析 platform_users.display_name；system 等非用户 actor 回退为 actor 原值） */
  actorName: string | null;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

/** 流程实例（进度详情） */
export interface FlowInstance {
  id: string;
  workflowId: string;
  entity: string;
  recordId: string;
  status: "running" | "approved" | "rejected";
  currentNode: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

/** 实例下的单个审批任务（进度详情） */
export interface FlowInstanceTask {
  id: string;
  nodeId: string;
  nodeLabel: string;
  assigneeUserId: string | null;
  assigneeRole: string | null;
  /** 审批人显示名（服务端 COALESCE display_name/username；角色指派未落实到人时为 null） */
  assigneeName: string | null;
  mode: "any" | "all";
  status: "pending" | "approved" | "rejected" | "cancelled";
  comment: string | null;
  actedBy: string | null;
  /** 处理人显示名（服务端按 actedBy=username 解析 display_name，回退为 username） */
  actedName: string | null;
  actedAt: string | null;
  createdAt: string;
}

export interface FlowInstanceDetail {
  instance: FlowInstance;
  tasks: FlowInstanceTask[];
  events: FlowEvent[];
}

/** 可发起查询（GET /flow/startable/:entity）：workflow 为 null = 该实体未绑定已发布流程 */
export interface FlowStartable {
  workflow: { id: string; title: string } | null;
  records: Row[];
}

/** 助手对话的页面上下文（外壳按当前路由尽力推导，服务端仅作提示） */
export interface AssistantContext {
  /** 当前页路由（应用内路径，如 /e/purchase_order 或设计页 route） */
  path: string;
  pageName?: string;
  entityKey?: string;
  recordId?: string;
}

/** 制度问答引用（租户知识库片段，UI 渲染为来源 chips） */
export interface AssistantCitation {
  docTitle: string;
  snippet: string;
}

/** 待确认写动作（助手消息携带；确认/取消都经服务端确定性执行，LLM 不在执行环内） */
export interface AssistantPendingAction {
  /** createRecord / fillForm / flowStart / flowAct / flowUrge 等 */
  kind: string;
  summary: string;
  fields: { label: string; value: unknown }[];
  /** 已确认或已取消后为 true，UI 渲染为禁用态 */
  handled?: boolean;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | string;
  text: string;
  citations?: AssistantCitation[];
  pendingAction?: AssistantPendingAction;
  /** generating / done / failed 等（生成中消息轮询未结束） */
  status?: string;
  createdAt?: string;
}

export interface AssistantConversation {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** fillForm 执行指令：前端写 sessionStorage 后跳派生表单回填（不直接落库） */
export interface AssistantFillForm {
  entity: string;
  values: Row;
  items?: Record<string, Row[]> | Row[];
}

export interface AssistantConfirmResult {
  ok: boolean;
  executed: boolean;
  fillForm?: AssistantFillForm;
  message?: string;
}

/** 客服咨询窗配置（M12 support/config，公开可读）：enabled 决定是否渲染咨询窗 */
export interface SupportConfig {
  enabled: boolean;
  title?: string;
  /** Turnstile 站点密钥；null = 未启用 Turnstile（限流模式），前端不渲染 widget */
  turnstileSiteKey: string | null;
}

/** 客服会话消息（与助手消息同构；role 含 visitor/user、assistant、system 三态） */
export interface SupportMessage {
  id: string;
  role: string;
  text: string;
  citations?: AssistantCitation[];
  /** 待确认动作（kind='humanHandoff' 时为转人工提案卡） */
  pendingAction?: AssistantPendingAction;
  status?: string;
  createdAt?: string;
}

/** 客服会话头（访客详情与坐席列表共用字段的宽容视图） */
export interface SupportSessionInfo {
  id: string;
  /** active / handoff / closed */
  status?: string;
  ticketId?: string | null;
  rating?: number | null;
  summary?: string | null;
  visitorName?: string | null;
  updatedAt?: string;
  messageCount?: number;
}

export interface SupportSessionDetail {
  session: SupportSessionInfo;
  messages: SupportMessage[];
}

/** 会员策略（平台 permissions.member，形状与公开策略不同构：readable/writable 为实体 key 列表） */
export interface MemberPolicy {
  /** 会员可见页面 route 列表（外壳据此装配会员页与菜单） */
  pages: string[];
  /** 会员可读实体 key 列表 */
  readable: string[];
  /** 会员可写（新建/改己行）实体 key 列表 */
  writable: string[];
  /**
   * 会员可写字段白名单（商城线）：实体 key → 允许会员写的字段键数组；
   * 未声明的实体沿用实体级 writable 口径（全字段可写）。
   * TODO(mall-schema-0.10.0): @naka1205/schema 0.10.0 memberPolicySchema 落地后与之对齐
   */
  writableFields?: Record<string, string[]>;
  /** 归属映射：实体 key → 归属字段 key（行读写强制归属当前会员） */
  owners: Record<string, string>;
}

export const EMPTY_MEMBER_POLICY: MemberPolicy = {
  pages: [],
  readable: [],
  writable: [],
  owners: {},
};

/** 应用会员简档（注册表 platform_app_members 的前端视图，不含凭据） */
export interface MemberInfo {
  id: string;
  identifier: string;
  displayName: string | null;
  scope: string;
  tenantId?: string;
}

/** 会员侧治理角色（第 60 步 R2）：与 api /me 载荷 roles 同形，前端治理控件据此显隐 */
export interface MemberRoleGrant {
  key: string;
  label: string;
  entityAccess: { entity: string; actions: string[] }[];
}

/** 会员会话（localStorage `lcdp.member.<host>` 的存储体；与员工/访客键隔离） */
export interface MemberSession {
  token: string;
  member: MemberInfo;
  policy: MemberPolicy;
  appId: string;
  /** 被授予的治理角色（第 60 步 R2；旧会话无此字段时按空集，/me 刷新后补齐） */
  roles?: MemberRoleGrant[];
}

/** 注册/登录成功响应（令牌 + 简档 + 当前已发布会员策略） */
export interface MemberAuthResult {
  token: string;
  member: MemberInfo;
  policy: MemberPolicy;
  /** 被授予的治理角色（第 60 步 R2；注册恒空） */
  roles?: MemberRoleGrant[];
}

/** 会员结算请求体（商城线）：不带金额，服务端按现价重算 + 价快照 + 扣库存 */
export interface MemberCheckoutBody {
  items: { productId: string; quantity: number }[];
  contact_name: string;
  contact_phone: string;
  address: string;
  remark?: string;
}

/** 会员结算结果：order 为新建订单行，total 为服务端重算总额 */
export interface MemberCheckoutResult {
  order: Row;
  total: number;
}

/** 支付单（商城线，payment 实体的前端视图） */
export interface MemberPayment {
  id: string;
  order_id?: string;
  provider: string;
  amount: number | string;
  status: string;
  trade_no?: string;
  [key: string]: unknown;
}

/** 发起支付结果：payment 为支付单行，payUrl 为渠道支付页地址（沙箱 = 平台沙箱支付页） */
export interface MemberPayResult {
  payment: MemberPayment;
  payUrl: string;
}

function memberSessionKey(host: string): string {
  return `lcdp.member.${host}`;
}

/** 读本机存的会员会话；appId 不符（同 host 换过主应用）视为无会话 */
export function loadMemberSession(
  host: string,
  appId: string,
): MemberSession | null {
  try {
    const raw = localStorage.getItem(memberSessionKey(host));
    if (!raw) return null;
    const s = JSON.parse(raw) as MemberSession;
    if (!s || typeof s.token !== "string" || !s.member || s.appId !== appId) {
      return null;
    }
    return {
      token: s.token,
      member: s.member,
      policy: { ...EMPTY_MEMBER_POLICY, ...(s.policy ?? {}) },
      appId: s.appId,
      roles: Array.isArray(s.roles) ? s.roles : [],
    };
  } catch {
    return null;
  }
}

export function storeMemberSession(
  host: string,
  session: MemberSession | null,
): void {
  if (session) {
    localStorage.setItem(memberSessionKey(host), JSON.stringify(session));
  } else {
    localStorage.removeItem(memberSessionKey(host));
  }
}

/* ---------- 会员 SSO（授权流）：中心会话与跳转流暂存 ---------- */

/**
 * 会员中心会话（account 域 localStorage `lcdp.memberCenter`）：令牌为
 * aud='member-center' 的专用令牌，只在会员中心页组使用，与各应用的
 * 会员会话（lcdp.member.<host>）互不通用、互不覆盖。
 */
export interface CenterSession {
  token: string;
  member: MemberInfo;
}

const CENTER_SESSION_KEY = "lcdp.memberCenter";

export function loadCenterSession(): CenterSession | null {
  try {
    const raw = localStorage.getItem(CENTER_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CenterSession;
    if (!s || typeof s.token !== "string" || !s.member) return null;
    return s;
  } catch {
    return null;
  }
}

export function storeCenterSession(session: CenterSession | null): void {
  if (session) {
    localStorage.setItem(CENTER_SESSION_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(CENTER_SESSION_KEY);
  }
}

/** SSO 跳转流在应用源 sessionStorage 的暂存键（state/回跳路径/应用；回调校验后即清） */
export const SSO_STATE_KEY = "lcdp.sso.state";
export const SSO_RETURN_KEY = "lcdp.sso.return";
export const SSO_APP_KEY = "lcdp.sso.app";

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 发起 SSO 授权流：暂存 state（回调防伪校验）、回跳路径与应用 id，
 * 返回会员中心授权页 URL，调用方整页跳转（window.location.assign）。
 * 授权完成后中心把浏览器带回 `<本源>/sso/callback?code&state`。
 */
export function beginSsoAuthorize(
  centerBase: string,
  appId: string,
  returnTo: string,
): string {
  const state = randomState();
  try {
    sessionStorage.setItem(SSO_STATE_KEY, state);
    sessionStorage.setItem(SSO_RETURN_KEY, returnTo);
    sessionStorage.setItem(SSO_APP_KEY, appId);
  } catch {
    // sessionStorage 不可用（隐私模式等）：回调将因缺 state 报错并引导重登
  }
  const qs = new URLSearchParams({
    app: appId,
    redirect_uri: `${window.location.origin}/sso/callback`,
    state,
  });
  return `${centerBase.replace(/\/$/, "")}/authorize?${qs.toString()}`;
}

/** 会员 SSO 下发信息（/public/site.memberSso）：enabled 时登录入口改走会员中心授权流 */
export interface MemberSsoInfo {
  enabled: boolean;
  centerBase: string;
}

/** 公开（匿名）入口解析结果：primary 为入口首个应用的公开面（无公开页时为 null） */
export interface PublicSiteResult {
  entry: {
    id: string;
    name: string;
    /** 平台内置入口标记（如 "member-center" 会员中心）；普通入口 null/缺省 */
    kind?: string | null;
  } | null;
  apps: AppInfo[];
  /** 会员 SSO 开关（主应用会员域命中启用清单时 enabled；缺省视为未启用） */
  memberSso?: MemberSsoInfo;
  /** 第 68 步站点解析（新模型托管 host 才有；旧路径/未迁移时为 null） */
  site?: SiteInfo | null;
  primary: {
    appId: string;
    name: string;
    /** 仅含公开策略声明的页面（已发布设计页 ∪ 派生页中 route ∈ public.pages 者） */
    pages: PageSchema[];
    /** 仅含公开可读/公开表单涉及的实体定义 */
    data: DataSchema;
    appConfig: {
      theme: Record<string, unknown>;
      /** 外壳形态：site = 站点型外壳，其余/缺省 = 系统外壳（M10） */
      shell?: string;
      /** 全局变量（站点外壳取 siteSearchRoute / siteFooter 等，M10） */
      globalVars?: Record<string, unknown>;
    } | null;
    /** 公开策略（决定哪些实体可读、哪些可提交表单） */
    public: PublicPolicy;
    /** 会员策略（会员试点）：非空 pages 时外壳呈现会员区，会员页数据由 /member 面执法 */
    member: MemberPolicy;
  } | null;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserInfo) : null;
  } catch {
    return null;
  }
}

export function storeSession(token: string | null, user: UserInfo | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string })
    | null;
  if (!res.ok) {
    // 错误对象挂 HTTP 状态码：渲染层据此区分权限拒绝（403）与真故障（如统计卡 403 整卡隐藏）
    const err = new Error(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/**
 * 客服访客组请求（M12）：不带登录 token，能力凭证走 X-Visitor-Key 头
 * （visitorKey 只在创建会话响应中出现一次，之后由前端从本地保存回带）。
 * 错误处理与 apiFetch 同构（错误对象挂 HTTP 状态码）。
 */
async function supportFetch<T>(
  path: string,
  visitorKey?: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(visitorKey ? { "X-Visitor-Key": visitorKey } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string })
    | null;
  if (!res.ok) {
    const err = new Error(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/**
 * 会员组请求（会员试点）：凭会员令牌（Bearer）调用 /member 面，与员工令牌互斥。
 * token 由调用方经 getter 注入（外壳的会话状态是唯一事实源）；401 时回调
 * onUnauthorized 让外壳清会话回落未登录态。错误处理与 apiFetch 同构。
 */
async function memberFetch<T>(
  path: string,
  getToken: () => string | null,
  init?: RequestInit,
  onUnauthorized?: () => void,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string })
    | null;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const err = new Error(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    // 业务错误码（如 captcha_invalid / mail_not_configured）随错误透传，UI 按码分支处理
    err.code = body?.error;
    throw err;
  }
  return body as T;
}

function memberListSuffix(params?: {
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
  vf?: ViewFilter[];
  sort?: { field: string; dir: "asc" | "desc" };
}): string {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.sort) qs.set("sort", `${params.sort.field}:${params.sort.dir}`);
  for (const [k, v] of Object.entries(params?.filters ?? {})) qs.set(k, v);
  if (params?.vf?.length) qs.set("vf", JSON.stringify(params.vf));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** 授权记录（会员中心「我的授权」）：应用与授权时间，撤销后不再出现 */
export interface SsoConsentItem {
  appId: string;
  appName: string;
  grantedAt: string | null;
}

/** authorize 应答：已授权回 { code }；未授权回 { consentRequired, appId, appName } */
export interface SsoAuthorizeResult {
  code?: string;
  consentRequired?: boolean;
  appId?: string;
  appName?: string;
}

/**
 * 会员 SSO 客户端（授权流）：中心端点组 /member/sso/*。
 * centerLogin/exchange 无令牌（凭据/授权码即凭据）；其余带中心令牌
 * （aud='member-center'），401 时回调让中心页清会话回登录。
 */
export const ssoApi = {
  /** 中心登录：由 appId 推导会员域、复用 member 登录校验（含连错验证码策略），回中心令牌 + 简档 */
  async centerLogin(body: {
    appId: string;
    identifier: string;
    password: string;
    captchaId?: string;
    captchaCode?: string;
  }): Promise<CenterSession> {
    return memberFetch<CenterSession>("/member/sso/center-login", () => null, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  /** 中心会话简档（校验中心令牌有效性与会员状态） */
  async centerMe(
    getToken: () => string | null,
    onUnauthorized?: () => void,
  ): Promise<{ member: MemberInfo }> {
    return memberFetch<{ member: MemberInfo }>(
      "/member/sso/center-me",
      getToken,
      undefined,
      onUnauthorized,
    );
  },
  /** 授权判定：已授权直接发码；未授权回 consentRequired + 应用展示名（不发码） */
  async authorize(
    getToken: () => string | null,
    body: { appId: string; redirectUri: string; state?: string },
    onUnauthorized?: () => void,
  ): Promise<SsoAuthorizeResult> {
    return memberFetch<SsoAuthorizeResult>(
      "/member/sso/authorize",
      getToken,
      { method: "POST", body: JSON.stringify(body) },
      onUnauthorized,
    );
  },
  /** 确认授权：落授权记录并发码 */
  async consent(
    getToken: () => string | null,
    body: { appId: string; redirectUri: string; state?: string },
    onUnauthorized?: () => void,
  ): Promise<{ code: string }> {
    return memberFetch<{ code: string }>(
      "/member/sso/consent",
      getToken,
      { method: "POST", body: JSON.stringify(body) },
      onUnauthorized,
    );
  },
  /** 码换令牌：回该应用的会员令牌 + 简档 + 策略（与本地登录同形状） */
  async exchange(body: {
    code: string;
    appId: string;
  }): Promise<MemberAuthResult> {
    return memberFetch<MemberAuthResult>("/member/sso/exchange", () => null, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  /** 我的授权（未撤销）列表 */
  async consents(
    getToken: () => string | null,
    onUnauthorized?: () => void,
  ): Promise<{ consents: SsoConsentItem[] }> {
    return memberFetch<{ consents: SsoConsentItem[] }>(
      "/member/sso/consents",
      getToken,
      undefined,
      onUnauthorized,
    );
  },
  /** 撤销对某应用的授权（阻断后续静默换发；已发令牌自然过期） */
  async revokeConsent(
    getToken: () => string | null,
    appId: string,
    onUnauthorized?: () => void,
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/sso/consents/${encodeURIComponent(appId)}`,
      getToken,
      { method: "DELETE" },
      onUnauthorized,
    );
  },
};

/**
 * 会员客户端（会员试点）：账号端点（register/login 无令牌、me 带令牌）与
 * 会员数据面 CRUD。数据面执法在服务端（策略 + 归属），前端只透传令牌。
 */
export const memberApi = {
  /** 注册：201 返回令牌 + 简档 + 策略（注册即登录态）；captcha* 为图形验证码、emailCode 为邮箱验证码（邮件配置生效且标识为邮箱时服务端强制） */
  async register(
    appId: string,
    body: {
      identifier: string;
      password: string;
      displayName?: string;
      captchaId?: string;
      captchaCode?: string;
      emailCode?: string;
    },
  ): Promise<MemberAuthResult> {
    return memberFetch<MemberAuthResult>(
      `/member/apps/${encodeURIComponent(appId)}/register`,
      () => null,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** 登录：200 返回令牌 + 简档 + 策略；连续失败后服务端回 captcha_required，此时须带图形验证码重试 */
  async login(
    appId: string,
    body: {
      identifier: string;
      password: string;
      captchaId?: string;
      captchaCode?: string;
    },
  ): Promise<MemberAuthResult> {
    return memberFetch<MemberAuthResult>(
      `/member/apps/${encodeURIComponent(appId)}/login`,
      () => null,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** 图形验证码（自托管）：回 { captchaId, svg }，前端内联渲染 SVG、点击刷新；一次性、5 分钟有效 */
  async fetchMemberCaptcha(
    appId: string,
  ): Promise<{ captchaId: string; svg: string }> {
    return memberFetch<{ captchaId: string; svg: string }>(
      `/member/apps/${encodeURIComponent(appId)}/captcha`,
      () => null,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
  /** 发送注册邮箱验证码：须带图形验证码先过人机校验；邮件未配置时服务端回 mail_not_configured（前端降级为不强制验码） */
  async sendMemberEmailCode(
    appId: string,
    body: { email: string; captchaId: string; captchaCode: string },
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/apps/${encodeURIComponent(appId)}/email-code`,
      () => null,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  },
  /** 请求找回密码：校验图形验证码后向注册邮箱发送重置验证码（发码与请求同一端点）；邮件未配置回 mail_not_configured */
  async requestMemberPasswordReset(
    appId: string,
    body: { email: string; captchaId: string; captchaCode: string },
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/apps/${encodeURIComponent(appId)}/password-reset/request`,
      () => null,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** 确认找回密码：邮箱验证码 + 新密码，成功后回登录页签用新密码登录 */
  async confirmMemberPasswordReset(
    appId: string,
    body: { email: string; code: string; newPassword: string },
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/apps/${encodeURIComponent(appId)}/password-reset/confirm`,
      () => null,
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** 当前会员简档与最新策略（外壳恢复会话时刷新 policy 用；401 → 清会话）；roles 为治理角色（第 60 步 R2） */
  async me(
    appId: string,
    getToken: () => string | null,
    onUnauthorized?: () => void,
  ): Promise<{
    member: MemberInfo;
    policy: MemberPolicy;
    roles: MemberRoleGrant[];
  }> {
    return memberFetch<{
      member: MemberInfo;
      policy: MemberPolicy;
      roles: MemberRoleGrant[];
    }>(
      `/member/apps/${encodeURIComponent(appId)}/me`,
      getToken,
      undefined,
      onUnauthorized,
    );
  },
  data: {
    async list(
      appId: string,
      getToken: () => string | null,
      entity: string,
      params?: {
        limit?: number;
        offset?: number;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
        sort?: { field: string; dir: "asc" | "desc" };
      },
      onUnauthorized?: () => void,
    ): Promise<ListResult> {
      return memberFetch<ListResult>(
        `/member/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}${memberListSuffix(params)}`,
        getToken,
        undefined,
        onUnauthorized,
      );
    },
    async get(
      appId: string,
      getToken: () => string | null,
      entity: string,
      id: string,
      onUnauthorized?: () => void,
    ): Promise<Row | null> {
      try {
        const res = await memberFetch<{ row: Row }>(
          `/member/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
          getToken,
          undefined,
          onUnauthorized,
        );
        return res.row;
      } catch {
        return null;
      }
    },
    async create(
      appId: string,
      getToken: () => string | null,
      entity: string,
      data: Row,
      onUnauthorized?: () => void,
    ): Promise<Row> {
      const res = await memberFetch<{ row: Row }>(
        `/member/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}`,
        getToken,
        { method: "POST", body: JSON.stringify(data) },
        onUnauthorized,
      );
      return res.row;
    },
    async update(
      appId: string,
      getToken: () => string | null,
      entity: string,
      id: string,
      data: Row,
      onUnauthorized?: () => void,
    ): Promise<Row> {
      const res = await memberFetch<{ row: Row }>(
        `/member/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        getToken,
        { method: "PUT", body: JSON.stringify(data) },
        onUnauthorized,
      );
      return res.row;
    },
    /**
     * 会员面删除（第 60 步 R2）：仅被授予角色可达——服务端按角色 delete
     * 动作准入、被引用回 409；普通会员调用恒 403（D4：删己行不开放）。
     */
    async remove(
      appId: string,
      getToken: () => string | null,
      entity: string,
      id: string,
      onUnauthorized?: () => void,
    ): Promise<void> {
      await memberFetch<{ ok: boolean }>(
        `/member/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        getToken,
        { method: "DELETE" },
        onUnauthorized,
      );
    },
    /**
     * 会员聚合（商城线）：与员工面同构（服务端按 readable + owners 归属下推，
     * 只统计本人行），供会员中心 StatCard 取数。
     */
    async aggregate(
      appId: string,
      getToken: () => string | null,
      entity: string,
      q: {
        fn: "count" | "sum" | "avg";
        field?: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
      onUnauthorized?: () => void,
    ): Promise<number> {
      const qs = new URLSearchParams();
      qs.set("fn", q.fn);
      if (q.field) qs.set("field", q.field);
      for (const [k, v] of Object.entries(q.filters ?? {})) qs.set(k, v);
      if (q.vf?.length) qs.set("vf", JSON.stringify(q.vf));
      const res = await memberFetch<{ value: number }>(
        `/member/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
        getToken,
        undefined,
        onUnauthorized,
      );
      return res.value;
    },
    /** 会员分组聚合（商城线）：与员工面同构，返回 {key,value} 序列 */
    async aggregateGrouped(
      appId: string,
      getToken: () => string | null,
      entity: string,
      q: {
        fn: "count" | "sum" | "avg";
        field?: string;
        groupBy: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
      onUnauthorized?: () => void,
    ): Promise<AggregateGroupItem[]> {
      const qs = new URLSearchParams();
      qs.set("fn", q.fn);
      if (q.field) qs.set("field", q.field);
      qs.set("groupBy", q.groupBy);
      for (const [k, v] of Object.entries(q.filters ?? {})) qs.set(k, v);
      if (q.vf?.length) qs.set("vf", JSON.stringify(q.vf));
      const res = await memberFetch<{ series: AggregateGroupItem[] }>(
        `/member/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
        getToken,
        undefined,
        onUnauthorized,
      );
      return res.series;
    },
  },
  /**
   * 会员结算（商城线）：专用 checkout 端点——服务端按现价重算 + 价快照 + 扣库存，
   * 订单不走通用写面。400 带业务码（product_unavailable / insufficient_stock /
   * checkout_not_configured），错误对象经 memberFetch 透传 code。
   */
  async checkout(
    appId: string,
    getToken: () => string | null,
    body: MemberCheckoutBody,
    onUnauthorized?: () => void,
  ): Promise<MemberCheckoutResult> {
    return memberFetch<MemberCheckoutResult>(
      `/member/apps/${encodeURIComponent(appId)}/checkout`,
      getToken,
      { method: "POST", body: JSON.stringify(body) },
      onUnauthorized,
    );
  },
  /**
   * 发起支付（商城线）：订单须属本人且待支付；金额取订单总额（不收客户端金额）。
   * provider 缺省 sandbox；真实渠道未配置时服务端回 provider_not_configured。
   */
  async payOrder(
    appId: string,
    getToken: () => string | null,
    orderId: string,
    provider?: string,
    onUnauthorized?: () => void,
  ): Promise<MemberPayResult> {
    return memberFetch<MemberPayResult>(
      `/member/apps/${encodeURIComponent(appId)}/orders/${encodeURIComponent(orderId)}/pay`,
      getToken,
      {
        method: "POST",
        body: JSON.stringify(provider ? { provider } : {}),
      },
      onUnauthorized,
    );
  },
  /**
   * 沙箱模拟支付确认（商城线）：仅沙箱支付页调用——服务端内部走与外部回调
   * 完全相同的验签 + 结算路径，前端永不接触渠道 secret。
   */
  async simulatePayment(
    appId: string,
    getToken: () => string | null,
    paymentId: string,
    result: "success" | "fail",
    onUnauthorized?: () => void,
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/apps/${encodeURIComponent(appId)}/payments/${encodeURIComponent(paymentId)}/simulate`,
      getToken,
      { method: "POST", body: JSON.stringify({ result }) },
      onUnauthorized,
    );
  },
  /**
   * 会员取消订单（商城线）：仅本人、仅声明允许的状态可取消；
   * 有 checkout 声明的应用取消时服务端按明细回补库存。
   */
  async cancelOrder(
    appId: string,
    getToken: () => string | null,
    orderId: string,
    onUnauthorized?: () => void,
  ): Promise<{ ok: boolean }> {
    return memberFetch<{ ok: boolean }>(
      `/member/apps/${encodeURIComponent(appId)}/orders/${encodeURIComponent(orderId)}/cancel`,
      getToken,
      { method: "POST", body: JSON.stringify({}) },
      onUnauthorized,
    );
  },
};

/** 会员结算（商城线独立函数形态，供外壳级页面与适配器共用；实现见 memberApi.checkout） */
export function checkoutMember(
  appId: string,
  getToken: () => string | null,
  body: MemberCheckoutBody,
  onUnauthorized?: () => void,
): Promise<MemberCheckoutResult> {
  return memberApi.checkout(appId, getToken, body, onUnauthorized);
}

/** 会员发起支付（商城线）：见 memberApi.payOrder */
export function payMemberOrder(
  appId: string,
  getToken: () => string | null,
  orderId: string,
  provider?: string,
  onUnauthorized?: () => void,
): Promise<MemberPayResult> {
  return memberApi.payOrder(appId, getToken, orderId, provider, onUnauthorized);
}

/** 沙箱模拟支付（商城线）：见 memberApi.simulatePayment */
export function simulateMemberPayment(
  appId: string,
  getToken: () => string | null,
  paymentId: string,
  result: "success" | "fail",
  onUnauthorized?: () => void,
): Promise<{ ok: boolean }> {
  return memberApi.simulatePayment(
    appId,
    getToken,
    paymentId,
    result,
    onUnauthorized,
  );
}

/** 会员取消订单（商城线）：见 memberApi.cancelOrder */
export function cancelMemberOrder(
  appId: string,
  getToken: () => string | null,
  orderId: string,
  onUnauthorized?: () => void,
): Promise<{ ok: boolean }> {
  return memberApi.cancelOrder(appId, getToken, orderId, onUnauthorized);
}

/** 会员聚合（商城线）：见 memberApi.data.aggregate */
export function fetchMemberAggregate(
  appId: string,
  getToken: () => string | null,
  entity: string,
  q: {
    fn: "count" | "sum" | "avg";
    field?: string;
    filters?: Record<string, string>;
    vf?: ViewFilter[];
  },
  onUnauthorized?: () => void,
): Promise<number> {
  return memberApi.data.aggregate(appId, getToken, entity, q, onUnauthorized);
}

/** 收银台状态（§7）：仅回支付单/订单状态两字段，供收银台页轮询 */
export interface SandboxPaymentStatus {
  paymentStatus: string;
  orderStatus: string;
}

/**
 * 收银台组请求（§7）：顶层 /pay/sandbox/* ——无会话、靠支付令牌 t 作凭据
 * （扫码设备无会员会话是常态）。错误处理与 memberFetch 同构（透传业务码）。
 */
async function sandboxFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string })
    | null;
  if (!res.ok) {
    const err = new Error(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = body?.error;
    throw err;
  }
  return body as T;
}

/**
 * 收银台确认支付（§7）：凭令牌确认结算/失败，服务端走与外部回调相同的
 * settle 路径（via 记 sandbox_cashier）；令牌篡改/过期回 400。
 */
export function confirmSandboxPayment(
  t: string,
  result: "success" | "fail",
): Promise<{
  ok: boolean;
  paymentStatus?: string;
  orderStatus?: string;
}> {
  return sandboxFetch<{
    ok: boolean;
    paymentStatus?: string;
    orderStatus?: string;
  }>("/pay/sandbox/confirm", {
    method: "POST",
    body: JSON.stringify({ t, result }),
  });
}

/** 收银台状态轮询（§7）：GET /pay/sandbox/status?t=，字段最小化 */
export function fetchSandboxPaymentStatus(
  t: string,
): Promise<SandboxPaymentStatus> {
  return sandboxFetch<SandboxPaymentStatus>(
    `/pay/sandbox/status?t=${encodeURIComponent(t)}`,
  );
}

type RawRecord = Record<string, unknown>;

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

/** 客服消息归一化：pending_action / pendingAction 双写兼容（对齐 assistant 会话详情形状） */
function normalizeSupportMessage(raw: RawRecord, idx: number): SupportMessage {
  const pa = (raw.pendingAction ?? raw.pending_action) as
    | RawRecord
    | undefined;
  return {
    id: typeof raw.id === "string" ? raw.id : `m-${idx}`,
    role: typeof raw.role === "string" ? raw.role : "assistant",
    text: typeof raw.text === "string" ? raw.text : "",
    citations: Array.isArray(raw.citations)
      ? (raw.citations as SupportMessage["citations"])
      : undefined,
    pendingAction: pa
      ? {
          kind: typeof pa.kind === "string" ? pa.kind : "",
          summary:
            typeof pa.summary === "string"
              ? pa.summary
              : typeof pa.reason === "string"
                ? pa.reason
                : "",
          fields: Array.isArray(pa.fields)
            ? (pa.fields as AssistantPendingAction["fields"])
            : [],
          handled: pa.handled === true || Boolean(pa.handled),
        }
      : undefined,
    status: typeof raw.status === "string" ? raw.status : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
  };
}

function normalizeSupportSessionInfo(raw: RawRecord): SupportSessionInfo {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    status: typeof raw.status === "string" ? raw.status : undefined,
    ticketId: strOrNull(raw.ticketId ?? raw.ticket_id),
    rating: numOrNull(raw.rating),
    summary: strOrNull(raw.summary ?? raw.handoff_summary ?? raw.handoffSummary),
    visitorName: strOrNull(raw.visitorName ?? raw.visitor_name),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : typeof raw.updated_at === "string"
          ? raw.updated_at
          : undefined,
    messageCount: numOrNull(raw.messageCount ?? raw.message_count) ?? undefined,
  };
}

/** 会话详情归一化：{session|conversation, messages} 两种头部键都认，字段蛇形/驼峰都认 */
function normalizeSupportDetail(raw: RawRecord): SupportSessionDetail {
  const head = (raw.session ?? raw.conversation ?? raw) as RawRecord;
  const messages = Array.isArray(raw.messages)
    ? (raw.messages as RawRecord[]).map(normalizeSupportMessage)
    : [];
  return { session: normalizeSupportSessionInfo(head), messages };
}

export const api = {
  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: UserInfo }> {
    const res = await apiFetch<{ token: string; user: UserInfo }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    storeSession(res.token, res.user);
    return res;
  },
  async apps(): Promise<AppInfo[]> {
    const res = await apiFetch<{ apps: AppInfo[] }>("/apps");
    return res.apps;
  },
  async snapshot(appId: string): Promise<Snapshot> {
    return apiFetch<Snapshot>(`/apps/${encodeURIComponent(appId)}/snapshot`);
  },
  /** 员工侧站点解析（第 68 步引导：域名 + 首段路径定作用域应用） */
  async site(host: string, seg?: string | null): Promise<{ site: SiteInfo }> {
    const q = new URLSearchParams({ host });
    if (seg) q.set("seg", seg);
    return apiFetch<{ site: SiteInfo }>(`/site/current?${q.toString()}`);
  },
  /** 匿名解析入口的公开面（未登录时先调：有公开页则渲染公开外壳） */
  async publicSite(
    host: string,
    seg?: string | null,
  ): Promise<PublicSiteResult> {
    const q = new URLSearchParams({ host });
    if (seg) q.set("seg", seg);
    return apiFetch<PublicSiteResult>(`/public/site?${q.toString()}`);
  },
  data: {
    async list(
      appId: string,
      entity: string,
      params?: {
        limit?: number;
        offset?: number;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
        sort?: { field: string; dir: "asc" | "desc" };
      },
    ): Promise<ListResult> {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.offset) qs.set("offset", String(params.offset));
      if (params?.sort) qs.set("sort", `${params.sort.field}:${params.sort.dir}`);
      for (const [k, v] of Object.entries(params?.filters ?? {})) qs.set(k, v);
      if (params?.vf?.length) qs.set("vf", JSON.stringify(params.vf));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return apiFetch<ListResult>(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}${suffix}`,
      );
    },
    /** 聚合查询（统计卡片/图表）：服务端对实体做 count/sum/avg；过滤走旧 filters 兼容 + 结构化 vf（服务端以 vf 为准） */
    async aggregate(
      appId: string,
      entity: string,
      q: {
        fn: "count" | "sum" | "avg";
        field?: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
    ): Promise<number> {
      const qs = new URLSearchParams();
      qs.set("fn", q.fn);
      if (q.field) qs.set("field", q.field);
      for (const [k, v] of Object.entries(q.filters ?? {})) qs.set(k, v);
      if (q.vf?.length) qs.set("vf", JSON.stringify(q.vf));
      const res = await apiFetch<{ value: number }>(
        `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
      );
      return res.value;
    },
    /** 分组聚合（图表）：按 groupBy 分组返回 {key,value} 序列（服务端按值降序、最多 50 组） */
    async aggregateGrouped(
      appId: string,
      entity: string,
      q: {
        fn: "count" | "sum" | "avg";
        field?: string;
        groupBy: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
    ): Promise<AggregateGroupItem[]> {
      const qs = new URLSearchParams();
      qs.set("fn", q.fn);
      if (q.field) qs.set("field", q.field);
      qs.set("groupBy", q.groupBy);
      for (const [k, v] of Object.entries(q.filters ?? {})) qs.set(k, v);
      if (q.vf?.length) qs.set("vf", JSON.stringify(q.vf));
      const res = await apiFetch<{ series: AggregateGroupItem[] }>(
        `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
      );
      return res.series;
    },
    async get(appId: string, entity: string, id: string): Promise<Row | null> {
      try {
        const res = await apiFetch<{ row: Row }>(
          `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        );
        return res.row;
      } catch {
        return null;
      }
    },
    async create(appId: string, entity: string, data: Row): Promise<Row> {
      const res = await apiFetch<{ row: Row }>(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}`,
        { method: "POST", body: JSON.stringify(data) },
      );
      return res.row;
    },
    async update(
      appId: string,
      entity: string,
      id: string,
      data: Row,
    ): Promise<Row> {
      const res = await apiFetch<{ row: Row }>(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(data) },
      );
      return res.row;
    },
    async remove(appId: string, entity: string, id: string): Promise<void> {
      await apiFetch(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },
  },
  /** 平台资产（M9）：文件本体在 R2、元数据登记 PG；上传/取数走登录态，内容经 api 代理流 */
  assets: {
    /** 上传单个文件为资产（multipart，文件字段名 file；关联标注经表单字段附带） */
    async upload(file: File, linkage?: AssetLinkage): Promise<AssetMeta> {
      const fd = new FormData();
      fd.append("file", file);
      if (linkage?.appId) fd.append("appId", linkage.appId);
      if (linkage?.entity) fd.append("entity", linkage.entity);
      if (linkage?.recordId) fd.append("recordId", linkage.recordId);
      if (linkage?.field) fd.append("field", linkage.field);
      if (linkage?.visibility) fd.append("visibility", linkage.visibility);
      const token = getToken();
      // 不走 apiFetch：FormData 需浏览器自带 multipart Content-Type（含 boundary），不能覆写为 JSON
      const res = await fetch(`${API_BASE}/assets`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });
      const body = (await res.json().catch(() => null)) as
        | (AssetMeta & { message?: string; error?: string })
        | null;
      if (!res.ok || !body) {
        const err = new Error(
          body?.message ?? body?.error ?? `上传失败 (${res.status})`,
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return body;
    },
    /** 批量取资产元数据（缺失 id 由服务端略过） */
    async meta(ids: string[]): Promise<AssetMeta[]> {
      if (!ids.length) return [];
      const res = await apiFetch<{ items: AssetMeta[] }>(
        `/assets/meta?ids=${ids.map((i) => encodeURIComponent(i)).join(",")}`,
      );
      return res.items;
    },
    /** 资产内容地址：附当前 token 的 ?t=（<img>/<a> 无法带 Authorization 头，服务端亦认查询参数鉴权） */
    contentUrl(id: string): string {
      const token = getToken();
      const base = `${API_BASE}/assets/${encodeURIComponent(id)}/content`;
      return token ? `${base}?t=${encodeURIComponent(token)}` : base;
    },
  },
  /** 流程与待办（M5）：全部按当前登录用户在服务端过滤，前端只做呈现 */
  flow: {
    /** 待我审批的任务 */
    async todos(appId: string): Promise<FlowTodoTask[]> {
      const res = await apiFetch<{ tasks: FlowTodoTask[] }>(
        `/apps/${encodeURIComponent(appId)}/flow/todos`,
      );
      return res.tasks;
    },
    /** 我处理过的任务（倒序） */
    async done(appId: string): Promise<FlowDoneTask[]> {
      const res = await apiFetch<{ tasks: FlowDoneTask[] }>(
        `/apps/${encodeURIComponent(appId)}/flow/done`,
      );
      return res.tasks;
    },
    /** 我发起的流程实例 */
    async mine(appId: string): Promise<FlowMineInstance[]> {
      const res = await apiFetch<{ instances: FlowMineInstance[] }>(
        `/apps/${encodeURIComponent(appId)}/flow/mine`,
      );
      return res.instances;
    },
    /** 与我相关的流程通知事件（新任务/催办/低库存/完成/驳回/抄送） */
    async notifications(appId: string): Promise<FlowEvent[]> {
      const res = await apiFetch<{ events: FlowEvent[] }>(
        `/apps/${encodeURIComponent(appId)}/flow/notifications`,
      );
      return res.events;
    },
    /** 某实体绑定的流程与当前可发起的记录（无进行中实例、状态可发起） */
    async startable(appId: string, entity: string): Promise<FlowStartable> {
      return apiFetch<FlowStartable>(
        `/apps/${encodeURIComponent(appId)}/flow/startable/${encodeURIComponent(entity)}`,
      );
    },
    /** 对一条记录发起流程 */
    async start(
      appId: string,
      entity: string,
      recordId: string,
    ): Promise<FlowInstance> {
      const res = await apiFetch<{ instance: FlowInstance }>(
        `/apps/${encodeURIComponent(appId)}/flow/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/start`,
        { method: "POST" },
      );
      return res.instance;
    },
    /** 处理审批任务（批准/驳回，可带意见） */
    async act(
      appId: string,
      taskId: string,
      decision: "approve" | "reject",
      comment?: string,
    ): Promise<FlowInstance> {
      const res = await apiFetch<{ instance: FlowInstance }>(
        `/apps/${encodeURIComponent(appId)}/flow/tasks/${encodeURIComponent(taskId)}/act`,
        {
          method: "POST",
          body: JSON.stringify({ decision, comment: comment || undefined }),
        },
      );
      return res.instance;
    },
    /** 催办一个进行中的实例（仅发起人/admin，服务端校验） */
    async urge(appId: string, instanceId: string): Promise<void> {
      await apiFetch(
        `/apps/${encodeURIComponent(appId)}/flow/instances/${encodeURIComponent(instanceId)}/urge`,
        { method: "POST" },
      );
    },
    /** 实例进度详情（实例 + 全部任务 + 事件时间线） */
    async instance(
      appId: string,
      instanceId: string,
    ): Promise<FlowInstanceDetail> {
      return apiFetch<FlowInstanceDetail>(
        `/apps/${encodeURIComponent(appId)}/flow/instances/${encodeURIComponent(instanceId)}`,
      );
    },
  },
  /** 运行态助手（M7）：异步回合制——发送立即返回，助手消息经轮询会话详情取回 */
  assistant: {
    /** 发送一条消息：立即返回会话与用户消息 id；同会话同时只允许一条生成中（409） */
    async chat(
      appId: string,
      body: {
        conversationId?: string;
        text: string;
        context: AssistantContext;
      },
    ): Promise<{ conversationId: string; messageId: string }> {
      return apiFetch(
        `/apps/${encodeURIComponent(appId)}/assistant/chat`,
        { method: "POST", body: JSON.stringify(body) },
      );
    },
    /** 我的会话列表（倒序，首条即最近会话） */
    async conversations(appId: string): Promise<AssistantConversation[]> {
      const res = await apiFetch<{ conversations: AssistantConversation[] }>(
        `/apps/${encodeURIComponent(appId)}/assistant/conversations`,
      );
      return res.conversations;
    },
    /** 会话全量消息（含引用与待确认动作），轮询靠它 */
    async conversation(
      appId: string,
      conversationId: string,
    ): Promise<{ conversation: AssistantConversation; messages: AssistantMessage[] }> {
      return apiFetch(
        `/apps/${encodeURIComponent(appId)}/assistant/conversations/${encodeURIComponent(conversationId)}`,
      );
    },
    /** 确认/取消一条待确认写动作；fillForm 类返回回填指令由前端执行 */
    async confirmAction(
      appId: string,
      messageId: string,
      decision: "confirm" | "cancel",
    ): Promise<AssistantConfirmResult> {
      const res = await apiFetch<
        AssistantConfirmResult & {
          navigate?: string;
          prefill?: { values?: Row; items?: Record<string, Row[]> | Row[] };
        }
      >(
        `/apps/${encodeURIComponent(appId)}/assistant/actions/${encodeURIComponent(messageId)}/confirm`,
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      // 兼容契约形态 { navigate: '#/e/<entity>/form', prefill }：归一化为 fillForm
      if (!res.fillForm && res.prefill) {
        const m =
          typeof res.navigate === "string"
            ? res.navigate.match(/\/e\/([^/]+)\/form/)
            : null;
        if (m) {
          return {
            ...res,
            fillForm: {
              entity: decodeURIComponent(m[1]!),
              values: res.prefill.values ?? {},
              items: res.prefill.items,
            },
          };
        }
      }
      return res;
    },
  },
  /**
   * 客服（M12）：访客组以 sessionId + X-Visitor-Key 能力凭证调用（匿名），
   * 坐席组走登录 token（transcript / faq-drafts / 会话列表）。
   */
  support: {
    /** 咨询窗配置（公开可读）：enabled=false 时前端不渲染咨询窗 */
    async config(appId: string): Promise<SupportConfig> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/config`,
      );
      return {
        enabled: raw.enabled === true,
        title: typeof raw.title === "string" ? raw.title : undefined,
        turnstileSiteKey: strOrNull(
          raw.turnstileSiteKey ?? raw.turnstile_site_key,
        ),
      };
    },
    /** 创建访客会话：Turnstile 启用时须带 turnstileToken；响应含一次性 visitorKey */
    async createSession(
      appId: string,
      body: { turnstileToken?: string; visitorName?: string; contact?: string },
    ): Promise<{ sessionId: string; visitorKey: string }> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions`,
        undefined,
        { method: "POST", body: JSON.stringify(body) },
      );
      const sessionId = strOrNull(raw.sessionId ?? raw.session_id ?? raw.id);
      const visitorKey = strOrNull(raw.visitorKey ?? raw.visitor_key);
      if (!sessionId || !visitorKey) {
        throw new Error("创建会话响应缺少 sessionId/visitorKey");
      }
      return { sessionId, visitorKey };
    },
    /** 访客会话详情（消息全量，轮询靠它） */
    async session(
      appId: string,
      sessionId: string,
      visitorKey: string,
    ): Promise<SupportSessionDetail> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(sessionId)}`,
        visitorKey,
      );
      return normalizeSupportDetail(raw);
    },
    /** 发送访客消息：立即返回，助手回复经轮询会话详情取回（202） */
    async postMessage(
      appId: string,
      sessionId: string,
      visitorKey: string,
      text: string,
    ): Promise<{ messageId: string }> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(sessionId)}/messages`,
        visitorKey,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      return { messageId: strOrNull(raw.messageId ?? raw.id) ?? "" };
    },
    /** 按钮路径转人工：立即执行（api 确定性），幂等返回既有工单号 */
    async handoff(
      appId: string,
      sessionId: string,
      visitorKey: string,
    ): Promise<{ ticketId: string | null }> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(sessionId)}/handoff`,
        visitorKey,
        { method: "POST", body: JSON.stringify({}) },
      );
      return { ticketId: strOrNull(raw.ticketId ?? raw.ticket_id) };
    },
    /** 提案路径确认/取消（humanHandoff 提案卡）：确认才执行转人工 */
    async confirmAction(
      appId: string,
      sessionId: string,
      visitorKey: string,
      messageId: string,
      decision: "confirm" | "cancel",
    ): Promise<{ ok: boolean; ticketId: string | null }> {
      const raw = await supportFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(messageId)}/confirm`,
        visitorKey,
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      return {
        ok: raw.ok !== false,
        ticketId: strOrNull(raw.ticketId ?? raw.ticket_id),
      };
    },
    /** 满意度评分（1–5） */
    async rate(
      appId: string,
      sessionId: string,
      visitorKey: string,
      score: number,
    ): Promise<void> {
      await supportFetch(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(sessionId)}/rating`,
        visitorKey,
        { method: "POST", body: JSON.stringify({ score }) },
      );
    },
    /** 坐席组：访客会话列表（可按 status 过滤） */
    async sessions(
      appId: string,
      status?: string,
    ): Promise<SupportSessionInfo[]> {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      const raw = await apiFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions${qs}`,
      );
      const rows = (raw.rows ?? raw.sessions ?? []) as RawRecord[];
      return rows.map(normalizeSupportSessionInfo);
    },
    /** 坐席组：会话全文（摘要 + 消息全量），归一化为渲染器 SupportTranscript 视图 */
    async transcript(
      appId: string,
      conversationId: string,
    ): Promise<SupportTranscriptData> {
      const raw = await apiFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/sessions/${encodeURIComponent(conversationId)}/transcript`,
      );
      const detail = normalizeSupportDetail(raw);
      return {
        sessionId: detail.session.id || conversationId,
        status: detail.session.status,
        summary: detail.session.summary,
        ticketId: detail.session.ticketId,
        rating: detail.session.rating,
        messages: detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          citations: m.citations,
          createdAt: m.createdAt,
        })),
      };
    },
    /** 坐席组：沉淀 FAQ 草稿（写 kb_documents 待审队列，管理台审核入库） */
    async faqDraft(
      appId: string,
      input: { question: string; answer: string },
    ): Promise<{ docId: string; status: string }> {
      const raw = await apiFetch<RawRecord>(
        `/apps/${encodeURIComponent(appId)}/support/faq-drafts`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return {
        docId: strOrNull(raw.docId ?? raw.doc_id ?? raw.id) ?? "",
        status: typeof raw.status === "string" ? raw.status : "pending_review",
      };
    },
  },
};

/** 引用下拉的显示标签：优先取语义字段（名称/单号/编码），兜底用 id */
function pickLabel(row: Row): string {
  for (const key of ["name", "order_no", "in_no", "req_no", "code", "title"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return String(row.id);
}

/** 为某个应用构造渲染器适配器（数据经 api，路由/提示由应用壳承接） */
export function makeAdapter(
  appId: string,
  navigate: (to: string) => void,
  notify: (message: string, kind?: "ok" | "error") => void,
): RuntimeAdapter {
  return {
    list: (entity, params) => api.data.list(appId, entity, params),
    aggregate: (entity, q) => api.data.aggregate(appId, entity, q),
    aggregateGrouped: (entity, q) =>
      api.data.aggregateGrouped(appId, entity, q),
    uploadAsset: (file, linkage) =>
      api.assets.upload(file, { appId, ...linkage }),
    assetsMeta: (ids) => api.assets.meta(ids),
    assetContentUrl: (id) => api.assets.contentUrl(id),
    get: (entity, id) => api.data.get(appId, entity, id),
    create: (entity, data) => api.data.create(appId, entity, data),
    update: (entity, id, data) => api.data.update(appId, entity, id, data),
    remove: (entity, id) => api.data.remove(appId, entity, id),
    options: async (entity): Promise<SelectOption[]> => {
      const res = await api.data.list(appId, entity, { limit: 200 });
      return res.rows.map((r) => ({ value: String(r.id), label: pickLabel(r) }));
    },
    /** 客服（M12）：坐席在工单详情页读会话全文 + 沉淀 FAQ（登录态，adapter 可选方法） */
    getSupportTranscript: (conversationId) =>
      api.support.transcript(appId, conversationId),
    postSupportFaqDraft: (input) => api.support.faqDraft(appId, input),
    navigate,
    notify,
  };
}

/**
 * 公开（匿名）适配器：读走 /public 数据接口（服务端按公开策略整形），
 * 写只允许提交公开表单——落入待审区而非业务表，create 返回合成行让表单走完成功路径；
 * 修改/删除一律拒绝（公开访问不可改既有数据）。
 */
export function makePublicAdapter(
  appId: string,
  navigate: (to: string) => void,
  notify: (message: string, kind?: "ok" | "error") => void,
  hooks?: MemberAdapterHooks,
): RuntimeAdapter {
  const base = `/public/apps/${encodeURIComponent(appId)}`;
  const list = async (
    entity: string,
    params?: {
      limit?: number;
      offset?: number;
      filters?: Record<string, string>;
      vf?: ViewFilter[];
      sort?: { field: string; dir: "asc" | "desc" };
    },
  ): Promise<ListResult> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.sort) qs.set("sort", `${params.sort.field}:${params.sort.dir}`);
    for (const [k, v] of Object.entries(params?.filters ?? {})) qs.set(k, v);
    if (params?.vf?.length) qs.set("vf", JSON.stringify(params.vf));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiFetch<ListResult>(
      `${base}/data/${encodeURIComponent(entity)}${suffix}`,
    );
  };
  return {
    list,
    aggregate: () => {
      throw new Error("公开访问不支持聚合查询");
    },
    aggregateGrouped: () => {
      throw new Error("公开访问不支持聚合查询");
    },
    uploadAsset: () => {
      throw new Error("公开访问不支持文件上传");
    },
    // 公开面尽力取资产名（private 资产需登录，取不到时渲染层以 id 兜底）；public 资产可直读
    assetsMeta: async (ids: string[]): Promise<AssetMeta[]> => {
      try {
        return await api.assets.meta(ids);
      } catch {
        return [];
      }
    },
    assetContentUrl: (id: string) => api.assets.contentUrl(id),
    get: async (entity, id) => {
      try {
        const res = await apiFetch<{ row: Row }>(
          `${base}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        );
        return res.row;
      } catch {
        // 治理回退读（第 60 步 R2 补强）：公开守卫不可见的行（如版主已下架
        // 的帖子）若当前有会员会话，回退会员面单条读——服务端按会员策略
        // 与被授予角色的 read 动作执法，放行后详情页治理条可完成恢复；
        // 无会话或仍不可读则维持 null（记录不存在口径不变）。
        const token = hooks?.getSession?.()?.token ?? null;
        if (!token) return null;
        try {
          return await memberApi.data.get(
            appId,
            () => token,
            entity,
            id,
            hooks?.onUnauthorized,
          );
        } catch {
          return null;
        }
      }
    },
    create: async (entity, data) => {
      const res = await apiFetch<{ ok: boolean; id: string }>(
        `${base}/submit/${encodeURIComponent(entity)}`,
        { method: "POST", body: JSON.stringify({ body: data }) },
      );
      // 提交进待审区而非业务表：合成一行回给表单（id 为待审记录 id），成功提示由外壳改写
      return { ...data, id: res.id };
    },
    update: () => {
      throw new Error("公开访问不可修改");
    },
    remove: () => {
      throw new Error("公开访问不可修改");
    },
    options: async (entity): Promise<SelectOption[]> => {
      const res = await list(entity, { limit: 200 });
      return res.rows.map((r) => ({ value: String(r.id), label: pickLabel(r) }));
    },
    /**
     * 商城线会员钩子（可选注入）：公开页上的 CartView 借此判定会员登录态并结算——
     * 会话来自外壳状态（钩子 getSession），结算经会话令牌调会员面 checkout；
     * 支付（memberPayOrder）/取消订单（memberCancelOrder）同口径，无会话先拉起登录弹窗再抛错；
     * 未注入钩子时三方方法按无会话/不可结算降级，公开面既有行为不变。
     */
    memberSession: () => {
      const s = hooks?.getSession?.() ?? null;
      return s
        ? {
            id: s.member.id,
            identifier: s.member.identifier,
            displayName: s.member.displayName,
          }
        : null;
    },
    openMemberLogin: hooks?.openLogin,
    memberCheckout: (body) =>
      checkoutMember(
        appId,
        () => hooks?.getSession?.()?.token ?? null,
        body,
        hooks?.onUnauthorized,
      ),
    memberPayOrder: async (orderId) => {
      if (!hooks?.getSession?.()) {
        hooks?.openLogin?.();
        throw new Error("请先登录会员账号");
      }
      const res = await payMemberOrder(
        appId,
        () => hooks?.getSession?.()?.token ?? null,
        orderId,
        "sandbox",
        hooks?.onUnauthorized,
      );
      return { payUrl: res.payUrl };
    },
    memberCancelOrder: async (orderId) => {
      if (!hooks?.getSession?.()) {
        hooks?.openLogin?.();
        throw new Error("请先登录会员账号");
      }
      await cancelMemberOrder(
        appId,
        () => hooks?.getSession?.()?.token ?? null,
        orderId,
        hooks?.onUnauthorized,
      );
    },
    // 第 60 步 R2 治理：角色来自会员会话（登录/换发/me 刷新随带），
    // 治理写/删经会员面以会话令牌调用（服务端按角色执法）
    memberRoles: () => hooks?.getSession?.()?.roles ?? [],
    memberGovernanceUpdate: (entity, id, data) =>
      memberApi.data.update(
        appId,
        () => hooks?.getSession?.()?.token ?? null,
        entity,
        id,
        data,
        hooks?.onUnauthorized,
      ),
    memberGovernanceRemove: (entity, id) =>
      memberApi.data.remove(
        appId,
        () => hooks?.getSession?.()?.token ?? null,
        entity,
        id,
        hooks?.onUnauthorized,
      ),
    navigate,
    notify,
  };
}

/**
 * 会员钩子（商城线）：外壳把会员会话状态与登录弹窗入口注入适配器，
 * 供 CartView 等组件判定登录态（memberSession）、拉起登录（openMemberLogin）
 * 与结算/支付/取消订单（memberCheckout / memberPayOrder / memberCancelOrder 内部
 * 经会话令牌调会员面）。员工适配器不注入、行为不变。
 */
export interface MemberAdapterHooks {
  /** 当前会员会话（无会话返回 null）；缺省时适配器按「无会话」呈现 */
  getSession?: () => MemberSession | null;
  /** 打开会员登录弹窗（公开外壳的 MemberAuthModal） */
  openLogin?: () => void;
  /** 会员面 401 时的会话清理回调（与适配器既有 onUnauthorized 同义，钩子场景合并传入） */
  onUnauthorized?: () => void;
}

/**
 * 会员适配器（会员试点）：与公开适配器同构，数据走 /member 面——列表/详情/
 * 新建/改己行由服务端按会员策略 + 归属执法；令牌经 getter 注入（外壳会话状态
 * 为唯一事实源），401 时 onUnauthorized 回调清会话。删除不在会员面口径内；
 * 文件上传会员面暂不支持（试点会员表单无文件字段），资产读取沿用公开口径。
 * 商城线补强：聚合走会员 aggregate 端点（StatCard 会员语境同名同形）、
 * 注入会员钩子后提供 memberSession / openMemberLogin / memberCheckout /
 * memberPayOrder / memberCancelOrder。
 */
export function makeMemberAdapter(
  appId: string,
  navigate: (to: string) => void,
  notify: (message: string, kind?: "ok" | "error") => void,
  getToken: () => string | null,
  onUnauthorized?: () => void,
  hooks?: MemberAdapterHooks,
): RuntimeAdapter {
  const list = (
    entity: string,
    params?: {
      limit?: number;
      offset?: number;
      filters?: Record<string, string>;
      vf?: ViewFilter[];
      sort?: { field: string; dir: "asc" | "desc" };
    },
  ): Promise<ListResult> =>
    memberApi.data.list(appId, getToken, entity, params, onUnauthorized);
  return {
    list,
    aggregate: (entity, q) =>
      memberApi.data.aggregate(appId, getToken, entity, q, onUnauthorized),
    aggregateGrouped: (entity, q) =>
      memberApi.data.aggregateGrouped(
        appId,
        getToken,
        entity,
        q,
        onUnauthorized,
      ),
    uploadAsset: () => {
      throw new Error("会员面暂不支持文件上传");
    },
    // 资产元数据/内容沿用公开口径（与 makePublicAdapter 同处理）
    assetsMeta: async (ids: string[]): Promise<AssetMeta[]> => {
      try {
        return await api.assets.meta(ids);
      } catch {
        return [];
      }
    },
    assetContentUrl: (id: string) => api.assets.contentUrl(id),
    get: (entity, id) =>
      memberApi.data.get(appId, getToken, entity, id, onUnauthorized),
    create: (entity, data) =>
      memberApi.data.create(appId, getToken, entity, data, onUnauthorized),
    update: (entity, id, data) =>
      memberApi.data.update(appId, getToken, entity, id, data, onUnauthorized),
    remove: () => {
      throw new Error("会员不可删除数据");
    },
    options: async (entity): Promise<SelectOption[]> => {
      const res = await list(entity, { limit: 200 });
      return res.rows.map((r) => ({ value: String(r.id), label: pickLabel(r) }));
    },
    /** 商城线：会员会话快照与结算/支付/取消（钩子未注入时按无会话/不可结算降级） */
    memberSession: () => {
      const s = hooks?.getSession?.() ?? null;
      return s
        ? {
            id: s.member.id,
            identifier: s.member.identifier,
            displayName: s.member.displayName,
          }
        : null;
    },
    // 第 60 步 R2 治理：角色来自会员会话，治理写/删经适配器令牌调会员面
    memberRoles: () => hooks?.getSession?.()?.roles ?? [],
    memberGovernanceUpdate: (entity, id, data) =>
      memberApi.data.update(appId, getToken, entity, id, data, onUnauthorized),
    memberGovernanceRemove: (entity, id) =>
      memberApi.data.remove(appId, getToken, entity, id, onUnauthorized),
    openMemberLogin: hooks?.openLogin,
    memberCheckout: (body) =>
      checkoutMember(appId, getToken, body, onUnauthorized),
    memberPayOrder: async (orderId) => {
      if (!getToken()) {
        hooks?.openLogin?.();
        throw new Error("请先登录会员账号");
      }
      const res = await payMemberOrder(
        appId,
        getToken,
        orderId,
        "sandbox",
        onUnauthorized,
      );
      return { payUrl: res.payUrl };
    },
    memberCancelOrder: async (orderId) => {
      if (!getToken()) {
        hooks?.openLogin?.();
        throw new Error("请先登录会员账号");
      }
      await cancelMemberOrder(appId, getToken, orderId, onUnauthorized);
    },
    navigate,
    notify,
  };
}
