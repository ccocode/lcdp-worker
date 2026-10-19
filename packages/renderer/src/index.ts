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
  MemberCheckoutInput,
  MemberCheckoutResult,
  MemberSessionInfo,
  RendererContextValue,
  Row,
  RuntimeAdapter,
  SelectOption,
  SupportTranscriptData,
  SupportTranscriptMessage,
  ViewFilter,
} from "./adapter.js";
export { childEntities, parseAssetIds, resolveEntity } from "./adapter.js";
export { CART_CHANGED_EVENT, cartStore } from "./cartStore.js";
export type { CartItem } from "./cartStore.js";
export type {
  ComponentRegistry,
  NodeProps,
  PageRecordState,
  SchemaRendererProps,
  VisibleWhen,
} from "./components.js";
export {
  ActionButton,
  AgentChat,
  AssetValue,
  CartView,
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
  SupportTranscript,
  Tabs,
  TextBlock,
  createDefaultRegistry,
  createRegistry,
  eqFiltersOf,
  evalVisibleWhen,
  formatCellValue,
  parseVisibleWhen,
  registerComponent,
  resolveViewParams,
  useRendererCtx,
  viewFiltersOf,
} from "./components.js";
export {
  StatusBadge,
  parseStatusColors,
  resolveStatusToken,
  type StatusToken,
} from "./statusBadge.js";
export { componentCatalog } from "./catalog.js";
export { FieldInput } from "./fields.js";
export { RichTextInput, RichTextView, htmlToText, sanitizeHtml } from "./richtext.js";
export { styles } from "./styles.js";
