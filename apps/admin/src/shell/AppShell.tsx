import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import {
  DatabaseOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { PageHelp, tokens } from "@lcdp/ui";
import { HELP } from "../help";
import AssistantModal from "../components/AssistantModal";
import { hasRunningAssistantTask } from "../components/assistant/assistantRunning";
import { AssistantShellContext } from "./assistantShellContext";
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
  entityFromSearch,
  pathWithApp,
  pathWithData,
  resolvePath,
  type MenuGroup,
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
 * 不得改判定时机）；第 78 步在此之上加同步预归位（首载初始化与 onLogin
 * 以本地 grants 快照先行校验 appId），异步归位仍为最终权威。
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
        background: tokens.colorBgLayout,
        padding: 24,
      }}
    >
      <Card style={{ width: 380 }} title="平台管理">
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
  /** 管理台助手弹窗开合 */
  const [assistantOpen, setAssistantOpen] = useState(false);
  /** 平台管理员在对话框内显式切的应用运营上下文（2026-10-31
   * 角色锚定）：只由对话框内的明确动作设定/清除，点菜单与拨选
   * 择器都不动它；非 admin 不用（对话框恒为选择器当前应用）。 */
  const [forcedAppId, setForcedAppId] = useState<string | null>(null);
  /** 页内入口带来的任务定位信号（开弹窗时透传工作台，关弹窗即清） */
  const [modalFocusTask, setModalFocusTask] = useState<{
    taskId: string;
    nonce: number;
  } | null>(null);
  const assistantShell = useMemo(
    () => ({
      openAssistant: (ft?: { taskId: string; nonce: number }) => {
        if (ft) setModalFocusTask(ft);
        setAssistantOpen(true);
      },
    }),
    [],
  );
  const [auditTabSeed, setAuditTabSeed] = useState<string | null>(route0.auditTab);
  const [settingsTabSeed, setSettingsTabSeed] = useState<string | null>(
    route0.settingsTab,
  );
  // ---- 应用上下文 ----
  const [appId, setAppId] = useState<string | null>(() => {
    const fromUrl = appFromSearch();
    // 第 78 步首载同步归位：本地 grants 快照与会话同存（登出即清），地址里
    // 的应用不在快照可运营集内时，初始值直接落首个可运营应用，不等异步
    // 归位——页面 effect 先于外壳 effect 执行，空窗里会按旧应用发出 403 请求。
    const g = getStoredGrants();
    if (
      fromUrl &&
      g &&
      g.apps.length > 0 &&
      !g.apps.some((a) => a.id === fromUrl)
    ) {
      return g.apps[0]!.id;
    }
    return fromUrl;
  });
  // 数据维护展开组当前实体（?entity= 承载，第 76 步）
  const [dataEntity, setDataEntity] = useState<string | null>(() =>
    entityFromSearch(),
  );
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  // ---- 侧栏整栏收起（第 77 步）：状态存 localStorage，刷新/重进保持 ----
  const [siderCollapsed, setSiderCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("lcdp.admin.siderCollapsed") === "1";
    } catch {
      return false;
    }
  });
  /** 用户手动收起过的菜单节点：自动展开规则不与用户抢状态（第 77 步） */
  const userClosedRef = useRef<Set<string>>(new Set());
  /**
   * 整栏折叠切换后的防污染时间窗截止点：rc-menu 在 inlineCollapsed 切换
   * 提交后会回放一次 openKeys 清零（2026-10-19 运行态实证，污染事件在
   * 展开提交后到达、按「折叠态」判定的守卫挡不住），窗内 onOpenChange 不落 state。
   */
  const openGuardUntilRef = useRef(0);
  const toggleSider = useCallback(() => {
    openGuardUntilRef.current = Date.now() + 400;
    setSiderCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("lcdp.admin.siderCollapsed", next ? "1" : "0");
      } catch {
        /* 存储不可用时仅本次会话生效 */
      }
      return next;
    });
  }, []);
  /** 菜单展开变化：防污染窗内直接丢弃；其余记录用户手动收起集后落 state */
  const onMenuOpenChange = useCallback(
    (keys: string[]) => {
      if (Date.now() < openGuardUntilRef.current) return;
      setOpenKeys((prev) => {
        for (const k of prev)
          if (!keys.includes(k)) userClosedRef.current.add(k);
        for (const k of keys) userClosedRef.current.delete(k);
        return keys;
      });
    },
    [],
  );
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
      setDataEntity(entityFromSearch());
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
    // 第 78 步地址对齐：同步归位（初始化 / onLogin）已把状态落到正确应用、
    // 但地址仍带旧 app 参数时，以状态为准对齐地址（仅参数不一致时才动）。
    if (appId && appFromSearch() !== appId) {
      window.history.replaceState(null, "", pathWithApp(page, appId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grants, user, appId]);

  // 当前应用的领域元数据（领域菜单与模版页共用一份，切换应用即重拉）。
  // 第 65 步补 user 维度：meta 是按调用者数据权限裁剪的（actions/字段/菜单）——
  // 同一标签内换人登录（登出→换号）而 appId 不变时，旧人的权限形状不得残留，
  // 否则新登录者看到的是上一人的按钮与菜单（服务端执法不受影响、纯呈现错形）。
  useEffect(() => {
    if (!appId || !user) {
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
  }, [appId, user]);

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
      setDataEntity(null);
      window.history.pushState(null, "", pathWithApp(key, appId));
      setPage(key);
    },
    [appId],
  );

  /** 数据维护展开组导航（第 76 步）：实体走 ?entity=，与 ?app= 同一地址契约 */
  const goData = useCallback(
    (entityKey: string) => {
      setAuditTabSeed(null);
      setSettingsTabSeed(null);
      window.history.pushState(null, "", pathWithData(appId, entityKey));
      setPage("data");
      setDataEntity(entityKey);
    },
    [appId],
  );

  // 数据页落点归位（第 76 步）：meta 就绪后，若当前实体不在本应用展开组内
  // （裸 /data 进入、切应用后旧实体失效、手写了被覆盖实体的 URL），一律
  // 落到组内第一个实体；组为空时不重定向（页面呈空态）。meta 在途时不判，
  // 与会话内归位 effect 同一时序纪律。
  useEffect(() => {
    if (!user || page !== "data" || metaState !== "ok" || !appMeta) return;
    const { dataMenu } = contextVisibility({
      isAdmin: user.role === "admin",
      grants,
      appId,
      appMeta,
    });
    const entities = dataMenu?.entities ?? [];
    if (entities.length === 0) return;
    if (!dataEntity || !entities.some((e) => e.key === dataEntity)) {
      const first = entities[0]!.key;
      window.history.replaceState(null, "", pathWithData(appId, first));
      setDataEntity(first);
    }
  }, [user, grants, page, metaState, appMeta, appId, dataEntity]);

  // 自动展开（第 77 步，含第 76 步数据组规则）：当前页所在分组只「追加展开」，
  // 不收起用户已展开的其他组；用户手动收起过的节点不强行再展开。
  // 顶层单项页（工作台/应用设置）无组可展。meta 在途时分组可能不全，
  // 判不到组就跳过，meta 就绪后本 effect 会再跑一次。
  useEffect(() => {
    if (!user || !grants) return;
    let key: string | null = null;
    if (page === "data") {
      key = "data-submenu";
    } else {
      const { platformGroups, appGroups } = contextVisibility({
        isAdmin: user.role === "admin",
        grants,
        appId,
        appMeta,
      });
      const g = [...appGroups, ...platformGroups].find((grp) =>
        grp.items.some((d) => d.key === page),
      );
      if (g) key = `sec:${g.label}`;
    }
    if (!key || userClosedRef.current.has(key)) return;
    const k = key;
    setOpenKeys((ks) => (ks.includes(k) ? ks : [...ks, k]));
  }, [user, grants, appId, appMeta, page]);

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

  /**
   * 刷新外壳上下文（第 89 步）：重拉授权与应用行清单，落定后才 resolve。
   * 应用管理页新建应用成功后先 await 本函数再 switchApp——归位 effect 按
   * grants 可运营集校验 appId，新应用不在集内会被弹回，须先让集更新。
   * 拉取失败保留现状快照、不打断使用（与首拉的容错口径一致）。
   */
  const refreshContext = useCallback(async (): Promise<void> => {
    const [me, list] = await Promise.allSettled([
      api.grants.me(),
      api.apps.list(),
    ]);
    if (me.status === "fulfilled") {
      setGrants(me.value);
      storeGrants(me.value);
    }
    if (list.status === "fulfilled") setAppsRows(list.value);
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
          const me = getStoredGrants();
          setGrants(me);
          // 第 78 步换人登录同步归位：appId 状态跨登出保留、地址也残留上一
          // 会话的应用；新用户快照在 Login.submit 已先行落盘，若当前 appId
          // 不在其可运营集内，在 setUser 触发页面挂载的同批更新里先纠正到
          // 首个可运营应用并对齐地址，页面首帧即正确上下文、零错发请求。
          if (me && me.apps.length > 0) {
            const cur = appId ?? appFromSearch();
            if (cur && !me.apps.some((a) => a.id === cur)) {
              const first = me.apps[0]!.id;
              window.history.replaceState(null, "", pathWithApp(page, first));
              setAppId(first);
            }
          }
          setUser(u);
        }}
      />
    );

  const isAdmin = user.role === "admin";
  const { platformGroups, appGroups, visibleKeys, fallbackPage, dataMenu } =
    contextVisibility({ isAdmin, grants, appId, appMeta });
  const effectivePage: PageKey = visibleKeys.has(page) ? page : fallbackPage;
  const effectiveDef = DEF_BY_KEY.get(effectivePage)!;

  /**
   * 左侧菜单（第 77 步重组）：工作台顶层单项 → 当前应用段（模版组 → 运营管理
   * → 数据维护子菜单 → 应用设置单项）→ 分隔 +「平台管理」总标题 → 平台段三组。
   * 分组一律渲染为可折叠 submenu 节点（key = sec:<分组名>，图标取组内首项），
   * 与数据维护子菜单共用 openKeys 一套折叠机制；菜单项集合与可见性口径
   * 仍由 contextVisibility 决定，本处只定顺序与形态。
   */
  type MenuItem = NonNullable<MenuProps["items"]>[number];
  const toSubmenu = (g: MenuGroup): MenuItem => ({
    type: "submenu" as const,
    key: `sec:${g.label}`,
    label: g.label,
    icon: g.items[0]?.icon,
    children: g.items.map((d) => ({
      key: d.key,
      label: d.label,
      icon: d.icon,
    })),
  });
  const menuItems: MenuItem[] = [];
  const wbDef = DEF_BY_KEY.get("workbench")!;
  menuItems.push({ key: wbDef.key, label: wbDef.label, icon: wbDef.icon });
  for (const g of appGroups) menuItems.push(toSubmenu(g));
  // 数据维护展开组（第 76 步）：位于运营管理之后、应用设置单项之前；
  // 组为空（实体全被模版覆盖）时整组不出现。
  if (dataMenu && dataMenu.entities.length > 0) {
    menuItems.push({
      type: "submenu" as const,
      key: "data-submenu",
      label: "数据维护",
      icon: <DatabaseOutlined />,
      children: dataMenu.entities.map((e) => ({
        key: `data:${e.key}`,
        label: e.label,
      })),
    });
  }
  if (appId && visibleKeys.has("appsettings")) {
    const sDef = DEF_BY_KEY.get("appsettings")!;
    menuItems.push({ key: sDef.key, label: sDef.label, icon: sDef.icon });
  }
  // 平台段沉底：除工作台外无任何可见项（如运营者且无 kb 例外）时，
  // 分界与总标题整段不出现，不留空组/孤标题。
  if (platformGroups.length > 0) {
    menuItems.push({ type: "divider" as const, key: "platform-divider" });
    menuItems.push({
      type: "group" as const,
      key: "platform-caption",
      label: "平台管理",
      children: [],
    });
    for (const g of platformGroups) menuItems.push(toSubmenu(g));
  }

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
    dataEntity,
    dataMenuEntities: dataMenu?.entities ?? [],
    goData,
    auditTabSeed,
    settingsTabSeed,
    go,
    switchApp,
    refreshContext,
  };
  const pageNode = effectiveDef.render(ctx);

  // 对话框有效上下文（2026-10-31 角色锚定，取代按页分区）：
  // 能力按角色——平台管理员默认平台超集（forcedAppId 为空时），
  // 运营者恒为选择器当前应用；点菜单不改变上下文与提示。
  // 默认目标应用取顶栏选择器的当前应用（见下方 context.appId），
  // 不取当前页。forcedAppId 不在可运营集内时回落平台，不阻塞。
  const effectiveForcedAppId =
    isAdmin && forcedAppId && operableApps.some((a) => a.id === forcedAppId)
      ? forcedAppId
      : null;
  const dialogAppId = isAdmin ? effectiveForcedAppId : appId;
  const dialogAppName = dialogAppId
    ? (operableApps.find((a) => a.id === dialogAppId)?.name ??
      (currentApp && typeof currentApp.name === "string"
        ? currentApp.name
        : null))
    : null;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        theme="light"
        width={208}
        collapsedWidth={64}
        collapsed={siderCollapsed}
        trigger={null}
        style={{
          borderRight: `1px solid ${tokens.colorBorder}`,
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div
            style={{
              padding: "16px 16px 8px",
              fontWeight: 600,
              fontSize: 16,
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {siderCollapsed ? "平" : "平台管理"}
          </div>
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
            <Menu
              mode="inline"
              inlineCollapsed={siderCollapsed}
              selectedKeys={
                effectivePage === "data" && dataEntity
                  ? [`data:${dataEntity}`]
                  : [effectivePage]
              }
              openKeys={openKeys}
              onOpenChange={onMenuOpenChange}
              items={menuItems}
              onClick={(e) => {
                if (e.key.startsWith("data:")) goData(e.key.slice("data:".length));
                else go(e.key as PageKey);
              }}
            />
          </div>
          <div
            onClick={toggleSider}
            style={{
              borderTop: `1px solid ${tokens.colorBorder}`,
              padding: "10px 16px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              color: tokens.colorTextSecondary,
              fontSize: 13,
            }}
          >
            {siderCollapsed ? (
              <MenuUnfoldOutlined />
            ) : (
              <>
                <MenuFoldOutlined /> 收起侧栏
              </>
            )}
          </div>
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: tokens.colorBgContainer,
            borderBottom: `1px solid ${tokens.colorBorder}`,
            position: "sticky",
            top: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingInline: 24,
          }}
        >
          <Space>
            <Typography.Text strong>{effectiveDef.label}</Typography.Text>
            {HELP[effectivePage] && <PageHelp entry={HELP[effectivePage]!} />}
            <Select
              allowClear={isAdmin}
              placeholder="选择应用"
              value={appId ?? undefined}
              onChange={(v) => {
                if (!v) return;
                // 第 103 步步骤 6：弹窗打开且旧应用有任务在跑时，切应用
                // 前先提示（确认后切、任务留在旧应用任务卡；取消则不
                // 切换，Select 受控值保持旧应用）。查不到任务状态时不
                // 拦切换。2026-10-31 用户定：有任务在跑切应用肯定要提
                // 示——任务发起只能基于当前应用。角色锚定下管理员对话
                // 框本身虽不受选择器影响，但切选择器即换默认目标（新
                // 发起任务将基于新应用），故管理员同样提示；检查口径
                // 为旧选择器应用的在跑任务（运营者即对话框上下文）。
                void (async () => {
                  if (assistantOpen && appId) {
                    try {
                      const list = await api.assistant.app.tasks(appId, {
                        status: "active",
                      });
                      if (hasRunningAssistantTask(list)) {
                        Modal.confirm({
                          title: "助手正在执行任务",
                          content:
                            "切换应用后任务留在旧应用任务卡、可回旧应用续跑，是否切换？",
                          okText: "切换",
                          cancelText: "取消",
                          onOk: () => switchApp(v),
                        });
                        return;
                      }
                    } catch {
                      // 静默：不拦切换
                    }
                  }
                  switchApp(v);
                })();
              }}
              onClear={() => {
                window.history.pushState(null, "", `/${page}`);
                setAppId(null);
              }}
              style={{ width: 260 }}
              options={operableApps.map((a) => ({
                value: a.id,
                label: a.name,
              }))}
            />
          </Space>
          <Space>
            <Typography.Text type="secondary">
              {isAdmin ? "当前管理员" : "当前运营者"}：{user.username}（{user.role}）
            </Typography.Text>
            <Button
              icon={<RobotOutlined />}
              onClick={() => setAssistantOpen(true)}
            >
              助手
            </Button>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24, background: tokens.colorBgLayout }}>
          <AssistantShellContext.Provider value={assistantShell}>
            {effectiveDef.needsMeta ? appPageShell(pageNode) : pageNode}
          </AssistantShellContext.Provider>
        </Content>
      </Layout>
      {/* 助手上下文按角色锚定（2026-10-31，取代第 83 步片四的按页
          分区）：平台管理员默认平台超集、运营者恒为选择器当前应用；
          平台管理员在对话框内显式切应用运营上下文（forcedAppId）后
          才走应用上下文，切换只由对话框内动作触发。上下文切换时
          AssistantModal 内部按 appId 重挂载内容，换上下文即换新会话面。
          页面上下文的 appId 恒为顶栏选择器当前应用（默认目标），不
          再随页面所在区归空。
          第 103 步步骤 6：顶栏按钮改开弹窗壳，抽屉组件保留在仓内
          作回退（不再挂载）。 */}
      <AssistantModal
        open={assistantOpen}
        onClose={() => {
          setAssistantOpen(false);
          setModalFocusTask(null);
        }}
        focusTask={modalFocusTask}
        appId={dialogAppId}
        appName={dialogAppName}
        isAdmin={isAdmin}
        operableApps={operableApps}
        forcedAppId={effectiveForcedAppId}
        onForcedAppIdChange={setForcedAppId}
        context={{
          // 第 90 步线 A4：页面上下文带入——appId 恒为顶栏选择器
          // 当前应用（默认目标），实体只在数据页且已定位时带、不硬造
          path: window.location.pathname + window.location.search,
          pageName: effectiveDef.label,
          appId,
          segment: effectiveDef.segment,
          ...(effectivePage === "data" && dataEntity
            ? { entityKey: dataEntity }
            : {}),
        }}
      />
    </Layout>
  );
}
