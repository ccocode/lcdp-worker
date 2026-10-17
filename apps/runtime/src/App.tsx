import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  Layout,
  Menu,
  Spin,
  Typography,
  message as antdMessage,
} from "antd";
import type { MenuProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import { SchemaRenderer } from "@lcdp/renderer";
import type { EntityAccess } from "@lcdp/renderer";
import type { DataSchema, PageSchema } from "@naka1205/schema";
import type {
  AppInfo,
  AssistantContext,
  EntryResult,
  PublicEntryResult,
  Snapshot,
  UserInfo,
} from "./api.js";
import AssistantPanel from "./AssistantPanel.js";
import SupportWidget, { SupportAutoMount } from "./SupportWidget.js";
import {
  api,
  getStoredUser,
  makeAdapter,
  makePublicAdapter,
  storeSession,
} from "./api.js";
import FlowCenter from "./FlowCenter.js";

/**
 * 运行态应用壳（M3 入口模型）：运行态是单一解释器，呈现中没有「应用」概念。
 * 登录后按当前域名解析入口（域名定入口），直达入口装配的应用系统；
 * 菜单由页面自身的 menu 声明组装（页面驱动、非实体驱动）。
 * 路由用 hash（Pages 静态托管免改写规则）：
 *   入口模式  #<页面路由>?<页面参数>
 *   预览模式  #/app/<appId><页面路由>?<页面参数>（设计台「在运行态打开」兼容）
 *   待办中心  #/flow（外壳级视图，入口/预览模式均可达，侧边菜单顶部固定入口）
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

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path, query] = raw.split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  }
  return { path: path || "/", params };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
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
    lcdpBridge?: unknown;
  };
  return Boolean(w.Capacitor ?? w.lcdpBridge);
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
  const route = useHashRoute();
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const device = useDevice();

  const logout = () => {
    storeSession(null, null);
    setUser(null);
    window.location.hash = "#/";
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
            // 预览深链（设计台打开）登录后保留原路径，其余回入口首页
            if (!window.location.hash.startsWith("#/app/")) {
              window.location.hash = "#/";
            }
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
  const [pub, setPub] = useState<PublicEntryResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .publicEntry(window.location.host)
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

  if (!loaded) {
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
  if (
    primary &&
    primary.pages.length > 0 &&
    !showLogin &&
    !route.path.startsWith("/app/")
  ) {
    return (
      <>
        <PublicShell
          primary={primary}
          inPath={route.path}
          params={route.params}
          device={device}
          onLogin={() => setShowLogin(true)}
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

/** 站点型页脚：居中一行文案（配置文案或版权占位） */
function SiteFooter({ text }: { text: string }) {
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
      {text}
    </Layout.Footer>
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
}: {
  primary: NonNullable<PublicEntryResult["primary"]>;
  inPath: string;
  params: Record<string, string>;
  device: Device;
  onLogin: () => void;
}) {
  const goPage = useCallback((to: string) => {
    window.location.hash = `#${to}`;
  }, []);
  // 公开表单提交在渲染器内走既有「保存成功」提示路径，这里改写为待审口径
  const publicNotify = useCallback(
    (message: string, kind: "ok" | "error" = "ok") => {
      notify(message === "保存成功" ? "已提交，等待审核" : message, kind);
    },
    [],
  );
  const adapter = useMemo(
    () => makePublicAdapter(primary.appId, goPage, publicNotify),
    [primary.appId, goPage, publicNotify],
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

  const content = current ? (
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
            onNavigate={goPage}
            searchRoute={globalVarText(cfg, "siteSearchRoute")}
            right={
              <Button type="primary" onClick={onLogin}>
                登录
              </Button>
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
          onNavigate={goPage}
          topRight={
            <Button type="primary" size="small" onClick={onLogin}>
              登录
            </Button>
          }
        >
          {content}
        </MobileShell>
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
          <Button type="primary" onClick={onLogin}>
            登录
          </Button>
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
              onClick={({ key }) => goPage(key)}
            />
          </Layout.Sider>
          <Layout.Content style={{ padding: "24px 28px", background: "#fff" }}>
            {content}
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

/** 入口视图：按当前域名解析入口，把其装配的全部应用交给系统壳做多应用装配（M10） */
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
  const [entry, setEntry] = useState<EntryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .entry(window.location.host)
      .then((r) => {
        if (alive) setEntry(r);
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
        <Button onClick={onLogout}>退出登录</Button>
      </div>
    );
  }
  if (!entry) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在解析入口…" />
      </div>
    );
  }
  if (entry.apps.length === 0) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <Alert
          type="info"
          message="当前入口尚未装配应用（先完成平台初始化）"
          style={{ marginBottom: 12 }}
        />
        <Button onClick={onLogout}>退出登录</Button>
      </div>
    );
  }
  return (
    <AppView
      apps={entry.apps}
      inPath={inPath}
      params={params}
      user={user}
      onLogout={onLogout}
      device={device}
      preview={false}
      entryName={entry.entry?.name ?? null}
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
 */
function buildMenuItems(
  menuPages: MenuPage[],
  fallbackItems: NonNullable<MenuProps["items"]>,
): MenuProps["items"] {
  if (menuPages.length === 0) return fallbackItems;
  const arr: NonNullable<MenuProps["items"]> = [];
  const seenGroups = new Set<string>();
  for (const mp of menuPages) {
    if (!mp.group) {
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
  return arr;
}

/**
 * 菜单组装核心：入参为带各自实体口径的页面集合（单应用即全量同属一应用；
 * 多应用为页面并集，实体口径按页所属应用取——回退标签解析不串应用）。
 */
function collectMenu(
  entries: { page: PageSchema; entities: DataSchema["entities"] }[],
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
): AssembledMenu {
  return collectMenu(pages.map((page) => ({ page, entities })));
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

/** 跨应用合并菜单：对并集（去重后）页面跑同一套组装算法，同名分组跨应用合并 */
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
} | null): { colorPrimary?: string; borderRadius?: number } {
  const themeCfg = appConfig?.theme ?? {};
  const token: { colorPrimary?: string; borderRadius?: number } = {};
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
}: {
  /** 入口装配的应用（顺序即入口 app_ids 顺序，首个为主应用）；预览模式为单元素数组 */
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
}) {
  const primaryAppId = apps[0]?.id ?? "";
  const appIdsKey = apps.map((a) => a.id).join(",");
  const [loaded, setLoaded] = useState<LoadedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 待办数（菜单 Badge）：多应用时为各应用待办之和 */
  const [todoCount, setTodoCount] = useState(0);
  /** 待办/助手跟随的当前应用：随当前页归属更新；停在外壳级视图（#/flow）时保持最近归属 */
  const [activeAppId, setActiveAppId] = useState<string>(primaryAppId);

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

  /** 待办数刷新：逐应用拉取后求和，单个应用失败按 0 计（角标仅作提示） */
  const refreshTodoCount = useCallback(async () => {
    const counts = await Promise.all(
      apps.map((a) =>
        api.flow
          .todos(a.id)
          .then((tasks) => tasks.length)
          .catch(() => 0),
      ),
    );
    setTodoCount(counts.reduce((sum, n) => sum + n, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appIdsKey]);
  useEffect(() => {
    void refreshTodoCount();
  }, [refreshTodoCount]);
  /** FlowCenter 内动作后回告：不直接采用其单应用计数，统一重拉求和 */
  const handleTodoCountChange = useCallback(() => {
    void refreshTodoCount();
  }, [refreshTodoCount]);

  /** 待办中心是外壳级视图（#/flow），不属于任何页面 Schema */
  const isFlow = inPath === "/flow";

  const goPage = useMemo(
    () =>
      (to: string) => {
        window.location.hash = preview
          ? `#/app/${encodeURIComponent(primaryAppId)}${to}`
          : `#${to}`;
      },
    [primaryAppId, preview],
  );

  const union = useMemo(
    () => (loaded ? buildPageUnion(loaded) : null),
    [loaded],
  );
  const menu = useMemo(
    () => (loaded && union ? assembleMergedMenu(union, loaded) : null),
    [loaded, union],
  );
  const currentOwned =
    union && menu ? resolveOwnedCurrent(union, menu, inPath) : undefined;

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
            window.location.hash = "#/";
          }}
        >
          返回入口首页
        </Button>
      </div>
    );
  }
  if (!loaded || !union || !menu) {
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
  /** 菜单顶部固定「待办中心」（外壳级视图，key 与页面路由同走 goPage 的 hash 切换） */
  const menuItems: MenuProps["items"] = [
    {
      key: "/flow",
      label: (
        <span>
          待办中心{" "}
          <Badge count={todoCount} size="small" offset={[2, -2]} />
        </span>
      ),
    },
    ...(menu.items ?? []),
  ];

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
            right={<Button onClick={onLogout}>退出（{user.username}）</Button>}
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
          title={brandTextOf(cfg, primary.snapshot.app.name)}
          entries={navEntries}
          selectedKey={isFlow ? "/flow" : current ? current.route : null}
          onNavigate={goPage}
          topRight={
            preview ? (
              <Button
                size="small"
                onClick={() => {
                  window.location.hash = "#/";
                }}
              >
                入口首页
              </Button>
            ) : (
              <Button type="text" size="small" onClick={onLogout}>
                退出
              </Button>
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
    <ConfigProvider locale={zhCN} theme={{ token }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Layout.Sider
          theme="light"
          width={220}
          style={{ borderRight: "1px solid #f0f0f0" }}
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
            <div style={{ padding: "0 8px" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {primary.snapshot.app.name}
              </div>
              <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                {preview ? "预览" : (entryName ?? "运行入口")}
              </div>
            </div>
            {preview && (
              <Button
                block
                onClick={() => {
                  window.location.hash = "#/";
                }}
              >
                返回入口首页
              </Button>
            )}
            <Menu
              mode="inline"
              selectedKeys={
                isFlow ? ["/flow"] : current ? [current.route] : []
              }
              style={{ borderInlineEnd: "none", background: "transparent" }}
              items={menuItems}
              onClick={({ key }) => goPage(key)}
            />
            <div style={{ flex: 1 }} />
            <Button block onClick={onLogout}>
              退出（{user.username}）
            </Button>
          </div>
        </Layout.Sider>
        <Layout.Content style={{ padding: "24px 28px", background: "#fff" }}>
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
