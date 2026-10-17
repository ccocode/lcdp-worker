/**
 * LCDP Runtime 边缘分发（CMS 静态化/SEO 线，Pages 高级模式 _worker.js）。
 *
 * 职责：在 SPA 资产服务之前，按入口运行模式（siteMode）分发静态快照：
 * - dynamic（缺省/未知/读配置失败）：纯透传，与无本文件时行为一致（零扰动）；
 * - pseudo / static：先按规范键查 R2（绑定 STATIC_R2 → 桶 lcdp-assets，
 *   键 = static/<host><path>[?规范 query]，与 api 侧 staticgen 同规则），
 *   命中回快照 HTML（x-lcdp-static: hit）；未命中一律回落 SPA。
 *
 * siteMode 经网关读 /public/entry?host=（响应含 entry.siteMode），
 * 用 Cache API 缓存 60 秒；任何异常一律 fail-open 透传——宁可不静态，
 * 不可打挂站点。快照只覆盖公开页 GET/HEAD；其余方法/路径原样透传，
 * method、headers、query 不做任何改写。
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

/** 读入口 siteMode（Cache API 缓存 60 秒；失败/未知一律 dynamic） */
async function loadSiteMode(host, ctx) {
  try {
    const cache = caches.default;
    const cacheKey = new Request(
      `${CONFIG_CACHE_URL}?host=${encodeURIComponent(host)}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) {
      const data = await hit.json().catch(() => null);
      const m = data?.siteMode;
      return m === "pseudo" || m === "static" ? m : "dynamic";
    }
    let mode = "dynamic";
    try {
      const res = await fetch(
        `${API_BASE}/public/entry?host=${encodeURIComponent(host)}`,
        { headers: { accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const m = data?.entry?.siteMode;
        if (m === "pseudo" || m === "static") mode = m;
      }
    } catch {
      // 网关/源站不可达 → dynamic 透传（fail-open）
    }
    const resp = new Response(JSON.stringify({ siteMode: mode }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
    });
    ctx.waitUntil(cache.put(cacheKey, resp));
    return mode;
  } catch {
    return "dynamic";
  }
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
      if (
        (method === "GET" || method === "HEAD") &&
        env.STATIC_R2 &&
        (special || isPagePath(url.pathname))
      ) {
        const mode = await loadSiteMode(url.host, ctx);
        if (mode !== "dynamic") {
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
