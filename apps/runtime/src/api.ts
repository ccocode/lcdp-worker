import type { DataSchema, PageSchema } from "@naka1205/schema";
import type { ListResult, Row, RuntimeAdapter, SelectOption } from "@lcdp/renderer";

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

export interface Snapshot {
  app: AppInfo;
  data: DataSchema;
  pages: PageSchema[];
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
  data: {
    async list(
      appId: string,
      entity: string,
      params?: { limit?: number; offset?: number; filters?: Record<string, string> },
    ): Promise<ListResult> {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.offset) qs.set("offset", String(params.offset));
      for (const [k, v] of Object.entries(params?.filters ?? {})) qs.set(k, v);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return apiFetch<ListResult>(
        `/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}${suffix}`,
      );
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
