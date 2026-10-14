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
    },
  ): Promise<ListResult>;
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
