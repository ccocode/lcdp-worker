import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
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
  EntryResult,
  PublicEntryResult,
  Snapshot,
  UserInfo,
} from "./api.js";
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

/** 设备上下文：窄屏（≤820px）走移动布局变体，宽屏走桌面变体 */
function useDevice(): Device {
  const [device, setDevice] = useState<Device>(() =>
    window.matchMedia("(max-width: 820px)").matches ? "mobile" : "desktop",
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const onChange = (e: MediaQueryListEvent) =>
      setDevice(e.matches ? "mobile" : "desktop");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return device;
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
          appId={previewAppId}
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
  if (
    primary &&
    primary.pages.length > 0 &&
    !showLogin &&
    !route.path.startsWith("/app/")
  ) {
    return (
      <PublicShell
        primary={primary}
        inPath={route.path}
        params={route.params}
        device={device}
        onLogin={() => setShowLogin(true)}
      />
    );
  }
  return <LoginView onLoggedIn={onLoggedIn} />;
}

/**
 * 公开外壳（匿名访客）：顶栏应用名 + 登录按钮；菜单走与登录外壳同一套页面 menu 装配；
 * 内容由公开适配器渲染（服务端按公开策略整形数据）、应用主题同样生效。
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
            {current ? (
              <SchemaRenderer
                page={current}
                dataSchema={primary.data}
                adapter={adapter}
                params={params}
                device={device}
                access={access}
              />
            ) : (
              <Typography.Text type="secondary">
                页面不存在：{inPath}
              </Typography.Text>
            )}
          </Layout.Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

/** 入口视图：按当前域名解析入口，取其装配的首个应用进入系统壳 */
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
  const app = entry.apps[0];
  if (!app) {
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
      appId={app.id}
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
 * 菜单组装（登录外壳与公开外壳共用同一逻辑）：
 * 页面 menu 声明优先；无任何页面声明 menu 时回退旧逻辑（列表页 + 实体名）。
 */
function assembleMenu(
  pages: PageSchema[],
  entities: DataSchema["entities"],
): AssembledMenu {
  const menuPages: MenuPage[] = pages
    .filter((p) => p.menu && !p.menu.hidden)
    .map((p) => ({
      page: p,
      label: p.menu!.label,
      order: p.menu!.order ?? 0,
      group: p.menu!.group,
    }))
    .sort((a, b) => a.order - b.order);
  const listPages = pages.filter((p) =>
    p.root.children?.some((ch) => ch.type === "DataTable"),
  );

  const navLabel = (page: PageSchema): string => {
    const ref = page.dataSources[0]?.ref;
    const entity = entities.find((e) => e.key === ref);
    return entity?.label ?? page.name;
  };

  let items: MenuProps["items"];
  if (menuPages.length > 0) {
    // 分组项在其首个成员的位置出现一次，组内保持 order 顺序
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
    items = arr;
  } else {
    items = listPages.map((page) => ({
      key: page.route,
      label: navLabel(page),
    }));
  }
  return { items, menuPages, listPages };
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
  appId,
  inPath,
  params,
  user,
  onLogout,
  device,
  preview,
  entryName,
}: {
  appId: string;
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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 待办数（侧边菜单 Badge）：挂载时拉一次，失败静默为 0；待办中心内动作后由其回告刷新 */
  const [todoCount, setTodoCount] = useState(0);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    api
      .snapshot(appId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [appId]);

  useEffect(() => {
    let alive = true;
    api.flow
      .todos(appId)
      .then((tasks) => {
        if (alive) setTodoCount(tasks.length);
      })
      .catch(() => {
        // 待办数仅作角标提示，拉取失败不打扰主流程
      });
    return () => {
      alive = false;
    };
  }, [appId]);

  /** 待办中心是外壳级视图（#/flow），不属于任何页面 Schema */
  const isFlow = inPath === "/flow";

  const goPage = useMemo(
    () =>
      (to: string) => {
        window.location.hash = preview
          ? `#/app/${encodeURIComponent(appId)}${to}`
          : `#${to}`;
      },
    [appId, preview],
  );

  const adapter = useMemo(
    () => makeAdapter(appId, goPage, notify),
    [appId, goPage],
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
  if (!snapshot) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在加载应用…" />
      </div>
    );
  }

  const menu = assembleMenu(snapshot.pages, snapshot.data.entities);
  const current = resolveCurrentPage(snapshot.pages, menu, inPath);
  const token = themeTokenOf(snapshot.appConfig);
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
                {snapshot.app.name}
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
          {isFlow ? (
            <FlowCenter
              appId={appId}
              user={user}
              entities={snapshot.data.entities}
              onTodoCountChange={setTodoCount}
            />
          ) : current ? (
            <SchemaRenderer
              page={current}
              dataSchema={snapshot.data}
              adapter={adapter}
              params={params}
              device={device}
              access={snapshot.myAccess?.entities}
            />
          ) : (
            <Typography.Text type="secondary">
              页面不存在：{inPath}
            </Typography.Text>
          )}
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}
