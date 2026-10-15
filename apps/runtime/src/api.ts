import type {
  DataSchema,
  PageSchema,
  PermissionSchema,
  PublicPolicy,
} from "@naka1205/schema";
import type {
  EntityAccess,
  ListResult,
  Row,
  RuntimeAdapter,
  SelectOption,
} from "@lcdp/renderer";

/**
 * 平台 api 客户端（M1 阶段前端直连 service.coode.cc.cd；
 * 后续改走 Worker 网关 api.coode.cc.cd 转发时只改 API_BASE）。
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "https://service.coode.cc.cd";

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
  /** 应用配置（主题令牌等），来自设计包的 appConfig */
  appConfig: { theme: Record<string, unknown> } | null;
  /** 当前发布版本号（未发布为 null） */
  version: number | null;
  /** 已发布的权限配置（未发布权限时为 null → 旧行为全权） */
  permissions: PermissionSchema | null;
  /** 当前用户的有效访问摘要（透传渲染器 access 做呈现门控） */
  myAccess: MyAccess | null;
}

/** 入口解析结果：当前域名命中的入口与其装配的应用（顺序即呈现顺序） */
export interface EntryResult {
  entry: { id: string; name: string } | null;
  apps: AppInfo[];
}

/** 公开（匿名）入口解析结果：primary 为入口首个应用的公开面（无公开页时为 null） */
export interface PublicEntryResult {
  entry: { id: string; name: string } | null;
  apps: AppInfo[];
  primary: {
    appId: string;
    name: string;
    /** 仅含公开策略声明的页面（已发布设计页 ∪ 派生页中 route ∈ public.pages 者） */
    pages: PageSchema[];
    /** 仅含公开可读/公开表单涉及的实体定义 */
    data: DataSchema;
    appConfig: { theme: Record<string, unknown> } | null;
    /** 公开策略（决定哪些实体可读、哪些可提交表单） */
    public: PublicPolicy;
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
    throw new Error(body?.message ?? body?.error ?? `请求失败 (${res.status})`);
  }
  return body as T;
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
  /** 按当前域名解析入口（入口模型：域名定入口，入口装配应用与页面） */
  async entry(host: string): Promise<EntryResult> {
    return apiFetch<EntryResult>(
      `/entry/current?host=${encodeURIComponent(host)}`,
    );
  },
  /** 匿名解析入口的公开面（未登录时先调：有公开页则渲染公开外壳） */
  async publicEntry(host: string): Promise<PublicEntryResult> {
    return apiFetch<PublicEntryResult>(
      `/public/entry?host=${encodeURIComponent(host)}`,
    );
  },
  data: {
    async list(
      appId: string,
      entity: string,
      params?: {
        limit?: number;
        offset?: number;
        filters?: Record<string, string>;
        sort?: { field: string; dir: "asc" | "desc" };
      },
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
    /** 聚合查询（统计卡片/图表）：服务端对实体做 count/sum/avg，等值过滤走查询参数 */
    async aggregate(
      appId: string,
      entity: string,
      q: {
        fn: "count" | "sum" | "avg";
        field?: string;
        filters?: Record<string, string>;
      },
    ): Promise<number> {
      const qs = new URLSearchParams();
      qs.set("fn", q.fn);
      if (q.field) qs.set("field", q.field);
      for (const [k, v] of Object.entries(q.filters ?? {})) qs.set(k, v);
      const res = await apiFetch<{ value: number }>(
        `/apps/${encodeURIComponent(appId)}/aggregate/${encodeURIComponent(entity)}?${qs.toString()}`,
      );
      return res.value;
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
    get: (entity, id) => api.data.get(appId, entity, id),
    create: (entity, data) => api.data.create(appId, entity, data),
    update: (entity, id, data) => api.data.update(appId, entity, id, data),
    remove: (entity, id) => api.data.remove(appId, entity, id),
    options: async (entity): Promise<SelectOption[]> => {
      const res = await api.data.list(appId, entity, { limit: 200 });
      return res.rows.map((r) => ({ value: String(r.id), label: pickLabel(r) }));
    },
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
): RuntimeAdapter {
  const base = `/public/apps/${encodeURIComponent(appId)}`;
  const list = async (
    entity: string,
    params?: {
      limit?: number;
      offset?: number;
      filters?: Record<string, string>;
      sort?: { field: string; dir: "asc" | "desc" };
    },
  ): Promise<ListResult> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.sort) qs.set("sort", `${params.sort.field}:${params.sort.dir}`);
    for (const [k, v] of Object.entries(params?.filters ?? {})) qs.set(k, v);
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
    get: async (entity, id) => {
      try {
        const res = await apiFetch<{ row: Row }>(
          `${base}/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
        );
        return res.row;
      } catch {
        return null;
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
    navigate,
    notify,
  };
}
