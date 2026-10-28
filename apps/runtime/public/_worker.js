/**
 * LCDP Runtime 边缘分发（Pages 高级模式 _worker.js）。
 *
 * 判定序（自上而下，任一层未命中/异常都落回下一层，最终回落 SPA）：
 * 0. 预览前置（第 83 步片五，路线 A）：请求带 lcdp_preview 令牌
 *    （参数或 lcdp-preview Cookie）且 api 校验端点确认其作用域的
 *    应用与本站点一致时，以令牌指针覆盖对应槽渲染主题（跳过快照
 *    层；路径归属与正常分发一致——声明了 routes 的主题在预览中
 *    同样只接管清单内路径，清单外落回平台页，使桥接页在预览中
 *    可达可验，第 90 步修正；响应 no-store 并注入预览角标）；参数值为
 *    off 时清除固化 Cookie 回正常分发。任何不适用一律落回下序，
 *    无令牌时本层不存在、以下判定逐字不变。
 * 1. 主题层（M14 线二 + M15 第⑤步双槽）：站点绑定了主题（/public/site 的
 *    entry.theme 双槽指针 { desktop, mobile }）时，按槽位判定选槽后查 R2
 *    绑定 STATIC_R2（桶 lcdp-assets，键 themes/<id>/<version>/<path>）；
 *    命中直出（应答头 x-lcdp-theme: <id>@<version>，index.html 注入
 *    window.__LCDP__ 上下文）；`/` 与无扩展名页面路径未命中文件时回退主题
 *    index.html；主题文件缺失/异常 → 落回下一层。槽位判定（定案四级）：
 *    ?view= 参数（命中时在最终响应上以 Set-Cookie lcdp-view 固化 30 天）
 *    → lcdp-view Cookie → 默认桌面槽（桌面 index 应答且移动槽有绑定时
 *    注入自检脚本，移动设备信号命中即跳 view=mobile）；选移动槽未命中
 *    时回退桌面槽再试。旧单指针形状按未绑定读。
 *    修法 D：theme.json 声明了非空 routes 时，仅清单内路径回退主题
 *    index.html，清单外页面路径直接落回快照/SPA——主题只管自理的页面，
 *    平台页面（订购/我的订单等）与之共存；未声明 routes 的旧主题保持
 *    全路径回退。精确文件命中不受 routes 影响。
 *    登录门（2026-10-27 领域呈现返工）：内置主题（builtin: true）且
 *    routes 为空时，页面路径不回退主题 index，直接落回快照/SPA——
 *    该应用无公开页，SPA 无公开页时自显员工登录页；无标记老主题不动。
 * 2. 快照层（CMS 静态化/SEO 线）：按入口运行模式（siteMode）分发静态快照：
 *    - dynamic（缺省/未知/读配置失败）：纯透传，与无本文件时行为一致（零扰动）；
 *    - pseudo / static：按规范键查 R2（键 = static/<host><path>[?规范 query]，
 *      与 api 侧 staticgen 同规则），命中回快照 HTML（x-lcdp-static: hit）；
 *      未命中一律回落 SPA。
 *
 * 站点配置（siteMode + theme）经网关读 /public/site?host=&seg=，用 Cache API
 * 缓存 60 秒；任何异常一律 fail-open 透传——宁可不分发，不可打挂站点。
 * seg = URL 首段（第 68 步站点模型）：默认域名下首段定位应用（路径作用域应用
 * 的 siteMode/theme 与主应用不同），配置按 (host, seg) 分开缓存；绑定域名与
 * 主应用根路径下 seg 不影响解析结果（服务端回落主应用/绑定应用）。
 * 两层都只覆盖 GET/HEAD；其余方法原样透传，method、headers、query 不改写。
 * 未绑主题的入口在本文件的响应与旧版逐字节一致（主题层整体跳过）。
 *
 * _redirects 回落：资产服务对静态资产响应应用 _redirects（/* → index.html）；
 * 若某路径资产服务回 404（高级模式下规则未生效的情形），本文件在 worker 内
 * 对页面路径补回 /index.html，等价实现 SPA 回退语义。
 *
 * 功能页主题化（第 93 步线 A）：theme.json 可声明 tokens（品牌令牌词表）
 * 与包内 functional.css；resolveSlotTheme 解析时形状过滤后随已解析主题
 * 下发。落到 SPA 壳的页面路径应答（直出 200 与 404 补回两条路径）在
 * 当前作用域槽主题（含移动回退桌面）声明了主题化时，于 <head> 后注入
 * __LCDP_THEME__ 脚本、:root 变量与 functional.css link，使平台功能页
 * （桥接页）视觉跟随主题；未声明的主题零注入、壳逐字不变。预览下桥接
 * 路径同样套用预览主题的注入（no-store + 预览头 + 角标）。
 */

const API_BASE = "https://api.coode.cc.cd";
const CONFIG_CACHE_URL = "https://lcdp-static-config.invalid/entry";

/** query 规范形：剔除跟踪参数、按 (key,value) 排序（与 api staticgen.canonicalQuery 同规则） */
function canonicalQuery(rawQuery) {
  const pairs = [];
  for (const [k, v] of new URLSearchParams(rawQuery)) {
    // view 为主题双槽的槽位参数（M15 第⑤步）：与跟踪参数同级剔除，防污染快照键
    if (
      k.startsWith("utm_") ||
      k === "fbclid" ||
      k === "gclid" ||
      k === "msclkid" ||
      k === "view"
    ) {
      continue;
    }
    pairs.push([k, v]);
  }
  pairs.sort((a, b) =>
    a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
  );
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function snapshotKey(host, path, rawQuery) {
  const q = rawQuery ? canonicalQuery(rawQuery) : "";
  return `static/${host}${path}${q ? `?${q}` : ""}`;
}

/** 页面路径判定：/assets/ 前缀与带文件扩展名的路径按资源透传，其余按页面处理 */
function isPagePath(pathname) {
  if (pathname.startsWith("/assets/")) return false;
  const last = pathname.split("/").pop() ?? "";
  return !last.includes(".");
}

const THEME_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// ------------------------------------------------- 功能页主题化（第 93 步线 A）

/**
 * 主题化令牌词表（定案 1）：theme.json 可选字段 tokens——颜色键与
 * fontFamily 为字符串、radius 为数字 px（0–32 钳制）。颜色/字体串走
 * 保守白名单：禁 < > ; { } 与 url(（可突破 style/script 上下文的字符），
 * 形状不合法的键逐项丢弃、绝不抛错（分发 fail-open 口径一致）。
 */
const THEME_TOKEN_COLOR_KEYS = [
  "primary",
  "accent",
  "background",
  "surface",
  "text",
  "textSecondary",
  "border",
];
const THEME_TOKEN_FORBIDDEN_RE = /[<>;{}]|url\(/i;

function sanitizeThemeTokenString(v) {
  return typeof v === "string" && v.length > 0 && !THEME_TOKEN_FORBIDDEN_RE.test(v)
    ? v
    : null;
}

/** tokens 形状过滤：只收词表内形状合法的键；无一合法返回 null */
function sanitizeThemeTokens(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const key of THEME_TOKEN_COLOR_KEYS) {
    const v = sanitizeThemeTokenString(raw[key]);
    if (v !== null) out[key] = v;
  }
  const ff = sanitizeThemeTokenString(raw.fontFamily);
  if (ff !== null) out.fontFamily = ff;
  if (typeof raw.radius === "number" && Number.isFinite(raw.radius)) {
    out.radius = Math.min(32, Math.max(0, raw.radius));
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** tokens 键 → :root CSS 变量名（映射定死，输出顺序即数组顺序） */
const THEME_TOKEN_CSS_VARS = [
  ["primary", "--lcdp-primary"],
  ["accent", "--lcdp-accent"],
  ["background", "--lcdp-background"],
  ["surface", "--lcdp-surface"],
  ["text", "--lcdp-text"],
  ["textSecondary", "--lcdp-text-secondary"],
  ["border", "--lcdp-border"],
  ["radius", "--lcdp-radius"],
  ["fontFamily", "--lcdp-font-family"],
];

/** 已解析主题是否声明功能页主题化：tokens 非空或 functional.css 存在 */
function themeHasTheming(theme) {
  if (!theme) return false;
  if (theme.functionalCss === true) return true;
  const t = sanitizeThemeTokens(theme.tokens);
  return !!t && Object.keys(t).length > 0;
}

/**
 * 功能页主题化注入片段（脚本 + :root 变量 + functional.css link）：
 * 未声明主题化且未声明 routes 返回 null（调用方逐字透传、零改动）；
 * 仅声明 routes 时只出脚本（壳据 routes 把主题自理路径导航改走整页跳，
 * 避免客户端路由在壳内渲染主题路径、主题被「绕过」）。__LCDP_THEME__
 * 的 JSON 转义与 __LCDP__ 同口径（<>& 转义防 </script> 突破）；
 * style 只出已声明键，radius 出 <n>px。
 */
function functionalThemingSnippet(theme) {
  const routes = Array.isArray(theme?.routes)
    ? theme.routes.filter((r) => typeof r === "string" && r.startsWith("/"))
    : [];
  if (!themeHasTheming(theme) && routes.length === 0) return null;
  const tokens = sanitizeThemeTokens(theme.tokens) ?? {};
  const json = JSON.stringify({
    themeId: theme.id,
    version: theme.version,
    tokens,
    ...(routes.length > 0 ? { routes } : {}),
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  let out = `<script>window.__LCDP_THEME__=${json};</script>`;
  const decls = [];
  for (const [key, varName] of THEME_TOKEN_CSS_VARS) {
    if (!(key in tokens)) continue;
    decls.push(
      `${varName}:${key === "radius" ? `${tokens[key]}px` : tokens[key]}`,
    );
  }
  if (decls.length > 0) out += `<style>:root{${decls.join(";")}}</style>`;
  if (theme.functionalCss === true) {
    out += `<link rel="stylesheet" href="/functional.css?v=${theme.id}@${theme.version}">`;
  }
  return out;
}

/**
 * 把主题化片段注入 SPA 壳 HTML：注入点为 <head> 之后（与 __LCDP__
 * 同位；无 head 则置于文首）。opts.badge 为真时同注入预览角标（A3）。
 */
function injectFunctionalTheming(html, theme, opts = {}) {
  const snippet = functionalThemingSnippet(theme);
  if (snippet === null) return html;
  const m = /<head[^>]*>/i.exec(html);
  let out = m
    ? html.slice(0, m.index + m[0].length) +
      snippet +
      html.slice(m.index + m[0].length)
    : snippet + html;
  if (opts.badge) out = injectPreviewBadge(out);
  return out;
}

/**
 * 对 SPA 壳应答执行主题化注入并重建 Response：门槛 = 状态 200 +
 * text/html + 无内容编码（编码体读出非原文，跳过注入保逐字）。
 * 注入改变正文长度/指纹：删 content-length 与 etag（与主题层注入后
 * 不回 etag 同口径），状态码与其余头逐字保留。opts.preview 为真时
 * 追加 no-store 与 x-lcdp-theme-preview 头（A3 明示口径）。
 * 未实际注入（门槛不过/未声明主题化）时原样返回入参 res。
 */
async function injectSpaTheming(res, theme, opts = {}) {
  if (functionalThemingSnippet(theme) === null) return res;
  if (res.status !== 200) return res;
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  const ce = res.headers.get("content-encoding");
  if (ce && ce !== "identity") return res;
  const html = await res.text();
  const out = injectFunctionalTheming(html, theme, opts);
  if (out === html) return res;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  if (opts.preview) {
    headers.set("cache-control", "no-store");
    headers.set("x-lcdp-theme-preview", `${theme.id}@${theme.version}`);
  }
  return new Response(out, { status: res.status, headers });
}

/**
 * 单槽指针归一：形状合法返回 { id, version, values }，否则 null。
 * values 须为普通对象（缺失/非法归一为空对象）。
 */
function normalizeSlotPointer(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.id !== "string" ||
    !THEME_ID_RE.test(raw.id) ||
    typeof raw.version !== "string" ||
    !raw.version
  ) {
    return null;
  }
  const values =
    raw.values && typeof raw.values === "object" && !Array.isArray(raw.values)
      ? raw.values
      : {};
  return { id: raw.id, version: raw.version, values };
}

/**
 * 入口 theme 字段 → 双槽原始指针（M15 第⑤步：config.theme 改双槽形状
 * { desktop, mobile }）。只认双槽形状：旧单指针形状（{id, version, ...}）
 * 按定案「视为未绑定」→ 两槽皆 null；形状非法同样两槽皆 null、绝不抛错。
 */
function themeSlotsOf(raw) {
  const empty = { desktop: null, mobile: null };
  if (!raw || typeof raw !== "object") return empty;
  if (!("desktop" in raw) && !("mobile" in raw)) return empty;
  return {
    desktop: normalizeSlotPointer(raw.desktop),
    mobile: normalizeSlotPointer(raw.mobile),
  };
}

/**
 * 单槽指针 → 已解析的绑定上下文：指针 + 入口/主应用标识 + 已合并的 config
 * + 清单 routes（修法 D）。config 合并 = 主题清单 defaults ← 绑定 values；
 * 清单从 R2 读 theme.json（读失败则 config 只含绑定 values，分发不中断）。
 */
async function resolveSlotTheme(env, ptr, meta) {
  if (!ptr) return null;
  const config = {};
  let routes = null;
  let tokens = null;
  // 领域呈现返工·登录门：内置标记（生成端 theme.json builtin: true）。
  // 仅内置主题带此标记；无标记的老主题保持原行为。
  let builtin = false;
  try {
    const mObj = await env.STATIC_R2.get(
      `themes/${ptr.id}/${ptr.version}/theme.json`,
    );
    if (mObj) {
      const manifest = JSON.parse(await mObj.text());
      if (Array.isArray(manifest?.config)) {
        for (const item of manifest.config) {
          if (
            item &&
            typeof item.key === "string" &&
            typeof item.default === "string"
          ) {
            config[item.key] = item.default;
          }
        }
      }
      // 修法 D：routes 声明（可选）——仅取以 / 开头的字符串项；
      // 非空才生效，空/缺失视为未声明（保持旧主题全回退行为）
      if (Array.isArray(manifest?.routes)) {
        const list = manifest.routes.filter(
          (r) => typeof r === "string" && r.startsWith("/"),
        );
        if (list.length > 0) routes = list;
      }
      // 功能页主题化（第 93 步线 A1）：tokens 只收形状合法项
      tokens = sanitizeThemeTokens(manifest?.tokens);
      if (manifest?.builtin === true) builtin = true;
    }
  } catch {
    // 清单读失败：config 只用绑定 values，不阻断主题分发
  }
  // functional.css 存在性（第 93 步线 A1）：R2 head 探包内根目录，
  // 探失败按不存在（不阻断分发）
  let functionalCss = false;
  try {
    if (typeof env.STATIC_R2.head === "function") {
      functionalCss = !!(await env.STATIC_R2.head(
        `themes/${ptr.id}/${ptr.version}/functional.css`,
      ));
    }
  } catch {
    functionalCss = false;
  }
  Object.assign(config, ptr.values);
  return {
    id: ptr.id,
    version: ptr.version,
    entryId: meta.entryId,
    entryName: meta.entryName,
    appId: meta.appId,
    config,
    ...(routes ? { routes } : {}),
    ...(tokens ? { tokens } : {}),
    ...(functionalCss ? { functionalCss: true } : {}),
    ...(builtin ? { builtin: true } : {}),
  };
}

/** 缓存信封里的单槽已解析主题校验（形状非法视为该槽未绑定） */
function cachedSlotTheme(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    typeof raw.id === "string" &&
    typeof raw.version === "string"
  ) {
    // 第 93 步线 A1：新字段 tokens / functionalCss 同步过形状过滤后
    // 放行（信封由 resolveSlotTheme 写入、形状本已合法，此处再滤一遍
    // 防旧信封/异常内容把非法值带进注入），其余字段逐字沿用信封内容
    const out = { ...raw };
    const tokens = sanitizeThemeTokens(raw.tokens);
    if (tokens) out.tokens = tokens;
    else delete out.tokens;
    if (raw.functionalCss === true) out.functionalCss = true;
    else delete out.functionalCss;
    if (raw.builtin === true) out.builtin = true;
    else delete out.builtin;
    return out;
  }
  return null;
}

/**
 * 读入口配置 { siteMode, themeSlots }（Cache API 缓存 60 秒；失败/未知一律
 * { dynamic, 双槽未绑定 }，fail-open）。
 * themeSlots = { desktop, mobile }，每槽为已解析的绑定上下文或 null；
 * 缓存信封只认新形状，旧单 theme 信封按「未绑定」读（siteMode 仍沿用）。
 */
async function loadEntryConfig(host, seg, ctx, env) {
  const emptyMeta = { entryId: null, entryName: null, appId: null };
  const fallback = {
    siteMode: "dynamic",
    themeSlots: { desktop: null, mobile: null },
    appMeta: emptyMeta,
    // 站点定位方式：仅 "path"（默认域名下首段定位应用）时主题层剥首段；
    // 缺失/其他值一律不剥（fail-open，行为与修前逐字一致）。
    siteVia: null,
  };
  try {
    const cache = caches.default;
    const cacheKey = new Request(
      `${CONFIG_CACHE_URL}?host=${encodeURIComponent(host)}&seg=${encodeURIComponent(seg ?? "")}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) {
      const data = await hit.json().catch(() => null);
      if (data && typeof data === "object") {
        const slots =
          data.themeSlots && typeof data.themeSlots === "object"
            ? data.themeSlots
            : {};
        // appMeta 为第 83 步片五预览校验追加字段：旧信封无此字段时
        // 按空读（预览自动忽略，60 秒缓存过期后自愈），分发不受影响。
        const meta =
          data.appMeta && typeof data.appMeta === "object" ? data.appMeta : {};
        return {
          siteMode:
            data.siteMode === "pseudo" || data.siteMode === "static"
              ? data.siteMode
              : "dynamic",
          themeSlots: {
            desktop: cachedSlotTheme(slots.desktop),
            mobile: cachedSlotTheme(slots.mobile),
          },
          appMeta: {
            entryId: meta.entryId ?? null,
            entryName: meta.entryName ?? null,
            appId: meta.appId ?? null,
          },
          // 旧信封无此字段时按 null 读（60 秒缓存过期后自愈）
          siteVia: typeof data.siteVia === "string" ? data.siteVia : null,
        };
      }
      return fallback;
    }
    let siteMode = "dynamic";
    let themeSlots = { desktop: null, mobile: null };
    let appMeta = emptyMeta;
    // 服务端 /public/site 下发的 site.via：仅 "path" 表示首段定位应用
    let siteVia = null;
    try {
      const res = await fetch(
        `${API_BASE}/public/site?host=${encodeURIComponent(host)}&seg=${encodeURIComponent(seg ?? "")}`,
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const m = data?.entry?.siteMode;
        if (m === "pseudo" || m === "static") siteMode = m;
        const meta = {
          entryId: data?.entry?.id ?? null,
          entryName: data?.entry?.name ?? null,
          appId: data?.primary?.appId ?? data?.apps?.[0]?.id ?? null,
        };
        appMeta = meta;
        siteVia = typeof data?.site?.via === "string" ? data.site.via : null;
        const rawSlots = themeSlotsOf(data?.entry?.theme);
        themeSlots = {
          desktop: await resolveSlotTheme(env, rawSlots.desktop, meta),
          mobile: await resolveSlotTheme(env, rawSlots.mobile, meta),
        };
      }
    } catch {
      // 网关/源站不可达 → dynamic + 未绑定（fail-open）
    }
    const resp = new Response(
      JSON.stringify({ siteMode, themeSlots, appMeta, siteVia }),
      {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=60",
        },
      },
    );
    ctx.waitUntil(cache.put(cacheKey, resp));
    return { siteMode, themeSlots, appMeta, siteVia };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- 主题层（M14 线二）

const THEME_CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** 主题资源 Content-Type（与 api 侧 themes.themeContentType 同表） */
function themeContentType(path) {
  const seg = path.split("/").pop() ?? "";
  const i = seg.lastIndexOf(".");
  const ext = i > 0 ? seg.slice(i + 1).toLowerCase() : "";
  return THEME_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * 向主题 index.html 注入运行时上下文（契约 §4）：window.__LCDP__ =
 * { host, entryId, entryName, appId, themeId, version, config, apiBase }。
 * JSON 做 <>& 转义防 `</script>` 突破；注入点为 <head> 之后（无 head 则置于文首）。
 */
function injectThemeContext(html, theme, host, opts = {}) {
  const payload = {
    host,
    entryId: theme.entryId,
    entryName: theme.entryName,
    appId: theme.appId,
    themeId: theme.id,
    version: theme.version,
    config: theme.config ?? {},
    apiBase: API_BASE,
    // 预览模式（第 83 步片五）：仅预览应答追加 preview: true，
    // 正常分发不带此键（行为逐字不变）
    ...(opts.preview ? { preview: true } : {}),
  };
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const tag = `<script>window.__LCDP__=${json};</script>`;
  const m = /<head[^>]*>/i.exec(html);
  if (m) {
    return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length);
  }
  return tag + html;
}

/**
 * 移动槽自检脚本（M15 第⑤步）：桌面槽主题 index 应答时同注入点追加。
 * 设备信号与 M13 useDevice 同口径、不用 UA——Capacitor 只认能力调用
 * （isNativePlatform() === true，对象存在不算数，M13 回归教训）或视口
 * ≤820px；命中即整页跳同 URL 带 view=mobile（保留其余 query、覆盖已有
 * view），随后由槽位判定以参数选移动槽并落 Cookie 固化。
 */
const VIEW_CHECK_SCRIPT = `<script>(function(){try{var n=false;try{var c=window.Capacitor;n=!!(c&&typeof c.isNativePlatform==="function"&&c.isNativePlatform()===true);}catch(e){}var w=false;try{w=typeof window.matchMedia==="function"&&window.matchMedia("(max-width: 820px)").matches;}catch(e){}if(n||w){var u=new URL(window.location.href);u.searchParams.set("view","mobile");window.location.replace(u.toString());}}catch(e){}})();</script>`;

/** 自检脚本注入：置于 </head> 之前（解析期即执行、渲染前完成跳转判定） */
function injectViewCheck(html) {
  const i = html.toLowerCase().indexOf("</head>");
  if (i >= 0) return html.slice(0, i) + VIEW_CHECK_SCRIPT + html.slice(i);
  return html + VIEW_CHECK_SCRIPT;
}

/**
 * 预览角标（第 83 步片五）：固定定位小条，明示当前为未生效的预览
 * 效果，并给出退出预览入口（?lcdp_preview=off 清除固化 cookie 回
 * 正常分发）。仅预览模式的 index 应答注入，置于 </body> 之前。
 */
const PREVIEW_BADGE = `<div style="position:fixed;left:12px;bottom:12px;z-index:2147483647;background:rgba(17,24,39,.92);color:#f9fafb;font:13px/1.5 -apple-system,'Segoe UI',sans-serif;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.35)">预览效果 · 未生效 <a href="?lcdp_preview=off" style="color:#93c5fd;margin-left:8px">退出预览</a></div>`;

function injectPreviewBadge(html) {
  const i = html.toLowerCase().indexOf("</body>");
  if (i >= 0) return html.slice(0, i) + PREVIEW_BADGE + html.slice(i);
  return html + PREVIEW_BADGE;
}

/** 路径归一（与主题内路由同口径：去尾斜杠、空即根） */
function normalizeRoutePath(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}

/** routes 命中判定：清单项同样归一后精确比对 */
function themeRouteMatches(routes, pathname) {
  const p = normalizeRoutePath(pathname);
  return routes.some((r) => normalizeRoutePath(r) === p);
}

/**
 * 主题层应用内路径：仅路径作用域应用（服务端 resolveSite 的 via=path，
 * 即默认域名下首段定位应用）剥首段；绑定域名、主应用根路径与未知
 * 情形下路径本身即应用内路径，不剥。
 * 与 SPA 侧 stripSitePrefix 同口径、与服务端 via 判定同源——此前边缘
 * 未剥段，www/<应用ID>/home 一类路径恒对不上主题路由表、主题永不
 * 送达，只影响未绑域名应用（2026-10-26 content-pilot 实证）。
 */
function themeAppPath(pathname, siteVia) {
  if (siteVia !== "path") return pathname;
  const idx = pathname.indexOf("/", 1);
  return idx === -1 ? "/" : pathname.slice(idx);
}

/**
 * 主题分发：命中返回 Response，未命中/不适用返回 null（调用方落回快照/SPA）。
 * - 精确路径命中主题文件 → 直出（index.html 走注入）；
 * - `/` 与无扩展名页面路径未命中 → 回退主题 index.html（注入后应答）；
 *   但主题声明了 routes 时，仅清单内路径回退，清单外返回 null（修法 D）；
 * - 文件型路径未命中、或主题 index.html 本身缺失 → null。
 * opts.viewCheck 为真且本次由 index 应答时，追加移动槽自检脚本（第⑤步）。
 * opts.preview 为真时（第 83 步片五预览模式）：仅覆盖主题指针，
 * routes 归属与正常分发一致（第 90 步修正，原「routes 不限」使桥接
 * 页在预览中被吞）；全部应答改 no-store 并加 x-lcdp-theme-preview
 * 头；index 应答的 __LCDP__ 追加 preview: true 并注入预览角标。
 * 正常分发不传 preview，行为逐字不变。
 * opts.appPath：调用方算好的应用内路径（路径作用域应用已剥首段），
 * 主题层 R2 查找与 routes 判定一律以此为准；不传则用原始 pathname。
 */
async function serveTheme(env, theme, url, method, opts = {}) {
  const prefix = `themes/${theme.id}/${theme.version}/`;
  // 主题层路径口径：调用方传入应用内路径（路径作用域应用已剥首段）；
  // 未传时沿用原始 pathname（绑定域名等无前缀场景，行为逐字不变）。
  const themePath = opts.appPath ?? url.pathname;
  const rel = themePath.replace(/^\//, "");
  const respond = async (path, obj, isIndex) => {
    const headers = new Headers();
    headers.set("content-type", themeContentType(path));
    headers.set("x-lcdp-theme", `${theme.id}@${theme.version}`);
    headers.set("cache-control", "public, max-age=60, s-maxage=300");
    if (opts.preview) {
      headers.set("x-lcdp-theme-preview", `${theme.id}@${theme.version}`);
      headers.set("cache-control", "no-store");
    }
    if (method === "HEAD" || !obj.body) {
      if (obj.httpEtag) headers.set("etag", obj.httpEtag);
      return new Response(null, { headers });
    }
    if (isIndex) {
      // 注入后的正文与原 etag 不再对应，不回 etag
      const html = await obj.text();
      let out = injectThemeContext(html, theme, url.host, {
        preview: !!opts.preview,
      });
      if (opts.viewCheck) out = injectViewCheck(out);
      if (opts.preview) out = injectPreviewBadge(out);
      return new Response(out, { headers });
    }
    if (obj.httpEtag) headers.set("etag", obj.httpEtag);
    return new Response(obj.body, { headers });
  };
  const get = (key) =>
    method === "HEAD" ? env.STATIC_R2.head(key) : env.STATIC_R2.get(key);
  if (rel) {
    const obj = await get(prefix + rel);
    if (obj) return respond(rel, obj, rel === "index.html");
  }
  if (!rel || isPagePath(themePath)) {
    // 领域呈现返工·登录门：内置且空路由 = 该应用无公开页（OA/供应商），
    // 主题壳无页可给——不回退主题 index（否则壳子自带“页面不存在”把
    // 员工登录门截住），直接落回快照/SPA，SPA 无公开页时自显员工登录页。
    // 无标记的老主题保持全路径回退不动；精确文件命中在上文已直出，不受影响。
    if (
      theme.builtin === true &&
      (!Array.isArray(theme.routes) || theme.routes.length === 0)
    ) {
      return null;
    }
    // 修法 D：声明了 routes 的主题只接管清单内路径，清单外落回快照/SPA。
    // 预览模式同样适用（第 90 步修正）：预览只覆盖主题指针、路径归属
    // 与正常分发一致，否则桥接页（购物车/结算等）在预览中被主题吞掉、
    // 点击链永远验不了（1.1.8 预览实证）。
    // 例外（2026-10-28 根路径承接）：应用内路径 "/" 不在生成端 routes 清单内，
    // 但主题壳对 "/" 回退首个可见菜单页（即主题首页），故 "/" 豁免清单门、
    // 由主题层承接（主应用根与路径作用域应用根同口径，themeAppPath 已剥段）；
    // 空路由内置主题仍由上方守卫先行返回 null，员工登录门不受影响。
    if (
      Array.isArray(theme.routes) &&
      theme.routes.length > 0 &&
      normalizeRoutePath(themePath) !== "/" &&
      !themeRouteMatches(theme.routes, themePath)
    ) {
      return null;
    }
    const idx = await get(prefix + "index.html");
    if (idx) return respond("index.html", idx, true);
  }
  return null;
}

function fallbackContentType(pathname) {
  if (pathname.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (pathname.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "text/html; charset=utf-8";
}

// ------------------------------------------------------------ 主题双槽（M15 第⑤步）

const VIEW_COOKIE_MAX_AGE = 2592000; // 30 天（定案）

/** URL 上的槽位参数：view=mobile|desktop 才有效，非法值忽略（返回 null） */
function viewParamOf(url) {
  const v = url.searchParams.get("view");
  return v === "mobile" || v === "desktop" ? v : null;
}

/**
 * 槽位判定（定案四级的前三级）：view 参数 → lcdp-view Cookie → 默认桌面。
 * 返回 { slot, source }；source 决定自检脚本是否注入——仅默认路径
 * （无参数、无 Cookie）才注入，参数/Cookie 已明示选择时不再自检，
 * 保证「桌面版」逃生（view=desktop 落 Cookie）后窄屏也不被跳回移动槽。
 */
function requestedSlot(url, request) {
  const param = viewParamOf(url);
  if (param) return { slot: param, source: "param" };
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const t = part.trim();
    if (t.startsWith("lcdp-view=")) {
      const v = t.slice("lcdp-view=".length);
      if (v === "mobile" || v === "desktop") return { slot: v, source: "cookie" };
    }
  }
  return { slot: "desktop", source: "default" };
}

// ------------------------------------------------- 主题预览（第 83 步片五，路线 A）

/**
 * 预览模式是主题层之前的一个可选前置：请求带令牌（query 参数
 * lcdp_preview 优先，其次同名 cookie 固化）时，先向 api 校验端点
 * 换取指针覆盖——仅当校验返回的应用与本站点配置解析出的应用
 * 一致时生效：以返回指针覆盖对应槽并强制该槽（不读 view 参数/
 * cookie 选槽）、跳过快照层、routes 归属与正常分发一致，主题文件直出与
 * index 回退同主题层既有逻辑。校验失败 / 应用不一致 / 主题文件
 * 缺失等任何不适用情形一律返回 null 落回正常分发（fail-open），
 * 无令牌时本层整体不触发、正常分发路径逐字不变。
 * 参数触发成功时在最终响应上 Set-Cookie 固化令牌（30 分钟），
 * 使主题子资源请求续用预览；参数值为 off 时由 fetch 入口清除
 * cookie 并回正常分发。
 */
const PREVIEW_COOKIE_MAX_AGE = 1800; // 30 分钟，与令牌有效期同长

function appendSetCookie(res, cookie) {
  try {
    const headers = new Headers(res.headers);
    headers.append("set-cookie", cookie);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return res;
  }
}

function withPreviewCookie(res, token) {
  return appendSetCookie(
    res,
    `lcdp-preview=${token}; Path=/; Max-Age=${PREVIEW_COOKIE_MAX_AGE}; SameSite=Lax`,
  );
}

function withClearedPreviewCookie(res) {
  return appendSetCookie(res, "lcdp-preview=; Path=/; Max-Age=0; SameSite=Lax");
}

/** 令牌来源：query 参数（参数优先）→ lcdp-preview Cookie；皆无返回 null */
function previewTokenOf(url, request) {
  const p = url.searchParams.get("lcdp_preview");
  if (p !== null) return { token: p, fromParam: true };
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const t = part.trim();
    if (t.startsWith("lcdp-preview=")) {
      const v = t.slice("lcdp-preview=".length);
      if (v) return { token: v, fromParam: false };
    }
  }
  return null;
}

/**
 * 预览桥接路径的 SPA 壳应答（第 93 步线 A3）：serveTheme 未命中
 * （路径归属平台页）时，预览主题声明了功能页主题化才接管——取
 * SPA 壳（ASSETS 直出或 404 补回 /index.html，与 dispatch 回落同
 * 路径）做同一注入，并带预览口径（no-store + x-lcdp-theme-preview
 * 头 + 预览角标）。未声明主题化 / 非页面路径 / 壳不可得一律返回
 * null，调用方落回正常分发（现行行为逐字不变）。
 */
async function previewSpaShell(request, env, method, url, theme) {
  if (!env.ASSETS) return null;
  if (!isPagePath(url.pathname)) return null;
  if (functionalThemingSnippet(theme) === null) return null;
  let res = await env.ASSETS.fetch(request);
  if (res.status === 404 && (method === "GET" || method === "HEAD")) {
    const indexRes = await env.ASSETS.fetch(
      new Request(new URL("/index.html", url.origin), { method: "GET" }),
    );
    if (!indexRes.ok) return null;
    res =
      method === "HEAD"
        ? new Response(null, { status: 200, headers: indexRes.headers })
        : new Response(indexRes.body, {
            status: 200,
            headers: indexRes.headers,
          });
  }
  if (res.status !== 200) return null;
  if (method === "HEAD") {
    // 无正文可注入：仅带预览头与 no-store（与主题层预览口径一致）
    const headers = new Headers(res.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-lcdp-theme-preview", `${theme.id}@${theme.version}`);
    return new Response(null, { status: 200, headers });
  }
  const out = await injectSpaTheming(res, theme, { preview: true, badge: true });
  // 注入未实际发生（如壳非 HTML）→ 不接管，落回正常分发
  return out === res ? null : out;
}

/**
 * 预览分发：命中返回 Response，未命中/不适用返回 null（调用方落回
 * 正常分发）。仅 GET/HEAD 且 R2 绑定存在时尝试，与主题层同条件。
 */
async function tryThemePreview(request, env, ctx, url) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;
  if (!env.STATIC_R2) return null;
  const found = previewTokenOf(url, request);
  if (!found || !found.token || found.token === "off") return null;
  // 校验：向 api 换取作用域（响应 no-store，不缓存校验结果）
  let valid = null;
  try {
    const res = await fetch(
      `${API_BASE}/public/theme-preview/validate?token=${encodeURIComponent(found.token)}`,
      { headers: { accept: "application/json" } },
    );
    if (res.ok) valid = await res.json().catch(() => null);
  } catch {
    return null;
  }
  if (
    !valid ||
    typeof valid.appId !== "string" ||
    typeof valid.themeId !== "string" ||
    !valid.themeId ||
    typeof valid.version !== "string" ||
    !valid.version ||
    (valid.slot !== "desktop" && valid.slot !== "mobile")
  ) {
    return null;
  }
  // 站点配置走既有路径（60 秒缓存）：本站点解析出的应用须与
  // 令牌作用域一致，否则忽略预览（防跨应用串用令牌）
  const rawSeg = url.pathname.split("/").filter(Boolean)[0] ?? "";
  let seg = rawSeg;
  try {
    seg = decodeURIComponent(rawSeg);
  } catch {
    seg = rawSeg;
  }
  const entryCfg = await loadEntryConfig(url.host, seg, ctx, env);
  if (!entryCfg.appMeta || entryCfg.appMeta.appId !== valid.appId) {
    return null;
  }
  // 以返回指针解析主题（config 合并走 resolveSlotTheme 既有逻辑，
  // values 恒空——预览看主题本身效果，不带绑定配置值）
  const theme = await resolveSlotTheme(
    env,
    { id: valid.themeId, version: valid.version, values: {} },
    entryCfg.appMeta,
  );
  if (!theme) return null;
  const themed = await serveTheme(env, theme, url, method, {
    preview: true,
    appPath: themeAppPath(url.pathname, entryCfg.siteVia),
  });
  if (themed) {
    return found.fromParam ? withPreviewCookie(themed, found.token) : themed;
  }
  // 第 93 步线 A3：桥接路径（serveTheme 未命中）——预览主题声明了
  // 主题化时把预览主题带入 SPA 回落注入；未声明则维持现行落回
  const spaRes = await previewSpaShell(request, env, method, url, theme);
  if (!spaRes) return null;
  return found.fromParam ? withPreviewCookie(spaRes, found.token) : spaRes;
}

/** 在最终响应上固化槽位 Cookie（参数逃生在主题/快照/SPA 任一层应答都要落下） */
function withViewCookie(res, slot) {
  try {
    const headers = new Headers(res.headers);
    headers.append(
      "set-cookie",
      `lcdp-view=${slot}; Path=/; Max-Age=${VIEW_COOKIE_MAX_AGE}`,
    );
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return res;
  }
}

/**
 * 分发主体（原 fetch 逻辑）：主题双槽 → 快照 → SPA。
 * 主题尝试顺序（定死）：页面请求按选定槽先行——选移动槽未绑定/未命中时
 * 回退桌面槽再试（定案「移动槽空缺回退桌面槽」），仍未命中才落快照/SPA；
 * 选桌面槽只试桌面槽（移动槽只经参数/Cookie/自检跳转进入，桌面默认
 * 流量永不直出移动主题）。资源（非页面）请求不做槽位判定：按选定槽、
 * 另一槽的顺序做精确文件命中、任一命中即按该主题版本直出，不写
 * Cookie、不注入自检（其服务版本由引用它的 index 所属槽位决定，
 * 经 Cookie 在后续请求中保持）。
 */
async function dispatch(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const special =
      url.pathname === "/sitemap.xml" || url.pathname === "/robots.txt";
    // 功能页主题化（第 93 步线 A2）：回落 SPA 段注入用的已解析槽主题，
    // 在主题层判定处赋值（未绑主题/无 R2 时恒 null → 回落逐字不变）
    let spaTheme = null;
    if ((method === "GET" || method === "HEAD") && env.STATIC_R2) {
      // 站点模型：首段路径定位作用域应用，配置随作用域而变（68.2）
      const rawSeg = url.pathname.split("/").filter(Boolean)[0] ?? "";
      let seg = rawSeg;
      try {
        seg = decodeURIComponent(rawSeg);
      } catch {
        seg = rawSeg;
      }
      const entryCfg = await loadEntryConfig(url.host, seg, ctx, env);
      // 1. 主题层（M14 线二 + 第⑤步双槽）：按槽尝试，未命中/异常落回下一层
      const slots = entryCfg.themeSlots;
      const slotPick = requestedSlot(url, request);
      // 回落注入的主题与主题层同判定：选桌面取桌面槽、桌面槽空缺
      // 时回退移动槽；选移动取移动槽、空缺回退桌面槽（单槽用该槽，
      // 双槽齐全时口径不变；与页面请求尝试顺序一致）
      spaTheme =
        slotPick.slot === "mobile"
          ? (slots.mobile ?? slots.desktop)
          : (slots.desktop ?? slots.mobile);
      if (slots.desktop || slots.mobile) {
        try {
          const { slot, source } = slotPick;
          const page = isPagePath(url.pathname);
          // 页面请求：移动槽沿用 [移动, 桌面]；桌面槽有绑定时只试桌面
          // 槽（双槽口径不变），桌面槽空缺时只试移动槽（单槽用该槽）。
          // 资源请求沿用既有双向尝试顺序，不动。
          const order = !page
            ? slot === "mobile"
              ? ["mobile", "desktop"]
              : ["desktop", "mobile"]
            : slot === "mobile"
              ? ["mobile", "desktop"]
              : slots.desktop
                ? ["desktop"]
                : ["mobile"];
          for (const name of order) {
            const theme = slots[name];
            if (!theme) continue;
            const themed = await serveTheme(env, theme, url, method, {
              // 应用内路径：路径作用域应用剥首段后匹配（见 themeAppPath）
              appPath: themeAppPath(url.pathname, entryCfg.siteVia),
              // 自检注入四条件齐备才开：页面请求、桌面槽 index 应答、
              // 移动槽有绑定、槽位来自默认判定（未被参数/Cookie 明示）
              viewCheck:
                page &&
                name === "desktop" &&
                source === "default" &&
                !!slots.mobile,
            });
            if (themed) return themed;
          }
        } catch {
          // 主题层异常 → 落回快照/SPA（fail-open）
        }
      }
      // 2. 快照层（静态化线）：仅页面路径与 sitemap/robots 进入
      if ((special || isPagePath(url.pathname)) && entryCfg.siteMode !== "dynamic") {
        const key = snapshotKey(
          url.host,
          url.pathname,
          url.search.replace(/^\?/, ""),
        );
        const obj =
          method === "HEAD"
            ? await env.STATIC_R2.head(key)
            : await env.STATIC_R2.get(key);
        if (obj) {
          const headers = new Headers();
          if (typeof obj.writeHttpMetadata === "function") {
            obj.writeHttpMetadata(headers);
          }
          if (!headers.has("content-type")) {
            headers.set("content-type", fallbackContentType(url.pathname));
          }
          headers.set("etag", obj.httpEtag);
          headers.set("x-lcdp-static", "hit");
          headers.set("cache-control", "public, max-age=60, s-maxage=300");
          if (method === "HEAD") return new Response(null, { headers });
          return new Response(obj.body, { headers });
        }
      }
    }
    // 回落 SPA：原样透传资产服务（保留 _redirects 的 SPA 回退语义）
    let res = await env.ASSETS.fetch(request);
    // 落到 SPA 壳的两种形态（第 93 步线 A2 注入的覆盖面）：ASSETS
    // 直出 200（_redirects 已把页面路径回退到壳）、404 补回 /index.html
    let isShell = res.status === 200;
    if (
      res.status === 404 &&
      (method === "GET" || method === "HEAD") &&
      isPagePath(url.pathname)
    ) {
      // 高级模式下 _redirects 若未生效，worker 内补回 /index.html
      const indexRes = await env.ASSETS.fetch(
        new Request(new URL("/index.html", url.origin), { method: "GET" }),
      );
      if (indexRes.ok) {
        isShell = true;
        if (method === "HEAD") {
          res = new Response(null, {
            status: 200,
            headers: indexRes.headers,
          });
        } else {
          res = new Response(indexRes.body, {
            status: 200,
            headers: indexRes.headers,
          });
        }
      }
    }
    // 功能页主题化注入：页面路径 + GET + 落到壳 + 槽主题有声明才动，
    // 任一不满足逐字透传（injectSpaTheming 内部再核壳的 HTML 形状）
    if (isShell && spaTheme && method === "GET" && isPagePath(url.pathname)) {
      res = await injectSpaTheming(res, spaTheme);
    }
    return res;
  } catch {
    // 任何异常 fail-open：纯资产透传
    return env.ASSETS.fetch(request);
  }
}

export default {
  async fetch(request, env, ctx) {
    // view 参数选槽须在最终响应上落 Cookie 固化（含落回快照/SPA 的响应，
    // P3 口径）；非法值忽略。dispatch 本体异常已在内层 fail-open，
    // 此处再兜一层保证挂 Cookie 失败不影响应答。
    let url = null;
    try {
      url = new URL(request.url);
    } catch {
      url = null;
    }
    const param = url ? viewParamOf(url) : null;
    // 主题预览（第 83 步片五）：off = 退出预览——正常分发并清除
    // 固化 cookie；带令牌时先试预览分发，不适用/异常一律落回
    // 正常分发。无预览参数时流程与原先逐字一致。
    if (url && url.searchParams.get("lcdp_preview") === "off") {
      const res = await dispatch(request, env, ctx);
      const withView = param ? withViewCookie(res, param) : res;
      return withClearedPreviewCookie(withView);
    }
    let res = null;
    if (url) {
      try {
        res = await tryThemePreview(request, env, ctx, url);
      } catch {
        res = null;
      }
    }
    if (!res) res = await dispatch(request, env, ctx);
    return param ? withViewCookie(res, param) : res;
  },
};
