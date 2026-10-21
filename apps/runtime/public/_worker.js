/**
 * LCDP Runtime 边缘分发（Pages 高级模式 _worker.js）。
 *
 * 判定序（自上而下，任一层未命中/异常都落回下一层，最终回落 SPA）：
 * 0. 预览前置（第 83 步片五，路线 A）：请求带 lcdp_preview 令牌
 *    （参数或 lcdp-preview Cookie）且 api 校验端点确认其作用域的
 *    应用与本站点一致时，以令牌指针强制对应槽渲染主题（跳过快照
 *    层、routes 不限、响应 no-store 并注入预览角标）；参数值为
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
    }
  } catch {
    // 清单读失败：config 只用绑定 values，不阻断主题分发
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
    return raw;
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
        };
      }
      return fallback;
    }
    let siteMode = "dynamic";
    let themeSlots = { desktop: null, mobile: null };
    let appMeta = emptyMeta;
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
        const rawSlots = themeSlotsOf(data?.entry?.theme);
        themeSlots = {
          desktop: await resolveSlotTheme(env, rawSlots.desktop, meta),
          mobile: await resolveSlotTheme(env, rawSlots.mobile, meta),
        };
      }
    } catch {
      // 网关/源站不可达 → dynamic + 未绑定（fail-open）
    }
    const resp = new Response(JSON.stringify({ siteMode, themeSlots, appMeta }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, resp));
    return { siteMode, themeSlots, appMeta };
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
 * 主题分发：命中返回 Response，未命中/不适用返回 null（调用方落回快照/SPA）。
 * - 精确路径命中主题文件 → 直出（index.html 走注入）；
 * - `/` 与无扩展名页面路径未命中 → 回退主题 index.html（注入后应答）；
 *   但主题声明了 routes 时，仅清单内路径回退，清单外返回 null（修法 D）；
 * - 文件型路径未命中、或主题 index.html 本身缺失 → null。
 * opts.viewCheck 为真且本次由 index 应答时，追加移动槽自检脚本（第⑤步）。
 * opts.preview 为真时（第 83 步片五预览模式）：routes 限制不适用
 * （主题自理路径全开）；全部应答改 no-store 并加 x-lcdp-theme-preview
 * 头；index 应答的 __LCDP__ 追加 preview: true 并注入预览角标。
 * 正常分发不传 preview，行为逐字不变。
 */
async function serveTheme(env, theme, url, method, opts = {}) {
  const prefix = `themes/${theme.id}/${theme.version}/`;
  const rel = url.pathname.replace(/^\//, "");
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
  if (!rel || isPagePath(url.pathname)) {
    // 修法 D：声明了 routes 的主题只接管清单内路径，清单外落回快照/SPA
    //（预览模式不适用此限制：预览要看主题在任意路径下的效果）
    if (
      !opts.preview &&
      Array.isArray(theme.routes) &&
      theme.routes.length > 0 &&
      !themeRouteMatches(theme.routes, url.pathname)
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
 * cookie 选槽）、跳过快照层、routes 限制不适用，主题文件直出与
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
  const themed = await serveTheme(env, theme, url, method, { preview: true });
  if (!themed) return null;
  return found.fromParam ? withPreviewCookie(themed, found.token) : themed;
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
      if (slots.desktop || slots.mobile) {
        try {
          const { slot, source } = requestedSlot(url, request);
          const page = isPagePath(url.pathname);
          const order = !page
            ? slot === "mobile"
              ? ["mobile", "desktop"]
              : ["desktop", "mobile"]
            : slot === "mobile"
              ? ["mobile", "desktop"]
              : ["desktop"];
          for (const name of order) {
            const theme = slots[name];
            if (!theme) continue;
            const themed = await serveTheme(env, theme, url, method, {
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
    const res = await env.ASSETS.fetch(request);
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
        if (method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: indexRes.headers,
          });
        }
        return new Response(indexRes.body, {
          status: 200,
          headers: indexRes.headers,
        });
      }
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
