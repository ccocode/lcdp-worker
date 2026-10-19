import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Menu,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import {
  ApartmentOutlined,
  AuditOutlined,
  BookOutlined,
  DashboardOutlined,
  DollarOutlined,
  IdcardOutlined,
  LogoutOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
  SettingOutlined,
  StopOutlined,
  TeamOutlined,
  AppstoreOutlined,
  GlobalOutlined,
  SkinOutlined,
} from "@ant-design/icons";
import {
  api,
  consumeExpiredFlag,
  getStoredGrants,
  getStoredUser,
  storeGrants,
  storeSession,
  type AdminDataMeta,
  type GrantsMe,
  type Row,
  type UserInfo,
} from "./api";
import Overview from "./pages/Overview";
import Tenants from "./pages/Tenants";
import Users from "./pages/Users";
import Apps from "./pages/Apps";
import Members from "./pages/Members";
import Audit from "./pages/Audit";
import Replay from "./pages/Replay";
import Kb from "./pages/Kb";
import Assets from "./pages/Assets";
import Usage from "./pages/Usage";
import ConfigPage from "./pages/ConfigPage";
import Switches from "./pages/Switches";
import Sites from "./pages/Sites";
import Themes from "./pages/Themes";
import DataAdmin from "./pages/DataAdmin";
import Submissions from "./pages/Submissions";
import StaticStatus from "./pages/StaticStatus";
import AppSettings, { domainHealth } from "./pages/AppSettings";
import AppThemeSettings from "./pages/AppThemeSettings";
import ContentArticles from "./pages/ContentArticles";

const { Header, Sider, Content } = Layout;

type PageKey =
  | "overview"
  | "tenants"
  | "users"
  | "apps"
  | "audit"
  | "replay"
  | "kb"
  | "assets"
  | "usage"
  | "config"
  | "switches"
  | "sites"
  | "themes"
  // 应用区（M15 第③步：须先选当前应用，见应用上下文）
  | "data"
  | "members"
  | "submissions"
  | "static"
  | "appsettings"
  | "theme-settings"
  // 内容领域模版（当前应用 domain=content 且映射健康时出现）
  | "content-workbench"
  | "content-categories"
  | "content-authors"
  | "content-messages";

interface MenuDef {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  /** 左侧菜单分组（第 49 步菜单信息架构：按功能分区，不带应用名——当前应用由顶栏切换器呈现） */
  section: string;
}

/**
 * 平台区菜单（不受应用上下文影响），按功能分区：
 * 总览 / 组织与权限 / 应用与资产 / 内容与知识 / 站点与发布 / 运营保障 / 审计追溯。
 * 数组顺序即分区呈现顺序；权限可见性口径不变（见 contextVisibility）。
 */
const PLATFORM_MENU: MenuDef[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined />, section: "总览" },
  { key: "tenants", label: "租户", icon: <ApartmentOutlined />, section: "组织与权限" },
  { key: "users", label: "用户与角色", icon: <TeamOutlined />, section: "组织与权限" },
  { key: "apps", label: "应用管理", icon: <AppstoreOutlined />, section: "应用与资产" },
  { key: "themes", label: "主题管理", icon: <SkinOutlined />, section: "应用与资产" },
  { key: "assets", label: "媒体资产", icon: <PictureOutlined />, section: "应用与资产" },
  { key: "kb", label: "知识库", icon: <BookOutlined />, section: "内容与知识" },
  { key: "sites", label: "入口与站点", icon: <GlobalOutlined />, section: "站点与发布" },
  { key: "usage", label: "成本看板", icon: <DollarOutlined />, section: "运营保障" },
  { key: "switches", label: "熔断与配额", icon: <StopOutlined />, section: "运营保障" },
  { key: "config", label: "系统配置", icon: <SettingOutlined />, section: "运营保障" },
  { key: "audit", label: "审计中心", icon: <AuditOutlined />, section: "审计追溯" },
  { key: "replay", label: "审计回放", icon: <PlayCircleOutlined />, section: "审计追溯" },
];

/**
 * 应用区通用模版菜单（所有应用自动拥有，吃当前应用上下文），按功能分区：
 * 运营管理 / 发布与外观 / 应用设置（领域模版分区「内容运营」插在运营管理之后，
 * 见 APP_SECTION_ORDER）。组名只写功能、不带应用名。
 */
const APP_MENU: MenuDef[] = [
  { key: "data", label: "数据管理", icon: <AppstoreOutlined />, section: "运营管理" },
  { key: "members", label: "应用会员", icon: <IdcardOutlined />, section: "运营管理" },
  { key: "submissions", label: "提交审核", icon: <AuditOutlined />, section: "运营管理" },
  { key: "static", label: "静态状态", icon: <GlobalOutlined />, section: "发布与外观" },
  { key: "theme-settings", label: "主题设置", icon: <SkinOutlined />, section: "发布与外观" },
  { key: "appsettings", label: "应用设置", icon: <SettingOutlined />, section: "应用设置" },
];

/** 内容领域模版菜单（分区「内容运营」） */
const CONTENT_MENU: MenuDef[] = [
  { key: "content-workbench", label: "文章工作台", icon: <BookOutlined />, section: "内容运营" },
  { key: "content-categories", label: "栏目管理", icon: <ApartmentOutlined />, section: "内容运营" },
  { key: "content-authors", label: "作者管理", icon: <TeamOutlined />, section: "内容运营" },
  { key: "content-messages", label: "留言审核", icon: <AuditOutlined />, section: "内容运营" },
];

/** 应用区分区呈现顺序（领域模版分区插在通用运营管理之后、发布与设置之前） */
const APP_SECTION_ORDER = ["运营管理", "内容运营", "发布与外观", "应用设置"];

/** 把一串菜单按 section 分组：分区按首次出现顺序（给了 order 则按 order），空区不出现 */
function groupBySection(
  items: MenuDef[],
  order?: string[],
): { label: string; items: MenuDef[] }[] {
  const bySection = new Map<string, MenuDef[]>();
  for (const m of items) {
    const arr = bySection.get(m.section) ?? [];
    arr.push(m);
    bySection.set(m.section, arr);
  }
  const labels = order
    ? order.filter((l) => bySection.has(l))
    : [...bySection.keys()];
  return labels.map((label) => ({ label, items: bySection.get(label)! }));
}

const ALL_MENU: MenuDef[] = [...PLATFORM_MENU, ...APP_MENU, ...CONTENT_MENU];

function pageFromPath(): PageKey {
  const h = window.location.pathname.replace(/^\//, "");
  const found = ALL_MENU.find((m) => m.key === h);
  return found ? found.key : "overview";
}

/** 应用上下文：当前应用以 URL 查询 ?app=<id> 承载（深链可达、刷新保持） */
function appFromSearch(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("app");
  } catch {
    return null;
  }
}

function pathWithApp(key: PageKey, appId: string | null): string {
  return appId ? `/${key}?app=${encodeURIComponent(appId)}` : `/${key}`;
}

/**
 * 应用上下文的可见页集与落点页：菜单渲染（effectivePage 掩盖）与会话内
 * 切换归位（改 URL 与 page 状态）共用同一套口径，避免两处各算一份日后漂移。
 */
function contextVisibility(args: {
  isAdmin: boolean;
  grants: GrantsMe | null;
  appId: string | null;
  appMeta: AdminDataMeta | null;
}): {
  /** 平台区分组后的可见菜单（第 49 步：按 section 分组，空区不出现） */
  platformGroups: { label: string; items: MenuDef[] }[];
  /** 应用区分组后的可见菜单（通用模版 + 领域模版按 APP_SECTION_ORDER 合并） */
  appGroups: { label: string; items: MenuDef[] }[];
  visibleKeys: Set<PageKey>;
  fallbackPage: PageKey;
} {
  const { isAdmin, grants, appId, appMeta } = args;
  const health = appMeta ? domainHealth(appMeta) : null;
  const showContentMenu =
    !!appId &&
    appMeta?.app.domain === "content" &&
    !!health?.hasDomain &&
    health.healthy;
  // 平台区可见集：第 40 步口径（admin 全量；operator 仅知识库且须客服应用授权）
  const platformVisible: MenuDef[] = isAdmin
    ? PLATFORM_MENU
    : PLATFORM_MENU.filter(
        (m) =>
          m.key === "kb" &&
          (grants?.apps ?? []).some((a) => a.id === "supplier-service"),
      );
  const appVisible: MenuDef[] = appId ? APP_MENU : [];
  const contentVisible: MenuDef[] = showContentMenu ? CONTENT_MENU : [];
  const platformGroups = groupBySection(platformVisible);
  const appGroups = groupBySection(
    [...appVisible, ...contentVisible],
    APP_SECTION_ORDER,
  );
  const visibleKeys = new Set<PageKey>([
    ...platformVisible.map((m) => m.key),
    ...appVisible.map((m) => m.key),
    ...contentVisible.map((m) => m.key),
  ]);
  const fallbackPage: PageKey = isAdmin
    ? "overview"
    : appId
      ? "appsettings"
      : (platformVisible[0]?.key ?? "appsettings");
  return { platformGroups, appGroups, visibleKeys, fallbackPage };
}

/** 旧 # 链接迁移（M14 线一）：首载时把 #/<key> 以 replaceState 落到等价新路径 /<key> */
function migrateLegacyHash(): void {
  const h = window.location.hash;
  if (h.startsWith("#/")) {
    window.history.replaceState(null, "", h.slice(1));
  }
}

function Login({ onLogin }: { onLogin: (u: UserInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 经 401 拦截跳回登录页时的一次性提示（api.expireSession 落标记） */
  const [expired] = useState<boolean>(() => consumeExpiredFlag());

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    let sessionStored = false;
    try {
      const res = await api.login(values.username.trim(), values.password);
      storeSession(res.token, res.user);
      sessionStored = true;
      // M15 授权层：admin 直通；非 admin 须持有至少一个应用的运营授权，
      // 授权清单一并存下，供菜单与应用列表收窄。无授权不落会话并明确报错。
      const me = await api.grants.me();
      if (res.user.role !== "admin" && me.apps.length === 0) {
        storeSession(null, null);
        storeGrants(null);
        sessionStored = false;
        setError(
          `账号 ${res.user.username} 尚未获得任何应用的运营授权，请联系平台管理员在「用户与角色」中发放`,
        );
        return;
      }
      storeGrants(me);
      message.success(`欢迎，${res.user.username}`);
      onLogin(res.user);
    } catch (err) {
      if (sessionStored) {
        storeSession(null, null);
        storeGrants(null);
      }
      setError(err instanceof Error ? err.message : "登录失败");
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
        background: "#f0f2f5",
        padding: 24,
      }}
    >
      <Card style={{ width: 380 }} title="LCDP 平台管理台">
        <Typography.Paragraph type="secondary">
          <SafetyOutlined /> 平台管理员与获授权的应用运营者可登录
        </Typography.Paragraph>
        {expired && !error ? (
          <Alert
            type="warning"
            showIcon
            message="登录已失效，请重新登录"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        ) : null}
        <Form layout="vertical" onFinish={submit}>
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input autoComplete="username" placeholder="admin" />
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

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const [grants, setGrants] = useState<GrantsMe | null>(() => getStoredGrants());
  const [page, setPage] = useState<PageKey>(() => {
    migrateLegacyHash();
    return pageFromPath();
  });
  // ---- 应用上下文（M15 第③步）----
  const [appId, setAppId] = useState<string | null>(() => appFromSearch());
  const [apps, setApps] = useState<Row[]>([]);
  const [appMeta, setAppMeta] = useState<AdminDataMeta | null>(null);
  const [metaState, setMetaState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    const onPop = () => {
      setPage(pageFromPath());
      setAppId(appFromSearch());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 授权刷新：会话恢复/登录后拉最新授权（发放与回收近实时生效）；
  // 非 admin 且授权被全部回收时直接登出。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .grants.me()
      .then((me) => {
        if (cancelled) return;
        setGrants(me);
        storeGrants(me);
        if (user.role !== "admin" && me.apps.length === 0) {
          storeSession(null, null);
          storeGrants(null);
          setUser(null);
          setGrants(null);
          message.warning("你的应用运营授权已被全部回收，已退出登录");
        }
      })
      .catch(() => {
        /* 拉取失败保留本地授权快照，不打断使用 */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 应用清单（服务端已按身份过滤）：切换器与上下文校验的数据源
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .apps.list()
      .then((list) => {
        if (!cancelled) setApps(list);
      })
      .catch(() => {
        /* 失败时切换器留空，上下文页不可达但平台区不受影响 */
      });
    return () => {
      cancelled = true;
    };
  }, [user, grants]);

  const currentApp: Row | null =
    apps.find((a) => String(a.id) === appId) ?? null;

  // 上下文归位：深链带来的 appId 不在可见应用清单内时——
  // operator 落到其第一个授权应用；admin 清空上下文（平台区继续可用）。
  useEffect(() => {
    if (!user || apps.length === 0) return;
    if (appId && !apps.some((a) => String(a.id) === appId)) {
      if (user.role !== "admin") {
        const first = String(apps[0]!.id);
        window.history.replaceState(null, "", pathWithApp(page, first));
        setAppId(first);
      } else {
        window.history.replaceState(null, "", `/${page}`);
        setAppId(null);
      }
    }
    if (!appId && user.role !== "admin") {
      const first = String(apps[0]!.id);
      window.history.replaceState(null, "", pathWithApp(page, first));
      setAppId(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, user]);

  // 当前应用的领域元数据（领域菜单与模版页共用一份，切换应用即重拉）
  useEffect(() => {
    if (!appId) {
      setAppMeta(null);
      setMetaState("idle");
      return;
    }
    let cancelled = false;
    setMetaState("loading");
    api
      .adminData.meta(appId)
      .then((meta) => {
        if (cancelled) return;
        setAppMeta(meta);
        setMetaState("ok");
      })
      .catch(() => {
        if (cancelled) return;
        setAppMeta(null);
        setMetaState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  // 会话内归位：切换应用上下文后，若当前页不在新上下文的可见页集内，把 URL
  // 与 page 状态真正归位到落点页。此前只有渲染层经 effectivePage 掩盖，page
  // 状态与 URL 仍停在不可见页上（在内容页切到非内容应用时正文与地址栏不一致，
  // 切换器与 go() 也继续沿用旧页）。可见集与落点页与渲染口径同一套逻辑
  // （contextVisibility）。元数据尚在途时不判：内容菜单可见性依赖领域元数据，
  // 按旧应用的可见集判断会把「切回内容应用」途中的合法内容页误赶走；元数据
  // 出错时 appMeta 已清空、按无内容菜单判断（页面本就不可用，归位合理）。
  useEffect(() => {
    if (!user || apps.length === 0) return;
    if (appId && metaState !== "error" && appMeta?.app.id !== appId) return;
    const { visibleKeys, fallbackPage } = contextVisibility({
      isAdmin: user.role === "admin",
      grants,
      appId,
      appMeta,
    });
    if (!visibleKeys.has(page)) {
      window.history.replaceState(null, "", pathWithApp(fallbackPage, appId));
      setPage(fallbackPage);
    }
  }, [user, apps, appId, appMeta, metaState, page, grants]);

  const go = useCallback(
    (key: PageKey) => {
      window.history.pushState(null, "", pathWithApp(key, appId));
      setPage(key);
    },
    [appId],
  );

  const switchApp = useCallback(
    (id: string) => {
      window.history.pushState(null, "", pathWithApp(page, id));
      setAppId(id);
    },
    [page],
  );

  const logout = useCallback(() => {
    storeSession(null, null);
    storeGrants(null);
    setGrants(null);
    setUser(null);
  }, []);

  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setGrants(getStoredGrants());
          setUser(u);
        }}
      />
    );

  const isAdmin = user.role === "admin";
  const { platformGroups, appGroups, visibleKeys, fallbackPage } =
    contextVisibility({ isAdmin, grants, appId, appMeta });
  const effectivePage: PageKey = visibleKeys.has(page) ? page : fallbackPage;

  /** 左侧菜单 = 平台分组 + 应用分组（第 49 步 IA：分区只写功能名，当前应用看顶栏切换器） */
  const toGroupItem = (g: { label: string; items: MenuDef[] }) => ({
    type: "group" as const,
    key: `group:${g.label}`,
    label: g.label,
    children: g.items.map((m) => ({
      key: m.key,
      label: m.label,
      icon: m.icon,
    })),
  });
  const menuItems = [...platformGroups, ...appGroups].map(toGroupItem);

  /** 应用区页面统一占位：元数据未就绪时不渲染具体页 */
  const appPageShell = (node: React.ReactNode) =>
    metaState === "ok" && appMeta ? (
      node
    ) : metaState === "error" ? (
      <Alert
        type="error"
        showIcon
        message="应用元数据加载失败"
        description="无法读取该应用的已发布设计与领域信息，请稍后刷新重试。"
      />
    ) : (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin tip="加载应用信息…" />
      </div>
    );

  const roles = appMeta?.domainModules?.roles ?? {};

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={208} style={{ borderRight: "1px solid #e4e7ec" }}>
        <div style={{ padding: "16px 16px 8px", fontWeight: 600, fontSize: 16 }}>
          LCDP 管理台
        </div>
        <Menu
          mode="inline"
          selectedKeys={[effectivePage]}
          items={menuItems}
          onClick={(e) => go(e.key as PageKey)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            borderBottom: "1px solid #e4e7ec",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 24,
          }}
        >
          <Space>
            <Typography.Text strong>
              {ALL_MENU.find((m) => m.key === effectivePage)?.label}
            </Typography.Text>
            <Select
              allowClear={isAdmin}
              placeholder="选择应用"
              value={appId ?? undefined}
              onChange={(v) => {
                if (v) switchApp(v);
              }}
              onClear={() => {
                window.history.pushState(null, "", `/${page}`);
                setAppId(null);
              }}
              style={{ width: 240 }}
              options={apps.map((a) => ({
                value: String(a.id),
                label: `${String(a.name ?? a.id)}（${String(a.id)}）`,
              }))}
            />
          </Space>
          <Space>
            <Typography.Text type="secondary">
              {isAdmin ? "当前管理员" : "当前运营者"}：{user.username}（{user.role}）
            </Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: "#f5f6f8" }}>
          {effectivePage === "overview" && <Overview go={go} />}
          {effectivePage === "tenants" && <Tenants />}
          {effectivePage === "users" && <Users currentUser={user} />}
          {effectivePage === "apps" && <Apps />}
          {effectivePage === "audit" && <Audit />}
          {effectivePage === "replay" && <Replay />}
          {effectivePage === "kb" && <Kb />}
          {effectivePage === "assets" && <Assets />}
          {effectivePage === "usage" && <Usage />}
          {effectivePage === "config" && <ConfigPage />}
          {effectivePage === "switches" && <Switches />}
          {effectivePage === "sites" && <Sites />}
          {effectivePage === "themes" && <Themes />}
          {appId && effectivePage === "members" && (
            <Members key={appId} appId={appId} />
          )}
          {appId && effectivePage === "data" &&
            appPageShell(<DataAdmin key={appId} appId={appId} meta={appMeta!} />)}
          {appId && effectivePage === "submissions" && (
            <Submissions key={appId} appId={appId} />
          )}
          {appId && effectivePage === "static" && (
            <StaticStatus key={appId} appId={appId} />
          )}
          {appId && effectivePage === "appsettings" && (
            <AppSettings key={appId} app={currentApp} meta={appMeta} />
          )}
          {appId && effectivePage === "theme-settings" && (
            <AppThemeSettings key={appId} appId={appId} isAdmin={isAdmin} />
          )}
          {appId && effectivePage === "content-workbench" &&
            appPageShell(
              <ContentArticles key={appId} appId={appId} meta={appMeta!} />,
            )}
          {appId && effectivePage === "content-categories" &&
            appPageShell(
              <DataAdmin
                key={`${appId}:cat`}
                appId={appId}
                meta={appMeta!}
                lockEntity={roles["category"] ?? "category"}
                title="栏目管理"
              />,
            )}
          {appId && effectivePage === "content-authors" &&
            appPageShell(
              <DataAdmin
                key={`${appId}:author`}
                appId={appId}
                meta={appMeta!}
                lockEntity={roles["author"] ?? "author"}
                title="作者管理"
              />,
            )}
          {appId && effectivePage === "content-messages" && (
            <Submissions
              key={`${appId}:msg`}
              appId={appId}
              entityFilter={roles["message"] ?? "message"}
              title="留言审核"
            />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}

export type { PageKey };
