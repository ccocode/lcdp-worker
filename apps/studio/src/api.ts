import type {
  ComponentNode,
  DataSchema,
  PageSchema,
  PermissionSchema,
  WorkflowSchema,
} from "@naka1205/schema";
import type {
  AggregateGroupItem,
  AssetMeta,
  ListResult,
  Row,
  RuntimeAdapter,
  SelectOption,
  ViewFilter,
} from "@lcdp/renderer";
import { message as antdMessage } from "antd";

/**
 * 设计台的平台 api 客户端（与运行态同源接口，token 独立存储互不影响）。
 * M11 起经 Worker 网关 api.coode.cc.cd 转发回源。
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://api.coode.cc.cd";

const TOKEN_KEY = "lcdp.studio.token";
const USER_KEY = "lcdp.studio.user";

export interface UserInfo {
  id: string;
  username: string;
  role: string;
  tenantId: string;
  displayName?: string | null;
  departmentId?: string | null;
}

export interface AppInfo {
  id: string;
  name: string;
  scenario: string | null;
  /** M15 主领域（创建响应携带；列表接口未带时为空） */
  domain?: string | null;
  skeleton?: string | null;
}

/** 样板库条目（GET /domains 的 templates；样板库型领域如 OA 建应用时勾选整束装配） */
export interface DomainTemplateInfo {
  key: string;
  name: string;
  category: string;
  description: string;
}

/** M15 领域注册表条目（GET /domains） */
export interface DomainInfo {
  key: string;
  name: string;
  description: string;
  available: boolean;
  skeleton: string | null;
  /** 样板库（仅样板库型领域有，如审批协同 OA） */
  templates?: DomainTemplateInfo[];
}

export interface VersionInfo {
  version: number;
  note: string | null;
  publishedBy: string | null;
  publishedAt: string;
  entityCount: number;
  pageCount: number;
  current: boolean;
}

/** 应用配置（主题）：与平台 AppConfigPart 对齐，theme 为自由键值（colorPrimary/borderRadius/logoText 等） */
export interface AppConfig {
  theme: Record<string, unknown>;
  /** 外壳形态：system（默认）| site（站点型外壳，顶栏导航 + 页脚），M10 起由应用设置维护 */
  shell?: string;
  globalVars?: Record<string, unknown>;
  /** 生效会员域（会员试点）：缺省 = 本应用 id；多应用填同一值即共用一套会员 */
  memberScope?: string;
}

/** 页面片段定义（与平台 FragmentDef 对齐） */
export interface FragmentDef {
  id: string;
  name: string;
  root: ComponentNode;
}

/** 员工助手声明（设计包 agents.staff）：名称/人设/工具开关/回合上限 */
export interface StaffAgentDecl {
  name: string;
  persona: string;
  tools: { query: boolean; create: boolean; flow: boolean; kb: boolean };
  /** 单回合内工具循环上限（1..12，默认 6） */
  maxTurns: number;
  /** 写操作策略：本期唯一值 confirm（任何写先经用户确认卡片） */
  writePolicy: "confirm";
}

/**
 * 画像声明（设计包 agents.visitor / agents.ops 同构，与平台 SupportAgentDecl
 * 对齐）：人设字段名 systemPrompt、知识范围为知识库编号列表 knowledgeBases、
 * 工具面为 builtinTools（内置工具）/ toolScopes（派生工具域）。
 * 注意与管理台运行面调整（覆盖层）的同义异名字段（knowledgeScope 等）区分，
 * 两层不可混写——声明层写覆盖层字段名会被服务端保存校验静默剥离。
 */
export interface SupportAgentDecl {
  name: string;
  systemPrompt: string;
  builtinTools: string[];
  toolScopes: string[];
  knowledgeBases: string[];
  /** 写操作策略：visitor 可 confirm / auto；ops 仅 confirm（服务端校验把关） */
  writePolicy: string;
  /** 单回合内工具循环上限（1..12） */
  maxTurns: number;
}

/**
 * 智能体配置（设计包 agents 段，第 84 步片一/片四）：三画像声明
 * staff / visitor / ops。null = 本应用未声明该画像（运行时按「应用声明
 * → 领域声明 → 平台默认」回填；visitor 无平台默认，两级皆无则客服不
 * 启用）。旧键 assistant / support 仅在 normalizeAgents 读侧兼容，保存
 * 只写新键。
 */
export interface AgentsConfig {
  staff: StaffAgentDecl | null;
  visitor: SupportAgentDecl | null;
  ops: SupportAgentDecl | null;
  /**
   * 管理台运行面调整的存在标记（第 83 步片二，服务端读侧附带）：
   * { 面孔键（staff/visitor/ops）: 最近调整时间 ISO }，只有存在性
   * 与时间、没有内容；仅供页签顶部提示，不参与编辑与保存。
   */
  overridesPresent?: Record<string, string> | null;
}

/** agents 段整体缺失时的客户端形态：三画像皆未声明 */
export function defaultAgentsConfig(): AgentsConfig {
  return { staff: null, visitor: null, ops: null };
}

/** 在本应用新建员工助手声明时的初始值（与平台缺省口径一致） */
export function newStaffDecl(): StaffAgentDecl {
  return {
    name: "应用助理",
    persona: "",
    tools: { query: true, create: true, flow: true, kb: true },
    maxTurns: 6,
    writePolicy: "confirm",
  };
}

/**
 * 在本应用新建访客客服声明时的初始值：转人工（humanHandoff）为客服
 * 必需项（服务端保存校验强制），初始即带上；人设留空由用户填写。
 */
export function newVisitorDecl(): SupportAgentDecl {
  return {
    name: "客服",
    systemPrompt: "",
    builtinTools: ["kbSearch", "humanHandoff"],
    toolScopes: [],
    knowledgeBases: [],
    writePolicy: "confirm",
    maxTurns: 6,
  };
}

function turnsOr(v: unknown, fallback: number): number {
  return typeof v === "number" && v >= 1 && v <= 12 ? Math.round(v) : fallback;
}

function stringArrayOr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** staff 段归一化：非对象 → null（未声明）；字段级缺失逐个回填缺省（与服务端 resolveAssistant 同口径） */
function normalizeStaff(raw: unknown): StaffAgentDecl | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const t =
    a.tools && typeof a.tools === "object"
      ? (a.tools as Record<string, unknown>)
      : {};
  const boolOr = (v: unknown): boolean => (typeof v === "boolean" ? v : true);
  return {
    name: typeof a.name === "string" && a.name ? a.name : "应用助理",
    persona: typeof a.persona === "string" ? a.persona : "",
    tools: {
      query: boolOr(t.query),
      create: boolOr(t.create),
      flow: boolOr(t.flow),
      kb: boolOr(t.kb),
    },
    maxTurns: turnsOr(a.maxTurns, 6),
    writePolicy: "confirm",
  };
}

/** visitor / ops 段归一化（同构）：非对象 → null（未声明）；persona 为 systemPrompt 的写入别名，读时并入 */
function normalizeDecl(
  raw: unknown,
  defaults: { name: string; maxTurns: number },
): SupportAgentDecl | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  return {
    name:
      typeof a.name === "string" && a.name ? a.name : defaults.name,
    systemPrompt:
      typeof a.systemPrompt === "string"
        ? a.systemPrompt
        : typeof a.persona === "string"
          ? a.persona
          : "",
    builtinTools: stringArrayOr(a.builtinTools),
    toolScopes: stringArrayOr(a.toolScopes),
    knowledgeBases: stringArrayOr(a.knowledgeBases),
    writePolicy:
      typeof a.writePolicy === "string" && a.writePolicy
        ? a.writePolicy
        : "confirm",
    maxTurns: turnsOr(a.maxTurns, defaults.maxTurns),
  };
}

/**
 * 把任意来源的 agents 段归一化为三画像声明形态：新键优先、旧键
 * （assistant / support）回退兼容读；未声明的段保持 null（不虚构声明，
 * 保证保存往返不把 null 写成空对象、ops 段原样保留）。
 */
export function normalizeAgents(input: AgentsConfig | null | undefined): AgentsConfig {
  const r = (input ?? {}) as unknown as Record<string, unknown>;
  // 运行面调整标记只透传（存在性提示用），不进编辑字段
  const present =
    r.overridesPresent &&
    typeof r.overridesPresent === "object" &&
    Object.keys(r.overridesPresent as Record<string, unknown>).length > 0
      ? { overridesPresent: r.overridesPresent as Record<string, string> }
      : {};
  return {
    ...present,
    staff: normalizeStaff(r.staff !== undefined ? r.staff : r.assistant),
    visitor: normalizeDecl(r.visitor !== undefined ? r.visitor : r.support, {
      name: "客服",
      maxTurns: 6,
    }),
    ops: normalizeDecl(r.ops, { name: "运营助理", maxTurns: 8 }),
  };
}

/**
 * 设计包视图（M3 起，M4 增 permissions，M5 增 workflows，M7 增 agents）：
 * 数据模型 + 设计页面 + 应用配置 + 片段库 + 权限配置 + 流程定义 + 智能体配置。
 * pages/fragments/permissions/workflows 为 null 表示该部分尚未建立
 * （页面全走服务端自动派生；未建权限时登录用户全权，见 M4 契约 §2）。
 */
export interface BundleView {
  schema: DataSchema;
  pages: PageSchema[] | null;
  appConfig: AppConfig | null;
  fragments: FragmentDef[] | null;
  permissions: PermissionSchema | null;
  workflows: WorkflowSchema[] | null;
  agents: AgentsConfig | null;
}

/** 平台用户（管理台口径，不含密码哈希） */
export interface AdminUser {
  id: string;
  username: string;
  role: string;
  displayName: string | null;
  departmentId: string | null;
  createdAt: string;
}

export interface CreateUserBody {
  username: string;
  password: string;
  role: string;
  displayName?: string;
  departmentId?: string;
}

export interface UpdateUserBody {
  role?: string;
  displayName?: string;
  departmentId?: string | null;
  password?: string;
}

/** 公开表单待审提交 */
export interface Submission {
  id: string;
  entity: string;
  body: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface DesignData {
  app: AppInfo;
  published: (BundleView & { version: number }) | null;
  draft: BundleView | null;
  versions: VersionInfo[];
}

// ---------------------------------------------------------- 设计态 AI（M6 Copilot 提案）

/** 提案状态：生成中 / 待确认 / 生成失败 / 已应用 / 已丢弃（与 api platform_ai_proposals 对齐） */
export type ProposalStatus =
  | "generating"
  | "ready"
  | "failed"
  | "applied"
  | "discarded";

/** Diff 条目类型（本期切片：仅增量操作，无删除/改类型等破坏性操作） */
export type ProposalChangeKind =
  | "addEntity"
  | "addField"
  | "updateField"
  | "addPage";

/**
 * Diff 条目：由 api 对「基线包 vs 候选合并包」确定性求差产生（非 LLM 编造），
 * Studio 只负责勾选，应用语义（冲突 400、未勾选不落库）在 api 侧。
 */
export interface ProposalChange {
  id: string;
  section: "data" | "pages";
  kind: ProposalChangeKind;
  entity?: string;
  field?: string;
  pageId?: string;
  label: string;
  payload?: unknown;
}

/** 七步管线的单步日志（agent 回填：步骤名 + 详情，如检索命中数、修复次数） */
export interface ProposalLogEntry {
  step?: string;
  title?: string;
  detail?: string;
  message?: string;
}

export interface Proposal {
  id: string;
  appId?: string;
  username?: string;
  prompt: string;
  status: ProposalStatus;
  summary: string | null;
  /** 求差结果；生成中/失败时为 null。列表接口带 changes（不含 candidate 全文） */
  changes: ProposalChange[] | null;
  error: string | null;
  /** 步骤日志：字符串或结构化条目，UI 归一化后回填到七步进度 */
  log?: (string | ProposalLogEntry)[] | null;
  /** 已应用的条目 id（status=applied 时供标注，不可重复应用） */
  appliedChangeIds?: string[] | null;
  createdAt: string;
  updatedAt?: string;
  appliedAt?: string | null;
}

// ---------------------------------------------------------- 设计向导（AGENT 三期，/apps/wizard）

/** 向导阶段：选型 → 抉择 → 陪跑 → 完成 / 放弃 */
export type WizardStage =
  | "selecting"
  | "deciding"
  | "companion"
  | "done"
  | "abandoned";

/** 陪跑三步：模型补充 / 页面 / 流程与权限 */
export type WizardStepKey = "model" | "pages" | "flowPerms";

/** 陪跑单步状态（服务端会话 steps 段；字段缺失时前端按未开始处理） */
export interface WizardStepState {
  /** pending 未开始 / generated 已生成待应用 / applied 已应用 / invalidated 已失效须重走 */
  status?: string;
  proposalId?: string | null;
}

/**
 * 向导会话（POST /apps/wizard/sessions 与 GET 回执同形）。choices 为逐项
 * 定案原始形态：{ value, version, stale } 包装（stale = 被上游回改置失效、
 * 保留旧值待重定），解读在前端 helper 内收敛；proposalIds 为陪跑提案链
 * （顺序即产生顺序）。
 */
export interface WizardSession {
  id: string;
  stage: WizardStage;
  domainKey: string | null;
  scenario: string | null;
  choices: Record<string, unknown>;
  appId: string | null;
  proposalIds: string[];
  steps: Partial<Record<WizardStepKey, WizardStepState>>;
  createdAt?: string;
  updatedAt?: string;
}

/** 选型段候选（注册表机械派生：名称 + 说明 + 与其他候选的差别说明） */
export interface WizardCandidate {
  key: string;
  name: string;
  description: string;
  differences?: string;
}

/**
 * 抉择段单选项。value 的形态按条目 kind 解读：multi 为样板 key 字符串、
 * single 的会员域项为 { mode } 对象、single 的主题项为主题 id 字符串、
 * confirm 为 []；roleNames 条目不用 options，角色清单走条目的 roles。
 */
export interface WizardDecisionOption {
  value: unknown;
  label: string;
  description?: string;
  key?: string;
}

/** 抉择段条目：kind = multi（样板多选）/ confirm（骨架全量装入）/ roleNames（角色改名）/ single（单选） */
export interface WizardDecisionItem {
  key: string;
  kind: string;
  label?: string;
  impact: string;
  options: WizardDecisionOption[];
  /** roleNames 条目的角色清单（key 为角色标识、label 为默认显示名）；其余 kind 不带 */
  roles?: { key: string; label: string; audience?: string | null }[];
  /** memberScope 选「并入既有」时的现存会员域清单（也可能挂在会话视图上） */
  scopes?: string[];
}

/** 会话视图：会话本体 + 当前阶段脚本（selecting 带 candidates，deciding 带 items） */
export interface WizardSessionView extends WizardSession {
  candidates?: WizardCandidate[];
  items?: WizardDecisionItem[];
  memberScopes?: string[];
}

/**
 * 定案回执：会话最新视图 + 本次回改使失效的下游清单（对象形：choices 回改
 * 只失效 steps；领域变更时 choices 与 steps 两组都可能非空）。
 */
export interface WizardChoiceResult extends WizardSessionView {
  invalidated?: { choices?: string[]; steps?: string[] };
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

/** 携带服务端业务信息的错误（发布/保存失败时把 message 与 issues 展示给设计者） */
export class ApiError extends Error {
  issues?: string[];
  constructor(message: string, issues?: string[]) {
    super(message);
    this.issues = issues;
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
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { message?: string; error?: string; issues?: string[] })
    | null;
  if (!res.ok) {
    throw new ApiError(
      body?.message ?? body?.error ?? `请求失败 (${res.status})`,
      body?.issues,
    );
  }
  return body as T;
}

export interface DataListParams {
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
  vf?: ViewFilter[];
  sort?: { field: string; dir: "asc" | "desc" };
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
  /** 新建应用（M10 补强）：服务端建 platform_apps 行，设计包由 GET /design 合成起始包 */
  async createApp(id: string, name: string, domain?: string, templates?: string[]): Promise<AppInfo> {
    const res = await apiFetch<{ app: AppInfo }>("/apps", {
      method: "POST",
      body: JSON.stringify({
        id,
        name,
        ...(domain ? { domain } : {}),
        ...(templates && templates.length > 0 ? { templates } : {}),
      }),
    });
    return res.app;
  },
  /** M15 领域列表（新建应用时选主领域用） */
  async domains(): Promise<DomainInfo[]> {
    const res = await apiFetch<{ domains: DomainInfo[] }>("/domains");
    return res.domains;
  },
  async design(appId: string): Promise<DesignData> {
    return apiFetch<DesignData>(`/apps/${encodeURIComponent(appId)}/design`);
  },
  /** 保存整个设计包为草稿（数据模型 + 页面 + 主题 + 片段 + 权限 + 流程 + 智能体），返回服务端归一化后的草稿 */
  async saveDraft(
    appId: string,
    bundle: BundleView,
  ): Promise<{ ok: boolean; draft: BundleView }> {
    return apiFetch(`/apps/${encodeURIComponent(appId)}/design/draft`, {
      method: "PUT",
      body: JSON.stringify(bundle),
    });
  },
  async publish(
    appId: string,
    note?: string,
  ): Promise<{ ok: boolean; version: number; changes: string[] }> {
    return apiFetch(`/apps/${encodeURIComponent(appId)}/design/publish`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  },
  async rollback(
    appId: string,
    version: number,
  ): Promise<{ ok: boolean; version: number }> {
    return apiFetch(`/apps/${encodeURIComponent(appId)}/design/rollback`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  },

  // ---------------------------------------------------------- 设计态 AI Copilot（/apps/:appId/copilot，M6）
  /** 发起生成：立即返回提案 id（status=generating），生成在 api 后台跑（≤240s），用 copilotProposal 轮询 */
  async copilotGenerate(
    appId: string,
    prompt: string,
  ): Promise<{ id: string }> {
    return apiFetch(`/apps/${encodeURIComponent(appId)}/copilot/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
  },
  /** 最近提案列表（含 changes 与 summary，不含 candidate 全文） */
  async copilotProposals(appId: string): Promise<Proposal[]> {
    const res = await apiFetch<{ proposals: Proposal[] }>(
      `/apps/${encodeURIComponent(appId)}/copilot/proposals`,
    );
    return res.proposals;
  },
  /** 单条提案全量（轮询状态 / 查看历史 Diff） */
  async copilotProposal(appId: string, pid: string): Promise<Proposal> {
    const res = await apiFetch<{ proposal?: Proposal } & Proposal>(
      `/apps/${encodeURIComponent(appId)}/copilot/proposals/${encodeURIComponent(pid)}`,
    );
    return res.proposal ?? res;
  },
  /** 把勾选的 Diff 条目应用到设计草稿（服务端全量复检，不过则 400 不落库） */
  async copilotApply(
    appId: string,
    pid: string,
    changeIds: string[],
  ): Promise<{ ok: boolean; applied?: number }> {
    return apiFetch(
      `/apps/${encodeURIComponent(appId)}/copilot/proposals/${encodeURIComponent(pid)}/apply`,
      { method: "POST", body: JSON.stringify({ changeIds }) },
    );
  },

  // ---------------------------------------------------------- 设计向导（/apps/wizard，向导只服务新建应用）
  /** 开向导会话（stage=selecting）；scenario 可在开局时一并带上 */
  async wizardCreate(scenario?: string): Promise<WizardSessionView> {
    const res = await apiFetch<{ session?: WizardSessionView } & WizardSessionView>(
      "/apps/wizard/sessions",
      { method: "POST", body: JSON.stringify(scenario ? { scenario } : {}) },
    );
    return res.session ?? res;
  },
  /**
   * 读会话 + 当前阶段脚本。阶段脚本在回执顶层 script 键（selecting 带
   * candidates、deciding 带 items），在此合并进会话视图，调用方只读视图。
   */
  async wizardGet(id: string): Promise<WizardSessionView> {
    const res = await apiFetch<
      {
        session?: WizardSessionView;
        script?: {
          candidates?: WizardCandidate[];
          items?: WizardDecisionItem[];
        };
      } & WizardSessionView
    >(`/apps/wizard/sessions/${encodeURIComponent(id)}`);
    const view = res.session ?? res;
    return {
      ...view,
      candidates: res.script?.candidates ?? view.candidates,
      items: res.script?.items ?? view.items,
    };
  },
  /** 选型定案：落 domainKey 并进入抉择段（scenario 顺带回传，未定案前以最后一次为准） */
  async wizardDomain(
    id: string,
    domainKey: string,
    scenario?: string,
  ): Promise<WizardChoiceResult> {
    const res = await apiFetch<
      {
        session?: WizardChoiceResult;
        invalidated?: WizardChoiceResult["invalidated"];
      } & WizardChoiceResult
    >(`/apps/wizard/sessions/${encodeURIComponent(id)}/domain`, {
      method: "POST",
      body: JSON.stringify(scenario ? { domainKey, scenario } : { domainKey }),
    });
    const view = res.session ?? res;
    return { ...view, invalidated: res.invalidated ?? view.invalidated };
  },
  /** 抉择逐项定案/回改：回执 invalidated（顶层对象）列出被本次回改置失效的下游定案与陪跑步 */
  async wizardChoices(
    id: string,
    key: string,
    value: unknown,
  ): Promise<WizardChoiceResult> {
    const res = await apiFetch<
      {
        session?: WizardChoiceResult;
        invalidated?: WizardChoiceResult["invalidated"];
      } & WizardChoiceResult
    >(`/apps/wizard/sessions/${encodeURIComponent(id)}/choices`, {
      method: "POST",
      body: JSON.stringify({ key, value }),
    });
    const view = res.session ?? res;
    return { ...view, invalidated: res.invalidated ?? view.invalidated };
  },
  /** 场景推荐：在注册表候选内给推荐序与逐项理由（不增删候选，定案仍由用户点选） */
  async wizardRecommend(
    id: string,
    scenario: string,
  ): Promise<{ order: string[]; reasons: Record<string, string> }> {
    const res = await apiFetch<{
      order?: string[];
      reasons?: Record<string, string> | { key: string; reason: string }[];
    }>(`/apps/wizard/sessions/${encodeURIComponent(id)}/recommend`, {
      method: "POST",
      body: JSON.stringify({ scenario }),
    });
    const reasons: Record<string, string> = {};
    if (Array.isArray(res.reasons)) {
      for (const r of res.reasons) {
        if (r && typeof r.key === "string") reasons[r.key] = r.reason ?? "";
      }
    } else if (res.reasons) {
      for (const [k, v] of Object.entries(res.reasons)) reasons[k] = String(v);
    }
    return { order: res.order ?? [], reasons };
  },
  /** 建应用：内部走既有装配路径（领域骨架 + 已定案样板），appId 落会话并进入陪跑段 */
  async wizardCreateApp(
    id: string,
    appId: string,
    name: string,
  ): Promise<WizardSessionView> {
    const res = await apiFetch<{ session?: WizardSessionView } & WizardSessionView>(
      `/apps/wizard/sessions/${encodeURIComponent(id)}/create-app`,
      { method: "POST", body: JSON.stringify({ appId, name }) },
    );
    return res.session ?? res;
  },
  /** 陪跑步进生成：按步装配 prompt 调既有提案管线，返回新提案 id（后续轮询/应用走 copilot 端点） */
  async wizardStepGenerate(
    id: string,
    step: WizardStepKey,
    note?: string,
  ): Promise<{ proposalId: string }> {
    const res = await apiFetch<{ proposalId?: string; id?: string }>(
      `/apps/wizard/sessions/${encodeURIComponent(id)}/steps/${encodeURIComponent(step)}/generate`,
      { method: "POST", body: JSON.stringify(note ? { note } : {}) },
    );
    const proposalId = res.proposalId ?? res.id;
    if (!proposalId) throw new ApiError("生成接口未返回提案 id");
    return { proposalId };
  },
  /** 陪跑步应用登记：提案经既有 apply 落稿后调用，推进步状态 */
  async wizardStepApplied(
    id: string,
    step: WizardStepKey,
    proposalId: string,
  ): Promise<WizardSessionView> {
    const res = await apiFetch<{ session?: WizardSessionView } & WizardSessionView>(
      `/apps/wizard/sessions/${encodeURIComponent(id)}/steps/${encodeURIComponent(step)}/applied`,
      { method: "POST", body: JSON.stringify({ proposalId }) },
    );
    return res.session ?? res;
  },
  /** 发布后收官：会话置 done */
  async wizardComplete(id: string): Promise<WizardSessionView> {
    const res = await apiFetch<{ session?: WizardSessionView } & WizardSessionView>(
      `/apps/wizard/sessions/${encodeURIComponent(id)}/complete`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return res.session ?? res;
  },
  /** 放弃会话：置 abandoned（已建应用保留为普通草稿，不做任何回滚） */
  async wizardAbandon(id: string): Promise<WizardSessionView> {
    const res = await apiFetch<{ session?: WizardSessionView } & WizardSessionView>(
      `/apps/wizard/sessions/${encodeURIComponent(id)}/abandon`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return res.session ?? res;
  },

  // ---------------------------------------------------------- 用户管理（/admin/users，限 admin）
  async adminUsers(): Promise<AdminUser[]> {
    const res = await apiFetch<{ users: AdminUser[] }>("/admin/users");
    return res.users;
  },
  async createUser(body: CreateUserBody): Promise<AdminUser> {
    const res = await apiFetch<{ user: AdminUser }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.user;
  },
  async updateUser(id: string, body: UpdateUserBody): Promise<AdminUser> {
    const res = await apiFetch<{ user: AdminUser }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return res.user;
  },
  async deleteUser(id: string): Promise<void> {
    await apiFetch(`/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  // ---------------------------------------------------------- 公开表单待审（/admin/apps/:appId/submissions，限 admin）
  async submissions(
    appId: string,
    status?: Submission["status"],
  ): Promise<Submission[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await apiFetch<{ submissions: Submission[] }>(
      `/admin/apps/${encodeURIComponent(appId)}/submissions${qs}`,
    );
    return res.submissions;
  },
  async approveSubmission(appId: string, id: string): Promise<void> {
    await apiFetch(
      `/admin/apps/${encodeURIComponent(appId)}/submissions/${encodeURIComponent(id)}/approve`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },
  async rejectSubmission(appId: string, id: string): Promise<void> {
    await apiFetch(
      `/admin/apps/${encodeURIComponent(appId)}/submissions/${encodeURIComponent(id)}/reject`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  // ---------------------------------------------------------- 只读数据（设计器预览取数）
  async dataList(
    appId: string,
    entity: string,
    params?: DataListParams,
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
  async dataGet(appId: string, entity: string, id: string): Promise<Row | null> {
    try {
      const res = await apiFetch<{ row: Row }>(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
      );
      return res.row;
    } catch {
      return null;
    }
  },
  /** 聚合取数（统计卡片/图表预览）：fn=count 不需 field，sum/avg 需数字字段；过滤走 vf（服务端以 vf 为准） */
  async aggregate(
    appId: string,
    entity: string,
    args: {
      fn: "count" | "sum" | "avg";
      field?: string;
      filters?: Record<string, string>;
      vf?: ViewFilter[];
    },
  ): Promise<number> {
    const qs = new URLSearchParams();
    qs.set("fn", args.fn);
    if (args.field) qs.set("field", args.field);
    for (const [k, v] of Object.entries(args.filters ?? {})) qs.set(k, v);
    if (args.vf?.length) qs.set("vf", JSON.stringify(args.vf));
    const res = await apiFetch<{ value: unknown }>(
      `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
    );
    const n = Number(res.value);
    return Number.isFinite(n) ? n : 0;
  },
  /** 分组聚合（图表预览）：按 groupBy 返回 {key,value} 序列（服务端按值降序、最多 50 组） */
  async aggregateGrouped(
    appId: string,
    entity: string,
    args: {
      fn: "count" | "sum" | "avg";
      field?: string;
      groupBy: string;
      filters?: Record<string, string>;
      vf?: ViewFilter[];
    },
  ): Promise<AggregateGroupItem[]> {
    const qs = new URLSearchParams();
    qs.set("fn", args.fn);
    if (args.field) qs.set("field", args.field);
    qs.set("groupBy", args.groupBy);
    for (const [k, v] of Object.entries(args.filters ?? {})) qs.set(k, v);
    if (args.vf?.length) qs.set("vf", JSON.stringify(args.vf));
    const res = await apiFetch<{ series: AggregateGroupItem[] }>(
      `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
    );
    return res.series;
  },

  // ---------------------------------------------------------- 平台资产（M9，与运行态同一组端点）
  assets: {
    /** 上传单个文件为资产（multipart；设计器画布预览不走此路，见 makePreviewAdapter 的写拦截） */
    async upload(
      file: File,
      linkage?: {
        appId?: string;
        entity?: string;
        recordId?: string;
        field?: string;
        visibility?: string;
      },
    ): Promise<AssetMeta> {
      const fd = new FormData();
      fd.append("file", file);
      if (linkage?.appId) fd.append("appId", linkage.appId);
      if (linkage?.entity) fd.append("entity", linkage.entity);
      if (linkage?.recordId) fd.append("recordId", linkage.recordId);
      if (linkage?.field) fd.append("field", linkage.field);
      if (linkage?.visibility) fd.append("visibility", linkage.visibility);
      const token = getToken();
      // 不走 apiFetch：FormData 需浏览器自带 multipart Content-Type（含 boundary）
      const res = await fetch(`${API_BASE}/assets`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: fd,
      });
      const body = (await res.json().catch(() => null)) as
        | (AssetMeta & { message?: string; error?: string })
        | null;
      if (!res.ok || !body) {
        throw new ApiError(
          body?.message ?? body?.error ?? `上传失败 (${res.status})`,
        );
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
    /** 资产内容地址：附当前 token 的 ?t=（<img>/<a> 无法带 Authorization 头） */
    contentUrl(id: string): string {
      const token = getToken();
      const base = `${API_BASE}/assets/${encodeURIComponent(id)}/content`;
      return token ? `${base}?t=${encodeURIComponent(token)}` : base;
    },
  },
};

/** 引用下拉的显示标签：优先取语义字段（名称/单号/编码/标题），兜底用 id（与 runtime 的 pickLabel 同逻辑） */
function pickLabel(row: Row): string {
  for (const key of ["name", "order_no", "in_no", "req_no", "code", "title"]) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return String(row.id);
}

/**
 * 设计器预览适配器：读方法走真实接口（预览看到的是真实数据），
 * 写方法一律拦截并提示——设计预览不落库，保存/发布只针对 Schema 本身。
 */
export function makePreviewAdapter(appId: string): RuntimeAdapter {
  const blocked = (message: string): never => {
    antdMessage.error(message);
    throw new Error(message);
  };
  const adapter = {
    list: (entity: string, params?: DataListParams) =>
      api.dataList(appId, entity, params),
    get: (entity: string, id: string) => api.dataGet(appId, entity, id),
    create: (_entity: string, _data: Row): Promise<Row> =>
      blocked("设计预览模式：写操作已禁用"),
    update: (_entity: string, _id: string, _data: Row): Promise<Row> =>
      blocked("设计预览模式：写操作已禁用"),
    remove: (_entity: string, _id: string): Promise<void> =>
      blocked("设计预览模式：写操作已禁用"),
    aggregate: (
      entity: string,
      args: {
        fn: "count" | "sum" | "avg";
        field?: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
    ) => api.aggregate(appId, entity, args),
    aggregateGrouped: (
      entity: string,
      args: {
        fn: "count" | "sum" | "avg";
        field?: string;
        groupBy: string;
        filters?: Record<string, string>;
        vf?: ViewFilter[];
      },
    ) => api.aggregateGrouped(appId, entity, args),
    // 资产读方法走真实接口（预览能看到已传文件）；上传是写操作，与其余写方法一致拦截
    uploadAsset: (
      _file: File,
      _linkage?: {
        appId?: string;
        entity?: string;
        recordId?: string;
        field?: string;
        visibility?: string;
      },
    ): Promise<AssetMeta> => blocked("设计预览模式：文件上传已禁用"),
    assetsMeta: (ids: string[]) => api.assets.meta(ids),
    assetContentUrl: (id: string) => api.assets.contentUrl(id),
    options: async (entity: string): Promise<SelectOption[]> => {
      const res = await api.dataList(appId, entity, { limit: 200 });
      return res.rows.map((r) => ({ value: String(r.id), label: pickLabel(r) }));
    },
    navigate: (to: string) => {
      antdMessage.info(`设计预览模式：页面跳转已禁用（目标 ${to}）`);
    },
    notify: (message: string, kind?: "ok" | "error") => {
      if (kind === "error") antdMessage.error(message);
      else antdMessage.success(message);
    },
  };
  return adapter as RuntimeAdapter;
}
