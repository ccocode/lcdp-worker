/**
 * 功能页主题化自检（第 93 步线 A4）：在 apps/runtime 下执行
 *   node scripts/theme-fn-check.mjs
 * 以假 env（ASSETS / STATIC_R2 桩 + 全局 fetch/caches 桩）驱动
 * public/_worker.js 的默认导出 fetch，只断言边缘分发与注入行为：
 * 无主题壳逐字不变 / 有 tokens 注入三件齐全且值正确（含形状过滤）/
 * functional.css 缺失时无 link / 预览主题桥接路径带注入与 no-store /
 * 资源路径不注入。运行时消费（__LCDP_THEME__ → antd 令牌）不在此覆盖。
 */
import assert from "node:assert/strict";
import worker from "../public/_worker.js";

// ---------------------------------------------------------------- 假壳与假主题

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>平台功能页</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>`;
const APP_JS = `console.log("app");`;

const TEEN_MANIFEST = JSON.stringify({
  id: "teen",
  name: "Teen",
  version: "1.0.0",
  target: "desktop",
  routes: ["/", "/products", "/products/detail"],
  config: [],
  tokens: {
    primary: "#123456",
    accent: "red;}", // 非法值（禁字符 ; }）→ 应被形状过滤丢弃
    textSecondary: "#666666",
    radius: 40, // 越界 → 应钳制为 32
    fontFamily: "Georgia, serif",
    evil: "#000000", // 词表外键 → 应被丢弃
  },
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
const BARE_MANIFEST = JSON.stringify({
  id: "bare",
  name: "Bare",
  version: "2.0.0",
  target: "desktop",
  routes: ["/"],
  config: [],
});

// ---------------------------------------------------------------- 桩

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
  "themes/teen/1.0.0/theme.json": TEEN_MANIFEST,
  "themes/teen/1.0.0/functional.css": ":root{--teen:1}",
  "themes/teen/1.0.0/index.html": "<html><head></head><body>teen</body></html>",
  "themes/lite/1.0.0/theme.json": LITE_MANIFEST,
  "themes/lite/1.0.0/index.html": "<html><head></head><body>lite</body></html>",
  "themes/bare/2.0.0/theme.json": BARE_MANIFEST,
  "themes/bare/2.0.0/index.html": "<html><head></head><body>bare</body></html>",
});

function htmlResponse(html) {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const assetsStub = {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/index.html") return htmlResponse(SHELL);
    if (u.pathname === "/assets/app.js") {
      return new Response(APP_JS, {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    // /checkout 模拟 _redirects 未生效：资产服务 404，靠 worker 补回壳
    if (u.pathname === "/checkout") return new Response("not found", { status: 404 });
    // 其余页面路径按 _redirects 语义回退 SPA 壳
    return htmlResponse(SHELL);
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
  "plain.test": siteCfg(null),
  "themed.test": siteCfg({
    desktop: { id: "teen", version: "1.0.0", values: {} },
    mobile: null,
  }),
  "nofcss.test": siteCfg({
    desktop: { id: "lite", version: "1.0.0", values: {} },
    mobile: null,
  }),
  "preview.test": siteCfg(null),
};
const PREVIEW_BY_TOKEN = {
  goodtoken: { appId: "mall", themeId: "teen", version: "1.0.0", slot: "desktop" },
  baretoken: { appId: "mall", themeId: "bare", version: "2.0.0", slot: "desktop" },
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
  if (u.pathname === "/public/theme-preview/validate") {
    const v = PREVIEW_BY_TOKEN[u.searchParams.get("token")];
    if (!v) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(v), {
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("unexpected fetch: " + url);
};
globalThis.caches = {
  default: { async match() { return null; }, async put() {} },
};

const env = { STATIC_R2: r2, ASSETS: assetsStub };
const ctx = { waitUntil() {} };
const call = (url) => worker.fetch(new Request(url), env, ctx);

// 1) 无主题：壳逐字不变（ASSETS 直出与 404 补回两条路径）
{
  const res = await call("https://plain.test/cart");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), SHELL);
  const res2 = await call("https://plain.test/checkout");
  assert.equal(res2.status, 200);
  assert.equal(await res2.text(), SHELL);
}

// 2) 有 tokens + functional.css：注入三件齐全且值正确（两条路径）
{
  const res = await call("https://themed.test/cart");
  assert.equal(res.status, 200);
  const body = await res.text();
  const m = /window\.__LCDP_THEME__=(\{.*?\});/.exec(body);
  assert.ok(m, "__LCDP_THEME__ 脚本应在壳内");
  const theme = JSON.parse(m[1]);
  assert.equal(theme.themeId, "teen");
  assert.equal(theme.version, "1.0.0");
  assert.equal(theme.tokens.primary, "#123456");
  assert.equal(theme.tokens.textSecondary, "#666666");
  assert.equal(theme.tokens.fontFamily, "Georgia, serif");
  assert.equal(theme.tokens.radius, 32); // 40 钳制为 32
  assert.ok(!("accent" in theme.tokens)); // 非法值丢弃
  assert.ok(!("evil" in theme.tokens)); // 词表外键丢弃
  assert.ok(body.includes("--lcdp-primary:#123456"));
  assert.ok(body.includes("--lcdp-text-secondary:#666666"));
  assert.ok(body.includes("--lcdp-radius:32px"));
  assert.ok(!body.includes("--lcdp-accent"));
  assert.ok(
    body.includes(
      '<link rel="stylesheet" href="/functional.css?v=teen@1.0.0">',
    ),
  );
  // 注入点在 <head> 之后
  assert.ok(body.indexOf("window.__LCDP_THEME__") > body.indexOf("<head>"));
  // 404 补回 /index.html 的路径同样注入
  const res2 = await call("https://themed.test/checkout");
  assert.equal(res2.status, 200);
  const body2 = await res2.text();
  assert.ok(body2.includes("window.__LCDP_THEME__="));
  assert.ok(body2.includes("/functional.css?v=teen@1.0.0"));
}

// 3) functional.css 缺失：有脚本与变量、无 link
{
  const res = await call("https://nofcss.test/cart");
  const body = await res.text();
  assert.ok(body.includes("window.__LCDP_THEME__="));
  assert.ok(body.includes("--lcdp-primary:#abcdef"));
  assert.ok(!body.includes("functional.css"));
}

// 4) 预览主题在桥接路径：带注入 + no-store + 预览头 + 角标 + 令牌固化；
//    预览主题未声明主题化时落回正常分发、逐字不变
{
  const res = await call("https://preview.test/cart?lcdp_preview=goodtoken");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-lcdp-theme-preview"), "teen@1.0.0");
  const body = await res.text();
  assert.ok(body.includes("window.__LCDP_THEME__="));
  assert.ok(body.includes("/functional.css?v=teen@1.0.0"));
  assert.ok(body.includes("预览效果")); // 预览角标
  const cookies = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")];
  assert.ok(cookies.some((c) => c && c.includes("lcdp-preview=goodtoken")));

  const res2 = await call("https://preview.test/cart?lcdp_preview=baretoken");
  assert.equal(res2.status, 200);
  assert.equal(await res2.text(), SHELL);
  assert.equal(res2.headers.get("x-lcdp-theme-preview"), null);
}

// 5) 资源（非页面）路径不注入：逐字透传
{
  const res = await call("https://themed.test/assets/app.js");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), APP_JS);
}

console.log("theme-fn-check: all assertions passed");
