import { Hono } from "hono";

/**
 * Edge API（入口 A 轻逻辑，架构文档第 5 节）：
 * 登录态校验、按已发布 Schema 快照做路由分发、公开数据只读缓存。
 * 业务 API 走 api 域名经 Tunnel 直达 core-api，不经此 Worker——
 * 免费额度耗尽时仅边缘能力降级，核心业务不受影响。
 * 本 Worker 禁止承载任何唯一数据（铁律：事实源在服务器 PostgreSQL）。
 */
type Env = {
  ENVIRONMENT: string;
  CONFIG_KV?: KVNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "edge-api", env: c.env.ENVIRONMENT }));

// TODO：已发布 Schema 快照只读分发（R2/KV 快照，源头在 PG，由 core-api 发布时写入）
app.get("/snapshots/:appId", (c) =>
  c.json({ status: "not_implemented", step: "P1" }),
);

export default app;
