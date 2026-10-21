import React from "react";
import {
  ApartmentOutlined,
  AuditOutlined,
  BookOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  IdcardOutlined,
  InboxOutlined,
  AppstoreOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Alert } from "antd";
import type {
  AdminDataMeta,
  AdminEntityMeta,
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
import AppKb from "./pages/AppKb";
import Submissions from "./pages/Submissions";
import AppSettings from "./pages/AppSettings";
import AgentService from "./pages/AgentService";
import AppAgentService from "./pages/AppAgentService";

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
  | "agentsvc"
  | "config"
  | "audit"
  // 应用段基础页（须当前应用上下文；归正后：运营管理 5 + 数据维护 1 + 应用设置 1，
  // 域名/主题/静态已收进应用设置作属性页签，见归正执行单 W2/W3）
  | "tasks"
  | "data"
  | "appassets"
  | "members"
  | "appkb"
  | "submissions"
  | "appagentsvc"
  | "app-audit"
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
  /** 数据维护展开组当前实体（?entity= 承载；非 data 页为 null） */
  dataEntity: string | null;
  /** 数据维护展开组实体清单（去重 + 归位后的顶层实体；外壳菜单与 data 页共用） */
  dataMenuEntities: { key: string; label: string }[];
  /** 跳到数据维护展开组的某个实体页 */
  goData: (entityKey: string) => void;
  /** 深链别名种子：/replay 进入时为 "replay"，供审计中心预选页签 */
  auditTabSeed: string | null;
  /** 深链别名种子：/domains 等存量深链进入时为对应页签 key，供应用设置预选页签 */
  settingsTabSeed: string | null;
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
   * 菜单顶层单项（第 77 步）：不进任何分组、直接作菜单根项呈现
   * （工作台、应用设置——单项集合不设组节点，分组只留给 ≥2 项的集合）。
   * 只影响菜单呈现分组，visibleKeys 与可见性谓词不因此改变。
   */
  topLevel?: boolean;
  /** 渲染前须经 appPageShell（依赖当前应用 appMeta 就绪） */
  needsMeta?: boolean;
  /**
   * 菜单隐藏（第 58 步）：页面可达（在 visibleKeys 内、go()/归位照常），
   * 但不出现在左侧菜单分组里——如文章编辑页，只从工作台/快捷入口进入。
   */
  menuHidden?: boolean;
  /**
   * 模版段：本页承接数据维护的实体角色名（第 76 步去重声明）——声明了的
   * 实体从数据维护展开组中除名（一个实体只出现一次）；队列/统计类页面
   * 不承接实体维护，不声明（如留言审核是待审队列、不维护正式记录）。
   */
  coversRole?: string;
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
    // 第 77 步：提为菜单顶层单项（原「总览」单项组解散），section 仅占位
    section: "总览",
    topLevel: true,
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
    // 第 77 步：原「应用与资产」「内容与知识」「运营保障」三组合并为「平台运营」
    section: "平台运营",
    render: () => <Apps />,
  },
  {
    // 第 81 步 G4：平台知识库回归 admin 专属（应用面治理走应用段
    // 「知识库」页 appkb）；原运营者例外（可运营 supplier-service
    // 即可见）已撤，与服务端 /admin/kb 收口同口径。
    key: "kb",
    label: "知识库",
    icon: <BookOutlined />,
    segment: "platform",
    section: "平台运营",
    render: () => <Kb />,
  },
  {
    key: "usage",
    label: "成本看板",
    icon: <DollarOutlined />,
    segment: "platform",
    section: "平台运营",
    render: () => <Usage />,
  },
  {
    key: "switches",
    label: "熔断与配额",
    icon: <StopOutlined />,
    segment: "platform",
    section: "平台运营",
    render: () => <Switches />,
  },
  {
    // 第 83 步片四：两项智能服务的呈现汇总（只读），维护面仍在
    // 熔断与配额 / 成本看板 / 各应用的智能服务页，本页不复制。
    key: "agentsvc",
    label: "智能服务",
    icon: <RobotOutlined />,
    segment: "platform",
    section: "平台运营",
    render: () => <AgentService />,
  },
  {
    key: "config",
    label: "系统配置",
    icon: <SettingOutlined />,
    segment: "platform",
    section: "平台运营",
    render: () => <ConfigPage />,
  },
  {
    key: "audit",
    label: "审计中心",
    icon: <AuditOutlined />,
    segment: "platform",
    section: "审计追溯",
    // 平台 scope：只显无应用归属的平台级事件（归正判据：带 app_id 的明细跟随应用）
    render: (ctx) => <AuditCenter scope="platform" initialTab={ctx.auditTabSeed} />,
  },
];

/**
 * 应用段基础页（平台统一供给）。对象形态归正后的菜单语法：
 * 模版段（领域生成）→ 运营管理 → 数据维护 → 应用设置；
 * 域名/主题/静态不再是独立页，已收进应用设置作本应用的属性页签（W3）。
 */
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
    key: "submissions",
    label: "提交审核",
    icon: <AuditOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => <Submissions key={ctx.appId!} appId={ctx.appId!} />,
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
    // 第 81 步 G4：应用面知识库（本应用文档 + 待审队列）；页内按
    // 服务端档位呈现（t2 客服仅待审、双面 403 呈无权态）。
    key: "appkb",
    label: "知识库",
    icon: <BookOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => <AppKb key={ctx.appId!} appId={ctx.appId!} />,
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
    // 第 83 步片二第 3 点：本应用三位助手的日常调整（人设/启停/
    // 知识范围，保存即生效）+ 运营助手会话记录只读。
    key: "appagentsvc",
    label: "智能服务",
    icon: <RobotOutlined />,
    segment: "app",
    section: "运营管理",
    render: (ctx) => (
      <AppAgentService key={ctx.appId!} appId={ctx.appId!} />
    ),
  },
  {
    key: "app-audit",
    label: "审计日志",
    icon: <AuditOutlined />,
    segment: "app",
    section: "运营管理",
    // app scope：只显本应用事件（归正 P2 按应用端点），回放固定本应用
    render: (ctx) => (
      <AuditCenter
        key={ctx.appId!}
        scope="app"
        appId={ctx.appId!}
        initialTab={ctx.auditTabSeed}
      />
    ),
  },
  {
    // 第 76 步展开：本页不再聚合全部实体——菜单由外壳按 dataMenuEntities
    // 渲染为可展开组（每实体一项），页面本体按 ?entity= 锁定单实体呈现；
    // 实体不在展开组内（被模版覆盖/子表/连接表）或组为空时呈空态，
    // 落到组内首个实体的重定向由外壳 effect 负责。
    key: "data",
    label: "数据维护",
    icon: <AppstoreOutlined />,
    segment: "app",
    section: "数据维护",
    needsMeta: true,
    render: (ctx) => {
      const ent =
        ctx.dataEntity &&
        ctx.dataMenuEntities.find((e) => e.key === ctx.dataEntity);
      if (!ent) {
        return (
          <Alert
            type="info"
            showIcon
            message="本应用没有待维护的数据表"
            description="该应用的实体均已由领域模版页维护，或已发布设计中尚无数据实体。"
          />
        );
      }
      return (
        <DataAdmin
          key={`${ctx.appId!}:data:${ent.key}`}
          appId={ctx.appId!}
          meta={ctx.appMeta!}
          lockEntity={ent.key}
          title={ent.label}
        />
      );
    },
  },
  {
    key: "appsettings",
    label: "应用设置",
    icon: <SettingOutlined />,
    segment: "app",
    // 第 77 步：提为菜单顶层单项（与工作台同式），section 仅占位
    section: "应用设置",
    topLevel: true,
    render: (ctx) => (
      <AppSettings
        key={ctx.appId!}
        appId={ctx.appId!}
        app={ctx.currentApp}
        meta={ctx.appMeta}
        isAdmin={ctx.isAdmin}
        settingsTabSeed={ctx.settingsTabSeed}
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

/** 平台段分区呈现顺序（第 77 步归并后三组） */
const PLATFORM_SECTION_ORDER: string[] = ["组织与权限", "平台运营", "审计追溯"];

/** 应用区分区呈现顺序（对象形态归正：模版段 → 运营管理 → 数据维护 → 应用设置） */
const APP_SECTION_ORDER: string[] = [
  ...TEMPLATES.map((t) => t.section),
  "运营管理",
  "数据维护",
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
 * - 平台段其余页 admin 全量（第 81 步 G4 起：原 kb 运营者例外已撤，
 *   知识库治理走应用段 appkb 页、按应用档位）；
 * - 应用段基础页须有当前应用上下文（数据维护页在 meta 未发布/实体为空时
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
  /** 数据维护展开组（第 76 步）：去重/归位后的顶层实体；null = 尚无 meta 不出菜单 */
  dataMenu: { entities: { key: string; label: string }[] } | null;
} {
  const { isAdmin, appId, appMeta } = args;
  const platformVisible = PAGE_DEFS.filter((d) => {
    if (d.segment !== "platform") return false;
    if (d.key === "workbench") return true;
    // 第 81 步 G4：平台段回归 admin 专属（原 kb 运营者例外已撤）。
    return isAdmin;
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
  // 第 77 步：topLevel 页（工作台/应用设置）同样不进分组，由外壳作菜单
  // 根项单独渲染；平台段按 PLATFORM_SECTION_ORDER 显式排序。
  const platformGroups = groupBySection(
    platformVisible.filter((d) => !d.menuHidden && !d.topLevel),
    PLATFORM_SECTION_ORDER,
  );
  // 「数据维护」分组自 appGroups 摘出：展开组由外壳按 dataMenu 单独渲染
  // 为可展开子菜单（第 76 步），data 页 def 本身只负责页面本体。
  const appGroups = groupBySection(
    [...appVisible, ...templateVisible].filter(
      (d) => !d.menuHidden && !d.topLevel,
    ),
    APP_SECTION_ORDER,
  ).filter((g) => g.label !== "数据维护");
  const visibleKeys = new Set<PageKey>([
    ...platformVisible.map((d) => d.key),
    ...appVisible.map((d) => d.key),
    ...templateVisible.map((d) => d.key),
  ]);
  // 数据维护展开组（第 76 步）：覆盖集 = 可见模版页 coversRole 声明经
  // roles 映射求解；候选 = meta 实体（已按调用者权限裁剪）− 覆盖集
  // − 子实体（parentField 非空，归父实体编辑面）− 连接表（字段 ≥2 且
  // 全部为 ref 的纯多对多连接实体，归两端编辑面）。
  const roles = appMeta?.domainModules?.roles ?? {};
  const covered = new Set<string>();
  for (const d of templateVisible) {
    if (d.coversRole) covered.add(roles[d.coversRole] ?? d.coversRole);
  }
  const isJunction = (e: AdminEntityMeta) =>
    e.fields.length >= 2 && e.fields.every((f) => f.type === "ref");
  const dataMenu =
    appId && appMeta
      ? {
          entities: appMeta.entities
            .filter(
              (e) => !covered.has(e.key) && !e.parentField && !isJunction(e),
            )
            .map((e) => ({ key: e.key, label: e.label })),
        }
      : null;
  return {
    platformGroups,
    appGroups,
    visibleKeys,
    fallbackPage: "workbench",
    dataMenu,
  };
}

/**
 * 路径别名（地址契约 /<pagekey>?app= 不变，仅补存量深链的落点）：
 * /replay → 审计中心 + 预选回放页签（E2 合并）；/overview → 工作台；
 * 对象形态归正后下线的应用段独立页 /theme-settings、/domains、/static →
 * 应用设置 + 对应属性页签种子（theme/domains/static）；更早下线页
 * （themes/assets/sites）与未知路径回落工作台。
 */
const PATH_ALIASES: Record<
  string,
  { page: PageKey; auditTab?: string; settingsTab?: string }
> = {
  replay: { page: "audit", auditTab: "replay" },
  overview: { page: "workbench" },
  "theme-settings": { page: "appsettings", settingsTab: "theme" },
  domains: { page: "appsettings", settingsTab: "domains" },
  static: { page: "appsettings", settingsTab: "static" },
};

export function resolvePath(): {
  page: PageKey;
  auditTab: string | null;
  settingsTab: string | null;
} {
  const h = window.location.pathname.replace(/^\//, "");
  const alias = PATH_ALIASES[h];
  if (alias) {
    return {
      page: alias.page,
      auditTab: alias.auditTab ?? null,
      settingsTab: alias.settingsTab ?? null,
    };
  }
  const found = DEF_BY_KEY.get(h as PageKey);
  return {
    page: found ? found.key : "workbench",
    auditTab: null,
    settingsTab: null,
  };
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

/** 数据维护展开组深链：实体以 ?entity= 承载（与 ?app= 同一地址契约） */
export function entityFromSearch(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("entity");
  } catch {
    return null;
  }
}

export function pathWithData(appId: string | null, entityKey: string): string {
  const qs = new URLSearchParams();
  if (appId) qs.set("app", appId);
  qs.set("entity", entityKey);
  return `/data?${qs.toString()}`;
}
