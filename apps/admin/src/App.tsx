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
  // 内容领域模版（当前应用 domain=content 且映射健康时出现）
  | "content-workbench"
  | "content-categories"
  | "content-authors"
  | "content-messages";

interface MenuDef {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
}

/** 平台区菜单（不受应用上下文影响） */
const PLATFORM_MENU: MenuDef[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined /> },
  { key: "tenants", label: "租户", icon: <ApartmentOutlined /> },
  { key: "users", label: "用户与角色", icon: <TeamOutlined /> },
  { key: "apps", label: "应用管理", icon: <AppstoreOutlined /> },
  { key: "audit", label: "审计中心", icon: <AuditOutlined /> },
  { key: "replay", label: "审计回放", icon: <PlayCircleOutlined /> },
  { key: "kb", label: "知识库", icon: <BookOutlined /> },
  { key: "assets", label: "媒体资产", icon: <PictureOutlined /> },
  { key: "usage", label: "成本看板", icon: <DollarOutlined /> },
  { key: "config", label: "系统配置", icon: <SettingOutlined /> },
  { key: "switches", label: "熔断与配额", icon: <StopOutlined /> },
  { key: "sites", label: "入口与站点", icon: <GlobalOutlined /> },
  { key: "themes", label: "主题管理", icon: <SkinOutlined /> },
];

/** 应用区通用模版菜单（所有应用自动拥有，吃当前应用上下文） */
const APP_MENU: MenuDef[] = [
  { key: "data", label: "数据管理", icon: <AppstoreOutlined /> },
  { key: "members", label: "应用会员", icon: <IdcardOutlined /> },
  { key: "submissions", label: "提交审核", icon: <AuditOutlined /> },
  { key: "static", label: "静态状态", icon: <GlobalOutlined /> },
  { key: "appsettings", label: "应用设置", icon: <SettingOutlined /> },
];

/** 内容领域模版菜单 */
const CONTENT_MENU: MenuDef[] = [
  { key: "content-workbench", label: "文章工作台", icon: <BookOutlined /> },
  { key: "content-categories", label: "栏目管理", icon: <ApartmentOutlined /> },
  { key: "content-authors", label: "作者管理", icon: <TeamOutlined /> },
  { key: "content-messages", label: "留言审核", icon: <AuditOutlined /> },
];

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
  const health = appMeta ? domainHealth(appMeta) : null;
  const showContentMenu = !!appId && !!health?.hasDomain && health.healthy;

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
  const effectivePage: PageKey = visibleKeys.has(page) ? page : fallbackPage;

  const menuItems = [
    ...(platformVisible.length > 0
      ? [
          {
            type: "group" as const,
            label: "平台",
            children: platformVisible.map((m) => ({
              key: m.key,
              label: m.label,
              icon: m.icon,
            })),
          },
        ]
      : []),
    ...(appVisible.length > 0
      ? [
          {
            type: "group" as const,
            label: `应用 · ${String(currentApp?.name ?? appId ?? "")}`,
            children: appVisible.map((m) => ({
              key: m.key,
              label: m.label,
              icon: m.icon,
            })),
          },
        ]
      : []),
    ...(contentVisible.length > 0
      ? [
          {
            type: "group" as const,
            label: "内容领域",
            children: contentVisible.map((m) => ({
              key: m.key,
              label: m.label,
              icon: m.icon,
            })),
          },
        ]
      : []),
  ];

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
      <Sider theme="light" width={208} style={{ borderRight: "1px solid #f0f0f0" }}>
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
            borderBottom: "1px solid #f0f0f0",
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
        <Content style={{ padding: 24, background: "#f5f5f5" }}>
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
