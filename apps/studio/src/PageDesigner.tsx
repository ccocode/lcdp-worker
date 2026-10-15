import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tree,
  Typography,
  message as antdMessage,
} from "antd";
import type { TreeDataNode } from "antd";
import { SchemaRenderer, componentCatalog } from "@lcdp/renderer";
import type {
  ComponentNode,
  DataSchema,
  DataView,
  Entity,
  NodeLayout,
  PageSchema,
} from "@naka1205/schema";
import type { FragmentDef } from "./api.js";
import { makePreviewAdapter } from "./api.js";

/**
 * 页面设计器（M3）：页管理 + 物料/画布/属性三栏 + 双设备布局变体 + 片段。
 * 画布即运行态渲染器（design 模式：点选节点、真实数据只读预览）；
 * 所有改动只更新本地设计包状态（经 onPagesChange 上抛），保存/发布走设计器统一按钮。
 */

type CatalogItem = (typeof componentCatalog)[number];
type Device = "desktop" | "mobile";

const DATA_TYPES = ["DataTable", "EntityForm", "Detail", "StatCard", "ChartPlaceholder"];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let nodeSeq = 0;
function genNodeId(existing: Set<string>): string {
  let id = "";
  do {
    nodeSeq += 1;
    id = `n-${nodeSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  } while (existing.has(id));
  existing.add(id);
  return id;
}

function collectIds(node: ComponentNode, into = new Set<string>()): Set<string> {
  into.add(node.id);
  for (const c of node.children ?? []) collectIds(c, into);
  return into;
}

function findNode(node: ComponentNode, id: string): ComponentNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

function findParent(
  node: ComponentNode,
  id: string,
): { parent: ComponentNode; index: number } | null {
  const children = node.children ?? [];
  const idx = children.findIndex((c) => c.id === id);
  if (idx >= 0) return { parent: node, index: idx };
  for (const c of children) {
    const hit = findParent(c, id);
    if (hit) return hit;
  }
  return null;
}

/** 插入点：选中 Page/Container → 其子级末尾；选中普通节点 → 同级之后；未选中 → 根子级末尾 */
function insertAtPoint(
  root: ComponentNode,
  selectedId: string | null,
  newNode: ComponentNode,
): void {
  const sel = selectedId ? findNode(root, selectedId) : null;
  if (sel && (sel.type === "Page" || sel.type === "Container")) {
    sel.children = [...(sel.children ?? []), newNode];
    return;
  }
  if (sel) {
    const loc = findParent(root, sel.id);
    if (loc?.parent.children) {
      loc.parent.children.splice(loc.index + 1, 0, newNode);
      return;
    }
  }
  root.children = [...(root.children ?? []), newNode];
}

/** 深拷贝节点并为整棵子树换新 id（复制/片段插入用） */
function reIdTree(node: ComponentNode, existing: Set<string>): ComponentNode {
  const copy = clone(node);
  const walk = (n: ComponentNode) => {
    n.id = genNodeId(existing);
    for (const c of n.children ?? []) walk(c);
  };
  walk(copy);
  return copy;
}

function toTreeData(node: ComponentNode): TreeDataNode {
  return {
    key: node.id,
    title: `${node.type} · ${node.id}`,
    children: (node.children ?? []).map(toTreeData),
  };
}

export interface PageDesignerProps {
  appId: string;
  data: DataSchema;
  pages: PageSchema[] | null;
  fragments: FragmentDef[] | null;
  onPagesChange: (pages: PageSchema[] | null) => void;
  onFragmentsChange: (fragments: FragmentDef[] | null) => void;
}

export default function PageDesigner({
  appId,
  data,
  pages,
  fragments,
  onPagesChange,
  onFragmentsChange,
}: PageDesignerProps) {
  const pagesArr = useMemo(() => pages ?? [], [pages]);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [genEntityKey, setGenEntityKey] = useState<string | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageRoute, setNewPageRoute] = useState("");
  const [fragOpen, setFragOpen] = useState(false);
  const [fragName, setFragName] = useState("");

  const adapter = useMemo(() => makePreviewAdapter(appId), [appId]);

  // ---- 撤销/重做（对 pages 数组的历史栈，深度 50；切页不清空） ----
  const pastRef = useRef<PageSchema[][]>([]);
  const futureRef = useRef<PageSchema[][]>([]);
  const [, setHistTick] = useState(0);
  const applyPages = (next: PageSchema[]) => {
    pastRef.current.push(clone(pagesArr));
    if (pastRef.current.length > 50) pastRef.current.shift();
    futureRef.current = [];
    onPagesChange(next);
    setHistTick((t) => t + 1);
  };
  const undo = () => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(clone(pagesArr));
    onPagesChange(prev);
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const nxt = futureRef.current.pop();
    if (!nxt) return;
    pastRef.current.push(clone(pagesArr));
    onPagesChange(nxt);
    setHistTick((t) => t + 1);
  };

  const currentPage: PageSchema | null =
    pagesArr.find((p) => p.id === selectedPageId) ?? pagesArr[0] ?? null;
  const selectedNode: ComponentNode | null =
    currentPage && selectedNodeId
      ? findNode(currentPage.root, selectedNodeId)
      : null;

  const topEntities = useMemo(
    () => data.entities.filter((e) => !e.parentField),
    [data],
  );
  const undesigned = useMemo(() => {
    const covered = new Set<string>();
    for (const p of pagesArr)
      for (const ds of p.dataSources)
        if (ds.kind === "entity") covered.add(ds.ref);
    return topEntities.filter((e) => !covered.has(e.key));
  }, [pagesArr, topEntities]);

  /** 全部可选路由（设计页 + 全部顶层实体的派生页），供跳转/表单路由选择 */
  const routeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pagesArr) seen.set(p.route, `${p.route}（${p.name}）`);
    for (const e of topEntities) {
      if (!seen.has(`/e/${e.key}`)) seen.set(`/e/${e.key}`, `/e/${e.key}（${e.label}列表·派生）`);
      if (!seen.has(`/e/${e.key}/form`))
        seen.set(`/e/${e.key}/form`, `/e/${e.key}/form（${e.label}表单·派生）`);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [pagesArr, topEntities]);

  // ---------------------------------------------------------- 页面级变更
  const mutatePage = (fn: (page: PageSchema) => void) => {
    if (!currentPage) return;
    const next = clone(pagesArr);
    const target = next.find((p) => p.id === currentPage.id);
    if (!target) return;
    fn(target);
    target.updatedAt = new Date().toISOString();
    applyPages(next);
  };
  const mutateNode = (nodeId: string, fn: (node: ComponentNode) => void) =>
    mutatePage((page) => {
      const n = findNode(page.root, nodeId);
      if (n) fn(n);
    });

  const generateFromEntity = (entity: Entity) => {
    const listId = `${appId}:page:${entity.key}:list`;
    const formId = `${appId}:page:${entity.key}:form`;
    if (pagesArr.some((p) => p.id === listId || p.id === formId)) {
      void antdMessage.warning(`实体「${entity.label}」已有设计页`);
      return;
    }
    if (
      pagesArr.some(
        (p) => p.route === `/e/${entity.key}` || p.route === `/e/${entity.key}/form`,
      )
    ) {
      void antdMessage.warning(`路由 /e/${entity.key} 已被其他设计页占用`);
      return;
    }
    const now = new Date().toISOString();
    const base = {
      version: 1,
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
      kind: "page" as const,
      params: [] as PageSchema["params"],
      dataSources: [{ key: entity.key, kind: "entity" as const, ref: entity.key }],
    };
    const listPage: PageSchema = {
      ...base,
      id: listId,
      name: `${entity.label}列表`,
      route: `/e/${entity.key}`,
      menu: { label: entity.label },
      root: {
        id: "root",
        type: "Page",
        props: { title: entity.label },
        children: [
          {
            id: "table",
            type: "DataTable",
            binding: { source: entity.key },
            props: { formRoute: `/e/${entity.key}/form`, pageSize: 20 },
          },
        ],
      },
    };
    const formPage: PageSchema = {
      ...base,
      id: formId,
      name: `${entity.label}表单`,
      route: `/e/${entity.key}/form`,
      root: {
        id: "root",
        type: "Page",
        props: { title: entity.label },
        children: [
          {
            id: "form",
            type: "EntityForm",
            binding: { source: entity.key },
            props: { listRoute: `/e/${entity.key}` },
          },
        ],
      },
    };
    applyPages([...pagesArr, listPage, formPage]);
    setSelectedPageId(listId);
    setSelectedNodeId(null);
    void antdMessage.success(`已生成「${entity.label}」列表页与表单页`);
  };

  const createCustomPage = () => {
    const name = newPageName.trim();
    if (!name) {
      void antdMessage.warning("请填写页面名称");
      return;
    }
    let route = newPageRoute.trim();
    if (!route) {
      void antdMessage.warning("请填写路由 slug");
      return;
    }
    if (!route.startsWith("/")) route = `/${route}`;
    if (pagesArr.some((p) => p.route === route)) {
      void antdMessage.warning(`路由 ${route} 已存在`);
      return;
    }
    const slug =
      route.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      "custom";
    let id = `${appId}:page:${slug}`;
    let n = 2;
    while (pagesArr.some((p) => p.id === id)) {
      id = `${appId}:page:${slug}-${n}`;
      n += 1;
    }
    const now = new Date().toISOString();
    const page: PageSchema = {
      id,
      name,
      kind: "page",
      version: 1,
      formatVersion: 1,
      createdAt: now,
      updatedAt: now,
      route,
      params: [],
      dataSources: [],
      root: { id: "root", type: "Page", props: { title: name }, children: [] },
    };
    applyPages([...pagesArr, page]);
    setSelectedPageId(id);
    setSelectedNodeId(null);
    setNewPageOpen(false);
    setNewPageName("");
    setNewPageRoute("");
  };

  const deletePage = (page: PageSchema) => {
    applyPages(pagesArr.filter((p) => p.id !== page.id));
    if (selectedPageId === page.id) setSelectedPageId(null);
    setSelectedNodeId(null);
  };

  // ---------------------------------------------------------- 节点级变更
  /** 插入节点并处理数据组件的默认绑定：有现成实体数据源则复用，否则保持未绑定（属性面板提示） */
  const insertNode = (raw: ComponentNode) => {
    if (!currentPage) {
      void antdMessage.warning("先选择或新建一张页面");
      return;
    }
    let insertedId: string | null = null;
    mutatePage((page) => {
      const node = raw;
      if (DATA_TYPES.includes(node.type)) {
        const firstEntity = page.dataSources.find((ds) => ds.kind === "entity");
        if (node.binding && !node.binding.source) {
          if (firstEntity) node.binding.source = firstEntity.key;
          else delete node.binding;
        } else if (!node.binding && firstEntity) {
          node.binding = { source: firstEntity.key };
        }
      }
      insertAtPoint(page.root, selectedNodeId, node);
      insertedId = node.id;
    });
    if (insertedId) setSelectedNodeId(insertedId);
  };

  const insertCatalogItem = (item: CatalogItem) => {
    if (!currentPage) {
      void antdMessage.warning("先选择或新建一张页面");
      return;
    }
    const existing = collectIds(currentPage.root);
    insertNode(item.make(genNodeId(existing)));
  };

  const insertFragment = (frag: FragmentDef) => {
    if (!currentPage) {
      void antdMessage.warning("先选择或新建一张页面");
      return;
    }
    const existing = collectIds(currentPage.root);
    insertNode(reIdTree(frag.root, existing));
  };

  const patchProps = (nodeId: string, patch: Record<string, unknown>) =>
    mutateNode(nodeId, (n) => {
      const props: Record<string, unknown> = { ...(n.props ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete props[k];
        else props[k] = v;
      }
      n.props = props;
    });

  const patchLayout = (nodeId: string, patch: Partial<NodeLayout>) =>
    mutateNode(nodeId, (n) => {
      const cur: NodeLayout = { ...(n.layout?.[device] ?? {}) };
      for (const [k, v] of Object.entries(patch) as [keyof NodeLayout, unknown][]) {
        if (v === undefined) delete cur[k];
        else (cur as Record<string, unknown>)[k] = v;
      }
      const layout = { ...(n.layout ?? {}) };
      if (Object.keys(cur).length === 0) delete layout[device];
      else layout[device] = cur;
      if (Object.keys(layout).length === 0) delete n.layout;
      else n.layout = layout;
    });

  const patchView = (nodeId: string, patch: Partial<DataView>) =>
    mutateNode(nodeId, (n) => {
      if (!n.binding?.source) return;
      const view: DataView = { ...(n.binding.view ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (view as Record<string, unknown>)[k];
        else (view as Record<string, unknown>)[k] = v;
      }
      n.binding = { ...n.binding, view };
    });

  /** 选数据源实体：确保页面声明该数据源，并把节点绑定指向它 */
  const bindEntity = (nodeId: string, entityKey: string) =>
    mutatePage((page) => {
      if (!page.dataSources.some((ds) => ds.key === entityKey)) {
        page.dataSources.push({ key: entityKey, kind: "entity", ref: entityKey });
      }
      const n = findNode(page.root, nodeId);
      if (n) n.binding = { ...(n.binding ?? {}), source: entityKey };
    });

  const boundEntity = (page: PageSchema, node: ComponentNode): Entity | null => {
    const src = node.binding?.source;
    if (!src) return null;
    const ds = page.dataSources.find((d) => d.key === src);
    const key = ds?.ref ?? src;
    return data.entities.find((e) => e.key === key) ?? null;
  };

  const moveNode = (nodeId: string, dir: -1 | 1) =>
    mutatePage((page) => {
      const loc = findParent(page.root, nodeId);
      if (!loc?.parent.children) return;
      const j = loc.index + dir;
      if (j < 0 || j >= loc.parent.children.length) return;
      const arr = loc.parent.children;
      const tmp = arr[loc.index]!;
      arr[loc.index] = arr[j]!;
      arr[j] = tmp;
    });

  const deleteNode = (nodeId: string) =>
    mutatePage((page) => {
      const loc = findParent(page.root, nodeId);
      if (loc?.parent.children) loc.parent.children.splice(loc.index, 1);
    });

  const copyNode = (node: ComponentNode) =>
    mutatePage((page) => {
      const loc = findParent(page.root, node.id);
      if (!loc?.parent.children) return;
      const existing = collectIds(page.root);
      const copy = reIdTree(node, existing);
      loc.parent.children.splice(loc.index + 1, 0, copy);
      setSelectedNodeId(copy.id);
    });

  const saveAsFragment = () => {
    if (!selectedNode) return;
    const name = fragName.trim();
    if (!name) {
      void antdMessage.warning("请填写片段名称");
      return;
    }
    const def: FragmentDef = {
      id: `frag-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
      name,
      root: clone(selectedNode),
    };
    onFragmentsChange([...(fragments ?? []), def]);
    setFragOpen(false);
    setFragName("");
    void antdMessage.success(`片段「${name}」已保存，可从片段区插入任意页面`);
  };

  // ---------------------------------------------------------- 物料分组
  const catalogGroups = useMemo(() => {
    const groups = new Map<string, CatalogItem[]>();
    for (const item of componentCatalog) {
      const arr = groups.get(item.category) ?? [];
      arr.push(item);
      groups.set(item.category, arr);
    }
    return [...groups.entries()];
  }, []);

  // ---------------------------------------------------------- 属性编辑器
  const fieldOptions = (entity: Entity | null) =>
    (entity?.fields ?? []).map((f) => ({
      value: f.key,
      label: `${f.label}（${f.key}）`,
    }));

  /** 数据源选择（数据类组件共用）：选中实体即确保页面声明数据源并完成绑定 */
  const renderSourceSelect = (node: ComponentNode) => (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
        数据源（实体）
      </Typography.Text>
      {!node.binding?.source && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message="未绑定数据源"
          description="请选择数据实体完成绑定；未绑定的数据组件在页面上没有数据。"
        />
      )}
      <Select
        style={{ width: "100%" }}
        placeholder="选择数据实体"
        value={node.binding?.source}
        onChange={(v) => bindEntity(node.id, v)}
        options={data.entities.map((e) => ({
          value: e.key,
          label: `${e.label}（${e.key}）`,
        }))}
      />
    </div>
  );

  /** 数据视图编辑：过滤行（eq 语义）+ 排序第一项 */
  const renderViewEditors = (node: ComponentNode, entity: Entity | null) => {
    if (!entity || !node.binding?.source) return null;
    const view = node.binding.view ?? {};
    const filters = view.filters ?? [];
    const writeFilters = (next: typeof filters) =>
      patchView(node.id, { filters: next.length > 0 ? next : undefined });
    const sortField = view.sort?.[0]?.field;
    const sortDir = view.sort?.[0]?.dir ?? "asc";
    return (
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
          数据视图（过滤 / 排序）
        </Typography.Text>
        {filters.map((f, i) => (
          <Space key={i} size={6} style={{ display: "flex", marginBottom: 6 }}>
            <Select
              style={{ width: 130 }}
              value={f.field || undefined}
              placeholder="字段"
              onChange={(v) =>
                writeFilters(
                  filters.map((x, j) => (j === i ? { ...x, field: v } : x)),
                )
              }
              options={fieldOptions(entity)}
            />
            <Input
              style={{ flex: 1 }}
              placeholder="等于该值"
              defaultValue={f.value == null ? "" : String(f.value)}
              key={`${node.id}-f-${i}-${String(f.value ?? "")}`}
              onBlur={(ev) =>
                writeFilters(
                  filters.map((x, j) =>
                    j === i ? { ...x, op: "eq" as const, value: ev.target.value } : x,
                  ),
                )
              }
            />
            <Button
              size="small"
              danger
              onClick={() => writeFilters(filters.filter((_, j) => j !== i))}
            >
              删
            </Button>
          </Space>
        ))}
        <Button
          size="small"
          style={{ marginBottom: 10 }}
          onClick={() =>
            writeFilters([
              ...filters,
              { field: entity.fields[0]?.key ?? "", op: "eq" as const, value: "" },
            ])
          }
        >
          添加过滤
        </Button>
        <Space size={6} style={{ display: "flex" }}>
          <Typography.Text type="secondary">排序</Typography.Text>
          <Select
            style={{ width: 130 }}
            allowClear
            placeholder="不排序"
            value={sortField}
            onChange={(v) =>
              patchView(node.id, {
                sort: v ? [{ field: v, dir: sortDir }] : undefined,
              })
            }
            options={fieldOptions(entity)}
          />
          <Select
            style={{ width: 90 }}
            value={sortDir}
            disabled={!sortField}
            onChange={(v) =>
              patchView(node.id, {
                sort: sortField
                  ? [{ field: sortField, dir: v as "asc" | "desc" }]
                  : undefined,
              })
            }
            options={[
              { value: "asc", label: "升序" },
              { value: "desc", label: "降序" },
            ]}
          />
        </Space>
      </div>
    );
  };

  /** 聚合编辑（StatCard / ChartPlaceholder 共用，存 binding.view.aggregate） */
  const renderAggregateEditor = (node: ComponentNode, entity: Entity | null) => {
    if (!entity || !node.binding?.source) return null;
    const agg = node.binding.view?.aggregate;
    const fn = agg?.fn ?? "count";
    const numericFields = entity.fields.filter(
      (f) => f.type === "int" || f.type === "decimal",
    );
    return (
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
          聚合
        </Typography.Text>
        <Space size={6} style={{ display: "flex" }}>
          <Select
            style={{ width: 110 }}
            value={fn}
            onChange={(v) =>
              patchView(node.id, {
                aggregate:
                  v === "count"
                    ? { fn: "count" as const }
                    : {
                        fn: v as "sum" | "avg",
                        ...(agg?.field ? { field: agg.field } : {}),
                      },
              })
            }
            options={[
              { value: "count", label: "计数" },
              { value: "sum", label: "求和" },
              { value: "avg", label: "平均" },
            ]}
          />
          {fn !== "count" && (
            <Select
              style={{ flex: 1 }}
              placeholder="选择数字字段"
              value={agg?.field}
              onChange={(v) =>
                patchView(node.id, {
                  aggregate: { fn: fn as "sum" | "avg", field: v },
                })
              }
              options={numericFields.map((f) => ({
                value: f.key,
                label: `${f.label}（${f.key}）`,
              }))}
            />
          )}
        </Space>
      </div>
    );
  };

  const renderNodeProps = (page: PageSchema, node: ComponentNode) => {
    const entity = boundEntity(page, node);
    const layout = node.layout?.[device] ?? {};
    const isRoot = node.id === page.root.id;
    const props = node.props ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return (
      <div>
        <Space size={8} style={{ marginBottom: 10 }}>
          <Tag color="geekblue">{node.type}</Tag>
          <Typography.Text code style={{ fontSize: 12 }}>
            {node.id}
          </Typography.Text>
        </Space>

        {/* 通用：本设备布局 */}
        <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
          布局（{device === "desktop" ? "桌面" : "移动"}变体）
        </Typography.Text>
        <Space direction="vertical" size={6} style={{ display: "flex", marginBottom: 12 }}>
          <Space size={8}>
            <Typography.Text type="secondary">隐藏</Typography.Text>
            <Switch
              size="small"
              checked={Boolean(layout.hidden)}
              onChange={(v) => patchLayout(node.id, { hidden: v || undefined })}
            />
            <Typography.Text type="secondary">排序</Typography.Text>
            <InputNumber
              size="small"
              style={{ width: 70 }}
              value={layout.order}
              onChange={(v) => patchLayout(node.id, { order: v ?? undefined })}
            />
            <Typography.Text type="secondary">占比/12</Typography.Text>
            <InputNumber
              size="small"
              style={{ width: 70 }}
              min={0}
              max={12}
              value={layout.span}
              onChange={(v) => patchLayout(node.id, { span: v ?? undefined })}
            />
          </Space>
          {node.type === "Container" && (
            <Space size={8}>
              <Typography.Text type="secondary">方向覆盖</Typography.Text>
              <Select
                size="small"
                style={{ width: 120 }}
                allowClear
                placeholder="不覆盖"
                value={layout.direction}
                onChange={(v) => patchLayout(node.id, { direction: v })}
                options={[
                  { value: "row", label: "横向 row" },
                  { value: "column", label: "纵向 column" },
                ]}
              />
            </Space>
          )}
        </Space>

        {/* 通用：同级操作 */}
        <Space size={6} wrap style={{ marginBottom: 14 }}>
          {!isRoot && (
            <>
              <Button size="small" onClick={() => moveNode(node.id, -1)}>
                上移
              </Button>
              <Button size="small" onClick={() => moveNode(node.id, 1)}>
                下移
              </Button>
              <Button size="small" onClick={() => copyNode(node)}>
                复制
              </Button>
              <Popconfirm
                title="删除该组件？"
                onConfirm={() => {
                  deleteNode(node.id);
                  setSelectedNodeId(null);
                }}
              >
                <Button size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
          <Button size="small" onClick={() => setFragOpen(true)}>
            存为片段
          </Button>
        </Space>

        {/* 按类型专属 */}
        {node.type === "DataTable" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              显示列
            </Typography.Text>
            <Select
              mode="multiple"
              style={{ width: "100%", marginBottom: 12 }}
              placeholder="默认全部字段"
              value={(props.columns as string[] | undefined) ?? []}
              onChange={(v) =>
                patchProps(node.id, { columns: v.length > 0 ? v : undefined })
              }
              options={fieldOptions(entity)}
            />
            <Space size={8} style={{ marginBottom: 12, display: "flex" }}>
              <Typography.Text type="secondary">每页条数</Typography.Text>
              <InputNumber
                style={{ width: 90 }}
                min={1}
                max={200}
                value={(props.pageSize as number | undefined) ?? 20}
                onChange={(v) => patchProps(node.id, { pageSize: v ?? undefined })}
              />
            </Space>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              表单路由（新建/编辑跳往）
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              allowClear
              placeholder="不关联表单页"
              value={props.formRoute as string | undefined}
              onChange={(v) => patchProps(node.id, { formRoute: v })}
              options={routeOptions}
            />
            {renderViewEditors(node, entity)}
          </>
        )}

        {node.type === "EntityForm" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              列表路由（保存后返回）
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              allowClear
              placeholder="不关联列表页"
              value={props.listRoute as string | undefined}
              onChange={(v) => patchProps(node.id, { listRoute: v })}
              options={routeOptions}
            />
          </>
        )}

        {node.type === "Detail" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              显示字段
            </Typography.Text>
            <Select
              mode="multiple"
              style={{ width: "100%", marginBottom: 12 }}
              placeholder="默认全部字段"
              value={(props.fields as string[] | undefined) ?? []}
              onChange={(v) =>
                patchProps(node.id, { fields: v.length > 0 ? v : undefined })
              }
              options={fieldOptions(entity)}
            />
          </>
        )}

        {node.type === "StatCard" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              标题 / 后缀
            </Typography.Text>
            <Space size={6} style={{ display: "flex", marginBottom: 12 }}>
              <Input
                placeholder="卡片标题"
                defaultValue={str(props.title)}
                key={`${node.id}-title`}
                onBlur={(ev) => patchProps(node.id, { title: ev.target.value })}
              />
              <Input
                placeholder="后缀（如：元）"
                style={{ width: 110 }}
                defaultValue={str(props.suffix)}
                key={`${node.id}-suffix`}
                onBlur={(ev) =>
                  patchProps(node.id, { suffix: ev.target.value || undefined })
                }
              />
            </Space>
            {renderAggregateEditor(node, entity)}
            {renderViewEditors(node, entity)}
          </>
        )}

        {node.type === "ChartPlaceholder" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              图表标题
            </Typography.Text>
            <Input
              style={{ marginBottom: 12 }}
              placeholder="图表标题"
              defaultValue={str(props.title)}
              key={`${node.id}-title`}
              onBlur={(ev) => patchProps(node.id, { title: ev.target.value })}
            />
            {renderAggregateEditor(node, entity)}
          </>
        )}

        {node.type === "TextBlock" && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              文本内容
            </Typography.Text>
            <Input.TextArea
              rows={4}
              style={{ marginBottom: 12 }}
              defaultValue={str(props.text)}
              key={`${node.id}-text`}
              onBlur={(ev) => patchProps(node.id, { text: ev.target.value })}
            />
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              样式
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              value={(props.level as string | undefined) ?? "body"}
              onChange={(v) => patchProps(node.id, { level: v })}
              options={[
                { value: "body", label: "正文" },
                { value: "title", label: "标题" },
              ]}
            />
          </>
        )}

        {node.type === "Image" && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              图片地址
            </Typography.Text>
            <Input
              style={{ marginBottom: 12 }}
              placeholder="https://…"
              defaultValue={str(props.src)}
              key={`${node.id}-src`}
              onBlur={(ev) => patchProps(node.id, { src: ev.target.value })}
            />
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              替代文本
            </Typography.Text>
            <Input
              style={{ marginBottom: 12 }}
              defaultValue={str(props.alt)}
              key={`${node.id}-alt`}
              onBlur={(ev) => patchProps(node.id, { alt: ev.target.value })}
            />
          </>
        )}

        {node.type === "Button" && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              文案 / 类型
            </Typography.Text>
            <Space size={6} style={{ display: "flex", marginBottom: 12 }}>
              <Input
                placeholder="按钮文案"
                defaultValue={str(props.label)}
                key={`${node.id}-label`}
                onBlur={(ev) => patchProps(node.id, { label: ev.target.value })}
              />
              <Select
                style={{ width: 110 }}
                value={(props.type as string | undefined) ?? "default"}
                onChange={(v) => patchProps(node.id, { type: v })}
                options={[
                  { value: "primary", label: "主按钮" },
                  { value: "default", label: "默认" },
                ]}
              />
            </Space>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              点击跳转路由
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              allowClear
              placeholder="不跳转"
              value={props.route as string | undefined}
              onChange={(v) => patchProps(node.id, { route: v })}
              options={routeOptions}
            />
          </>
        )}

        {node.type === "Container" && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              容器方向 / 间距
            </Typography.Text>
            <Space size={6} style={{ display: "flex", marginBottom: 12 }}>
              <Select
                style={{ width: 130 }}
                value={(props.direction as string | undefined) ?? "column"}
                onChange={(v) => patchProps(node.id, { direction: v })}
                options={[
                  { value: "column", label: "纵向 column" },
                  { value: "row", label: "横向 row" },
                ]}
              />
              <InputNumber
                style={{ width: 100 }}
                min={0}
                value={(props.gap as number | undefined) ?? 12}
                onChange={(v) => patchProps(node.id, { gap: v ?? undefined })}
              />
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              方向是容器自身属性；上方「布局变体」中的方向覆盖可让同一容器在桌面横排、移动竖排。
            </Typography.Paragraph>
          </>
        )}

        {node.type === "Page" && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              页面标题
            </Typography.Text>
            <Input
              style={{ marginBottom: 12 }}
              defaultValue={str(props.title)}
              key={`${node.id}-title`}
              onBlur={(ev) => patchProps(node.id, { title: ev.target.value })}
            />
          </>
        )}

        {node.type === "AgentChat" && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            运行态助手占位组件：M7 接入真实对话能力，本期仅作版面占位。
          </Typography.Paragraph>
        )}
        {node.type === "Tabs" && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            标签页容器：子组件按顺序成为标签页内容（细粒度标签配置后续里程碑补齐）。
          </Typography.Paragraph>
        )}
      </div>
    );
  };

  /** 页面设置（未选中节点、或选中根节点时显示） */
  const renderPageSettings = (page: PageSchema) => {
    const menu = page.menu;
    const params = page.params ?? [];
    const writeParams = (next: PageSchema["params"]) =>
      mutatePage((p) => {
        p.params = next;
      });
    return (
      <div>
        <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
          页面设置
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
          页面名称
        </Typography.Text>
        <Input
          style={{ marginBottom: 10 }}
          defaultValue={page.name}
          key={`${page.id}-name`}
          onBlur={(ev) => {
            const v = ev.target.value.trim();
            if (v) mutatePage((p) => (p.name = v));
          }}
        />
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
          路由
        </Typography.Text>
        <Input
          style={{ marginBottom: 10 }}
          defaultValue={page.route}
          key={`${page.id}-route-${page.route}`}
          onBlur={(ev) => {
            let v = ev.target.value.trim();
            if (!v) return;
            if (!v.startsWith("/")) v = `/${v}`;
            if (v === page.route) return;
            if (pagesArr.some((p) => p.id !== page.id && p.route === v)) {
              void antdMessage.warning(`路由 ${v} 已被其他页面占用`);
              return;
            }
            mutatePage((p) => (p.route = v));
          }}
        />
        <Space size={8} style={{ marginBottom: 8 }}>
          <Typography.Text type="secondary">在菜单中显示</Typography.Text>
          <Switch
            size="small"
            checked={Boolean(menu) && !menu?.hidden}
            onChange={(on) =>
              mutatePage((p) => {
                const base = p.menu ?? { label: p.name };
                p.menu = on
                  ? { ...base, hidden: undefined }
                  : { ...base, hidden: true };
              })
            }
          />
        </Space>
        {menu && (
          <>
            <Input
              style={{ marginBottom: 8 }}
              placeholder="菜单名"
              defaultValue={menu.label}
              key={`${page.id}-menulabel`}
              onBlur={(ev) =>
                mutatePage((p) => {
                  if (p.menu) p.menu.label = ev.target.value;
                })
              }
            />
            <Space size={6} style={{ display: "flex", marginBottom: 12 }}>
              <Input
                placeholder="分组（如：采购管理）"
                defaultValue={menu.group ?? ""}
                key={`${page.id}-menugroup`}
                onBlur={(ev) =>
                  mutatePage((p) => {
                    if (p.menu) p.menu.group = ev.target.value || undefined;
                  })
                }
              />
              <InputNumber
                style={{ width: 100 }}
                placeholder="排序"
                value={menu.order}
                onChange={(v) =>
                  mutatePage((p) => {
                    if (p.menu) p.menu.order = v ?? undefined;
                  })
                }
              />
            </Space>
          </>
        )}
        <Typography.Text strong style={{ display: "block", margin: "6px 0" }}>
          页面参数（URL 入参）
        </Typography.Text>
        {params.map((param, i) => (
          <Space key={i} size={6} style={{ display: "flex", marginBottom: 6 }}>
            <Input
              placeholder="参数 key（如 id）"
              defaultValue={param.key}
              key={`${page.id}-pk-${i}`}
              onBlur={(ev) =>
                writeParams(
                  params.map((x, j) =>
                    j === i ? { ...x, key: ev.target.value.trim() } : x,
                  ),
                )
              }
            />
            <Input
              placeholder="标签"
              defaultValue={param.label ?? ""}
              key={`${page.id}-pl-${i}`}
              onBlur={(ev) =>
                writeParams(
                  params.map((x, j) =>
                    j === i ? { ...x, label: ev.target.value || undefined } : x,
                  ),
                )
              }
            />
            <Button
              size="small"
              danger
              onClick={() => writeParams(params.filter((_, j) => j !== i))}
            >
              删
            </Button>
          </Space>
        ))}
        <Button
          size="small"
          onClick={() =>
            writeParams([...params, { key: `param${params.length + 1}`, label: "" }])
          }
        >
          添加参数
        </Button>
      </div>
    );
  };

  // ---------------------------------------------------------- 主布局
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 560,
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ margin: "12px 16px 0" }}
        message="页面改动与数据模型共用一份草稿：调整后记得点右上角「保存草稿」，再发布。画布为运行态真实渲染（只读预览，写操作已禁用），点击画布组件或右侧结构树即可选中节点。"
      />
      {pages === null && (
        <Alert
          type="warning"
          showIcon
          style={{ margin: "12px 16px 0" }}
          message="当前全部页面由数据模型自动派生。在此生成或新建第一张设计页后，未被设计页覆盖的实体仍继续自动派生。"
        />
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 页管理列 */}
        <div
          style={{
            width: 224,
            borderRight: "1px solid #f0f0f0",
            padding: 12,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Typography.Text strong>设计页</Typography.Text>
          <div style={{ margin: "10px 0" }}>
            {pagesArr.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  setSelectedPageId(p.id);
                  setSelectedNodeId(null);
                }}
                style={{
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: 6,
                  marginBottom: 6,
                  background:
                    currentPage?.id === p.id ? "#e6f4ff" : "rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                <div style={{ color: "#9ca3af", fontSize: 12 }}>{p.route}</div>
                <Space size={4} style={{ marginTop: 4 }}>
                  {p.menu && !p.menu.hidden ? (
                    <Tag color="blue">菜单：{p.menu.label}</Tag>
                  ) : (
                    <Tag>无菜单</Tag>
                  )}
                  <Popconfirm
                    title={`删除页面「${p.name}」？`}
                    description="仅删除设计页；若该实体再无设计页覆盖，将恢复自动派生。"
                    onConfirm={() => deletePage(p)}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      onClick={(e) => e.stopPropagation()}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            ))}
            {pagesArr.length === 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                暂无设计页
              </Typography.Text>
            )}
          </div>
          <Space direction="vertical" size={8} style={{ display: "flex" }}>
            <Select
              placeholder="从实体生成列表+表单页"
              value={genEntityKey}
              onChange={(v) => {
                setGenEntityKey(null);
                const entity = topEntities.find((e) => e.key === v);
                if (entity) generateFromEntity(entity);
              }}
              options={topEntities.map((e) => ({
                value: e.key,
                label: `${e.label}（${e.key}）`,
              }))}
            />
            <Button block onClick={() => setNewPageOpen(true)}>
              新建自定义页
            </Button>
          </Space>
          <Typography.Text
            strong
            style={{ display: "block", margin: "18px 0 8px" }}
          >
            未设计（自动派生）
          </Typography.Text>
          {undesigned.map((e) => (
            <div
              key={e.key}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                marginBottom: 4,
                color: "#9ca3af",
                background: "rgba(0,0,0,0.02)",
                fontSize: 12,
              }}
            >
              {e.label}（{e.key}） <Tag style={{ marginLeft: 4 }}>自动派生</Tag>
            </div>
          ))}
          {undesigned.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              全部顶层实体均已有设计页
            </Typography.Text>
          )}
        </div>

        {/* 物料 + 片段列 */}
        <div
          style={{
            width: 188,
            borderRight: "1px solid #f0f0f0",
            padding: 12,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Typography.Text strong>组件物料</Typography.Text>
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, margin: "4px 0 8px" }}
          >
            点击插入到当前插入点（选中容器进其内、选中普通组件插其后）
          </Typography.Paragraph>
          {catalogGroups.map(([category, items]) => (
            <div key={category} style={{ marginBottom: 12 }}>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: "block", marginBottom: 6 }}
              >
                {category}
              </Typography.Text>
              <Space direction="vertical" size={6} style={{ display: "flex" }}>
                {items.map((item) => (
                  <Button
                    key={item.type}
                    block
                    style={{ height: "auto", padding: "6px 8px", textAlign: "left" }}
                    onClick={() => insertCatalogItem(item)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.label}</div>
                    <div
                      style={{
                        color: "#9ca3af",
                        fontSize: 11,
                        whiteSpace: "normal",
                        lineHeight: 1.4,
                      }}
                    >
                      {item.description}
                    </div>
                  </Button>
                ))}
              </Space>
            </div>
          ))}
          <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
            片段
          </Typography.Text>
          {(fragments ?? []).map((frag) => (
            <div
              key={frag.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.02)",
                marginTop: 6,
              }}
            >
              <span style={{ flex: 1, fontSize: 13 }}>{frag.name}</span>
              <Button size="small" onClick={() => insertFragment(frag)}>
                插入
              </Button>
            </div>
          ))}
          {(fragments ?? []).length === 0 && (
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 6 }}
            >
              暂无片段。选中任意组件后，在属性面板点「存为片段」即可沉淀复用。
            </Typography.Paragraph>
          )}
        </div>

        {/* 画布列 */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: "#fafafa",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: "1px solid #f0f0f0",
              background: "#fff",
              flexWrap: "wrap",
            }}
          >
            <Typography.Text strong>
              {currentPage ? currentPage.name : "未选择页面"}
            </Typography.Text>
            {currentPage && <Tag>{currentPage.route}</Tag>}
            <Segmented
              value={device}
              onChange={(v) => setDevice(v as Device)}
              options={[
                { label: "桌面", value: "desktop" },
                { label: "移动", value: "mobile" },
              ]}
            />
            <Button
              size="small"
              disabled={pastRef.current.length === 0}
              onClick={undo}
            >
              撤销
            </Button>
            <Button
              size="small"
              disabled={futureRef.current.length === 0}
              onClick={redo}
            >
              重做
            </Button>
            <div style={{ flex: 1 }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {device === "desktop" ? "桌面" : "移动"}布局编辑中 · 点画布或结构树选节点
            </Typography.Text>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
            {currentPage ? (
              <div
                style={
                  device === "mobile"
                    ? {
                        width: 390,
                        margin: "0 auto",
                        border: "1px solid #d9d9d9",
                        borderRadius: 28,
                        padding: 12,
                        background: "#fff",
                        minHeight: 620,
                        boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
                      }
                    : {
                        background: "#fff",
                        borderRadius: 8,
                        padding: 16,
                        minHeight: 480,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                      }
                }
              >
                <SchemaRenderer
                  page={currentPage}
                  dataSchema={data}
                  adapter={adapter}
                  device={device}
                  design={{
                    selectedId: selectedNodeId ?? undefined,
                    onSelect: (id: string) => setSelectedNodeId(id),
                  }}
                />
              </div>
            ) : (
              <Empty
                description="暂无设计页：从左侧「从实体生成」或「新建自定义页」开始"
                style={{ marginTop: 80 }}
              />
            )}
          </div>
        </div>

        {/* 结构树 + 属性列 */}
        <div
          style={{
            width: 324,
            borderLeft: "1px solid #f0f0f0",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flexShrink: 0,
            background: "#fff",
          }}
        >
          <div
            style={{
              padding: 12,
              borderBottom: "1px solid #f0f0f0",
              maxHeight: 250,
              overflow: "auto",
            }}
          >
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              组件结构
            </Typography.Text>
            {currentPage ? (
              <Tree
                treeData={[toTreeData(currentPage.root)]}
                selectedKeys={selectedNodeId ? [selectedNodeId] : []}
                onSelect={(keys) =>
                  setSelectedNodeId((keys[0] as string | undefined) ?? null)
                }
                defaultExpandAll
                blockNode
              />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                无页面
              </Typography.Text>
            )}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {currentPage ? (
              selectedNode && selectedNode.id !== currentPage.root.id ? (
                renderNodeProps(currentPage, selectedNode)
              ) : (
                <>
                  {selectedNode && renderNodeProps(currentPage, selectedNode)}
                  {renderPageSettings(currentPage)}
                </>
              )
            ) : (
              <Typography.Text type="secondary">
                先从左侧选择或新建一张页面。
              </Typography.Text>
            )}
          </div>
        </div>
      </div>

      {/* 新建自定义页 */}
      <Modal
        open={newPageOpen}
        title="新建自定义页"
        onCancel={() => setNewPageOpen(false)}
        onOk={createCustomPage}
        okText="创建"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          自定义页空白起步：自由组合多组件、多数据源（如工作台、看板、聚合页）。路由会作为页面地址
          slug，建议使用英文短横线。
        </Typography.Paragraph>
        <Space direction="vertical" size={10} style={{ display: "flex" }}>
          <Input
            placeholder="页面名称（如：采购工作台）"
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
          />
          <Input
            placeholder="路由 slug（如 workbench，会自动补 / 前缀）"
            value={newPageRoute}
            onChange={(e) => setNewPageRoute(e.target.value)}
          />
        </Space>
      </Modal>

      {/* 存为片段 */}
      <Modal
        open={fragOpen}
        title="存为片段"
        onCancel={() => setFragOpen(false)}
        onOk={saveAsFragment}
        okText="保存片段"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          把当前选中的组件（含子树）保存为可复用片段，之后可在任意页面从片段区一键插入（插入时生成新节点
          id）。
        </Typography.Paragraph>
        <Input
          placeholder="片段名称（如：统计卡片组）"
          value={fragName}
          onChange={(e) => setFragName(e.target.value)}
        />
      </Modal>
    </div>
  );
}
