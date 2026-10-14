import type { ComponentNode, PageSchema } from "@naka1205/schema";

/** 组件注册表：组件类型 -> React 组件。设计器与运行态共用同一注册表，保证所见即所得 */
export type ComponentRegistry = Map<string, React.ComponentType<any>>;

export function createRegistry(): ComponentRegistry {
  return new Map();
}

export function registerComponent(
  registry: ComponentRegistry,
  type: string,
  component: React.ComponentType<any>,
): ComponentRegistry {
  registry.set(type, component);
  return registry;
}

/**
 * 渲染入口（骨架）：后续按 PageSchema.root 递归渲染组件树，
 * 数据源在运行时经 core-api 拉取，权限裁剪在服务端完成。
 */
export function resolveRootNode(page: PageSchema): ComponentNode {
  return page.root;
}
