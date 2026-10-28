import type { ThemeConfig } from "antd";

/**
 * B 端视觉基线令牌——全平台单一事实源（第 73 步片一收口）。
 * 值 = 第 49/50 步基线原样继承（用户 2026-10-21 拍板「保值收口、不重定视觉」）：
 * 主色 #1677ff、控件圆角 6 / 卡片圆角 8、布局边框 #e4e7ec、页底 #f5f6f8、
 * 文字三级 #1f2328 / #5f6b7a / #8a94a6、菜单选中底 #e8f1ff、表头底 #f8f9fb。
 * 消费方：admin / runtime / studio 的 ConfigProvider、renderer 的手写样式、
 * 设计器画布色值。纪律：基线色值只许在此定义，各端不得再散写字面量
 * （.css 文件无法引 TS，其值须与此保持一致，变更时两处同改）。
 */
export const tokens = {
  colorPrimary: "#1677ff",
  colorPrimaryBg: "#e8f1ff",
  borderRadius: 6,
  borderRadiusLG: 8,
  colorBorder: "#e4e7ec",
  colorBorderControl: "#d9d9d9",
  colorDivider: "#eef0f3",
  colorBgLayout: "#f5f6f8",
  colorBgContainer: "#ffffff",
  colorTableHeaderBg: "#f8f9fb",
  colorTableRowHoverBg: "#f5f8ff",
  colorText: "#1f2328",
  colorTextSecondary: "#5f6b7a",
  colorTextTertiary: "#8a94a6",
  colorDanger: "#cf1322",
  colorSuccess: "#52c41a",
  colorSuccessStrong: "#389e0d",
  colorWarning: "#faad14",
  colorWarningBg: "#fffbe6",
  colorWarningBorder: "#ffe58f",
  colorErrorBg: "#fff2f0",
  colorErrorBorder: "#ffccc7",
  colorErrorText: "#a8071a",
} as const;

/**
 * 工作台统计卡渐变组（2026-10-23）：六张平台统计卡各一色，均为线性渐变的两端色；
 * 卡面文字固定白系（主值纯白、标题白色 85%）。改色只改此处，各端不得散写字面量。
 */
export const statCardGradients = [
  ["#1677ff", "#69b1ff"],
  ["#722ed1", "#b37feb"],
  ["#13c2c2", "#5cdbd3"],
  ["#fa8c16", "#ffc069"],
  ["#52c41a", "#95de64"],
  ["#eb2f96", "#ff85c0"],
] as const;

export const statCardText = "#ffffff";
export const statCardTextSecondary = "rgba(255,255,255,0.85)";

/** 桌面主题（antd ThemeConfig）：admin / studio 直接用；runtime 根 Provider 同用此份，员工壳在此之上叠加应用主题覆盖（colorPrimary / borderRadius）。 */
export const desktopTheme: ThemeConfig = {
  token: {
    colorPrimary: tokens.colorPrimary,
    borderRadius: tokens.borderRadius,
    borderRadiusLG: tokens.borderRadiusLG,
    colorBorder: tokens.colorBorder,
    colorBgLayout: tokens.colorBgLayout,
    colorText: tokens.colorText,
    colorTextSecondary: tokens.colorTextSecondary,
    colorTextTertiary: tokens.colorTextTertiary,
  },
  components: {
    Menu: {
      itemBorderRadius: tokens.borderRadius,
      itemSelectedBg: tokens.colorPrimaryBg,
      itemSelectedColor: tokens.colorPrimary,
      groupTitleColor: tokens.colorTextTertiary,
      groupTitleFontSize: 12,
    },
    Layout: { siderBg: tokens.colorBgContainer, headerBg: tokens.colorBgContainer },
    Table: { headerBg: tokens.colorTableHeaderBg, rowHoverBg: tokens.colorTableRowHoverBg },
  },
};

/**
 * 运行态 C 端外壳令牌（2026-10-28 运行态全页统一外壳）：与内置主题壳同源——
 * 主色 #2563eb、hover #1d4ed8、底色 #f7f8fa、文字 #111827、次要文字 #6b7280、
 * 边框 #e6e8ec（platform builtin-theme.ts 约 206、219 行）。
 * 仅 runtime 消费；admin / studio 仍用 B 端 desktopTheme，不得混用。
 * 圆角沿用 B 端基线（6/8），不改数据组件几何；info 种子同步主色，使登录
 * 提示页的 info 提示与主题同蓝。
 */
export const runtimeTokens = {
  colorPrimary: "#2563eb",
  colorPrimaryHover: "#1d4ed8",
  colorInfo: "#2563eb",
  colorBorder: "#e6e8ec",
  colorBgLayout: "#f7f8fa",
  colorText: "#111827",
  colorTextSecondary: "#6b7280",
  colorTextTertiary: "#6b7280",
} as const;

/**
 * 运行态外壳主题（antd ThemeConfig）：runtime 根 Provider 与 themeTokenOf 基线用；
 * 应用主题 / 站点主题令牌仍在其上叠加覆盖（自定义主题品牌不受影响）。
 */
export const runtimeTheme: ThemeConfig = {
  token: {
    colorPrimary: runtimeTokens.colorPrimary,
    colorPrimaryHover: runtimeTokens.colorPrimaryHover,
    colorInfo: runtimeTokens.colorInfo,
    borderRadius: tokens.borderRadius,
    borderRadiusLG: tokens.borderRadiusLG,
    colorBorder: runtimeTokens.colorBorder,
    colorBgLayout: runtimeTokens.colorBgLayout,
    colorText: runtimeTokens.colorText,
    colorTextSecondary: runtimeTokens.colorTextSecondary,
    colorTextTertiary: runtimeTokens.colorTextTertiary,
  },
  components: {
    Menu: {
      itemBorderRadius: tokens.borderRadius,
      itemSelectedColor: runtimeTokens.colorPrimary,
      groupTitleColor: runtimeTokens.colorTextTertiary,
      groupTitleFontSize: 12,
    },
    Layout: { siderBg: tokens.colorBgContainer, headerBg: tokens.colorBgContainer },
    Table: { headerBg: runtimeTokens.colorBgLayout },
  },
};

/**
 * PC 密度档（最终文档 §17.3 预留 4 的 PC 半边，与移动档并列维护）：
 * default = antd middle；dense 供数据密集页组件级消费（手写 size="small" 的收编目标，片二起改接）。
 */
export const density = {
  default: { componentSize: "middle" as const },
  dense: { componentSize: "small" as const },
};

/** 移动档 CSS 变量名（值由 schema 的 resolveMobileTheme 与外壳在运行时注入，此处只登记名与密度值表）。 */
export const mobileVars = {
  touchMin: "--lcdp-touch-min",
  fontScale: "--lcdp-font-scale",
  controlH: "--lcdp-control-h",
  cardPad: "--lcdp-card-pad",
  rowMinH: "--lcdp-row-min-h",
  navOffset: "--lcdp-nav-offset",
} as const;

/** 移动密度档值表（renderer 移动分支消费，值与 M13 落地值一致、不得漂移）。 */
export const mobileDensity = {
  comfortable: { controlH: "40px", cardPad: "12px", rowMinH: "56px" },
  compact: { controlH: "36px", cardPad: "10px", rowMinH: "48px" },
} as const;

/** MobileShell 底部导航避让值（runtime 挂载时写入 --lcdp-nav-offset，助手/咨询悬浮钮消费）。 */
export const mobileNavOffset = "calc(56px + env(safe-area-inset-bottom, 0px))";
