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
 * 结构化视图过滤项（与服务端 vf 查询参数同构）：
 * op 全集 = eq/ne/gt/gte/lt/lte/contains + 字段间比较 ltField/lteField/gtField/gteField
 * （*Field 时 value 为同实体被比字段的 key，其余 op 时 value 为字面量）。
 */
export interface ViewFilter {
  field: string;
  op: string;
  value?: unknown;
}

/** 聚合查询参数（统计卡片/图表共用） */
export interface AggregateQuery {
  fn: "count" | "sum" | "avg";
  field?: string;
  /** 旧式等值过滤（兼容保留；服务端以 vf 为准） */
  filters?: Record<string, string>;
  /** 结构化过滤（M9 起统一走 vf） */
  vf?: ViewFilter[];
}

/** 分组聚合的一项：key 为分组列原值转字符串（ref=目标 id、enum=枚举值），null 组 key=null */
export interface AggregateGroupItem {
  key: string | null;
  value: number;
}

/** 平台资产元数据（platform_assets 的前端视图；文件本体经 assetContentUrl 取） */
export interface AssetMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  visibility?: string;
  appId?: string | null;
  entity?: string | null;
  recordId?: string | null;
  field?: string | null;
  createdBy?: string;
  createdAt?: string;
  contentUrl?: string;
}

/** 上传资产时的可选关联标注（归属应用/实体/记录/字段，供资产管理与回查） */
export interface AssetLinkage {
  appId?: string;
  entity?: string;
  recordId?: string;
  field?: string;
  visibility?: string;
}

/**
 * 解析 file/image 字段值 → 资产 id 数组。
 * 字段值约定 = 资产 id 数组的 JSON 字符串；兼容已是数组、单个 id 字符串两种历史形态。
 */
export function parseAssetIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    const s = value.trim();
    if (s.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v)).filter((v) => v.length > 0);
        }
      } catch {
        // 解析失败按单个 id 处理
      }
    }
    return [s];
  }
  return [];
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
      /** 结构化过滤（M9 起统一走 vf，服务端优先于旧 filters） */
      vf?: ViewFilter[];
      /** 排序（数据视图 sort 的第一项经此下发，服务端执行） */
      sort?: { field: string; dir: "asc" | "desc" };
    },
  ): Promise<ListResult>;
  /** 聚合查询（统计卡片/图表用）：对实体做 count/sum/avg，可带过滤 */
  aggregate(entity: string, q: AggregateQuery): Promise<number>;
  /** 分组聚合（图表用）：按 groupBy 字段分组返回数值序列（服务端按值降序、最多 50 组） */
  aggregateGrouped(
    entity: string,
    q: AggregateQuery & { groupBy: string },
  ): Promise<AggregateGroupItem[]>;
  /** 上传文件为平台资产（本体走 R2、元数据登记 PG），返回资产元数据 */
  uploadAsset(file: File, linkage?: AssetLinkage): Promise<AssetMeta>;
  /** 批量取资产元数据（缺失 id 由服务端略过，调用方按 id 自行对齐） */
  assetsMeta(ids: string[]): Promise<AssetMeta[]>;
  /** 资产内容地址（宿主拼 API 基址并附当前 token 的 ?t=，供 <img>/<a> 直用） */
  assetContentUrl(id: string): string;
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

/** 当前用户对单个实体的有效访问（宿主按登录身份裁剪后透传；服务端为权威，前端仅做呈现门控） */
export interface EntityAccess {
  /** 可执行动作：read / create / update / delete */
  actions: string[];
  /** 字段 key → 访问级：hidden / masked / readonly / readwrite */
  fields: Record<string, string>;
}

/** 渲染上下文：当前页、宿主适配器与页面参数（如表单页的 id） */
export interface RendererContextValue {
  adapter: RuntimeAdapter;
  dataSchema: DataSchema;
  page: PageSchema;
  params: Record<string, string>;
  /** 当前渲染设备：组件树按此读取布局变体（node.layout[device]） */
  device: "desktop" | "mobile";
  /** 权限门控（可选）：实体 key → 有效访问；缺省时不做任何门控（设计器预览等场景行为不变） */
  access?: Record<string, EntityAccess>;
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
