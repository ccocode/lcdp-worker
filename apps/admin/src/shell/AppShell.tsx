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
import { LogoutOutlined, SafetyOutlined } from "@ant-design/icons";
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
} from "../api";
import {
  DEF_BY_KEY,
  appFromSearch,
  contextVisibility,
  pathWithApp,
  resolvePath,
  type PageContext,
  type PageKey,
} from "../registry";

const { Header, Sider, Content } = Layout;

/**
 * 管理台外壳（第 57 步自 App.tsx 平移）：布局 / 顶栏 / 应用切换器 / 落点 /
 * 会话。页面集合、菜单与可见性全部由注册表（registry.ts）驱动，本文件
 * 只保留机制：state + history 导航（/<pagekey>?app=）、popstate 回读、
 * 上下文归位、appMeta 拉取与 appPageShell 占位、401 整页重载回原页
 * （api.expireSession）。归位时序与占位逻辑与重构前逐项一致（踩坑点，
 * 不得改判定时机）。
 */

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
      // M15 授权层：admin 直通；非 admin 须持有至少一个应用的运营授权
      // （含领域角色推导，口径在服务端 grants/me），无授权不落会话并明确报错。
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
        background: "#f5f6f8",
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

export default function AppShell() {
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const [grants, setGrants] = useState<GrantsMe | null>(() => getStoredGrants());
  const [route0] = useState(() => {
    migrateLegacyHash();
    return resolvePath();
  });
  const [page, setPage] = useState<PageKey>(route0.page);
  const [auditTabSeed, setAuditTabSeed] = useState<string | null>(route0.auditTab);
  const [settingsTabSeed, setSettingsTabSeed] = useState<string | null>(
    route0.settingsTab,
  );
  // ---- 应用上下文 ----
  const [appId, setAppId] = useState<string | null>(() => appFromSearch());
  /** 应用行清单（仅作当前应用信息富化；切换器与归位口径走 grants/me） */
  const [appsRows, setAppsRows] = useState<Row[]>([]);
  const [appMeta, setAppMeta] = useState<AdminDataMeta | null>(null);
  const [metaState, setMetaState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    const onPop = () => {
      const r = resolvePath();
      setPage(r.page);
      setAuditTabSeed(r.auditTab);
      setSettingsTabSeed(r.settingsTab);
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

  // 应用行清单（服务端已按 grants 过滤）：只用于当前应用的资料富化
  // （名称/场景/版本等）；派生应用不在此清单内时以 grants 条目兜底。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .apps.list()
      .then((list) => {
        if (!cancelled) setAppsRows(list);
      })
      .catch(() => {
        /* 失败时当前应用信息降级为 grants 条目，不打断使用 */
      });
    return () => {
      cancelled = true;
    };
  }, [user, grants]);

  /** 可运营应用集（第 57 步起切换器与上下文校验的唯一数据源：grants/me，含推导） */
  const operableApps = grants?.apps ?? [];
  const currentApp: Row | null =
    appsRows.find((a) => String(a.id) === appId) ??
    (() => {
      const g = operableApps.find((a) => a.id === appId);
      return g ? ({ id: g.id, name: g.name } as Row) : null;
    })();

  // 上下文归位：进入管理台即默认身处一个应用（对象形态归正 W4）——
  // appId 缺失或不在可运营集内时，全身份（含 admin）一律落到首个可用应用
  // （admin 取 apps/grants 全量首个、运营者取可运营集首个，同为 operableApps 口径）。
  // 可运营集为空（如应用全删）时不动，工作台呈现 app-list 空态。
  useEffect(() => {
    if (!user || !grants || operableApps.length === 0) return;
    if (!appId || !operableApps.some((a) => a.id === appId)) {
      const first = operableApps[0]!.id;
      if (first !== appId) {
        window.history.replaceState(null, "", pathWithApp(page, first));
        setAppId(first);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grants, user]);

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
  // 与 page 状态真正归位到落点页（工作台）。可见集与落点页与渲染口径同一套
  // 逻辑（contextVisibility）。元数据尚在途时不判：内容菜单可见性依赖领域
  // 元数据，按旧应用的可见集判断会把「切回内容应用」途中的合法内容页误赶走；
  // 元数据出错时 appMeta 已清空、按无内容菜单判断（页面本就不可用，归位合理）。
  useEffect(() => {
    if (!user || !grants) return;
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
  }, [user, grants, appId, appMeta, metaState, page]);

  const go = useCallback(
    (key: PageKey) => {
      setAuditTabSeed(null);
      setSettingsTabSeed(null);
      window.history.pushState(null, "", pathWithApp(key, appId));
      setPage(key);
    },
    [appId],
  );

  const switchApp = useCallback(
    (id: string) => {
      // 空 id = 清空应用上下文（工作台删光应用后的落点，呈 app-list 空态）
      if (!id) {
        window.history.pushState(null, "", `/${page}`);
        setAppId(null);
        return;
      }
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
  const effectiveDef = DEF_BY_KEY.get(effectivePage)!;

  /** 左侧菜单 = 平台分组 + 应用分组（分区只写功能名，当前应用看顶栏切换器） */
  const menuItems = [...platformGroups, ...appGroups].map((g) => ({
    type: "group" as const,
    key: `group:${g.label}`,
    label: g.label,
    children: g.items.map((d) => ({
      key: d.key,
      label: d.label,
      icon: d.icon,
    })),
  }));

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

  const ctx: PageContext = {
    user,
    isAdmin,
    grants,
    appId,
    appMeta,
    currentApp,
    visibleKeys,
    auditTabSeed,
    settingsTabSeed,
    go,
    switchApp,
  };
  const pageNode = effectiveDef.render(ctx);

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
            <Typography.Text strong>{effectiveDef.label}</Typography.Text>
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
              style={{ width: 260 }}
              options={operableApps.map((a) => ({
                value: a.id,
                label: `${a.name}（${a.id}）${a.source === "derived" ? " · 推导" : ""}`,
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
          {effectiveDef.needsMeta ? appPageShell(pageNode) : pageNode}
        </Content>
      </Layout>
    </Layout>
  );
}
