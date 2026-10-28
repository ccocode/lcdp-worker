/**
 * 平台管理台 api 客户端（M8）。与 runtime/studio 同源接口、同基址口径：
 * 默认 https://api.coode.cc.cd（M11 起经 Worker 网关转发回源），可经
 * VITE_API_BASE 或 localStorage `lcdp.admin.apiBase` 覆盖。token 独立存储于本源 localStorage。
 * 字段形状以契约 §4 与服务端实况为准；列表信封在客户端做防御式归一化。
 */
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (typeof localStorage !== "undefined"
    ? (localStorage.getItem("lcdp.admin.apiBase") ?? undefined)
    : undefined) ??
  "https://api.coode.cc.cd";

const TOKEN_KEY = "lcdp.admin.token";
const USER_KEY = "lcdp.admin.user";

export interface UserInfo {
  id: string;
  username: string;
  role: string;
  tenantId: string;
  displayName?: string | null;
  departmentId?: string | null;
}

/** 通用行：服务端字段随模块演进，前端一律防御式取值 */
export type Row = Record<string, unknown>;

/** 运行入口（静态化线）：站点级装配与运行模式 */
export type SiteMode = "dynamic" | "pseudo" | "static";

/** 主题绑定指针（M14 线二）：单槽指针形状 {id, version, values} */
export interface ThemePointer {
  id: string;
  version: string;
  values: Record<string, unknown>;
}

/**
 * 主题双槽指针（M15 第⑤步）：入口 config.theme 的现行形状。
 * themePointerOf 只认此形状（旧单指针视为未绑定）；每槽独立绑定/解绑，
 * values 按槽独立（D10）。
 */
export interface ThemeSlots {
  desktop: ThemePointer | null;
  mobile: ThemePointer | null;
}

export type ThemeSlotName = keyof ThemeSlots;

/**
 * 应用站点属性（第 68 步：入口模型退役后，域名/模式/主题/主应用全是
 * platform_apps 上的应用字段，经 GET/PUT /admin/apps/:id/site 读写）。
 */
export interface SiteAppView {
  id: string;
  name: string;
  boundHost: string | null;
  siteMode: SiteMode;
  themeSlots: ThemeSlots | null;
  isPrimary: boolean;
  nameEn: string | null;
}

/** 站点属性 themeSlots 归一为双槽（服务端已归一，此处防御式同口径） */
export function siteThemeSlots(app: SiteAppView | null): ThemeSlots {
  const empty: ThemeSlots = { desktop: null, mobile: null };
  const raw = app?.themeSlots as unknown;
  if (!raw || typeof raw !== "object") return empty;
  if (!("desktop" in raw) && !("mobile" in raw)) return empty;
  const slot = (v: unknown): ThemePointer | null =>
    v &&
    typeof v === "object" &&
    typeof (v as ThemePointer).id === "string" &&
    typeof (v as ThemePointer).version === "string"
      ? (v as ThemePointer)
      : null;
  const s = raw as Record<string, unknown>;
  return { desktop: slot(s.desktop), mobile: slot(s.mobile) };
}

/** 静态生成状态（按应用查：sites 为本应用绑定域名上的站点状态清单） */
export interface StaticSiteStatus {
  entryId: string;
  entryName: string;
  siteMode: SiteMode;
  hosts: {
    host: string;
    lastRun: {
      ok: boolean;
      kind: string;
      pages: number;
      details: number;
      skipped: Record<string, number>;
      error?: string;
      at: string;
    } | null;
    manifest: { generatedAt: string; snapshotCount: number } | null;
  }[];
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

/** 领域注册表条目（GET /domains 子集，参照 studio DomainInfo）：新建应用选领域用 */
export interface DomainInfo {
  key: string;
  name: string;
  available: boolean;
}

/** 主题清单里的可配置项声明（主题页 values 表单按此渲染） */
export interface ThemeConfigItem {
  key: string;
  label: string;
  type: "text" | "textarea" | "image" | "color";
  default?: string;
}

/** 主题版本清单（theme.json 的服务端回显形状） */
export interface ThemeManifestView {
  id: string;
  name: string;
  version: string;
  description?: string;
  config?: ThemeConfigItem[];
  preview?: string;
  /** 目标端（M15 第⑤步）：新上传必填；存量版本缺失，按 P1 口径视为 desktop */
  target?: "desktop" | "mobile";
  routes?: string[];
}

export interface ThemeVersionView {
  version: string;
  manifest: ThemeManifestView;
  fileCount: number;
  totalBytes: number;
  createdBy: string | null;
  createdAt: string | null;
}

/**
 * 版本目标端（M15 第⑤步，含 P1 存量口径）：manifest.target 缺失/非法
 * 一律视为 desktop（存量主题本就是桌面布局）；仅显式 mobile 归移动端。
 */
export function versionTarget(v: ThemeVersionView): "desktop" | "mobile" {
  return v.manifest?.target === "mobile" ? "mobile" : "desktop";
}

/** 是否为无 target 声明的存量版本（标注用） */
export function isLegacyTargetVersion(v: ThemeVersionView): boolean {
  const t = v.manifest?.target;
  return t !== "desktop" && t !== "mobile";
}

/** 版本可绑入的槽位：与 versionTarget 同口径（存量只入桌面槽） */
export function versionFitsSlot(v: ThemeVersionView, slot: ThemeSlotName): boolean {
  return versionTarget(v) === slot;
}

/** 槽位中文名 */
export const THEME_SLOT_LABEL: Record<ThemeSlotName, string> = {
  desktop: "桌面端",
  mobile: "移动端",
};

/** 版本端别标注文案：移动 / 桌面 / 桌面（存量） */
export function versionTargetLabel(v: ThemeVersionView): string {
  if (versionTarget(v) === "mobile") return "移动";
  return isLegacyTargetVersion(v) ? "桌面（存量）" : "桌面";
}

export interface ThemeBoundEntry {
  entryId: string;
  entryName: string;
  hosts: string[];
  version: string;
}

/** 主题（GET /admin/themes 的行形状：主题 + 版本 + 当前绑定入口） */
export interface ThemeItem {
  id: string;
  name: string;
  description: string | null;
  /**
   * 供给维度（M15 第④步立 builtin/app；第 74 步 B′ 改版）：app = 应用私有；
   * domain = 领域货架（同领域应用可见可绑）；builtin = 已退役的内置供给
   * （存量迁移窗口才可能出现）。
   */
  scope: "builtin" | "app" | "domain";
  /** scope=app 时的归属应用 id；其余为 null */
  ownerAppId?: string | null;
  /** scope=domain 时的领域 key；其余为 null */
  domainKey?: string | null;
  /** 内置主题克隆：builtin = 系统内置（只可克隆、不可改删），custom = 上传/克隆 */
  kind?: "builtin" | "custom";
  /** 克隆的来源内置主题 id / 版本；非克隆为 null */
  sourceThemeId?: string | null;
  sourceVersion?: string | null;
  versions: ThemeVersionView[];
  boundEntries: ThemeBoundEntry[];
}

export interface ThemeUploadResult {
  themeId: string;
  version: string;
  fileCount: number;
  totalBytes: number;
  scope?: "builtin" | "app" | "domain";
  ownerAppId?: string | null;
  domainKey?: string | null;
  /** 10-28 定：重传替换旧版时 true */
  replaced?: boolean;
  replacedVersions?: string[];
}

/** 主题上传校验失败：problems 为服务端逐项原因（契约 §1 校验清单） */
export class ThemeUploadError extends Error {
  problems: string[];
  constructor(message: string, problems: string[]) {
    super(message);
    this.problems = problems;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * 资产内容打开地址（契约 M9 §2.3）：contentUrl 是相对路径，拼上 API 基址，
 * 并带 ?t=<当前 admin token>（内容端点支持 Authorization 头或 ?t= 两种鉴权，
 * 新窗打开无法带头，只能走 ?t=）。
 */
export function assetOpenUrl(contentUrl: string): string {
  const token = getToken();
  const sep = contentUrl.includes("?") ? "&" : "?";
  return `${API_BASE}${contentUrl}${token ? `${sep}t=${encodeURIComponent(token)}` : ""}`;
}

/** 平台资产（契约 M9 §2.3 资产 JSON 形状；列表多返回租户字段，前端防御式取值） */
export interface AssetItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  visibility: string;
  appId?: string | null;
  entity?: string | null;
  recordId?: string | null;
  field?: string | null;
  tenantId?: string | null;
  tenant_id?: string | null;
  createdBy?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  contentUrl: string;
}

/** 管理侧数据端点族的字段元数据（来自已发布 schema，M15 第③步） */
export interface AdminFieldMeta {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  sensitive?: boolean;
  options?: { label: string; value: string }[] | string[];
  refEntity?: string;
}

export interface AdminEntityMeta {
  key: string;
  label: string;
  /** 父实体关联字段（自引用层级实体，如栏目 parent_id） */
  parentField?: string;
  /**
   * 调用者对该实体的数据动作（第 56 步）：服务端按数据权限三档裁剪下发，
   * 值为 read/create/update/delete 的子集；actions 为空的实体不在 meta 中出现。
   * 页面动作按钮以此为唯一门控（只有 read 的实体不渲染新建/编辑/删除）。
   */
  actions: string[];
  fields: AdminFieldMeta[];
}

/** 领域模块清单（platform_apps.domain_modules 的形状：骨架 + 角色映射 + 固有清单） */
export interface DomainModulesView {
  skeleton: string;
  roles: Record<string, string>;
  inherent: { entities: string[]; fields: Record<string, unknown[]> };
}

export interface AdminDataMeta {
  app: { id: string; name: string | null; domain: string | null };
  domainModules: DomainModulesView | null;
  published: boolean;
  /** 已发布 Schema 的全量实体 key 清单（不裁剪）；旧版服务可能不返回，回落 entities */
  schemaEntities?: string[];
  entities: AdminEntityMeta[];
}

/** 公开提交（留言等公开表单的待审记录） */
export interface SubmissionItem {
  id: string;
  appId: string;
  entity: string;
  body: Record<string, unknown>;
  status: string;
  createdAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

/** 应用会员（会员试点）：注册表 platform_app_members 的管理台视图（不含凭据） */
export interface MemberItem {
  id: string;
  identifier: string;
  displayName: string | null;
  /** active | disabled */
  status: string;
  /** 生效会员域 */
  scope: string;
  createdAt: string | null;
  /** 已授予的会员侧角色 key（第 60 步 R2，按当前应用；无任命恒空数组） */
  roles?: string[];
}

/** 会员侧角色候选项（第 60 步 R2）：应用已发布设计中声明的会员侧角色 */
export interface MemberRoleCandidate {
  key: string;
  label: string;
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
  if (!token) localStorage.removeItem(GRANTS_KEY);
}

/** 应用运营授权（M15 授权层）：非 admin 登录管理台的依据 */
export interface GrantApp {
  id: string;
  name: string;
  role: string;
  /**
   * 可运营来源（第 56 步 E1）：grant = 显式运营授权；derived = 领域角色命中推导。
   * admin 身份时服务端不下发此字段（role 恒为 admin）。
   */
  source?: "grant" | "derived";
}

/** 按应用的运营名单（第 56 步只读端点）：grant 与推导合并、逐项标注来源 */
export interface AppOperator {
  userId: string;
  username: string;
  displayName: string | null;
  role: string;
  source: "grant" | "derived";
}

/**
 * 管理侧流程待办（第 56 步）：按调用者数据权限整形的记录摘要；
 * record 在调用者无该行读权限时为 null。
 */
export interface FlowTaskView {
  id: string;
  instanceId: string;
  workflowId: string;
  entity: string;
  recordId: string;
  nodeLabel: string | null;
  mode: string;
  status: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneeRole: string | null;
  createdAt: string;
  instance: { createdByName: string | null; createdAt: string };
  record: Row | null;
}
/** 客服会话记录（第 56 步 D7 只读端点）：会话头 + 逐条消息 */
export interface ConversationView {
  id: string;
  status: string;
  visitorName: string | null;
  contact: string | null;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ConversationMessage {
  id: string;
  role: string;
  text: string;
  status: string;
  createdAt: string;
}
export interface TranscriptView {
  conversation: ConversationView;
  messages: ConversationMessage[];
}
export interface GrantsMe {
  isAdmin: boolean;
  apps: GrantApp[];
}

/** 管理台助手待确认动作（第 83 步片三 ops 面：生效类写操作先提案后确认） */
export interface AdminAssistantPendingAction {
  /** platformAction / adminDataCreate / adminDataUpdate / flowAct / themeBind / staticRebuild 等 */
  kind: string;
  /** 产出该动作的工具名 */
  tool?: string;
  summary: string;
  fields?: { label: string; value: string }[];
  /** 已处理（确认或取消）后为对象，含决定与结果说明；未处理为 null */
  handled?: { decision: string; at: string; outcome?: string } | null;
}

/** 助手消息结构化结果里的动作控件（第 90 步协议 v2 最小集）：href 外链新开、route 站内跳转 */
export interface AdminAssistantPayloadAction {
  label: string;
  href?: string;
  route?: string;
  primary?: boolean;
}

/**
 * 助手消息结构化结果载荷（第 90 步线 B 协议）：服务端在特定直执结果
 * （如 theme_create 成功）时给最终助手消息附带；data 只放非敏感展示
 * 字段。界面按 kind 渲染结果卡，未知 kind 回落通用卡，不阻塞文本呈现。
 */
export interface AdminAssistantOptionsCardItem {
  key: string;
  label: string;
  description?: string;
}

/** 选项卡片（选项类型消息）：助手出选择题时挂在消息 payload 上 */
export interface AdminAssistantOptionsCard {
  question?: string;
  options: AdminAssistantOptionsCardItem[];
  recommendedKey: string;
  recommendReason?: string;
  chosenKey?: string;
  chosenAt?: string;
}

export interface AdminAssistantPayload {
  kind: string;
  title?: string;
  actions?: AdminAssistantPayloadAction[];
  data?: Record<string, unknown>;
  /** 对话记录里的计划卡片指针（103-6 用户修订）：只存任务 id */
  planCard?: { taskId: string };
  /** 对话记录里的派发卡片指针（103-6 用户修订）：任务 id + 派发序号 */
  delegationCard?: { taskId: string; index: number };
  /** 对话记录里的选项卡片：助手出选择题时的选项与推荐项 */
  optionsCard?: AdminAssistantOptionsCard;
}

/** 助手任务卡行（第 90 步线 B tasks 端点；第 91 步线 A 工作台补全详情字段，皆可选、缺失即不展示） */
export interface AdminAssistantTask {
  id: string;
  title: string;
  status: string;
  /** 任务种类（服务端 taskView 本就回，前端此前漏声明）：plan 计划、theme_build 主题 */
  kind?: string;
  checklist: { label: string; status: string; evidence?: string }[];
  updatedAt: string | null;
  /** 目标一句话（设计 6.3 状态卡字段，二期详情透出） */
  goal?: string | null;
  /** 产物（如主题 id@版本、记录 id 集；形状随任务类型，界面防御式呈现） */
  artifacts?: unknown;
  /** 已定决定（字符串或字符串数组，界面防御式呈现） */
  decisions?: unknown;
  /** 下一步 */
  nextStep?: string | null;
  conversationId?: string | null;
  createdAt?: string | null;
  /** run 面（服务端 taskView 本就回，前端此前漏声明） */
  runId?: string | null;
  runStatus?: string | null;
  spentTokens?: number | null;
  budgetTokens?: number | null;
  traceId?: string | null;
}

/** 任务 run 节点（D6 首批：节点名、状态、尝试次数、产物引用） */
export interface AdminTaskRunNode {
  nodeId: string;
  kind: string | null;
  phase: string | null;
  status: string;
  attempts: number;
  reopenAttempts: number;
  error: string | null;
  outputArtifacts: string[];
}

/** 任务 run 产物（只含引用，不含全文；primary 为当前主版本） */
export interface AdminTaskRunArtifact {
  artifactId: string;
  kind: string | null;
  version: number;
  path: string;
  bytes: number | null;
  isPrimary: boolean;
  status: string | null;
  createdAt: string | null;
}

/** 任务 run 终审轮次（D6 第二批只读） */
export interface AdminTaskRunVerdict {
  round: number;
  verdict: string | null;
  reasoning: string | null;
  acceptanceGaps: string[];
  reopenProposals: Array<{ nodeId: string; reason: string; severity: string }>;
  createdAt: string | null;
}

/** 任务 run 执行时间线事件（D6 第二批只读） */
export interface AdminTaskRunTimelineEvent {
  seq: number | null;
  kind: string;
  createdAt: string | null;
  nodeId: string | null;
  summary: string;
}

/** 任务 run 产物正文（D6 第二批只读，大产物只回预览） */
export interface AdminTaskRunArtifactContent {
  artifactId: string;
  version: number;
  path: string;
  kind: string | null;
  bytes: number | null;
  isPrimary: boolean;
  status: string | null;
  createdAt: string | null;
  preview: string;
  truncated: boolean;
  totalChars: number;
}

/** 任务 run 通知（终态/暂停通知账本行，最新在前） */
export interface AdminTaskRunNotification {
  title: string;
  body: string;
  createdAt: string | null;
}

/**
 * 任务 run 待决事项（暂停原因 / 终审未达标，带处理入口）。
 * 主题分段审批（契约第 5 节冻结形状）：awaiting_preview 时推
 * theme-preview 项、载 preview payload；awaiting_bind 时推
 * theme-bind 项、载主题名；两类项的 preview / themeName 均
 * 为可选字段，缺失时界面以通用文案回落、不造数据。
 */
export interface AdminTaskRunPending {
  type: "pause" | "critic" | "theme-preview" | "theme-bind";
  reason: string | null;
  recoveryActions: string[];
  gaps: string[];
  createdAt: string | null;
  themeName?: string | null;
  styleSummary?: string | null;
  pages?: string[] | null;
  changes?: string[] | null;
  preview?: {
    themeName?: string | null;
    styleSummary?: string | null;
    pages?: string[] | null;
    changes?: string[] | null;
  } | null;
}

/** 任务 run 详情（D6 首批只读聚合） */
export interface AdminTaskRunDetail {
  task: AdminAssistantTask;
  run: {
    runId: string;
    runStatus: string | null;
    spentTokens: number | null;
    budgetTokens: number | null;
    traceId: string | null;
  } | null;
  nodes: AdminTaskRunNode[];
  artifacts: AdminTaskRunArtifact[];
  primaryArtifact: AdminTaskRunArtifact | null;
  notifications: AdminTaskRunNotification[];
  pendingItems: AdminTaskRunPending[];
  verdicts: AdminTaskRunVerdict[];
  timeline: AdminTaskRunTimelineEvent[];
  canBind: boolean;
  latestVerdict: string | null;
}

/** 主题绑定门（D6 首批只读）：无产出 run 的版本不拦 */
export interface AdminThemeBindGate {
  themeId: string;
  version: string;
  runId: string | null;
  latestVerdict: string | null;
  canBind: boolean;
}

/**
 * 主动建议候选（第 95 步线 B · B1）：服务端按任务卡与审计读时派生，
 * title/evidence 均为服务端规则模板拼装的中文；fingerprint 只作
 * 处置寻址、rule 为内部枚举——两者界面均不渲染。subject 供前端
 * 拼深链（T 类带 taskId、A 类带 appId/latestAuditId）。
 */
export interface AdminAssistantSuggestion {
  fingerprint: string;
  rule: string;
  appId: string | null;
  severity: number;
  title: string;
  evidence: string;
  subject?: {
    taskId?: string;
    appId?: string;
    latestAuditId?: string;
  } | null;
  derivedAt?: string | null;
}

/**
 * 平台面按应用计数（第 95 步线 B · B1）：只有计数与最近时间，
 * 绝不含任务卡正文/标题/owner（平台维度只给统计数字）。
 */
export interface AdminPlatformSuggestionAppCount {
  appId: string;
  stalledOrFailedTasks: number;
  unverifiedClaims: number;
}

/** 主动建议处置三态（第 95 步）：去办 / 忽略 / 延后 */
export type SuggestionDispositionKind = "acted" | "dismissed" | "snoozed";

/**
 * 回合内工具调用行（第 91 步线 B · B2 透出 tool_calls 既有数据）：
 * 工具名、对象摘要、状态、起止。落点有两处——消息自带或会话详情
 * 顶层（按 messageId 归属），字段别名由 ChatPane 的适配点归一，
 * 此处保持宽松形状、全部可选。
 */
export interface AdminAssistantToolCall {
  id?: string;
  messageId?: string;
  tool?: string;
  name?: string;
  summary?: string;
  /** 线 B 详情 toolCalls 的对象摘要字段名 */
  argsSummary?: string;
  target?: string;
  status?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt?: string | null;
}

/** 助手长期记忆类别（第 91 步线 B · B1：偏好 / 决定 / 长期事项 / 事实） */
export type AdminAssistantMemoryCategory =
  | "preference"
  | "decision"
  | "longterm"
  | "fact";

/**
 * 助手长期记忆条目（第 91 步线 B · B1，platform_assistant_memories）：
 * scope 为 "platform" 或应用 id；writeMode 为 explicit（用户明示直写）
 * 或 proposed_confirmed（助手提议经确认）；助手提议未确认的候选以
 * status="pending"（或 writeMode="proposed"）标识，进待确认区。
 */
export interface AdminAssistantMemory {
  id: string;
  owner?: string;
  scope: string;
  category: string;
  content: string;
  sourceConversationId?: string | null;
  writeMode?: string | null;
  status?: string | null;
  expiresAt?: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
}

/** 管理台助手消息（会话详情形状，与员工面同构） */
export interface AdminAssistantMessage {
  id: string;
  /** user / assistant / system */
  role: string;
  text: string;
  citations?: { docTitle: string; snippet: string }[] | null;
  pendingAction?: AdminAssistantPendingAction | null;
  /** 结构化结果载荷（协议 v2，可空；旧消息与普通回复无此字段） */
  payload?: AdminAssistantPayload | null;
  /** 本回合工具调用（第 91 步线 B · B2 过程可见；也可能挂在会话详情顶层） */
  toolCalls?: AdminAssistantToolCall[] | null;
  /** generating / done / failed */
  status: string;
  createdAt: string | null;
}

/** 管理台助手会话头（列表与详情共用） */
export interface AdminAssistantConversation {
  id: string;
  title: string | null;
  /** 发起人（监督视图 scope=all 的列表与详情才回） */
  username?: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 管理台助手确认结果：executed 表示已确定性执行，message 为执行结果说明 */
export interface AdminAssistantConfirmResult {
  ok: boolean;
  executed: boolean;
  message?: string;
  resultMessage?: AdminAssistantMessage;
}

/** 助手面孔键（运行面调整用）：员工助手 / 访客客服 / 运营助手 */
export type AgentFaceKey = "staff" | "visitor" | "ops";

/**
 * 运行面调整字段（第 83 步片二）：只许人设、启停、知识范围三项；
 * 空对象提交 = 清除该面孔的全部调整、回到已发布设置。
 */
export interface AgentOverrideFields {
  systemPrompt?: string;
  enabled?: boolean;
  knowledgeScope?: string;
}

/** 运行面调整行（GET /admin/apps/:appId/agents/overrides 的行形状） */
export interface AgentOverrideRow {
  face: AgentFaceKey;
  fields: AgentOverrideFields;
  updatedBy: string | null;
  /** ISO 时间 */
  updatedAt: string;
}
export interface UserGrant {
  appId: string;
  role: string;
}

const GRANTS_KEY = "lcdp.admin.grants";

export function storeGrants(g: GrantsMe | null): void {
  if (g) localStorage.setItem(GRANTS_KEY, JSON.stringify(g));
  else localStorage.removeItem(GRANTS_KEY);
}

export function getStoredGrants(): GrantsMe | null {
  try {
    const raw = localStorage.getItem(GRANTS_KEY);
    return raw ? (JSON.parse(raw) as GrantsMe) : null;
  } catch {
    return null;
  }
}

const EXPIRED_KEY = "lcdp.admin.expired";
let sessionExpiredHandled = false;

/**
 * 会话失效（401）统一处理：清本地会话并整页重载回登录视图（App 以存储的
 * 用户信息决定渲染登录页与否），登录页据 sessionStorage 标记给「已失效」
 * 提示。登录请求自身的 401 是口令错误、由登录表单报错，不走这里；
 * 并发请求同时 401 只处理一次。本页无独立登录路由，故以重载回登录视图
 * 实现「自动跳登录页」；重载后路径不变，重新登录即回到原页面。
 */
export function expireSession(): void {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  storeSession(null, null);
  try {
    sessionStorage.setItem(EXPIRED_KEY, "1");
  } catch {
    /* sessionStorage 不可用时仅退回登录视图、不带提示 */
  }
  window.location.reload();
}

/** 登录页读取并清除「会话已失效」标记（只提示一次） */
export function consumeExpiredFlag(): boolean {
  try {
    const v = sessionStorage.getItem(EXPIRED_KEY);
    if (v) sessionStorage.removeItem(EXPIRED_KEY);
    return v === "1";
  } catch {
    return false;
  }
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
  if (res.status === 401 && path !== "/auth/login") expireSession();
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string })
    | null;
  if (!res.ok) {
    const err = new Error(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
    ) as ApiRequestError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

/** apiFetch 失败错误：附 HTTP 状态与完整响应体（结构化错误如删除被引用的 referencedBy 在此读取） */
export interface ApiRequestError extends Error {
  status?: number;
  body?: (Record<string, unknown> & { message?: string; error?: string }) | null;
}

/**
 * 带有限重试的 apiFetch（客户端重试口径）：仅对服务端明确拒绝/不可用
 * （429/502/503/504）退避重试，这类响应意味着请求未被业务处理，重发不会
 * 造成重复提交；业务错误（4xx 其余）与网络中断不重试、原样上抛。
 * 目前只用于助手发送——回合本身在服务端异步执行，受理 POST 不应因边缘
 * 瞬时抖动就让用户手动重发。
 */
async function apiFetchWithRetry<T>(
  path: string,
  init?: RequestInit,
  delays: number[] = [800, 2000],
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await apiFetch<T>(path, init);
    } catch (err) {
      lastErr = err;
      const status = (err as ApiRequestError)?.status;
      const retryable =
        status === 429 || status === 502 || status === 503 || status === 504;
      if (!retryable || attempt === delays.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastErr ?? new Error("请求失败");
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** 列表信封归一化：{rows,total} / {<key>: [...]} / 裸数组 都收敛为 {rows,total} */
function pageOf<T>(body: unknown, key?: string): PageResult<T> {
  if (Array.isArray(body)) return { rows: body as T[], total: body.length };
  const b = (body ?? {}) as Record<string, unknown>;
  const raw =
    (Array.isArray(b.rows) ? b.rows : undefined) ??
    (key && Array.isArray(b[key]) ? (b[key] as unknown[]) : undefined) ??
    [];
  const rows = raw as T[];
  const total = typeof b.total === "number" ? b.total : rows.length;
  return { rows, total };
}

export const api = {
  /** 登录：仅做鉴权换 token；role 是否 admin 由调用方把关（非 admin 不落会话） */
  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: UserInfo }> {
    return apiFetch<{ token: string; user: UserInfo }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  users: {
    async list(): Promise<Row[]> {
      const res = await apiFetch<unknown>("/admin/users");
      return pageOf<Row>(res, "users").rows;
    },
    async create(body: {
      username: string;
      password: string;
      role: string;
      displayName?: string | null;
      departmentId?: string | null;
    }): Promise<void> {
      await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** 服务端实况为 PUT /admin/users/:id（契约文字作 PATCH，以实况为准） */
    async update(
      id: string,
      body: {
        role?: string;
        displayName?: string | null;
        departmentId?: string | null;
        password?: string;
      },
    ): Promise<void> {
      await apiFetch(`/admin/users/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    async remove(id: string): Promise<void> {
      await apiFetch(`/admin/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  },

  /** 应用运营授权（M15）：me 查自己；其余为 admin 的发放/回收 */
  grants: {
    async me(): Promise<GrantsMe> {
      return apiFetch<GrantsMe>("/admin/grants/me");
    },
    async listForUser(userId: string): Promise<UserGrant[]> {
      const res = await apiFetch<{ grants: UserGrant[] }>(
        `/admin/users/${encodeURIComponent(userId)}/grants`,
      );
      return res.grants;
    },
    async grant(userId: string, appId: string): Promise<void> {
      await apiFetch(`/admin/users/${encodeURIComponent(userId)}/grants`, {
        method: "POST",
        body: JSON.stringify({ appId }),
      });
    },
    async revoke(userId: string, appId: string): Promise<void> {
      await apiFetch(
        `/admin/users/${encodeURIComponent(userId)}/grants/${encodeURIComponent(appId)}`,
        { method: "DELETE" },
      );
    },
    /** 按应用查运营名单（第 56 步）：grant ∪ 推导合并名单，只读 */
    async listForApp(appId: string): Promise<AppOperator[]> {
      const res = await apiFetch<{ appId: string; operators: AppOperator[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/grants`,
      );
      return Array.isArray(res.operators) ? res.operators : [];
    },
  },

  tenants: {
    async list(): Promise<Row[]> {
      const res = await apiFetch<unknown>("/admin/tenants");
      return pageOf<Row>(res, "tenants").rows;
    },
    async create(body: { id?: string; name: string }): Promise<void> {
      await apiFetch("/admin/tenants", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async update(id: string, body: { name?: string }): Promise<void> {
      await apiFetch(`/admin/tenants/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
  },

  site: {
    /** 应用站点属性读（域名/模式/主题双槽/主应用/应用别名 + 平台域名常量）。
     * accessTier（第 81 步）：调用者对本应用的管理档位 t0/t1/t2，前端
     * 据此呈现写控件（t2 只读）；执法以服务端各写端点断言为准。 */
    async get(
      appId: string,
    ): Promise<{
      app: SiteAppView;
      accessTier: "t0" | "t1" | "t2" | null;
      defaultHost: string;
      memberCenterHost: string;
    }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(appId)}/site`);
    },
    /**
     * 应用站点属性写（第 68 步）：只传要改的字段、互不覆盖。
     * admin 全权；operator 仅可传 themeSlots（主题双槽整体重建：单槽解绑 =
     * 该槽置 null、null = 双槽全解绑），其余字段服务端 400。
     * 校验口径：默认域名仅主应用可绑、设主应用前须先解绑专属域名、
     * 域名/应用别名租户内唯一——错误原文由调用方呈现。
     */
    async update(
      appId: string,
      body: {
        boundHost?: string | null;
        siteMode?: SiteMode;
        themeSlots?: ThemeSlots | null;
        isPrimary?: boolean;
        nameEn?: string | null;
        /** 应用显示名改名（第 80 步，仅 admin；operator 传此字段服务端 400） */
        name?: string;
      },
    ): Promise<{ ok: boolean; app: SiteAppView }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(appId)}/site`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
  },

  themes: {
    async list(): Promise<ThemeItem[]> {
      const res = await apiFetch<{ themes: ThemeItem[] }>("/admin/themes");
      return res.themes;
    },
    /**
     * 主题预览签发（第 83 步片五，路线 A）：为指定主题版本在本应用
     * 签发短时效（30 分钟）预览地址，新标签打开即以该主题渲染、
     * 不改当前绑定。预览是查看动作，领域角色（只读档）同样可用。
     */
    async preview(
      appId: string,
      body: { themeId: string; version: string; slot: ThemeSlotName },
    ): Promise<{ url: string; expiresAt: string }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(appId)}/themes/preview`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /**
     * 内置主题克隆（第二阶段）：创建只落注册表行与改动层，不写版本、
     * 不写绑定指针，线上呈现零变化；生效、预览、绑定另走专属端点。
     * 改动层四段只许 tokens/layout/config/navigation，顶层禁项整单拒绝。
     */
    async createClone(
      appId: string,
      body: { sourceThemeId: string; sourceVersion: string; changeLayer: Record<string, unknown> },
    ): Promise<{ cloneId: string; sourceThemeId: string; sourceVersion: string; target: string }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(appId)}/themes/clone`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async clonePreviewList(
      appId: string,
      cloneId: string,
    ): Promise<{
      cloneId: string;
      sourceThemeId: string;
      sourceVersion: string;
      target: string;
      routes: string[];
      routeCount: number;
      preview: {
        tokenChanges: Array<{ key: string; from: unknown; to: unknown }>;
        configChanges: Array<{ key: string; from: unknown; to: unknown }>;
        layoutChanges: string[];
        navigationChanges: Array<{ route: string; hidden?: boolean; order?: number }>;
        skippedNavigation: Array<{ route: string; reason: string }>;
      };
    }> {
      return apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/themes/${encodeURIComponent(cloneId)}/preview-list`,
      );
    },
    async clonePreview(
      appId: string,
      cloneId: string,
    ): Promise<{ cloneId: string; version: string; url: string; expiresAt: string }> {
      return apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/themes/${encodeURIComponent(cloneId)}/preview`,
        { method: "POST" },
      );
    },
    async cloneBind(
      appId: string,
      cloneId: string,
    ): Promise<{ cloneId: string; version: string; target: string }> {
      return apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/themes/${encodeURIComponent(cloneId)}/bind`,
        { method: "POST" },
      );
    },
    async cloneUnbind(
      appId: string,
      cloneId: string,
    ): Promise<{ cloneId: string; target: string; builtinId: string; builtinVersion: string }> {
      return apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/themes/${encodeURIComponent(cloneId)}/unbind`,
        { method: "POST" },
      );
    },
    /**
     * 删除主题（服务端：仅平台管理员，内置不可删、已绑定回 409）。
     * 管理台只给克隆行渲染删除入口：克隆是智能体用的中间产物，
     * 测试完即可删；内置与上传主题不在此入口内。
     */
    async remove(themeId: string): Promise<{ ok: boolean; themeId: string }> {
      return apiFetch(`/admin/themes/${encodeURIComponent(themeId)}`, {
        method: "DELETE",
      });
    },
    /**
     * multipart 上传主题包 zip：校验失败抛 ThemeUploadError（带逐项 problems）。
     * 归属二选一（第 74 步起服务端必填）：appId → 应用私有通道（服务端按该
     * 应用的运营授权执法，落 scope=app / owner=appId）；domainKey → 领域
     * 货架通道（仅 admin，落 scope=domain）。旧的无归属内置通道已退役。
     */
    async upload(
      file: File,
      target: { appId?: string; domainKey?: string },
    ): Promise<ThemeUploadResult> {
      const token = getToken();
      const fd = new FormData();
      fd.set("file", file);
      if (target.appId) fd.set("appId", target.appId);
      if (target.domainKey) fd.set("domainKey", target.domainKey);
      const res = await fetch(`${API_BASE}/admin/themes`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (res.status === 401) expireSession();
      const body = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & {
            message?: string;
            error?: string;
            problems?: unknown;
          })
        | null;
      if (!res.ok) {
        const problems = Array.isArray(body?.problems)
          ? body.problems.filter((p): p is string => typeof p === "string")
          : [];
        throw new ThemeUploadError(
          body?.message ?? body?.error ?? `上传失败 (${res.status})`,
          problems,
        );
      }
      return body as unknown as ThemeUploadResult;
    },
  },

  staticGen: {
    async status(appId: string): Promise<StaticSiteStatus[]> {
      const res = await apiFetch<{ appId: string; sites: StaticSiteStatus[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/static/status`,
      );
      return res.sites;
    },
    async rebuild(
      appId: string,
    ): Promise<{ ok: boolean; queued: number; notes: string[] }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(appId)}/static/rebuild`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  },

  apps: {
    async list(): Promise<Row[]> {
      const res = await apiFetch<unknown>("/admin/apps");
      return pageOf<Row>(res, "apps").rows;
    },
    async setStatus(id: string, status: "active" | "disabled"): Promise<void> {
      await apiFetch(`/admin/apps/${encodeURIComponent(id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    /** 新建应用（POST /apps，admin）：可选 domain 锚定主领域、骨架落初始草稿 */
    async create(body: {
      id: string;
      name: string;
      domain?: string;
    }): Promise<Row> {
      const res = await apiFetch<{ ok: boolean; app: Row }>("/apps", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return res.app;
    },
    /**
     * 删除应用（对象形态归正 P3 端点，admin）：confirm 须与应用 id 全文一致，
     * 服务端单事务级联（设计/数据/流程/授权/资产/会话；审计留痕、入口仅摘除）。
     */
    async remove(id: string): Promise<{ id: string; deleted: Record<string, number> }> {
      return apiFetch(`/admin/apps/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm: id }),
      });
    },
  },

  domains: {
    /** 领域注册表（GET /domains，Studio 同款）：新建应用的领域下拉数据源 */
    async list(): Promise<DomainInfo[]> {
      const res = await apiFetch<{ domains: DomainInfo[] }>("/domains");
      return Array.isArray(res.domains) ? res.domains : [];
    },
  },

  /** 应用会员（会员试点）：按应用生效会员域列会员（标识搜索 + 分页）与启停 */
  members: {
    async list(
      appId: string,
      params?: { q?: string; limit?: number; offset?: number },
    ): Promise<{
      members: MemberItem[];
      total: number;
      scope: string;
      roleCandidates: MemberRoleCandidate[];
    }> {
      const res = await apiFetch<{
        members: MemberItem[];
        total: number;
        scope: string;
        roleCandidates?: MemberRoleCandidate[];
      }>(
        `/admin/apps/${encodeURIComponent(appId)}/members${qs({
          q: params?.q,
          limit: params?.limit,
          offset: params?.offset,
        })}`,
      );
      return {
        members: Array.isArray(res.members) ? res.members : [],
        total: typeof res.total === "number" ? res.total : 0,
        scope: typeof res.scope === "string" ? res.scope : "",
        roleCandidates: Array.isArray(res.roleCandidates)
          ? res.roleCandidates
          : [],
      };
    },
    /**
     * 会员侧角色任命（第 60 步 R2）：全量设置该会员在本应用的角色集
     * （空数组 = 撤销全部）；合法值以服务端候选集为准，越界 400。
     */
    async setRoles(
      appId: string,
      memberId: string,
      roleKeys: string[],
    ): Promise<MemberItem> {
      const res = await apiFetch<{ ok: boolean; member: MemberItem }>(
        `/admin/apps/${encodeURIComponent(appId)}/members/${encodeURIComponent(memberId)}/roles`,
        { method: "POST", body: JSON.stringify({ roleKeys }) },
      );
      return res.member;
    },
    async setStatus(
      appId: string,
      memberId: string,
      status: "active" | "disabled",
    ): Promise<MemberItem> {
      const res = await apiFetch<{ ok: boolean; member: MemberItem }>(
        `/admin/apps/${encodeURIComponent(appId)}/members/${encodeURIComponent(memberId)}/status`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
      return res.member;
    },
  },

  audit: {
    async list(params: {
      action?: string;
      actor?: string;
      appId?: string;
      tenantId?: string;
      /** 对象形态归正 P1：scope=platform 时只回无应用归属（app_id 为空）的平台级事件 */
      scope?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(`/admin/audit${qs(params)}`);
      return pageOf<Row>(res);
    },
    /**
     * 按应用审计（对象形态归正 P2 端点）：强制 app_id = 路径应用，
     * 其余参数与响应形状同全局 list；运营者凭本应用运营资格可达。
     */
    async listForApp(
      appId: string,
      params: {
        action?: string;
        actor?: string;
        from?: string;
        to?: string;
        page?: number;
        pageSize?: number;
      },
    ): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/apps/${encodeURIComponent(appId)}/audit${qs(params)}`,
      );
      return pageOf<Row>(res);
    },
  },

  replay: {
    async conversations(params?: {
      page?: number;
      pageSize?: number;
      appId?: string;
      username?: string;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/conversations${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    /**
     * 按应用回放会话（对象形态归正 P2 端点）：强制 conv.app_id = 路径应用，
     * 其余参数与响应形状同全局 conversations；运营者凭本应用运营资格可达。
     */
    async listForApp(
      appId: string,
      params?: { page?: number; pageSize?: number; username?: string },
    ): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/conversations${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    async conversation(id: string): Promise<{
      conversation: Row;
      messages: Row[];
      toolCalls: Row[];
    }> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/replay/conversations/${encodeURIComponent(id)}`,
      );
      return {
        conversation: (res.conversation as Row) ?? (res as Row),
        messages: Array.isArray(res.messages) ? (res.messages as Row[]) : [],
        toolCalls: Array.isArray(res.toolCalls)
          ? (res.toolCalls as Row[])
          : [],
      };
    },
    /**
     * 按应用会话详情（对象形态归正按应用回放端点）：会话不属该应用回 404，
     * 响应形状同全局 conversation。
     */
    async conversationForApp(
      appId: string,
      id: string,
    ): Promise<{
      conversation: Row;
      messages: Row[];
      toolCalls: Row[];
    }> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/conversations/${encodeURIComponent(id)}`,
      );
      return {
        conversation: (res.conversation as Row) ?? (res as Row),
        messages: Array.isArray(res.messages) ? (res.messages as Row[]) : [],
        toolCalls: Array.isArray(res.toolCalls)
          ? (res.toolCalls as Row[])
          : [],
      };
    },
    async proposals(params?: {
      page?: number;
      pageSize?: number;
      appId?: string;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/proposals${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    /** 按应用提案列表（对象形态归正按应用回放端点），响应形状同全局 proposals。 */
    async proposalsForApp(
      appId: string,
      params?: { page?: number; pageSize?: number },
    ): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/proposals${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    async proposal(id: string): Promise<Row> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/replay/proposals/${encodeURIComponent(id)}`,
      );
      return ((res.proposal as Row) ?? res) as Row;
    },
    /** 按应用提案详情：提案不属该应用回 404，响应形状同全局 proposal。 */
    async proposalForApp(appId: string, id: string): Promise<Row> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/proposals/${encodeURIComponent(id)}`,
      );
      return ((res.proposal as Row) ?? res) as Row;
    },
    async flows(params?: {
      page?: number;
      pageSize?: number;
      appId?: string;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/flows${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    /** 按应用流程列表（对象形态归正按应用回放端点），响应形状同全局 flows。 */
    async flowsForApp(
      appId: string,
      params?: { page?: number; pageSize?: number },
    ): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/flows${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    async flow(id: string): Promise<{
      instance: Row;
      tasks: Row[];
      events: Row[];
    }> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/replay/flows/${encodeURIComponent(id)}`,
      );
      return {
        instance: ((res.instance as Row) ?? (res.flow as Row) ?? res) as Row,
        tasks: Array.isArray(res.tasks) ? (res.tasks as Row[]) : [],
        events: Array.isArray(res.events) ? (res.events as Row[]) : [],
      };
    },
    /** 按应用流程详情：实例不属该应用回 404，响应形状同全局 flow。 */
    async flowForApp(
      appId: string,
      id: string,
    ): Promise<{
      instance: Row;
      tasks: Row[];
      events: Row[];
    }> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/apps/${encodeURIComponent(appId)}/replay/flows/${encodeURIComponent(id)}`,
      );
      return {
        instance: ((res.instance as Row) ?? (res.flow as Row) ?? res) as Row,
        tasks: Array.isArray(res.tasks) ? (res.tasks as Row[]) : [],
        events: Array.isArray(res.events) ? (res.events as Row[]) : [],
      };
    },
  },

  kb: {
    async documents(appId?: string): Promise<Row[]> {
      const res = await apiFetch<unknown>(
        `/admin/kb/documents${qs({ appId })}`,
      );
      return pageOf<Row>(res, "documents").rows;
    },
    async create(body: {
      appId: string;
      title: string;
      content: string;
    }): Promise<void> {
      await apiFetch("/admin/kb/documents", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async remove(id: string): Promise<void> {
      await apiFetch(`/admin/kb/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    async reembed(id: string): Promise<void> {
      await apiFetch(`/admin/kb/documents/${encodeURIComponent(id)}/reembed`, {
        method: "POST",
      });
    },
    async pending(): Promise<Row[]> {
      const res = await apiFetch<unknown>("/admin/kb/pending");
      return pageOf<Row>(res, "documents").rows;
    },
    async review(id: string, decision: "approve" | "reject"): Promise<void> {
      // 服务端实况：通过/驳回是两个独立端点（无 decision 请求体）
      await apiFetch(
        `/admin/kb/documents/${encodeURIComponent(id)}/${decision === "approve" ? "approve" : "reject"}`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    /**
     * 应用面知识库（第 81 步 G4）：文档与待审队列按当前应用治理——
     * 文档面限 t0/t1，待审队列另对 support 领域 t2 开放（服务端断言）。
     */
    app: {
      async documents(appId: string): Promise<Row[]> {
        const res = await apiFetch<unknown>(
          `/admin/apps/${encodeURIComponent(appId)}/kb/documents`,
        );
        return pageOf<Row>(res, "documents").rows;
      },
      async create(
        appId: string,
        body: { title: string; content: string },
      ): Promise<void> {
        await apiFetch(`/admin/apps/${encodeURIComponent(appId)}/kb/documents`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      async remove(appId: string, id: string): Promise<void> {
        await apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/kb/documents/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
      },
      async reembed(appId: string, id: string): Promise<void> {
        await apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/kb/documents/${encodeURIComponent(id)}/reembed`,
          { method: "POST" },
        );
      },
      async pending(appId: string): Promise<Row[]> {
        const res = await apiFetch<unknown>(
          `/admin/apps/${encodeURIComponent(appId)}/kb/pending`,
        );
        return pageOf<Row>(res, "rows").rows;
      },
      async review(
        appId: string,
        id: string,
        decision: "approve" | "reject",
      ): Promise<void> {
        await apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/kb/documents/${encodeURIComponent(id)}/${decision === "approve" ? "approve" : "reject"}`,
          { method: "POST", body: JSON.stringify({}) },
        );
      },
    },
  },

  usage: {
    async query(params: {
      groupBy: "day" | "app" | "channel" | "model" | "pool" | "hour";
      from?: string;
      to?: string;
      tenantId?: string;
    }): Promise<{ meteringStart: string | null; rows: Row[] }> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/usage${qs(params)}`,
      );
      return {
        meteringStart:
          typeof res.meteringStart === "string" ? res.meteringStart : null,
        rows: Array.isArray(res.rows) ? (res.rows as Row[]) : [],
      };
    },
  },

  config: {
    async get(): Promise<Row[]> {
      const res = await apiFetch<Record<string, unknown>>("/admin/config");
      return Array.isArray(res.items) ? (res.items as Row[]) : [];
    },
    async put(items: { key: string; scope: string; value: unknown }[]): Promise<void> {
      await apiFetch("/admin/config", {
        method: "PUT",
        body: JSON.stringify({ items }),
      });
    },
    async test(
      channel: "chat" | "embedding" | "storage" | "mail",
    ): Promise<{
      ok: boolean;
      // 成功响应不带 message（只有 ok/model/dimensions/latencyMs），失败才有 message
      message?: string;
      model?: string;
      dimensions?: number;
      latencyMs?: number;
    }> {
      return apiFetch("/admin/config/test", {
        method: "POST",
        body: JSON.stringify({ channel }),
      });
    },
    async rebuildVectors(): Promise<Record<string, unknown>> {
      return apiFetch("/admin/config/rebuild-vectors", { method: "POST" });
    },
  },

  switches: {
    async list(): Promise<Row[]> {
      const res = await apiFetch<unknown>("/admin/agent-switches");
      return pageOf<Row>(res, "switches").rows;
    },
    async put(body: {
      tenantId: string;
      appId: string;
      pool: string;
      disabled: boolean;
      reason?: string;
    }): Promise<void> {
      await apiFetch("/admin/agent-switches", {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
  },

  /** 按应用圈定的资产（第 56 步）：列表/删除走 /admin/apps/:appId/assets，
   * 归属按 app_id 收口，他应用资产不可见不可删（删除回审计 asset.delete） */
  appAssets: {
    async list(
      appId: string,
      params?: { q?: string; limit?: number; offset?: number },
    ): Promise<PageResult<AssetItem>> {
      const res = await apiFetch<{ items: AssetItem[]; total: number }>(
        `/admin/apps/${encodeURIComponent(appId)}/assets${qs({
          q: params?.q,
          limit: params?.limit,
          offset: params?.offset,
        })}`,
      );
      return {
        rows: Array.isArray(res.items) ? res.items : [],
        total: typeof res.total === "number" ? res.total : 0,
      };
    },
    async remove(appId: string, id: string): Promise<void> {
      await apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/assets/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },
  },

  /** 普通资产端点（管理台以上传人身份走 /assets，契约 M9 §2.3） */
  assets: {
    /** multipart 上传：不能走 apiFetch（它固定 JSON 头），FormData 的 Content-Type 由浏览器补 boundary；
     * appId 给出时资产归属该应用（应用资产管理页用），不给则为未归属资产；
     * visibility 显式给出时以其为准（富文本插图/封面显式 public，与 renderer
     * 适配器同口径——服务端 POST /assets 的 multipart 字段名即 visibility） */
    async upload(file: File, appId?: string, visibility?: string): Promise<AssetItem> {
      const token = getToken();
      const fd = new FormData();
      fd.set("file", file);
      if (appId) fd.set("appId", appId);
      if (visibility) fd.set("visibility", visibility);
      const res = await fetch(`${API_BASE}/assets`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (res.status === 401) expireSession();
      const body = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & { message?: string; error?: string })
        | null;
      if (!res.ok) {
        const err = new Error(
          body?.message ?? body?.error ?? `上传失败 (${res.status})`,
        ) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return body as unknown as AssetItem;
    },
  },

  /** 管理侧数据（M15 第③步起，按第 56 步数据权限三档执法、不走员工权限快照；
   * 口径为读 + 新建 + 编辑 + 删除，删除被引用行回 409 referencedBy） */
  adminData: {
    async meta(appId: string): Promise<AdminDataMeta> {
      return apiFetch<AdminDataMeta>(
        `/admin/apps/${encodeURIComponent(appId)}/data`,
      );
    },
    async list(
      appId: string,
      entity: string,
      params?: {
        q?: string;
        limit?: number;
        offset?: number;
        /** 等值筛选：序列化为可重复的 filter=<field>:<value>（与 q 并存同时生效） */
        filters?: Record<string, string>;
      },
    ): Promise<{ rows: Row[]; total: number }> {
      const sp = new URLSearchParams();
      if (params?.q) sp.set("q", params.q);
      if (params?.limit !== undefined) sp.set("limit", String(params.limit));
      if (params?.offset !== undefined) sp.set("offset", String(params.offset));
      for (const [k, v] of Object.entries(params?.filters ?? {})) {
        sp.append("filter", `${k}:${v}`);
      }
      const query = sp.toString();
      const res = await apiFetch<{ rows: Row[]; total: number }>(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}${query ? `?${query}` : ""}`,
      );
      return {
        rows: Array.isArray(res.rows) ? res.rows : [],
        total: typeof res.total === "number" ? res.total : 0,
      };
    },
    async get(appId: string, entity: string, id: string): Promise<Row> {
      const res = await apiFetch<{ row: Row }>(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
      );
      return res.row;
    },
    async update(
      appId: string,
      entity: string,
      id: string,
      fields: Record<string, unknown>,
    ): Promise<{ row: Row; strippedFields: string[] }> {
      const res = await apiFetch<{ row: Row; strippedFields?: string[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(fields) },
      );
      // 第 65 步：strippedFields = 被字段权限静默剔除的请求键（服务端回带）；
      // 调用方据此如实提示，不再报假成功
      return { row: res.row, strippedFields: res.strippedFields ?? [] };
    },
    /** 新建一行（第 56 步）：字段须在已发布 Schema 内、必填/enum/ref 由服务端校验 */
    async create(
      appId: string,
      entity: string,
      fields: Record<string, unknown>,
    ): Promise<{ row: Row; strippedFields: string[] }> {
      const res = await apiFetch<{ row: Row; strippedFields?: string[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}`,
        { method: "POST", body: JSON.stringify(fields) },
      );
      return { row: res.row, strippedFields: res.strippedFields ?? [] };
    },
    /**
     * 删除一行（第 56 步）：被其他记录引用时服务端回 409，
     * 响应体 {error:"referenced", referencedBy:[{entity,field,count}]}，
     * 经 ApiRequestError.body 读取；不静默级联。
     */
    async remove(appId: string, entity: string, id: string): Promise<void> {
      await apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
    },
    /**
     * 会话记录只读（第 56 步 D7）：工单详情的会话区消费；
     * 会话不属该应用时服务端回 404，调用方按空态呈现、不当错误。
     */
    async transcript(appId: string, conversationId: string): Promise<TranscriptView> {
      return apiFetch<TranscriptView>(
        `/admin/apps/${encodeURIComponent(appId)}/conversations/${encodeURIComponent(conversationId)}/transcript`,
      );
    },
  },

  /**
   * 流程待办（第 56 步管理侧队列 + 员工面办理）：
   * 队列走 /admin/apps/:appId/flow/tasks（按调用者数据权限裁剪）；
   * 办理/催办复用员工面端点，执法只认流程指派——运营授权不赋予审批资格。
   */
  flow: {
    async tasks(
      appId: string,
      params?: { status?: string; limit?: number; offset?: number },
    ): Promise<{ tasks: FlowTaskView[]; total: number }> {
      const res = await apiFetch<{ tasks: FlowTaskView[]; total: number }>(
        `/admin/apps/${encodeURIComponent(appId)}/flow/tasks${qs({
          status: params?.status ?? "pending",
          limit: params?.limit,
          offset: params?.offset,
        })}`,
      );
      return {
        tasks: Array.isArray(res.tasks) ? res.tasks : [],
        total: typeof res.total === "number" ? res.total : 0,
      };
    },
    /** 办理（通过/驳回）：指派给他人或角色不匹配时服务端 403 */
    async act(
      appId: string,
      taskId: string,
      decision: "approve" | "reject",
      comment?: string,
    ): Promise<Row> {
      const res = await apiFetch<{ instance: Row }>(
        `/apps/${encodeURIComponent(appId)}/flow/tasks/${encodeURIComponent(taskId)}/act`,
        { method: "POST", body: JSON.stringify({ decision, comment }) },
      );
      return res.instance;
    },
    /** 催办：仅实例发起人（admin 例外）且实例进行中 */
    async urge(appId: string, instanceId: string): Promise<void> {
      await apiFetch(
        `/apps/${encodeURIComponent(appId)}/flow/instances/${encodeURIComponent(instanceId)}/urge`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    /**
     * 可发起清单（第 65 步，管理侧兜底发起面）：复用员工面端点，
     * 执法 = 已发布 permissions（read 权 + 行级范围 + 状态为初始值 + 无在跑实例）；
     * 实体未配置流程时 workflow 为 null。运营授权不赋予发起资格，服务端为准。
     */
    async startable(
      appId: string,
      entity: string,
    ): Promise<{ workflow: { id: string; title: string } | null; records: Row[] }> {
      const res = await apiFetch<{
        workflow: { id: string; title: string } | null;
        records: Row[];
      }>(
        `/apps/${encodeURIComponent(appId)}/flow/startable/${encodeURIComponent(entity)}`,
      );
      return {
        workflow: res.workflow ?? null,
        records: Array.isArray(res.records) ? res.records : [],
      };
    },
    /** 发起流程：成功回流程实例；记录不在可发起范围时服务端报错 */
    async start(appId: string, entity: string, recordId: string): Promise<Row> {
      const res = await apiFetch<{ instance: Row }>(
        `/apps/${encodeURIComponent(appId)}/flow/${encodeURIComponent(entity)}/${encodeURIComponent(recordId)}/start`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return res.instance;
    },
  },

  /** 公开提交审核（端点在 public.ts，M15 第③步补管理台页） */
  submissions: {
    async list(
      appId: string,
      status?: string,
    ): Promise<SubmissionItem[]> {
      const res = await apiFetch<{ submissions: SubmissionItem[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/submissions${qs({ status })}`,
      );
      return Array.isArray(res.submissions) ? res.submissions : [];
    },
    async approve(appId: string, id: string): Promise<void> {
      await apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/submissions/${encodeURIComponent(id)}/approve`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    async reject(appId: string, id: string): Promise<void> {
      await apiFetch(
        `/admin/apps/${encodeURIComponent(appId)}/submissions/${encodeURIComponent(id)}/reject`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
  },

  /**
   * 管理台助手（第 83 步片三/片四）：回合制异步——chat 只受理并返回
   * 会话与消息 id，助手回复经 conversation 详情轮询取回（generating →
   * done/failed）；写操作以待确认动作挂在助手消息上，confirm 后由
   * 服务端确定性执行。平台组仅平台管理员可用；app 组按应用档位执法。
   */
  assistant: {
    async chat(body: {
      conversationId?: string;
      text: string;
      context?: unknown;
    }): Promise<{ conversationId: string; messageId: string }> {
      return apiFetchWithRetry("/admin/assistant/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async conversations(): Promise<AdminAssistantConversation[]> {
      const res = await apiFetch<{
        conversations: AdminAssistantConversation[];
      }>("/admin/assistant/conversations");
      return Array.isArray(res.conversations) ? res.conversations : [];
    },
    async conversation(
      cid: string,
    ): Promise<{
      conversation: AdminAssistantConversation;
      messages: AdminAssistantMessage[];
      toolCalls: AdminAssistantToolCall[];
    }> {
      const res = await apiFetch<{
        conversation: AdminAssistantConversation;
        messages: AdminAssistantMessage[];
        toolCalls?: AdminAssistantToolCall[];
      }>(`/admin/assistant/conversations/${encodeURIComponent(cid)}`);
      return {
        conversation: res.conversation,
        messages: Array.isArray(res.messages) ? res.messages : [],
        toolCalls: Array.isArray(res.toolCalls) ? res.toolCalls : [],
      };
    },
    async confirm(
      messageId: string,
      decision: "confirm" | "cancel",
    ): Promise<AdminAssistantConfirmResult> {
      return apiFetch(
        `/admin/assistant/actions/${encodeURIComponent(messageId)}/confirm`,
        { method: "POST", body: JSON.stringify({ decision }) },
      );
    },
    /**
     * 选项卡片点选：只记选择（chosenKey），不执行写操作；点选后由调用
     * 方以所选项发一条用户消息续跑对话。
     */
    async chooseOption(
      messageId: string,
      key: string,
    ): Promise<{ ok: boolean; chosenKey: string; label: string }> {
      return apiFetch(
        `/admin/assistant/messages/${encodeURIComponent(messageId)}/options-choice`,
        { method: "POST", body: JSON.stringify({ key }) },
      );
    },
    /**
     * 中止本会话进行中的回合（第 91 步线 B · B2）：服务端置生成中
     * 消息 failed 并停后续工具步。端点未就绪时调用方静默降级。
     */
    async cancel(cid: string): Promise<{ ok: boolean }> {
      return apiFetch(`/admin/assistant/conversations/${encodeURIComponent(cid)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    /** 应用组：同一组四件，路径挂在当前应用下（运营助手） */
    app: {
      async chat(
        appId: string,
        body: { conversationId?: string; text: string; context?: unknown },
      ): Promise<{ conversationId: string; messageId: string }> {
        return apiFetchWithRetry(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/chat`,
          { method: "POST", body: JSON.stringify(body) },
        );
      },
      async conversations(
        appId: string,
        opts?: { scope?: "all" },
      ): Promise<AdminAssistantConversation[]> {
        const qs = opts?.scope === "all" ? "?scope=all" : "";
        const res = await apiFetch<{
          conversations: AdminAssistantConversation[];
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/conversations${qs}`,
        );
        return Array.isArray(res.conversations) ? res.conversations : [];
      },
      async conversation(
        appId: string,
        cid: string,
      ): Promise<{
        conversation: AdminAssistantConversation;
        messages: AdminAssistantMessage[];
        toolCalls: AdminAssistantToolCall[];
      }> {
        const res = await apiFetch<{
          conversation: AdminAssistantConversation;
          messages: AdminAssistantMessage[];
          toolCalls?: AdminAssistantToolCall[];
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/conversations/${encodeURIComponent(cid)}`,
        );
        return {
          conversation: res.conversation,
          messages: Array.isArray(res.messages) ? res.messages : [],
          toolCalls: Array.isArray(res.toolCalls) ? res.toolCalls : [],
        };
      },
      async confirm(
        appId: string,
        messageId: string,
        decision: "confirm" | "cancel",
      ): Promise<AdminAssistantConfirmResult> {
        return apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/actions/${encodeURIComponent(messageId)}/confirm`,
          { method: "POST", body: JSON.stringify({ decision }) },
        );
      },
      /** 应用组选项卡片点选（口径同平台组 chooseOption） */
      async chooseOption(
        appId: string,
        messageId: string,
        key: string,
      ): Promise<{ ok: boolean; chosenKey: string; label: string }> {
        return apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/messages/${encodeURIComponent(messageId)}/options-choice`,
          { method: "POST", body: JSON.stringify({ key }) },
        );
      },
      /** 中止本应用会话进行中的回合（第 91 步线 B · B2，口径同平台组 cancel） */
      async cancel(appId: string, cid: string): Promise<{ ok: boolean }> {
        return apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/conversations/${encodeURIComponent(cid)}/cancel`,
          { method: "POST", body: JSON.stringify({}) },
        );
      },
      /**
       * 任务卡列表（第 90 步线 A5 速览 + 第 91 步工作台）：缺省只取
       * 进行中（status=active，与一期口径一致）；传 status 取对应
       * 状态；status 传 "all" 或空串时不带该参数（约定为全部）。
       * 端点由线 B 提供，失败由调用方静默。
       */
      async tasks(
        appId: string,
        opts?: { status?: string },
      ): Promise<AdminAssistantTask[]> {
        const status = opts?.status;
        const qs =
          status === undefined || status === "active"
            ? "?status=active"
            : status === "all" || status === ""
              ? ""
              : `?status=${encodeURIComponent(status)}`;
        const res = await apiFetch<{ tasks: AdminAssistantTask[] }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks${qs}`,
        );
        return Array.isArray(res.tasks) ? res.tasks : [];
      },
      /**
       * 任务 run 详情（D6 首批只读）：节点 + 产物 + 通知 + 待决
       * + 终审门信号；无 run 的任务回空清单，调用方静默降级。
       */
      async taskRun(
        appId: string,
        taskId: string,
      ): Promise<AdminTaskRunDetail | null> {
        try {
          const res = await apiFetch<AdminTaskRunDetail>(
            `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/run`,
          );
          return res && typeof res === "object" ? res : null;
        } catch {
          return null;
        }
      },
      /**
       * 任务 run 执行记录流（SSE 订阅，对话框实时时间线）。
       * 不用浏览器 EventSource：它发不出 Authorization 头，token 只
       * 能塞 URL；这里用 fetch + ReadableStream 手工解析 SSE，token
       * 仍走请求头。服务端首包即全量 snapshot（重连天然续播），
       * terminal 事件后服务端收流、客户端不再重连；其余断流按
       * 1s→10s 退避重连。404/401 视为无权或任务不在，直接停订
       * （调用方静默降级，不刷屏报错）。返回取消订阅函数。
       */
      streamTaskRun(
        appId: string,
        taskId: string,
        onEvent: (ev: { type: string; data: unknown }) => void,
      ): () => void {
        let stopped = false;
        let terminalSeen = false;
        let ctrl: AbortController | null = null;
        const sleep = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const pump = async () => {
          let delay = 1000;
          while (!stopped && !terminalSeen) {
            ctrl = new AbortController();
            try {
              const token = getToken();
              const res = await fetch(
                `${API_BASE}/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/run/stream`,
                {
                  headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    Accept: "text/event-stream",
                  },
                  signal: ctrl.signal,
                },
              );
              if (res.status === 404 || res.status === 401) return;
              if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
              delay = 1000;
              const reader = res.body.getReader();
              const decoder = new TextDecoder();
              let buf = "";
              const handleRaw = (raw: string) => {
                let name = "message";
                let payload = "";
                for (const line of raw.split("\n")) {
                  if (line.startsWith("event:")) name = line.slice(6).trim();
                  else if (line.startsWith("data:"))
                    payload += line.slice(5).trim();
                  // id: 行与冒号注释行（心跳）直接忽略：重连首包
                  // 即全量 snapshot，不靠 Last-Event-ID 续播。
                }
                if (!payload) return;
                try {
                  const data = JSON.parse(payload) as unknown;
                  if (name === "terminal") terminalSeen = true;
                  onEvent({ type: name, data });
                } catch {
                  // 坏帧跳过，不断流
                }
              };
              for (;;) {
                if (stopped) break;
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx = buf.indexOf("\n\n");
                while (idx >= 0) {
                  handleRaw(buf.slice(0, idx));
                  buf = buf.slice(idx + 2);
                  idx = buf.indexOf("\n\n");
                }
              }
            } catch {
              if (stopped || ctrl?.signal.aborted) break;
              // 瞬时失败退避重连；terminal 已见时不再重连。
            }
            if (stopped || terminalSeen) break;
            await sleep(delay);
            delay = Math.min(delay * 2, 10000);
          }
        };
        void pump();
        return () => {
          stopped = true;
          try {
            ctrl?.abort();
          } catch {
            // 忽略
          }
        };
      },
      /**
       * 任务 run 产物正文（D6 第二批只读）：指定版或最新版，
       * 大产物只回预览；无 run 或版本不存在时调用方静默降级。
       */
      async taskRunArtifact(
        appId: string,
        taskId: string,
        artifactId: string,
        version?: number,
      ): Promise<AdminTaskRunArtifactContent | null> {
        try {
          const qs =
            `?artifactId=${encodeURIComponent(artifactId)}` +
            (version != null ? `&version=${version}` : "");
          const res = await apiFetch<AdminTaskRunArtifactContent>(
            `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/run/artifacts${qs}`,
          );
          return res && typeof res === "object" ? res : null;
        } catch {
          return null;
        }
      },
      /**
       * 任务 run 继续（暂停处置）：paused → running；未暂停时服务端 409。
       */
      async resumeRun(appId: string, taskId: string): Promise<void> {
        await apiFetch(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/run/resume`,
          { method: "POST" },
        );
      },
      /**
       * 任务 run 重试失败节点（暂停处置）：failed 节点打回 pending 后续跑；
       * 未暂停或无失败节点时服务端 409。
       */
      async retryRunNodes(appId: string, taskId: string): Promise<string[]> {
        const res = await apiFetch<{ retriedNodes?: string[] }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/run/retry-nodes`,
          { method: "POST" },
        );
        return Array.isArray(res?.retriedNodes) ? res.retriedNodes : [];
      },
      /**
       * 主题分段审批（契约第 5 节，贴 resumeRun / retryRunNodes
       * 形态与路径）：仅对应等待状态可用，否则服务端 409；
       * 验收拒绝与绑定拒绝均只记账、不推进状态。
       */
      async acceptPreview(
        appId: string,
        taskId: string,
      ): Promise<{
        ok?: boolean;
        runStatus?: string | null;
        taskStatus?: string | null;
      }> {
        const res = await apiFetch<{
          ok?: boolean;
          runStatus?: string | null;
          taskStatus?: string | null;
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/preview/accept`,
          { method: "POST" },
        );
        return res && typeof res === "object" ? res : {};
      },
      async rejectPreview(
        appId: string,
        taskId: string,
      ): Promise<{
        ok?: boolean;
        runStatus?: string | null;
        taskStatus?: string | null;
      }> {
        const res = await apiFetch<{
          ok?: boolean;
          runStatus?: string | null;
          taskStatus?: string | null;
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/preview/reject`,
          { method: "POST" },
        );
        return res && typeof res === "object" ? res : {};
      },
      async approveBind(
        appId: string,
        taskId: string,
      ): Promise<{
        ok?: boolean;
        runStatus?: string | null;
        taskStatus?: string | null;
      }> {
        const res = await apiFetch<{
          ok?: boolean;
          runStatus?: string | null;
          taskStatus?: string | null;
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/bind/approve`,
          { method: "POST" },
        );
        return res && typeof res === "object" ? res : {};
      },
      async rejectBind(
        appId: string,
        taskId: string,
      ): Promise<{
        ok?: boolean;
        runStatus?: string | null;
        taskStatus?: string | null;
      }> {
        const res = await apiFetch<{
          ok?: boolean;
          runStatus?: string | null;
          taskStatus?: string | null;
        }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/tasks/${encodeURIComponent(taskId)}/bind/reject`,
          { method: "POST" },
        );
        return res && typeof res === "object" ? res : {};
      },
      /**
       * 主题绑定门（D6 首批只读）：版本有产出 run 且终审未通过
       * 时 canBind 为 false；无产出 run 的版本不拦。
       */
      async themeBindGate(
        appId: string,
        themeId: string,
        version: string,
      ): Promise<AdminThemeBindGate | null> {
        try {
          const qs = `?themeId=${encodeURIComponent(themeId)}&version=${encodeURIComponent(version)}`;
          const res = await apiFetch<AdminThemeBindGate>(
            `/admin/apps/${encodeURIComponent(appId)}/assistant/theme-bind-gate${qs}`,
          );
          return res && typeof res === "object" ? res : null;
        } catch {
          return null;
        }
      },
    },
    /**
     * 助手长期记忆（第 91 步线 B · B1，本人作用域）：记忆归用户所有、
     * 以 scope 区分平台级与应用级，故走平台组路径一组端点，应用内
     * 页面以 scope 参数取本应用条目。待确认候选与正式条目同表，
     * 以 status=pending 区分（线 A 的 isPendingMemory 归一）。
     * 端点未就绪时各调用方静默降级（管理区呈空态）。
     */
    memories: {
      async list(opts?: {
        scope?: string;
        status?: string;
      }): Promise<AdminAssistantMemory[]> {
        const params = new URLSearchParams();
        if (opts?.scope) params.set("scope", opts.scope);
        if (opts?.status) params.set("status", opts.status);
        const qs = params.toString();
        const res = await apiFetch<{ memories: AdminAssistantMemory[] }>(
          `/admin/assistant/memories${qs ? `?${qs}` : ""}`,
        );
        return Array.isArray(res.memories) ? res.memories : [];
      },
      /** 新增（用户明示直写，writeMode 由服务端定为 explicit） */
      async create(body: {
        scope: string;
        category: string;
        content: string;
        expiresAt?: string | null;
      }): Promise<AdminAssistantMemory | null> {
        const res = await apiFetch<{ memory?: AdminAssistantMemory }>(
          "/admin/assistant/memories",
          { method: "POST", body: JSON.stringify(body) },
        );
        return res?.memory ?? null;
      },
      async update(
        id: string,
        body: { category?: string; content?: string; expiresAt?: string | null },
      ): Promise<AdminAssistantMemory | null> {
        const res = await apiFetch<{ memory?: AdminAssistantMemory }>(
          `/admin/assistant/memories/${encodeURIComponent(id)}`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        return res?.memory ?? null;
      },
      async remove(id: string): Promise<void> {
        await apiFetch(`/admin/assistant/memories/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      },
      /** 确认助手提议的候选：pending → 正式条目（writeMode 转 proposed_confirmed） */
      async confirm(id: string): Promise<AdminAssistantMemory | null> {
        const res = await apiFetch<{ memory?: AdminAssistantMemory }>(
          `/admin/assistant/memories/${encodeURIComponent(id)}/confirm`,
          { method: "POST", body: JSON.stringify({}) },
        );
        return res?.memory ?? null;
      },
    },
    /**
     * 主动建议（第 95 步线 B · B1）：应用面取本应用候选（服务端按
     * 本人任务卡 + 本应用审计读时派生），平台面取平台级事件候选 +
     * 按应用计数；处置三态以 fingerprint 寻址回写（snoozed 缺省
     * 延后时长由服务端定为 24h）。端点未就绪时调用方静默降级。
     */
    suggestions: {
      async getAppSuggestions(
        appId: string,
      ): Promise<AdminAssistantSuggestion[]> {
        const res = await apiFetch<{ suggestions: AdminAssistantSuggestion[] }>(
          `/admin/apps/${encodeURIComponent(appId)}/assistant/suggestions`,
        );
        return Array.isArray(res.suggestions) ? res.suggestions : [];
      },
      async getPlatformSuggestions(): Promise<{
        events: AdminAssistantSuggestion[];
        appCounts: AdminPlatformSuggestionAppCount[];
      }> {
        const res = await apiFetch<{
          events?: AdminAssistantSuggestion[];
          appCounts?: AdminPlatformSuggestionAppCount[];
        }>("/admin/assistant/suggestions");
        return {
          events: Array.isArray(res.events) ? res.events : [],
          appCounts: Array.isArray(res.appCounts) ? res.appCounts : [],
        };
      },
      async postSuggestionDisposition(
        scope: { appId: string } | { platform: true },
        fingerprint: string,
        body: { disposition: SuggestionDispositionKind; snoozeHours?: number },
      ): Promise<void> {
        const base =
          "appId" in scope
            ? `/admin/apps/${encodeURIComponent(scope.appId)}/assistant/suggestions`
            : "/admin/assistant/suggestions";
        await apiFetch(
          `${base}/${encodeURIComponent(fingerprint)}/disposition`,
          { method: "POST", body: JSON.stringify(body) },
        );
      },
    },
  },

  /**
   * 智能服务运行面调整（第 83 步片二）：GET 只回已存在的调整行
   * （不含已发布设置本体）；PUT 按面孔逐个提交，字段为空的键不下发、
   * 三键皆空即清除该面孔调整。写权限为平台管理员与本应用管理员。
   */
  agents: {
    async overrides(appId: string): Promise<AgentOverrideRow[]> {
      const res = await apiFetch<{ overrides: AgentOverrideRow[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/agents/overrides`,
      );
      return Array.isArray(res.overrides) ? res.overrides : [];
    },
    async putOverride(
      appId: string,
      face: AgentFaceKey,
      fields: AgentOverrideFields,
    ): Promise<AgentOverrideRow[]> {
      const res = await apiFetch<{ ok: boolean; overrides: AgentOverrideRow[] }>(
        `/admin/apps/${encodeURIComponent(appId)}/agents/overrides`,
        { method: "PUT", body: JSON.stringify({ face, fields }) },
      );
      return Array.isArray(res.overrides) ? res.overrides : [];
    },
  },
};
