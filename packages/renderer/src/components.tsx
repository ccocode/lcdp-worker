import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  EmptyState,
  LoadingState,
  errText,
  errorDisplayText,
  fmtAmount,
  mobileDensity,
  mobileVars,
  tokens,
} from "@lcdp/ui";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
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
  EntityAccess,
  MemberRoleGrant,
  RendererContextValue,
  Row,
  RuntimeAdapter,
  SupportTranscriptData,
  ViewFilter,
} from "./adapter.js";
import { childEntities, parseAssetIds, resolveEntity } from "./adapter.js";
import { cartStore } from "./cartStore.js";
import type { CartItem } from "./cartStore.js";
import { FieldInput } from "./fields.js";
import {
  checkChildRows,
  checkFieldValue,
  isEmptyValue,
  resolveLabelField,
} from "./fillcheck.js";
import { RichTextView, htmlToText } from "./richtext.js";
import {
  StatusBadge,
  parseStatusColors,
  type StatusToken,
} from "./statusBadge.js";
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

/* ------------------------------------------------------------------ */
/* 页面记录上下文 + 声明式可见性条件 visibleWhen（呈现层治理·包二）      */
/*                                                                     */
/* 详情页的当前行原本只存在于 Detail 组件的私有 state 里，同页的动作    */
/* 按钮（兄弟节点）看不到记录、无法按状态收起。此处由 SchemaRenderer   */
/* 在页面根建上下文：加载记录的组件（Detail）把加载态/当前行发布进来， */
/* 节点渲染层（NodeView）对声明了 props.visibleWhen 的节点统一求值。    */
/* 页面上没有发布者时状态恒为 absent，门控节点按原行为渲染（兼容兜底）。*/
/* ------------------------------------------------------------------ */

/** 页面记录状态：absent = 本页无记录发布者；pending = 发布者在但记录未就绪；ready = 已就绪 */
export type PageRecordState =
  | { kind: "absent" }
  | { kind: "pending" }
  | { kind: "ready"; record: Row };

interface PageRecordContextValue {
  state: PageRecordState;
  publish: (state: PageRecordState) => void;
}

const PageRecordContext = createContext<PageRecordContextValue>({
  state: { kind: "absent" },
  publish: () => {},
});

function PageRecordProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageRecordState>({ kind: "absent" });
  const publish = useCallback((next: PageRecordState) => setState(next), []);
  const value = useMemo(() => ({ state, publish }), [state, publish]);
  return (
    <PageRecordContext.Provider value={value}>
      {children}
    </PageRecordContext.Provider>
  );
}

/** 声明式可见性条件：对页面当前行的单字段做等值（eq）或集合（in）判断，恰一 */
export interface VisibleWhen {
  field: string;
  eq?: string;
  in?: string[];
}

/**
 * 解析节点 props.visibleWhen：形状合法（field 为非空字符串且 eq/in 恰一合法）才返回门控；
 * 未声明或形状非法一律返回 null（按无门控渲染），保证对存量页面零影响。
 */
export function parseVisibleWhen(raw: unknown): VisibleWhen | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== "string" || !r.field) return null;
  const hasEq = typeof r.eq === "string";
  const hasIn =
    Array.isArray(r.in) && r.in.every((v) => typeof v === "string");
  if (hasEq === hasIn) return null;
  return hasEq
    ? { field: r.field, eq: r.eq as string }
    : { field: r.field, in: r.in as string[] };
}

/** 对当前行求值 visibleWhen：字段缺失/为空视为不匹配；比较统一按字符串口径 */
export function evalVisibleWhen(gate: VisibleWhen, record: Row): boolean {
  const v = record[gate.field];
  if (v === null || v === undefined) return false;
  const s = String(v);
  return gate.eq !== undefined ? s === gate.eq : (gate.in ?? []).includes(s);
}

/**
 * 展示场景的状态值渲染（包二）：status 字段出彩色徽标；空值维持「—」纯文本。
 * DataTable 单元格 / Detail 只读展示共用；colors 为应用经 props.statusColors 的覆盖。
 */
function StatusDisplay({
  raw,
  text,
  colors,
}: {
  raw?: unknown;
  text: string;
  colors?: Record<string, StatusToken>;
}) {
  if (text === "" || text === "—") return <>{text}</>;
  return <StatusBadge raw={raw} text={text} colors={colors} />;
}

/**
 * 共享错误文案出口：服务端业务消息（按契约是中文）原样上屏；机器码与
 * 网络/运行时级错误经 @lcdp/ui 的 errorDisplayText 映射为友好文案
 * （错误码表 + TypeError/网络短语识别，第 73 步片三收编），未命中回落原文。
 */
function friendlyErrText(err: unknown): string {
  return errorDisplayText(err, errText(err));
}

/**
 * 数据源未绑定实体的分面呈现（第 73 步片三）：设计态（Studio 画布，
 * ctx.design 在场）保留配置指引原文；运行态换用户语义并在控制台留痕，
 * 不向终端用户暴露设计概念。
 */
function UnboundSourceAlert() {
  const ctx = useRendererCtx();
  const design = Boolean(ctx.design);
  useEffect(() => {
    if (!design) {
      console.warn("[lcdp] 数据组件的数据源未绑定实体，运行态已降级呈现");
    }
  }, [design]);
  if (design) return <Alert type="error" message="数据源未绑定实体" />;
  return <Alert type="warning" message="内容暂不可用，请稍后再试" />;
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
 *
 * 会员令牌（论坛立项）：value 整串严格等于 `$member.id` 时，以当前会员会话 id
 * 替换（「我的帖子」等页把归属条件值留给登录态决定）。无会员会话（公开/员工面
 * adapter 回 null）时令牌不解析、过滤项原样保留——原样值匹配不到任何行，
 * 与误配 $param 时宁可空列表、不放全量的保守口径一致。
 */
export function resolveViewParams(
  view: DataView | undefined,
  params: Record<string, string>,
  memberId?: string | null,
): DataView | undefined {
  if (!view?.filters?.length) return view;
  const filters: NonNullable<DataView["filters"]> = [];
  for (const f of view.filters) {
    if (typeof f.value === "string") {
      if (f.value === "$member.id") {
        if (memberId) filters.push({ ...f, value: memberId });
        else filters.push(f);
        continue;
      }
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

/**
 * 治理动作集（第 60 步 R2）：当前会员被授予的会员侧角色对某实体的动作
 * 并集。宿主未实现 memberRoles / 无会话 / 无角色时恒空集——治理控件
 * （Detail 治理条、DataTable 行删除）据此零渲染；执法在服务端。
 */
function governanceActions(
  adapter: RuntimeAdapter,
  entityKey: string,
): Set<string> {
  const roles: MemberRoleGrant[] = adapter.memberRoles?.() ?? [];
  const set = new Set<string>();
  for (const r of roles) {
    for (const ea of r.entityAccess) {
      if (ea.entity === entityKey) {
        for (const a of ea.actions) set.add(a);
      }
    }
  }
  return set;
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
    () => resolveViewParams(rawView, ctx.params, ctx.adapter.memberSession?.()?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig, ctx.adapter.memberSession?.()?.id ?? null],
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
      setError(friendlyErrText(err));
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

  // 标签门超时放行：待就绪的被引实体集合（pendingGateKey）若 1.5s 内未全部就绪，
  // 放行下方的渲染门先出数据行（引用列暂显原始值、标签到达后自动换成标签文本），
  // 避免慢标签请求（冷路径）让首帧无限空等、被误记成「列表为空」。
  // 集合变化（有标签落定）会重置计时；全部就绪后 pendingGateKey 为空、门自然打开。
  const pendingGateKey = refEntitiesKey
    ? refEntitiesKey
        .split(",")
        .filter((k) => !labelsDone[k])
        .sort()
        .join(",")
    : "";
  const [gateReleasedFor, setGateReleasedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingGateKey) return;
    const t = setTimeout(() => setGateReleasedFor(pendingGateKey), 1500);
    return () => clearTimeout(t);
  }, [pendingGateKey]);

  if (!entity) return <UnboundSourceAlert />;

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
  // 避免把原始 ID 当成最终内容闪现（映射到达后才出首屏）；
  // 但门只等 1.5s（见上方 pendingGateKey 计时），超时先放行出数据行
  const pendingRefs = fields
    .filter((f) => f.type === "ref" && f.refEntity)
    .map((f) => f.refEntity!)
    .filter((k, i, a) => a.indexOf(k) === i && !labelsDone[k]);
  const labelsPending = pendingRefs.length > 0;
  const labelsGate = labelsPending && gateReleasedFor !== pendingGateKey;

  const cellText = (row: Row, field: Field): string =>
    formatCellValue(
      field,
      row[field.key],
      field.refEntity ? labels[field.refEntity] : undefined,
    );

  // 状态徽标（包二）：props.statusColors 可覆盖个别状态值的色令牌
  const statusColors = parseStatusColors(node.props?.statusColors);
  /** 展示单元格：文件/图片走资产渲染，status 字段走徽标，其余维持纯文本 */
  const displayCell = (row: Row, f: Field) =>
    f.type === "file" || f.type === "image" ? (
      <AssetValue
        ids={parseAssetIds(row[f.key])}
        image={f.type === "image"}
        adapter={ctx.adapter}
      />
    ) : f.key === "status" ? (
      <StatusDisplay raw={row[f.key]} text={cellText(row, f)} colors={statusColors} />
    ) : (
      cellText(row, f)
    );

  // 治理删除（第 60 步 R2）：被授予角色对本实体含 delete 且宿主实现了
  // 治理删时，行尾出现删除入口；无角色零渲染（普通会员/访客/员工面无感）
  const govCanDelete =
    !ctx.design &&
    typeof ctx.adapter.memberGovernanceRemove === "function" &&
    governanceActions(ctx.adapter, entity.key).has("delete");
  const govRemoveRow = (row: Row) => {
    Modal.confirm({
      title: "删除这条记录？",
      content: "删除后不可恢复；若该记录仍被其他记录引用，则无法删除。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await ctx.adapter.memberGovernanceRemove!(entity.key, String(row.id));
          ctx.adapter.notify("已删除");
          void load();
        } catch (err) {
          ctx.adapter.notify(friendlyErrText(err), "error");
          throw err;
        }
      },
    });
  };

  const tableColumns: TableProps<Row>["columns"] = [
    ...(node.props?.showId === true
      ? [{ title: "ID", dataIndex: "id", key: "__id", width: 120 }]
      : []),
    ...fields.map((f) => ({
      title: f.label,
      dataIndex: f.key,
      key: f.key,
      ellipsis: true,
      render: (_: unknown, row: Row) => displayCell(row, f),
    })),
    ...(govCanDelete
      ? [
          {
            title: "操作",
            key: "__gov",
            width: 80,
            render: (_: unknown, row: Row) => (
              <Button
                type="link"
                size="small"
                danger
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  govRemoveRow(row);
                }}
              >
                删除
              </Button>
            ),
          },
        ]
      : []),
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
          {labelsGate || (loading && rows.length === 0) ? (
            <LoadingState block />
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            rows.map((row) => (
              <div
                key={String(row.id)}
                onClick={() => openRow(row)}
                style={{
                  background: tokens.colorBgContainer,
                  border: `1px solid ${tokens.colorBorder}`,
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
                    <span style={{ flexShrink: 0 }}>
                      <StatusDisplay
                        raw={row[cardStatusField.key]}
                        text={cellText(row, cardStatusField)}
                        colors={statusColors}
                      />
                    </span>
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
                        color: tokens.colorTextTertiary,
                        width: 84,
                        flexShrink: 0,
                        fontSize: "calc(12px * var(--lcdp-font-scale, 1))",
                        paddingTop: 1,
                      }}
                    >
                      {f.label}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {displayCell(row, f)}
                    </span>
                  </div>
                ))}
                {govCanDelete && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 4,
                    }}
                  >
                    <Button
                      size="small"
                      danger
                      type="text"
                      style={{ minHeight: TOUCH_MIN }}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        govRemoveRow(row);
                      }}
                    >
                      删除
                    </Button>
                  </div>
                )}
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
            <span style={{ color: tokens.colorTextTertiary, fontSize: 13 }}>
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
        size="middle"
        columns={tableColumns}
        dataSource={labelsGate ? [] : rows}
        loading={loading || labelsGate}
        locale={{ emptyText: <EmptyState /> }}
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

/** 载荷值深比较（行数据均为 JSON 形状：标量 / 数组 / 纯对象），供子表「只提交真变更」判定 */
function payloadValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((v, i) => payloadValueEqual(v, b[i]))
    );
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    return (
      ka.length === Object.keys(rb).length &&
      ka.every((k) => payloadValueEqual(ra[k], rb[k]))
    );
  }
  return false;
}

/** 两份 buildPayload 载荷是否等价（按字段并集逐项深比较） */
function payloadEqual(a: Row, b: Row): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!payloadValueEqual(a[k], b[k])) return false;
  }
  return true;
}

function missingRequired(
  entityDef: Entity,
  payload: Row,
  isExempt?: (f: Field) => boolean,
): string[] {
  return entityDef.fields
    .filter(
      (f) =>
        f.required &&
        !isExempt?.(f) &&
        (payload[f.key] === null ||
          payload[f.key] === undefined ||
          payload[f.key] === ""),
    )
    .map((f) => f.label);
}

/**
 * 字段级权限下用户无从填写的字段（readonly/masked 渲染为禁用控件、hidden 不渲染）
 * 不进客户端必填校验：新建时由服务端按 schema 默认值兜底（pickWritable），
 * 无默认值时服务端仍会如实报缺失；编辑时原值不在 payload 里也不会被覆盖。
 * 典型场景：编辑者对流程状态字段只读、状态由默认值与流程驱动（内容领域骨架验收实证）。
 */
function unfillableExempt(
  access: Record<string, EntityAccess> | undefined,
  entityKey: string,
): (f: Field) => boolean {
  return (f) => {
    const a = access?.[entityKey]?.fields?.[f.key];
    return a === "readonly" || a === "masked" || a === "hidden";
  };
}

/** 子表编辑器：父表单内嵌的明细行编辑（支持增删行与金额类字段自动小计） */
function ChildEditor({
  child,
  rows,
  onChange,
  readOnly = false,
  canCreate = true,
  canUpdate = true,
  canDelete = true,
  cardMode = false,
  statusColors,
}: {
  child: Entity;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  readOnly?: boolean;
  /** 状态徽标色覆盖（包二）：宿主表单 props.statusColors 透传，只读展示子表 status 字段时用 */
  statusColors?: Record<string, StatusToken>;
  /** 子实体动作权（宿主按 ctx.access[子实体].actions 分项传入，与保存层对账口径一致）：
   * 增 = 添加按钮与新增行可编辑；改 = 既有行可编辑；删 = 删除按钮。缺省全开（无 access 时不限制） */
  canCreate?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
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
  // 整表只读、行级动作权（既有行看 update、新行看 create，与保存层对账同口径）、
  // 字段级 readonly/masked、amount 小计字段恒只读
  const rowEditable = (row: Row) =>
    row.id !== undefined && row.id !== null && row.id !== ""
      ? canUpdate
      : canCreate;
  const fieldReadOnlyOf = (f: Field, row: Row) =>
    readOnly ||
    !rowEditable(row) ||
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
      readOnly={fieldReadOnlyOf(f, row)}
      statusColors={statusColors}
    />
  );

  /* ---------- 移动端卡片行呈现（M13）：每行一卡、字段竖排，增删与门控口径同表格呈现 ---------- */
  if (cardMode) {
    return (
      <div>
        <div style={styles.sectionTitle}>{child.label}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.length === 0 && (
            <EmptyState description={`暂无${child.label}`} />
          )}
          {rows.map((row, idx) => (
            <div
              key={idx}
              style={{
                background: tokens.colorBgContainer,
                border: `1px solid ${tokens.colorBorder}`,
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
                      color: tokens.colorTextSecondary,
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
              {!readOnly && canDelete && (
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
        {!readOnly && canCreate && (
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
            {!readOnly && canDelete && <th style={styles.childTh}>操作</th>}
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
              {!readOnly && canDelete && (
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
      {!readOnly && canCreate && (
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
  // 状态徽标色覆盖（包二）：透传给只读展示的 status 字段（主表与子表同口径）
  const statusColors = parseStatusColors(node.props?.statusColors);
  const id = ctx.params.id;
  // 新建主单落库后的 id 回写：主单 create 成功但子表部分失败留页时，再次保存须
  // 走 update 而非二次 create——否则生成重复主单，且已落库子行会被迁挂到新单下、
  // 第一张主单沦为空单。子表侧的回写/快照推进已在 save() 内就绪，此处补主单侧。
  const [createdId, setCreatedId] = useState<string | null>(null);
  const recordId = id ?? createdId ?? undefined;
  const isEdit = Boolean(recordId);
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
  // 回填保真（第 84 步片三 / 第 85 步断言真实化）：助手回填后逐字段回读
  // 得出的未落字段（key = 主表字段键；子表类未落为 null）；渲染时按当前值
  // 过滤，用户补齐即消。无法核对的字段单独一桶（标签无处解析、引用选项
  // 拉取失败等），不与未落混报
  const [fillMissed, setFillMissed] = useState<
    { key: string | null; label: string }[]
  >([]);
  const [fillUnverifiable, setFillUnverifiable] = useState<string[]>([]);
  /** values 镜像 ref：回填回调里据此计算「合并后表单值」做回读比对 */
  const valuesRef = useRef<Row>({});
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  /** childRows 镜像 ref：与 valuesRef 同理，供回填回调计算回填后子表状态 */
  const childRowsRef = useRef<Record<string, Row[]>>({});
  useEffect(() => {
    childRowsRef.current = childRows;
  }, [childRows]);

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
        if (alive) setError(friendlyErrText(err));
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
  // （sessionStorage `lcdp.fill.<entity>` = { values, items, expect?, sourceMessageId? }），
  // 预填主表字段与子表行后立即清除。
  // 仅新建（非编辑）、非设计态生效，不影响普通空表单与编辑既有记录的流程；
  // 已在本表单页时由宿主派发 lcdp:fill-form 事件触发再次读取（无需重新挂载）。
  // 第 84 步片三（回填保真）：预填后以 expect（用户在确认卡上见过的提案字段）
  // 为意图逐字段回读，未落字段记入 fillMissed 并在表单顶部明示（见渲染处）。
  // 第 85 步断言真实化：比对源改为回填后的真实表单态、子表逐行逐字段核对、
  // 结论分未落/无法核对两桶，纯判定逻辑抽至 ./fillcheck.ts。
  const applyAssistantFill = useCallback(async () => {
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
        /** 提案字段（标签+展示值）：回读比对的意图来源，写入端见运行态 AssistantPanel */
        expect?: { label: string; value: unknown }[];
        /** 提案来源的助手消息 id：随回读结果事件带出，供留痕回报接点使用 */
        sourceMessageId?: string;
      };
      if (data.values && typeof data.values === "object") {
        setValues((prev) => ({ ...prev, ...data.values }));
      }
      // byChild 提到块外：回读断言段要据它计算回填后的子表状态
      const byChild: Record<string, Row[]> = {};
      if (data.items) {
        // items 两种形态：按子实体 key 分组的对象，或单子表时的行数组（归入第一个子实体）;
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

      // —— 回读断言（第 85 步：断言真实化）——
      // 比对源 = 回填落定后的表单态（与上方 setValues/setChildRows 的合并
      // 结果完全一致），不再拿提案值和自身比。意图三路：values（主表原值）、
      // expect（确认卡标签+展示值）、items（子表行原值）。结论分两桶：
      // 未落（有意图、表单无值或值不符）与无法核对（标签在任何实体都解析
      // 不到、引用选项拉取失败等），横幅与留痕分列、绝不混报。
      // 纯判定逻辑在 ./fillcheck.ts（标签跨实体解析 / 同日判定 / 子表行
      // 匹配 / 逐字段落位判定）。
      const postValues: Row = { ...valuesRef.current, ...(data.values ?? {}) };
      const postChildRows: Record<string, Row[]> = {
        ...childRowsRef.current,
        ...byChild,
      };
      const missed: { key: string | null; label: string }[] = [];
      const unverifiable: string[] = [];
      const pushMissed = (key: string | null, label: string) => {
        if (label && !missed.some((m) => m.label === label)) {
          missed.push({ key, label });
        }
      };
      const pushUnverifiable = (label: string) => {
        if (
          label &&
          !unverifiable.includes(label) &&
          !missed.some((m) => m.label === label)
        ) {
          unverifiable.push(label);
        }
      };
      const isRollupField = (field: Field): boolean =>
        field.type === "decimal" &&
        /total/i.test(field.key) &&
        children.some((c) => c.fields.some((cf) => cf.key === "amount"));

      // 引用选项拉取（同次回填内缓存）：成功回选项数组，失败回 null
      const refOptionsCache = new Map<
        string,
        { value: string; label: string }[] | null
      >();
      const refOptions = async (refEntity: string) => {
        if (!refOptionsCache.has(refEntity)) {
          try {
            const opts = await ctx.adapter.options(refEntity);
            refOptionsCache.set(
              refEntity,
              opts.map((o) => ({ value: String(o.value), label: o.label })),
            );
          } catch {
            refOptionsCache.set(refEntity, null);
          }
        }
        return refOptionsCache.get(refEntity) ?? null;
      };

      // 主表字段核对（同一字段只核一次）：intent 为意图原值
      const checkedMainKeys = new Set<string>();
      const checkMainField = async (
        field: Field,
        intent: unknown,
        displayLabel: string,
      ): Promise<void> => {
        if (checkedMainKeys.has(field.key)) return;
        checkedMainKeys.add(field.key);
        if (isRollupField(field)) return;
        // hidden 字段不渲染、用户无从在表单里补齐：沿用旧口径记未落
        //（横幅可见集按当前值过滤，它在 values 里有值时不会打扰用户）
        if (ctx.access?.[entity.key]?.fields?.[field.key] === "hidden") {
          pushMissed(field.key, displayLabel);
          return;
        }
        let optionValues: string[] | undefined;
        if (field.type === "ref" && field.refEntity) {
          const opts = await refOptions(field.refEntity);
          if (opts === null) {
            // 选项拉取失败：不下未落结论，归无法核对
            pushUnverifiable(displayLabel);
            return;
          }
          optionValues = opts.map((o) => o.value);
        }
        const r = checkFieldValue(field, intent, postValues[field.key], {
          optionValues,
        });
        if (r === "missed") pushMissed(field.key, displayLabel);
        else if (r === "unverifiable") pushUnverifiable(displayLabel);
      };

      // 意图一：values 原值逐键核对（无 expect 的旧载荷也走这条 + 子表路径）
      if (data.values) {
        for (const [k, v] of Object.entries(data.values)) {
          if (isEmptyValue(v)) continue;
          const field = entity.fields.find((f) => f.key === k);
          if (!field) continue;
          await checkMainField(field, v, field.label);
        }
      }

      // items 意图行按子实体 key 归集（形态与回填端一致：数组归第一个子实体）
      const intentByChild = new Map<string, Row[]>();
      if (data.items) {
        if (Array.isArray(data.items)) {
          const first = children[0];
          if (first && data.items.length > 0) {
            intentByChild.set(first.key, data.items);
          }
        } else {
          for (const [k, rows] of Object.entries(data.items)) {
            if (Array.isArray(rows) && rows.length > 0) {
              intentByChild.set(k, rows);
            }
          }
        }
      }

      // 意图二：expect 标签逐项解析（范围 = 父实体 + 全部子实体）
      const expectList: { label: string; value: unknown }[] = [];
      if (Array.isArray(data.expect)) {
        for (const e of data.expect) {
          if (
            e &&
            typeof e.label === "string" &&
            e.label &&
            !isEmptyValue(e.value)
          ) {
            expectList.push({ label: e.label, value: e.value });
          }
        }
      }
      for (const it of expectList) {
        const resolved = resolveLabelField(it.label, entity, children);
        if (!resolved) {
          // 任何实体都解析不到：无法核对，绝不判未落
          pushUnverifiable(it.label);
          continue;
        }
        if (!resolved.isChild) {
          const field = resolved.field;
          if (checkedMainKeys.has(field.key)) continue;
          // 载荷带原值时已由意图一核对；未带时以确认卡展示值为意图，
          // ref 字段先经引用选项把展示值映射回 id，映射不到归无法核对
          let intentVal: unknown = it.value;
          if (field.type === "ref" && field.refEntity) {
            const opts = await refOptions(field.refEntity);
            if (opts === null) {
              pushUnverifiable(it.label);
              continue;
            }
            const hit = opts.find(
              (o) =>
                o.label === String(it.value) || o.value === String(it.value),
            );
            if (!hit) {
              pushUnverifiable(it.label);
              continue;
            }
            intentVal = hit.value;
          }
          await checkMainField(field, intentVal, it.label);
          continue;
        }
        // 子表字段：意图行在 items 里时由意图三逐行逐字段核对，此处不重复；
        // items 未带该子表行时，表单有行也无从核对意图（无法核对），
        // 表单连行都没有则是确切的未落
        const childEnt = resolved.owner;
        if (intentByChild.has(childEnt.key)) continue;
        if ((postChildRows[childEnt.key] ?? []).length === 0) {
          pushMissed(null, it.label);
        } else {
          pushUnverifiable(it.label);
        }
      }

      // 意图三：子表行逐行逐字段核对（回填后实存行 vs 意图行）；
      // 明细指向未知子实体（或本实体根本无子表）时归无法核对（旧口径记
      // 未落「明细行」，本步改口径）
      if (data.items) {
        if (Array.isArray(data.items)) {
          if (data.items.length > 0 && children.length === 0) {
            pushUnverifiable("明细行");
          }
        } else {
          const childKeys = new Set(children.map((c) => c.key));
          for (const [k, rows] of Object.entries(data.items)) {
            if (Array.isArray(rows) && rows.length > 0 && !childKeys.has(k)) {
              pushUnverifiable("明细行");
            }
          }
        }
      }
      for (const [childKey, intentRows] of intentByChild) {
        const childEnt = children.find((c) => c.key === childKey);
        if (!childEnt) continue; // 未知子实体已在上面归无法核对
        const res = checkChildRows(
          childEnt,
          intentRows,
          postChildRows[childKey] ?? [],
        );
        for (const label of res.missedLabels) pushMissed(null, label);
        for (const label of res.unverifiableLabels) pushUnverifiable(label);
      }

      setFillMissed(missed);
      setFillUnverifiable(unverifiable);
      // 回读结果留痕的接点（片三②）：经本事件带出（entity / 来源消息 id /
      // 未落与无法核对两份标签清单），宿主（运行态 AssistantPanel）监听后
      // 调 fill-result 端点回报服务端、并入 pending_action.handled 供回放。
      try {
        window.dispatchEvent(
          new CustomEvent("lcdp:fill-outcome", {
            detail: {
              entity: entity.key,
              messageId: data.sourceMessageId ?? null,
              missed: missed.map((m) => m.label),
              unverifiable: [...unverifiable],
            },
          }),
        );
      } catch {
        // 事件派发失败不影响回填本身
      }
    } catch {
      // 预填数据损坏时忽略，保持空表单
    }
    // children 由 entity 决定，同页内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.key, isEdit, ctx.design]);

  useEffect(() => {
    void applyAssistantFill();
  }, [applyAssistantFill]);

  useEffect(() => {
    const onFill = (e: Event) => {
      const ent = (e as CustomEvent<{ entity?: string }>).detail?.entity;
      if (!ent || ent === entity?.key) void applyAssistantFill();
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

  if (!entity) return <UnboundSourceAlert />;
  if (loading) return <LoadingState block />;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(entity, values);
      if (rollupActive && rollupField) {
        payload[rollupField.key] = sumChildren(childRows);
      }
      const missing = missingRequired(
        entity,
        payload,
        unfillableExempt(ctx.access, entity.key),
      );
      if (missing.length) throw new Error(`缺少必填字段：${missing.join("、")}`);
      const saved = recordId
        ? await ctx.adapter.update(entity.key, recordId, payload)
        : await ctx.adapter.create(entity.key, payload);
      // 主单已落库：立即回写 id，后续（含部分失败留页后的再次保存）一律按编辑态
      if (!recordId) setCreatedId(String(saved.id));
      const parentId = String(saved.id);
      // 子表同步：按「权限 + 变更」对账，不再无条件全量提交——
      // ① 当前角色对子实体无对应动作权（update/create/delete）时，该类行一律不提交；
      // ② 既有行先与原始快照深比较，未变更不发请求（无谓写入与无谓 403 的主源：
      //    主表可写、子表只读的角色改主表时，旧逻辑会把每条未动过的子行 PUT 一遍，
      //    第一条 403 就把整单拖成失败，而主表其实已经落库）；
      // ③ 主表已保存成功，子表的问题（无权改动、校验缺失、接口失败）只汇总为
      //    部分失败提示，不再 throw 成整单失败。
      const childIssues: string[] = [];
      // 部分失败后留在本页：已落库的子行须回写 state（新建行补服务端 id、原始
      // 快照推进到已保存值），否则再次保存会重复 create / 重复提交同一行。
      const nextChildRows: Record<string, Row[]> = { ...childRows };
      const nextChildOriginal: Record<string, Row[]> = { ...childOriginal };
      let childStateDirty = false;
      for (const child of children) {
        // 子实体动作权与主表同口径：复用宿主透传的 ctx.access[实体].actions，
        // 无 access（如设计态预览）时不限制，保持既有行为。
        const childActions = ctx.access
          ? ctx.access[child.key]?.actions
          : undefined;
        const childCanCreate =
          !ctx.access || (childActions?.includes("create") ?? false);
        const childCanUpdate =
          !ctx.access || (childActions?.includes("update") ?? false);
        const childCanDelete =
          !ctx.access || (childActions?.includes("delete") ?? false);
        const current = childRows[child.key] ?? [];
        const originals = childOriginal[child.key] ?? [];
        const originalById = new Map(
          originals.map((r) => [String(r.id), r] as const),
        );
        const kept = new Set<string>();
        const savedRows: Row[] = [];
        const savedOriginals: Row[] = [];
        let skippedChanged = 0;
        let skippedNew = 0;
        let skippedDeleted = 0;
        const failures: string[] = [];
        for (const row of current) {
          const cp = buildPayload(child, row);
          cp[child.parentField!] = parentId;
          const orig = row.id ? originalById.get(String(row.id)) : undefined;
          if (!orig) {
            // 新增行（无 id，或 id 不在原始快照内）
            const meaningful = Object.entries(cp).some(
              ([k, v]) =>
                k !== child.parentField &&
                v !== null &&
                v !== undefined &&
                v !== "",
            );
            if (!meaningful) continue; // 跳过空白新增行
            if (!childCanCreate) {
              skippedNew++;
              savedRows.push(row);
              continue;
            }
            const cmissing = missingRequired(
              child,
              cp,
              unfillableExempt(ctx.access, child.key),
            );
            if (cmissing.length) {
              failures.push(`新增行缺少必填字段：${cmissing.join("、")}`);
              savedRows.push(row);
              continue;
            }
            try {
              const created = await ctx.adapter.create(child.key, cp);
              savedRows.push({ ...row, id: created.id });
              savedOriginals.push({ ...cp, id: created.id });
              childStateDirty = true;
            } catch (err) {
              failures.push(`新增行保存失败：${friendlyErrText(err)}`);
              savedRows.push(row);
            }
            continue;
          }
          kept.add(String(row.id));
          // 既有行：先深比较，未变更直接跳过（不看权限——没动过的行谁都不该提交）
          const op = buildPayload(child, orig);
          op[child.parentField!] = parentId;
          if (payloadEqual(cp, op)) {
            savedRows.push(row);
            savedOriginals.push(orig);
            continue;
          }
          if (!childCanUpdate) {
            // 真改动了但无 update 权：不提交、不静默吞——保留改动并计数提示
            skippedChanged++;
            savedRows.push(row);
            savedOriginals.push(orig);
            continue;
          }
          const cmissing = missingRequired(
            child,
            cp,
            unfillableExempt(ctx.access, child.key),
          );
          if (cmissing.length) {
            failures.push(`有行缺少必填字段：${cmissing.join("、")}`);
            savedRows.push(row);
            savedOriginals.push(orig);
            continue;
          }
          try {
            await ctx.adapter.update(child.key, String(row.id), cp);
            savedRows.push(row);
            savedOriginals.push({ ...cp, id: row.id });
            childStateDirty = true;
          } catch (err) {
            failures.push(`有行保存失败：${friendlyErrText(err)}`);
            savedRows.push(row);
            savedOriginals.push(orig);
          }
        }
        for (const orig of originals) {
          if (kept.has(String(orig.id))) continue;
          if (!childCanDelete) {
            // 界面里删了但无 delete 权：不发请求，快照保留该行（删除未生效）
            skippedDeleted++;
            savedOriginals.push(orig);
            continue;
          }
          try {
            await ctx.adapter.remove(child.key, String(orig.id));
            childStateDirty = true;
          } catch (err) {
            failures.push(`有行删除失败：${friendlyErrText(err)}`);
            savedOriginals.push(orig);
          }
        }
        nextChildRows[child.key] = savedRows;
        nextChildOriginal[child.key] = savedOriginals;
        const notes: string[] = [];
        if (skippedChanged)
          notes.push(`${skippedChanged} 行有修改但无修改权限、未保存`);
        if (skippedNew)
          notes.push(`${skippedNew} 行有新增但无新增权限、未保存`);
        if (skippedDeleted)
          notes.push(`${skippedDeleted} 行删除未生效（无删除权限）`);
        notes.push(...failures);
        if (notes.length) childIssues.push(`${child.label}：${notes.join("；")}`);
      }
      if (childIssues.length) {
        if (childStateDirty) {
          setChildRows(nextChildRows);
          setChildOriginal(nextChildOriginal);
        }
        const msg = `主表已保存；以下子表未完全保存——${childIssues.join("；")}`;
        setError(msg);
        ctx.adapter.notify(msg, "error");
        return;
      }
      ctx.adapter.notify("保存成功");
      ctx.adapter.navigate(listRoute);
    } catch (err) {
      setError(friendlyErrText(err));
      ctx.adapter.notify(friendlyErrText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`确认删除这条${entity.label}？此操作不可恢复。`)) return;
    try {
      await ctx.adapter.remove(entity.key, recordId!);
      ctx.adapter.notify("已删除");
      ctx.adapter.navigate(listRoute);
    } catch (err) {
      setError(friendlyErrText(err));
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
    color: tokens.colorTextSecondary,
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
    background: tokens.colorBgContainer,
    border: `1px solid ${tokens.colorBorder}`,
    borderRadius: 12,
    padding: 10,
    marginTop: 20,
    boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
    zIndex: 5,
  };

  // 回填未落提示的可见集（片三）：字段被用户补齐（当前值非空）即不再提示；
  // key 为 null 的（标签无对应字段/明细类）无从按值消解，常驻至下次回填
  const visibleFillMissed = fillMissed.filter(
    (m) =>
      m.key === null ||
      values[m.key] === null ||
      values[m.key] === undefined ||
      values[m.key] === "",
  );

  return (
    <div style={singleMode ? { maxWidth: "100%" } : styles.form}>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {visibleFillMissed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`以下字段未能自动填入，请手动补齐：${visibleFillMissed
            .map((m) => m.label)
            .join("、")}`}
          style={{ marginBottom: 12 }}
        />
      )}
      {fillUnverifiable.length > 0 && (
        <Alert
          type="info"
          showIcon
          message={`以下字段无法自动核对，请手动确认：${fillUnverifiable.join(
            "、",
          )}`}
          style={{ marginBottom: 12 }}
        />
      )}
      {isEdit && node.props?.showId === true && (
        <div style={singleMode ? singleRowStyle : styles.formRow}>
          <div style={singleMode ? singleLabelStyle : styles.label}>ID</div>
          <div style={{ paddingTop: singleMode ? 0 : 5, fontSize: 14 }}>
            {recordId}
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
                linkage={{ entity: entity.key, recordId }}
                readOnly={
                  locked || (rollupActive && f.key === rollupField?.key)
                }
                statusColors={statusColors}
              />
            </div>
          </div>
        );
      })}
      {children.map((child) => {
        // 子实体动作权：与 save() 内对账同一表达式（无 access 时不限制），
        // 界面门控与保存层执法同口径，不再借主表权限近似
        const childActions = ctx.access
          ? ctx.access[child.key]?.actions
          : undefined;
        return (
          <ChildEditor
            key={child.key}
            child={child}
            rows={childRows[child.key] ?? []}
            onChange={(rows) =>
              setChildRows((prev) => ({ ...prev, [child.key]: rows }))
            }
            readOnly={!(isEdit ? canUpdate : canCreate)}
            canCreate={
              !ctx.access || (childActions?.includes("create") ?? false)
            }
            canUpdate={
              !ctx.access || (childActions?.includes("update") ?? false)
            }
            canDelete={
              !ctx.access || (childActions?.includes("delete") ?? false)
            }
            cardMode={singleMode}
            statusColors={statusColors}
          />
        );
      })}
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
    () => resolveViewParams(rawView, ctx.params, ctx.adapter.memberSession?.()?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig, ctx.adapter.memberSession?.()?.id ?? null],
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
          setError(friendlyErrText(err));
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
  if (!entity) return <UnboundSourceAlert />;
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
  const ctx = useRendererCtx();
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
            border: `1px dashed ${tokens.colorBorderControl}`,
            borderRadius: 8,
          }}
        >
          {ctx.design
            ? "图表未配置聚合（在设计器中为图表设置聚合与分组字段）"
            : "图表内容暂不可用"}
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
    () => resolveViewParams(rawView, ctx.params, ctx.adapter.memberSession?.()?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig, ctx.adapter.memberSession?.()?.id ?? null],
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
          setError(friendlyErrText(err));
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
        <LoadingState block />
      ) : series.length === 0 ? (
        <EmptyState />
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
  if (!entity) return <UnboundSourceAlert />;
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
    () => resolveViewParams(rawView, ctx.params, ctx.adapter.memberSession?.()?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawViewSig, paramsSig, ctx.adapter.memberSession?.()?.id ?? null],
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
      setError(friendlyErrText(err));
    } finally {
      setLoading(false);
    }
    // view 的内容已由 viewSig 完整刻画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.adapter, entity, pageIdx, pageSize, viewSig]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!entity) return <UnboundSourceAlert />;

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
        <LoadingState block />
      ) : rows.length === 0 ? (
        <EmptyState description="暂无内容" />
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
  const { publish: publishRecord } = useContext(PageRecordContext);
  const entityKey = entity?.key;
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [govBusy, setGovBusy] = useState(false);
  // 页面记录发布（包二）：本组件是详情页当前行的加载者——挂载/切换记录时先报
  // pending（门控节点暂隐）、行到达后报 ready，卸载时撤下回 absent（兜底口径）。
  // 用 useLayoutEffect 让 pending 在首帧绘制前落地，避免门控按钮以 absent
  // 兜底口径闪现一帧再消失。
  useLayoutEffect(() => {
    if (!entityKey || !id) return;
    publishRecord({ kind: "pending" });
    return () => publishRecord({ kind: "absent" });
  }, [publishRecord, entityKey, id]);
  useLayoutEffect(() => {
    if (row) publishRecord({ kind: "ready", record: row });
  }, [publishRecord, row]);

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
        if (alive) setError(friendlyErrText(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ctx.adapter, entity, id]);

  if (!entity) return <UnboundSourceAlert />;
  if (!id) return <Alert type="info" message="未选择记录（缺少 id 参数）" />;
  if (loading) return <LoadingState block />;
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
  const statusColors = parseStatusColors(node.props?.statusColors);

  // 治理条（第 60 步 R2）：被授予会员侧角色对本实体含 update/delete 时
  // 呈现——update 落在 status 字段的状态切换钮（选项来自实体定义，
  // 如下架/恢复）、delete 为删除钮；无角色/设计态零渲染，执法在服务端
  const gov = ctx.design
    ? new Set<string>()
    : governanceActions(ctx.adapter, entity.key);
  const statusField = entity.fields.find(
    (f) => f.key === "status" && (f.options?.length ?? 0) > 0,
  );
  const govStatusOptions =
    gov.has("update") && statusField && ctx.adapter.memberGovernanceUpdate
      ? (statusField.options ?? []).filter(
          (o) => o.value !== String(row.status ?? ""),
        )
      : [];
  const showGovernance =
    govStatusOptions.length > 0 ||
    (gov.has("delete") && Boolean(ctx.adapter.memberGovernanceRemove));
  const govSetStatus = async (value: string) => {
    if (!ctx.adapter.memberGovernanceUpdate) return;
    setGovBusy(true);
    try {
      const updated = await ctx.adapter.memberGovernanceUpdate(
        entity.key,
        id,
        { status: value },
      );
      setRow(updated);
      ctx.adapter.notify("状态已更新");
    } catch (err) {
      ctx.adapter.notify(friendlyErrText(err), "error");
    } finally {
      setGovBusy(false);
    }
  };
  const govDelete = () => {
    Modal.confirm({
      title: "删除这条记录？",
      content:
        "删除后不可恢复；若仍被其他记录引用（如已有回复的帖子），则无法删除，可先行下架。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await ctx.adapter.memberGovernanceRemove!(entity.key, id);
          ctx.adapter.notify("已删除");
          ctx.adapter.navigate(listRoute ?? "/");
        } catch (err) {
          ctx.adapter.notify(friendlyErrText(err), "error");
          throw err;
        }
      },
    });
  };

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
        {node.props?.showId === true && (
          <Descriptions.Item label="ID">{String(row.id)}</Descriptions.Item>
        )}
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
            ) : f.key === "status" ? (
              <StatusDisplay
                raw={row[f.key]}
                text={formatCellValue(
                  f,
                  row[f.key],
                  f.refEntity ? labels[f.refEntity] : undefined,
                )}
                colors={statusColors}
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
      {showGovernance && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <Typography.Text type="secondary">治理：</Typography.Text>
          {govStatusOptions.map((o) => (
            <Button
              key={o.value}
              size="small"
              loading={govBusy}
              onClick={() => void govSetStatus(o.value)}
            >
              标记为「{o.label ?? o.value}」
            </Button>
          ))}
          {gov.has("delete") && ctx.adapter.memberGovernanceRemove && (
            <Button size="small" danger onClick={govDelete}>
              删除
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 动作按钮：缺省点击后按 props.route 跳转页面。
 * 商城动作（props.action）：
 * - `cart-add`：把当前详情页商品（页面参数 $param.id）加入本地购物车 + 轻提示；
 * - `cart-add-checkout`：加入后按 props.route 直达购物车/结算页（立即购买）。
 * - `order-pay`：对当前详情页订单（$param.id）调适配器 memberPayOrder 发起支付，
 *   拿到 payUrl 后跳转收银台（绝对地址整页跳、站内 hash 路由走适配器导航）；
 * - `order-cancel`：对当前详情页订单调适配器 memberCancelOrder 取消订单，
 *   成功后提示并按 props.route 返回列表。
 * 动作与既有 route 跳转并存：无 action 时行为与此前完全一致。
 */
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
  const action =
    typeof node.props?.action === "string" ? node.props.action : null;

  const addToCart = (goCheckout: boolean) => {
    // 商品 id 取当前详情页的页面参数 id（$param.id 的运行态落点）
    const productId = ctx.params.id;
    if (!productId) {
      ctx.adapter.notify("未找到当前商品，无法加入购物车", "error");
      return;
    }
    cartStore.add(productId, 1);
    ctx.adapter.notify("已加入购物车");
    if (goCheckout && route) ctx.adapter.navigate(route);
  };

  const payOrder = async () => {
    if (ctx.design) {
      ctx.adapter.notify("设计预览：发布后将调会员面发起支付并跳转收银台");
      return;
    }
    // 订单 id 取当前详情页的页面参数 id（与 cart 动作同源）
    const orderId = ctx.params.id;
    if (!orderId) {
      ctx.adapter.notify("未找到当前订单，无法发起支付", "error");
      return;
    }
    if (typeof ctx.adapter.memberPayOrder !== "function") {
      ctx.adapter.notify("当前页面暂不支持在线支付", "error");
      return;
    }
    try {
      const res = await ctx.adapter.memberPayOrder(orderId);
      const payUrl =
        typeof res?.payUrl === "string" && res.payUrl ? res.payUrl : null;
      if (!payUrl) {
        ctx.adapter.notify("未获取到支付地址", "error");
        return;
      }
      if (/^https?:\/\//i.test(payUrl)) {
        // 渠道收银台绝对地址：整页跳转
        window.location.href = payUrl;
      } else if (payUrl.startsWith("/#") || payUrl.startsWith("#")) {
        // 站内 hash 路由形态（/#/pay/sandbox?…）：剥掉前导 /# 或 # 后走适配器导航
        const inner = payUrl.replace(/^\/?#/, "");
        ctx.adapter.navigate(inner.startsWith("/") ? inner : `/${inner}`);
      } else {
        ctx.adapter.navigate(payUrl);
      }
    } catch (err) {
      ctx.adapter.notify(friendlyErrText(err), "error");
    }
  };

  const cancelOrder = async () => {
    if (ctx.design) {
      ctx.adapter.notify("设计预览：发布后将调会员面取消订单");
      return;
    }
    // 订单 id 取当前详情页的页面参数 id（与 cart 动作同源）
    const orderId = ctx.params.id;
    if (!orderId) {
      ctx.adapter.notify("未找到当前订单，无法取消", "error");
      return;
    }
    if (typeof ctx.adapter.memberCancelOrder !== "function") {
      ctx.adapter.notify("当前页面暂不支持取消订单", "error");
      return;
    }
    try {
      await ctx.adapter.memberCancelOrder(orderId);
      ctx.adapter.notify("订单已取消");
      if (route) ctx.adapter.navigate(route);
    } catch (err) {
      ctx.adapter.notify(friendlyErrText(err), "error");
    }
  };

  const onClick =
    action === "cart-add"
      ? () => addToCart(false)
      : action === "cart-add-checkout"
        ? () => addToCart(true)
        : action === "order-pay"
          ? () => void payOrder()
          : action === "order-cancel"
            ? () => void cancelOrder()
            : route
              ? () => ctx.adapter.navigate(route)
              : undefined;
  return (
    <Button type={type} onClick={onClick}>
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
        if (alive) setError(friendlyErrText(err));
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
          {conversationField} 字段展示访客会话全文与转人工摘要，并可将问答整理为
          FAQ 草稿（进知识库待审队列）。
        </Typography.Paragraph>
        <div
          style={{
            background: tokens.colorBgLayout,
            borderRadius: 8,
            padding: "8px 12px",
            color: tokens.colorTextTertiary,
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
          当前页面暂不支持查看客服会话记录。
        </Typography.Text>
      </Card>
    );
  }
  if (!entity) return <UnboundSourceAlert />;
  if (!recordId)
    return <Alert type="info" message="未选择记录（缺少 id 参数）" />;
  if (loading) return <LoadingState block />;
  if (error) return <Alert type="error" message={error} />;
  if (noConversation)
    return <Alert type="info" message="该记录未关联客服会话" />;
  if (!data) return <LoadingState block />;

  const submitFaq = async (question: string, answer: string, msgId: string) => {
    const fn = ctx.adapter.postSupportFaqDraft;
    if (!fn || faqBusyId) return;
    setFaqBusyId(msgId);
    try {
      await fn({ question, answer });
      setFaqDone((prev) => new Set(prev).add(msgId));
      ctx.adapter.notify("已提交为 FAQ 草稿，等待管理台审核");
    } catch (err) {
      ctx.adapter.notify(friendlyErrText(err), "error");
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
              background: tokens.colorWarningBg,
              border: `1px solid ${tokens.colorWarningBorder}`,
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
                    color: tokens.colorTextTertiary,
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
                    background: isVisitor ? tokens.colorPrimary : tokens.colorBgLayout,
                    color: isVisitor ? tokens.colorBgContainer : "inherit",
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
                      存为 FAQ 草稿
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

/** checkout 端点业务错误码 → 中文提示（未知码回落服务端 message，其本身已是中文） */
const CHECKOUT_ERROR_TEXT: Record<string, string> = {
  product_unavailable: "购物车中有商品已下架或不存在，请调整后再提交",
  insufficient_stock: "购物车中有商品库存不足，请减少数量后重试",
  checkout_not_configured: "本应用尚未开启在线下单",
  field_not_writable: "订单包含不可写字段，请联系管理员检查会员策略",
};

/** 取透传在错误对象上的业务码（会员面 fetch 注入 err.code；其余宿主无此字段） */
function memberErrCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : undefined;
}

interface CartLine {
  item: CartItem;
  /** 商品行是否已回（未回时不下失效结论，避免闪烁误标） */
  loaded: boolean;
  row: Row | null;
  /** 有效 = 已回 + 行存在 + 未下架 + 价格可解析；失效行不计入合计、不许结算 */
  valid: boolean;
  invalidReason: string | null;
  name: string;
  price: number;
  coverId?: string;
}

/**
 * 购物车 / 结算（商城线，catalog 第 16 类）：数据绑定 = 商品实体。
 * 条目来自本地购物车 cartStore（只存 id + 数量），商品名称/现价/状态/封面在渲染时
 * 经当前 adapter 现拉——价格以服务端为准的展示口径：variant=checkout 提交时
 * 只报 id + 数量，金额由服务端 checkout 按现价重算并落价快照。
 * 字段按实体约定解析：name（缺省首字段）/ price（缺省首个 decimal）/
 * status（enum，值「下架」判失效，与 checkout 声明 onSaleValue 的对侧口径一致）/
 * cover（file/image）。未登录（适配器无会员会话）时两 variant 都呈登录引导，
 * 入口经 adapter.openMemberLogin 打开宿主的会员登录弹窗（与导航守卫同一弹窗）。
 */
export function CartView({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const variant = node.props?.variant === "checkout" ? "checkout" : "cart";
  const strProp = (k: string): string | undefined =>
    typeof node.props?.[k] === "string" && node.props[k]
      ? (node.props[k] as string)
      : undefined;
  const detailRoute = strProp("detailRoute");
  const checkoutRoute = strProp("checkoutRoute");
  const ordersRoute = strProp("ordersRoute");
  const entity = resolveEntity(ctx, node.binding?.source);

  const [items, setItems] = useState<CartItem[]>(() => cartStore.list());
  useEffect(
    () => cartStore.subscribe(() => setItems(cartStore.list())),
    [],
  );
  const [rowsById, setRowsById] = useState<Record<string, Row | null>>({});
  const [reloadNonce, setReloadNonce] = useState(0);
  const idsSig = items.map((it) => it.productId).join(",");
  const adapterRef = ctx.adapter;
  const entityKey = entity?.key;

  useEffect(() => {
    if (!entityKey || ctx.design) return;
    let alive = true;
    (async () => {
      const ids = idsSig ? idsSig.split(",") : [];
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            return [id, await adapterRef.get(entityKey, id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      if (alive) setRowsById(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [adapterRef, entityKey, idsSig, reloadNonce, ctx.design]);

  const [form] = Form.useForm<{
    contact_name: string;
    contact_phone: string;
    address: string;
    remark?: string;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (ctx.design) {
    return (
      <Card title={variant === "checkout" ? "结算" : "购物车"}>
        <Typography.Paragraph type="secondary">
          购物车组件（绑定商品实体）：发布后按本机购物车条目现拉商品现价与状态，
          下架/不存在的商品标示失效且不计入合计；结算时填写收货信息，提交后
          按现价重新核算金额、扣减库存并生成待支付订单。
        </Typography.Paragraph>
        <div
          style={{
            background: tokens.colorBgLayout,
            borderRadius: 8,
            padding: "8px 12px",
            color: tokens.colorTextTertiary,
            fontSize: 13,
          }}
        >
          （示例）智能手表 X1　¥4,999 × 1　小计 ¥4,999
        </div>
      </Card>
    );
  }
  if (!entity) return <UnboundSourceAlert />;

  const fields = entity.fields;
  const nameField = fields.find((f) => f.key === "name") ?? fields[0];
  const priceField =
    fields.find((f) => f.key === "price") ??
    fields.find((f) => f.type === "decimal");
  const statusField = fields.find(
    (f) => f.key === "status" && f.type === "enum",
  );
  const coverField =
    fields.find(
      (f) => f.key === "cover" && (f.type === "file" || f.type === "image"),
    ) ?? fields.find((f) => f.type === "file" || f.type === "image");

  const lines: CartLine[] = items.map((item) => {
    const loaded = item.productId in rowsById;
    const row = loaded ? (rowsById[item.productId] ?? null) : null;
    const price =
      row && priceField ? Number(row[priceField.key]) : Number.NaN;
    let invalidReason: string | null = null;
    if (loaded && !row) invalidReason = "商品不存在";
    else if (row && statusField && String(row[statusField.key]) === "下架")
      invalidReason = "已下架";
    else if (loaded && row && !Number.isFinite(price))
      invalidReason = "价格异常";
    return {
      item,
      loaded,
      row,
      valid: loaded && !!row && invalidReason === null,
      invalidReason,
      name:
        row && nameField
          ? formatCellValue(nameField, row[nameField.key])
          : item.productId,
      price: Number.isFinite(price) ? price : 0,
      coverId: row && coverField ? parseAssetIds(row[coverField.key])[0] : undefined,
    };
  });
  const validLines = lines.filter((l) => l.valid);
  const total = validLines.reduce(
    (sum, l) => sum + l.price * l.item.quantity,
    0,
  );
  const invalidCount = lines.length - validLines.length;
  const money = fmtAmount;

  const session = ctx.adapter.memberSession?.() ?? null;
  /* 会话门只设在 checkout 变体：本地购物车是访客可达的（内容存本机、单价经
     适配器公开读回），结算才需要会员身份——cart 变体的「去结算」经外壳导航
     守卫引导登录，checkout 页自身再兜一层本门。 */

  const lineRow = (line: CartLine, editable: boolean) => (
    <Card
      key={line.item.productId}
      size="small"
      style={line.valid ? undefined : { opacity: 0.6 }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {line.coverId && (
          <img
            src={ctx.adapter.assetContentUrl(line.coverId)}
            alt=""
            style={{
              width: 64,
              height: 64,
              objectFit: "cover",
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text
            strong
            ellipsis
            style={detailRoute ? { cursor: "pointer" } : undefined}
            onClick={
              detailRoute
                ? () =>
                    ctx.adapter.navigate(
                      `${detailRoute}?id=${encodeURIComponent(line.item.productId)}`,
                    )
                : undefined
            }
          >
            {line.name}
          </Typography.Text>
          {line.invalidReason && (
            <Tag style={{ marginLeft: 8 }}>已失效 · {line.invalidReason}</Tag>
          )}
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              单价 {money(line.price)}
            </Typography.Text>
          </div>
        </div>
        {editable ? (
          <InputNumber
            min={1}
            value={line.item.quantity}
            disabled={!line.valid}
            onChange={(v) => {
              if (typeof v === "number" && v >= 1)
                cartStore.setQty(line.item.productId, v);
            }}
          />
        ) : (
          <Typography.Text>× {line.item.quantity}</Typography.Text>
        )}
        <div style={{ width: 110, textAlign: "right", fontWeight: 600 }}>
          {money(line.price * line.item.quantity)}
        </div>
        {editable && (
          <Button
            type="link"
            danger
            onClick={() => cartStore.remove(line.item.productId)}
          >
            移除
          </Button>
        )}
      </div>
    </Card>
  );

  const invalidAlert =
    invalidCount > 0 ? (
      <Alert
        type="warning"
        showIcon
        message={`${invalidCount} 件商品已失效（下架或不存在），未计入合计，也不能结算`}
        style={{ marginBottom: 12 }}
      />
    ) : null;

  if (variant === "checkout") {
    if (!session) {
      return (
        <div style={{ maxWidth: 520, margin: "32px auto", textAlign: "center" }}>
          <Alert
            type="info"
            showIcon
            message="请先登录会员账号"
            description="登录会员后即可结算下单；购物车内容保存在本机，登录后不会丢失。"
            style={{ marginBottom: 16, textAlign: "left" }}
          />
          {typeof ctx.adapter.openMemberLogin === "function" && (
            <Button
              type="primary"
              onClick={() => ctx.adapter.openMemberLogin!()}
            >
              会员登录
            </Button>
          )}
        </div>
      );
    }
    const submitOrder = async (values: {
      contact_name: string;
      contact_phone: string;
      address: string;
      remark?: string;
    }) => {
      if (typeof ctx.adapter.memberCheckout !== "function") {
        setSubmitError("当前页面暂不支持结算");
        return;
      }
      if (!validLines.length) {
        setSubmitError("购物车中没有可结算的商品");
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        const res = await ctx.adapter.memberCheckout({
          items: validLines.map((l) => ({
            productId: l.item.productId,
            quantity: l.item.quantity,
          })),
          contact_name: values.contact_name.trim(),
          contact_phone: values.contact_phone.trim(),
          address: values.address.trim(),
          remark: values.remark?.trim() || undefined,
        });
        cartStore.clear();
        ctx.adapter.notify("下单成功");
        const orderId = String(res.order.id ?? "");
        if (ordersRoute && orderId) {
          ctx.adapter.navigate(
            `${ordersRoute}?id=${encodeURIComponent(orderId)}`,
          );
        }
      } catch (err) {
        setSubmitError(
          CHECKOUT_ERROR_TEXT[memberErrCode(err) ?? ""] ?? friendlyErrText(err),
        );
        // 商品状态/价格可能已变化：重拉商品行让失效标示与展示价刷新
        setReloadNonce((n) => n + 1);
      } finally {
        setSubmitting(false);
      }
    };
    return (
      <div>
        {invalidAlert}
        {lines.length === 0 ? (
          <EmptyState description="购物车是空的" />
        ) : (
          <>
            <div
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              {lines.map((l) => lineRow(l, false))}
            </div>
            <div style={{ marginTop: 16, marginBottom: 8, textAlign: "right" }}>
              <Typography.Text>
                合计{" "}
                <Typography.Text
                  strong
                  style={{ fontSize: 18, color: tokens.colorDanger }}
                >
                  {money(total)}
                </Typography.Text>
              </Typography.Text>
              <Typography.Text
                type="secondary"
                style={{ display: "block", fontSize: 12 }}
              >
                展示价按商品现价计算，最终金额以提交时重新核算为准
              </Typography.Text>
            </div>
            <Form
              form={form}
              layout="vertical"
              style={{ maxWidth: 560 }}
              onFinish={(v) => void submitOrder(v)}
            >
              <Form.Item
                label="联系人"
                name="contact_name"
                rules={[{ required: true, message: "请填写联系人" }]}
              >
                <Input placeholder="收货人姓名" />
              </Form.Item>
              <Form.Item
                label="联系电话"
                name="contact_phone"
                rules={[{ required: true, message: "请填写联系电话" }]}
              >
                <Input placeholder="手机号码" />
              </Form.Item>
              <Form.Item
                label="收货地址"
                name="address"
                rules={[{ required: true, message: "请填写收货地址" }]}
              >
                <Input.TextArea rows={2} placeholder="省 / 市 / 区 + 详细地址" />
              </Form.Item>
              <Form.Item label="备注" name="remark">
                <Input.TextArea rows={2} placeholder="选填" />
              </Form.Item>
              {submitError && (
                <Alert
                  type="error"
                  message={submitError}
                  style={{ marginBottom: 12 }}
                />
              )}
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                disabled={validLines.length === 0}
              >
                提交订单
              </Button>
            </Form>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {invalidAlert}
      {lines.length === 0 ? (
        <EmptyState description="购物车是空的" />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {lines.map((l) => lineRow(l, true))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 16,
              marginTop: 16,
            }}
          >
            <Typography.Text>
              合计{" "}
              <Typography.Text strong style={{ fontSize: 18, color: tokens.colorDanger }}>
                {money(total)}
              </Typography.Text>
            </Typography.Text>
            {checkoutRoute && (
              <Button
                type="primary"
                disabled={validLines.length === 0}
                onClick={() => ctx.adapter.navigate(checkoutRoute)}
              >
                去结算
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 内置组件注册表（注册中心 v1：布局/数据/内容/动作/智能共 15 类组件，含 M9 的 Chart、M10 的 ContentList 与商城线 CartView） */
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
  registerComponent(registry, "CartView", CartView);
  return registry;
}

/**
 * 节点渲染入口：先过 visibleWhen 门控再进实际渲染（NodeViewBody）。
 * 门控口径（呈现层治理·包二）：节点未声明/声明非法、或处于设计态时不门控（原行为）；
 * 本页无记录发布者（absent）时不门控；记录未就绪（pending）时先隐藏，防错误动作闪现；
 * 记录就绪后按 eq/in 求值决定显隐。门控组件单独消费记录上下文，
 * 使未声明门控的节点不因记录发布而额外重渲染。
 */
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
  const gate = ctx.design ? null : parseVisibleWhen(node.props?.visibleWhen);
  if (gate) {
    return (
      <GatedNodeView gate={gate} node={node} registry={registry} isRoot={isRoot} />
    );
  }
  return <NodeViewBody node={node} registry={registry} isRoot={isRoot} />;
}

function GatedNodeView({
  gate,
  node,
  registry,
  isRoot,
}: {
  gate: VisibleWhen;
  node: ComponentNode;
  registry: ComponentRegistry;
  isRoot?: boolean;
}) {
  const { state } = useContext(PageRecordContext);
  if (state.kind === "pending") return null;
  if (state.kind === "ready" && !evalVisibleWhen(gate, state.record)) {
    return null;
  }
  return <NodeViewBody node={node} registry={registry} isRoot={isRoot} />;
}

function NodeViewBody({
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
          ? { outline: `2px solid ${tokens.colorPrimary}`, outlineOffset: 1 }
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
    const md = mt.density === "compact" ? mobileDensity.compact : mobileDensity.comfortable;
    const vars = {
      [mobileVars.touchMin]: `${mt.touchMinPx}px`,
      [mobileVars.fontScale]: String(mt.fontScale),
      [mobileVars.controlH]: md.controlH,
      [mobileVars.cardPad]: md.cardPad,
      [mobileVars.rowMinH]: md.rowMinH,
      fontSize: 14 * mt.fontScale,
    } as CSSProperties;
    return (
      <PageRecordProvider>
        <RendererContext.Provider
          value={{ adapter, dataSchema, page, params, device, access, design, theme }}
        >
          <div style={vars}>{tree}</div>
        </RendererContext.Provider>
      </PageRecordProvider>
    );
  }
  return (
    <PageRecordProvider>
      <RendererContext.Provider
        value={{ adapter, dataSchema, page, params, device, access, design, theme }}
      >
        {tree}
      </RendererContext.Provider>
    </PageRecordProvider>
  );
}
