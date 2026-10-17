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
export interface EntryView {
  id: string;
  name: string;
  hosts: string[];
  appIds: string[];
  isDefault: boolean;
  siteMode: SiteMode;
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
    async update(
      id: string,
      body: { siteMode: SiteMode },
    ): Promise<EntryView> {
      const res = await apiFetch<{ entry: EntryView }>(
        `/admin/entries/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(body) },
      );
      return res.entry;
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
};
