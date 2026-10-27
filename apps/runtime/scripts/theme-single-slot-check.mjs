/**
 * 内置主题克隆改造第一阶段：运行端单槽回退自检。
 * 在 apps/runtime 下执行 node scripts/theme-single-slot-check.mjs。
 * 以假 env（STATIC_R2 / ASSETS 桩 + 全局 fetch/caches 桩）驱动
 * public/_worker.js 的默认导出 fetch，只断言槽位选择行为：
 * 1) 仅移动槽应用在桌面浏览器上能拿到移动主题；
 * 2) 双槽齐全时桌面请求不因桌面主题缺路由而落到移动主题（口径不变）；
 * 3) 仅移动槽应用在主题未覆盖路径上回落 SPA 壳时注入移动主题令牌；
 * 4) 移动请求在仅移动槽应用上仍走移动主题。
 * 不改动既有 theme-fn-check.mjs 的断言。
 */
import assert from "node:assert/strict";
import worker from "../public/_worker.js";

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>壳</title></head><body><div id="root"></div></body></html>`;

const MOB_MANIFEST = JSON.stringify({
  id: "mob",
  name: "Mob",
  version: "1.0.0",
  target: "mobile",
  routes: ["/", "/products"],
  config: [],
  tokens: { primary: "#00aa00" },
});
const LITE_MANIFEST = JSON.stringify({
  id: "lite",
  name: "Lite",
  version: "1.0.0",
  target: "desktop",
  routes: ["/"],
  config: [],
  tokens: { primary: "#abcdef" },
});

function makeR2(entries) {
  const map = new Map(Object.entries(entries));
  return {
    async get(key) {
      if (!map.has(key)) return null;
      const body = map.get(key);
      return { body, text: async () => body, httpEtag: '"r2fake"' };
    },
    async head(key) {
      return map.has(key) ? { httpEtag: '"r2fake"' } : null;
    },
  };
}

const r2 = makeR2({
  "themes/mob/1.0.0/theme.json": MOB_MANIFEST,
  "themes/mob/1.0.0/index.html":
    "<html><head></head><body>mob-page</body></html>",
  "themes/lite/1.0.0/theme.json": LITE_MANIFEST,
  "themes/lite/1.0.0/index.html":
    "<html><head></head><body>lite-page</body></html>",
});

const assetsStub = {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/index.html") {
      return new Response(SHELL, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(SHELL, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};

function siteCfg(theme) {
  return {
    entry: { id: "e1", name: "站点", siteMode: "dynamic", theme },
    primary: { appId: "mall" },
    apps: [{ id: "mall" }],
  };
}
const SITE_BY_HOST = {
  "mobonly.test": siteCfg({
    desktop: null,
    mobile: { id: "mob", version: "1.0.0", values: {} },
  }),
  "dual.test": siteCfg({
    desktop: { id: "lite", version: "1.0.0", values: {} },
    mobile: { id: "mob", version: "1.0.0", values: {} },
  }),
};

globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname === "/public/site") {
    const cfg = SITE_BY_HOST[u.searchParams.get("host")];
    if (!cfg) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(cfg), {
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected fetch: " + url);
};
globalThis.caches = {
  default: {
    async match() {
      return null;
    },
    async put() {},
  },
};

const env = { STATIC_R2: r2, ASSETS: assetsStub };
const ctx = { waitUntil() {} };
const call = (url) => worker.fetch(new Request(url), env, ctx);

// 1) 仅移动槽 + 桌面浏览器默认判定 → 移动主题出页
{
  const res = await call("https://mobonly.test/products");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-lcdp-theme"), "mob@1.0.0");
  assert.ok((await res.text()).includes("mob-page"));
  console.log("ok - 仅移动槽桌面请求回退移动主题");
}

// 2) 双槽齐全 + 桌面请求 + 桌面主题缺路由 → 落回 SPA 壳，不串到移动主题
{
  const res = await call("https://dual.test/products");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes("mob-page"), "不应串到移动主题");
  assert.ok(body.includes('id="root"'), "应落回 SPA 壳");
  console.log("ok - 双槽桌面缺路由不串移动主题");
}

// 3) 仅移动槽 + 主题未覆盖路径 → SPA 壳注入移动主题令牌
{
  const res = await call("https://mobonly.test/unknown-page");
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes("window.__LCDP_THEME__="));
  assert.ok(body.includes("#00aa00"));
  console.log("ok - 仅移动槽 SPA 回落注入移动主题令牌");
}

// 4) 仅移动槽 + 明确移动请求 → 移动主题出页
{
  const res = await call("https://mobonly.test/products?view=mobile");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-lcdp-theme"), "mob@1.0.0");
  console.log("ok - 仅移动槽移动请求走移动主题");
}

console.log("theme-single-slot-check: all passed");
