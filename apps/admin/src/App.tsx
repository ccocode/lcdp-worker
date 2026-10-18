import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Menu,
  Space,
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
  type GrantsMe,
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

const { Header, Sider, Content } = Layout;

type PageKey =
  | "overview"
  | "tenants"
  | "users"
  | "apps"
  | "members"
  | "audit"
  | "replay"
  | "kb"
  | "assets"
  | "usage"
  | "config"
  | "switches"
  | "sites"
  | "themes";

const MENU: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview", label: "概览", icon: <DashboardOutlined /> },
  { key: "tenants", label: "租户", icon: <ApartmentOutlined /> },
  { key: "users", label: "用户与角色", icon: <TeamOutlined /> },
  { key: "apps", label: "应用管理", icon: <AppstoreOutlined /> },
  { key: "members", label: "应用会员", icon: <IdcardOutlined /> },
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

function pageFromPath(): PageKey {
  const h = window.location.pathname.replace(/^\//, "");
  const found = MENU.find((m) => m.key === h);
  return found ? found.key : "overview";
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

  useEffect(() => {
    const onPop = () => setPage(pageFromPath());
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

  const go = useCallback((key: PageKey) => {
    window.history.pushState(null, "", `/${key}`);
    setPage(key);
  }, []);

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

  // M15：运营者只见运营菜单（应用会员恒可见；知识库须客服应用授权），
  // 其余平台页对其不存在；落在不可见页（如旧路径）时归位到首个可见页。
  const isAdmin = user.role === "admin";
  const visibleMenu = isAdmin
    ? MENU
    : MENU.filter(
        (m) =>
          m.key === "members" ||
          (m.key === "kb" &&
            (grants?.apps ?? []).some((a) => a.id === "supplier-service")),
      );
  const effectivePage: PageKey = visibleMenu.some((m) => m.key === page)
    ? page
    : (visibleMenu[0]?.key ?? "members");

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={208} style={{ borderRight: "1px solid #f0f0f0" }}>
        <div style={{ padding: "16px 16px 8px", fontWeight: 600, fontSize: 16 }}>
          LCDP 管理台
        </div>
        <Menu
          mode="inline"
          selectedKeys={[effectivePage]}
          items={visibleMenu.map((m) => ({
            key: m.key,
            label: m.label,
            icon: m.icon,
          }))}
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
          <Typography.Text strong>
            {MENU.find((m) => m.key === effectivePage)?.label}
          </Typography.Text>
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
          {effectivePage === "members" && <Members />}
          {effectivePage === "audit" && <Audit />}
          {effectivePage === "replay" && <Replay />}
          {effectivePage === "kb" && <Kb />}
          {effectivePage === "assets" && <Assets />}
          {effectivePage === "usage" && <Usage />}
          {effectivePage === "config" && <ConfigPage />}
          {effectivePage === "switches" && <Switches />}
          {effectivePage === "sites" && <Sites />}
          {effectivePage === "themes" && <Themes />}
        </Content>
      </Layout>
    </Layout>
  );
}

export type { PageKey };
