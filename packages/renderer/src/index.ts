import type { ComponentNode, PageSchema } from "@naka1205/schema";

/** 取页面根节点（设计器/预览的便捷入口） */
export function resolveRootNode(page: PageSchema): ComponentNode {
  return page.root;
}

export type {
  AggregateGroupItem,
  AggregateQuery,
  AssetLinkage,
  AssetMeta,
  EntityAccess,
  ListResult,
  RendererContextValue,
  Row,
  RuntimeAdapter,
  SelectOption,
  ViewFilter,
} from "./adapter.js";
export { childEntities, parseAssetIds, resolveEntity } from "./adapter.js";
export type { ComponentRegistry, NodeProps, SchemaRendererProps } from "./components.js";
export {
  ActionButton,
  AgentChat,
  AssetValue,
  Chart,
  ChartPlaceholder,
  Container,
  ContentList,
  DataTable,
  Detail,
  EntityForm,
  ImageBlock,
  Page,
  SchemaRenderer,
  StatCard,
  Tabs,
  TextBlock,
  createDefaultRegistry,
  createRegistry,
  eqFiltersOf,
  formatCellValue,
  registerComponent,
  resolveViewParams,
  useRendererCtx,
  viewFiltersOf,
} from "./components.js";
export { componentCatalog } from "./catalog.js";
export { FieldInput } from "./fields.js";
export { RichTextInput, RichTextView, htmlToText, sanitizeHtml } from "./richtext.js";
export { styles } from "./styles.js";
