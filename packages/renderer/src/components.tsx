import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { ComponentNode, Entity, PageSchema } from "@naka1205/schema";
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

/** 页面布局：标题 + 子组件纵向排列 */
export function Page({ node, children }: NodeProps) {
  const title =
    typeof node.props?.title === "string" ? node.props.title : undefined;
  return (
    <div style={styles.page}>
      {title && <div style={styles.title}>{title}</div>}
      {children}
    </div>
  );
}

/** 数据表格：按绑定实体分页拉取，引用字段显示关联记录的标签，敏感字段由服务端脱敏 */
export function DataTable({ node }: NodeProps) {
  const ctx = useRendererCtx();
  const entity = resolveEntity(ctx, node.binding?.source);
  const pageSize =
    typeof node.props?.pageSize === "number" ? node.props.pageSize : 20;
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

  const load = useCallback(async () => {
    if (!entity) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ctx.adapter.list(entity.key, {
        limit: pageSize,
        offset: pageIdx * pageSize,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  }, [ctx.adapter, entity, pageIdx, pageSize]);

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
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [ctx.adapter, refEntitiesKey]);

  if (!entity) return <div style={styles.error}>数据源未绑定实体</div>;
  const columns = entity.fields.slice(0, 7);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const cellText = (row: Row, field: (typeof columns)[number]): string => {
    const v = row[field.key];
    if (v === null || v === undefined || v === "") return "—";
    if (field.type === "boolean") return v === true ? "是" : "否";
    if (field.type === "ref" && field.refEntity) {
      return labels[field.refEntity]?.[String(v)] ?? String(v);
    }
    return String(v);
  };

  return (
    <div>
      <div style={styles.toolbar}>
        {formRoute && (
          <button
            style={styles.btnPrimary}
            onClick={() => ctx.adapter.navigate(formRoute)}
          >
            新建{entity.label}
          </button>
        )}
        <button style={styles.btn} onClick={() => void load()}>
          刷新
        </button>
        <div style={styles.spacer} />
        {loading && <span style={{ color: "#6b7280" }}>加载中…</span>}
      </div>
      {error && <div style={styles.error}>{error}</div>}
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>ID</th>
            {columns.map((f) => (
              <th key={f.key} style={styles.th}>
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row.id)}
              style={formRoute ? styles.rowHover : undefined}
              onClick={() => {
                if (formRoute) {
                  ctx.adapter.navigate(
                    `${formRoute}?id=${encodeURIComponent(String(row.id))}`,
                  );
                }
              }}
            >
              <td style={styles.td}>{String(row.id)}</td>
              {columns.map((f) => (
                <td key={f.key} style={styles.td}>
                  {cellText(row, f)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td style={styles.td} colSpan={columns.length + 1}>
                <div style={styles.empty}>暂无数据</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={styles.pager}>
        <span>
          共 {total} 条 · 第 {pageIdx + 1} / {pageCount} 页
        </span>
        <button
          style={styles.btn}
          disabled={pageIdx <= 0}
          onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
        >
          上一页
        </button>
        <button
          style={styles.btn}
          disabled={pageIdx + 1 >= pageCount}
          onClick={() => setPageIdx((p) => p + 1)}
        >
          下一页
        </button>
      </div>
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
                <button
                  style={styles.btn}
                  onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button style={styles.btn} onClick={() => onChange([...rows, {}])}>
          添加{child.label}
        </button>
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

  if (!entity) return <div style={styles.error}>数据源未绑定实体</div>;
  if (loading) return <div style={styles.empty}>加载中…</div>;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(entity, values);
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
      {error && <div style={styles.error}>{error}</div>}
      {isEdit && (
        <div style={styles.formRow}>
          <div style={styles.label}>ID</div>
          <div style={{ paddingTop: 7, fontSize: 14 }}>{id}</div>
        </div>
      )}
      {entity.fields.map((f) => (
        <div key={f.key} style={styles.formRow}>
          <div style={styles.label}>
            {f.label}
            {f.required && <span style={styles.required}> *</span>}
          </div>
          <FieldInput
            field={f}
            value={values[f.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            adapter={ctx.adapter}
          />
        </div>
      ))}
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
        <button style={styles.btnPrimary} disabled={saving} onClick={() => void save()}>
          {saving ? "保存中…" : "保存"}
        </button>
        <button style={styles.btn} onClick={() => ctx.adapter.navigate(listRoute)}>
          返回列表
        </button>
        <div style={styles.spacer} />
        {isEdit && (
          <button style={styles.btnDanger} onClick={() => void remove()}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}

/** 内置组件注册表（Page 布局 + DataTable + EntityForm） */
export function createDefaultRegistry(): ComponentRegistry {
  const registry = createRegistry();
  registerComponent(registry, "Page", Page);
  registerComponent(registry, "DataTable", DataTable);
  registerComponent(registry, "EntityForm", EntityForm);
  return registry;
}

function NodeView({
  node,
  registry,
}: {
  node: ComponentNode;
  registry: ComponentRegistry;
}) {
  const Comp = registry.get(node.type);
  if (!Comp) {
    return <div style={styles.error}>未注册的组件类型：{node.type}</div>;
  }
  return (
    <Comp node={node}>
      {node.children?.map((child) => (
        <NodeView key={child.id} node={child} registry={registry} />
      ))}
    </Comp>
  );
}

export interface SchemaRendererProps {
  page: PageSchema;
  dataSchema: RendererContextValue["dataSchema"];
  adapter: RuntimeAdapter;
  /** 页面参数（如表单页的 id 来自 ?id=） */
  params?: Record<string, string>;
  /** 自定义注册表（默认内置三件套；设计器可注入更多组件） */
  registry?: ComponentRegistry;
}

/** 渲染入口：按 PageSchema.root 递归渲染组件树 */
export function SchemaRenderer({
  page,
  dataSchema,
  adapter,
  params = {},
  registry,
}: SchemaRendererProps) {
  const reg = registry ?? createDefaultRegistry();
  return (
    <RendererContext.Provider value={{ adapter, dataSchema, page, params }}>
      <NodeView node={page.root} registry={reg} />
    </RendererContext.Provider>
  );
}
