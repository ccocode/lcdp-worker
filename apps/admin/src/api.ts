/**
 * 平台管理台 api 客户端（M8）。与 runtime/studio 同源接口、同基址口径：
 * 默认 https://api.coode.cc.cd（M11 起经 Worker 网关转发回源），可经
 * VITE_API_BASE 或 localStorage `lcdp.admin.apiBase` 覆盖。token 独立存储于本源 localStorage。
 * 字段形状以契约 §4 与服务端实况为准；列表信封在客户端做防御式归一化。
 */
const API_BASE =
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
 * 入口出参 theme 归一为双槽：null/旧单指针形状/形状非法一律两槽皆 null
 * （与服务端「旧形状视为未绑定」同口径），页面层只消费归一结果。
 */
export function entryThemeSlots(entry: EntryView): ThemeSlots {
  const empty: ThemeSlots = { desktop: null, mobile: null };
  const raw = entry.theme as unknown;
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

export interface EntryView {
  id: string;
  name: string;
  hosts: string[];
  appIds: string[];
  isDefault: boolean;
  siteMode: SiteMode;
  /** 主题绑定（M15 第⑤步双槽）：{desktop, mobile} 双槽指针，未绑定为 null */
  theme: ThemeSlots | null;
  config: Record<string, unknown>;
}

/** 静态生成状态（按应用查：sites 为以该应用为主应用的入口清单） */
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
  desktop: "桌面槽",
  mobile: "移动槽",
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
  /** 供给维度（M15 第④步）：builtin = 平台内置库；app = 应用私有 */
  scope: "builtin" | "app";
  /** scope=app 时的归属应用 id；builtin 为 null */
  ownerAppId?: string | null;
  versions: ThemeVersionView[];
  boundEntries: ThemeBoundEntry[];
}

export interface ThemeUploadResult {
  themeId: string;
  version: string;
  fileCount: number;
  totalBytes: number;
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
}
export interface GrantsMe {
  isAdmin: boolean;
  apps: GrantApp[];
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
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
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

  entries: {
    async list(): Promise<EntryView[]> {
      const res = await apiFetch<{ entries: EntryView[] }>("/admin/entries");
      return res.entries;
    },
    /** siteMode 与 theme 指针同居入口 config、互不覆盖：只传要改的那一项；
     * theme 传完整双槽对象（按槽重建，单槽解绑 = 该槽置 null）或 null 清空双槽 */
    async update(
      id: string,
      body: { siteMode?: SiteMode; theme?: ThemeSlots | null },
    ): Promise<EntryView> {
      const res = await apiFetch<{ entry: EntryView }>(
        `/admin/entries/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      return res.entry;
    },
  },

  themes: {
    async list(): Promise<ThemeItem[]> {
      const res = await apiFetch<{ themes: ThemeItem[] }>("/admin/themes");
      return res.themes;
    },
    /**
     * multipart 上传主题包 zip：校验失败抛 ThemeUploadError（带逐项 problems）。
     * appId 给出时为应用私有通道（M15 第④步）：服务端按该应用的运营授权执法，
     * 落 scope=app / owner=appId；不给时为平台内置通道（admin）。
     */
    async upload(file: File, appId?: string): Promise<ThemeUploadResult> {
      const token = getToken();
      const fd = new FormData();
      fd.set("file", file);
      if (appId) fd.set("appId", appId);
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
  },

  /** 应用会员（会员试点）：按应用生效会员域列会员（标识搜索 + 分页）与启停 */
  members: {
    async list(
      appId: string,
      params?: { q?: string; limit?: number; offset?: number },
    ): Promise<{ members: MemberItem[]; total: number; scope: string }> {
      const res = await apiFetch<{
        members: MemberItem[];
        total: number;
        scope: string;
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
      };
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
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(`/admin/audit${qs(params)}`);
      return pageOf<Row>(res);
    },
  },

  replay: {
    async conversations(params?: {
      page?: number;
      pageSize?: number;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/conversations${qs(params ?? {})}`,
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
    async proposals(params?: {
      page?: number;
      pageSize?: number;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/proposals${qs(params ?? {})}`,
      );
      return pageOf<Row>(res);
    },
    async proposal(id: string): Promise<Row> {
      const res = await apiFetch<Record<string, unknown>>(
        `/admin/replay/proposals/${encodeURIComponent(id)}`,
      );
      return ((res.proposal as Row) ?? res) as Row;
    },
    async flows(params?: {
      page?: number;
      pageSize?: number;
    }): Promise<PageResult<Row>> {
      const res = await apiFetch<unknown>(
        `/admin/replay/flows${qs(params ?? {})}`,
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
  },

  usage: {
    async query(params: {
      groupBy: "day" | "app" | "channel" | "model";
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

  /** 管理台跨租户资产列表与删除（契约 M9 §2.3：GET /admin/assets；删除走 DELETE /assets/:id） */
  adminAssets: {
    async list(params: {
      tenant?: string;
      q?: string;
      appId?: string;
      limit?: number;
      offset?: number;
    }): Promise<PageResult<AssetItem>> {
      const res = await apiFetch<unknown>(`/admin/assets${qs(params)}`);
      return pageOf<AssetItem>(res, "items");
    },
    async remove(id: string): Promise<void> {
      await apiFetch(`/assets/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
  },

  /** 普通资产端点（管理台以上传人身份走 /assets，契约 M9 §2.3） */
  assets: {
    /** multipart 上传：不能走 apiFetch（它固定 JSON 头），FormData 的 Content-Type 由浏览器补 boundary */
    async upload(file: File): Promise<AssetItem> {
      const token = getToken();
      const fd = new FormData();
      fd.set("file", file);
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

  /** 管理侧数据（M15 第③步：按运营授权执法、不走员工权限快照；只读 + 编辑） */
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
    ): Promise<Row> {
      const res = await apiFetch<{ row: Row }>(
        `/admin/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(fields) },
      );
      return res.row;
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
};
