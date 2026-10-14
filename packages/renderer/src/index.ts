import type { ComponentNode, PageSchema } from "@naka1205/schema";

/** 取页面根节点（设计器/预览的便捷入口） */
export function resolveRootNode(page: PageSchema): ComponentNode {
  return page.root;
}

export type {
  ListResult,
  RendererContextValue,
  Row,
  RuntimeAdapter,
  SelectOption,
} from "./adapter.js";
export { childEntities, resolveEntity } from "./adapter.js";
export type { ComponentRegistry, NodeProps, SchemaRendererProps } from "./components.js";
export {
  DataTable,
  EntityForm,
  Page,
  SchemaRenderer,
  createDefaultRegistry,
  createRegistry,
  registerComponent,
  useRendererCtx,
} from "./components.js";
export { FieldInput } from "./fields.js";
export { styles } from "./styles.js";
