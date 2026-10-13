# lcdp-worker

Cloudflare 侧仓库：edge-api Worker、wrangler 环境配置（demo / production）、Cloudflare 资源 provision 脚本。

设计约束（见 platform 仓最终架构文档第 5、10、11 节）：
- 双入口拓扑：本 Worker 只管 app 域名的轻逻辑；api 域名经 Tunnel 直达服务器，不经 Worker。
- 铁律：Cloudflare 侧不存唯一数据；此处全部资源可凭脚本在新账号一键重建（上线切换账号重新部署）。
- `@lcdp/schema` 按固定版本从 GitHub Packages 依赖（platform 仓发布），不走 workspace 引用。
- Cloudflare Token 只存本仓 GitHub Environments，绝不进入 platform 仓。

```bash
pnpm install
pnpm dev              # 本地 wrangler dev
pnpm deploy:demo      # 部署演示环境
```
