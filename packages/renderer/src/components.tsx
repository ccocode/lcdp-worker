import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  ComponentNode,
  DataView,
  Entity,
  Field,
  NodeLayout,
  PageSchema,
} from "@naka1205/schema";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Space,
  Statistic,
  Table,
  Tabs as AntdTabs,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import dayjs from "dayjs";
import type {
  RendererContextValue,
  Row,
  RuntimeAdapter,
} from "./adapter.js";
import { childEntities, resolveEntity } from "./adapter.js";
import { FieldInput } from "./fields.js";
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
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    default:
      return String(value);
  }
}

/** 数据视图中可经适配器下发的等值过滤（其余算子暂不在此层下发） */
export function eqFiltersOf(view: DataView | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of view?.filters ?? []) {
    if (f.op === "eq" && f.value !== null && f.value !== undefined) {
      out[f.field] = String(f.value);
    }
  }
  return out;
}

/** 取节点在当前设备上的布局变体 */
function layoutFor(
  node: ComponentNode,
  device: "desktop" | "mobile",
): NodeLayout | undefined {
  return node.layout?.[device];
}

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
  const view = node.binding?.view;
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

  // 数据视图签名（内容变化才重拉）：eq 过滤与第一排序项经适配器下发服务端
  const viewSig = JSON.stringify(view ?? null);
  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setError(null);
    try {
      const filters = eqFiltersOf(view);
      const firstSort = view?.sort?.[0];
      const res = await ctx.adapter.list(entity.key, {
        limit: pageSize,
        offset: pageIdx * pageSize,
        filters: Object.keys(filters).length ? filters : undefined,
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
      render: (_: unknown, row: Row) => cellText(row, f),
    })),
  ];

  // 权限门控：宿主透传了 access 且本实体无 create 动作时隐藏新建按钮（服务端仍为权威强制）
  const canCreate =
    !ctx.access ||
    (ctx.access[entity.key]?.actions.includes("create") ?? false);

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        {formRoute && canCreate && (
          <Button
            type="primary"
            onClick={() => ctx.adapter.navigate(formRoute)}
          >
            新建{entity.label}
          </Button>
        )}
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
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
}: {
  child: Entity;
  rows: Row[];
  onChange: (rows: Row[]) => void;
}) {
  const ctx = useRendererCtx();
  const fields = child.fields.filter((f) => f.key !== child.parentField);
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
            <th style={styles.childTh}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {fields.map((f) => (
                <td key={f.key} style={styles.childTd}>
                  <FieldInput
                    field={f}
                    value={row[f.key]}
                    onChange={(v) => updateRow(idx, f.key, v)}
                    adapter={ctx.adapter}
                    inChild
                    readOnly={f.key === "amount" && hasAmount}
                  />
                </td>
              ))}
              <td style={styles.childTd}>
                <Button
                  size="small"
                  onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                >
                  删除
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <Button onClick={() => onChange([...rows, {}])}>
          添加{child.label}
        </Button>
      </div>
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
  const children = entity ? childEntities(ctx.dataSchema, entity.key) : [];
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

  return (
    <div style={styles.form}>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      {isEdit && (
        <div style={styles.formRow}>
          <div style={styles.label}>ID</div>
          <div style={{ paddingTop: 5, fontSize: 14 }}>{id}</div>
        </div>
      )}
      {entity.fields.map((f) => {
        // 权限门控：hidden 字段不渲染；readonly/masked 渲染为禁用控件（masked 值已由服务端脱敏，原样展示）
        const fieldAccess = ctx.access?.[entity.key]?.fields?.[f.key];
        if (fieldAccess === "hidden") return null;
        const locked = fieldAccess === "readonly" || fieldAccess === "masked";
        return (
          <div key={f.key} style={styles.formRow}>
            <div style={styles.label}>
              {f.label}
              {f.required && <span style={styles.required}> *</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <FieldInput
                field={f}
                value={values[f.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                adapter={ctx.adapter}
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
        />
      ))}
      <div style={{ ...styles.toolbar, marginTop: 20 }}>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button onClick={() => ctx.adapter.navigate(listRoute)}>
          返回列表
        </Button>
        <div style={styles.spacer} />
        {isEdit && (
          <Button danger onClick={() => void remove()}>
            删除
          </Button>
        )}
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
 * 聚合数值取数（StatCard / ChartPlaceholder 共用）：
 * 实体经 binding.source 解析，过滤取数据视图的 eq 项，fn 缺省时按 fallbackCount 决定是否计数。
 */
function useAggregateValue(
  node: ComponentNode,
  fallbackCount: boolean,
): { entity: Entity | null; value: number | null; error: string | null } {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const view = node.binding?.view;
  const fn = view?.aggregate?.fn ?? (fallbackCount ? "count" : undefined);
  const field = view?.aggregate?.field;
  const filtersSig = JSON.stringify(eqFiltersOf(view));
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!entity || !fn) return;
    let alive = true;
    setError(null);
    ctx.adapter
      .aggregate(entity.key, {
        fn,
        field,
        filters: JSON.parse(filtersSig) as Record<string, string>,
      })
      .then((v) => {
        if (alive) {
          setValue(v);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive) setError(errText(err));
      });
    return () => {
      alive = false;
    };
  }, [ctx.adapter, entity, fn, field, filtersSig]);
  return { entity, value, error };
}

/** 统计卡片：聚合数值大字展示（计数/求和/平均，缺省计数） */
export function StatCard({ node }: NodeProps) {
  const { entity, value, error } = useAggregateValue(node, true);
  const title =
    typeof node.props?.title === "string"
      ? node.props.title
      : (entity?.label ?? "统计");
  const suffix =
    typeof node.props?.suffix === "string" ? node.props.suffix : undefined;
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

/** 图表占位：图表引擎后续接入；已声明聚合时先展示聚合数值 */
export function ChartPlaceholder({ node }: NodeProps) {
  const hasAggregate = Boolean(node.binding?.view?.aggregate);
  const { entity, value, error } = useAggregateValue(node, false);
  const title =
    typeof node.props?.title === "string" ? node.props.title : "图表";
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
          图表占位（图表组件将在后续里程碑接入）
        </div>
      )}
    </Card>
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
            {formatCellValue(
              f,
              row[f.key],
              f.refEntity ? labels[f.refEntity] : undefined,
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

/** 智能助手占位：运行态 Agent 在后续里程碑接入，先占位保证页面可引用 */
export function AgentChat({ node }: NodeProps) {
  const title =
    typeof node.props?.title === "string" ? node.props.title : "智能助手";
  return (
    <Card title={title}>
      <Typography.Paragraph type="secondary">
        运行态智能助手将在后续里程碑接入
      </Typography.Paragraph>
      <Input disabled placeholder="输入问题或业务指令…" />
    </Card>
  );
}

/** 内置组件注册表（注册中心 v1：布局/数据/内容/动作/智能共 12 类组件） */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = createRegistry();
  registerComponent(registry, "Page", Page);
  registerComponent(registry, "Container", Container);
  registerComponent(registry, "Tabs", Tabs);
  registerComponent(registry, "DataTable", DataTable);
  registerComponent(registry, "EntityForm", EntityForm);
  registerComponent(registry, "Detail", Detail);
  registerComponent(registry, "StatCard", StatCard);
  registerComponent(registry, "ChartPlaceholder", ChartPlaceholder);
  registerComponent(registry, "TextBlock", TextBlock);
  registerComponent(registry, "Image", ImageBlock);
  registerComponent(registry, "Button", ActionButton);
  registerComponent(registry, "AgentChat", AgentChat);
  return registry;
}

function NodeView({
  node,
  registry,
}: {
  node: ComponentNode;
  registry: ComponentRegistry;
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
  registry,
}: SchemaRendererProps) {
  const reg = registry ?? createDefaultRegistry();
  return (
    <RendererContext.Provider
      value={{ adapter, dataSchema, page, params, device, access, design }}
    >
      <NodeView node={page.root} registry={reg} />
    </RendererContext.Provider>
  );
}
