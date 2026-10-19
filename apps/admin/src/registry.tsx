import React from "react";
import {
  ApartmentOutlined,
  AuditOutlined,
  BookOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  GlobalOutlined,
  IdcardOutlined,
  InboxOutlined,
  LinkOutlined,
  AppstoreOutlined,
  SettingOutlined,
  SkinOutlined,
  StopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type {
  AdminDataMeta,
  GrantsMe,
  Row,
  UserInfo,
} from "./api";
import { domainHealth, requiredEntitiesPresent } from "./domainHealth";
import { TEMPLATES } from "./templates";
import Workbench from "./pages/Workbench";
import Tenants from "./pages/Tenants";
import Users from "./pages/Users";
import Apps from "./pages/Apps";
import AuditCenter from "./pages/AuditCenter";
import Kb from "./pages/Kb";
import Usage from "./pages/Usage";
import ConfigPage from "./pages/ConfigPage";
import Switches from "./pages/Switches";
import DataAdmin from "./pages/DataAdmin";
import FlowTasks from "./pages/FlowTasks";
import AppAssets from "./pages/AppAssets";
import Members from "./pages/Members";
import Submissions from "./pages/Submissions";
import StaticStatus from "./pages/StaticStatus";
import AppSettings from "./pages/AppSettings";
import AppThemeSettings from "./pages/AppThemeSettings";
import DomainBindings from "./pages/DomainBindings";

/**
 * 页面注册表（第 57 步）：页面定义单点——key / 组件 / 所属段
 * （platform | app | template）/ 菜单元信息 / 可见性声明。
 * 新增页面 = 在此登记一项（领域模版页在 templates/ 下按领域登记），
 * 外壳（菜单、落点、归位、渲染）全部由注册表驱动，不再改 App.tsx。
 */

export type PageKey =
  // 平台段（终态 9 页）
  | "workbench"
  | "tenants"
  | "users"
  | "apps"
  | "kb"
  | "usage"
  | "switches"
  | "config"
  | "audit"
  // 应用段基础页（终态 9 页，须当前应用上下文）
  | "tasks"
  | "data"
  | "appassets"
  | "members"
  | "submissions"
  | "theme-settings"
  | "domains"
  | "static"
  | "appsettings"
  // 领域模版段（内容领域，见 templates/content）
  | "content-workbench"
  | "content-categories"
  | "content-authors"
  | "content-messages"
  | "content-article-editor"
  // 领域模版段（商城领域，见 templates/commerce）
  | "commerce-products"
  | "commerce-orders"
  | "commerce-categories"
  // 领域模版段（客服领域，见 templates/support）
  | "support-tickets"
  | "support-stats";

export type PageSegment = "platform" | "app" | "template";

/** 外壳传给页面渲染的上下文（注册表 render 的唯一入参） */
export interface PageContext {
  user: UserInfo;
  isAdmin: boolean;
  grants: GrantsMe | null;
  appId: string | null;
  appMeta: AdminDataMeta | null;
  /** 当前应用行（应用行清单优先、grants 条目兜底；派生应用可能只有名称） */
  currentApp: Row | null;
  /** 当前可见页集（工作台快捷入口等按此过滤） */
  visibleKeys: Set<PageKey>;
  /** 深链别名种子：/replay 进入时为 "replay"，供审计中心预选页签 */
  auditTabSeed: string | null;
  go: (key: PageKey) => void;
  switchApp: (id: string) => void;
}

export interface PageDef {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  segment: PageSegment;
  /** 左侧菜单分组（只写功能名；当前应用由顶栏切换器呈现） */
  section: string;
  /**
   * 运营者例外可见（平台段默认仅 admin）：目前仅知识库——
   * 对可运营集（含推导来源）含 supplier-service 的运营者可见。
   */
  operatorException?: "kb";
  /** 渲染前须经 appPageShell（依赖当前应用 appMeta 就绪） */
  needsMeta?: boolean;
  /**
   * 菜单隐藏（第 58 步）：页面可达（在 visibleKeys 内、go()/归位照常），
   * 但不出现在左侧菜单分组里——如文章编辑页，只从工作台/快捷入口进入。
   */
  menuHidden?: boolean;
  /** 模版段：所属领域 key（可见性按 domain + 映射健康判定） */
  templateDomain?: string;
  /** 模版段：所需实体（实体 key 或 roles 语义锚点），缺一不可见（W7 数据维度） */
  requiresEntities?: (string | { role: string })[];
  render: (ctx: PageContext) => React.ReactNode;
}

/** 领域模版声明（工作台消费：领域关键指标 + 快捷入口） */
export interface MetricDecl {
  key: string;
  label: string;
  entity?: string;
  entityRole?: string;
  filterField?: string;
  filterValue?: string;
  page: PageKey;
}

export interface TemplateDef {
  domain: string;
  section: string;
  pages: PageDef[];
  metrics: MetricDecl[];
  quickLinks: { label: string; page: PageKey }[];
}

/** 平台段页面（数组顺序即分区呈现顺序） */
const PLATFORM_DEFS: PageDef[] = [
  {
    key: "workbench",
    label: "工作台",
    icon: <DashboardOutlined />,
    segment: "platform",
    section: "总览",
    render: (ctx) => <Workbench ctx={ctx} />,
  },
  {
    key: "tenants",
    label: "租户",
    icon: <ApartmentOutlined />,
    segment: "platform",
    section: "组织与权限",
    render: () => <Tenants />,
  },
  {
    key: "users",
    label: "用户与角色",
    icon: <TeamOutlined />,
    segment: "platform",
    section: "组织与权限",
    render: (ctx) => <Users currentUser={ctx.user} />,
  },
  {
    key: "apps",
    label: "应用管理",
    icon: <AppstoreOutlined />,
    segment: "platform",
    section: "应用与资产",
    render: () => <Apps />,
  },
  {
    key: "kb",
    label: "知识库",
    icon: <BookOutlined />,
    segment: "platform",
    section: "内容与知识",
    operatorException: "kb",
    render: () => <Kb />,
  },
  {
    key: "usage",
    label: "成本看板",
    icon: <DollarOutlined />,
    segment: "platform",
    section: "运营保障",
    render: () => <Usage />,
  },
  {
    key: "switches",
    label: "熔断与配额",
    icon: <StopOutlined />,
    segment: "platform",
    section: "运营保障",
    render: () => <Switches />,
  },
  {
    key: "config",
    label: "系统配置",
    icon: <SettingOutlined />,
    segment: "platform",
    section: "运营保障",
    render: () => <ConfigPage />,
  },
  {
    key: "audit",
    label: "审计中心",
    icon: <AuditOutlined />,
    segment: "platform",
    section: "审计追溯",
    render: (ctx) => <AuditCenter initialTab={ctx.auditTabSeed} />,
  },
];

/** 应用段基础页（平台统一供给，终态 9 页） */
const APP_DEFS: PageDef[] = [
  {
    key: "tasks",
    label: "流程待办",
    icon: <FileTextOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => (
      <FlowTasks key={ctx.appId!} appId={ctx.appId!} user={ctx.user} />
    ),
  },
  {
    key: "data",
    label: "数据管理",
    icon: <AppstoreOutlined />,
    segment: "app",
    section: "运营管理",
    needsMeta: true,
    render: (ctx) => (
      <DataAdmin key={ctx.appId!} appId={ctx.appId!} meta={ctx.appMeta!} />
    ),
  },
  {
    key: "appassets",
    label: "资产管理",
    icon: <InboxOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => <AppAssets key={ctx.appId!} appId={ctx.appId!} />,
  },
  {
    key: "members",
    label: "应用会员",
    icon: <IdcardOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => <Members key={ctx.appId!} appId={ctx.appId!} />,
  },
  {
    key: "submissions",
    label: "提交审核",
    icon: <AuditOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => <Submissions key={ctx.appId!} appId={ctx.appId!} />,
  },
  {
    key: "theme-settings",
    label: "主题设置",
    icon: <SkinOutlined />,
    segment: "app",
    section: "发布与外观",
    render: (ctx) => (
      <AppThemeSettings key={ctx.appId!} appId={ctx.appId!} isAdmin={ctx.isAdmin} />
    ),
  },
  {
    key: "domains",
    label: "域名绑定",
    icon: <LinkOutlined />,
    segment: "app",
    section: "发布与外观",
    render: (ctx) => (
      <DomainBindings key={ctx.appId!} appId={ctx.appId!} isAdmin={ctx.isAdmin} />
    ),
  },
  {
    key: "static",
    label: "静态状态",
    icon: <GlobalOutlined />,
    segment: "app",
    section: "发布与外观",
    render: (ctx) => (
      <StaticStatus key={ctx.appId!} appId={ctx.appId!} isAdmin={ctx.isAdmin} />
    ),
  },
  {
    key: "appsettings",
    label: "应用设置",
    icon: <SettingOutlined />,
    segment: "app",
    section: "应用设置",
    render: (ctx) => (
      <AppSettings
        key={ctx.appId!}
        appId={ctx.appId!}
        app={ctx.currentApp}
        meta={ctx.appMeta}
      />
    ),
  },
];

export const PAGE_DEFS: PageDef[] = [
  ...PLATFORM_DEFS,
  ...APP_DEFS,
  ...TEMPLATES.flatMap((t) => t.pages),
];

export const DEF_BY_KEY: Map<PageKey, PageDef> = new Map(
  PAGE_DEFS.map((d) => [d.key, d]),
);

/** 应用区分区呈现顺序（领域模版分区插在通用运营管理之后、发布与设置之前） */
const APP_SECTION_ORDER: string[] = [
  "运营管理",
  ...TEMPLATES.map((t) => t.section),
  "发布与外观",
  "应用设置",
];

export interface MenuGroup {
  label: string;
  items: PageDef[];
}

/** 把一串页面按 section 分组：给了 order 则按 order，空区不出现 */
function groupBySection(items: PageDef[], order?: string[]): MenuGroup[] {
  const bySection = new Map<string, PageDef[]>();
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

/**
 * 可见性谓词（第 57 步 W7，输入 = 身份 + 可运营集（含 source）+ 当前应用
 * meta 的 domain/健康/实体集）：
 * - 工作台全身份可见（默认落点）；
 * - 平台段其余页 admin 全量；运营者仅 kb 例外（可运营集含 supplier-service，
 *   grant 或推导来源均可——如客服坐席 kefu 经 support 角色推导命中）；
 * - 应用段基础页须有当前应用上下文（数据管理页在 meta 未发布/实体为空时
 *   呈现页内空态而非菜单消失）；
 * - 模版段三重门控：domain 命中 + 映射健康 + 所需实体（roles 锚点）齐备。
 */
export function contextVisibility(args: {
  isAdmin: boolean;
  grants: GrantsMe | null;
  appId: string | null;
  appMeta: AdminDataMeta | null;
}): {
  platformGroups: MenuGroup[];
  appGroups: MenuGroup[];
  visibleKeys: Set<PageKey>;
  fallbackPage: PageKey;
} {
  const { isAdmin, grants, appId, appMeta } = args;
  const operable = grants?.apps ?? [];
  const platformVisible = PAGE_DEFS.filter((d) => {
    if (d.segment !== "platform") return false;
    if (d.key === "workbench") return true;
    if (isAdmin) return true;
    return (
      d.operatorException === "kb" &&
      operable.some((a) => a.id === "supplier-service")
    );
  });
  const appVisible = appId
    ? PAGE_DEFS.filter((d) => d.segment === "app")
    : [];
  const health = appMeta ? domainHealth(appMeta) : null;
  const templateVisible =
    appId && appMeta
      ? PAGE_DEFS.filter(
          (d) =>
            d.segment === "template" &&
            appMeta.app.domain === d.templateDomain &&
            !!health?.hasDomain &&
            health.healthy &&
            requiredEntitiesPresent(appMeta, d.requiresEntities ?? []),
        )
      : [];
  // 菜单分组排除 menuHidden 页（如文章编辑页）：只隐藏菜单入口，
  // visibleKeys 仍保留该页——归位 effect 与 go() 依赖它判定可达性。
  const platformGroups = groupBySection(
    platformVisible.filter((d) => !d.menuHidden),
  );
  const appGroups = groupBySection(
    [...appVisible, ...templateVisible].filter((d) => !d.menuHidden),
    APP_SECTION_ORDER,
  );
  const visibleKeys = new Set<PageKey>([
    ...platformVisible.map((d) => d.key),
    ...appVisible.map((d) => d.key),
    ...templateVisible.map((d) => d.key),
  ]);
  return { platformGroups, appGroups, visibleKeys, fallbackPage: "workbench" };
}

/**
 * 路径别名（地址契约 /<pagekey>?app= 不变，仅补存量深链的落点）：
 * /replay → 审计中心 + 预选回放页签（E2 合并）；/overview → 工作台；
 * 已下线页（themes/assets/sites）与未知路径回落工作台。
 */
const PATH_ALIASES: Record<string, { page: PageKey; auditTab?: string }> = {
  replay: { page: "audit", auditTab: "replay" },
  overview: { page: "workbench" },
};

export function resolvePath(): { page: PageKey; auditTab: string | null } {
  const h = window.location.pathname.replace(/^\//, "");
  const alias = PATH_ALIASES[h];
  if (alias) return { page: alias.page, auditTab: alias.auditTab ?? null };
  const found = DEF_BY_KEY.get(h as PageKey);
  return { page: found ? found.key : "workbench", auditTab: null };
}

/** 应用上下文：当前应用以 URL 查询 ?app=<id> 承载（深链可达、刷新保持） */
export function appFromSearch(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("app");
  } catch {
    return null;
  }
}

export function pathWithApp(key: PageKey, appId: string | null): string {
  return appId ? `/${key}?app=${encodeURIComponent(appId)}` : `/${key}`;
}
