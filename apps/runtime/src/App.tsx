import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Spin,
  Tabs,
  Typography,
  message as antdMessage,
} from "antd";
import type { MenuProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import { SchemaRenderer, cartStore } from "@lcdp/renderer";
import QRCode from "qrcode";
import type { EntityAccess } from "@lcdp/renderer";
import type { DataSchema, PageSchema } from "@naka1205/schema";
import type {
  AppInfo,
  AssistantContext,
  CenterSession,
  MemberAdapterHooks,
  MemberAuthResult,
  MemberPolicy,
  MemberSession,
  MemberSsoInfo,
  PublicSiteResult,
  SiteInfo,
  Snapshot,
  SsoConsentItem,
  UserInfo,
} from "./api.js";
import AssistantPanel from "./AssistantPanel.js";
import SupportWidget, { SupportAutoMount } from "./SupportWidget.js";
import {
  EMPTY_MEMBER_POLICY,
  SSO_APP_KEY,
  SSO_RETURN_KEY,
  SSO_STATE_KEY,
  api,
  beginSsoAuthorize,
  confirmSandboxPayment,
  fetchSandboxPaymentStatus,
  getStoredUser,
  loadCenterSession,
  loadMemberSession,
  makeAdapter,
  makeMemberAdapter,
  makePublicAdapter,
  memberApi,
  simulateMemberPayment,
  ssoApi,
  storeCenterSession,
  storeMemberSession,
  storeSession,
} from "./api.js";
import FlowCenter from "./FlowCenter.js";

/**
 * 运行态应用壳（M3 入口模型）：运行态是单一解释器，呈现中没有「应用」概念。
 * 登录后按当前域名解析入口（域名定入口），直达入口装配的应用系统；
 * 菜单由页面自身的 menu 声明组装（页面驱动、非实体驱动）。
 * 路由用 history（M14 线一去 #；Pages 侧以 _redirects 回退 index.html）：
 *   入口模式  <页面路由>?<页面参数>
 *   预览模式  /app/<appId><页面路由>?<页面参数>（设计台「在运行态打开」兼容）
 *   待办中心  /flow（外壳级视图，入口/预览模式均可达，侧边菜单顶部固定入口）
 * 旧 # 链接在首载时由 migrateLegacyHash 以 replaceState 迁移到等价新路径。
 * M10 起入口视图为多应用装配：加载入口全部应用的已发布快照，页面取并集
 * （每页带所属 appId，路由冲突按入口应用顺序先到先得），菜单跨应用合并，
 * 当前页以其所属应用的快照与适配器渲染；待办/助手跟随当前页所属应用。
 * 入口主应用（首个应用）appConfig.shell = "site" 时走站点型外壳
 * （顶栏品牌 + 横排导航 + 搜索 + 页脚），公开面与登录态共用同一形态。
 * 界面统一走 Ant Design 组件（与设计文档的 UI 选型一致）。
 */

interface Route {
  path: string;
  params: Record<string, string>;
}

function parseRoute(): Route {
  const raw = window.location.pathname + window.location.search;
  const [path, query] = raw.split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { path: path || "/", params };
}

/** 旧 # 链接迁移（M14 线一）：首载时把 #<路径> 以 replaceState 落到等价新路径，不多留历史记录 */
function migrateLegacyHash(): void {
  const h = window.location.hash;
  if (h.startsWith("#/")) {
    window.history.replaceState(null, "", h.slice(1));
  }
}

/** 站内导航统一写侧：pushState 后派发 popstate 让路由钩子重解析（pushState 本身不触发 popstate） */
function navigateTo(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** URL 首段（原始编码形）：拼站点路径前缀用——保留用户实际使用的段（ID/英文名/中文名编码形） */
function rawFirstSeg(path: string): string | null {
  const seg = path.split("/").filter(Boolean)[0];
  return seg ?? null;
}

/** URL 首段（解码形）：传给站点解析接口——服务端按应用 ID → 英文名 → 中文名顺序匹配 */
function decodedSeg(path: string): string | null {
  const seg = rawFirstSeg(path);
  if (!seg) return null;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** 剥除站点路径前缀：前缀内路径还原为应用内路径（路径恰等于前缀时即根） */
function stripSitePrefix(path: string, prefix: string): string {
  if (!prefix) return path;
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return path;
}

/** 根域跳转（第 68 步定案）：整页跳默认域名，保留路径与查询 */
function redirectToDefaultHost(defaultHost: string): void {
  const target = `https://${defaultHost}${window.location.pathname}${window.location.search}`;
  if (window.location.href !== target) window.location.replace(target);
}

function useHistoryRoute(): Route {
  const [route, setRoute] = useState<Route>(() => {
    migrateLegacyHash();
    return parseRoute();
  });
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return route;
}

type Device = "desktop" | "mobile";

/**
 * 壳环境信号（M13）：Capacitor 运行时或 Web 侧设备桥（window.lcdpBridge）任一存在
 * 即视为壳内——壳内恒移动形态，不受 WebView 宽度影响。
 */
function isShellEnv(): boolean {
  const w = window as unknown as {
    Capacitor?: unknown;
    lcdpBridge?: { isNative?: () => boolean };
  };
  if (w.Capacitor) return true;
  // 注意：runtime 自身在入口无条件安装 window.lcdpBridge（线 C），其「存在」
  // 不能作为壳信号——只有桥报告原生环境才算壳，否则纯 Web 会被误判为壳、
  // 桌面整体翻成移动呈现。壳预注入的桥同理以 isNative 为准。
  try {
    return w.lcdpBridge?.isNative?.() === true;
  } catch {
    return false;
  }
}

/**
 * 设备判定（M13 双信号）：宽度 ≤820px 或壳环境任一成立即 mobile。
 * 壳环境在挂载时判定（桥在文档启动期注入，先于应用渲染）；非壳环境下随视口宽度变化切换。
 */
function useDevice(): Device {
  const shell = isShellEnv();
  const [wide, setWide] = useState<boolean>(
    () => !window.matchMedia("(max-width: 820px)").matches,
  );
  useEffect(() => {
    if (shell) return;
    const mq = window.matchMedia("(max-width: 820px)");
    const onChange = (e: MediaQueryListEvent) => setWide(!e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [shell]);
  return shell || !wide ? "mobile" : "desktop";
}

/** 全局消息提示（适配器的 notify 契约实现，模块级稳定引用） */
function notify(message: string, kind: "ok" | "error" = "ok"): void {
  if (kind === "error") void antdMessage.error(message);
  else void antdMessage.success(message);
}

export default function App() {
  const route = useHistoryRoute();
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const device = useDevice();

  const logout = () => {
    storeSession(null, null);
    setUser(null);
    navigateTo("/");
  };

  const match = route.path.match(/^\/app\/([^/]+)(\/.*)?$/);
  const previewAppId = match ? decodeURIComponent(match[1]!) : null;
  const previewInPath = match?.[2] ?? "/";

  return (
    <ConfigProvider locale={zhCN}>
      {!user ? (
        <AnonGate
          route={route}
          device={device}
          onLoggedIn={(u) => {
            setUser(u);
            // 登录后保留当前路径：站点引导按当前域名 + 首段路径解析作用域
            // （路径作用域应用如 www/<应用ID> 登录后须仍落在该应用内；
            // 预览深链同理保留 /app/<id> 前缀）
          }}
        />
      ) : previewAppId ? (
        <AppView
          apps={[{ id: previewAppId, name: "", scenario: null }]}
          inPath={previewInPath}
          params={route.params}
          user={user}
          onLogout={logout}
          device={device}
          preview
          entryName={null}
        />
      ) : (
        <EntryView
          inPath={route.path}
          params={route.params}
          user={user}
          onLogout={logout}
          device={device}
        />
      )}
    </ConfigProvider>
  );
}

function LoginView({ onLoggedIn }: { onLoggedIn: (user: UserInfo) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(values.username.trim(), values.password);
      onLoggedIn(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ margin: "0 0 4px" }}>
          LCDP Runtime · 运行态
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 13, marginBottom: 20 }}
        >
          登录后直达本入口的应用系统（管理员账号在初始化向导中设置）
        </Typography.Paragraph>
        {error && (
          <Alert type="error" message={error} style={{ marginBottom: 16 }} />
        )}
        <Form
          layout="vertical"
          initialValues={{ username: "admin" }}
          onFinish={(v) => void submit(v)}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

/**
 * 未登录门面：先匿名解析当前入口的公开面——有公开页则渲染公开外壳，
 * 无公开页（或用户点「登录」、或预览深链）时显示登录页；公开面查询失败也回落登录页。
 */
function AnonGate({
  route,
  device,
  onLoggedIn,
}: {
  route: Route;
  device: Device;
  onLoggedIn: (user: UserInfo) => void;
}) {
  const [pub, setPub] = useState<PublicSiteResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .publicSite(
        window.location.host,
        decodedSeg(window.location.pathname),
      )
      .then((r) => {
        if (alive) {
          setPub(r);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 根域（站点解析 mode=redirect）：整页跳默认域名，保留路径
  const site = pub?.site ?? null;
  useEffect(() => {
    if (site?.mode === "redirect") redirectToDefaultHost(site.defaultHost);
  }, [site]);

  if (!loaded || site?.mode === "redirect") {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在加载…" />
      </div>
    );
  }
  const primary = pub?.primary ?? null;
  /** 匿名面客服咨询窗：逐个装配应用探测 support/config，首个 enabled 挂载（M12） */
  const anonSupport = (
    <SupportAutoMount appIds={(pub?.apps ?? []).map((a) => a.id)} />
  );
  // 会员 SSO 回调（外壳级内置路由）：与入口装配无关，优先于公开外壳/登录页判定
  if (route.path === "/sso/callback") {
    return <SsoCallbackPage params={route.params} />;
  }
  // 会员中心入口（account 子域，entry.kind = "member-center"）：渲染平台内置
  // 中心页组（登录/注册/授权确认/我的授权），不走应用外壳与员工登录页
  if (pub?.entry?.kind === "member-center") {
    return <MemberCenterApp route={route} />;
  }
  if (
    primary &&
    primary.pages.length > 0 &&
    !showLogin &&
    !route.path.startsWith("/app/")
  ) {
    // 路径作用域（默认域名 /<应用段>）：外壳内路径剥前缀、链接生成再拼回
    const rawSeg = rawFirstSeg(route.path);
    const basePrefix =
      site?.via === "path" && rawSeg ? `/${rawSeg}` : "";
    return (
      <>
        <PublicShell
          primary={primary}
          inPath={stripSitePrefix(route.path, basePrefix)}
          params={route.params}
          device={device}
          onLogin={() => setShowLogin(true)}
          memberSso={pub?.memberSso ?? null}
          basePrefix={basePrefix}
        />
        {anonSupport}
      </>
    );
  }
  return (
    <>
      <LoginView onLoggedIn={onLoggedIn} />
      {anonSupport}
    </>
  );
}

/* ---------- 会员 SSO：回调页与会员中心页组（平台内置页，不走应用 PageSchema） ---------- */

/** 授权完成后的回跳地址：redirectUri 已由服务端校验，这里只附加 code/state */
function ssoRedirectBack(
  redirectUri: string,
  code: string,
  state?: string,
): string {
  const u = new URL(redirectUri);
  u.searchParams.set("code", code);
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

/**
 * SSO 回调页（应用源 /sso/callback，外壳级内置路由）：校验 state 与发起时
 * 暂存值一致 → 码换令牌 → 写入与本地登录同一会话位（lcdp.member.<host>）
 * → 整页跳回原页面，外壳按新会话重新装配。任何不符都停在报错卡，
 * 不落半成品会话；授权码单次使用，本页只在挂载时执行一次。
 */
function SsoCallbackPage({ params }: { params: Record<string, string> }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const code = params.code ?? "";
      const state = params.state ?? "";
      const wantState = sessionStorage.getItem(SSO_STATE_KEY);
      const appId = sessionStorage.getItem(SSO_APP_KEY);
      const returnTo = sessionStorage.getItem(SSO_RETURN_KEY) || "/";
      sessionStorage.removeItem(SSO_STATE_KEY);
      sessionStorage.removeItem(SSO_APP_KEY);
      sessionStorage.removeItem(SSO_RETURN_KEY);
      if (!code || !appId) {
        if (alive) setError("授权回调参数不完整，请返回原页面重新登录。");
        return;
      }
      if (!state || !wantState || state !== wantState) {
        if (alive) setError("授权状态校验失败（state 不一致），请重新登录。");
        return;
      }
      try {
        const res = await ssoApi.exchange({ code, appId });
        const session: MemberSession = {
          token: res.token,
          member: res.member,
          policy: res.policy,
          appId,
          roles: res.roles ?? [],
        };
        storeMemberSession(window.location.host, session);
        window.location.replace(returnTo);
      } catch (err) {
        if (alive) {
          setError(
            "登录未完成，授权码可能已过期，请重新登录。",
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
    // 仅挂载执行一次（授权码单次使用，禁止重跑）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
        padding: 16,
      }}
    >
      <Card style={{ width: 380, maxWidth: "100%" }}>
        {error ? (
          <>
            <Alert
              type="error"
              message="会员登录失败"
              description={error}
              style={{ marginBottom: 16 }}
            />
            <Button block onClick={() => window.location.replace("/")}>
              回到首页
            </Button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <Spin size="large" tip="正在完成登录…" />
          </div>
        )}
      </Card>
    </div>
  );
}

/** 会员中心页组外框（简洁内置页，呈现治理不在本期范围） */
function CenterFrame({
  subtitle,
  children,
}: {
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
        padding: 16,
      }}
    >
      <Card style={{ width: 400, maxWidth: "100%" }}>
        <Typography.Title level={4} style={{ margin: "0 0 4px" }}>
          会员中心
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 13, marginBottom: 16 }}
        >
          {subtitle}
        </Typography.Paragraph>
        {children}
      </Card>
    </div>
  );
}

/** 授权流参数（app/redirect_uri/state）在中心页间的透传路径 */
function centerPath(
  page: "login" | "register" | "authorize",
  appId: string,
  redirectUri: string,
  state?: string,
): string {
  const qs = new URLSearchParams({ app: appId, redirect_uri: redirectUri });
  if (state) qs.set("state", state);
  return `/${page}?${qs.toString()}`;
}

/**
 * 会员中心（account 子域内置页组）：/authorize 授权判定与确认、/login 中心
 * 登录、/register 注册（复用 member 注册端点）、/consents 我的授权。
 * 中心会话存 account 域 localStorage（lcdp.memberCenter），令牌
 * aud='member-center'、与各应用会话互不通用。
 */
function MemberCenterApp({ route }: { route: Route }) {
  const appId = route.params.app ?? "";
  const redirectUri = route.params.redirect_uri ?? "";
  const state = route.params.state;
  if (route.path === "/login") {
    return (
      <CenterLoginPage appId={appId} redirectUri={redirectUri} state={state} />
    );
  }
  if (route.path === "/register") {
    return (
      <CenterRegisterPage
        appId={appId}
        redirectUri={redirectUri}
        state={state}
      />
    );
  }
  if (route.path === "/authorize") {
    return (
      <CenterAuthorizePage
        appId={appId}
        redirectUri={redirectUri}
        state={state}
      />
    );
  }
  // /consents 与中心根路径：授权管理（无会话时呈登录引导）
  return <CenterConsentsPage />;
}

function CenterLoginPage({
  appId,
  redirectUri,
  state,
}: {
  appId: string;
  redirectUri: string;
  state?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 连错后服务端要求图形验证码 → 展开验证码行（与本地登录同一策略） */
  const [needCaptcha, setNeedCaptcha] = useState(false);
  const [form] = Form.useForm<{
    identifier: string;
    password: string;
    captchaCode?: string;
  }>();
  const captcha = useMemberCaptcha(appId, Boolean(appId) && needCaptcha);

  // 已有中心会话且带着授权参数 → 直接续跑授权，不重复登录
  useEffect(() => {
    if (appId && redirectUri && loadCenterSession()) {
      navigateTo(centerPath("authorize", appId, redirectUri, state));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!appId) {
    return (
      <CenterFrame subtitle="统一会员账号登录">
        <Alert
          type="info"
          message="请从要访问的应用进入登录"
          description="会员中心不单独提供登录入口：在任一应用点击「会员登录」即可来到这里，登录一次后访问其他应用不再重复输入密码。"
        />
      </CenterFrame>
    );
  }

  const submit = async (v: {
    identifier: string;
    password: string;
    captchaCode?: string;
  }) => {
    const captchaCode = (v.captchaCode ?? "").trim();
    if (needCaptcha && (!captcha.captcha || !captchaCode)) {
      setError("请输入图形验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await ssoApi.centerLogin({
        appId,
        identifier: v.identifier.trim(),
        password: v.password,
        ...(needCaptcha && captcha.captcha
          ? { captchaId: captcha.captcha.id, captchaCode }
          : {}),
      });
      storeCenterSession({ token: res.token, member: res.member });
      if (redirectUri) {
        navigateTo(centerPath("authorize", appId, redirectUri, state));
      } else {
        navigateTo("/consents");
      }
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "captcha_required") {
        setNeedCaptcha(true);
        setError("登录失败次数较多，请输入图形验证码后重试");
      } else if (code === "captcha_invalid") {
        form.setFieldValue("captchaCode", "");
        void captcha.refresh();
        setError(memberErrorText(err));
      } else {
        setError(memberErrorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterFrame subtitle="登录一次，通行已接入的全部应用">
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 16 }} />
      )}
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)}>
        <Form.Item
          label="标识（手机号 / 邮箱 / 用户名）"
          name="identifier"
          rules={[{ required: true, message: "请输入账号标识" }]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        {needCaptcha && (
          <CaptchaRow
            captcha={captcha.captcha}
            onRefresh={() => void captcha.refresh()}
          />
        )}
        <Button type="primary" htmlType="submit" block loading={busy}>
          登录
        </Button>
      </Form>
      <div style={{ marginTop: 12, textAlign: "center" }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          还没有账号？
        </Typography.Text>
        <Button
          type="link"
          size="small"
          onClick={() =>
            navigateTo(centerPath("register", appId, redirectUri, state))
          }
        >
          注册
        </Button>
      </div>
    </CenterFrame>
  );
}

function CenterRegisterPage({
  appId,
  redirectUri,
  state,
}: {
  appId: string;
  redirectUri: string;
  state?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 邮件未配置的降级提示（出现后邮箱验证码非必填，服务端同口径） */
  const [mailHint, setMailHint] = useState<string | null>(null);
  const [form] = Form.useForm<{
    identifier: string;
    password: string;
    displayName?: string;
    captchaCode?: string;
    emailCode?: string;
  }>();
  const captcha = useMemberCaptcha(appId, Boolean(appId));
  const countdown = useEmailCountdown();

  if (!appId) {
    return (
      <CenterFrame subtitle="注册会员账号">
        <Alert
          type="info"
          message="请从要访问的应用进入注册"
          description="注册归属的会员域由来源应用决定：在任一应用点击「注册」即可来到这里。"
        />
      </CenterFrame>
    );
  }

  const continueFlow = () => {
    if (redirectUri) {
      navigateTo(centerPath("authorize", appId, redirectUri, state));
    } else {
      navigateTo("/consents");
    }
  };

  /** 发送邮箱验证码：先过图形验证码（与本地注册同一端点、同一口径） */
  const sendEmailCode = async () => {
    setError(null);
    setNotice(null);
    const identifier =
      (form.getFieldValue("identifier") as string | undefined)?.trim() ?? "";
    const captchaCode =
      (form.getFieldValue("captchaCode") as string | undefined)?.trim() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      setError("请先填写邮箱形态的账号标识");
      return;
    }
    if (!captcha.captcha || !captchaCode) {
      setError("请先填写图形验证码");
      return;
    }
    try {
      await memberApi.sendMemberEmailCode(appId, {
        email: identifier,
        captchaId: captcha.captcha.id,
        captchaCode,
      });
      countdown.start();
      setMailHint(null);
      setNotice("邮箱验证码已发送，请查收");
      // 图形码已被本次发送消费：刷新一张供注册提交使用
      form.setFieldValue("captchaCode", "");
      void captcha.refresh();
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "mail_not_configured") {
        setMailHint("邮件服务未配置：邮箱验证码暂不强制，可直接注册");
      } else if (code === "captcha_invalid") {
        form.setFieldValue("captchaCode", "");
        void captcha.refresh();
        setError(memberErrorText(err));
      } else {
        setError(memberErrorText(err));
      }
    }
  };

  const submit = async (v: {
    identifier: string;
    password: string;
    displayName?: string;
    captchaCode?: string;
    emailCode?: string;
  }) => {
    const captchaCode = (v.captchaCode ?? "").trim();
    if (!captcha.captcha || !captchaCode) {
      setError("请输入图形验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await memberApi.register(appId, {
        identifier: v.identifier.trim(),
        password: v.password,
        ...(v.displayName?.trim()
          ? { displayName: v.displayName.trim() }
          : {}),
        captchaId: captcha.captcha.id,
        captchaCode,
        ...(v.emailCode?.trim() ? { emailCode: v.emailCode.trim() } : {}),
      });
      // 注册成功即以同一凭据换中心令牌（注册端点回的是应用令牌，中心不落它）
      const center = await ssoApi.centerLogin({
        appId,
        identifier: v.identifier.trim(),
        password: v.password,
      });
      storeCenterSession({ token: center.token, member: center.member });
      continueFlow();
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "captcha_invalid") {
        form.setFieldValue("captchaCode", "");
        void captcha.refresh();
      }
      setError(memberErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenterFrame subtitle="注册后即可通行已接入的全部应用">
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 16 }} />
      )}
      {notice && (
        <Alert type="success" message={notice} style={{ marginBottom: 16 }} />
      )}
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)}>
        <Form.Item
          label="标识（手机号 / 邮箱 / 用户名）"
          name="identifier"
          rules={[
            { required: true, message: "请输入账号标识" },
            { min: 3, message: "标识至少 3 个字符" },
          ]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item label="昵称（选填）" name="displayName">
          <Input placeholder="站内显示名，缺省用标识" />
        </Form.Item>
        <Form.Item
          label="密码"
          name="password"
          rules={[
            { required: true, message: "请输入密码" },
            { min: 8, message: "密码至少 8 位" },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <CaptchaRow
          captcha={captcha.captcha}
          onRefresh={() => void captcha.refresh()}
        />
        <EmailCodeRow
          onSend={() => void sendEmailCode()}
          sendDisabled={busy || countdown.seconds > 0}
          sendText={
            countdown.seconds > 0
              ? `${countdown.seconds} 秒后重发`
              : "发送验证码"
          }
        />
        <CodeHint text={mailHint} tone="secondary" />
        <Button type="primary" htmlType="submit" block loading={busy}>
          注册并登录
        </Button>
      </Form>
      <div style={{ marginTop: 12, textAlign: "center" }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          已有账号？
        </Typography.Text>
        <Button
          type="link"
          size="small"
          onClick={() =>
            navigateTo(centerPath("login", appId, redirectUri, state))
          }
        >
          登录
        </Button>
      </div>
    </CenterFrame>
  );
}

function CenterAuthorizePage({
  appId,
  redirectUri,
  state,
}: {
  appId: string;
  redirectUri: string;
  state?: string;
}) {
  const [session] = useState<CenterSession | null>(() => loadCenterSession());
  const [phase, setPhase] = useState<"checking" | "consent" | "error">(
    "checking",
  );
  const [appName, setAppName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const getToken = useCallback(
    () => loadCenterSession()?.token ?? null,
    [],
  );
  const toLogin = useCallback(() => {
    navigateTo(centerPath("login", appId, redirectUri, state));
  }, [appId, redirectUri, state]);

  useEffect(() => {
    if (!appId || !redirectUri) {
      setPhase("error");
      setError("授权参数不完整，请从应用重新进入登录。");
      return;
    }
    if (!loadCenterSession()) {
      toLogin();
      return;
    }
    let alive = true;
    ssoApi
      .authorize(getToken, { appId, redirectUri, state }, () =>
        storeCenterSession(null),
      )
      .then((res) => {
        if (!alive) return;
        if (res.code) {
          window.location.assign(ssoRedirectBack(redirectUri, res.code, state));
          return;
        }
        if (res.consentRequired) {
          setAppName(res.appName ?? appId);
          setPhase("consent");
          return;
        }
        setPhase("error");
        setError("授权应答异常，请从应用重新进入登录。");
      })
      .catch((err) => {
        if (!alive) return;
        if ((err as { status?: number }).status === 401) {
          toLogin();
          return;
        }
        setPhase("error");
        setError(memberErrorText(err));
      });
    return () => {
      alive = false;
    };
    // 仅挂载时判定一次（发码后即整页跳走，禁止重跑）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await ssoApi.consent(
        getToken,
        { appId, redirectUri, state },
        () => storeCenterSession(null),
      );
      window.location.assign(ssoRedirectBack(redirectUri, res.code, state));
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        toLogin();
        return;
      }
      setError(memberErrorText(err));
      setBusy(false);
    }
  };

  const cancel = () => {
    // 取消授权：回应用站点首页（不带码，应用保持未登录态）
    try {
      window.location.assign(`${new URL(redirectUri).origin}/`);
    } catch {
      window.location.assign("/");
    }
  };

  if (phase === "checking") {
    return (
      <CenterFrame subtitle="正在确认授权…">
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <Spin tip="正在确认授权…" />
        </div>
      </CenterFrame>
    );
  }
  if (phase === "error") {
    return (
      <CenterFrame subtitle="授权未完成">
        <Alert type="error" message={error ?? "授权失败，请重试"} />
      </CenterFrame>
    );
  }
  return (
    <CenterFrame subtitle="应用授权确认">
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 16 }} />
      )}
      <Typography.Paragraph>
        应用「<Typography.Text strong>{appName}</Typography.Text>
        」请求使用你的会员账号登录。授权后，该应用将获得你的基本身份信息：
      </Typography.Paragraph>
      <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="共享信息">
          昵称、账号标识、头像（如有）
        </Descriptions.Item>
        <Descriptions.Item label="当前账号">
          {session?.member.displayName || session?.member.identifier || "—"}
          {session?.member.displayName && (
            <Typography.Text type="secondary">
              {`（${session.member.identifier}）`}
            </Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        <Button type="primary" block loading={busy} onClick={() => void confirm()}>
          授权并继续
        </Button>
        <Button block onClick={cancel}>
          取消
        </Button>
      </Space>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
      >
        授权后再次访问该应用将不再询问；可在会员中心「我的授权」中随时撤销。
      </Typography.Paragraph>
    </CenterFrame>
  );
}

function CenterConsentsPage() {
  const [session, setSession] = useState<CenterSession | null>(() =>
    loadCenterSession(),
  );
  const [items, setItems] = useState<SsoConsentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyApp, setBusyApp] = useState<string | null>(null);
  const getToken = useCallback(() => loadCenterSession()?.token ?? null, []);

  const load = useCallback(async () => {
    try {
      const res = await ssoApi.consents(getToken, () =>
        storeCenterSession(null),
      );
      setItems(res.consents);
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setSession(null);
        return;
      }
      setError(memberErrorText(err));
    }
  }, [getToken]);

  // 进页校验中心会话（简档刷新 + 失效即清），随后拉授权列表
  useEffect(() => {
    if (!session) return;
    let alive = true;
    ssoApi
      .centerMe(getToken, () => storeCenterSession(null))
      .then((res) => {
        if (!alive) return;
        const token = loadCenterSession()?.token;
        if (token) {
          const next = { token, member: res.member };
          storeCenterSession(next);
          setSession(next);
        }
        void load();
      })
      .catch(() => {
        if (alive && !loadCenterSession()) setSession(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (appId: string) => {
    setBusyApp(appId);
    setError(null);
    try {
      await ssoApi.revokeConsent(getToken, appId, () =>
        storeCenterSession(null),
      );
      notify("已撤销授权，下次访问该应用将重新确认");
      await load();
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        setSession(null);
        return;
      }
      setError(memberErrorText(err));
    } finally {
      setBusyApp(null);
    }
  };

  const logout = () => {
    storeCenterSession(null);
    setSession(null);
    setItems(null);
    notify("已退出会员中心");
  };

  if (!session) {
    return (
      <CenterFrame subtitle="我的授权">
        <Alert
          type="info"
          message="尚未登录会员中心"
          description="请从要访问的应用点击「会员登录」进入：登录后可在此查看与撤销各应用的授权。"
        />
      </CenterFrame>
    );
  }

  return (
    <CenterFrame subtitle="我的授权">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Typography.Text>
          {session.member.displayName || session.member.identifier}
          {session.member.displayName && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {`（${session.member.identifier}）`}
            </Typography.Text>
          )}
        </Typography.Text>
        <Button size="small" onClick={logout}>
          退出
        </Button>
      </div>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {items === null ? (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          暂无授权记录。访问应用并确认授权后，记录会出现在这里。
        </Typography.Paragraph>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={8}>
          {items.map((it) => (
            <Card key={it.appId} size="small">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div>
                  <Typography.Text strong>{it.appName}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    授权于{" "}
                    {it.grantedAt
                      ? new Date(it.grantedAt).toLocaleString()
                      : "—"}
                  </Typography.Text>
                </div>
                <Button
                  danger
                  size="small"
                  loading={busyApp === it.appId}
                  onClick={() => void revoke(it.appId)}
                >
                  撤销
                </Button>
              </div>
            </Card>
          ))}
        </Space>
      )}
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
      >
        撤销后，该应用下次登录将重新请求授权；已登录的会话按其有效期自然过期。
      </Typography.Paragraph>
    </CenterFrame>
  );
}

/* ---------- appConfig 宽松读取（M10：shell / globalVars / theme.logoText） ---------- */

/** 应用配置视图：快照原样回传设计包 appConfig 体，这里只取外壳关心的键 */
interface AppConfigView {
  theme?: Record<string, unknown>;
  shell?: string;
  globalVars?: Record<string, unknown>;
}

function configOf(
  raw: { theme: Record<string, unknown> } | null | undefined,
): AppConfigView | null {
  return (raw as AppConfigView | null | undefined) ?? null;
}

/** 外壳形态：主应用 appConfig.shell === "site" 为站点型，其余（含缺省）为系统型 */
function isSiteShell(cfg: AppConfigView | null): boolean {
  return cfg?.shell === "site";
}

function globalVarText(
  cfg: AppConfigView | null,
  key: string,
): string | undefined {
  const v = cfg?.globalVars?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** 品牌文案：主题 logoText 优先（设计台「Logo 文案」口径），缺省用应用/站点名 */
function brandTextOf(cfg: AppConfigView | null, fallback: string): string {
  const logo = cfg?.theme?.logoText;
  return typeof logo === "string" && logo.trim() ? logo : fallback;
}

/** 站点页脚文案：globalVars.siteFooter 优先，缺省给一行版权占位 */
function siteFooterText(cfg: AppConfigView | null, brand: string): string {
  return (
    globalVarText(cfg, "siteFooter") ??
    `© ${new Date().getFullYear()} ${brand} 版权所有`
  );
}

/* ---------- 移动外壳（M13）：顶栏精简 + 底部导航，系统型外壳的移动形态 ---------- */

/** 底部导航的一项：路由 key + 文案 + 可选角标（待办数） */
interface MobileNavEntry {
  key: string;
  label: string;
  badge?: number;
}

/** 把 antd 菜单项拍平为底部导航条目：分组展开为其子项（组标题不进底栏），JSX 标签项跳过 */
function flattenMenuEntries(
  items: MenuProps["items"],
): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const item of items ?? []) {
    if (!item) continue;
    const it = item as {
      key?: unknown;
      label?: unknown;
      children?: MenuProps["items"];
    };
    if (Array.isArray(it.children)) {
      out.push(...flattenMenuEntries(it.children));
      continue;
    }
    if (typeof it.key === "string" && typeof it.label === "string") {
      out.push({ key: it.key, label: it.label });
    }
  }
  return out;
}

/**
 * 移动外壳（M13，《移动体验规范》§2）：顶部精简栏（应用名 + 右侧入口区）+ 底部导航
 * （条目 ≤5 全量直达；更多时前 4 项直达、第 5 格「更多」聚合其余至底部抽屉，
 * 抽屉尾部放外壳级动作如退出）+ 内容区（含底部安全区让位）。
 * 返回行为跟随既有 hash 历史：导航只改 hash（与桌面 goPage 同路径），不自建路由栈。
 * 助手/咨询的浮动入口由各自组件自带（fixed 浮钮 + 全屏抽屉），在本外壳下保持挂载即保持可达。
 */
function MobileShell({
  title,
  entries,
  selectedKey,
  onNavigate,
  topRight,
  moreFooter,
  children,
}: {
  title: string;
  entries: MobileNavEntry[];
  selectedKey: string | null;
  onNavigate: (route: string) => void;
  topRight?: ReactNode;
  /** 「更多」抽屉尾部的外壳级动作（退出登录等）；无更多条目时不渲染抽屉，此槽位随之失效 */
  moreFooter?: ReactNode;
  children: ReactNode;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  // 移动外壳在场时把底部导航高度登记为全局 CSS 变量：助手/咨询悬浮钮的
  // bottom 经 var(--lcdp-nav-offset) 抬升避让导航栏（桌面无此外壳、变量
  // 不存在，两钮回退原 bottom，渲染不变）。卸载时清除。
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--lcdp-nav-offset",
      "calc(56px + env(safe-area-inset-bottom, 0px))",
    );
    return () => {
      root.style.removeProperty("--lcdp-nav-offset");
    };
  }, []);
  const tabs = entries.length <= 5 ? entries : entries.slice(0, 4);
  const rest = entries.length <= 5 ? [] : entries.slice(4);
  const go = (key: string) => {
    setMoreOpen(false);
    onNavigate(key);
  };
  const tabButton = (e: MobileNavEntry) => {
    const active = e.key === selectedKey;
    return (
      <button
        key={e.key}
        type="button"
        onClick={() => go(e.key)}
        style={{
          flex: 1,
          minHeight: 44,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          fontSize: 11,
          color: active ? "#1677ff" : "#646a73",
          fontWeight: active ? 600 : 400,
          padding: "4px 2px",
        }}
      >
        <span style={{ position: "relative", fontSize: 13, lineHeight: 1.3 }}>
          {e.label}
          {!!e.badge && (
            <Badge
              count={e.badge}
              size="small"
              style={{ position: "absolute", top: -6, right: -18 }}
            />
          )}
        </span>
      </button>
    );
  };
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#fff",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 48,
          padding: "env(safe-area-inset-top, 0px) 14px 0",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            fontWeight: 700,
            fontSize: 16,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </span>
        {topRight}
      </div>
      <Layout.Content
        style={{
          padding:
            "12px 12px calc(68px + env(safe-area-inset-bottom, 0px))",
          background: "#f7f8fa",
        }}
      >
        {children}
      </Layout.Content>
      <nav
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 20,
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "stretch",
          minHeight: 56,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxSizing: "border-box",
        }}
      >
        {tabs.map(tabButton)}
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            style={{
              flex: 1,
              minHeight: 44,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 13,
              color: "#646a73",
              padding: "4px 2px",
            }}
          >
            ⋯ 更多
          </button>
        )}
      </nav>
      {rest.length > 0 && (
        <Drawer
          title="更多"
          placement="bottom"
          height="auto"
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            {rest.map((e) => (
              <Button
                key={e.key}
                block
                size="large"
                type={e.key === selectedKey ? "primary" : "default"}
                style={{ minHeight: 48, textAlign: "left" }}
                onClick={() => go(e.key)}
              >
                {e.label}
                {!!e.badge && (
                  <Badge count={e.badge} size="small" offset={[6, -2]} />
                )}
              </Button>
            ))}
            {moreFooter}
          </div>
        </Drawer>
      )}
    </Layout>
  );
}

/** 站点横排导航：把菜单项拍平（分组展开为其子项，组标题不进横排） */
function flatNavItems(items: MenuProps["items"]): MenuProps["items"] {
  const out: NonNullable<MenuProps["items"]> = [];
  for (const item of items ?? []) {
    if (!item) continue;
    const anyItem = item as { type?: string; children?: MenuProps["items"] };
    if (anyItem.type === "group" && Array.isArray(anyItem.children)) {
      out.push(...(flatNavItems(anyItem.children) ?? []));
    } else {
      out.push(item);
    }
  }
  return out;
}

/**
 * 站点型页眉（公开面与登录态共用）：品牌区 + 横排栏目导航 + 搜索框（可选） + 右侧区。
 * 搜索框仅在配置了 globalVars.siteSearchRoute 时出现，提交跳该路由并带 ?q= 关键词。
 */
function SiteHeader({
  brand,
  navItems,
  selectedKey,
  onNavigate,
  searchRoute,
  right,
}: {
  brand: string;
  navItems: MenuProps["items"];
  selectedKey: string | null;
  onNavigate: (route: string) => void;
  searchRoute?: string;
  right?: ReactNode;
}) {
  return (
    <Layout.Header
      style={{
        background: "#fff",
        borderBottom: "1px solid #f0f0f0",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 20px",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: 16,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
        onClick={() => onNavigate("/")}
      >
        {brand}
      </span>
      <Menu
        mode="horizontal"
        selectedKeys={selectedKey ? [selectedKey] : []}
        items={navItems}
        onClick={({ key }) => onNavigate(key)}
        style={{
          flex: 1,
          minWidth: 0,
          borderBottom: "none",
          background: "transparent",
        }}
      />
      {searchRoute && (
        <Input.Search
          placeholder="搜索"
          allowClear
          style={{ width: 200, flexShrink: 0 }}
          onSearch={(q) => {
            const kw = q.trim();
            if (kw) {
              onNavigate(`${searchRoute}?q=${encodeURIComponent(kw)}`);
            }
          }}
        />
      )}
      {right}
    </Layout.Header>
  );
}

/**
 * 站点型页脚：居中一行文案（配置文案或版权占位）。
 * 公开外壳可传入 onStaffLogin：员工入口不与页眉会员区并列（用户 2026-10-17 拍板），
 * 只在页脚以低调文字链呈现；登录态外壳不传、行为不变。
 */
function SiteFooter({
  text,
  onStaffLogin,
}: {
  text: string;
  onStaffLogin?: () => void;
}) {
  return (
    <Layout.Footer
      style={{
        textAlign: "center",
        color: "#8c8c8c",
        background: "#fafafa",
        borderTop: "1px solid #f0f0f0",
        padding: "18px 24px",
      }}
    >
      <div>{text}</div>
      {onStaffLogin && (
        <div style={{ marginTop: 4 }}>
          <Button
            type="link"
            size="small"
            onClick={onStaffLogin}
            style={{ color: "#bfbfbf", fontSize: 12, padding: 0, height: "auto" }}
          >
            员工登录
          </Button>
        </div>
      )}
    </Layout.Footer>
  );
}

/* ---------- 应用会员（会员试点）：公开外壳的第三类主体 ---------- */

/** 服务端业务错误码 → 前端中文提示（未知码回落服务端 message，其本身已是中文） */
const MEMBER_ERROR_TEXT: Record<string, string> = {
  captcha_invalid: "图形验证码不正确或已过期，请重新输入",
  captcha_required: "请输入图形验证码",
  email_code_invalid: "邮箱验证码不正确或已过期，请重新获取",
  email_code_required: "请先获取并填写邮箱验证码",
  mail_not_configured: "邮件服务尚未配置",
  rate_limited: "操作过于频繁，请稍后再试",
};

function memberErrorCode(err: unknown): string | undefined {
  return err instanceof Error
    ? (err as Error & { code?: string }).code
    : undefined;
}

function memberErrorText(err: unknown): string {
  if (err instanceof Error) {
    const code = memberErrorCode(err);
    if (code && MEMBER_ERROR_TEXT[code]) return MEMBER_ERROR_TEXT[code];
    return err.message;
  }
  return String(err);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 图形验证码状态（自托管 SVG）：active 时自动拉取；服务端一次性发放、校验即作废，
 * 故每次校验失败都要 refresh 换新图，前端输入随之清空。
 */
function useMemberCaptcha(appId: string, active: boolean) {
  const [captcha, setCaptcha] = useState<{ id: string; svg: string } | null>(
    null,
  );
  const refresh = useCallback(async () => {
    try {
      const res = await memberApi.fetchMemberCaptcha(appId);
      setCaptcha({ id: res.captchaId, svg: res.svg });
    } catch {
      setCaptcha(null);
    }
  }, [appId]);
  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);
  return { captcha, refresh };
}

/** 发送邮箱验证码后的 60 秒倒计时（0 = 可发送） */
function useEmailCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return { seconds, start: () => setSeconds(60) };
}

/** 图形验证码图：内联渲染服务端 SVG，点击刷新 */
function CaptchaPicture({
  svg,
  onRefresh,
}: {
  svg: string | null;
  onRefresh: () => void;
}) {
  const style: CSSProperties = {
    width: 120,
    height: 44,
    flexShrink: 0,
    cursor: "pointer",
    border: "1px solid #d9d9d9",
    borderRadius: 6,
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fafafa",
    color: "#8c8c8c",
    fontSize: 12,
    userSelect: "none",
  };
  if (!svg) {
    return (
      <span title="点击获取图形验证码" onClick={onRefresh} style={style}>
        点击获取
      </span>
    );
  }
  return (
    <span
      title="点击刷新图形验证码"
      onClick={onRefresh}
      style={style}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** 图形验证码行：输入框（字段名 captchaCode，挂当前 Form）+ 图；必填校验走提交时人工检查（与弹窗 Alert 报错口径一致） */
function CaptchaRow({
  captcha,
  onRefresh,
}: {
  captcha: { id: string; svg: string } | null;
  onRefresh: () => void;
}) {
  return (
    <Form.Item label="图形验证码">
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Form.Item name="captchaCode" noStyle>
            <Input placeholder="输入图中字符" autoComplete="off" />
          </Form.Item>
        </div>
        <CaptchaPicture svg={captcha?.svg ?? null} onRefresh={onRefresh} />
      </div>
    </Form.Item>
  );
}

/** 邮箱验证码行：输入框（字段名 emailCode）+ 发送按钮（倒计时/禁用由调用方控制） */
function EmailCodeRow({
  onSend,
  sendDisabled,
  sendText,
}: {
  onSend: () => void;
  sendDisabled: boolean;
  sendText: string;
}) {
  return (
    <Form.Item label="邮箱验证码">
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Form.Item name="emailCode" noStyle>
            <Input
              placeholder="邮箱收到的 6 位验证码"
              autoComplete="off"
              inputMode="numeric"
            />
          </Form.Item>
        </div>
        <Button onClick={onSend} disabled={sendDisabled}>
          {sendText}
        </Button>
      </div>
    </Form.Item>
  );
}

/** 验证码区下方的浅灰/成功小字提示 */
function CodeHint({
  text,
  tone,
}: {
  text: string | null;
  tone: "secondary" | "success";
}) {
  if (!text) return null;
  return (
    <Typography.Text
      type={tone}
      style={{ display: "block", marginTop: -16, marginBottom: 16, fontSize: 12 }}
    >
      {text}
    </Typography.Text>
  );
}

/**
 * 会员登录/注册弹窗（验证码与邮箱验证）：Tabs 两页签（会员登录 / 注册）+ 找回密码视图。
 * - 注册：图形验证码强制（打开页签自动拉取、点图刷新、校验失败自动换新）；标识为邮箱时
 *   可发邮箱验证码（发送须先过图形验证码）；邮件服务未配置时邮箱验证码降级为非必填（服务端同口径）。
 * - 登录：默认无验证码行；服务端回 captcha_required（连续失败后）才展开图形验证码行、重试自动带上。
 * - 找回：邮箱 + 图形验证码发重置码 + 新密码确认；邮件未配置时诚实提示并禁用发送。
 * 成功后服务端返回令牌 + 简档 + 策略，调用方落 localStorage 会话并切换会员态。
 */
function MemberAuthModal({
  appId,
  open,
  initialTab,
  onClose,
  onAuthed,
}: {
  appId: string;
  open: boolean;
  initialTab: "login" | "register";
  onClose: () => void;
  onAuthed: (session: MemberSession) => void;
}) {
  const [tab, setTab] = useState<"login" | "register">(initialTab);
  const [view, setView] = useState<"auth" | "reset">("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** 登录连错后服务端要求图形验证码 → 展开登录表单的验证码行 */
  const [loginNeedCaptcha, setLoginNeedCaptcha] = useState(false);
  /** 注册：邮件未配置的浅灰降级提示（出现后邮箱验证码非必填，服务端同口径） */
  const [registerMailHint, setRegisterMailHint] = useState<string | null>(null);
  const [registerSentHint, setRegisterSentHint] = useState<string | null>(null);
  /** 找回：邮件未配置 → 诚实提示并禁用发送（找回无降级路径） */
  const [resetMailOff, setResetMailOff] = useState(false);
  const [resetSentHint, setResetSentHint] = useState<string | null>(null);
  const [loginForm] = Form.useForm<{
    identifier: string;
    password: string;
    captchaCode?: string;
  }>();
  const [registerForm] = Form.useForm<{
    identifier: string;
    password: string;
    displayName?: string;
    captchaCode?: string;
    emailCode?: string;
  }>();
  const [resetForm] = Form.useForm<{
    email: string;
    captchaCode?: string;
    emailCode?: string;
    newPassword: string;
  }>();
  const registerCaptcha = useMemberCaptcha(
    appId,
    open && view === "auth" && tab === "register",
  );
  const loginCaptcha = useMemberCaptcha(
    appId,
    open && view === "auth" && tab === "login" && loginNeedCaptcha,
  );
  const resetCaptcha = useMemberCaptcha(appId, open && view === "reset");
  const registerCountdown = useEmailCountdown();
  const resetCountdown = useEmailCountdown();

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setView("auth");
      setError(null);
      setNotice(null);
      setBusy(false);
      setLoginNeedCaptcha(false);
      setRegisterMailHint(null);
      setRegisterSentHint(null);
      setResetMailOff(false);
      setResetSentHint(null);
    }
  }, [open, initialTab]);

  const finish = (res: MemberAuthResult) => {
    const session: MemberSession = {
      token: res.token,
      member: res.member,
      policy: res.policy,
      appId,
      roles: res.roles ?? [],
    };
    storeMemberSession(window.location.host, session);
    onAuthed(session);
  };

  const submitLogin = async (v: {
    identifier: string;
    password: string;
    captchaCode?: string;
  }) => {
    const captchaCode = (v.captchaCode ?? "").trim();
    if (loginNeedCaptcha && (!loginCaptcha.captcha || !captchaCode)) {
      setError("请输入图形验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      finish(
        await memberApi.login(appId, {
          identifier: v.identifier.trim(),
          password: v.password,
          ...(loginNeedCaptcha && loginCaptcha.captcha
            ? { captchaId: loginCaptcha.captcha.id, captchaCode }
            : {}),
        }),
      );
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "captcha_required") {
        // 服务端要求验证码：展开验证码行（hook 随状态自动拉图），下一次提交自动带上
        setLoginNeedCaptcha(true);
        setError("登录失败次数较多，请输入图形验证码后重试");
      } else if (code === "captcha_invalid") {
        loginForm.setFieldValue("captchaCode", "");
        void loginCaptcha.refresh();
        setError(memberErrorText(err));
      } else {
        setError(memberErrorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  /** 注册页「发送验证码」：先校验标识为邮箱形态且图形码已填，再带当前图形码发信 */
  const sendRegisterEmailCode = async () => {
    setError(null);
    const identifier =
      (registerForm.getFieldValue("identifier") as string | undefined)?.trim() ??
      "";
    const captchaCode =
      (registerForm.getFieldValue("captchaCode") as string | undefined)?.trim() ??
      "";
    if (!EMAIL_RE.test(identifier)) {
      setError("请先填写邮箱作为标识，再获取邮箱验证码");
      return;
    }
    if (!registerCaptcha.captcha || !captchaCode) {
      setError("请先填写图形验证码，再获取邮箱验证码");
      return;
    }
    setBusy(true);
    try {
      await memberApi.sendMemberEmailCode(appId, {
        email: identifier,
        captchaId: registerCaptcha.captcha.id,
        captchaCode,
      });
      registerCountdown.start();
      setRegisterMailHint(null);
      setRegisterSentHint(
        "邮箱验证码已发送，请查收邮箱（10 分钟内有效）；图形验证码已刷新，提交注册时请填写新的图形验证码",
      );
      // 发码已消费本次图形验证码：换新图并清空输入，提交时用新码
      registerForm.setFieldValue("captchaCode", "");
      void registerCaptcha.refresh();
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "mail_not_configured") {
        setRegisterMailHint("邮件服务尚未配置，可直接注册");
      } else if (code === "captcha_invalid") {
        registerForm.setFieldValue("captchaCode", "");
        void registerCaptcha.refresh();
        setError(memberErrorText(err));
      } else {
        setError(memberErrorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (v: {
    identifier: string;
    password: string;
    displayName?: string;
    captchaCode?: string;
    emailCode?: string;
  }) => {
    const captchaCode = (v.captchaCode ?? "").trim();
    if (!registerCaptcha.captcha || !captchaCode) {
      setError("请输入图形验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      finish(
        await memberApi.register(appId, {
          identifier: v.identifier.trim(),
          password: v.password,
          displayName: v.displayName?.trim() || undefined,
          captchaId: registerCaptcha.captcha.id,
          captchaCode,
          emailCode: v.emailCode?.trim() || undefined,
        }),
      );
    } catch (err) {
      if (memberErrorCode(err) === "captcha_invalid") {
        registerForm.setFieldValue("captchaCode", "");
        void registerCaptcha.refresh();
      }
      setError(memberErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** 找回页「发送验证码」：发码与找回请求同一端点（带图形验证码校验） */
  const sendResetEmailCode = async () => {
    setError(null);
    const email =
      (resetForm.getFieldValue("email") as string | undefined)?.trim() ?? "";
    const captchaCode =
      (resetForm.getFieldValue("captchaCode") as string | undefined)?.trim() ??
      "";
    if (!EMAIL_RE.test(email)) {
      setError("请先填写注册邮箱，再获取验证码");
      return;
    }
    if (!resetCaptcha.captcha || !captchaCode) {
      setError("请先填写图形验证码，再获取验证码");
      return;
    }
    setBusy(true);
    try {
      await memberApi.requestMemberPasswordReset(appId, {
        email,
        captchaId: resetCaptcha.captcha.id,
        captchaCode,
      });
      resetCountdown.start();
      setResetSentHint("重置验证码已发送，请查收邮箱（10 分钟内有效）");
      resetForm.setFieldValue("captchaCode", "");
      void resetCaptcha.refresh();
    } catch (err) {
      const code = memberErrorCode(err);
      if (code === "mail_not_configured") {
        setResetMailOff(true);
      } else if (code === "captcha_invalid") {
        resetForm.setFieldValue("captchaCode", "");
        void resetCaptcha.refresh();
        setError(memberErrorText(err));
      } else {
        setError(memberErrorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (v: {
    email: string;
    emailCode?: string;
    newPassword: string;
  }) => {
    const emailCode = (v.emailCode ?? "").trim();
    if (!emailCode) {
      setError("请输入邮箱验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await memberApi.confirmMemberPasswordReset(appId, {
        email: v.email.trim(),
        code: emailCode,
        newPassword: v.newPassword,
      });
      // 成功回登录页签：预填标识 + 成功提示，用新密码登录
      setView("auth");
      setTab("login");
      setResetSentHint(null);
      loginForm.setFieldValue("identifier", v.email.trim());
      setNotice("密码已重置，请使用新密码登录");
    } catch (err) {
      setError(memberErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const identifierField = (
    <Form.Item
      label="标识（手机号 / 邮箱 / 用户名）"
      name="identifier"
      rules={[{ required: true, message: "请输入标识" }]}
    >
      <Input autoComplete="username" placeholder="注册时使用的标识" />
    </Form.Item>
  );

  const errorAlert = error ? (
    <Alert type="error" message={error} style={{ marginBottom: 16 }} />
  ) : null;

  const backToLogin = () => {
    setView("auth");
    setTab("login");
    setError(null);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={view === "reset" ? "找回密码" : "会员中心"}
      destroyOnClose
    >
      {view === "reset" ? (
        <>
          {errorAlert}
          <Form
            form={resetForm}
            layout="vertical"
            onFinish={(v) => void submitReset(v)}
          >
            <Form.Item
              label="注册邮箱"
              name="email"
              rules={[{ required: true, message: "请输入注册邮箱" }]}
            >
              <Input autoComplete="email" placeholder="注册时使用的邮箱" />
            </Form.Item>
            <CaptchaRow
              captcha={resetCaptcha.captcha}
              onRefresh={() => void resetCaptcha.refresh()}
            />
            <EmailCodeRow
              onSend={() => void sendResetEmailCode()}
              sendDisabled={busy || resetMailOff || resetCountdown.seconds > 0}
              sendText={
                resetCountdown.seconds > 0
                  ? `${resetCountdown.seconds} 秒后重发`
                  : "发送验证码"
              }
            />
            <CodeHint
              text={resetMailOff ? "邮件服务尚未配置，暂无法找回密码" : null}
              tone="secondary"
            />
            <CodeHint
              text={resetMailOff ? null : resetSentHint}
              tone="success"
            />
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 8, message: "密码至少 8 位" },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              确认重置
            </Button>
            <Button
              type="link"
              block
              style={{ marginTop: 8 }}
              onClick={backToLogin}
            >
              返回登录
            </Button>
          </Form>
        </>
      ) : (
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k as "login" | "register");
          setError(null);
        }}
        items={[
          {
            key: "login",
            label: "会员登录",
            children: (
              <>
                {notice && (
                  <Alert
                    type="success"
                    message={notice}
                    style={{ marginBottom: 16 }}
                  />
                )}
                {errorAlert}
                <Form
                  form={loginForm}
                  layout="vertical"
                  onFinish={(v) => void submitLogin(v)}
                >
                  {identifierField}
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[{ required: true, message: "请输入密码" }]}
                  >
                    <Input.Password autoComplete="current-password" />
                  </Form.Item>
                  {loginNeedCaptcha && (
                    <CaptchaRow
                      captcha={loginCaptcha.captcha}
                      onRefresh={() => void loginCaptcha.refresh()}
                    />
                  )}
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    登录
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, marginTop: 8 }}
                    onClick={() => {
                      setView("reset");
                      setError(null);
                    }}
                  >
                    忘记密码？
                  </Button>
                </Form>
              </>
            ),
          },
          {
            key: "register",
            label: "注册",
            children: (
              <>
                {errorAlert}
                <Form
                  form={registerForm}
                  layout="vertical"
                  onFinish={(v) => void submitRegister(v)}
                >
                  {identifierField}
                  <Form.Item label="昵称（选填）" name="displayName">
                    <Input placeholder="站内显示名，缺省用标识" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    rules={[
                      { required: true, message: "请输入密码" },
                      { min: 8, message: "密码至少 8 位" },
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <CaptchaRow
                    captcha={registerCaptcha.captcha}
                    onRefresh={() => void registerCaptcha.refresh()}
                  />
                  <EmailCodeRow
                    onSend={() => void sendRegisterEmailCode()}
                    sendDisabled={busy || registerCountdown.seconds > 0}
                    sendText={
                      registerCountdown.seconds > 0
                        ? `${registerCountdown.seconds} 秒后重发`
                        : "发送验证码"
                    }
                  />
                  <CodeHint text={registerMailHint} tone="secondary" />
                  <CodeHint
                    text={registerMailHint ? null : registerSentHint}
                    tone="success"
                  />
                  <Button type="primary" htmlType="submit" block loading={busy}>
                    注册并登录
                  </Button>
                </Form>
              </>
            ),
          },
        ]}
      />
      )}
    </Modal>
  );
}

/** 页眉会员区：已登录显示昵称/标识 + 退出；未登录显示「会员登录」「注册」。站点页眉只留会员区，员工入口在页脚（SiteFooter 的低调文字链） */
function MemberArea({
  session,
  small,
  onLogin,
  onRegister,
  onLogout,
}: {
  session: MemberSession | null;
  small?: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onLogout: () => void;
}) {
  const size = small ? ("small" as const) : undefined;
  if (session) {
    return (
      <Space size={small ? 6 : 8}>
        <Typography.Text
          style={{ maxWidth: 140 }}
          ellipsis
          title={session.member.identifier}
        >
          {session.member.displayName || session.member.identifier}
        </Typography.Text>
        <Button size={size} onClick={onLogout}>
          退出
        </Button>
      </Space>
    );
  }
  return (
    <Space size={small ? 6 : 8}>
      <Button size={size} onClick={onLogin}>
        会员登录
      </Button>
      <Button size={size} onClick={onRegister}>
        注册
      </Button>
    </Space>
  );
}

/** 页眉购物车入口（商城线）：角标 = 本地购物车总件数，订阅 cartStore 变更刷新；仅快照含 /cart 页时由外壳渲染 */
function CartEntry({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState<number>(() => cartStore.count());
  useEffect(
    () => cartStore.subscribe(() => setCount(cartStore.count())),
    [],
  );
  return (
    <Badge count={count} size="small">
      <Button size="small" onClick={onOpen}>
        购物车
      </Button>
    </Badge>
  );
}

/**
 * 沙箱支付页 / 收银台（商城线，外壳级内置路由 `#/pay/sandbox`，pay 响应 payUrl 直达；
 * 与 §7 收银台口径双模式）：
 * - **收银台模式**（query 带签名令牌 t，pay 流程恒带）：令牌即收银台凭据，
 *   **不要求会员会话**——展示金额/订单号/支付单号 + 本页绝对 URL 的二维码
 *   （供另一设备扫码打开同一收银台）+ URL 文本兜底（可复制）；「确认支付」/
 *   「模拟支付失败」走 POST /pay/sandbox/confirm（令牌确认结算），并定时轮询
 *   GET /pay/sandbox/status 刷新状态；支付成功后：本设备有会员会话则跳订单详情，
 *   无会话停在成功页（扫码设备无会话是常态）。
 * - **会员模式**（无 t）：回退原契约路径，须会员会话，经 simulate 端点模拟
 *   （服务端内部走同一验签 + 结算路径），完成后跳订单详情；无会话先引导登录。
 */
function SandboxPayPage({
  appId,
  params,
  session,
  getToken,
  onLogin,
  onUnauthorized,
  goPage,
}: {
  appId: string;
  params: Record<string, string>;
  session: MemberSession | null;
  getToken: () => string | null;
  onLogin: () => void;
  onUnauthorized: () => void;
  goPage: (to: string) => void;
}) {
  const paymentId = params.paymentId ?? "";
  const orderId = params.orderId ?? "";
  const amount = params.amount ?? "";
  const tradeNo = params.tradeNo ?? "";
  const token = params.t ?? "";
  const cashier = token.length > 0;
  /** 收银台绝对 URL：payUrl 为相对形态（/#/pay/sandbox?…），以当前页地址为准拼绝对形态供扫码/复制 */
  const absoluteUrl = window.location.href;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"success" | "fail" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [ordStatus, setOrdStatus] = useState<string | null>(null);
  const [memberDone, setMemberDone] = useState<"success" | "fail" | null>(
    null,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const jumpedRef = useRef(false);

  const goOrder = useCallback(() => {
    if (orderId) {
      goPage(`/my-orders/detail?id=${encodeURIComponent(orderId)}`);
    }
  }, [goPage, orderId]);

  // 收银台模式：二维码（本页绝对 URL，约 200px）
  useEffect(() => {
    if (!cashier) return;
    let alive = true;
    QRCode.toDataURL(absoluteUrl, { width: 200, margin: 1 })
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch(() => {
        // 二维码生成失败不阻断支付：下方有 URL 文本兜底
      });
    return () => {
      alive = false;
    };
  }, [cashier, absoluteUrl]);

  // 收银台模式：状态轮询（支付单离开「待支付」即停轮询）
  useEffect(() => {
    if (!cashier) return;
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const s = await fetchSandboxPaymentStatus(token);
        if (!alive) return;
        setPayStatus(s.paymentStatus);
        setOrdStatus(s.orderStatus);
        if (s.paymentStatus === "待支付") {
          timer = window.setTimeout(() => void poll(), 2500);
        }
      } catch {
        // 轮询失败（令牌过期等）不刷屏：停轮询，错误经确认动作再呈现
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [cashier, token]);

  // 收银台支付成功：有会员会话跳订单详情，无会话停在成功页
  useEffect(() => {
    if (!cashier || payStatus !== "成功" || jumpedRef.current) return;
    if (sessionRef.current && orderId) {
      jumpedRef.current = true;
      const timer = window.setTimeout(goOrder, 800);
      return () => window.clearTimeout(timer);
    }
  }, [cashier, payStatus, orderId, goOrder]);

  const confirmCashier = async (result: "success" | "fail") => {
    setBusy(result);
    setError(null);
    try {
      const s = await confirmSandboxPayment(token, result);
      if (s.paymentStatus) setPayStatus(s.paymentStatus);
      if (s.orderStatus) setOrdStatus(s.orderStatus);
      // 成功/失败后主动刷一次状态（轮询可能已因终态停止）
      try {
        const st = await fetchSandboxPaymentStatus(token);
        setPayStatus(st.paymentStatus);
        setOrdStatus(st.orderStatus);
      } catch {
        // 状态刷新失败不影响已完成的确认结果
      }
    } catch (err) {
      setError(memberErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  const simulateMember = async (result: "success" | "fail") => {
    if (!paymentId) {
      setError("缺少支付单参数");
      return;
    }
    setBusy(result);
    setError(null);
    try {
      await simulateMemberPayment(
        appId,
        getToken,
        paymentId,
        result,
        onUnauthorized,
      );
      setMemberDone(result);
      window.setTimeout(goOrder, 600);
    } catch (err) {
      setError(memberErrorText(err));
    } finally {
      setBusy(null);
    }
  };

  const paid = payStatus === "成功" || ordStatus === "已支付";
  const failed = payStatus === "失败" || payStatus === "已关闭";

  return (
    <div style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <Card title={cashier ? "沙箱收银台" : "沙箱支付"}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="订单号">
            {orderId || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="支付单号">
            {tradeNo || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="应付金额">
            <Typography.Text strong style={{ fontSize: 18, color: "#cf1322" }}>
              {amount ? `¥${amount}` : "—"}
            </Typography.Text>
          </Descriptions.Item>
          {cashier && (payStatus || ordStatus) && (
            <Descriptions.Item label="支付状态">
              {payStatus ?? "—"}
              {ordStatus ? `（订单：${ordStatus}）` : ""}
            </Descriptions.Item>
          )}
        </Descriptions>

        {cashier && !paid && !failed && (
          <div style={{ textAlign: "center", margin: "16px 0 4px" }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="收银台二维码"
                style={{ width: 200, height: 200 }}
              />
            ) : (
              <div style={{ height: 200, lineHeight: "200px", color: "#999" }}>
                二维码生成中…
              </div>
            )}
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, margin: "4px 0 0" }}
            >
              用另一台设备扫码打开同一收银台完成支付
            </Typography.Paragraph>
            <Typography.Text
              copyable
              style={{
                fontSize: 12,
                wordBreak: "break-all",
                display: "block",
                marginTop: 4,
              }}
            >
              {absoluteUrl}
            </Typography.Text>
          </div>
        )}

        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: 12 }}
        >
          {cashier
            ? "演示环境沙箱收银台：确认支付将把订单置为已支付；模拟失败则支付单置失败、订单保持待支付可再次支付。收银台链接有时效，请勿转发给无关人员。"
            : "演示环境沙箱支付：确认支付后，订单将变为已支付；模拟失败则支付单置失败、订单保持待支付可再次支付。"}
        </Typography.Paragraph>

        {error && (
          <Alert type="error" message={error} style={{ marginBottom: 12 }} />
        )}
        {cashier && paid && (
          <Alert
            type="success"
            message={
              session
                ? "支付成功，正在跳转订单详情…"
                : "支付成功！可返回下单设备查看订单。"
            }
            style={{ marginBottom: 12 }}
          />
        )}
        {cashier && failed && (
          <Alert
            type="warning"
            message="支付未完成（支付单已失败/关闭），订单保持待支付，可返回订单重新发起支付。"
            style={{ marginBottom: 12 }}
          />
        )}
        {memberDone === "success" && (
          <Alert
            type="success"
            message="支付成功，正在跳转订单详情…"
            style={{ marginBottom: 12 }}
          />
        )}
        {memberDone === "fail" && (
          <Alert
            type="warning"
            message="已模拟支付失败，正在跳转订单详情…"
            style={{ marginBottom: 12 }}
          />
        )}

        {!cashier && !session ? (
          <Space>
            <Button type="primary" onClick={onLogin}>
              会员登录
            </Button>
            {orderId && <Button onClick={goOrder}>返回订单详情</Button>}
          </Space>
        ) : cashier ? (
          !paid &&
          !failed && (
            <Space>
              <Button
                type="primary"
                loading={busy === "success"}
                disabled={busy !== null}
                onClick={() => void confirmCashier("success")}
              >
                确认支付
              </Button>
              <Button
                danger
                loading={busy === "fail"}
                disabled={busy !== null}
                onClick={() => void confirmCashier("fail")}
              >
                模拟支付失败
              </Button>
            </Space>
          )
        ) : (
          <Space>
            <Button
              type="primary"
              loading={busy === "success"}
              disabled={busy !== null || memberDone !== null}
              onClick={() => void simulateMember("success")}
            >
              确认支付
            </Button>
            <Button
              danger
              loading={busy === "fail"}
              disabled={busy !== null || memberDone !== null}
              onClick={() => void simulateMember("fail")}
            >
              模拟支付失败
            </Button>
            {orderId && <Button onClick={goOrder}>返回订单详情</Button>}
          </Space>
        )}
      </Card>
    </div>
  );
}

/**
 * 公开外壳（匿名访客）：顶栏应用名 + 登录按钮；菜单走与登录外壳同一套页面 menu 装配；
 * 内容由公开适配器渲染（服务端按公开策略整形数据）、应用主题同样生效。
 * M10：主应用 shell = site 时演进为站点形态（品牌顶栏 + 横排栏目导航 + 搜索 + 页脚、无侧栏）；
 * 非 site 的公开页（如采购公开目录）保持原顶栏 + 侧栏形态不变。
 */
function PublicShell({
  primary,
  inPath,
  params,
  device,
  onLogin,
  memberSso,
  basePrefix = "",
}: {
  primary: NonNullable<PublicSiteResult["primary"]>;
  inPath: string;
  params: Record<string, string>;
  device: Device;
  onLogin: () => void;
  /** 会员 SSO 开关（/public/site 下发）：enabled 时会员登录入口改走会员中心授权流 */
  memberSso?: MemberSsoInfo | null;
  /** 站点路径前缀（路径作用域时为 /<应用段>，其余为空）：站内链接统一拼回 */
  basePrefix?: string;
}) {
  const goPage = useCallback(
    (to: string) => {
      navigateTo(`${basePrefix}${to}`);
    },
    [basePrefix],
  );
  // 公开表单提交在渲染器内走既有「保存成功」提示路径，这里改写为待审口径
  const publicNotify = useCallback(
    (message: string, kind: "ok" | "error" = "ok") => {
      notify(message === "保存成功" ? "已提交，等待审核" : message, kind);
    },
    [],
  );

  /* 会员态（会员试点）：primary.member.pages 非空才启用。会话存 localStorage
     并在此恢复；会员页以会员适配器渲染、公开页照旧公开适配器（按当前页切换）。 */
  const memberPolicy: MemberPolicy = primary.member ?? EMPTY_MEMBER_POLICY;
  const memberPages = memberPolicy.pages;
  const hasMemberPages = memberPages.length > 0;
  /* 会员专属页 = 会员页 − 公开页：同列两边的页面按公开渲染——member.pages 是
     「会员可达页」口径，与公开页天然可重叠（如商城商品页），公开优先不设门。 */
  const publicPageRoutes: string[] = primary.public?.pages ?? [];
  const memberOnlyPages = memberPages.filter((p) => !publicPageRoutes.includes(p));
  const host = window.location.host;
  const [memberSession, setMemberSession] = useState<MemberSession | null>(
    () => (hasMemberPages ? loadMemberSession(host, primary.appId) : null),
  );
  const [authModal, setAuthModal] = useState<{
    open: boolean;
    tab: "login" | "register";
  }>({ open: false, tab: "login" });
  const memberTokenRef = useRef<string | null>(memberSession?.token ?? null);
  memberTokenRef.current = memberSession?.token ?? null;
  const memberSessionRef = useRef<MemberSession | null>(memberSession);
  memberSessionRef.current = memberSession;

  const clearMemberSession = useCallback(() => {
    storeMemberSession(host, null);
    setMemberSession(null);
  }, [host]);

  // 恢复会话时经 /me 刷新简档与策略（策略随新版本发布变化）；401 自动清会话回落
  const restoredToken = memberSession?.token ?? null;
  useEffect(() => {
    if (!restoredToken) return;
    let alive = true;
    memberApi
      .me(primary.appId, () => restoredToken, () => {
        if (alive) clearMemberSession();
      })
      .then((res) => {
        if (!alive) return;
        setMemberSession((prev) => {
          if (!prev || prev.token !== restoredToken) return prev;
          const next: MemberSession = {
            ...prev,
            member: res.member,
            policy: res.policy,
            roles: res.roles ?? [],
          };
          storeMemberSession(host, next);
          return next;
        });
      })
      .catch(() => {
        // 网络失败等：保留本地会话，下次数据请求 401 时再清
      });
    return () => {
      alive = false;
    };
    // 仅在挂载（或主应用切换）时刷新一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary.appId]);

  /**
   * 会员登录/注册的统一入口（页眉、导航守卫、会员页占位、收银台、组件钩子
   * 全部经此）：SSO 启用时整页跳会员中心授权流（回跳路径 = 当前页），
   * 未启用/未下发时打开本地弹窗——行为与原实现一字不变。
   */
  const openAuth = useCallback(
    (tab: "login" | "register") => {
      if (memberSso?.enabled && memberSso.centerBase) {
        window.location.assign(
          beginSsoAuthorize(
            memberSso.centerBase,
            primary.appId,
            window.location.pathname + window.location.search,
          ),
        );
        return;
      }
      setAuthModal({ open: true, tab });
    },
    [memberSso, primary.appId],
  );

  /**
   * 商城线会员钩子：公开页上的组件（CartView）借此判定会员会话、拉起登录弹窗、
   * 经会话令牌结算。getSession 走 ref 读最新会话，适配器本身不随会话变化重建。
   */
  const memberHooks = useMemo<MemberAdapterHooks>(
    () => ({
      getSession: () => memberSessionRef.current,
      openLogin: () => openAuth("login"),
      onUnauthorized: clearMemberSession,
    }),
    [openAuth, clearMemberSession],
  );

  const adapter = useMemo(
    () => makePublicAdapter(primary.appId, goPage, publicNotify, memberHooks),
    [primary.appId, goPage, publicNotify, memberHooks],
  );

  // 适配器只经 ref 读令牌与会话（makeMemberAdapter 入参为令牌 getter + memberHooks），
  // 身份以令牌为准：依赖收窄到 token 字符串，/me 刷新简档（同令牌、换会话对象）
  // 不再触发适配器换代与会员面全量重拉
  const memberToken = memberSession?.token ?? null;
  const memberAdapter = useMemo(
    () =>
      memberToken
        ? makeMemberAdapter(
            primary.appId,
            goPage,
            notify,
            () => memberTokenRef.current,
            clearMemberSession,
            memberHooks,
          )
        : null,
    [primary.appId, goPage, memberToken, clearMemberSession, memberHooks],
  );

  /** 导航守卫：未登录点会员页先弹登录弹窗（页面照常切过去，内容区呈占位引导） */
  const goPageGuarded = useCallback(
    (to: string) => {
      const path = to.split("?")[0]!;
      if (memberOnlyPages.includes(path) && !memberSession) openAuth("login");
      goPage(to);
    },
    [goPage, memberOnlyPages, memberSession, openAuth],
  );

  const menu = assembleMenu(primary.pages, primary.data.entities);
  const current = resolveCurrentPage(primary.pages, menu, inPath);
  const token = themeTokenOf(primary.appConfig);

  // 呈现门控与公开策略对齐：可读实体只读、公开表单实体可新建，避免露出无权入口（服务端仍强制）
  const access = useMemo(() => {
    const entities: Record<string, EntityAccess> = {};
    for (const e of primary.data.entities) {
      entities[e.key] = {
        actions: primary.public.forms.includes(e.key)
          ? ["read", "create"]
          : ["read"],
        fields: {},
      };
    }
    return entities;
  }, [primary]);

  // 会员页呈现门控与会员策略对齐：可写实体可新建/改己行、可读实体只读（服务端仍强制归属）
  const memberAccess = useMemo(() => {
    const entities: Record<string, EntityAccess> = {};
    for (const e of primary.data.entities) {
      if (memberPolicy.writable.includes(e.key)) {
        entities[e.key] = { actions: ["read", "create", "update"], fields: {} };
      } else if (memberPolicy.readable.includes(e.key)) {
        entities[e.key] = { actions: ["read"], fields: {} };
      } else {
        entities[e.key] = { actions: [], fields: {} };
      }
    }
    return entities;
  }, [primary, memberPolicy]);

  const publicContent = current ? (
    <SchemaRenderer
      page={current}
      dataSchema={primary.data}
      adapter={adapter}
      params={params}
      device={device}
      access={access}
      theme={primary.appConfig?.theme}
    />
  ) : (
    <Typography.Text type="secondary">页面不存在：{inPath}</Typography.Text>
  );

  /** 当前页是否会员页：会员页登录后以会员适配器渲染，未登录呈占位引导（不跳员工登录页） */
  const isMemberPage = !!current && memberOnlyPages.includes(current.route);
  const content =
    isMemberPage && current ? (
      memberSession && memberAdapter ? (
        <SchemaRenderer
          page={current}
          dataSchema={primary.data}
          adapter={memberAdapter}
          params={params}
          device={device}
          access={memberAccess}
          theme={primary.appConfig?.theme}
        />
      ) : (
        <div style={{ maxWidth: 520, margin: "48px auto", textAlign: "center" }}>
          <Alert
            type="info"
            showIcon
            message="请先登录会员账号"
            description="本页面仅对已登录会员开放。登录后即可继续访问；还没有账号可先注册。"
            style={{ marginBottom: 16, textAlign: "left" }}
          />
          <Space size={8}>
            <Button type="primary" onClick={() => openAuth("login")}>
              会员登录
            </Button>
            <Button onClick={() => openAuth("register")}>注册</Button>
          </Space>
        </div>
      )
    ) : (
      publicContent
    );

  /**
   * 沙箱收银台（商城线 §7）：外壳级内置路由，不属任何应用设计页，
   * 命中时优先于页面内容渲染（收银台模式不要求会员会话、靠令牌进页）。
   */
  const pageContent =
    inPath === "/pay/sandbox" ? (
      <SandboxPayPage
        appId={params.appId || primary.appId}
        params={params}
        session={memberSession}
        getToken={() => memberTokenRef.current}
        onLogin={() => openAuth("login")}
        onUnauthorized={clearMemberSession}
        goPage={goPage}
      />
    ) : (
      content
    );

  /** 快照含 /cart 页时页眉才出现购物车入口（商城线） */
  const hasCartPage = primary.pages.some((p) => p.route === "/cart");

  /** 页眉右侧区：仅会员区（启用会员页时）；员工「登录」已按入口分离口径移至页脚文字链 */
  const memberArea = (small?: boolean) =>
    hasMemberPages ? (
      <MemberArea
        session={memberSession}
        small={small}
        onLogin={() => openAuth("login")}
        onRegister={() => openAuth("register")}
        onLogout={clearMemberSession}
      />
    ) : null;

  const memberModal = hasMemberPages ? (
    <MemberAuthModal
      appId={primary.appId}
      open={authModal.open}
      initialTab={authModal.tab}
      onClose={() => setAuthModal((s) => ({ ...s, open: false }))}
      onAuthed={(session) => {
        setMemberSession(session);
        setAuthModal((s) => ({ ...s, open: false }));
      }}
    />
  ) : null;

  const cfg = configOf(primary.appConfig);
  if (isSiteShell(cfg)) {
    const brand = brandTextOf(cfg, primary.name);
    return (
      <ConfigProvider locale={zhCN} theme={{ token }}>
        <Layout style={{ minHeight: "100vh" }}>
          <SiteHeader
            brand={brand}
            navItems={flatNavItems(menu.items)}
            selectedKey={current ? current.route : null}
            onNavigate={goPageGuarded}
            searchRoute={globalVarText(cfg, "siteSearchRoute")}
            right={
              <Space size={8}>
                {hasCartPage && (
                  <CartEntry onOpen={() => goPageGuarded("/cart")} />
                )}
                {memberArea()}
              </Space>
            }
          />
          <Layout.Content
            style={{
              padding: device === "mobile" ? "16px 12px" : "24px 28px",
              background: "#fff",
            }}
          >
            {pageContent}
          </Layout.Content>
          <SiteFooter text={siteFooterText(cfg, brand)} onStaffLogin={onLogin} />
        </Layout>
        {memberModal}
      </ConfigProvider>
    );
  }

  /* 公开面移动形态（M13）：与登录外壳同一移动外壳，顶栏保留登录入口；
     站点型公开面不套用底部导航（上方 site 分支仅调整窄屏内边距） */
  if (device === "mobile") {
    return (
      <ConfigProvider locale={zhCN} theme={{ token }}>
        <MobileShell
          title={primary.name}
          entries={flattenMenuEntries(menu.items)}
          selectedKey={current ? current.route : null}
          onNavigate={goPageGuarded}
          topRight={
            <Space size={6}>
              {memberArea(true)}
              <Button type="primary" size="small" onClick={onLogin}>
                登录
              </Button>
            </Space>
          }
        >
          {pageContent}
        </MobileShell>
        {memberModal}
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={zhCN} theme={{ token }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Layout.Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>{primary.name}</span>
          <Space size={8}>
            {memberArea()}
            <Button type="primary" onClick={onLogin}>
              登录
            </Button>
          </Space>
        </Layout.Header>
        <Layout>
          <Layout.Sider
            theme="light"
            width={220}
            style={{ borderRight: "1px solid #f0f0f0" }}
          >
            <Menu
              mode="inline"
              selectedKeys={current ? [current.route] : []}
              style={{
                borderInlineEnd: "none",
                background: "transparent",
                marginTop: 12,
              }}
              items={menu.items}
              onClick={({ key }) => goPageGuarded(key)}
            />
          </Layout.Sider>
          <Layout.Content style={{ padding: "24px 28px", background: "#fff" }}>
            {pageContent}
          </Layout.Content>
        </Layout>
        {memberModal}
      </Layout>
    </ConfigProvider>
  );
}

/**
 * 站点视图（第 68 步引导）：按域名 + 首段路径经 /site/current 解析作用域——
 * 应用作用域单应用装配（路径作用域带 /<应用段> 前缀）；shell 兜底装配 =
 * 主应用 + 未绑应用；根域整页跳默认域名；会员中心域渲染内置中心页组。
 * 跨应用聚合（待办计数）经 aggregateApps 走站点目录全量，与装配集分离。
 */
function EntryView({
  inPath,
  params,
  user,
  onLogout,
  device,
}: {
  inPath: string;
  params: Record<string, string>;
  user: UserInfo;
  onLogout: () => void;
  device: Device;
}) {
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .site(window.location.host, decodedSeg(window.location.pathname))
      .then((r) => {
        if (alive) setSite(r.site);
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (site?.mode === "redirect") redirectToDefaultHost(site.defaultHost);
  }, [site]);

  if (error) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
        <Button onClick={onLogout}>退出登录</Button>
      </div>
    );
  }
  if (!site || site.mode === "redirect") {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在解析站点…" />
      </div>
    );
  }
  if (site.mode === "member-center") {
    return <MemberCenterApp route={{ path: inPath, params }} />;
  }
  const directory: AppInfo[] = site.apps.map((d) => ({
    id: d.id,
    name: d.name,
    scenario: d.scenario,
  }));
  if (site.mode === "shell") {
    const assembled = site.apps
      .filter((d) => d.isPrimary || !d.boundHost)
      .map((d) => ({ id: d.id, name: d.name, scenario: d.scenario }))
      .sort((a, b) => {
        const pa = site.apps.find((d) => d.id === a.id)?.isPrimary ? 0 : 1;
        const pb = site.apps.find((d) => d.id === b.id)?.isPrimary ? 0 : 1;
        return pa - pb;
      });
    if (assembled.length === 0) {
      return (
        <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
          <Alert
            type="info"
            message="当前站点尚未有可用应用（先完成平台初始化）"
            style={{ marginBottom: 12 }}
          />
          <Button onClick={onLogout}>退出登录</Button>
        </div>
      );
    }
    return (
      <AppView
        apps={assembled}
        aggregateApps={directory}
        inPath={inPath}
        params={params}
        user={user}
        onLogout={onLogout}
        device={device}
        preview={false}
        entryName="默认站点"
      />
    );
  }
  // mode = app：单应用作用域
  const app = site.app!;
  const rawSeg = rawFirstSeg(inPath);
  const basePrefix = site.via === "path" && rawSeg ? `/${rawSeg}` : "";
  return (
    <AppView
      apps={[{ id: app.id, name: app.name, scenario: app.scenario }]}
      aggregateApps={directory}
      inPath={stripSitePrefix(inPath, basePrefix)}
      params={params}
      user={user}
      onLogout={onLogout}
      device={device}
      preview={false}
      entryName={app.name}
      basePrefix={basePrefix}
    />
  );
}

/** 菜单页：带 menu 声明的页面按 order 升序组装菜单（label/group 均取自页面声明） */
interface MenuPage {
  page: PageSchema;
  label: string;
  order: number;
  group?: string;
}

interface AssembledMenu {
  items: MenuProps["items"];
  menuPages: MenuPage[];
  listPages: PageSchema[];
}

/**
 * 菜单项构建（单应用与多应用合并共用同一算法）：
 * 有 menu 声明时按 order 升序（稳定排序，同 order 保持输入顺序），
 * 分组项在其首个成员的位置出现一次、汇集该组全部成员——跨应用同名分组由此自动合并；
 * 无任何 menu 声明时回退为列表页平铺项（fallbackItems 由调用方按各自实体口径算好标签）。
 *
 * 第 49 步菜单 IA：调用方给了 defaultGroupLabel 时（员工壳），未声明 group 的页面
 * 不再平铺混排，统一收进末尾的默认组（如「业务功能」）；公开/会员壳不传此参，
 * 保持旧平铺行为（C 端导航形态不套 B 端分区）。
 */
function buildMenuItems(
  menuPages: MenuPage[],
  fallbackItems: NonNullable<MenuProps["items"]>,
  defaultGroupLabel?: string,
): MenuProps["items"] {
  if (menuPages.length === 0) return fallbackItems;
  const arr: NonNullable<MenuProps["items"]> = [];
  const seenGroups = new Set<string>();
  const ungrouped: MenuPage[] = [];
  for (const mp of menuPages) {
    if (!mp.group) {
      if (defaultGroupLabel) {
        ungrouped.push(mp);
        continue;
      }
      arr.push({ key: mp.page.route, label: mp.label });
      continue;
    }
    if (seenGroups.has(mp.group)) continue;
    seenGroups.add(mp.group);
    arr.push({
      type: "group",
      key: `group:${mp.group}`,
      label: mp.group,
      children: menuPages
        .filter((g) => g.group === mp.group)
        .map((g) => ({ key: g.page.route, label: g.label })),
    });
  }
  if (defaultGroupLabel && ungrouped.length > 0) {
    arr.push({
      type: "group",
      key: `group:${defaultGroupLabel}`,
      label: defaultGroupLabel,
      children: ungrouped.map((mp) => ({
        key: mp.page.route,
        label: mp.label,
      })),
    });
  }
  return arr;
}

/**
 * 菜单组装核心：入参为带各自实体口径的页面集合（单应用即全量同属一应用；
 * 多应用为页面并集，实体口径按页所属应用取——回退标签解析不串应用）。
 */
function collectMenu(
  entries: { page: PageSchema; entities: DataSchema["entities"] }[],
  opts?: { defaultGroupLabel?: string },
): AssembledMenu {
  const menuPages: MenuPage[] = entries
    .filter((e) => e.page.menu && !e.page.menu.hidden)
    .map((e) => ({
      page: e.page,
      label: e.page.menu!.label,
      order: e.page.menu!.order ?? 0,
      group: e.page.menu!.group,
    }))
    .sort((a, b) => a.order - b.order);
  const listEntries = entries.filter((e) =>
    e.page.root.children?.some((ch) => ch.type === "DataTable"),
  );
  const navLabel = (page: PageSchema, entities: DataSchema["entities"]) => {
    const ref = page.dataSources[0]?.ref;
    const entity = entities.find((e) => e.key === ref);
    return entity?.label ?? page.name;
  };
  const items = buildMenuItems(
    menuPages,
    listEntries.map((e) => ({
      key: e.page.route,
      label: navLabel(e.page, e.entities),
    })),
    opts?.defaultGroupLabel,
  );
  return { items, menuPages, listPages: listEntries.map((e) => e.page) };
}

/**
 * 菜单组装（登录外壳与公开外壳共用同一逻辑）：
 * 页面 menu 声明优先；无任何页面声明 menu 时回退旧逻辑（列表页 + 实体名）。
 */
function assembleMenu(
  pages: PageSchema[],
  entities: DataSchema["entities"],
  opts?: { defaultGroupLabel?: string },
): AssembledMenu {
  return collectMenu(
    pages.map((page) => ({ page, entities })),
    opts,
  );
}

/* ---------- 多应用装配（M10）：入口全部应用的快照并集 ---------- */

/** 已加载快照的应用（顺序即入口 app_ids 顺序，首个为主应用） */
interface LoadedApp {
  app: AppInfo;
  snapshot: Snapshot;
}

/** 并集中的一页：页面本体 + 所属应用 */
interface OwnedPage {
  page: PageSchema;
  appId: string;
}

interface PageUnion {
  /** 全部页面（含路由冲突的落败页，顺序为应用序 → 页序） */
  all: OwnedPage[];
  /** 按路由去重后的页面（先到先得，菜单与解析都以此为准） */
  deduped: OwnedPage[];
  byRoute: Map<string, OwnedPage>;
}

/**
 * 页面并集：按入口应用顺序逐应用并入快照页面；
 * 同一路由被多个应用占用时先到先得，落败页保留在 all 中但不进菜单/解析，并 console 警告。
 */
function buildPageUnion(loaded: LoadedApp[]): PageUnion {
  const all: OwnedPage[] = [];
  const deduped: OwnedPage[] = [];
  const byRoute = new Map<string, OwnedPage>();
  for (const { app, snapshot } of loaded) {
    for (const page of snapshot.pages) {
      const owned: OwnedPage = { page, appId: app.id };
      all.push(owned);
      const winner = byRoute.get(page.route);
      if (winner) {
        console.warn(
          `[runtime] 路由冲突：${page.route} 已由应用 ${winner.appId} 占用，忽略应用 ${app.id} 的同名页面「${page.name}」`,
        );
        continue;
      }
      byRoute.set(page.route, owned);
      deduped.push(owned);
    }
  }
  return { all, deduped, byRoute };
}

/**
 * 跨应用合并菜单：对并集（去重后）页面跑同一套组装算法，同名分组跨应用合并。
 * 员工壳专用口径（第 49 步）：未声明 group 的页面收进默认组「业务功能」末尾成区，
 * 不与声明组混排；公开/会员壳走 assembleMenu、保持平铺。
 */
function assembleMergedMenu(
  union: PageUnion,
  loaded: LoadedApp[],
): AssembledMenu {
  const entitiesByApp = new Map(
    loaded.map((l) => [l.app.id, l.snapshot.data.entities] as const),
  );
  return collectMenu(
    union.deduped.map((o) => ({
      page: o.page,
      entities: entitiesByApp.get(o.appId) ?? [],
    })),
    { defaultGroupLabel: "业务功能" },
  );
}

/** 并集内当前页解析：口径同 resolveCurrentPage（根路径落首个菜单页 → route='/' 页 → 首个列表页） */
function resolveOwnedCurrent(
  union: PageUnion,
  menu: AssembledMenu,
  inPath: string,
): OwnedPage | undefined {
  if (inPath === "/") {
    const first =
      menu.menuPages[0]?.page ??
      union.deduped.find((o) => o.page.route === "/")?.page ??
      menu.listPages[0];
    return first ? union.byRoute.get(first.route) : undefined;
  }
  return union.byRoute.get(inPath);
}

/** 当前页解析：根路径落到首个菜单页，其次 route='/' 的页，再次首个列表页 */
function resolveCurrentPage(
  pages: PageSchema[],
  menu: AssembledMenu,
  inPath: string,
): PageSchema | undefined {
  if (inPath === "/") {
    return (
      menu.menuPages[0]?.page ??
      pages.find((p) => p.route === "/") ??
      menu.listPages[0]
    );
  }
  return pages.find((p) => p.route === inPath);
}

/** 主题令牌：应用配置里的 colorPrimary / borderRadius 注入 antd 主题 */
function themeTokenOf(appConfig: {
  theme: Record<string, unknown>;
} | null): {
  colorPrimary?: string;
  borderRadius?: number;
  colorBorder?: string;
} {
  const themeCfg = appConfig?.theme ?? {};
  // B 端视觉基线默认值（第 49 步）：应用主题未声明时按基线令牌走，声明了以应用为准
  const token: {
    colorPrimary?: string;
    borderRadius?: number;
    colorBorder?: string;
  } = { colorPrimary: "#1677ff", borderRadius: 6, colorBorder: "#e4e7ec" };
  if (typeof themeCfg.colorPrimary === "string") {
    token.colorPrimary = themeCfg.colorPrimary;
  }
  if (typeof themeCfg.borderRadius === "number") {
    token.borderRadius = themeCfg.borderRadius;
  }
  return token;
}

function AppView({
  apps,
  inPath,
  params,
  user,
  onLogout,
  device,
  preview,
  entryName,
  basePrefix = "",
  aggregateApps,
}: {
  /** 装配的应用（顺序敏感，首个为主应用）；站点模型下作用域单应用为单元素数组，预览模式同 */
  apps: AppInfo[];
  inPath: string;
  params: Record<string, string>;
  user: UserInfo;
  onLogout: () => void;
  device: Device;
  /** 预览模式：路径带 /app/<id> 前缀（设计台打开），顶栏提供返回入口首页 */
  preview: boolean;
  /** 入口名（侧栏副标题）；预览模式传 null 并显示「预览」 */
  entryName: string | null;
  /** 站点路径前缀（路径作用域时为 /<应用段>）：站内链接统一拼回；inPath 已由调用方剥除 */
  basePrefix?: string;
  /** 跨应用聚合集（待办计数等专用聚合面用）：缺省与装配集相同 */
  aggregateApps?: AppInfo[];
}) {
  const primaryAppId = apps[0]?.id ?? "";
  const appIdsKey = apps.map((a) => a.id).join(",");
  const [loaded, setLoaded] = useState<LoadedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 待办数（菜单 Badge）：多应用时为各应用待办之和 */
  const [todoCount, setTodoCount] = useState(0);
  /** 待办/助手跟随的当前应用：随当前页归属更新；停在外壳级视图（#/flow）时保持最近归属 */
  const [activeAppId, setActiveAppId] = useState<string>(primaryAppId);
  /** 桌面侧栏折叠态（持久化）：菜单可整栏收起，不长期占版面 */
  const [siderCollapsed, setSiderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("lcdp.siderCollapsed") === "1";
    } catch {
      return false;
    }
  });
  /** 侧栏分组展开：非受控（defaultOpenKeys）+ 按应用/折叠态换 key 重挂，
   * 避开受控 openKeys 在侧栏折叠模式切换时被 antd 内部回放污染的问题 */

  // 全部应用快照并行加载：主应用失败按原口径整页报错；
  // 其余应用失败仅从本次装配剔除并警告，不拖垮整个入口
  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setError(null);
    setActiveAppId(primaryAppId);
    void (async () => {
      const results = await Promise.all(
        apps.map(async (app, idx): Promise<LoadedApp | null> => {
          try {
            const snapshot = await api.snapshot(app.id);
            return { app, snapshot };
          } catch (err) {
            if (idx === 0) throw err;
            console.warn(
              `[runtime] 应用 ${app.id} 快照加载失败，已从本次装配中剔除`,
              err,
            );
            return null;
          }
        }),
      );
      if (alive) {
        setLoaded(results.filter((r): r is LoadedApp => r !== null));
      }
    })().catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      alive = false;
    };
    // apps 以 appIdsKey 标识（顺序敏感），primaryAppId 随之而变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdsKey]);

  /** 待办数刷新：逐聚合集应用拉取后求和，单个应用失败按 0 计（角标仅作提示）。
   * 聚合集与装配集分离（第 68 步）：单应用作用域下待办仍跨全站应用聚合，
   * 与「作用域由页面归属决定」不冲突——待办中心是专用聚合面。 */
  const todoApps = aggregateApps ?? apps;
  const todoAppsKey = todoApps.map((a) => a.id).join(",");
  const refreshTodoCount = useCallback(async () => {
    const counts = await Promise.all(
      todoApps.map((a) =>
        api.flow
          .todos(a.id)
          .then((tasks) => tasks.length)
          .catch(() => 0),
      ),
    );
    setTodoCount(counts.reduce((sum, n) => sum + n, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoAppsKey]);
  useEffect(() => {
    void refreshTodoCount();
  }, [refreshTodoCount]);
  /** FlowCenter 内动作后回告：不直接采用其单应用计数，统一重拉求和 */
  const handleTodoCountChange = useCallback(() => {
    void refreshTodoCount();
  }, [refreshTodoCount]);

  /** 待办中心是外壳级视图（/flow），不属于任何页面 Schema */
  const isFlow = inPath === "/flow";

  const goPage = useMemo(
    () =>
      (to: string) => {
        navigateTo(
          preview
            ? `/app/${encodeURIComponent(primaryAppId)}${to}`
            : `${basePrefix}${to}`,
        );
      },
    [primaryAppId, preview, basePrefix],
  );

  const union = useMemo(
    () => (loaded ? buildPageUnion(loaded) : null),
    [loaded],
  );
  /** 跨应用并集菜单仅用于当前页解析（根路径落点等），不再直接展示 */
  const mergedMenu = useMemo(
    () => (loaded && union ? assembleMergedMenu(union, loaded) : null),
    [loaded, union],
  );
  const currentOwned =
    union && mergedMenu
      ? resolveOwnedCurrent(union, mergedMenu, inPath)
      : undefined;

  useEffect(() => {
    if (currentOwned) setActiveAppId(currentOwned.appId);
  }, [currentOwned?.appId]);

  /** 渲染器适配器绑定当前页所属应用（无当前页时退回当前应用，仅作占位不会被调用） */
  const adapterAppId = currentOwned?.appId ?? activeAppId;
  const adapter = useMemo(
    () => makeAdapter(adapterAppId, goPage, notify),
    [adapterAppId, goPage],
  );

  if (error) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
        <Button
          onClick={() => {
            navigateTo(preview ? "/" : basePrefix || "/");
          }}
        >
          返回入口首页
        </Button>
      </div>
    );
  }
  if (!loaded || !union || !mergedMenu) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在加载应用…" />
      </div>
    );
  }

  const primary = loaded[0]!;
  const current = currentOwned?.page;
  /**
   * 客服咨询窗挂载门控（M12）：遍历已装配应用的 appConfig.globalVars.support，
   * 首个 {enabled:true} 命中即挂 SupportWidget 绑该应用；设计态预览不挂。
   */
  const supportTarget = !preview
    ? loaded.find((l) => {
        const s = configOf(l.snapshot.appConfig)?.globalVars?.support;
        return (
          !!s &&
          typeof s === "object" &&
          (s as { enabled?: unknown }).enabled === true
        );
      })
    : undefined;
  const supportFallbackTitle = (() => {
    const s = supportTarget
      ? configOf(supportTarget.snapshot.appConfig)?.globalVars?.support
      : undefined;
    const t =
      s && typeof s === "object" ? (s as { title?: unknown }).title : undefined;
    return typeof t === "string" && t ? t : undefined;
  })();
  const supportWidget = supportTarget ? (
    <SupportWidget
      appId={supportTarget.app.id}
      fallbackTitle={supportFallbackTitle}
    />
  ) : null;
  /** 当前页所属应用的快照（渲染取其数据模型与权限摘要） */
  const currentLoaded = currentOwned
    ? (loaded.find((l) => l.app.id === currentOwned.appId) ?? primary)
    : primary;
  /** 待办/助手所属应用：当前页归属优先，其次最近归属，兜底主应用 */
  const activeLoaded =
    loaded.find((l) => l.app.id === (currentOwned?.appId ?? activeAppId)) ??
    primary;
  /**
   * 展示菜单按当前应用作用域（2026-10-19 定调：菜单须根据应用本身获取，
   * 不能只按角色裁剪）：每个装配应用各自组装一份菜单，展示只取当前应用那份；
   * 跨应用并集仅用于路由解析——深链/待办跳转落到别的应用时，当前应用随当前页
   * 归属切换（activeAppId 既有跟随逻辑），菜单自动跟着换。
   */
  const scopedMenus = new Map(
    loaded.map(
      (l) =>
        [
          l.app.id,
          assembleMenu(l.snapshot.pages, l.snapshot.data.entities, {
            defaultGroupLabel: "业务功能",
          }),
        ] as const,
    ),
  );
  const menu: AssembledMenu = scopedMenus.get(activeLoaded.app.id) ?? mergedMenu;
  /**
   * 运行态不设应用切换控件（2026-10-19 用户纠正）：各应用是独立的业务维度，
   * 不存在「从采购跳去 CMS」这类导航场景；跨应用只发生在数据层互通与
   * 按需聚合的专用面（待办中心、用户中心等），当前作用域由所在页面归属
   * 自动决定（深链/待办跳转时 activeAppId 跟随）。应用上下文切换是管理台
   * （admin）的概念，不下放到运行态。
   */
  const token = themeTokenOf(primary.snapshot.appConfig);
  /**
   * 助手页面上下文（尽力推导）：派生实体路由（/e/<entity>[/form]）直接给 entityKey；
   * 设计页取其首个数据源绑定的实体；记录 id 取页面参数 id（编辑表单/详情页）。
   */
  const assistantContext: AssistantContext = (() => {
    const ctx: AssistantContext = { path: inPath };
    const derived = inPath.match(/^\/e\/([^/]+)(?:\/form)?\/?$/);
    if (derived) ctx.entityKey = decodeURIComponent(derived[1]!);
    if (current) {
      ctx.pageName = current.name;
      if (!ctx.entityKey) {
        const ref = current.dataSources?.[0]?.ref;
        if (ref) ctx.entityKey = ref;
      }
    }
    if (params.id) ctx.recordId = params.id;
    return ctx;
  })();
  /**
   * 左侧菜单（第 49 步 IA）：固定「工作台」组置顶（待办中心，外壳级视图），
   * 其后是页面菜单分区（声明组 + 默认组「业务功能」，见 assembleMergedMenu）。
   * 组名只写功能、不带应用名——当前应用看侧栏顶部标题区。
   */
  const menuItems: MenuProps["items"] = [
    {
      type: "group",
      key: "group:工作台",
      label: "工作台",
      children: [
        {
          key: "/flow",
          label: (
            <span>
              待办中心{" "}
              <Badge count={todoCount} size="small" offset={[2, -2]} />
            </span>
          ),
        },
      ],
    },
    ...(menu.items ?? []),
  ];

  /** 侧栏分组键（默认全展开；折叠/展开由 Menu 非受控自持，见 siderMenuItems 处 key 重挂口径） */
  const allGroupKeys = (menuItems ?? [])
    .filter((i) => (i as { type?: string } | null)?.type === "group")
    .map((i) => String((i as { key?: unknown }).key));
  /** 桌面侧栏专用形态：分组转可折叠子菜单；站点横排与移动拍平仍消费 group 形态 */
  const siderMenuItems: MenuProps["items"] = (menuItems ?? []).map((item) => {
    const it = item as {
      type?: string;
      key?: unknown;
      label?: ReactNode;
      children?: MenuProps["items"];
    } | null;
    if (it && it.type === "group" && Array.isArray(it.children)) {
      const { key, label, children } = it;
      if (typeof key === "string") return { key, label, children };
    }
    return item;
  });

  const content = isFlow ? (
    <FlowCenter
      key={activeLoaded.app.id}
      appId={activeLoaded.app.id}
      user={user}
      entities={activeLoaded.snapshot.data.entities}
      onTodoCountChange={handleTodoCountChange}
    />
  ) : current ? (
    <SchemaRenderer
      page={current}
      dataSchema={currentLoaded.snapshot.data}
      adapter={adapter}
      params={params}
      device={device}
      access={currentLoaded.snapshot.myAccess?.entities}
      theme={currentLoaded.snapshot.appConfig?.theme}
    />
  ) : (
    <Typography.Text type="secondary">页面不存在：{inPath}</Typography.Text>
  );

  /** 底部导航条目（M13 移动外壳）：待办中心（角标 = 多应用待办汇总，与侧栏同口径）+ 菜单模型拍平 */
  const navEntries: MobileNavEntry[] = [
    { key: "/flow", label: "待办中心", badge: todoCount },
    ...flattenMenuEntries(menu.items),
  ];

  const cfg = configOf(primary.snapshot.appConfig);
  /** 站点型外壳（M10）：仅入口模式且主应用声明 shell = site 时启用，预览恒走系统外壳 */
  if (!preview && isSiteShell(cfg)) {
    const brand = brandTextOf(cfg, primary.snapshot.app.name);
    return (
      <ConfigProvider locale={zhCN} theme={{ token }}>
        <Layout style={{ minHeight: "100vh" }}>
          <SiteHeader
            brand={brand}
            navItems={flatNavItems(menuItems)}
            selectedKey={isFlow ? "/flow" : current ? current.route : null}
            onNavigate={goPage}
            searchRoute={globalVarText(cfg, "siteSearchRoute")}
            right={
              <Space>
                <Button onClick={onLogout}>退出（{user.username}）</Button>
              </Space>
            }
          />
          <Layout.Content
            style={{
              padding: device === "mobile" ? "16px 12px" : "24px 28px",
              background: "#fff",
            }}
          >
            {content}
          </Layout.Content>
          <SiteFooter text={siteFooterText(cfg, brand)} />
        </Layout>
        <AssistantPanel
          appId={activeLoaded.app.id}
          context={assistantContext}
          navigate={goPage}
        />
        {supportWidget}
      </ConfigProvider>
    );
  }

  /* 移动外壳（M13）：系统型外壳在 mobile 时切换为顶栏 + 底部导航形态，桌面外壳零改动；
     站点型外壳不套用（只做视口回归，见上方 site 分支的窄屏内边距） */
  if (device === "mobile") {
    return (
      <ConfigProvider locale={zhCN} theme={{ token }}>
        <MobileShell
          title={activeLoaded.snapshot.app.name}
          entries={navEntries}
          selectedKey={isFlow ? "/flow" : current ? current.route : null}
          onNavigate={goPage}
          topRight={
            preview ? (
              <Button
                size="small"
                onClick={() => {
                  navigateTo("/");
                }}
              >
                入口首页
              </Button>
            ) : (
              <>
                <Button type="text" size="small" onClick={onLogout}>
                  退出
                </Button>
              </>
            )
          }
          moreFooter={
            <Button
              block
              size="large"
              style={{ minHeight: 48 }}
              onClick={onLogout}
            >
              退出（{user.username}）
            </Button>
          }
        >
          {content}
        </MobileShell>
        <AssistantPanel
          appId={activeLoaded.app.id}
          context={assistantContext}
          navigate={goPage}
        />
        {supportWidget}
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token,
        components: {
          Menu: { groupTitleColor: "#8a94a6", itemBorderRadius: 6 },
        },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Layout.Sider
          theme="light"
          width={220}
          collapsedWidth={64}
          collapsible
          collapsed={siderCollapsed}
          trigger={null}
          style={{
            borderRight: "1px solid #e4e7ec",
            position: "sticky",
            top: 0,
            height: "100vh",
            alignSelf: "flex-start",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              padding: "20px 12px",
              gap: 8,
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                padding: "0 8px",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              {!siderCollapsed && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {activeLoaded.snapshot.app.name}
                  </div>
                  <div
                    style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}
                  >
                    {preview ? "预览" : (entryName ?? "运行入口")}
                  </div>
                </div>
              )}
              <Button
                size="small"
                type="text"
                title={siderCollapsed ? "展开菜单" : "收起菜单"}
                onClick={() => {
                  const v = !siderCollapsed;
                  setSiderCollapsed(v);
                  try {
                    localStorage.setItem(
                      "lcdp.siderCollapsed",
                      v ? "1" : "0",
                    );
                  } catch {
                    /* 持久化失败不影响使用 */
                  }
                }}
              >
                {siderCollapsed ? "»" : "«"}
              </Button>
            </div>
            {preview && (
              <Button
                block
                onClick={() => {
                  navigateTo("/");
                }}
              >
                返回入口首页
              </Button>
            )}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              <Menu
                key={`${activeLoaded.app.id}:${siderCollapsed ? "c" : "e"}`}
                mode="inline"
                inlineCollapsed={siderCollapsed}
                selectedKeys={
                  isFlow ? ["/flow"] : current ? [current.route] : []
                }
                defaultOpenKeys={allGroupKeys}
                style={{ borderInlineEnd: "none", background: "transparent" }}
                items={siderMenuItems}
                onClick={({ key }) => goPage(key)}
              />
            </div>
            <Button block={!siderCollapsed} onClick={onLogout}>
              {siderCollapsed ? "退出" : `退出（${user.username}）`}
            </Button>
          </div>
        </Layout.Sider>
        <Layout.Content style={{ padding: "24px 28px", background: "#f5f6f8" }}>
          {content}
        </Layout.Content>
      </Layout>
      <AssistantPanel
        appId={activeLoaded.app.id}
        context={assistantContext}
        navigate={goPage}
      />
      {supportWidget}
    </ConfigProvider>
  );
}
