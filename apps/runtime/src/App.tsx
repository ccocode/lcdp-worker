import { useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import zhCN from "antd/locale/zh_CN";
import { SchemaRenderer } from "@lcdp/renderer";
import type { AppInfo, Snapshot, UserInfo } from "./api.js";
import { api, getStoredUser, makeAdapter, storeSession } from "./api.js";

/**
 * 运行态应用壳（M1）：登录 -> 应用列表 -> 进入应用后按快照的 PageSchema 渲染。
 * 路由用 hash（Pages 静态托管免改写规则）：#/app/<appId><页面路由>?id=<记录id>
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

/** 全局消息提示（适配器的 notify 契约实现，模块级稳定引用） */
function notify(message: string, kind: "ok" | "error" = "ok"): void {
  if (kind === "error") void antdMessage.error(message);
  else void antdMessage.success(message);
}

export default function App() {
  const route = useHashRoute();
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());

  const logout = () => {
    storeSession(null, null);
    setUser(null);
    window.location.hash = "#/";
  };

  const match = route.path.match(/^\/app\/([^/]+)(\/.*)?$/);
  const appId = match ? decodeURIComponent(match[1]!) : null;
  const inPath = match?.[2] ?? "/";

  return (
    <ConfigProvider locale={zhCN}>
      {!user ? (
        <LoginView
          onLoggedIn={(u) => {
            setUser(u);
            window.location.hash = "#/";
          }}
        />
      ) : !appId ? (
        <AppsView user={user} onLogout={logout} />
      ) : (
        <AppView
          appId={appId}
          inPath={inPath}
          params={route.params}
          user={user}
          onLogout={logout}
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
          登录后进入已发布应用（管理员账号在初始化向导中设置）
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

function AppsView({
  user,
  onLogout,
}: {
  user: UserInfo;
  onLogout: () => void;
}) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .apps()
      .then(setApps)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        notify(msg, "error");
      });
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            我的应用
          </Typography.Title>
          <Typography.Text type="secondary">
            {user.username}（{user.role}）· 选择一个应用进入运行态
          </Typography.Text>
        </div>
        <div style={{ flex: 1 }} />
        <Button onClick={onLogout}>退出登录</Button>
      </div>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {apps.map((app) => (
          <Card
            key={app.id}
            hoverable
            onClick={() => {
              window.location.hash = `#/app/${encodeURIComponent(app.id)}`;
            }}
          >
            <Card.Meta
              title={app.name}
              description={`场景：${app.scenario ?? "—"}`}
            />
          </Card>
        ))}
      </div>
      {apps.length === 0 && !error && (
        <Typography.Text type="secondary">
          暂无应用（先完成平台初始化）
        </Typography.Text>
      )}
    </div>
  );
}

function AppView({
  appId,
  inPath,
  params,
  user,
  onLogout,
}: {
  appId: string;
  inPath: string;
  params: Record<string, string>;
  user: UserInfo;
  onLogout: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    api
      .snapshot(appId)
      .then(setSnapshot)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [appId]);

  const adapter = useMemo(
    () =>
      makeAdapter(
        appId,
        (to) => {
          window.location.hash = `#/app/${encodeURIComponent(appId)}${to}`;
        },
        notify,
      ),
    [appId],
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
          返回应用列表
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

  const listPages = snapshot.pages.filter((p) =>
    p.root.children?.some((ch) => ch.type === "DataTable"),
  );
  const current =
    snapshot.pages.find((p) => p.route === inPath) ??
    (inPath === "/" ? listPages[0] : undefined);

  const navLabel = (page: Snapshot["pages"][number]): string => {
    const ref = page.dataSources[0]?.ref;
    const entity = snapshot.data.entities.find((e) => e.key === ref);
    return entity?.label ?? page.name;
  };

  return (
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
              LCDP Runtime
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={current ? [current.route] : []}
            style={{ borderInlineEnd: "none", background: "transparent" }}
            items={listPages.map((page) => ({
              key: page.route,
              label: navLabel(page),
            }))}
            onClick={({ key }) => {
              window.location.hash = `#/app/${encodeURIComponent(appId)}${key}`;
            }}
          />
          <div style={{ flex: 1 }} />
          <Button
            block
            onClick={() => {
              window.location.hash = "#/";
            }}
          >
            ← 应用列表
          </Button>
          <Button block onClick={onLogout}>
            退出（{user.username}）
          </Button>
        </div>
      </Layout.Sider>
      <Layout.Content style={{ padding: "24px 28px", background: "#fff" }}>
        {current ? (
          <SchemaRenderer
            page={current}
            dataSchema={snapshot.data}
            adapter={adapter}
            params={params}
          />
        ) : (
          <Typography.Text type="secondary">
            页面不存在：{inPath}
          </Typography.Text>
        )}
      </Layout.Content>
    </Layout>
  );
}
