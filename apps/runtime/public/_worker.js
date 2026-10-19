/**
 * LCDP Runtime 边缘分发（Pages 高级模式 _worker.js）。
 *
 * 判定序（自上而下，任一层未命中/异常都落回下一层，最终回落 SPA）：
 * 1. 主题层（M14 线二）：入口绑定了主题（/public/entry 的 entry.theme 指针）
 *    时，按 themes/<id>/<version>/<path> 查 R2 绑定 STATIC_R2（桶 lcdp-assets）；
 *    命中直出（应答头 x-lcdp-theme: <id>@<version>，index.html 注入
 *    window.__LCDP__ 上下文）；`/` 与无扩展名页面路径未命中文件时回退主题
 *    index.html；主题文件缺失/异常 → 落回下一层。
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
 * 入口配置（siteMode + theme）经网关读 /public/entry?host=，用 Cache API
 * 缓存 60 秒；任何异常一律 fail-open 透传——宁可不分发，不可打挂站点。
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
    if (k.startsWith("utm_") || k === "fbclid" || k === "gclid" || k === "msclkid") {
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
 * 读入口配置 { siteMode, theme }（Cache API 缓存 60 秒，与旧 siteMode 缓存同键
 * 同信封扩展；失败/未知一律 { dynamic, null }，fail-open）。
 * theme 为归一后的绑定上下文（指针 + 入口/主应用标识 + 已合并的 config），
 * 形状非法视为未绑定；config 合并 = 主题清单 defaults ← 绑定 values，
 * 清单从 R2 读 theme.json（读失败则 config 只含绑定 values，分发不因此中断）。
 */
async function loadEntryConfig(host, ctx, env) {
  const fallback = { siteMode: "dynamic", theme: null };
  try {
    const cache = caches.default;
    const cacheKey = new Request(
      `${CONFIG_CACHE_URL}?host=${encodeURIComponent(host)}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) {
      const data = await hit.json().catch(() => null);
      if (data && typeof data === "object") {
        return {
          siteMode:
            data.siteMode === "pseudo" || data.siteMode === "static"
              ? data.siteMode
              : "dynamic",
          theme:
            data.theme &&
            typeof data.theme === "object" &&
            typeof data.theme.id === "string" &&
            typeof data.theme.version === "string"
              ? data.theme
              : null,
        };
      }
      return fallback;
    }
    let siteMode = "dynamic";
    let theme = null;
    try {
      const res = await fetch(
        `${API_BASE}/public/entry?host=${encodeURIComponent(host)}`,
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const m = data?.entry?.siteMode;
        if (m === "pseudo" || m === "static") siteMode = m;
        const raw = data?.entry?.theme;
        if (
          raw &&
          typeof raw === "object" &&
          typeof raw.id === "string" &&
          THEME_ID_RE.test(raw.id) &&
          typeof raw.version === "string" &&
          raw.version
        ) {
          const values =
            raw.values &&
            typeof raw.values === "object" &&
            !Array.isArray(raw.values)
              ? raw.values
              : {};
          const config = {};
          let routes = null;
          try {
            const mObj = await env.STATIC_R2.get(
              `themes/${raw.id}/${raw.version}/theme.json`,
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
          Object.assign(config, values);
          theme = {
            id: raw.id,
            version: raw.version,
            entryId: data.entry.id ?? null,
            entryName: data.entry.name ?? null,
            appId: data.primary?.appId ?? data.apps?.[0]?.id ?? null,
            config,
            ...(routes ? { routes } : {}),
          };
        }
      }
    } catch {
      // 网关/源站不可达 → dynamic + 未绑定（fail-open）
    }
    const resp = new Response(JSON.stringify({ siteMode, theme }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, resp));
    return { siteMode, theme };
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
function injectThemeContext(html, theme, host) {
  const payload = {
    host,
    entryId: theme.entryId,
    entryName: theme.entryName,
    appId: theme.appId,
    themeId: theme.id,
    version: theme.version,
    config: theme.config ?? {},
    apiBase: API_BASE,
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
 */
async function serveTheme(env, theme, url, method) {
  const prefix = `themes/${theme.id}/${theme.version}/`;
  const rel = url.pathname.replace(/^\//, "");
  const respond = async (path, obj, isIndex) => {
    const headers = new Headers();
    headers.set("content-type", themeContentType(path));
    headers.set("x-lcdp-theme", `${theme.id}@${theme.version}`);
    headers.set("cache-control", "public, max-age=60, s-maxage=300");
    if (method === "HEAD" || !obj.body) {
      if (obj.httpEtag) headers.set("etag", obj.httpEtag);
      return new Response(null, { headers });
    }
    if (isIndex) {
      // 注入后的正文与原 etag 不再对应，不回 etag
      const html = await obj.text();
      return new Response(injectThemeContext(html, theme, url.host), { headers });
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
    if (
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

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      const special =
        url.pathname === "/sitemap.xml" || url.pathname === "/robots.txt";
      if ((method === "GET" || method === "HEAD") && env.STATIC_R2) {
        const entryCfg = await loadEntryConfig(url.host, ctx, env);
        // 1. 主题层（M14 线二）：绑定存在时先行分发，未命中/异常落回下一层
        if (entryCfg.theme) {
          try {
            const themed = await serveTheme(env, entryCfg.theme, url, method);
            if (themed) return themed;
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
  },
};
