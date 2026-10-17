import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  ComponentNode,
  DataView,
  Entity,
  Field,
  NodeLayout,
  PageSchema,
} from "@naka1205/schema";
import { PRESENTATION_VARIANTS, resolveMobileTheme } from "@naka1205/schema";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Input,
  Pagination,
  Space,
  Statistic,
  Table,
  Tabs as AntdTabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import dayjs from "dayjs";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import type {
  AggregateGroupItem,
  RendererContextValue,
  Row,
  RuntimeAdapter,
  SupportTranscriptData,
  ViewFilter,
} from "./adapter.js";
import { childEntities, parseAssetIds, resolveEntity } from "./adapter.js";
import { FieldInput } from "./fields.js";
import { RichTextView, htmlToText } from "./richtext.js";
import { styles } from "./styles.js";

/** 组件注册表：组件类型 -> React 组件。设计器与运行态共用同一注册表，保证所见即所得 */
export type ComponentRegistry = Map<string, React.ComponentType<NodeProps>>;

export interface NodeProps {
  node: ComponentNode;
  children?: ReactNode;
}

export function createRegistry(): ComponentRegistry {
  return new Map();
}

export function registerComponent(
  registry: ComponentRegistry,
  type: string,
  component: React.ComponentType<NodeProps>,
): ComponentRegistry {
  registry.set(type, component);
  return registry;
}

const RendererContext = createContext<RendererContextValue | null>(null);

export function useRendererCtx(): RendererContextValue {
  const ctx = useContext(RendererContext);
  if (!ctx) throw new Error("渲染器组件必须在 SchemaRenderer 内使用");
  return ctx;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 单元格/详情值的统一格式化（列表与详情共用）：
 * 布尔→是/否、枚举→选项标签、日期/时间→本地格式、引用→标签映射。
 */
export function formatCellValue(
  field: Field,
  value: unknown,
  refLabels?: Record<string, string>,
): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "boolean":
      return value === true || value === "true" ? "是" : "否";
    case "enum": {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt?.label ?? String(value);
    }
    case "date": {
      const d = dayjs(value as string);
      return d.isValid() ? d.format("YYYY-MM-DD") : String(value);
    }
    case "datetime": {
      const d = dayjs(value as string);
      return d.isValid() ? d.format("YYYY-MM-DD HH:mm") : String(value);
    }
    case "ref":
      return refLabels?.[String(value)] ?? String(value);
    case "richtext":
      // 纯文本场景（表格单元格等）：去标签摘要，绝不直出 HTML 源码
      return htmlToText(typeof value === "string" ? value : String(value));
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return String(value);
  }
}

/**
 * 数据视图中可经适配器下发的等值过滤（其余算子暂不在此层下发）。
 * 或组内的项一律不双发：旧 filters 是纯 AND 口径，把或条件的一项当作独立等值条件
 * 并行下发会把「A 或 B」误作「A 且 B」，故按服务端同一分组规则（or=true 与前一项同组）
 * 切分组后，成员数 >1 的组整体跳过；单项组维持原口径（op eq 且 value 非空才双发）。
 */
export function eqFiltersOf(view: DataView | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const filters = view?.filters ?? [];
  let group: typeof filters = [];
  const flush = () => {
    if (group.length === 1) {
      const f = group[0]!;
      if (f.op === "eq" && f.value !== null && f.value !== undefined) {
        out[f.field] = String(f.value);
      }
    }
    group = [];
  };
  for (const f of filters) {
    if (f.or === true && group.length > 0) group.push(f);
    else {
      flush();
      group = [f];
    }
  }
  flush();
  return out;
}

/**
 * 数据视图过滤 → 结构化 vf（M9）：全部 op 原样产出（含字段间比较 *Field，其 value 为被比字段 key），
 * 服务端统一编译与权限校验；DataTable/StatCard/Chart 取数一律带 vf（旧 eq filters 兼容并行发送）。
 * 或分组标记 or 一并透传，服务端编译时折叠为同组 OR、组间 AND。
 */
export function viewFiltersOf(view: DataView | undefined): ViewFilter[] {
  return (view?.filters ?? []).map((f) => ({
    field: f.field,
    op: f.op,
    value: f.value,
    or: f.or || undefined,
  }));
}

/** 过滤值对页面参数的引用形态：$param.<key>（整串严格匹配，key = [A-Za-z0-9_]+） */
const PARAM_REF_RE = /^\$param\.([A-Za-z0-9_]+)$/;

/**
 * 过滤参数绑定（M10 补强）：数据视图过滤项的 value 若为 `$param.<key>` 引用，
 * 以当前页面参数（URL 入参）替换——栏目/搜索等页把条件值留给访问地址决定。
 * 参数缺失或为空串时剔除该过滤项（页面未带参 = 不按此条件过滤），其余值原样保留；
 * 返回新 view（sort/pageSize/aggregate 不动），无过滤项时原样返回。
 */
export function resolveViewParams(
  view: DataView | undefined,
  params: Record<string, string>,
): DataView | undefined {
  if (!view?.filters?.length) return view;
  const filters: NonNullable<DataView["filters"]> = [];
  for (const f of view.filters) {
    if (typeof f.value === "string") {
      const m = PARAM_REF_RE.exec(f.value);
      if (m) {
        const v = params[m[1]!];
        if (v === undefined || v === "") continue;
        filters.push({ ...f, value: v });
        continue;
      }
    }
    filters.push(f);
  }
  return { ...view, filters };
}

/**
 * 资产值渲染（file/image 字段的表格单元格与详情共用）：
 * 解析资产 id 数组 → 批量取元数据得文件名 → 新窗打开内容地址；
 * image 字段渲染 40px 缩略图（点开看原图）。元数据缺失（资产已删）时降级显示 id 本身，不断链。
 */
export function AssetValue({
  ids,
  image,
  adapter,
}: {
  ids: string[];
  image?: boolean;
  adapter: RuntimeAdapter;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const idsSig = ids.join(",");
  useEffect(() => {
    if (!idsSig) return;
    let alive = true;
    adapter
      .assetsMeta(idsSig.split(","))
      .then((metas) => {
        if (alive) {
          setNames(
            Object.fromEntries(metas.map((m) => [m.id, m.name || m.id])),
          );
        }
      })
      .catch(() => {
        // 元数据取不到时以 id 兜底显示，不阻断页面
      });
    return () => {
      alive = false;
    };
  }, [adapter, idsSig]);
  if (!ids.length) return <>—</>;
  return (
    <Space size={8} wrap>
      {ids.map((id) => {
        const url = adapter.assetContentUrl(id);
        const name = names[id] ?? id;
        return image ? (
          <a key={id} href={url} target="_blank" rel="noreferrer" title={name}>
            <img
              src={url}
              alt={name}
              style={{
                width: 40,
                height: 40,
                objectFit: "cover",
                borderRadius: 4,
                display: "block",
              }}
            />
          </a>
        ) : (
          <a key={id} href={url} target="_blank" rel="noreferrer">
            {name}
          </a>
        );
      })}
    </Space>
  );
}

/** 取节点在当前设备上的布局变体 */
function layoutFor(
  node: ComponentNode,
  device: "desktop" | "mobile",
): NodeLayout | undefined {
  return node.layout?.[device];
}

/**
 * 呈现变体解析（M13）：节点 presentation[device] 优先，缺省取 PRESENTATION_VARIANTS
 * 注册表为该组件声明的双端默认；无注册表条目的组件返回 null（双端同呈现、走唯一实现）。
 * 桌面端注册表每组件仅一种呈现，故解析结果恒为桌面实现，桌面代码路径不受分发影响。
 */
function presentationFor(
  node: ComponentNode,
  type: string,
  device: "desktop" | "mobile",
): string | null {
  const declared = node.presentation?.[device];
  if (declared) return declared;
  const reg = PRESENTATION_VARIANTS[type];
  if (!reg) return null;
  return device === "desktop" ? reg.defaultDesktop : reg.defaultMobile;
}

/** 移动令牌 CSS 变量引用（SchemaRenderer 在 mobile 时于根节点注入，桌面无此变量、取回退值即桌面口径） */
const TOUCH_MIN = "var(--lcdp-touch-min, 44px)";

/** 子节点按当前设备变体过滤隐藏并按 order 排序（NodeView 与 Tabs 共用，保证顺序一致） */
function visibleSortedChildren(
  node: ComponentNode,
  device: "desktop" | "mobile",
): ComponentNode[] {
  return [...(node.children ?? [])]
    .filter((c) => !layoutFor(c, device)?.hidden)
    .sort(
      (a, b) =>
        (layoutFor(a, device)?.order ?? 0) - (layoutFor(b, device)?.order ?? 0),
    );
}

/** 页面布局：标题 + 子组件纵向排列，组件间默认 16px 间距（props.gap 可调，与 Container 的间距口径一致） */
export function Page({ node, children }: NodeProps) {
  const title =
    typeof node.props?.title === "string" ? node.props.title : undefined;
  const gap = typeof node.props?.gap === "number" ? node.props.gap : 16;
  return (
    <div
      style={{ ...styles.page, display: "flex", flexDirection: "column", gap }}
    >
      {title && <div style={{ ...styles.title, margin: "4px 0 0" }}>{title}</div>}
      {children}
    </div>
  );
}

/** 数据表格：按绑定实体分页拉取，引用字段显示关联记录的标签，敏感字段由服务端脱敏 */
export function DataTable({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const rawView = node.binding?.view;
  const rawViewSig = JSON.stringify(rawView ?? null);
  const paramsSig = JSON.stringify(ctx.params);
  // 过滤参数绑定（$param.<key> → 页面参数）：memo 以内容签名作依赖键，
  // 避免 resolvedView 每次渲染都是新对象、引发取数 effect 循环
  const view = useMemo(
    () => resolveViewParams(rawView, ctx.params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig],
  );
  const pageSize =
    view?.pageSize ??
    (typeof node.props?.pageSize === "number" ? node.props.pageSize : 20);
  const formRoute =
    typeof node.props?.formRoute === "string" ? node.props.formRoute : null;
  const [pageIdx, setPageIdx] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>(
    {},
  );
  // 每个被引实体的标签映射是否已就绪（成功或失败都算就绪，失败时回退显示原始值）
  const [labelsDone, setLabelsDone] = useState<Record<string, boolean>>({});
  // 卡片呈现（移动端）「加载更多」：置位后本轮取数把新页行追加到已有行集而非替换；
  // 桌面 table 呈现永不置位，取数与分页行为与原实现完全一致
  const appendRef = useRef(false);

  // 数据视图签名（内容变化才重拉）：过滤（vf 全量 op + eq 兼容）与第一排序项经适配器下发服务端
  const viewSig = JSON.stringify(view ?? null);
  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setError(null);
    try {
      const filters = eqFiltersOf(view);
      const vf = viewFiltersOf(view);
      const firstSort = view?.sort?.[0];
      const res = await ctx.adapter.list(entity.key, {
        limit: pageSize,
        offset: pageIdx * pageSize,
        filters: Object.keys(filters).length ? filters : undefined,
        vf: vf.length ? vf : undefined,
        sort: firstSort
          ? { field: firstSort.field, dir: firstSort.dir }
          : undefined,
      });
      setRows((prev) =>
        appendRef.current ? [...prev, ...res.rows] : res.rows,
      );
      appendRef.current = false;
      setTotal(res.total);
    } catch (err) {
      appendRef.current = false;
      setError(errText(err));
    } finally {
      setLoading(false);
    }
    // view 的内容已由 viewSig 完整刻画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.adapter, entity, pageIdx, pageSize, viewSig]);

  useEffect(() => {
    void load();
  }, [load]);

  // 引用字段的显示标签（按被引实体各拉一次选项表做映射）
  const refEntitiesKey = entity
    ? entity.fields
        .filter((f) => f.type === "ref" && f.refEntity)
        .map((f) => f.refEntity!)
        .join(",")
    : "";
  useEffect(() => {
    if (!refEntitiesKey) return;
    let alive = true;
    for (const refKey of refEntitiesKey.split(",")) {
      ctx.adapter
        .options(refKey)
        .then((opts) => {
          if (!alive) return;
          setLabels((prev) => ({
            ...prev,
            [refKey]: Object.fromEntries(opts.map((o) => [o.value, o.label])),
          }));
          setLabelsDone((prev) => ({ ...prev, [refKey]: true }));
        })
        .catch(() => {
          if (alive) setLabelsDone((prev) => ({ ...prev, [refKey]: true }));
        });
    }
    return () => {
      alive = false;
    };
  }, [ctx.adapter, refEntitiesKey]);

  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;

  // 显示列：props.columns 指定字段 key 与顺序；未指定时取实体前 7 个字段
  const columnKeys = Array.isArray(node.props?.columns)
    ? (node.props.columns as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : null;
  const fields: Field[] = columnKeys
    ? columnKeys
        .map((k) => entity.fields.find((f) => f.key === k))
        .filter((f): f is Field => Boolean(f))
    : entity.fields.slice(0, 7);
  // 可见列涉及的被引实体标签尚未全部就绪时不渲染数据行，
  // 避免把原始 ID 当成最终内容闪现（映射到达后才出首屏）
  const pendingRefs = fields
    .filter((f) => f.type === "ref" && f.refEntity)
    .map((f) => f.refEntity!)
    .filter((k, i, a) => a.indexOf(k) === i && !labelsDone[k]);
  const labelsPending = pendingRefs.length > 0;

  const cellText = (row: Row, field: Field): string =>
    formatCellValue(
      field,
      row[field.key],
      field.refEntity ? labels[field.refEntity] : undefined,
    );

  const tableColumns: TableProps<Row>["columns"] = [
    { title: "ID", dataIndex: "id", key: "__id", width: 120 },
    ...fields.map((f) => ({
      title: f.label,
      dataIndex: f.key,
      key: f.key,
      ellipsis: true,
      render: (_: unknown, row: Row) =>
        f.type === "file" || f.type === "image" ? (
          <AssetValue
            ids={parseAssetIds(row[f.key])}
            image={f.type === "image"}
            adapter={ctx.adapter}
          />
        ) : (
          cellText(row, f)
        ),
    })),
  ];

  // 权限门控：宿主透传了 access 且本实体无 create 动作时隐藏新建按钮（服务端仍为权威强制）
  const canCreate =
    !ctx.access ||
    (ctx.access[entity.key]?.actions.includes("create") ?? false);

  /* ---------- 移动端卡片呈现（M13）：与 table 同取数/同回调，只换行的渲染形态 ---------- */
  const cardMode =
    ctx.device === "mobile" &&
    presentationFor(node, "DataTable", ctx.device) === "card";
  // 可见列沿用 access 裁剪：hidden 字段不进卡（与 EntityForm 字段门控同口径）
  const cardFields = fields.filter(
    (f) => ctx.access?.[entity.key]?.fields?.[f.key] !== "hidden",
  );
  const titleFieldKey =
    typeof node.props?.cardTitleField === "string"
      ? node.props.cardTitleField
      : undefined;
  const cardTitleField =
    cardFields.find((f) => f.key === titleFieldKey) ?? cardFields[0];
  // 状态类字段（status 枚举）右置为卡头徽章，不再进卡身
  const cardStatusField = cardFields.find(
    (f) => f.key === "status" && f.type === "enum" && f.key !== cardTitleField?.key,
  );
  const cardBodyFields = cardFields.filter(
    (f) => f.key !== cardTitleField?.key && f.key !== cardStatusField?.key,
  );
  const renderCardCell = (row: Row, f: Field) =>
    f.type === "file" || f.type === "image" ? (
      <AssetValue
        ids={parseAssetIds(row[f.key])}
        image={f.type === "image"}
        adapter={ctx.adapter}
      />
    ) : (
      cellText(row, f)
    );
  const openRow = (row: Row) => {
    if (formRoute) {
      ctx.adapter.navigate(
        `${formRoute}?id=${encodeURIComponent(String(row.id))}`,
      );
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        {formRoute && canCreate && (
          <Button
            type="primary"
            style={cardMode ? { minHeight: TOUCH_MIN } : undefined}
            onClick={() => ctx.adapter.navigate(formRoute)}
          >
            新建{entity.label}
          </Button>
        )}
        <Button
          style={cardMode ? { minHeight: TOUCH_MIN } : undefined}
          onClick={() => void load()}
        >
          刷新
        </Button>
      </Space>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {cardMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {labelsPending || (loading && rows.length === 0) ? (
            <div style={styles.empty}>加载中…</div>
          ) : rows.length === 0 ? (
            <div style={styles.empty}>暂无数据</div>
          ) : (
            rows.map((row) => (
              <div
                key={String(row.id)}
                onClick={() => openRow(row)}
                style={{
                  background: "#fff",
                  border: "1px solid #f0f0f0",
                  borderRadius: 12,
                  padding: "var(--lcdp-card-pad, 12px)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  minHeight: "var(--lcdp-row-min-h, 56px)",
                  boxSizing: "border-box",
                  cursor: formRoute ? "pointer" : undefined,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: "calc(15px * var(--lcdp-font-scale, 1))",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cardTitleField
                      ? renderCardCell(row, cardTitleField)
                      : String(row.id)}
                  </span>
                  {cardStatusField && (
                    <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                      {cellText(row, cardStatusField)}
                    </Tag>
                  )}
                </div>
                {cardBodyFields.map((f) => (
                  <div
                    key={f.key}
                    style={{
                      display: "flex",
                      lineHeight: 1.6,
                      padding: "2px 0",
                      fontSize: "calc(13px * var(--lcdp-font-scale, 1))",
                    }}
                  >
                    <span
                      style={{
                        color: "#8c8c8c",
                        width: 84,
                        flexShrink: 0,
                        fontSize: "calc(12px * var(--lcdp-font-scale, 1))",
                        paddingTop: 1,
                      }}
                    >
                      {f.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {renderCardCell(row, f)}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 4,
            }}
          >
            <span style={{ color: "#8c8c8c", fontSize: 13 }}>
              共 {total} 条
            </span>
            {rows.length < total && (
              <Button
                loading={loading}
                style={{ minHeight: TOUCH_MIN }}
                onClick={() => {
                  appendRef.current = true;
                  setPageIdx((p) => p + 1);
                }}
              >
                加载更多
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Table<Row>
        rowKey={(r) => String(r.id)}
        columns={tableColumns}
        dataSource={labelsPending ? [] : rows}
        loading={loading || labelsPending}
        locale={{ emptyText: "暂无数据" }}
        pagination={{
          current: pageIdx + 1,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPageIdx(p - 1),
        }}
        onRow={(row) => ({
          onClick: () => {
            if (formRoute) {
              ctx.adapter.navigate(
                `${formRoute}?id=${encodeURIComponent(String(row.id))}`,
              );
            }
          },
          style: formRoute ? { cursor: "pointer" } : undefined,
        })}
        />
      )}
    </div>
  );
}

/** 提交前按字段类型归一（与 api 的入参归一呼应，双保险） */
function buildPayload(entityDef: Entity, source: Row): Row {
  const out: Row = {};
  for (const f of entityDef.fields) {
    if (!(f.key in source)) continue;
    let v: unknown = source[f.key];
    if (v === "") v = null;
    if ((f.type === "int" || f.type === "decimal") && v !== null && v !== undefined) {
      v = Number(v);
    }
    if (f.type === "boolean") v = v === true;
    out[f.key] = v;
  }
  return out;
}

function missingRequired(entityDef: Entity, payload: Row): string[] {
  return entityDef.fields
    .filter(
      (f) =>
        f.required &&
        (payload[f.key] === null ||
          payload[f.key] === undefined ||
          payload[f.key] === ""),
    )
    .map((f) => f.label);
}

/** 子表编辑器：父表单内嵌的明细行编辑（支持增删行与金额类字段自动小计） */
function ChildEditor({
  child,
  rows,
  onChange,
  readOnly = false,
  cardMode = false,
}: {
  child: Entity;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  readOnly?: boolean;
  /** 移动端卡片行呈现（M13，EntityForm single 时启用）：字段竖排成卡，其余口径与表格呈现完全一致 */
  cardMode?: boolean;
}) {
  const ctx = useRendererCtx();
  // 权限门控：与主表字段同口径——hidden 子字段不渲染列，readonly/masked 子字段
  // 渲染为禁用控件；readOnly（宿主表单不可保存，如只读角色）时整表只读。
  // 无 access（如设计态预览）时不限制，保持设计器内行为不变。
  const fieldAccessOf = (key: string) => ctx.access?.[child.key]?.fields?.[key];
  const fields = child.fields.filter(
    (f) => f.key !== child.parentField && fieldAccessOf(f.key) !== "hidden",
  );
  const hasAmount = child.fields.some((f) => f.key === "amount");

  const updateRow = (idx: number, key: string, value: unknown) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
    const row = next[idx]!;
    if (
      hasAmount &&
      (key === "quantity" || key === "unit_price") &&
      row.quantity !== undefined &&
      row.unit_price !== undefined
    ) {
      const q = Number(row.quantity);
      const p = Number(row.unit_price);
      if (!Number.isNaN(q) && !Number.isNaN(p)) {
        next[idx] = { ...row, amount: Math.round(q * p * 100) / 100 };
      }
    }
    onChange(next);
  };

  // 字段只读口径（表格/卡片两呈现共用同一表达式，保证门控零漂移）：
  // 整表只读、字段级 readonly/masked、amount 小计字段恒只读
  const fieldReadOnlyOf = (f: Field) =>
    readOnly ||
    fieldAccessOf(f.key) === "readonly" ||
    fieldAccessOf(f.key) === "masked" ||
    (f.key === "amount" && hasAmount);

  const renderFieldInput = (row: Row, idx: number, f: Field) => (
    <FieldInput
      field={f}
      value={row[f.key]}
      onChange={(v) => updateRow(idx, f.key, v)}
      adapter={ctx.adapter}
      inChild={!cardMode}
      linkage={{
        entity: child.key,
        recordId: typeof row.id === "string" ? row.id : undefined,
      }}
      readOnly={fieldReadOnlyOf(f)}
    />
  );

  /* ---------- 移动端卡片行呈现（M13）：每行一卡、字段竖排，增删与门控口径同表格呈现 ---------- */
  if (cardMode) {
    return (
      <div>
        <div style={styles.sectionTitle}>{child.label}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.length === 0 && (
            <div style={styles.empty}>暂无{child.label}</div>
          )}
          {rows.map((row, idx) => (
            <div
              key={idx}
              style={{
                background: "#fff",
                border: "1px solid #f0f0f0",
                borderRadius: 12,
                padding: "var(--lcdp-card-pad, 12px)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              {fields.map((f) => (
                <div key={f.key} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: "#374151",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    {f.label}
                    {f.required && <span style={styles.required}> *</span>}
                  </div>
                  {renderFieldInput(row, idx, f)}
                </div>
              ))}
              {!readOnly && (
                <div style={{ textAlign: "right" }}>
                  <Button
                    danger
                    style={{ minHeight: TOUCH_MIN }}
                    onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  >
                    删除
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <Button
            block
            style={{ marginTop: 8, minHeight: TOUCH_MIN }}
            onClick={() => onChange([...rows, {}])}
          >
            添加{child.label}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={styles.sectionTitle}>{child.label}</div>
      <table style={styles.childTable}>
        <thead>
          <tr>
            {fields.map((f) => (
              <th key={f.key} style={styles.childTh}>
                {f.label}
                {f.required && <span style={styles.required}> *</span>}
              </th>
            ))}
            {!readOnly && <th style={styles.childTh}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {fields.map((f) => (
                <td key={f.key} style={styles.childTd}>
                  {renderFieldInput(row, idx, f)}
                </td>
              ))}
              {!readOnly && (
                <td style={styles.childTd}>
                  <Button
                    size="small"
                    onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  >
                    删除
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => onChange([...rows, {}])}>
            添加{child.label}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 实体表单：新建/编辑主记录，并内嵌维护全部子实体明细（主子表事务式保存） */
export function EntityForm({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const listRoute =
    typeof node.props?.listRoute === "string" ? node.props.listRoute : "/";
  const id = ctx.params.id;
  const isEdit = Boolean(id);
  // 权限门控：与 DataTable 的 canCreate 同口径——宿主透传了 access 且本实体无对应
  // 动作时隐藏工具栏写按钮（只读角色不再看到点了必然 403 的保存/删除；服务端仍为
  // 权威强制）。无 access（如设计态预览）时不限制，保持设计器内行为不变。
  const accessActions =
    entity && ctx.access ? ctx.access[entity.key]?.actions : undefined;
  const canCreate = !ctx.access || (accessActions?.includes("create") ?? false);
  const canUpdate = !ctx.access || (accessActions?.includes("update") ?? false);
  const canDelete = !ctx.access || (accessActions?.includes("delete") ?? false);
  const children = entity ? childEntities(ctx.dataSchema, entity.key) : [];
  /* 移动端单列呈现（M13）：仅 mobile 且呈现解析为 single 时启用；桌面解析恒为 standard、走原路径 */
  const singleMode =
    ctx.device === "mobile" &&
    presentationFor(node, "EntityForm", ctx.device) === "single";
  const [values, setValues] = useState<Row>({});
  const [childRows, setChildRows] = useState<Record<string, Row[]>>({});
  const [childOriginal, setChildOriginal] = useState<Record<string, Row[]>>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entity || !isEdit) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const row = await ctx.adapter.get(entity.key, id!);
        if (!alive) return;
        if (row) setValues(row);
        const cr: Record<string, Row[]> = {};
        const co: Record<string, Row[]> = {};
        for (const child of children) {
          const res = await ctx.adapter.list(child.key, {
            limit: 200,
            filters: { [child.parentField!]: id! },
          });
          cr[child.key] = res.rows;
          co[child.key] = res.rows;
        }
        if (alive) {
          setChildRows(cr);
          setChildOriginal(co);
        }
      } catch (err) {
        if (alive) setError(errText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // 仅在挂载时加载一次（children 由 entity 决定，同页内不变）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // M7 助手回填（fillForm）：运行态新建表单挂载时，读取助手面板确认后写入的一次性预填
  // （sessionStorage `lcdp.fill.<entity>` = { values, items }），预填主表字段与子表行后立即清除。
  // 仅新建（非编辑）、非设计态生效，不影响普通空表单与编辑既有记录的流程；
  // 已在本表单页时由宿主派发 lcdp:fill-form 事件触发再次读取（无需重新挂载）。
  const applyAssistantFill = useCallback(() => {
    if (!entity || isEdit || ctx.design) return;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(`lcdp.fill.${entity.key}`);
      if (raw) window.sessionStorage.removeItem(`lcdp.fill.${entity.key}`);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        values?: Row;
        items?: Record<string, Row[]> | Row[];
      };
      if (data.values && typeof data.values === "object") {
        setValues((prev) => ({ ...prev, ...data.values }));
      }
      if (data.items) {
        // items 两种形态：按子实体 key 分组的对象，或单子表时的行数组（归入第一个子实体）
        const byChild: Record<string, Row[]> = {};
        if (Array.isArray(data.items)) {
          const first = children[0];
          if (first) byChild[first.key] = data.items;
        } else {
          for (const [k, rows] of Object.entries(data.items)) {
            if (Array.isArray(rows)) byChild[k] = rows;
          }
        }
        // 子表行带数量与单价但缺小计时补算（与 ChildEditor 的联动口径一致，保证父单总额汇总正确）
        for (const child of children) {
          const rows = byChild[child.key];
          if (!rows || !child.fields.some((f) => f.key === "amount")) continue;
          byChild[child.key] = rows.map((r) => {
            if (r.amount !== undefined && r.amount !== null) return r;
            const q = Number(r.quantity);
            const p = Number(r.unit_price);
            return Number.isFinite(q) && Number.isFinite(p)
              ? { ...r, amount: Math.round(q * p * 100) / 100 }
              : r;
          });
        }
        if (Object.keys(byChild).length > 0) {
          setChildRows((prev) => ({ ...prev, ...byChild }));
        }
      }
    } catch {
      // 预填数据损坏时忽略，保持空表单
    }
    // children 由 entity 决定，同页内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.key, isEdit, ctx.design]);

  useEffect(() => {
    applyAssistantFill();
  }, [applyAssistantFill]);

  useEffect(() => {
    const onFill = (e: Event) => {
      const ent = (e as CustomEvent<{ entity?: string }>).detail?.entity;
      if (!ent || ent === entity?.key) applyAssistantFill();
    };
    window.addEventListener("lcdp:fill-form", onFill);
    return () => window.removeEventListener("lcdp:fill-form", onFill);
  }, [applyAssistantFill, entity?.key]);

  // 父单总金额自动汇总：父实体带 total 类 decimal 字段、且子实体带 amount 字段时，
  // 总额由明细小计之和驱动——表单内实时联动，保存时按最终明细再核算一次
  const rollupField = entity?.fields.find(
    (f) => f.type === "decimal" && /total/i.test(f.key),
  );
  const amountChildren = children.filter((c) =>
    c.fields.some((f) => f.key === "amount"),
  );
  const rollupActive = Boolean(rollupField && amountChildren.length > 0);
  const sumChildren = useCallback(
    (rowsByChild: Record<string, Row[]>): number => {
      let sum = 0;
      for (const c of amountChildren) {
        for (const row of rowsByChild[c.key] ?? []) {
          const a = Number(row.amount);
          if (Number.isFinite(a)) sum += a;
        }
      }
      return Math.round(sum * 100) / 100;
    },
    // amountChildren 由 entity 决定，同页内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entity?.key],
  );

  useEffect(() => {
    if (!rollupActive || !rollupField) return;
    const total = sumChildren(childRows);
    setValues((prev) =>
      prev[rollupField.key] === total
        ? prev
        : { ...prev, [rollupField.key]: total },
    );
  }, [childRows, rollupActive, rollupField, sumChildren]);

  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;
  if (loading) return <div style={styles.empty}>加载中…</div>;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(entity, values);
      if (rollupActive && rollupField) {
        payload[rollupField.key] = sumChildren(childRows);
      }
      const missing = missingRequired(entity, payload);
      if (missing.length) throw new Error(`缺少必填字段：${missing.join("、")}`);
      const saved = isEdit
        ? await ctx.adapter.update(entity.key, id!, payload)
        : await ctx.adapter.create(entity.key, payload);
      const parentId = String(saved.id);
      // 子表同步：新增行 create、保留行 update、被删行 delete（按原始快照对账）
      for (const child of children) {
        const current = childRows[child.key] ?? [];
        const originals = childOriginal[child.key] ?? [];
        const originalIds = new Set(originals.map((r) => String(r.id)));
        const kept = new Set<string>();
        for (const row of current) {
          const cp = buildPayload(child, row);
          cp[child.parentField!] = parentId;
          const meaningful = Object.entries(cp).some(
            ([k, v]) => k !== child.parentField && v !== null && v !== undefined && v !== "",
          );
          if (!row.id && !meaningful) continue; // 跳过空白新增行
          const cmissing = missingRequired(child, cp);
          if (cmissing.length) {
            throw new Error(`${child.label}缺少必填字段：${cmissing.join("、")}`);
          }
          if (row.id && originalIds.has(String(row.id))) {
            kept.add(String(row.id));
            await ctx.adapter.update(child.key, String(row.id), cp);
          } else {
            await ctx.adapter.create(child.key, cp);
          }
        }
        for (const orig of originals) {
          if (!kept.has(String(orig.id))) {
            await ctx.adapter.remove(child.key, String(orig.id));
          }
        }
      }
      ctx.adapter.notify("保存成功");
      ctx.adapter.navigate(listRoute);
    } catch (err) {
      setError(errText(err));
      ctx.adapter.notify(errText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`确认删除这条${entity.label}？此操作不可恢复。`)) return;
    try {
      await ctx.adapter.remove(entity.key, id!);
      ctx.adapter.notify("已删除");
      ctx.adapter.navigate(listRoute);
    } catch (err) {
      setError(errText(err));
    }
  };

  /* single 呈现样式（标签上置单列 + 工具栏吸底于安全区之上；规范 §5） */
  const singleRowStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 14,
  };
  const singleLabelStyle: CSSProperties = {
    fontSize: 13,
    color: "#374151",
    fontWeight: 500,
  };
  const singleControlStyle: CSSProperties = {
    width: "100%",
    minHeight: TOUCH_MIN,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  };
  const singleToolbarStyle: CSSProperties = {
    position: "sticky",
    /* 移动外壳在场时根节点有 --lcdp-nav-offset（导航高 + 安全区），工具栏须
       抬到导航之上；无外壳（设计器预览/桌面）回退为仅安全区，与原行为一致 */
    bottom: "calc(8px + var(--lcdp-nav-offset, env(safe-area-inset-bottom, 0px)))",
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#fff",
    border: "1px solid #f0f0f0",
    borderRadius: 12,
    padding: 10,
    marginTop: 20,
    boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
    zIndex: 5,
  };

  return (
    <div style={singleMode ? { maxWidth: "100%" } : styles.form}>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {isEdit && (
        <div style={singleMode ? singleRowStyle : styles.formRow}>
          <div style={singleMode ? singleLabelStyle : styles.label}>ID</div>
          <div style={{ paddingTop: singleMode ? 0 : 5, fontSize: 14 }}>
            {id}
          </div>
        </div>
      )}
      {entity.fields.map((f) => {
        // 权限门控：hidden 字段不渲染；readonly/masked 渲染为禁用控件（masked 值已由服务端脱敏，原样展示）
        const fieldAccess = ctx.access?.[entity.key]?.fields?.[f.key];
        if (fieldAccess === "hidden") return null;
        const locked = fieldAccess === "readonly" || fieldAccess === "masked";
        return (
          <div
            key={f.key}
            style={singleMode ? singleRowStyle : styles.formRow}
          >
            <div style={singleMode ? singleLabelStyle : styles.label}>
              {f.label}
              {f.required && <span style={styles.required}> *</span>}
            </div>
            <div
              style={
                singleMode ? singleControlStyle : { flex: 1, minWidth: 0 }
              }
            >
              <FieldInput
                field={f}
                value={values[f.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                adapter={ctx.adapter}
                linkage={{ entity: entity.key, recordId: id }}
                readOnly={
                  locked || (rollupActive && f.key === rollupField?.key)
                }
              />
            </div>
          </div>
        );
      })}
      {children.map((child) => (
        <ChildEditor
          key={child.key}
          child={child}
          rows={childRows[child.key] ?? []}
          onChange={(rows) =>
            setChildRows((prev) => ({ ...prev, [child.key]: rows }))
          }
          readOnly={!(isEdit ? canUpdate : canCreate)}
          cardMode={singleMode}
        />
      ))}
      <div
        style={
          singleMode
            ? singleToolbarStyle
            : { ...styles.toolbar, marginTop: 20 }
        }
      >
        {(isEdit ? canUpdate : canCreate) && (
          <Button
            type="primary"
            loading={saving}
            style={singleMode ? { minHeight: TOUCH_MIN, flex: 1 } : undefined}
            onClick={() => void save()}
          >
            保存
          </Button>
        )}
        <Button
          style={singleMode ? { minHeight: TOUCH_MIN } : undefined}
          onClick={() => ctx.adapter.navigate(listRoute)}
        >
          返回列表
        </Button>
        <div style={styles.spacer} />
        {isEdit &&
          canDelete &&
          (singleMode ? (
            <Dropdown
              menu={{
                items: [{ key: "delete", label: "删除", danger: true }],
                onClick: () => void remove(),
              }}
            >
              <Button style={{ minHeight: TOUCH_MIN }}>更多</Button>
            </Dropdown>
          ) : (
            <Button danger onClick={() => void remove()}>
              删除
            </Button>
          ))}
      </div>
    </div>
  );
}

/** 布局容器：flex 排布子组件；方向优先取当前设备的布局变体，其次 props，再次默认纵向 */
export function Container({ node, children }: NodeProps) {
  const ctx = useRendererCtx();
  const propDir =
    node.props?.direction === "row" || node.props?.direction === "column"
      ? node.props.direction
      : undefined;
  const direction = layoutFor(node, ctx.device)?.direction ?? propDir ?? "column";
  const gap = typeof node.props?.gap === "number" ? node.props.gap : 12;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction,
        gap,
        flexWrap: node.props?.wrap === true ? "wrap" : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** 标签页：每个子节点成一个页签，标题取子节点 props.title，缺省用组件类型名 */
export function Tabs({ node, children }: NodeProps) {
  const ctx = useRendererCtx();
  const kids = visibleSortedChildren(node, ctx.device);
  const rendered = Children.toArray(children);
  return (
    <AntdTabs
      items={kids.map((child, i) => ({
        key: child.id,
        label:
          typeof child.props?.title === "string" ? child.props.title : child.type,
        children: rendered[i],
      }))}
    />
  );
}

/**
 * 聚合数值取数（StatCard / Chart 共用）：
 * 实体经 binding.source 解析，过滤统一走结构化 vf（eq 项同时以旧 filters 兼容发送），
 * fn 缺省时按 fallbackCount 决定是否计数。
 */
function useAggregateValue(
  node: ComponentNode,
  fallbackCount: boolean,
): { entity: Entity | null; value: number | null; error: string | null; denied: boolean } {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const rawView = node.binding?.view;
  const rawViewSig = JSON.stringify(rawView ?? null);
  const paramsSig = JSON.stringify(ctx.params);
  // 过滤参数绑定（$param.<key> → 页面参数）：memo 以内容签名作依赖键，
  // 避免 resolvedView 每次渲染都是新对象、引发取数 effect 循环
  const view = useMemo(
    () => resolveViewParams(rawView, ctx.params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig],
  );
  const fn = view?.aggregate?.fn ?? (fallbackCount ? "count" : undefined);
  const field = view?.aggregate?.field;
  const filtersSig = JSON.stringify(eqFiltersOf(view));
  const vfSig = JSON.stringify(viewFiltersOf(view));
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!entity || !fn) return;
    let alive = true;
    setError(null);
    setDenied(false);
    ctx.adapter
      .aggregate(entity.key, {
        fn,
        field,
        filters: JSON.parse(filtersSig) as Record<string, string>,
        vf: JSON.parse(vfSig) as ViewFilter[],
      })
      .then((v) => {
        if (alive) {
          setValue(v);
          setError(null);
        }
      })
      .catch((err) => {
        if (!alive) return;
        // 403 = 字段级权限拒绝（聚合目标字段 hidden/masked）：整卡隐藏，不报错、不示 0
        if ((err as { status?: number } | null)?.status === 403) {
          setDenied(true);
        } else {
          setError(errText(err));
        }
      });
    return () => {
      alive = false;
    };
  }, [ctx.adapter, entity, fn, field, filtersSig, vfSig]);
  return { entity, value, error, denied };
}

/** 统计卡片：聚合数值大字展示（计数/求和/平均，缺省计数） */
export function StatCard({ node }: NodeProps) {
  const { entity, value, error, denied } = useAggregateValue(node, true);
  const title =
    typeof node.props?.title === "string"
      ? node.props.title
      : (entity?.label ?? "统计");
  const suffix =
    typeof node.props?.suffix === "string" ? node.props.suffix : undefined;
  if (denied) return null;
  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;
  return (
    <Card>
      {error ? (
        <Alert type="error" message={error} />
      ) : (
        <Statistic
          title={title}
          value={value === null ? "…" : value}
          suffix={suffix}
        />
      )}
    </Card>
  );
}

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

type ChartType = "bar" | "line" | "pie";

function chartTypeOf(node: ComponentNode): ChartType {
  const t = node.props?.chartType;
  return t === "line" || t === "pie" ? t : "bar";
}

/** 图表单值形态（无 groupBy）：沿用统计口径展示聚合数值 */
function ChartSingleValue({ node }: NodeProps) {
  const hasAggregate = Boolean(node.binding?.view?.aggregate);
  const { entity, value, error, denied } = useAggregateValue(node, false);
  const title =
    typeof node.props?.title === "string" ? node.props.title : "图表";
  if (hasAggregate && denied) return null;
  return (
    <Card title={title}>
      {hasAggregate && entity ? (
        error ? (
          <Alert type="error" message={error} />
        ) : (
          <div
            style={{
              fontSize: 30,
              fontWeight: 600,
              textAlign: "center",
              padding: "18px 0",
            }}
          >
            {value === null ? "…" : value}
          </div>
        )
      ) : (
        <div
          style={{
            ...styles.empty,
            border: "1px dashed #d9d9d9",
            borderRadius: 8,
          }}
        >
          图表未配置聚合（在设计器中为图表设置聚合与分组字段）
        </div>
      )}
    </Card>
  );
}

/**
 * 图表分组形态（aggregate.groupBy 已声明）：走分组聚合取序列，ECharts 渲染柱/折/饼。
 * 分组标签：ref 用引用标签解析、enum 用选项 label、null 组显示「未填」；
 * 403（分组/指标字段被权限拒绝）→ 整卡不渲染，与统计卡同一口径。
 */
function GroupedChart({
  node,
  entity,
}: {
  node: ComponentNode;
  entity: Entity;
}) {
  const ctx = useRendererCtx();
  const rawView = node.binding?.view;
  const rawViewSig = JSON.stringify(rawView ?? null);
  const paramsSig = JSON.stringify(ctx.params);
  // 过滤参数绑定（$param.<key> → 页面参数）：memo 以内容签名作依赖键，
  // 避免 resolvedView 每次渲染都是新对象、引发取数 effect 循环
  const view = useMemo(
    () => resolveViewParams(rawView, ctx.params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig],
  );
  const agg = view?.aggregate;
  const fn = agg?.fn ?? "count";
  const field = agg?.field;
  const groupBy = agg?.groupBy ?? "";
  const chartType = chartTypeOf(node);
  const title =
    typeof node.props?.title === "string" ? node.props.title : "图表";
  const groupField = entity.fields.find((f) => f.key === groupBy);
  const groupRefEntity =
    groupField?.type === "ref" ? groupField.refEntity : undefined;
  const groupOptionsSig = JSON.stringify(groupField?.options ?? null);
  const filtersSig = JSON.stringify(eqFiltersOf(view));
  const vfSig = JSON.stringify(viewFiltersOf(view));
  const [series, setSeries] = useState<AggregateGroupItem[] | null>(null);
  const [refLabels, setRefLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setDenied(false);
    ctx.adapter
      .aggregateGrouped(entity.key, {
        fn,
        field,
        groupBy,
        filters: JSON.parse(filtersSig) as Record<string, string>,
        vf: JSON.parse(vfSig) as ViewFilter[],
      })
      .then((s) => {
        if (alive) setSeries(s);
      })
      .catch((err) => {
        if (!alive) return;
        if ((err as { status?: number } | null)?.status === 403) {
          setDenied(true);
        } else {
          setError(errText(err));
        }
      });
    return () => {
      alive = false;
    };
  }, [ctx.adapter, entity, fn, field, groupBy, filtersSig, vfSig]);

  // ref 分组：拉被引实体选项表做 id→label 映射（与表格的引用标签同一来源）
  useEffect(() => {
    if (!groupRefEntity) return;
    let alive = true;
    ctx.adapter
      .options(groupRefEntity)
      .then((opts) => {
        if (alive) {
          setRefLabels(
            Object.fromEntries(opts.map((o) => [o.value, o.label])),
          );
        }
      })
      .catch(() => {
        // 标签拉取失败时回退显示原始 id
      });
    return () => {
      alive = false;
    };
  }, [ctx.adapter, groupRefEntity]);

  useEffect(() => {
    if (!chartRef.current || !series) return;
    const groupOptions = JSON.parse(groupOptionsSig) as
      | Array<{ value: string; label: string }>
      | null;
    const labelOf = (key: string | null): string => {
      if (key === null) return "未填";
      if (!groupField) return key;
      if (groupField.type === "ref") return refLabels[key] ?? key;
      if (groupField.type === "enum") {
        return groupOptions?.find((o) => o.value === key)?.label ?? key;
      }
      if (groupField.type === "boolean") return key === "true" ? "是" : "否";
      return key;
    };
    const chart = echarts.init(chartRef.current);
    let option: EChartsOption;
    if (chartType === "pie") {
      option = {
        tooltip: { trigger: "item" },
        legend: { bottom: 0 },
        series: [
          {
            type: "pie",
            radius: "62%",
            data: series.map((s) => ({
              name: labelOf(s.key),
              value: s.value,
            })),
          },
        ],
      };
    } else {
      option = {
        tooltip: { trigger: "axis" },
        grid: { left: 8, right: 16, top: 30, bottom: 4, containLabel: true },
        xAxis: { type: "category", data: series.map((s) => labelOf(s.key)) },
        yAxis: { type: "value" },
        series: [{ type: chartType, data: series.map((s) => s.value) }],
      };
    }
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
    // labelOf 的输入（分组字段类型/枚举选项/ref 标签）已由 groupOptionsSig 与 refLabels 完整刻画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, chartType, refLabels, groupOptionsSig, groupField?.type]);

  if (denied) return null;
  return (
    <Card title={title}>
      {error ? (
        <Alert type="error" message={error} />
      ) : series === null ? (
        <div style={styles.empty}>加载中…</div>
      ) : series.length === 0 ? (
        <div style={styles.empty}>暂无数据</div>
      ) : (
        <div ref={chartRef} style={{ width: "100%", height: 300 }} />
      )}
    </Card>
  );
}

/**
 * 图表（M9）：ECharts 预置图表（柱/折/饼）。
 * binding.view.aggregate 带 groupBy → 分组序列绘图；无 groupBy → 单值展示（同 StatCard 口径）。
 */
export function Chart({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;
  if (node.binding?.view?.aggregate?.groupBy) {
    return <GroupedChart node={node} entity={entity} />;
  }
  return <ChartSingleValue node={node} />;
}

/** 兼容旧页面：ChartPlaceholder 保留注册，渲染转发 Chart（M9 起图表引擎已接入） */
export function ChartPlaceholder({ node }: NodeProps) {
  return <Chart node={node} />;
}

/**
 * 内容列表（M10）：卡片式内容呈现——封面图 + 标题 + 日期 + 摘要，面向文章/资讯类前台页面。
 * 取数与 DataTable 完全同口径：binding.view 的过滤走结构化 vf（eq 项同时以旧 filters 兼容双发）、
 * 第一排序项经适配器下发、limit/offset 分页；栏目/搜索等条件都由设计器在数据视图里声明。
 * 字段映射走 props：titleField（缺省取名为 title 的字段、再缺省取首个字段）、summaryField、
 * coverField（image/file 字段，取首个资产）、dateField；detailRoute 配置后整卡可点，
 * 跳 detailRoute?id=<记录 id>，详情页经页面参数取 id（与 DataTable 行点击同一线格式）。
 */
export function ContentList({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const rawView = node.binding?.view;
  const rawViewSig = JSON.stringify(rawView ?? null);
  const paramsSig = JSON.stringify(ctx.params);
  // 过滤参数绑定（$param.<key> → 页面参数）：memo 以内容签名作依赖键，
  // 避免 resolvedView 每次渲染都是新对象、引发取数 effect 循环
  const view = useMemo(
    () => resolveViewParams(rawView, ctx.params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig],
  );
  const pageSize =
    view?.pageSize ??
    (typeof node.props?.pageSize === "number" ? node.props.pageSize : 10);
  const strProp = (k: string): string | undefined =>
    typeof node.props?.[k] === "string" && node.props[k]
      ? (node.props[k] as string)
      : undefined;
  const titleKey =
    strProp("titleField") ??
    entity?.fields.find((f) => f.key === "title")?.key ??
    entity?.fields[0]?.key;
  const titleField = entity?.fields.find((f) => f.key === titleKey);
  const summaryField = entity?.fields.find(
    (f) => f.key === strProp("summaryField"),
  );
  const coverField = entity?.fields.find(
    (f) => f.key === strProp("coverField"),
  );
  const dateField = entity?.fields.find((f) => f.key === strProp("dateField"));
  const detailRoute = strProp("detailRoute");
  const [pageIdx, setPageIdx] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 数据视图签名（内容变化才重拉）：与 DataTable 同一取数线格式
  const viewSig = JSON.stringify(view ?? null);
  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setError(null);
    try {
      const filters = eqFiltersOf(view);
      const vf = viewFiltersOf(view);
      const firstSort = view?.sort?.[0];
      const res = await ctx.adapter.list(entity.key, {
        limit: pageSize,
        offset: pageIdx * pageSize,
        filters: Object.keys(filters).length ? filters : undefined,
        vf: vf.length ? vf : undefined,
        sort: firstSort
          ? { field: firstSort.field, dir: firstSort.dir }
          : undefined,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
    // view 的内容已由 viewSig 完整刻画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.adapter, entity, pageIdx, pageSize, viewSig]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;

  const summaryOf = (row: Row): string => {
    if (!summaryField) return "";
    const v = row[summaryField.key];
    if (v === null || v === undefined || v === "") return "";
    if (summaryField.type === "richtext") {
      return htmlToText(String(v), 140);
    }
    const text = formatCellValue(summaryField, v);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  };

  return (
    <div>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {loading && rows.length === 0 ? (
        <div style={styles.empty}>加载中…</div>
      ) : rows.length === 0 ? (
        <div style={styles.empty}>暂无内容</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row) => {
            const coverId = coverField
              ? parseAssetIds(row[coverField.key])[0]
              : undefined;
            const summary = summaryOf(row);
            return (
              <Card
                key={String(row.id)}
                size="small"
                hoverable={Boolean(detailRoute)}
                onClick={
                  detailRoute
                    ? () =>
                        ctx.adapter.navigate(
                          `${detailRoute}?id=${encodeURIComponent(String(row.id))}`,
                        )
                    : undefined
                }
                style={detailRoute ? { cursor: "pointer" } : undefined}
              >
                <div style={{ display: "flex", gap: 16 }}>
                  {coverId && (
                    <img
                      src={ctx.adapter.assetContentUrl(coverId)}
                      alt=""
                      style={{
                        width: 168,
                        height: 106,
                        objectFit: "cover",
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Title
                      level={5}
                      style={{ margin: "0 0 6px" }}
                      ellipsis={{ rows: 1 }}
                    >
                      {titleField
                        ? formatCellValue(titleField, row[titleField.key])
                        : String(row.id)}
                    </Typography.Title>
                    {dateField && row[dateField.key] != null && (
                      <Typography.Text
                        type="secondary"
                        style={{ display: "block", fontSize: 12, marginBottom: 6 }}
                      >
                        {formatCellValue(dateField, row[dateField.key])}
                      </Typography.Text>
                    )}
                    {summary && (
                      <Typography.Paragraph
                        type="secondary"
                        style={{ margin: 0 }}
                        ellipsis={{ rows: 2 }}
                      >
                        {summary}
                      </Typography.Paragraph>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {total > pageSize && (
        <Pagination
          style={{ marginTop: 16, textAlign: "right" }}
          current={pageIdx + 1}
          pageSize={pageSize}
          total={total}
          showSizeChanger={false}
          showTotal={(t) => `共 ${t} 条`}
          onChange={(p) => setPageIdx(p - 1)}
        />
      )}
    </div>
  );
}

/** 详情：按页面参数 id 拉单条记录，以描述列表展示字段（值经统一格式化、引用显示标签） */
export function Detail({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const id = ctx.params.id;
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>(
    {},
  );

  useEffect(() => {
    if (!entity || !id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const r = await ctx.adapter.get(entity.key, id);
        if (!alive) return;
        setRow(r);
        const refFields = entity.fields.filter(
          (f) => f.type === "ref" && f.refEntity,
        );
        const map: Record<string, Record<string, string>> = {};
        await Promise.all(
          refFields.map(async (f) => {
            try {
              const opts = await ctx.adapter.options(f.refEntity!);
              map[f.refEntity!] = Object.fromEntries(
                opts.map((o) => [o.value, o.label]),
              );
            } catch {
              // 标签拉取失败时回退显示原始值
            }
          }),
        );
        if (alive) setLabels(map);
      } catch (err) {
        if (alive) setError(errText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ctx.adapter, entity, id]);

  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;
  if (!id) return <Alert type="info" message="未选择记录（缺少 id 参数）" />;
  if (loading) return <div style={styles.empty}>加载中…</div>;
  if (error) return <Alert type="error" message={error} />;
  if (!row) return <Alert type="warning" message="记录不存在" />;

  const fieldKeys = Array.isArray(node.props?.fields)
    ? (node.props.fields as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : null;
  const fields: Field[] = fieldKeys
    ? fieldKeys
        .map((k) => entity.fields.find((f) => f.key === k))
        .filter((f): f is Field => Boolean(f))
    : entity.fields;
  // 权限门控：hidden 字段不展示（服务端响应整形已删除该键，此处再兜一层）
  const visibleFields = fields.filter(
    (f) => ctx.access?.[entity.key]?.fields?.[f.key] !== "hidden",
  );
  const listRoute =
    typeof node.props?.listRoute === "string" ? node.props.listRoute : null;

  return (
    <div>
      {listRoute && (
        <Button
          style={{ marginBottom: 12 }}
          onClick={() => ctx.adapter.navigate(listRoute)}
        >
          ← 返回
        </Button>
      )}
      <Descriptions bordered column={1} size="middle">
        <Descriptions.Item label="ID">{String(row.id)}</Descriptions.Item>
        {visibleFields.map((f) => (
          <Descriptions.Item key={f.key} label={f.label}>
            {f.type === "richtext" ? (
              <RichTextView
                html={
                  typeof row[f.key] === "string" ? (row[f.key] as string) : ""
                }
              />
            ) : f.type === "file" || f.type === "image" ? (
              <AssetValue
                ids={parseAssetIds(row[f.key])}
                image={f.type === "image"}
                adapter={ctx.adapter}
              />
            ) : (
              formatCellValue(
                f,
                row[f.key],
                f.refEntity ? labels[f.refEntity] : undefined,
              )
            )}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </div>
  );
}

/** 动作按钮：点击后按 props.route 跳转页面 */
export function ActionButton({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const label =
    typeof node.props?.label === "string" ? node.props.label : "按钮";
  const type =
    node.props?.type === "primary" ||
    node.props?.type === "default" ||
    node.props?.type === "dashed" ||
    node.props?.type === "link" ||
    node.props?.type === "text"
      ? node.props.type
      : undefined;
  const route = typeof node.props?.route === "string" ? node.props.route : null;
  return (
    <Button
      type={type}
      onClick={route ? () => ctx.adapter.navigate(route) : undefined}
    >
      {label}
    </Button>
  );
}

/** 文本块：纯文本段落，level=title 时渲染为标题 */
export function TextBlock({ node }: NodeProps) {
  const text = typeof node.props?.text === "string" ? node.props.text : "";
  if (node.props?.level === "title") {
    return (
      <Typography.Title level={3} style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </Typography.Title>
    );
  }
  return (
    <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
      {text}
    </Typography.Paragraph>
  );
}

/** 图片：按 URL 展示，自适应容器宽度 */
export function ImageBlock({ node }: NodeProps) {
  const src = typeof node.props?.src === "string" ? node.props.src : "";
  const alt = typeof node.props?.alt === "string" ? node.props.alt : "";
  if (!src) return <Alert type="info" message="未设置图片地址" />;
  return (
    <img src={src} alt={alt} style={{ maxWidth: "100%", display: "block" }} />
  );
}

/**
 * 智能助手（M7）：渲染器保持宿主无关——
 * 设计态（ctx.design）渲染预览卡，说明发布后的形态；
 * 运行态渲染入口卡，「打开助手」按钮派发全局事件 lcdp:open-assistant，
 * 由运行态外壳（runtime App）监听并打开全局对话抽屉（对话面板本体在宿主侧实现）。
 */
export function AgentChat({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const title =
    typeof node.props?.title === "string" ? node.props.title : "智能助手";
  if (ctx.design) {
    return (
      <Card title={title}>
        <Typography.Paragraph type="secondary">
          运行态智能助手入口：页面发布后，用户点击卡片按钮打开对话面板，可查数据、办业务、问制度。
        </Typography.Paragraph>
        <Input disabled placeholder="输入问题或业务指令…" />
      </Card>
    );
  }
  return (
    <Card title={title}>
      <Typography.Paragraph type="secondary">
        有问题或要办的事，直接问我：查数据、建单据、查制度都可以。
      </Typography.Paragraph>
      <Button
        type="primary"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("lcdp:open-assistant"))
        }
      >
        打开助手
      </Button>
    </Card>
  );
}

/**
 * 客服会话记录（M12）：坐席在工单详情页查看访客会话全文与转人工摘要。
 * 记录上下文沿 Detail 既有机制——节点 binding.source 绑定工单实体，组件按页面参数 id
 * 拉当前记录行、取 props.conversationField 指定字段（缺省 conversation_id）为会话 id，
 * 再经宿主 adapter 的可选方法 getSupportTranscript 读坐席组 transcript 端点；
 * adapter 未实现该方法（设计器预览以外的宿主）时降级为占位提示，宿主无关红线不变。
 * 坐席可将任意一对「访客问 + 助手答」经 adapter.postSupportFaqDraft 沉淀为 FAQ 草稿
 * （进知识库待审队列，管理台审核后入库）；adapter 未提供该方法时不渲染沉淀入口。
 */
export function SupportTranscript({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const title =
    typeof node.props?.title === "string" ? node.props.title : "会话记录";
  const conversationField =
    typeof node.props?.conversationField === "string" &&
    node.props.conversationField
      ? node.props.conversationField
      : "conversation_id";
  const [data, setData] = useState<SupportTranscriptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noConversation, setNoConversation] = useState(false);
  /** 已沉淀为 FAQ 的助手消息 id 集合（防重复提交） */
  const [faqDone, setFaqDone] = useState<Set<string>>(new Set());
  const [faqBusyId, setFaqBusyId] = useState<string | null>(null);

  const entity = resolveEntity(ctx, node.binding?.source);
  const recordId = ctx.params.id;
  const canRead = typeof ctx.adapter.getSupportTranscript === "function";

  useEffect(() => {
    if (ctx.design || !canRead || !entity || !recordId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setNoConversation(false);
      try {
        const row = await ctx.adapter.get(entity.key, recordId);
        if (!alive) return;
        const cid = row?.[conversationField];
        if (typeof cid !== "string" || !cid) {
          setNoConversation(true);
          return;
        }
        const transcript = await ctx.adapter.getSupportTranscript!(cid);
        if (alive) setData(transcript);
      } catch (err) {
        if (alive) setError(errText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.design, canRead, entity?.key, recordId, conversationField]);

  if (ctx.design) {
    return (
      <Card title={title}>
        <Typography.Paragraph type="secondary">
          客服会话记录：发布后，坐席在工单详情页打开时，这里按当前记录的{" "}
          {conversationField} 字段展示访客会话全文与转人工摘要，并可将问答沉淀为
          FAQ 草稿（进知识库待审队列）。
        </Typography.Paragraph>
        <div
          style={{
            background: "#f5f5f5",
            borderRadius: 8,
            padding: "8px 12px",
            color: "#8c8c8c",
            fontSize: 13,
          }}
        >
          （示例）访客：送货预约要提前多久？　客服助手：请提前 3 个工作日预约…
        </div>
      </Card>
    );
  }
  if (!canRead) {
    return (
      <Card title={title}>
        <Typography.Text type="secondary">
          当前宿主未提供客服会话读取能力。
        </Typography.Text>
      </Card>
    );
  }
  if (!entity) return <Alert type="error" message="数据源未绑定实体" />;
  if (!recordId)
    return <Alert type="info" message="未选择记录（缺少 id 参数）" />;
  if (loading) return <div style={styles.empty}>加载中…</div>;
  if (error) return <Alert type="error" message={error} />;
  if (noConversation)
    return <Alert type="info" message="该记录未关联客服会话" />;
  if (!data) return <div style={styles.empty}>加载中…</div>;

  const submitFaq = async (question: string, answer: string, msgId: string) => {
    const fn = ctx.adapter.postSupportFaqDraft;
    if (!fn || faqBusyId) return;
    setFaqBusyId(msgId);
    try {
      await fn({ question, answer });
      setFaqDone((prev) => new Set(prev).add(msgId));
      ctx.adapter.notify("已提交为 FAQ 草稿，等待管理台审核");
    } catch (err) {
      ctx.adapter.notify(errText(err), "error");
    } finally {
      setFaqBusyId(null);
    }
  };

  const statusText =
    data.status === "handoff"
      ? "已转人工"
      : data.status === "closed"
        ? "已结束"
        : "进行中";

  return (
    <Card title={title}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 12,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          状态：{statusText}
          {data.ticketId ? ` · 工单号：${data.ticketId}` : ""}
          {data.rating ? ` · 访客评分：${data.rating} / 5` : ""}
        </Typography.Text>
        {data.summary ? (
          <div
            style={{
              background: "#fffbe6",
              border: "1px solid #ffe58f",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            <Typography.Text strong>对话摘要：</Typography.Text>
            {data.summary}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data.messages.length === 0 ? (
          <Typography.Text type="secondary">暂无消息</Typography.Text>
        ) : (
          data.messages.map((m, i) => {
            const isVisitor = m.role === "visitor" || m.role === "user";
            if (m.role === "system") {
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: "center",
                    color: "#8c8c8c",
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  {m.text}
                </div>
              );
            }
            // 沉淀 FAQ：一问一答 = 本条助手消息 + 其前最近一条访客消息
            let question: string | null = null;
            if (!isVisitor) {
              for (let j = i - 1; j >= 0; j--) {
                const prev = data.messages[j]!;
                if (prev.role === "visitor" || prev.role === "user") {
                  question = prev.text;
                  break;
                }
              }
            }
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isVisitor ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    background: isVisitor ? "#1677ff" : "#f5f5f5",
                    color: isVisitor ? "#fff" : "inherit",
                    borderRadius: 12,
                    padding: "8px 12px",
                    fontSize: 14,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.text}
                </div>
                {!isVisitor && m.citations && m.citations.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {m.citations.map((c, ci) => (
                      <Tooltip key={ci} title={c.snippet}>
                        <Tag style={{ cursor: "help", marginInlineEnd: 0 }}>
                          📄 {c.docTitle}
                        </Tag>
                      </Tooltip>
                    ))}
                  </div>
                )}
                {!isVisitor &&
                  question &&
                  ctx.adapter.postSupportFaqDraft &&
                  (faqDone.has(m.id) ? (
                    <Tag color="green" style={{ alignSelf: "flex-start" }}>
                      已提交 FAQ 待审
                    </Tag>
                  ) : (
                    <Button
                      size="small"
                      type="link"
                      style={{ alignSelf: "flex-start", padding: 0 }}
                      loading={faqBusyId === m.id}
                      onClick={() =>
                        void submitFaq(question!, m.text, m.id)
                      }
                    >
                      沉淀为 FAQ
                    </Button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

/** 内置组件注册表（注册中心 v1：布局/数据/内容/动作/智能共 14 类组件，含 M9 的 Chart 与 M10 的 ContentList） */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = createRegistry();
  registerComponent(registry, "Page", Page);
  registerComponent(registry, "Container", Container);
  registerComponent(registry, "Tabs", Tabs);
  registerComponent(registry, "DataTable", DataTable);
  registerComponent(registry, "EntityForm", EntityForm);
  registerComponent(registry, "Detail", Detail);
  registerComponent(registry, "StatCard", StatCard);
  registerComponent(registry, "Chart", Chart);
  registerComponent(registry, "ChartPlaceholder", ChartPlaceholder);
  registerComponent(registry, "ContentList", ContentList);
  registerComponent(registry, "TextBlock", TextBlock);
  registerComponent(registry, "Image", ImageBlock);
  registerComponent(registry, "Button", ActionButton);
  registerComponent(registry, "AgentChat", AgentChat);
  registerComponent(registry, "SupportTranscript", SupportTranscript);
  return registry;
}

function NodeView({
  node,
  registry,
  isRoot,
}: {
  node: ComponentNode;
  registry: ComponentRegistry;
  /** 页面根节点：设计态不挂拖拽手柄（根不可拖） */
  isRoot?: boolean;
}) {
  const ctx = useRendererCtx();
  const Comp = registry.get(node.type);
  if (!Comp) {
    return <Alert type="error" message={`未注册的组件类型：${node.type}`} />;
  }
  // 当前设备的布局变体声明 hidden 时，整棵子树不渲染
  if (layoutFor(node, ctx.device)?.hidden) return null;
  const design = ctx.design;
  const selected =
    design?.selectedId !== undefined && design.selectedId === node.id;
  return (
    <div
      data-node-id={design ? node.id : undefined}
      className={
        design ? `lcdp-node${selected ? " lcdp-node-selected" : ""}` : undefined
      }
      onClick={
        design?.onSelect
          ? (e) => {
              e.stopPropagation();
              design.onSelect!(node.id);
            }
          : undefined
      }
      style={
        selected
          ? { outline: "2px solid #1677ff", outlineOffset: 1 }
          : undefined
      }
    >
      {design && !isRoot && (
        <div
          className="lcdp-drag-handle"
          data-drag-handle={node.id}
          title="按住手柄拖拽移动此组件"
        >
          <span aria-hidden>⠿</span>
          <span>
            {typeof node.props?.title === "string" ? node.props.title : node.type}
          </span>
        </div>
      )}
      <Comp node={node}>
        {visibleSortedChildren(node, ctx.device).map((child) => {
          const cl = layoutFor(child, ctx.device);
          // 每个子节点外包一层：order/span 在此生效，供 Container 的 flex 布局排布
          return (
            <div
              key={child.id}
              style={{
                order: cl?.order,
                flexBasis: cl?.span ? `${(cl.span / 12) * 100}%` : undefined,
                flexGrow: cl?.span ? 0 : undefined,
                flexShrink: cl?.span ? 1 : undefined,
                minWidth: 0,
              }}
            >
              <NodeView node={child} registry={registry} />
            </div>
          );
        })}
      </Comp>
    </div>
  );
}

export interface SchemaRendererProps {
  page: PageSchema;
  dataSchema: RendererContextValue["dataSchema"];
  adapter: RuntimeAdapter;
  /** 页面参数（如表单页的 id 来自 ?id=） */
  params?: Record<string, string>;
  /** 渲染设备（决定组件树读取哪一版布局变体），默认桌面端 */
  device?: "desktop" | "mobile";
  /** 权限门控（可选）：实体 key → 有效访问；缺省时组件不做任何门控 */
  access?: RendererContextValue["access"];
  /** 设计模式（设计器画布）：节点可点选并回显选中态 */
  design?: RendererContextValue["design"];
  /** 应用主题（快照 appConfig.theme）：移动端解析其 mobile 令牌组（M13） */
  theme?: Record<string, unknown>;
  /** 自定义注册表（默认注册中心 v1；设计器可注入更多组件） */
  registry?: ComponentRegistry;
}

/** 渲染入口：按 PageSchema.root 递归渲染组件树 */
export function SchemaRenderer({
  page,
  dataSchema,
  adapter,
  params = {},
  device = "desktop",
  access,
  design,
  theme,
  registry,
}: SchemaRendererProps) {
  const reg = registry ?? createDefaultRegistry();
  const tree = <NodeView node={page.root} registry={reg} isRoot />;
  // 移动端令牌注入（M13）：resolveMobileTheme 解析 appConfig.theme.mobile，
  // 映射为 CSS 变量供 card/single 呈现与按钮热区消费；桌面端不注入、DOM 与原实现一致
  if (device === "mobile") {
    const mt = resolveMobileTheme(theme ?? {});
    const compact = mt.density === "compact";
    const vars = {
      "--lcdp-touch-min": `${mt.touchMinPx}px`,
      "--lcdp-font-scale": String(mt.fontScale),
      "--lcdp-control-h": compact ? "36px" : "40px",
      "--lcdp-card-pad": compact ? "10px" : "12px",
      "--lcdp-row-min-h": compact ? "48px" : "56px",
      fontSize: 14 * mt.fontScale,
    } as CSSProperties;
    return (
      <RendererContext.Provider
        value={{ adapter, dataSchema, page, params, device, access, design, theme }}
      >
        <div style={vars}>{tree}</div>
      </RendererContext.Provider>
    );
  }
  return (
    <RendererContext.Provider
      value={{ adapter, dataSchema, page, params, device, access, design, theme }}
    >
      {tree}
    </RendererContext.Provider>
  );
}
