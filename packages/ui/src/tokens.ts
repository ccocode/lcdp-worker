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
