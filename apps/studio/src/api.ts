import type { DataSchema } from "@naka1205/schema";

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
  current: boolean;
}

export interface DesignData {
  app: AppInfo;
  published: { version: number; schema: DataSchema } | null;
  draft: DataSchema | null;
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
  async saveDraft(
    appId: string,
    schema: DataSchema,
  ): Promise<{ ok: boolean; draft: DataSchema }> {
    return apiFetch(`/apps/${encodeURIComponent(appId)}/design/draft`, {
      method: "PUT",
      body: JSON.stringify(schema),
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
};
