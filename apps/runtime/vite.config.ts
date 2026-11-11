import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function previewUnavailableHtml(url: URL): string {
  const clean = new URL(url.toString());
  clean.searchParams.delete("lcdp_preview");
  const liveHref = escapeAttr(clean.pathname + clean.search + clean.hash);
  const off = new URL(url.toString());
  off.searchParams.set("lcdp_preview", "off");
  const offHref = escapeAttr(off.pathname + off.search + off.hash);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>预览链接已不可用</title></head><body style="margin:0;font:15px/1.7 -apple-system,'Segoe UI',sans-serif;color:#1f2937;background:#f7f8fa"><main style="max-width:640px;margin:12vh auto;padding:0 20px"><h1 style="font-size:22px;margin:0 0 12px">预览链接已不可用</h1><p style="margin:0 0 8px">这条主题预览链接的令牌无效或已过期（预览有效期 30 分钟），因此无法显示预览效果。</p><p style="margin:0 0 24px">请在助手对话框中重新签发或打开预览，或直接访问线上站。</p><p style="margin:0"><a href="${liveHref}" style="color:#1d4ed8">回到线上站</a><span style="margin:0 10px;color:#9ca3af">|</span><a href="${offHref}" style="color:#1d4ed8">退出预览</a></p></main></body></html>`;
}

// 路径作用域站点（如 /www/...）内，把主题 HTML 里以 / 开头且尚未带 /<appId>/ 的站内 <a> 链接
// 自动补全应用前缀，避免从 /www/articles 点击 /articles/detail?id=... 时丢失 /www 作用域。
const PATH_FIX_SCRIPT =
  "(function(){var a=(window.__LCDP__&&window.__LCDP__.appId)||'';if(!a)return;var p=location.pathname;if(p!=='/' + a&&p.indexOf('/' + a + '/')!==0)return;var b='/' + a;function fx(el){var h=el.getAttribute('href');if(!h||h.charAt(0)!=='/'||h.charAt(1)==='/')return;if(h===b||h.indexOf(b + '/')===0||h.indexOf(b + '?')===0)return;if(h.indexOf('/__lcdp__/')===0||h.indexOf('/public/')===0||h.indexOf('/assets/')===0||h.indexOf('/sso/')===0||h.indexOf('/pay/')===0)return;el.setAttribute('href',b+(h==='/'?'/':h));}function sc(r){if(!r||!r.querySelectorAll)return;var ls=r.querySelectorAll('a[href]');for(var i=0;i<ls.length;i++)fx(ls[i]);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){sc(document);});else sc(document);try{if(document.documentElement)new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var ns=ms[i].addedNodes;for(var j=0;j<ns.length;j++){var n=ns[j];if(n.nodeType!==1)continue;if(n.tagName==='A'&&n.hasAttribute('href'))fx(n);sc(n);}}}).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}})();";

interface SlotPtr {
  id: string;
  version: string;
  values?: Record<string, unknown>;
}

interface SitePayload {
  entry?: {
    id?: string;
    name?: string;
    theme?: {
      desktop?: SlotPtr | null;
      mobile?: SlotPtr | null;
    } | null;
  } | null;
  apps?: Array<{ id?: string; name?: string }>;
  primary?: { appId?: string } | null;
  memberSso?: { enabled?: boolean; centerBase?: string } | null;
  site?: {
    mode?: string | null;
    via?: string | null;
    defaultHost?: string | null;
    app?: { id?: string } | null;
  } | null;
}

function localThemePlugin(): Plugin {
  const apiBase = (process.env.VITE_API_BASE || "http://localhost:3000").replace(/\/+$/, "");

  return {
    name: "lcdp-local-theme",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (!req.url || (req.method !== "GET" && req.method !== "HEAD")) {
            return next();
          }
          if (
            req.url.startsWith("/@") ||
            req.url.startsWith("/node_modules/") ||
            req.url.startsWith("/src/") ||
            req.url === "/favicon.ico"
          ) {
            return next();
          }
          const host = req.headers.host || "localhost:5174";
          const url = new URL(req.url, `http://${host}`);

          // __lcdp__/shell/v1/... 路径前缀剥离（与 _worker.js 同口径）
          if (url.pathname.includes("/__lcdp__/")) {
            const idx = url.pathname.indexOf("/__lcdp__/");
            req.url = url.pathname.slice(idx) + url.search;
            return next();
          }

          const qTok = url.searchParams.get("lcdp_preview");
          const cTok = parseCookie(req.headers.cookie, "lcdp_preview");
          const fromParam = qTok !== null;
          const token = fromParam ? qTok : cTok;

          if (token === "off") {
            const clean = new URL(url.toString());
            clean.searchParams.delete("lcdp_preview");
            res.statusCode = 302;
            res.setHeader("Set-Cookie", "lcdp_preview=; Path=/; Max-Age=0; SameSite=Lax");
            res.setHeader("Location", clean.pathname + clean.search);
            res.end();
            return;
          }

          let validPreview: {
            appId: string;
            themeId: string;
            version: string;
            slot: string;
          } | null = null;

          if (token) {
            const vRes = await fetch(
              `${apiBase}/public/theme-preview/validate?token=${encodeURIComponent(token)}`,
              { headers: { accept: "application/json" } },
            ).catch(() => null);

            if (vRes && vRes.ok) {
              const parsed = (await vRes.json().catch(() => null)) as {
                appId?: string;
                themeId?: string;
                version?: string;
                slot?: string;
              } | null;
              if (parsed?.appId && parsed?.themeId && parsed?.version) {
                validPreview = {
                  appId: parsed.appId,
                  themeId: parsed.themeId,
                  version: parsed.version,
                  slot: parsed.slot === "mobile" ? "mobile" : "desktop",
                };
              }
            } else if (fromParam && req.method === "GET") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "no-store");
              res.setHeader("Set-Cookie", "lcdp_preview=; Path=/; Max-Age=0; SameSite=Lax");
              res.end(previewUnavailableHtml(url));
              return;
            }
          }

          // 解析站点激活配置（用于无令牌的线上模拟访问，及判断已激活主题是否与残留预览 Cookie 一致）
          const rawSeg = url.pathname.split("/").filter(Boolean)[0] ?? "";
          const siteRes = await fetch(
            `${apiBase}/public/site?host=${encodeURIComponent(host)}&seg=${encodeURIComponent(rawSeg)}`,
            { headers: { accept: "application/json" } },
          ).catch(() => null);
          let siteData = siteRes && siteRes.ok
            ? ((await siteRes.json().catch(() => null)) as SitePayload | null)
            : null;
          const hostnameOnly = host.split(":")[0]?.toLowerCase() ?? "";
          if (
            rawSeg &&
            (hostnameOnly === "localhost" || hostnameOnly === "127.0.0.1" || hostnameOnly === "[") &&
            siteData?.site?.mode === "shell" &&
            siteData.site.defaultHost
          ) {
            const defRes = await fetch(
              `${apiBase}/public/site?host=${encodeURIComponent(siteData.site.defaultHost)}&seg=${encodeURIComponent(rawSeg)}`,
              { headers: { accept: "application/json" } },
            ).catch(() => null);
            const defData = defRes && defRes.ok
              ? ((await defRes.json().catch(() => null)) as SitePayload | null)
              : null;
            if (defData?.site?.mode === "app") {
              siteData = defData;
            }
          }

          const viewParam = url.searchParams.get("view");
          const viewCookie = parseCookie(req.headers.cookie, "lcdp-view");
          const wantSlot: "desktop" | "mobile" =
            viewParam === "mobile" || (viewParam !== "desktop" && viewCookie === "mobile")
              ? "mobile"
              : "desktop";

          let mode: "preview" | "live" | null = null;
          let appId = "";
          let themeId = "";
          let version = "";
          let activeSlotName: "desktop" | "mobile" = wantSlot;
          let slotValues: Record<string, unknown> = {};
          let clearStaleCookie = false;

          const resolveSiteAppId = (d: SitePayload | null | undefined) =>
            d?.site?.app?.id || d?.primary?.appId || d?.apps?.[0]?.id || "";

          const siteAppId = resolveSiteAppId(siteData);
          const siteVia = siteData?.site?.via ?? null;
          if (
            validPreview &&
            siteAppId &&
            siteAppId !== validPreview.appId &&
            (siteVia === "path" || url.pathname === "/" || !!fromParam)
          ) {
            validPreview = null;
          }

          if (validPreview) {
            const liveSlots = siteData?.entry?.theme;
            const liveMatch =
              liveSlots?.[validPreview.slot as "desktop" | "mobile"] ??
              liveSlots?.desktop ??
              liveSlots?.mobile ??
              null;
            const alreadyActivated =
              !fromParam &&
              siteAppId === validPreview.appId &&
              liveMatch?.id === validPreview.themeId &&
              liveMatch?.version === validPreview.version;
            if (alreadyActivated && liveMatch) {
              mode = "live";
              appId = siteAppId;
              themeId = liveMatch.id;
              version = liveMatch.version;
              activeSlotName = validPreview.slot === "mobile" && liveSlots?.mobile ? "mobile" : "desktop";
              slotValues = (liveMatch.values && typeof liveMatch.values === "object" ? liveMatch.values : {}) as Record<string, unknown>;
              clearStaleCookie = true;
            } else {
              mode = "preview";
              appId = validPreview.appId;
              themeId = validPreview.themeId;
              version = validPreview.version;
            }
          } else if (siteData) {
            const liveSlots = siteData.entry?.theme;
            const chosenName: "desktop" | "mobile" =
              wantSlot === "mobile"
                ? (liveSlots?.mobile ? "mobile" : "desktop")
                : (liveSlots?.desktop ? "desktop" : "mobile");
            const ptr = liveSlots?.[chosenName] ?? null;
            if (siteAppId && ptr?.id && ptr?.version) {
              mode = "live";
              appId = siteAppId;
              themeId = ptr.id;
              version = ptr.version;
              activeSlotName = chosenName;
              slotValues = (ptr.values && typeof ptr.values === "object" ? ptr.values : {}) as Record<string, unknown>;
            }
          }

          if (!mode || !appId || !themeId || !version) {
            return next();
          }

          const prefix = `/${appId}`;
          let relPath = url.pathname;
          if (relPath === prefix || relPath.startsWith(`${prefix}/`)) {
            relPath = relPath.slice(prefix.length) || "/";
          }
          const cleanRel = relPath.replace(/^\/+/, "");

          const bridgeRoutes = new Set([
            "/cart",
            "/checkout",
            "/shop/order",
            "/my-orders",
            "/my-orders/detail",
            "/account",
            "/account/memories",
            "/my-topics",
            "/my-topics/detail",
          ]);
          const isBridgeRoutePath = (r: string) => {
            const norm = r.replace(/\/+$/, "") || "/";
            return bridgeRoutes.has(norm) || norm.startsWith("/sso/") || norm.startsWith("/pay/");
          };
          const hasPublicPageRoutes = (routes: string[]) =>
            routes.some((r) => !isBridgeRoutePath(r));

          const fetchAsset = async (assetPath: string) => {
            const endpoint =
              mode === "preview"
                ? `${apiBase}/public/theme-preview/asset?token=${encodeURIComponent(token!)}&path=${encodeURIComponent(assetPath)}`
                : `${apiBase}/public/theme/asset?appId=${encodeURIComponent(appId)}&slot=${encodeURIComponent(activeSlotName)}&path=${encodeURIComponent(assetPath)}`;
            const aRes = await fetch(endpoint).catch(() => null);
            return aRes && aRes.ok ? aRes : null;
          };

          let targetRes = null as Awaited<ReturnType<typeof fetchAsset>>;
          let servedPath = cleanRel || "index.html";

          if (!cleanRel || cleanRel === "index.html") {
            const mRes = await fetchAsset("theme.json");
            const manifest = mRes
              ? ((await mRes.json().catch(() => null)) as {
                  builtin?: boolean;
                  routes?: string[];
                } | null)
              : null;
            const routes = Array.isArray(manifest?.routes) ? manifest!.routes : [];
            if (manifest?.builtin === true && !hasPublicPageRoutes(routes)) {
              return next();
            }
            servedPath = "index.html";
            targetRes = await fetchAsset("index.html");
          } else if (cleanRel.includes(".")) {
            servedPath = cleanRel;
            targetRes = await fetchAsset(cleanRel);
            if (!targetRes && cleanRel.includes("/")) {
              // 嵌套路由（如 /articles/detail、/account/memories）引用相对路径 theme/css/pages.css 时，
              // 浏览器会请求 /<appId>/articles/theme/css/pages.css；按路径尾段回落到主题根目录资产。
              const parts = cleanRel.split("/").filter(Boolean);
              for (let i = 1; i < parts.length; i++) {
                const candidate = parts.slice(i).join("/");
                const fallbackRes = await fetchAsset(candidate);
                if (fallbackRes) {
                  servedPath = candidate;
                  targetRes = fallbackRes;
                  break;
                }
              }
            }
          } else {
            const mRes = await fetchAsset("theme.json");
            const manifest = mRes
              ? ((await mRes.json().catch(() => null)) as {
                  builtin?: boolean;
                  config?: Array<{ key?: string; default?: string }>;
                  routes?: string[];
                  patterns?: Record<string, string[]>;
                } | null)
              : null;
            const routes = Array.isArray(manifest?.routes) ? manifest!.routes : [];
            const normRoute = "/" + cleanRel;

            if (manifest?.builtin === true && routes.length === 0) {
              return next();
            }
            if (routes.length > 0 && normRoute !== "/" && !routes.some((r) => r.replace(/\/+$/, "") === normRoute)) {
              return next();
            }

            const dashRel = cleanRel.replace(/\//g, "-");
            const exactHtml = await fetchAsset(`${cleanRel}.html`);
            if (exactHtml) {
              targetRes = exactHtml;
              servedPath = `${cleanRel}.html`;
            } else if (dashRel !== cleanRel) {
              const dashHtml = await fetchAsset(`${dashRel}.html`);
              if (dashHtml) {
                targetRes = dashHtml;
                servedPath = `${dashRel}.html`;
              }
            }
            if (!targetRes) {
              const patMap = manifest?.patterns ?? {};
              const modes =
                patMap[normRoute] ??
                patMap[cleanRel] ??
                (normRoute === "/articles" || normRoute === "/news" ? patMap.list : undefined) ??
                (normRoute.includes("detail") ? patMap.detail : undefined);
              if (Array.isArray(modes)) {
                if (modes.some((m) => m === "D1" || m === "D1-meta")) {
                  targetRes = await fetchAsset("detail.html");
                  if (targetRes) servedPath = "detail.html";
                } else if (modes.some((m) => m === "L1" || m === "L1-tail")) {
                  targetRes = await fetchAsset("list.html");
                  if (targetRes) servedPath = "list.html";
                }
              }
              if (!targetRes && isBridgeRoutePath(normRoute)) {
                const isMulti =
                  !!(await fetchAsset("list.html")) ||
                  !!(await fetchAsset("detail.html")) ||
                  !!(await fetchAsset("about.html"));
                if (isMulti) return next();
              }
              if (!targetRes && (routes.length === 0 || routes.some((r) => r.replace(/\/+$/, "") === normRoute))) {
                servedPath = "index.html";
                targetRes = await fetchAsset("index.html");
              }
            }
          }

          if (!targetRes) return next();

          const contentType = targetRes.headers.get("content-type") || "application/octet-stream";
          const buf = Buffer.from(await targetRes.arrayBuffer());

          res.statusCode = 200;
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Lcdp-Theme", `${themeId}@${version}`);
          if (mode === "preview") {
            res.setHeader("X-Lcdp-Theme-Preview", `${themeId}@${version}`);
            if (fromParam && token) {
              res.setHeader("Set-Cookie", `lcdp_preview=${encodeURIComponent(token)}; Path=/; SameSite=Lax`);
            }
          } else if (clearStaleCookie) {
            res.setHeader("Set-Cookie", "lcdp_preview=; Path=/; Max-Age=0; SameSite=Lax");
          }

          if (req.method === "HEAD") {
            res.end();
            return;
          }

          if (contentType.includes("text/html") && servedPath.toLowerCase().endsWith(".html")) {
            let html = buf.toString("utf8");
            const payload = {
              host,
              entryId: siteData?.entry?.id ?? appId,
              entryName: siteData?.entry?.name ?? appId,
              appId,
              themeId,
              version,
              config: slotValues,
              apiBase,
              ...(siteData?.memberSso ? { memberSso: siteData.memberSso } : {}),
              ...(mode === "preview" ? { preview: true } : {}),
            };
            const json = JSON.stringify(payload)
              .replace(/</g, "\\u003c")
              .replace(/>/g, "\\u003e")
              .replace(/&/g, "\\u0026");
            const appPrefix =
              url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) ? prefix : "";
            if (appPrefix) {
              html = html.replace(
                /(\b(?:href|src)=["'])(?:\.\/)?(theme|assets)\//gi,
                `$1${appPrefix}/$2/`,
              );
            }
            const ctxScript = `<script>window.__LCDP__=${json};${PATH_FIX_SCRIPT}</script><script defer src="${escapeAttr(appPrefix)}/__lcdp__/shell/v1/lcdp-member.js"></script>`;
            if (/<head[^>]*>/i.test(html)) {
              html = html.replace(/<head[^>]*>/i, (m) => m + ctxScript);
            } else {
              html = ctxScript + html;
            }
            if (mode === "preview") {
              const badge = `<div style="position:fixed;left:12px;bottom:12px;z-index:2147483647;background:rgba(17,24,39,.92);color:#f9fafb;font:13px/1.5 -apple-system,'Segoe UI',sans-serif;padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.35)">预览效果 · 未生效 <a href="?lcdp_preview=off" style="color:#93c5fd;margin-left:8px">退出预览</a></div>`;
              if (/<\/body>/i.test(html)) {
                html = html.replace(/<\/body>/i, (m) => badge + m);
              } else {
                html += badge;
              }
            }
            res.end(html);
            return;
          }

          res.end(buf);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localThemePlugin()],
  server: { host: "::", port: 5174, allowedHosts: true },
});
