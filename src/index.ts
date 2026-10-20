import { Hono } from "hono";

/**
 * Edge API（统一入口网关，最终文档第 5 节；M11 收口落地）：
 * 公开流量统一经此 Worker 全路径透传回源服务器 api；其余职责只有一件事——
 * 「打开层」只读降级：入口解析与应用快照在回源成功时顺手写入 KV（cache-aside），
 * 回源不可达时以 KV 副本应答，使已发布应用在 api 暂停期间仍可只读打开
 * （第 16 节步骤 8）。本 Worker 保持薄网关：不解析 JWT、不做权限判断、
 * 不改写业务体、不落业务事实；KV 只装源站 200 应答的派生副本，权威源
 * 始终是服务器 PostgreSQL。建库由 platform 资源声明驱动（见 platform 仓
 * infra/cloudflare/resources.md），本仓只回填 binding 执行部署。
 *
 * CORS 口径：源站在线时一律透传、源站为单一 CORS 权威。唯独降级应答是
 * 网关在边缘合成的新响应——信封只存正文，若不补 CORS 头，浏览器会以
 * 「No Access-Control-Allow-Origin」拦下正文、应用仍打不开（步骤 8 首演
 * 实证）。故降级 GET 命中与白名单预检（回源失败时）由网关镜像源站
 * platformCors 语义应答：名单内 Origin 回显 + 源站同款 allow 列表。
 * M11 残留修复（2026-10-18）：降级应答补 Access-Control-Expose-Headers
 * 暴露 x-lcdp-degraded；网关合成 502 与源站直回的宕机状态应答在未带
 * ACAO 时按名单补回显，避免浏览器以 CORS 错误掩盖真实状态。
 */

type Env = {
  ENVIRONMENT: string;
  /** 回源基址（公开反代），如 https://service.coode.cc.cd */
  ORIGIN_BASE: string;
  /** 发布快照派生副本 KV（binding 由 provision 回填） */
  SNAP_KV?: KVNamespace;
};

type SnapshotEnvelope = {
  status: number;
  contentType: string | null;
  body: string;
  /** 写入时刻（epoch ms），用于 60 秒写合并判定 */
  at: number;
};

/** KV 写合并窗口：同键 60 秒内不重复写（免费额度 1000 写/天） */
const WRITE_COALESCE_MS = 60_000;
/** 快照副本自清 TTL：24 小时 */
const SNAPSHOT_TTL_SECONDS = 86_400;
/** 视为「源站不可达」的回源状态（触发降级读） */
const DOWN_STATUSES = new Set([502, 503, 504]);

/**
 * 源站 platformCors 名单镜像（仅降级路径用；与 api index.ts 的 platformCors
 * 保持一致——源站在线时一律透传、此名单不参与决策）。
 */
const CORS_ORIGINS = new Set([
  "https://coode.cc.cd",
  "https://www.coode.cc.cd",
  "https://shop.coode.cc.cd",
  "https://bbs.coode.cc.cd",
  "https://account.coode.cc.cd",
  "https://dev.coode.cc.cd",
  "https://admin.coode.cc.cd",
  "https://lcdp-runtime.pages.dev",
  "https://lcdp-studio.pages.dev",
  "https://lcdp-admin.pages.dev",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
]);

/** 请求 Origin 在源站名单内则回显，否则 null（与源站 cors 行为一致） */
function corsOriginFor(req: Request): string | null {
  const origin = req.headers.get("Origin");
  return origin && CORS_ORIGINS.has(origin) ? origin : null;
}

/** 是否 CORS 预检请求 */
function isPreflight(req: Request): boolean {
  return (
    req.method === "OPTIONS" &&
    !!req.headers.get("Origin") &&
    !!req.headers.get("Access-Control-Request-Method")
  );
}

/**
 * 降级预检应答：仅在白名单路径回源失败时合成，语义镜像源站 platformCors
 * （名单回显 + allowMethods/allowHeaders/maxAge 同源站配置）。源站在线时
 * 预检一律透传、永不走此分支。名单外 Origin 回 null（不予合成）。
 */
function syntheticPreflight(req: Request): Response | null {
  const origin = corsOriginFor(req);
  if (!origin) return null;
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Visitor-Key");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
  return new Response(null, { status: 204, headers });
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "edge-api", env: c.env.ENVIRONMENT }));

/** 降级白名单：仅 GET 的「打开层」读路径（站点解析 + 应用快照） */
function isDegradable(pathname: string): boolean {
  if (pathname === "/public/site" || pathname === "/site/current")
    return true;
  return /^\/apps\/[^/]+\/snapshot$/.test(pathname);
}

/**
 * 缓存键：登录态按令牌 SHA-256 摘要键控——每条缓存只回给曾被源站以 200
 * 应答过的同一令牌（隔离强于角色粒度，且网关无需解析 JWT）；匿名按路径键控。
 * 陈旧性无窗口：发布必须经 api，api 停机期间不可能有新发布；api 在线时
 * 一律实时回源、从不读缓存。
 */
async function cacheKey(req: Request, pathWithQuery: string): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (auth) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `auth:${hex}:${pathWithQuery}`;
  }
  return `anon:${pathWithQuery}`;
}

function originUrl(req: Request, originBase: string): string {
  const u = new URL(req.url);
  return originBase.replace(/\/$/, "") + u.pathname + u.search;
}

/** 白名单 200 应答后顺手写 KV（先读同键做 60 秒写合并；失败不阻断） */
async function maybeWriteSnapshot(kv: KVNamespace, key: string, res: Response): Promise<void> {
  try {
    const prev = await kv.get<SnapshotEnvelope>(key, "json");
    if (prev && Date.now() - prev.at < WRITE_COALESCE_MS) return;
    const body = await res.clone().text();
    const env: SnapshotEnvelope = {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body,
      at: Date.now(),
    };
    await kv.put(key, JSON.stringify(env), { expirationTtl: SNAPSHOT_TTL_SECONDS });
  } catch {
    // KV 写失败不影响透传应答（降级是尽力而为，权威在源站）
  }
}

/**
 * 降级读：命中 KV 副本则应答并标注 x-lcdp-degraded，未命中返回 null。
 * 降级响应是边缘合成的新响应，须按请求 Origin 镜像源站 CORS 头，
 * 否则浏览器拦下正文（信封只存正文，CORS 值按请求现算、不入缓存）。
 */
async function readSnapshot(kv: KVNamespace, key: string, req: Request): Promise<Response | null> {
  try {
    const env = await kv.get<SnapshotEnvelope>(key, "json");
    if (!env) return null;
    const headers = new Headers();
    if (env.contentType) headers.set("content-type", env.contentType);
    headers.set("x-lcdp-degraded", "snapshot");
    const origin = corsOriginFor(req);
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      // 跨域 JS 读自定义头须经 Expose-Headers 声明，否则降级标记在线路上
      // 存在、前端却读不到（M11 残留修复：将来的降级徽标依赖此行）。
      headers.set("Access-Control-Expose-Headers", "x-lcdp-degraded");
      headers.set("Vary", "Origin");
    }
    return new Response(env.body, { status: env.status, headers });
  } catch {
    return null;
  }
}

app.all("*", async (c) => {
  const req = c.req.raw;
  const url = new URL(req.url);
  const kv = c.env.SNAP_KV;
  const degradable = req.method === "GET" && isDegradable(url.pathname) && !!kv;
  const key = degradable ? await cacheKey(req, url.pathname + url.search) : null;
  /** 白名单路径的预检：回源失败时合成应答，使随后的降级 GET 不被预检挡住 */
  const preflightDegradable = isPreflight(req) && isDegradable(url.pathname) && !!kv;

  let res: Response;
  try {
    res = await fetch(new Request(originUrl(req, c.env.ORIGIN_BASE), req));
  } catch {
    // 回源网络不可达：白名单走降级，其余回网关 502
    if (degradable && key) {
      const hit = await readSnapshot(kv!, key, req);
      if (hit) return hit;
    }
    if (preflightDegradable) {
      const pf = syntheticPreflight(req);
      if (pf) return pf;
    }
    // 网关合成的 502 同样须带 CORS 回显：否则浏览器只报 CORS 错误、
    // 掩盖真实的源站不可达状态（M11 残留修复）。
    const origin = corsOriginFor(req);
    if (origin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    return c.json({ error: "origin_unreachable" }, 502);
  }

  if (degradable && key) {
    if (res.status === 200) {
      await maybeWriteSnapshot(kv!, key, res);
      return res;
    }
    if (DOWN_STATUSES.has(res.status)) {
      const hit = await readSnapshot(kv!, key, req);
      if (hit) return hit;
    }
  }
  if (preflightDegradable && DOWN_STATUSES.has(res.status)) {
    const pf = syntheticPreflight(req);
    if (pf) return pf;
  }
  // 源站（或其前置反代）直回宕机状态时，该应答未经源站 CORS 层处理：
  // 名单内 Origin 且应答未带 ACAO 时由网关补回显 + Vary，使浏览器呈现
  // 真实状态而非 CORS 错误（M11 残留修复）。正常应答一律原样透传。
  if (DOWN_STATUSES.has(res.status) && !res.headers.get("Access-Control-Allow-Origin")) {
    const origin = corsOriginFor(req);
    if (origin) {
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    }
  }
  return res;
});

export default app;
