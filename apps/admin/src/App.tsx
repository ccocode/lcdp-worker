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
import { api, consumeExpiredFlag, getStoredUser, storeSession, type UserInfo } from "./api";
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
    try {
      const res = await api.login(values.username.trim(), values.password);
      // 管理台仅 admin 放行：非 admin 不落会话并明确报错
      if (res.user.role !== "admin") {
        storeSession(null, null);
        setError(
          `账号 ${res.user.username} 的角色为 ${res.user.role}，仅管理员（admin）可登录管理台`,
        );
        return;
      }
      storeSession(res.token, res.user);
      message.success(`欢迎，${res.user.username}`);
      onLogin(res.user);
    } catch (err) {
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
          <SafetyOutlined /> 仅平台管理员可登录
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
  const [user, setUser] = useState<UserInfo | null>(() => {
    const u = getStoredUser();
    return u && u.role === "admin" ? u : null;
  });
  const [page, setPage] = useState<PageKey>(() => {
    migrateLegacyHash();
    return pageFromPath();
  });

  useEffect(() => {
    const onPop = () => setPage(pageFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((key: PageKey) => {
    window.history.pushState(null, "", `/${key}`);
    setPage(key);
  }, []);

  const logout = useCallback(() => {
    storeSession(null, null);
    setUser(null);
  }, []);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="light" width={208} style={{ borderRight: "1px solid #f0f0f0" }}>
        <div style={{ padding: "16px 16px 8px", fontWeight: 600, fontSize: 16 }}>
          LCDP 管理台
        </div>
        <Menu
          mode="inline"
          selectedKeys={[page]}
          items={MENU.map((m) => ({ key: m.key, label: m.label, icon: m.icon }))}
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
            {MENU.find((m) => m.key === page)?.label}
          </Typography.Text>
          <Space>
            <Typography.Text type="secondary">
              当前管理员：{user.username}（{user.role}）
            </Typography.Text>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: "#f5f5f5" }}>
          {page === "overview" && <Overview go={go} />}
          {page === "tenants" && <Tenants />}
          {page === "users" && <Users currentUser={user} />}
          {page === "apps" && <Apps />}
          {page === "members" && <Members />}
          {page === "audit" && <Audit />}
          {page === "replay" && <Replay />}
          {page === "kb" && <Kb />}
          {page === "assets" && <Assets />}
          {page === "usage" && <Usage />}
          {page === "config" && <ConfigPage />}
          {page === "switches" && <Switches />}
          {page === "sites" && <Sites />}
          {page === "themes" && <Themes />}
        </Content>
      </Layout>
    </Layout>
  );
}

export type { PageKey };
