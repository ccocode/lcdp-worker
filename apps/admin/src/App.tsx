/**
 * 管理台入口（第 57 步注册表化后）：外壳在 shell/AppShell.tsx，
 * 页面集合/菜单/可见性在 registry.ts，领域模版在 templates/。
 * 本文件只做转发，保持 main.tsx 的导入路径不变。
 */
export { default } from "./shell/AppShell";
export type { PageKey } from "./registry";
