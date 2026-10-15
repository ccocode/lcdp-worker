import type {
  ComponentNode,
  DataSchema,
  PageSchema,
  PermissionSchema,
  WorkflowSchema,
} from "@naka1205/schema";
import type {
  ListResult,
  Row,
  RuntimeAdapter,
  SelectOption,
} from "@lcdp/renderer";
import { message as antdMessage } from "antd";

/**
 * 设计台的平台 api 客户端（与运行态同源接口，token 独立存储互不影响）。
 * 后续流量改走 Worker 网关时只改 API_BASE。
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://service.coode.cc.cd";

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
}

/** 页面片段定义（与平台 FragmentDef 对齐） */
export interface FragmentDef {
  id: string;
  name: string;
  root: ComponentNode;
}

/**
 * 设计包视图（M3 起，M4 增 permissions，M5 增 workflows）：
 * 数据模型 + 设计页面 + 应用配置 + 片段库 + 权限配置 + 流程定义。
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
  async design(appId: string): Promise<DesignData> {
    return apiFetch<DesignData>(`/apps/${encodeURIComponent(appId)}/design`);
  },
  /** 保存整个设计包为草稿（数据模型 + 页面 + 主题 + 片段 + 权限 + 流程），返回服务端归一化后的草稿 */
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
  /** 聚合取数（统计卡片/图表预览）：fn=count 不需 field，sum/avg 需数字字段 */
  async aggregate(
    appId: string,
    entity: string,
    args: {
      fn: "count" | "sum" | "avg";
      field?: string;
      filters?: Record<string, string>;
    },
  ): Promise<number> {
    const qs = new URLSearchParams();
    qs.set("fn", args.fn);
    if (args.field) qs.set("field", args.field);
    for (const [k, v] of Object.entries(args.filters ?? {})) qs.set(k, v);
    const res = await apiFetch<{ value: unknown }>(
      `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
    );
    const n = Number(res.value);
    return Number.isFinite(n) ? n : 0;
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
      },
    ) => api.aggregate(appId, entity, args),
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
