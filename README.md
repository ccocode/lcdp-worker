# lcdp-worker

Cloudflare 发布仓：**一切部署到 Cloudflare 的代码都在本仓**——三个前端应用（Pages 托管）、edge-api 统一入口网关 Worker、wrangler 环境配置（demo / production）、Cloudflare 资源 provision 执行脚本。

## 结构

```text
apps/
  studio/     设计态：应用搭建工作台（含设计态 Agent 入口）→ Pages 项目 lcdp-studio
  runtime/    运行态：渲染已发布应用（含运行态 Agent / AgentChat 组件）→ Pages 项目 lcdp-runtime
  admin/      平台管理台：租户、模型网关配置、审计、成本 → Pages 项目 lcdp-admin
packages/
  renderer/   @lcdp/renderer Schema 渲染器（设计态预览与运行态共用）
  ui/         @lcdp/ui 共享 UI 组件
src/          edge-api 统一入口网关 Worker（Hono）
wrangler.toml 网关 Worker 配置
```

设计约束（见 platform 仓最终架构文档第 5、10、11 节）：
- 统一入口：公开流量经 edge-api 网关鉴权前置、路由转发，再经 Tunnel 回源服务器 core-api / agent；api 直连域名仅作内部通道。网关保持薄，不沉淀业务逻辑。
- 数据归属：业务事实的权威源在服务器 PostgreSQL；本侧 D1/KV/R2 只装派生副本与边缘运营数据，且建库一律由 platform 资源声明驱动、本仓 provision 只负责执行，禁止独立建库。
- `@naka1205/schema` 按固定版本从 GitHub Packages 依赖（platform 仓发布），不走 workspace 引用。
- Cloudflare Token 只存本仓 GitHub Environments，绝不进入 platform 仓。
- 本仓正是上线切换 Cloudflare 账号时整体重部署的部分，独立成仓使切换与密钥隔离最干净。

```bash
pnpm install
pnpm dev              # 本地 wrangler dev（edge-api）
pnpm --filter @lcdp/studio dev   # 本地起单个前端
pnpm deploy:demo      # 部署网关 Worker 演示环境
```
