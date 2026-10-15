import type { DataSchema, Entity, PageSchema } from "@naka1205/schema";

/** 一行业务数据（列名 = 字段 key，另含 id 主键） */
export type Row = Record<string, unknown>;

export interface ListResult {
  rows: Row[];
  total: number;
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 运行态适配器：渲染器与宿主（runtime 应用）之间的唯一契约。
 * 渲染器只管按 Schema 画界面与编排交互，数据存取、路由、提示都经适配器，
 * 保证同一渲染器可用于运行态、设计器预览与将来的移动端壳。
 */
export interface RuntimeAdapter {
  list(
    entity: string,
    params?: {
      limit?: number;
      offset?: number;
      filters?: Record<string, string>;
      /** 排序（数据视图 sort 的第一项经此下发，服务端执行） */
      sort?: { field: string; dir: "asc" | "desc" };
    },
  ): Promise<ListResult>;
  /** 聚合查询（统计卡片/图表用）：对实体做 count/sum/avg，可带等值过滤 */
  aggregate(
    entity: string,
    q: {
      fn: "count" | "sum" | "avg";
      field?: string;
      filters?: Record<string, string>;
    },
  ): Promise<number>;
  get(entity: string, id: string): Promise<Row | null>;
  create(entity: string, data: Row): Promise<Row>;
  update(entity: string, id: string, data: Row): Promise<Row>;
  remove(entity: string, id: string): Promise<void>;
  /** 引用字段的下拉选项（label 由宿主按实体语义挑显示字段） */
  options(entity: string): Promise<SelectOption[]>;
  /** 跳转到某页面路由（可带 ?id= 等查询参数） */
  navigate(to: string): void;
  notify(message: string, kind?: "ok" | "error"): void;
}

/** 渲染上下文：当前页、宿主适配器与页面参数（如表单页的 id） */
export interface RendererContextValue {
  adapter: RuntimeAdapter;
  dataSchema: DataSchema;
  page: PageSchema;
  params: Record<string, string>;
  /** 当前渲染设备：组件树按此读取布局变体（node.layout[device]） */
  device: "desktop" | "mobile";
  /** 设计模式（设计器画布专用）：节点可点选，选中态由宿主管理 */
  design?: {
    selectedId?: string;
    onSelect?: (nodeId: string) => void;
  };
}

/** 按数据源 key 解析出实体定义（dataSources.key -> ref -> entities.key） */
export function resolveEntity(
  ctx: RendererContextValue,
  sourceKey: string | undefined,
): Entity | null {
  if (!sourceKey) return null;
  const ds = ctx.page.dataSources.find((d) => d.key === sourceKey);
  const entityKey = ds?.ref ?? sourceKey;
  return ctx.dataSchema.entities.find((e) => e.key === entityKey) ?? null;
}

/** 找出某实体的全部子实体（parentField 指向它的明细表） */
export function childEntities(
  dataSchema: DataSchema,
  entityKey: string,
): Entity[] {
  return dataSchema.entities.filter((e) => {
    if (!e.parentField) return false;
    const parentField = e.fields.find((f) => f.key === e.parentField);
    return parentField?.refEntity === entityKey;
  });
}
