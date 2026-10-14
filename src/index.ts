import { Hono } from "hono";

/**
 * Edge API（统一入口网关，架构文档第 5 节）：
 * 公开流量统一经此 Worker：鉴权前置、按已发布 Schema 快照做路由分发、
 * 公开数据边缘缓存，其余请求经 Tunnel 回源服务器 api / agent。
 * 本 Worker 保持薄网关，禁止沉淀业务逻辑与业务事实数据——核心能力与
 * 业务事实的权威源都在服务器 platform 服务（PostgreSQL）；此处只存
 * 派生副本与边缘运营数据，且建库由 platform 声明驱动（见架构文档第 10 节）。
 */
type Env = {
  ENVIRONMENT: string;
  CONFIG_KV?: KVNamespace;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, service: "edge-api", env: c.env.ENVIRONMENT }));

// TODO：已发布 Schema 快照只读分发（R2/KV 快照，源头在 PG，由 api 发布时写入）
app.get("/snapshots/:appId", (c) =>
  c.json({ status: "not_implemented", step: "P1" }),
);

export default app;
