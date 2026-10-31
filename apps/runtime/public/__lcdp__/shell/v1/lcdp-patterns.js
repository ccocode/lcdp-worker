/**
 * LCDP 模式行为共享脚本 v1（L1 列表分页 + H1 轮播公告）。
 *
 * 定位：行为归平台，样式归主题，数据归设计。本脚本只管行为状态机：
 * - 不写颜色、字号、间距、圆角（全部由主题 CSS 与令牌定）；
 * - 不自造数据源：分页取数走页面既有公开数据通道；
 * - 不改卡片长相：追加卡片经主题提供的模板槽渲染。
 *
 * 挂接契约（主题生成时按此写标记，机械门验钩子与模板槽存在）：
 * - 脚本引用：index.html 里放共享脚本加载器（按 __LCDP__.appId 算应用
 *   路径前缀，见 theme_create 第 ⑪ 条），脚本加载失败时页面静态内容
 *   不受影响（fail-open）。
 * - L1 容器：<section data-pattern="L1" data-lcdp-entity="<实体key>"
 *   data-lcdp-page-size="10" data-lcdp-vf="<可选>" data-lcdp-sort="<可选>">
 *   内含：[data-lcdp-refresh] 刷新入口（按钮，点按触发刷新）；
 *   [data-lcdp-list] 卡片容器（缺省时新卡片插在列表尾之前）；
 *   [data-pattern="L1-tail"] 列表尾（含 [data-lcdp-load-more] 加载更多按钮）；
 *   <template data-lcdp-card-template> 卡片模板（{{字段名}} 占位，脚本填数据；
 *   卡片须带跳转链接时，模板内 href 同样写 {{id}} 等占位）；
 *   [data-lcdp-empty] 空态区（可选，缺省时脚本插默认空态文案）。
 *   首屏条数默认 10，网格类由主题在 data-lcdp-page-size 写行满取整数。
 * - H1 容器：<div data-pattern="H1"> 内含轮播 [data-lcdp-slide]（若干张，
 *   1 张时退化静态）、[data-lcdp-dots] 内 [data-lcdp-dot]、[data-lcdp-prev] /
 *   [data-lcdp-next]；公告 [data-lcdp-announcement] 内
 *   [data-lcdp-announcement-track] 包 [data-lcdp-announcement-item]（须为 <a>）。
 *   无轮播数据时主题不渲染本区；无公告数据时主题不渲染公告行（脚本对
 *   空公告容器同样隐藏，作双重兜底）。
 * - 可见性：脚本只用 hidden 属性与 is-active 类切换显示（语义层），
 *   不写颜色字号；唯一例外是公告滚动的 translateX（动画机制本身，
 *   非视觉样式）。主题 CSS 须定义：.lcdp-slide 与 .is-active 的显隐、
 *   .lcdp-l1-end / .lcdp-l1-error / .lcdp-l1-retry / .lcdp-l1-empty /
 *   .lcdp-l1-loading 的样式、可点区域不小于 44px。
 * - 数据通道：window.__LCDP__ 的 appId 与 apiBase；
 *   GET {apiBase}/public/apps/{appId}/data/{entity}?limit=&offset=[&vf=][&sort=]，
 *   响应 { rows: [], total: number }；total 缺省时以“回行数 < 页大小”判到底。
 * - 重挂载：脚本加载时挂接一次，之后以 MutationObserver 补挂新出现的
 *   容器；window.lcdpPatterns.mount() 可供主题/内置脚本在动态渲染后调用。
 *   已挂接容器带 data-lcdp-mounted 标记，重复挂接是空操作。
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var VERSION = "v1";
  var ANNOUNCE_SPEED_PX_PER_SEC = 60;
  var PULL_REFRESH_PX = 80;
  var AUTOPLAY_MS = 5000;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ctx() {
    try {
      var c = window.__LCDP__ || {};
      return {
        appId: typeof c.appId === "string" ? c.appId : "",
        apiBase:
          typeof c.apiBase === "string"
            ? c.apiBase.replace(/\/$/, "")
            : "",
      };
    } catch (e) {
      return { appId: "", apiBase: "" };
    }
  }

  function fillTemplate(tpl, row) {
    var html = tpl.innerHTML;
    return html.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (m, k) {
      var v = row[k];
      if (v == null || typeof v === "object") return "";
      return esc(v);
    });
  }

  function firstElFromHtml(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  }

  /* ---------------- L1：列表分页 ---------------- */

  function mountL1(container) {
    if (container.getAttribute("data-lcdp-mounted") === "L1") return;
    var entity = container.getAttribute("data-lcdp-entity") || "";
    if (!entity) return; // 无实体 = 无数据通道，脚本不接管
    container.setAttribute("data-lcdp-mounted", "L1");

    var c = ctx();
    var pageSize =
      parseInt(container.getAttribute("data-lcdp-page-size") || "10", 10) ||
      10;
    var vf = container.getAttribute("data-lcdp-vf") || "";
    var sort = container.getAttribute("data-lcdp-sort") || "";
    var listEl =
      container.querySelector("[data-lcdp-list]") || null;
    var tailEl =
      container.querySelector('[data-pattern="L1-tail"]') || null;
    var loadBtn =
      container.querySelector("[data-lcdp-load-more]") || null;
    var refreshEl =
      container.querySelector("[data-lcdp-refresh]") || null;
    var tpl = container.querySelector("template[data-lcdp-card-template]");
    var emptyEl = container.querySelector("[data-lcdp-empty]") || null;

    var state = {
      offset: 0,
      total: null,
      loading: false,
      ended: false,
      failed: false,
      failedMode: "initial",
      seen: {},
      hasLoaded: false,
    };

    var endEl = null;
    var errBox = null;
    var errBtn = null;
    if (tailEl) {
      endEl = tailEl.querySelector("[data-lcdp-end]");
      if (!endEl) {
        endEl = document.createElement("p");
        endEl.className = "lcdp-l1-end";
        endEl.textContent = "没有更多了";
        endEl.hidden = true;
        tailEl.appendChild(endEl);
      }
      errBox = tailEl.querySelector("[data-lcdp-error]");
      if (!errBox) {
        errBox = document.createElement("div");
        errBox.className = "lcdp-l1-error";
        errBox.hidden = true;
        errBtn = document.createElement("button");
        errBtn.type = "button";
        errBtn.className = "lcdp-l1-retry";
        errBtn.textContent = "加载失败，重试";
        errBox.appendChild(errBtn);
        tailEl.appendChild(errBox);
      } else {
        errBtn =
          errBox.querySelector("[data-lcdp-retry]") ||
          errBox.querySelector("button");
      }
    }
    if (errBtn) {
      errBtn.addEventListener("click", function () {
        if (state.failedMode === "more") loadMore();
        else loadInitial();
      });
    }

    function setLoading(on) {
      state.loading = on;
      if (loadBtn) {
        loadBtn.disabled = !!on;
        if (on) {
          if (!loadBtn.getAttribute("data-lcdp-orig-text")) {
            loadBtn.setAttribute(
              "data-lcdp-orig-text",
              loadBtn.textContent || "",
            );
          }
          loadBtn.textContent = "正在加载…";
        } else if (loadBtn.getAttribute("data-lcdp-orig-text") != null) {
          loadBtn.textContent =
            loadBtn.getAttribute("data-lcdp-orig-text");
        }
      }
    }

    function showEnd() {
      state.ended = true;
      if (loadBtn) loadBtn.hidden = true;
      if (endEl) endEl.hidden = false;
      if (errBox) errBox.hidden = true;
    }

    function showList() {
      if (loadBtn) loadBtn.hidden = false;
      if (endEl) endEl.hidden = true;
      if (errBox) errBox.hidden = true;
      if (emptyEl) emptyEl.hidden = true;
    }

    function showEmpty() {
      state.ended = true;
      if (loadBtn) loadBtn.hidden = true;
      if (endEl) endEl.hidden = true;
      if (errBox) errBox.hidden = true;
      if (emptyEl) {
        emptyEl.hidden = false;
      } else if (listEl) {
        var p = document.createElement("p");
        p.className = "lcdp-l1-empty";
        p.textContent = "暂无内容";
        listEl.appendChild(p);
      }
    }

    function showError(mode) {
      state.failed = true;
      state.failedMode = mode;
      setLoading(false);
      if (loadBtn) loadBtn.hidden = true;
      if (endEl) endEl.hidden = true;
      if (errBox) errBox.hidden = false;
    }

    function insertRows(rows, append) {
      var target = listEl;
      var before = null;
      if (!target) {
        target = container;
        before = tailEl;
      }
      if (!append && target) {
        // 首屏/刷新：清掉旧卡片（模板内容不在 DOM 查询范围内，不受影响）
        var old = target.querySelectorAll("[data-lcdp-card]");
        for (var i = 0; i < old.length; i++) old[i].remove();
        var staleEmpty = target.querySelector(".lcdp-l1-empty");
        if (staleEmpty) staleEmpty.remove();
      }
      var added = 0;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r] || {};
        var id = row.id != null ? String(row.id) : "";
        if (id && state.seen[id]) continue;
        if (id) state.seen[id] = true;
        if (!tpl) continue;
        var el = firstElFromHtml(fillTemplate(tpl, row));
        if (!el) continue;
        el.setAttribute("data-lcdp-card", "");
        if (id) el.setAttribute("data-lcdp-id", id);
        if (before) target.insertBefore(el, before);
        else target.appendChild(el);
        added++;
      }
      return added;
    }

    function fetchPage(offset) {
      if (!c.appId || !c.apiBase) {
        return Promise.reject(new Error("missing context"));
      }
      var q =
        c.apiBase +
        "/public/apps/" +
        encodeURIComponent(c.appId) +
        "/data/" +
        encodeURIComponent(entity) +
        "?limit=" +
        pageSize +
        "&offset=" +
        offset;
      if (vf) q += "&vf=" + encodeURIComponent(vf);
      if (sort) q += "&sort=" + encodeURIComponent(sort);
      return fetch(q).then(function (res) {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      });
    }

    function applyResult(res, mode) {
      var rows = (res && res.rows) || [];
      var total =
        res && typeof res.total === "number" ? res.total : null;
      state.total = total;
      state.failed = false;
      if (mode === "initial") {
        state.offset = 0;
        state.seen = {};
        insertRows(rows, false);
        state.offset = rows.length;
        state.hasLoaded = true;
        if (rows.length === 0) {
          showEmpty();
          return;
        }
      } else {
        insertRows(rows, true);
        state.offset += rows.length;
      }
      var reachedEnd =
        (total != null && state.offset >= total) ||
        rows.length < pageSize;
      if (reachedEnd) showEnd();
      else showList();
    }

    function loadInitial() {
      if (state.loading) return;
      setLoading(true);
      state.ended = false;
      if (errBox) errBox.hidden = true;
      fetchPage(0)
        .then(function (res) {
          setLoading(false);
          applyResult(res, "initial");
        })
        .catch(function () {
          showError("initial");
        });
    }

    function loadMore() {
      if (state.loading || state.ended) return;
      setLoading(true);
      if (errBox) errBox.hidden = true;
      fetchPage(state.offset)
        .then(function (res) {
          setLoading(false);
          applyResult(res, "more");
        })
        .catch(function () {
          showError("more");
        });
    }

    function refresh() {
      loadInitial();
      try {
        var top =
          container.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, top);
      } catch (e) {}
    }

    if (refreshEl) refreshEl.addEventListener("click", refresh);
    if (loadBtn) loadBtn.addEventListener("click", loadMore);

    // 上拉自动追加：尾区进入“距底小于一屏”即触发，与按钮同一逻辑
    if (tailEl && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(
        function (entries) {
          if (entries[0] && entries[0].isIntersecting) loadMore();
        },
        { rootMargin: "0px 0px 100vh 0px" },
      );
      io.observe(tailEl);
    }

    // 移动端下拉刷新：页面顶部下拉超过 80px 松手即刷新（桌面不模拟拖动）
    var touchY = null;
    var touchMax = 0;
    container.addEventListener(
      "touchstart",
      function (ev) {
        if (window.scrollY > 0) {
          touchY = null;
          return;
        }
        var t = ev.touches && ev.touches[0];
        touchY = t ? t.clientY : null;
        touchMax = 0;
      },
      { passive: true },
    );
    container.addEventListener(
      "touchmove",
      function (ev) {
        if (touchY == null) return;
        var t = ev.touches && ev.touches[0];
        if (!t) return;
        var d = t.clientY - touchY;
        if (d > touchMax) touchMax = d;
      },
      { passive: true },
    );
    container.addEventListener("touchend", function () {
      if (touchY != null && touchMax > PULL_REFRESH_PX) refresh();
      touchY = null;
    });

    loadInitial();
  }

  /* ---------------- H1：轮播 + 公告 ---------------- */

  function mountH1(container) {
    if (container.getAttribute("data-lcdp-mounted") === "H1") return;
    container.setAttribute("data-lcdp-mounted", "H1");

    // 轮播
    var slides = container.querySelectorAll("[data-lcdp-slide]");
    if (slides.length > 0) {
      var dotsWrap = container.querySelector("[data-lcdp-dots]");
      var dots = container.querySelectorAll("[data-lcdp-dot]");
      var prev = container.querySelector("[data-lcdp-prev]");
      var next = container.querySelector("[data-lcdp-next]");
      var idx = 0;
      var timer = null;

      function show(i) {
        idx = ((i % slides.length) + slides.length) % slides.length;
        for (var s = 0; s < slides.length; s++) {
          if (s === idx) slides[s].classList.add("is-active");
          else slides[s].classList.remove("is-active");
        }
        for (var d = 0; d < dots.length; d++) {
          if (d === idx) dots[d].classList.add("is-active");
          else dots[d].classList.remove("is-active");
        }
      }

      function stop() {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
      function start() {
        stop();
        if (slides.length > 1) {
          timer = setInterval(function () {
            show(idx + 1);
          }, AUTOPLAY_MS);
        }
      }

      if (slides.length === 1) {
        show(0);
        if (dotsWrap) dotsWrap.hidden = true;
        if (prev) prev.hidden = true;
        if (next) next.hidden = true;
      } else {
        show(0);
        for (var di = 0; di < dots.length; di++) {
          (function (d) {
            dots[d].addEventListener("click", function () {
              show(d);
              start();
            });
          })(di);
        }
        if (prev)
          prev.addEventListener("click", function () {
            show(idx - 1);
            start();
          });
        if (next)
          next.addEventListener("click", function () {
            show(idx + 1);
            start();
          });
        container.addEventListener("mouseenter", stop);
        container.addEventListener("mouseleave", start);
        container.addEventListener("touchstart", stop, { passive: true });
        container.addEventListener("touchend", start, { passive: true });
        start();
      }
    }

    // 公告：单行滚动，固定可读速度；单条静态；无数据整行隐藏
    var ann = container.querySelector("[data-lcdp-announcement]");
    if (ann) {
      var items = ann.querySelectorAll("[data-lcdp-announcement-item]");
      if (items.length === 0) {
        ann.hidden = true;
      } else if (items.length > 1) {
        var track = ann.querySelector("[data-lcdp-announcement-track]");
        if (track) {
          var half = 0;
          var pos = 0;
          var last = 0;
          var raf = null;
          var paused = false;
          // 复制一倍内容做无缝循环（链接与文案与原件一致）
          track.innerHTML += track.innerHTML;
          var measure = function () {
            half = track.scrollWidth / 2;
          };
          measure();
          var step = function (t) {
            if (!last) last = t;
            var dt = t - last;
            last = t;
            if (!paused && half > 0) {
              pos += (ANNOUNCE_SPEED_PX_PER_SEC * dt) / 1000;
              if (pos >= half) pos -= half;
              track.style.transform = "translateX(" + -pos + "px)";
            }
            raf = requestAnimationFrame(step);
          };
          ann.addEventListener("mouseenter", function () {
            paused = true;
          });
          ann.addEventListener("mouseleave", function () {
            paused = false;
          });
          ann.addEventListener(
            "touchstart",
            function () {
              paused = true;
            },
            { passive: true },
          );
          ann.addEventListener(
            "touchend",
            function () {
              paused = false;
            },
            { passive: true },
          );
          window.addEventListener("resize", measure);
          raf = requestAnimationFrame(step);
        }
      }
    }
  }

  /* ---------------- 挂接 ---------------- */

  function mountAll(root) {
    var scope = root || document;
    var l1s = scope.querySelectorAll
      ? scope.querySelectorAll('[data-pattern="L1"]')
      : [];
    for (var i = 0; i < l1s.length; i++) {
      try {
        mountL1(l1s[i]);
      } catch (e) {}
    }
    var h1s = scope.querySelectorAll
      ? scope.querySelectorAll('[data-pattern="H1"]')
      : [];
    for (var j = 0; j < h1s.length; j++) {
      try {
        mountH1(h1s[j]);
      } catch (e) {}
    }
  }

  var api = { version: VERSION, mount: function () {
    mountAll(document);
  } };
  try {
    window.lcdpPatterns = api;
  } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      mountAll(document);
    });
  } else {
    mountAll(document);
  }

  // 动态渲染兜底：内置主题等在设计包加载后才渲染列表/轮播时补挂
  try {
    if ("MutationObserver" in window && document.body) {
      var pending = false;
      var ob = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          mountAll(document);
        }, 0);
      });
      ob.observe(document.body, { childList: true, subtree: true });
    }
  } catch (e) {}
})();
