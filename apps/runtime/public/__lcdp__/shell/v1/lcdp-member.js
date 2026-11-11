/**
 * 平台主题通用会员运行时（/__lcdp__/shell/v1/lcdp-member.js）：
 * - 在 SSO 未启用（memberSso.enabled !== true）或本地非 HTTPS 预览下，接管
 *   [data-lcdp-login] 与页眉登录入口，弹窗直连 /member/apps/:appId/login、
 *   register、captcha、email-code，并按平台口径写回 lcdp.member.<host>；
 * - 在启用 SSO 且处于 HTTPS 站域下，沿用 <centerBase>/authorize 授权码流；
 * - 同步页眉 .member-entries 登录态展示与 [data-lcdp-logout] 退出动作。
 */
(function () {
  if (window.__LCDP_MEMBER_BOOT__) return;
  window.__LCDP_MEMBER_BOOT__ = true;

  var OVERLAY_ID = "lcdp-auth-overlay";
  var STYLE_ID = "lcdp-auth-style";
  var SHELL_STYLE_ID = "lcdp-member-shell-fallback-style";
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function getCtx() {
    return window.__LCDP__ || {};
  }

  function basePrefix() {
    var a = getCtx().appId || "";
    if (!a) return "";
    var p = window.location.pathname || "/";
    return p === "/" + a || p.indexOf("/" + a + "/") === 0 ? "/" + a : "";
  }

  function appUrl(route) {
    var b = basePrefix();
    var r = !route || route === "/" ? "/" : route.charAt(0) === "/" ? route : "/" + route;
    return b + r;
  }

  function sessionKey() {
    return "lcdp.member." + window.location.host;
  }

  function readSession() {
    var c = getCtx();
    try {
      var raw = localStorage.getItem(sessionKey());
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || typeof s.token !== "string" || !s.member) return null;
      if (c.appId && s.appId !== c.appId) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function writeSession(res) {
    var c = getCtx();
    var session = {
      token: res.token,
      member: res.member,
      policy: res.policy || null,
      appId: c.appId || "",
      roles: Array.isArray(res.roles) ? res.roles : [],
    };
    try {
      localStorage.setItem(sessionKey(), JSON.stringify(session));
    } catch (e) {}
    return session;
  }

  function clearSession() {
    try {
      localStorage.removeItem(sessionKey());
    } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function shouldUseSso() {
    var c = getCtx();
    var sso = c.memberSso;
    return Boolean(
      sso &&
        sso.enabled === true &&
        typeof sso.centerBase === "string" &&
        sso.centerBase &&
        window.location.protocol === "https:",
    );
  }

  function startSsoLogin(centerBase, returnTo) {
    var c = getCtx();
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var state = Array.prototype.map
      .call(bytes, function (b) {
        return ("0" + b.toString(16)).slice(-2);
      })
      .join("");
    try {
      sessionStorage.setItem("lcdp.sso.state", state);
      sessionStorage.setItem(
        "lcdp.sso.return",
        returnTo || window.location.pathname + window.location.search,
      );
      sessionStorage.setItem("lcdp.sso.app", c.appId || "");
    } catch (e) {}
    var qs = new URLSearchParams({
      app: c.appId || "",
      redirect_uri: window.location.origin + "/sso/callback",
      state: state,
    });
    window.location.assign(String(centerBase).replace(/\/+$/, "") + "/authorize?" + qs.toString());
  }

  function memberEndpoint(suffix) {
    var c = getCtx();
    var apiBase = String(c.apiBase || "").replace(/\/+$/, "");
    var appId = encodeURIComponent(c.appId || "");
    var p = suffix.charAt(0) === "/" ? suffix : "/" + suffix;
    return apiBase + "/member/apps/" + appId + p;
  }

  function postJson(suffix, body) {
    return fetch(memberEndpoint(suffix), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (d) {
          if (!r.ok) {
            var err = new Error((d && d.message) || "请求失败（" + r.status + "）");
            err.status = r.status;
            err.code = d && d.error;
            throw err;
          }
          return d;
        });
    });
  }

  function syncMemberEntries() {
    var s = readSession();
    var els = document.querySelectorAll(".member-entries");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.hasAttribute("data-lcdp-guest-html")) {
        el.setAttribute("data-lcdp-guest-html", el.innerHTML);
      }
      if (s && s.member) {
        var name = s.member.displayName || s.member.identifier || "会员";
        var active =
          window.location.pathname.indexOf("/account") >= 0 ? " active" : "";
        el.innerHTML =
          '<a class="member-link' +
          active +
          '" href="' +
          esc(appUrl("/account")) +
          '">' +
          esc(name) +
          "</a>" +
          '<button type="button" class="btn btn-outline btn-sm" data-lcdp-logout>退出登录</button>';
      } else {
        el.innerHTML = el.getAttribute("data-lcdp-guest-html") || el.innerHTML;
      }
    }
  }

  function upgradeStalePromptIfLoggedIn() {
    var s = readSession();
    if (!s || !s.member) return;
    var shell = document.getElementById("account-shell");
    if (!shell || !shell.querySelector(".member-prompt-card")) return;
    var name = s.member.displayName || s.member.identifier || "会员";
    var who = shell.querySelector(".member-who");
    if (who) {
      who.innerHTML =
        '<div class="member-avatar">' +
        esc(name.slice(0, 1) || "会") +
        "</div><div><div class=\"member-name\">" +
        esc(name) +
        '</div><div class="member-id">' +
        esc(s.member.identifier || "") +
        "</div></div>";
    }
    var nav = shell.querySelector(".member-nav");
    if (nav && !nav.querySelector("[data-lcdp-logout]")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "member-nav-item member-nav-btn";
      btn.setAttribute("data-lcdp-logout", "");
      btn.textContent = "退出登录";
      nav.appendChild(btn);
    }
    var main = shell.querySelector(".member-main");
    if (main) {
      main.innerHTML =
        '<h1 class="member-title">会员中心概览</h1>' +
        '<div class="member-card"><h3 class="member-card-title">您好，' +
        esc(name) +
        "</h3>" +
        '<p class="member-card-text">这里汇总您的会员信息与快捷入口。您可以前往「我的记忆」查看与平台同步的记录。</p>' +
        '<div class="member-card-links"><a class="btn btn-outline" href="' +
        esc(appUrl("/account/memories")) +
        '">前往我的记忆</a></div></div>';
    }
  }

  function doLogout() {
    clearSession();
    if (shouldUseSso()) {
      window.location.assign(
        String(getCtx().memberSso.centerBase).replace(/\/+$/, "") +
          "/logout?redirect_uri=" +
          encodeURIComponent(window.location.origin + appUrl("/")),
      );
      return;
    }
    syncMemberEntries();
    try {
      window.dispatchEvent(new CustomEvent("lcdp:member-changed", { detail: null }));
    } catch (e) {}
    if (
      document.getElementById("account-shell") ||
      window.location.pathname.indexOf("/account") >= 0
    ) {
      window.location.reload();
    }
  }

  function ensureMemberShellStyle() {
    if (document.getElementById(SHELL_STYLE_ID)) return;
    if (!document.getElementById("account-shell") && !document.querySelector(".member-layout") && !document.querySelector(".member-shell")) return;
    var s = document.createElement("style");
    s.id = SHELL_STYLE_ID;
    s.textContent = [
      ":where(#account-shell,.member-shell){max-width:1120px;margin:24px auto;padding:0 20px;}",
      ":where(.crumb){font-size:13px;color:var(--bt-sub,#64748b);margin:0 0 18px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;}",
      ":where(.crumb a){color:var(--bt-primary,#0f2c52);text-decoration:none;}",
      ":where(.crumb a:hover){text-decoration:underline;}",
      ":where(.member-layout){display:flex;gap:24px;align-items:flex-start;}",
      ":where(.member-side){width:240px;flex-shrink:0;background:var(--bt-surface,#fff);border:1px solid var(--bt-border,#dde3ec);border-radius:var(--bt-radius,10px);padding:18px;}",
      ":where(.member-who){display:flex;gap:12px;align-items:center;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid var(--bt-border,#dde3ec);}",
      ":where(.member-avatar){width:40px;height:40px;border-radius:50%;background:var(--bt-primary,#0f2c52);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;}",
      ":where(.member-name){font-weight:700;color:var(--bt-text,#16202e);font-size:15px;}",
      ":where(.member-id){font-size:12px;color:var(--bt-sub,#64748b);word-break:break-all;}",
      ":where(.member-nav){display:flex;flex-direction:column;gap:6px;}",
      ":where(.member-nav-item){display:block;padding:8px 12px;border-radius:8px;color:var(--bt-text,#16202e);text-decoration:none;font-size:14px;background:none;border:0;text-align:left;cursor:pointer;font-family:inherit;}",
      ":where(.member-nav-item:hover){background:rgba(15,44,82,.06);color:var(--bt-primary,#0f2c52);}",
      ":where(.member-nav-item.active){background:var(--bt-primary,#0f2c52);color:#fff;font-weight:600;}",
      ":where(.member-main){flex:1;min-width:0;background:var(--bt-surface,#fff);border:1px solid var(--bt-border,#dde3ec);border-radius:var(--bt-radius,10px);padding:24px;}",
      ":where(.member-title,.member-prompt-card h1,.member-prompt-card h2){margin:0 0 12px;font-size:22px;color:var(--bt-text,#16202e);}",
      ":where(.member-card,.member-prompt-card,.bt-card){border:1px solid var(--bt-border,#dde3ec);border-radius:var(--bt-radius,10px);padding:18px;background:var(--bt-surface,#fff);margin-bottom:14px;}",
      ":where(.bt-btn,[data-lcdp-login].btn){display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border-radius:8px;background:var(--bt-primary,#0f2c52);color:#fff;border:0;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;}",
      ":where(.bt-note){color:var(--bt-sub,#64748b);font-size:14px;}",
      ":where(.bt-error){color:#b91c1c;font-size:14px;}",
      "@media(max-width:768px){:where(.member-layout){flex-direction:column;}:where(.member-side){width:100%;}}",
    ].join("");
    document.head.appendChild(s);
  }

  function ensureModalStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#lcdp-auth-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;}",
      "#lcdp-auth-overlay *{box-sizing:border-box;}",
      ".lcdp-auth-dialog{width:420px;max-width:100%;background:var(--bt-surface,#fff);color:var(--bt-text,#1f2937);border:1px solid var(--bt-border,#e3e8ef);border-radius:var(--bt-radius,10px);box-shadow:0 20px 50px rgba(15,23,42,.25);padding:24px;position:relative;}",
      ".lcdp-auth-close{position:absolute;top:14px;right:14px;width:32px;height:32px;border:none;background:transparent;color:var(--bt-sub,#6b7280);font-size:20px;line-height:1;cursor:pointer;border-radius:6px;}",
      ".lcdp-auth-close:hover{background:#f1f5f9;color:var(--bt-text,#1f2937);}",
      ".lcdp-auth-title{margin:0 0 14px;font-size:18px;font-weight:700;color:var(--bt-primary,#0f2d5c);}",
      ".lcdp-auth-tabs{display:flex;gap:8px;border-bottom:1px solid var(--bt-border,#e3e8ef);margin-bottom:16px;}",
      ".lcdp-auth-tab{background:none;border:none;padding:8px 14px;font-size:14px;font-weight:600;color:var(--bt-sub,#6b7280);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}",
      ".lcdp-auth-tab.active{color:var(--bt-primary,#0f2d5c);border-bottom-color:var(--bt-primary,#0f2d5c);}",
      ".lcdp-auth-alert{display:none;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:12px;line-height:1.5;}",
      ".lcdp-auth-alert.err{display:block;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;}",
      ".lcdp-auth-alert.info{display:block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;}",
      ".lcdp-auth-field{margin-bottom:12px;}",
      ".lcdp-auth-field label{display:block;font-size:13px;font-weight:600;color:var(--bt-text,#1f2937);margin-bottom:5px;}",
      ".lcdp-auth-field input{width:100%;height:38px;padding:0 12px;border:1px solid var(--bt-border,#d1d5db);border-radius:8px;font-size:14px;color:var(--bt-text,#1f2937);background:#fff;outline:none;}",
      ".lcdp-auth-field input:focus{border-color:var(--bt-accent,#2f6fed);box-shadow:0 0 0 3px rgba(47,111,237,.15);}",
      ".lcdp-auth-cap-row{display:flex;gap:10px;align-items:center;}",
      ".lcdp-auth-cap-img{height:38px;min-width:104px;border:1px solid var(--bt-border,#e3e8ef);border-radius:6px;cursor:pointer;background:#f4f6f8;display:block;}",
      ".lcdp-auth-email-row{display:flex;gap:8px;align-items:center;}",
      ".lcdp-auth-mini-btn{height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--bt-border,#d1d5db);background:#f8fafc;color:var(--bt-text,#1f2937);font-size:13px;cursor:pointer;white-space:nowrap;}",
      ".lcdp-auth-mini-btn:disabled{opacity:.6;cursor:not-allowed;}",
      ".lcdp-auth-submit{width:100%;height:40px;border:none;border-radius:8px;background:var(--bt-primary,#0f2d5c);color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-top:4px;}",
      ".lcdp-auth-submit:hover{opacity:.92;}",
      ".lcdp-auth-submit:disabled{opacity:.6;cursor:not-allowed;}",
      ".lcdp-auth-foot{margin-top:12px;text-align:center;font-size:13px;color:var(--bt-sub,#6b7280);}",
      ".lcdp-auth-link{background:none;border:none;color:var(--bt-accent,#2f6fed);font-size:13px;cursor:pointer;padding:0 4px;text-decoration:underline;}",
    ].join("");
    document.head.appendChild(style);
  }

  function closeModal() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function finishAuthed(res) {
    var s = writeSession(res);
    closeModal();
    syncMemberEntries();
    try {
      window.dispatchEvent(new CustomEvent("lcdp:member-changed", { detail: s }));
    } catch (e) {}
    if (
      document.getElementById("account-shell") ||
      window.location.pathname.indexOf("/account") >= 0
    ) {
      window.location.reload();
    }
  }

  function openAuthModal(initialTab) {
    var c = getCtx();
    if (shouldUseSso()) {
      startSsoLogin(
        c.memberSso.centerBase,
        window.location.pathname + window.location.search,
      );
      return;
    }
    ensureModalStyle();
    closeModal();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = [
      '<div class="lcdp-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="lcdp-auth-heading">',
      '  <button type="button" class="lcdp-auth-close" aria-label="关闭">&times;</button>',
      '  <h2 class="lcdp-auth-title" id="lcdp-auth-heading">' + esc(c.entryName || "会员账号") + "</h2>",
      '  <div class="lcdp-auth-tabs">',
      '    <button type="button" class="lcdp-auth-tab" data-tab="login">会员登录</button>',
      '    <button type="button" class="lcdp-auth-tab" data-tab="register">注册账号</button>',
      "  </div>",
      '  <div class="lcdp-auth-alert" data-auth-alert></div>',
      '  <form data-auth-form="login">',
      '    <div class="lcdp-auth-field"><label>账号标识（手机号 / 邮箱 / 用户名）</label><input name="identifier" required autocomplete="username" placeholder="请输入账号标识"></div>',
      '    <div class="lcdp-auth-field"><label>密码</label><input name="password" type="password" required autocomplete="current-password" placeholder="请输入密码"></div>',
      '    <div class="lcdp-auth-field" data-login-cap-wrap style="display:none"><label>图形验证码（点击图片可刷新）</label><div class="lcdp-auth-cap-row"><input name="captchaCode" autocomplete="off" placeholder="4 位验证码"><img class="lcdp-auth-cap-img" data-cap-img="login" alt="图形验证码" title="点击刷新验证码"></div></div>',
      '    <button type="submit" class="lcdp-auth-submit" data-submit-btn>登 录</button>',
      '    <div class="lcdp-auth-foot">还没有账号？<button type="button" class="lcdp-auth-link" data-switch="register">立即注册</button></div>',
      "  </form>",
      '  <form data-auth-form="register" style="display:none">',
      '    <div class="lcdp-auth-field"><label>账号标识（手机号 / 邮箱 / 用户名）</label><input name="identifier" required autocomplete="username" placeholder="用于登录的手机号、邮箱或用户名"></div>',
      '    <div class="lcdp-auth-field"><label>显示名称（选填）</label><input name="displayName" autocomplete="nickname" placeholder="不填则默认与账号标识一致"></div>',
      '    <div class="lcdp-auth-field"><label>密码（至少 8 位）</label><input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="请设置不少于 8 位的密码"></div>',
      '    <div class="lcdp-auth-field"><label>图形验证码（点击图片可刷新）</label><div class="lcdp-auth-cap-row"><input name="captchaCode" required autocomplete="off" placeholder="请输入右侧验证码"><img class="lcdp-auth-cap-img" data-cap-img="register" alt="图形验证码" title="点击刷新验证码"></div></div>',
      '    <div class="lcdp-auth-field" data-reg-email-row style="display:none"><label>邮箱验证码（如站点已开启邮箱验证则必填）</label><div class="lcdp-auth-email-row"><input name="emailCode" autocomplete="one-time-code" placeholder="邮箱收到的验证码"><button type="button" class="lcdp-auth-mini-btn" data-send-email-code>获取验证码</button></div></div>',
      '    <button type="submit" class="lcdp-auth-submit" data-submit-btn>注册并登录</button>',
      '    <div class="lcdp-auth-foot">已有账号？<button type="button" class="lcdp-auth-link" data-switch="login">返回登录</button></div>',
      "  </form>",
      "</div>",
    ].join("");
    document.body.appendChild(overlay);

    var alertEl = overlay.querySelector("[data-auth-alert]");
    var loginForm = overlay.querySelector('[data-auth-form="login"]');
    var regForm = overlay.querySelector('[data-auth-form="register"]');
    var loginCapWrap = overlay.querySelector("[data-login-cap-wrap]");
    var regEmailRow = overlay.querySelector("[data-reg-email-row]");
    var sendEmailBtn = overlay.querySelector("[data-send-email-code]");
    var capState = { loginId: "", registerId: "", loginRequired: false, emailCooldown: 0 };

    function setAlert(kind, msg) {
      if (!msg) {
        alertEl.className = "lcdp-auth-alert";
        alertEl.textContent = "";
        return;
      }
      alertEl.className = "lcdp-auth-alert " + (kind === "info" ? "info" : "err");
      alertEl.textContent = msg;
    }

    function loadCaptcha(which) {
      if (!c.apiBase || !c.appId) return Promise.resolve();
      return postJson("/captcha", {})
        .then(function (d) {
          var img = overlay.querySelector('[data-cap-img="' + which + '"]');
          if (which === "login") capState.loginId = d.captchaId || "";
          else capState.registerId = d.captchaId || "";
          if (img && d.svg) {
            img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(d.svg);
          }
        })
        .catch(function (err) {
          setAlert("err", "验证码加载失败：" + (err && err.message ? err.message : "请重试"));
        });
    }

    function setTab(tab) {
      var isReg = tab === "register";
      setAlert("", "");
      var tabs = overlay.querySelectorAll("[data-tab]");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === tab);
      }
      loginForm.style.display = isReg ? "none" : "block";
      regForm.style.display = isReg ? "block" : "none";
      if (isReg && !capState.registerId) loadCaptcha("register");
    }

    if (!c.apiBase || !c.appId) {
      setAlert("err", "当前页面缺少站点应用上下文，无法发起登录。");
    }

    overlay.querySelector(".lcdp-auth-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) closeModal();
    });
    var tabBtns = overlay.querySelectorAll("[data-tab], [data-switch]");
    for (var i = 0; i < tabBtns.length; i++) {
      tabBtns[i].addEventListener("click", function (ev) {
        setTab(ev.currentTarget.getAttribute("data-tab") || ev.currentTarget.getAttribute("data-switch"));
      });
    }
    overlay.querySelector('[data-cap-img="login"]').addEventListener("click", function () {
      loadCaptcha("login");
    });
    overlay.querySelector('[data-cap-img="register"]').addEventListener("click", function () {
      loadCaptcha("register");
    });

    regForm.identifier.addEventListener("input", function () {
      var val = regForm.identifier.value.trim();
      regEmailRow.style.display = EMAIL_RE.test(val) ? "block" : "none";
    });

    sendEmailBtn.addEventListener("click", function () {
      var email = regForm.identifier.value.trim();
      var capCode = regForm.captchaCode.value.trim();
      if (!EMAIL_RE.test(email)) {
        setAlert("err", "请先填写有效邮箱再获取邮箱验证码");
        return;
      }
      if (!capState.registerId || !capCode) {
        setAlert("err", "请先输入图形验证码，再获取邮箱验证码");
        return;
      }
      sendEmailBtn.disabled = true;
      setAlert("", "");
      postJson("/email-code", {
        email: email,
        captchaId: capState.registerId,
        captchaCode: capCode,
      })
        .then(function () {
          setAlert("info", "邮箱验证码已发送，请查收邮箱；下方图形验证码已更新，请填写新图形码完成注册");
          regForm.captchaCode.value = "";
          loadCaptcha("register");
          var sec = 60;
          sendEmailBtn.textContent = sec + "s 后重发";
          var tm = setInterval(function () {
            sec--;
            if (sec <= 0 || !document.getElementById(OVERLAY_ID)) {
              clearInterval(tm);
              sendEmailBtn.disabled = false;
              sendEmailBtn.textContent = "获取验证码";
            } else {
              sendEmailBtn.textContent = sec + "s 后重发";
            }
          }, 1000);
        })
        .catch(function (err) {
          sendEmailBtn.disabled = false;
          if (err && err.code === "mail_not_configured") {
            setAlert("info", "邮件服务尚未配置，可直接填写其余信息完成注册");
          } else {
            if (err && err.code === "captcha_invalid") {
              regForm.captchaCode.value = "";
              loadCaptcha("register");
            }
            setAlert("err", (err && err.message) || "发送失败");
          }
        });
    });

    loginForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var identifier = loginForm.identifier.value.trim();
      var password = loginForm.password.value;
      var captchaCode = loginForm.captchaCode.value.trim();
      if (!identifier || !password) {
        setAlert("err", "请输入账号标识与密码");
        return;
      }
      if (capState.loginRequired && (!capState.loginId || !captchaCode)) {
        setAlert("err", "请输入图形验证码");
        return;
      }
      var btn = loginForm.querySelector("[data-submit-btn]");
      btn.disabled = true;
      btn.textContent = "登录中…";
      setAlert("", "");
      var payload = { identifier: identifier, password: password };
      if (capState.loginRequired && capState.loginId) {
        payload.captchaId = capState.loginId;
        payload.captchaCode = captchaCode;
      }
      postJson("/login", payload)
        .then(finishAuthed)
        .catch(function (err) {
          if (err && (err.code === "captcha_required" || err.code === "captcha_invalid")) {
            capState.loginRequired = true;
            loginCapWrap.style.display = "block";
            loginForm.captchaCode.value = "";
            loadCaptcha("login");
          }
          setAlert("err", (err && err.message) || "登录失败");
        })
        .then(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "登 录";
          }
        });
    });

    regForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var identifier = regForm.identifier.value.trim();
      var displayName = regForm.displayName.value.trim();
      var password = regForm.password.value;
      var captchaCode = regForm.captchaCode.value.trim();
      var emailCode = regForm.emailCode ? regForm.emailCode.value.trim() : "";
      if (!identifier || password.length < 8) {
        setAlert("err", "请输入账号标识与不少于 8 位的密码");
        return;
      }
      if (!capState.registerId || !captchaCode) {
        setAlert("err", "请输入图形验证码");
        return;
      }
      var btn = regForm.querySelector("[data-submit-btn]");
      btn.disabled = true;
      btn.textContent = "注册中…";
      setAlert("", "");
      var payload = {
        identifier: identifier,
        password: password,
        captchaId: capState.registerId,
        captchaCode: captchaCode,
      };
      if (displayName) payload.displayName = displayName;
      if (emailCode) payload.emailCode = emailCode;
      postJson("/register", payload)
        .then(finishAuthed)
        .catch(function (err) {
          if (err && err.code === "captcha_invalid") {
            regForm.captchaCode.value = "";
            loadCaptcha("register");
          }
          setAlert("err", (err && err.message) || "注册失败");
        })
        .then(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "注册并登录";
          }
        });
    });

    setTab(initialTab === "register" ? "register" : "login");
    var firstInput = overlay.querySelector('[data-auth-form="' + (initialTab === "register" ? "register" : "login") + '"] input[name="identifier"]');
    if (firstInput) firstInput.focus();
  }

  function refreshSessionIfAny() {
    var s = readSession();
    var c = getCtx();
    if (!s || !c.apiBase || !c.appId) return;
    fetch(memberEndpoint("/me"), {
      method: "GET",
      headers: { Authorization: "Bearer " + s.token },
    })
      .then(function (r) {
        if (r.status === 401) {
          clearSession();
          syncMemberEntries();
          return;
        }
        if (!r.ok) return;
        return r.json().then(function (d) {
          if (d && d.member) {
            writeSession({
              token: s.token,
              member: d.member,
              policy: d.policy || s.policy,
              roles: d.roles || s.roles,
            });
            syncMemberEntries();
            upgradeStalePromptIfLoggedIn();
          }
        });
      })
      .catch(function () {});
  }

  document.addEventListener(
    "click",
    function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var loginTrigger = t.closest("[data-lcdp-login]");
      if (loginTrigger) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        openAuthModal("login");
        return;
      }
      var logoutTrigger = t.closest("[data-lcdp-logout]");
      if (logoutTrigger) {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        doLogout();
        return;
      }
      var headerLogin = t.closest(".member-entries a");
      if (headerLogin && !readSession()) {
        var txt = (headerLogin.textContent || "").trim();
        if (headerLogin.classList.contains("btn") || txt === "登录" || txt === "登录 / 注册") {
          ev.preventDefault();
          ev.stopPropagation();
          openAuthModal("login");
        }
      }
    },
    true,
  );

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeModal();
  });

  window.lcdpOpenMemberAuth = openAuthModal;

  function boot() {
    ensureMemberShellStyle();
    syncMemberEntries();
    upgradeStalePromptIfLoggedIn();
    refreshSessionIfAny();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
