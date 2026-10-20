import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  Tabs,
  Tag,
  Tree,
  Typography,
  message as antdMessage,
} from "antd";
import type { TreeDataNode, TreeProps } from "antd";
import { SchemaRenderer, componentCatalog } from "@lcdp/renderer";
import { PRESENTATION_VARIANTS } from "@naka1205/schema";
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
import { tokens } from "@lcdp/ui";
import "./designer.css";

/**
 * 页面设计器：三栏 —— 左「组件」（按分类 TAB + 片段 TAB）、中「布局」（页管理工具栏 + 画布）、
 * 右「属性 / 结构」（TAB）。把组件拖到画布上落位、拖动画布组件调整顺序与层级（结构树亦可拖拽，
 * 共用同一套树操作）；点选组件即在右栏显示其属性并绑定数据源。画布即运行态渲染器
 * （design 模式：点选节点、真实数据只读预览）；所有改动只更新本地设计包状态
 * （经 onPagesChange 上抛），保存/发布走设计器统一按钮。
 */

type CatalogItem = (typeof componentCatalog)[number];
type Device = "desktop" | "mobile";

const DATA_TYPES = ["DataTable", "EntityForm", "Detail", "StatCard", "Chart", "ChartPlaceholder", "ContentList"];

/** 呈现枚举的中文名（M13，与 PRESENTATION_VARIANTS 注册表的枚举值对应） */
const PRESENTATION_LABELS: Record<string, string> = {
  table: "表格",
  card: "卡片",
  standard: "标准",
  single: "单列",
};

/** 视图过滤算子（与服务端 vf 编译全集对齐）：字面量比较 + 字段间比较（*Field，value 为被比字段 key） */
const FILTER_OP_OPTIONS = [
  { value: "eq", label: "等于" },
  { value: "ne", label: "不等于" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
  { value: "contains", label: "包含" },
  { value: "ltField", label: "小于字段" },
  { value: "lteField", label: "小于等于字段" },
  { value: "gtField", label: "大于字段" },
  { value: "gteField", label: "大于等于字段" },
];
const FIELD_OPS = ["ltField", "lteField", "gtField", "gteField"];

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

// ---------------------------------------------------------- 拖拽落点（画布拖拽与结构树拖拽共用同一套树操作）
type DropPos = "before" | "after" | "inside";

/** 可容纳子节点的组件类型（与渲染器的 children 渲染范围一致） */
const CONTAINER_TYPES = ["Page", "Container", "Tabs"];

/** 目标节点是否为 dragId 本身或其后代（此时禁止落入，避免成环） */
function isSelfOrDescendant(
  root: ComponentNode,
  dragId: string,
  targetId: string,
): boolean {
  if (dragId === targetId) return true;
  const drag = findNode(root, dragId);
  if (!drag) return true;
  return Boolean(findNode(drag, targetId));
}

/**
 * 校验落点并归一化：inside 仅容器可接（非容器自动转 after）；
 * 根节点无同级，before/after 转为 inside（追加到根子级末尾）。
 * 不合法返回 null。
 */
function resolveDropPos(
  root: ComponentNode,
  dragId: string | null,
  targetId: string,
  pos: DropPos,
): DropPos | null {
  const target = findNode(root, targetId);
  if (!target) return null;
  if (dragId) {
    if (dragId === root.id) return null;
    if (isSelfOrDescendant(root, dragId, targetId)) return null;
  }
  let p = pos;
  if (p === "inside" && !CONTAINER_TYPES.includes(target.type)) p = "after";
  if (targetId === root.id && p !== "inside") p = "inside";
  if (p !== "inside" && !findParent(root, targetId)) return null;
  return p;
}

/** 把节点插入到目标位置（pos 已经 resolveDropPos 归一化时不会失败） */
function insertNodeAt(
  root: ComponentNode,
  node: ComponentNode,
  targetId: string,
  pos: DropPos,
): boolean {
  if (pos === "inside") {
    const t = findNode(root, targetId);
    if (!t) return false;
    t.children = [...(t.children ?? []), node];
    return true;
  }
  const loc = findParent(root, targetId);
  if (!loc?.parent.children) return false;
  loc.parent.children.splice(pos === "before" ? loc.index : loc.index + 1, 0, node);
  return true;
}

/** 从树上摘下节点（返回摘下的子树，找不到返回 null） */
function detachNode(root: ComponentNode, id: string): ComponentNode | null {
  const loc = findParent(root, id);
  if (!loc?.parent.children) return null;
  const [n] = loc.parent.children.splice(loc.index, 1);
  return n ?? null;
}

/** 移动已有节点到目标位置：先全量校验再摘下插入，不会出现丢节点 */
function moveNodeTo(
  root: ComponentNode,
  dragId: string,
  targetId: string,
  pos: DropPos,
): boolean {
  const eff = resolveDropPos(root, dragId, targetId, pos);
  if (!eff) return false;
  const node = detachNode(root, dragId);
  if (!node) return false;
  return insertNodeAt(root, node, targetId, eff);
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
  /** 应用主题（appConfig.theme）：画布预览与运行态同口径消费其 mobile 令牌组（M13） */
  theme?: Record<string, unknown>;
}

export default function PageDesigner({
  appId,
  data,
  pages,
  fragments,
  onPagesChange,
  onFragmentsChange,
  theme,
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
  /** 右栏页签：选中组件（含画布点选/新插入/拖拽落位）即切到「属性」 */
  const [rightTab, setRightTab] = useState<"props" | "tree">("props");

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
  /** 数据组件的默认绑定：页面已有实体数据源则自动指向第一个（点击插入与拖拽落入共用） */
  const prepareNode = (page: PageSchema, node: ComponentNode) => {
    if (!DATA_TYPES.includes(node.type)) return;
    const firstEntity = page.dataSources.find((ds) => ds.kind === "entity");
    if (node.binding && !node.binding.source) {
      if (firstEntity) node.binding.source = firstEntity.key;
      else delete node.binding;
    } else if (!node.binding && firstEntity) {
      node.binding = { source: firstEntity.key };
    }
  };

  /** 插入节点并处理数据组件的默认绑定：有现成实体数据源则复用，否则保持未绑定（属性面板提示） */
  const insertNode = (raw: ComponentNode) => {
    if (!currentPage) {
      void antdMessage.warning("先选择或新建一张页面");
      return;
    }
    let insertedId: string | null = null;
    mutatePage((page) => {
      prepareNode(page, raw);
      insertAtPoint(page.root, selectedNodeId, raw);
      insertedId = raw.id;
    });
    if (insertedId) {
      setSelectedNodeId(insertedId);
      setRightTab("props");
    }
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

  // ---------------------------------------------------------- 拖拽（指针式：物料拖入画布 / 画布节点拖动；结构树拖拽见 onTreeDrop）
  type DragSource =
    | { kind: "catalog"; item: CatalogItem; label: string }
    | { kind: "fragment"; frag: FragmentDef; label: string }
    | { kind: "node"; nodeId: string; label: string };

  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    source: DragSource;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dropRef = useRef<{ targetId: string; pos: DropPos; axis: "x" | "y" } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const paintedRef = useRef<{ el: HTMLElement; boxShadow: string; outline: string } | null>(null);
  /** 拖拽刚结束时吞掉随之而来的 click / 画布 onSelect，避免双重插入或选中被改 */
  const suppressClickRef = useRef(false);
  const justDraggedRef = useRef(false);
  const currentPageRef = useRef<PageSchema | null>(null);
  currentPageRef.current = currentPage;
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const commitDropRef = useRef<() => void>(() => {});

  const clearPaint = () => {
    const p = paintedRef.current;
    if (p) {
      p.el.style.boxShadow = p.boxShadow;
      p.el.style.outline = p.outline;
      paintedRef.current = null;
    }
  };
  const paintDrop = (targetId: string, pos: DropPos, axis: "x" | "y") => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const el = wrap.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
    if (!el) return;
    if (paintedRef.current?.el === el) clearPaint();
    if (!paintedRef.current) {
      paintedRef.current = {
        el,
        boxShadow: el.style.boxShadow,
        outline: el.style.outline,
      };
    }
    if (pos === "inside") {
      el.style.outline = `2px solid ${tokens.colorPrimary}`;
      el.style.boxShadow = "inset 0 0 0 2px rgba(22,119,255,0.35)";
    } else if (axis === "x") {
      el.style.boxShadow =
        pos === "before" ? `inset 3px 0 0 0 ${tokens.colorPrimary}` : `inset -3px 0 0 0 ${tokens.colorPrimary}`;
    } else if (pos === "before") {
      el.style.boxShadow = `inset 0 3px 0 0 ${tokens.colorPrimary}`;
    } else {
      el.style.boxShadow = `inset 0 -3px 0 0 ${tokens.colorPrimary}`;
    }
  };

  /**
   * 落点判定的流向轴：目标的父级是横排（row）容器时用水平轴，否则用垂直轴。
   * 横排里左右相邻的组件（如并排统计卡）必须按 x 位置判定前/后——只看 y 时，
   * 「拖到右邻居上半部」会被误判为「插到它前面」，而拖拽源本就在它前面，落点等于原地，看起来就是拖不动。
   * 方向解析与渲染器一致：当前设备的布局变体覆盖优先，其次容器 props.direction，默认纵向。
   */
  const flowAxis = (root: ComponentNode, targetId: string): "x" | "y" => {
    const loc = findParent(root, targetId);
    if (!loc || loc.parent.type !== "Container") return "y";
    const parent = loc.parent;
    const dir =
      parent.layout?.[deviceRef.current]?.direction ??
      (parent.props?.direction as string | undefined) ??
      "column";
    return dir === "row" ? "x" : "y";
  };

  /** 由指针坐标解出落点：命中最内层节点包围盒，沿流向轴的两缘为同级前/后，容器中段为进入其内 */
  const resolveDropTarget = (
    clientX: number,
    clientY: number,
  ): { targetId: string; pos: DropPos; axis: "x" | "y" } | null => {
    const page = currentPageRef.current;
    const wrap = canvasWrapRef.current;
    if (!page || !wrap) return null;
    const ghost = ghostRef.current;
    if (ghost) ghost.style.visibility = "hidden";
    const hit = document.elementFromPoint(clientX, clientY);
    if (ghost) ghost.style.visibility = "visible";
    const el = hit?.closest<HTMLElement>("[data-node-id]");
    if (!el || !wrap.contains(el)) return null;
    const targetId = el.dataset.nodeId;
    if (!targetId) return null;
    const target = findNode(page.root, targetId);
    if (!target) return null;
    const rect = el.getBoundingClientRect();
    const axis = flowAxis(page.root, targetId);
    const ratio =
      axis === "x"
        ? rect.width > 0
          ? (clientX - rect.left) / rect.width
          : 0.5
        : rect.height > 0
          ? (clientY - rect.top) / rect.height
          : 0.5;
    let pos: DropPos;
    if (CONTAINER_TYPES.includes(target.type)) {
      pos = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    } else {
      pos = ratio < 0.5 ? "before" : "after";
    }
    const dragId =
      dragRef.current?.source.kind === "node" ? dragRef.current.source.nodeId : null;
    const eff = resolveDropPos(page.root, dragId, targetId, pos);
    return eff ? { targetId, pos: eff, axis } : null;
  };

  /** 落点提交：与点击插入共用 mutatePage 历史栈，一次拖拽 = 一步撤销 */
  const commitDrop = () => {
    const drag = dragRef.current;
    const drop = dropRef.current;
    if (!drag || !drop || !currentPageRef.current) return;
    let landedId: string | null = null;
    mutatePage((page) => {
      if (drag.source.kind === "catalog") {
        const node = drag.source.item.make(genNodeId(collectIds(page.root)));
        prepareNode(page, node);
        if (insertNodeAt(page.root, node, drop.targetId, drop.pos)) landedId = node.id;
      } else if (drag.source.kind === "fragment") {
        const node = reIdTree(drag.source.frag.root, collectIds(page.root));
        prepareNode(page, node);
        if (insertNodeAt(page.root, node, drop.targetId, drop.pos)) landedId = node.id;
      } else {
        if (moveNodeTo(page.root, drag.source.nodeId, drop.targetId, drop.pos))
          landedId = drag.source.nodeId;
      }
    });
    if (landedId) {
      setSelectedNodeId(landedId);
      setRightTab("props");
    }
  };
  commitDropRef.current = commitDrop;

  /** 在物料卡片 / 片段行 / 画布节点上按下指针即预备拖拽（移动超过阈值才真正进入拖拽态，普通点击不受影响） */
  const armDrag = (source: DragSource, e: { clientX: number; clientY: number }) => {
    dragRef.current = {
      source,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    dropRef.current = null;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.active = true;
        const ghost = document.createElement("div");
        ghost.textContent = drag.source.label;
        ghost.style.cssText =
          "position:fixed;z-index:9999;pointer-events:none;padding:4px 12px;" +
          `background:${tokens.colorPrimary};color:#fff;border-radius:6px;font-size:12px;opacity:0.92;` +
          "transform:translate(-50%,-140%);box-shadow:0 4px 14px rgba(0,0,0,0.25)";
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
        // 拖拽进行中全局禁选：指针划过画布/面板时浏览器会把沿途文字刷蓝全选，干扰落点判断
        document.body.style.userSelect = "none";
        document.body.style.setProperty("-webkit-user-select", "none");
        window.getSelection()?.removeAllRanges();
      }
      const ghost = ghostRef.current;
      if (ghost) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      }
      const drop = resolveDropTarget(e.clientX, e.clientY);
      dropRef.current = drop;
      clearPaint();
      if (drop) paintDrop(drop.targetId, drop.pos, drop.axis);
    };
    const endDrag = (commit: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (ghostRef.current) {
        ghostRef.current.remove();
        ghostRef.current = null;
      }
      document.body.style.userSelect = "";
      document.body.style.removeProperty("-webkit-user-select");
      clearPaint();
      if (drag.active) {
        suppressClickRef.current = true;
        justDraggedRef.current = true;
        // commitDrop 靠 dragRef/dropRef 取拖拽源与落点，必须在清空引用之前调用；
        // 顺序写反会让每次落点提交都被 commitDrop 的空守卫挡掉（拖拽全程无感的真因）
        if (commit) commitDropRef.current();
        window.setTimeout(() => {
          suppressClickRef.current = false;
          justDraggedRef.current = false;
        }, 50);
      }
      dragRef.current = null;
      dropRef.current = null;
    };
    const onUp = () => endDrag(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endDrag(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /** 画布内按下指针：只有按在组件的拖拽手柄上才预备拖动（根节点无手柄）；组件本体按下只走点选，避免拖动表格/表单内部控件时误移组件 */
  const onCanvasPointerDown = (e: ReactPointerEvent) => {
    const page = currentPageRef.current;
    if (!page || e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-drag-handle]");
    if (!handle || !canvasWrapRef.current?.contains(handle)) return;
    const nodeId = handle.dataset.dragHandle;
    if (!nodeId || nodeId === page.root.id) return;
    const node = findNode(page.root, nodeId);
    if (!node) return;
    armDrag({ kind: "node", nodeId, label: node.type }, e);
  };

  /** 结构树拖拽：antd 的 dropPosition 归一化为 -1 前 / 0 内 / 1 后，与画布拖拽共用 moveNodeTo */
  const onTreeDrop: TreeProps["onDrop"] = (info) => {
    if (!currentPage) return;
    const dragId = String(info.dragNode.key);
    const targetId = String(info.node.key);
    const posSegs = String(info.node.pos ?? "").split("-");
    const rel = info.dropPosition - Number(posSegs[posSegs.length - 1] ?? 0);
    const pos: DropPos = rel < 0 ? "before" : rel > 0 ? "after" : "inside";
    let ok = false;
    mutatePage((page) => {
      ok = moveNodeTo(page.root, dragId, targetId, pos);
    });
    if (ok) setSelectedNodeId(dragId);
  };

  /** 物料/片段的点击：拖拽刚结束的 click 要吞掉，其余走原点击插入 */
  const clickInsert = (fn: () => void) => {
    if (suppressClickRef.current) return;
    fn();
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

  /** 呈现槽位写入（M13）：按设备写 node.presentation[device]，清空后无键则整段删除（草稿保持干净） */
  const patchPresentation = (
    nodeId: string,
    deviceKey: "desktop" | "mobile",
    value: string | undefined,
  ) =>
    mutateNode(nodeId, (n) => {
      const pres: { desktop?: string; mobile?: string } = {
        ...(n.presentation ?? {}),
      };
      if (value === undefined) delete pres[deviceKey];
      else pres[deviceKey] = value;
      if (Object.keys(pres).length === 0) delete n.presentation;
      else n.presentation = pres;
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

  /** 数据视图编辑：过滤行（全 op：字面量比较 + 字段间比较）+ 排序第一项 */
  const renderViewEditors = (node: ComponentNode, entity: Entity | null) => {
    if (!entity || !node.binding?.source) return null;
    const view = node.binding.view ?? {};
    const filters = view.filters ?? [];
    const writeFilters = (next: typeof filters) =>
      patchView(node.id, { filters: next.length > 0 ? next : undefined });
    const sortField = view.sort?.[0]?.field;
    const sortDir = view.sort?.[0]?.dir ?? "asc";
    const numericFieldOptions = [
      ...entity.fields
        .filter((f) => f.type === "int" || f.type === "decimal")
        .map((f) => ({ value: f.key, label: `${f.label}（${f.key}）` })),
      // 跨引用路径（M9 补）：本实体 ref 字段 → 目标实体数字字段，value = <refKey>.<targetKey>
      // （如库存 quantity 小于 物料→安全库存 material_id.safety_stock，服务端编译为子查询）
      ...entity.fields
        .filter((f) => f.type === "ref" && f.refEntity)
        .flatMap((rf) => {
          const target = data.entities.find((e) => e.key === rf.refEntity);
          if (!target) return [];
          return target.fields
            .filter((tf) => tf.type === "int" || tf.type === "decimal")
            .map((tf) => ({
              value: `${rf.key}.${tf.key}`,
              label: `${rf.label} → ${tf.label}（${rf.key}.${tf.key}）`,
            }));
        }),
    ];
    return (
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
          数据视图（过滤 / 排序）
        </Typography.Text>
        {filters.map((f, i) => {
          const isFieldOp = FIELD_OPS.includes(f.op);
          return (
            <Space key={i} size={6} style={{ display: "flex", marginBottom: 6 }}>
              <Select
                style={{ width: 118 }}
                value={f.field || undefined}
                placeholder="字段"
                onChange={(v) =>
                  writeFilters(
                    filters.map((x, j) => (j === i ? { ...x, field: v } : x)),
                  )
                }
                options={fieldOptions(entity)}
              />
              <Select
                style={{ width: 104 }}
                value={f.op}
                onChange={(v) =>
                  writeFilters(
                    filters.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            op: v as typeof x.op,
                            // 切到字段间比较时旧字面量不再有意义，清空待重选被比字段
                            value: FIELD_OPS.includes(v) ? "" : x.value,
                          }
                        : x,
                    ),
                  )
                }
                options={FILTER_OP_OPTIONS}
              />
              {isFieldOp ? (
                <Select
                  style={{ flex: 1 }}
                  value={
                    typeof f.value === "string" && f.value
                      ? f.value
                      : undefined
                  }
                  placeholder="被比字段（数字）"
                  onChange={(v) =>
                    writeFilters(
                      filters.map((x, j) =>
                        j === i ? { ...x, value: v } : x,
                      ),
                    )
                  }
                  options={numericFieldOptions}
                />
              ) : (
                <Input
                  style={{ flex: 1 }}
                  placeholder="比较值（$param.参数名 可引用页面参数）"
                  defaultValue={f.value == null ? "" : String(f.value)}
                  key={`${node.id}-f-${i}-${f.op}-${String(f.value ?? "")}`}
                  onBlur={(ev) =>
                    writeFilters(
                      filters.map((x, j) =>
                        j === i ? { ...x, value: ev.target.value } : x,
                      ),
                    )
                  }
                />
              )}
              <Switch
                size="small"
                title="与上一条为或（OR）"
                checked={f.or === true}
                disabled={i === 0}
                onChange={(v) =>
                  writeFilters(
                    filters.map((x, j) =>
                      j === i ? { ...x, or: v || undefined } : x,
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
          );
        })}
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

  /** 聚合编辑（StatCard / Chart 共用，存 binding.view.aggregate；groupBy 供图表分组绘图） */
  const renderAggregateEditor = (node: ComponentNode, entity: Entity | null) => {
    if (!entity || !node.binding?.source) return null;
    const agg = node.binding.view?.aggregate;
    const fn = agg?.fn ?? "count";
    const numericFields = entity.fields.filter(
      (f) => f.type === "int" || f.type === "decimal",
    );
    // 分组字段候选：与服务端校验一致（file/image/json/boolean 不可分组）
    const groupableFields = entity.fields.filter(
      (f) => !["file", "image", "json", "boolean"].includes(f.type),
    );
    return (
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
          聚合
        </Typography.Text>
        <Space size={6} style={{ display: "flex", marginBottom: 6 }}>
          <Select
            style={{ width: 110 }}
            value={fn}
            onChange={(v) =>
              patchView(node.id, {
                aggregate: {
                  fn: v as "count" | "sum" | "avg",
                  ...(v !== "count" && agg?.field
                    ? { field: agg.field }
                    : {}),
                  ...(agg?.groupBy ? { groupBy: agg.groupBy } : {}),
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
                  aggregate: {
                    fn: fn as "sum" | "avg",
                    field: v,
                    ...(agg?.groupBy ? { groupBy: agg.groupBy } : {}),
                  },
                })
              }
              options={numericFields.map((f) => ({
                value: f.key,
                label: `${f.label}（${f.key}）`,
              }))}
            />
          )}
        </Space>
        <Space size={6} style={{ display: "flex" }}>
          <Typography.Text type="secondary">分组</Typography.Text>
          <Select
            style={{ flex: 1 }}
            allowClear
            placeholder="不分组（单值）"
            value={agg?.groupBy}
            onChange={(v) =>
              patchView(node.id, {
                aggregate: {
                  fn,
                  ...(fn !== "count" && agg?.field
                    ? { field: agg.field }
                    : {}),
                  ...(v ? { groupBy: v } : {}),
                },
              })
            }
            options={groupableFields.map((f) => ({
              value: f.key,
              label: `${f.label}（${f.key}）`,
            }))}
          />
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

        {/* 通用：呈现变体（M13）——仅注册表有条目的组件显示；未选即注册表默认 */}
        {PRESENTATION_VARIANTS[node.type] && (
          <>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              呈现变体（双端）
            </Typography.Text>
            <Space direction="vertical" size={6} style={{ display: "flex", marginBottom: 12 }}>
              <Space size={8}>
                <Typography.Text type="secondary">桌面</Typography.Text>
                <Select
                  size="small"
                  style={{ width: 150 }}
                  allowClear
                  placeholder={`默认（${PRESENTATION_VARIANTS[node.type]!.defaultDesktop}）`}
                  value={node.presentation?.desktop}
                  onChange={(v) => patchPresentation(node.id, "desktop", v)}
                  options={PRESENTATION_VARIANTS[node.type]!.desktop.map(
                    (v) => ({
                      value: v,
                      label: PRESENTATION_LABELS[v] ?? v,
                    }),
                  )}
                />
              </Space>
              <Space size={8}>
                <Typography.Text type="secondary">移动</Typography.Text>
                <Select
                  size="small"
                  style={{ width: 150 }}
                  allowClear
                  placeholder={`默认（${PRESENTATION_VARIANTS[node.type]!.defaultMobile}）`}
                  value={node.presentation?.mobile}
                  onChange={(v) => patchPresentation(node.id, "mobile", v)}
                  options={PRESENTATION_VARIANTS[node.type]!.mobile.map(
                    (v) => ({
                      value: v,
                      label: PRESENTATION_LABELS[v] ?? v,
                    }),
                  )}
                />
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                未选时取注册表默认：桌面{" "}
                {PRESENTATION_VARIANTS[node.type]!.defaultDesktop} · 移动{" "}
                {PRESENTATION_VARIANTS[node.type]!.defaultMobile}
              </Typography.Text>
            </Space>
          </>
        )}

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
              卡片标题列（移动端卡片呈现）
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              allowClear
              placeholder="默认首个可见列"
              value={props.cardTitleField as string | undefined}
              onChange={(v) => patchProps(node.id, { cardTitleField: v })}
              options={fieldOptions(entity)}
            />
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

        {(node.type === "Chart" || node.type === "ChartPlaceholder") && (
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
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              图表类型
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              value={(props.chartType as string | undefined) ?? "bar"}
              onChange={(v) => patchProps(node.id, { chartType: v })}
              options={[
                { value: "bar", label: "柱状图" },
                { value: "line", label: "折线图" },
                { value: "pie", label: "饼图" },
              ]}
            />
            {renderAggregateEditor(node, entity)}
            {renderViewEditors(node, entity)}
          </>
        )}

        {node.type === "ContentList" && (
          <>
            {renderSourceSelect(node)}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              字段映射（卡片呈现）
            </Typography.Text>
            {(
              [
                {
                  key: "titleField",
                  label: "标题字段",
                  types: null,
                  placeholder: "默认取 title 字段",
                },
                {
                  key: "summaryField",
                  label: "摘要字段",
                  types: ["string", "text", "richtext"],
                  placeholder: "不显示摘要",
                },
                {
                  key: "coverField",
                  label: "封面字段",
                  types: ["image", "file"],
                  placeholder: "不显示封面",
                },
                {
                  key: "dateField",
                  label: "日期字段",
                  types: ["date", "datetime"],
                  placeholder: "不显示日期",
                },
              ] as Array<{
                key: string;
                label: string;
                types: string[] | null;
                placeholder: string;
              }>
            ).map((row) => (
              <Space
                key={row.key}
                size={8}
                style={{ marginBottom: 8, display: "flex" }}
              >
                <Typography.Text type="secondary" style={{ width: 64 }}>
                  {row.label}
                </Typography.Text>
                <Select
                  style={{ flex: 1 }}
                  allowClear
                  placeholder={row.placeholder}
                  value={props[row.key] as string | undefined}
                  onChange={(v) => patchProps(node.id, { [row.key]: v })}
                  options={(entity?.fields ?? [])
                    .filter((f) => !row.types || row.types.includes(f.type))
                    .map((f) => ({
                      value: f.key,
                      label: `${f.label}（${f.key}）`,
                    }))}
                />
              </Space>
            ))}
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              详情路由（点击条目跳往）
            </Typography.Text>
            <Select
              style={{ width: "100%", marginBottom: 12 }}
              allowClear
              placeholder="不跳转"
              value={props.detailRoute as string | undefined}
              onChange={(v) => patchProps(node.id, { detailRoute: v })}
              options={routeOptions}
            />
            <Space size={8} style={{ marginBottom: 12, display: "flex" }}>
              <Typography.Text type="secondary">每页条数</Typography.Text>
              <InputNumber
                style={{ width: 90 }}
                min={1}
                max={100}
                value={(props.pageSize as number | undefined) ?? 10}
                onChange={(v) => patchProps(node.id, { pageSize: v ?? undefined })}
              />
            </Space>
            {renderViewEditors(node, entity)}
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
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              组件间距
            </Typography.Text>
            <InputNumber
              style={{ width: 120, marginBottom: 6 }}
              min={0}
              value={(props.gap as number | undefined) ?? 16}
              onChange={(v) => patchProps(node.id, { gap: v ?? undefined })}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              页面内上下相邻组件之间的间距（像素），默认 16；容器内部的间距在容器属性里单独设置。
            </Typography.Paragraph>
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
        message="页面改动与数据模型共用一份草稿：调整后记得点右上角「保存草稿」，再发布。画布为运行态真实渲染（只读预览，写操作已禁用）：把左栏组件拖到画布上落位；把鼠标移到画布组件上、按住其左上角的拖拽手柄拖动，可精确调整顺序与层级；点选组件后在右栏「属性」里改配置与数据源。"
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
        {/* 左栏：组件（分类 TAB + 片段 TAB），拖拽到画布落位或点击添加 */}
        <div
          style={{
            width: 224,
            borderRight: `1px solid ${tokens.colorBorder}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flexShrink: 0,
            background: tokens.colorBgContainer,
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <div style={{ padding: "10px 12px 0" }}>
            <Typography.Text strong>组件</Typography.Text>
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, margin: "2px 0 0" }}
            >
              拖拽到画布上落位，或点击添加到当前选中位置
            </Typography.Paragraph>
          </div>
          <Tabs
            size="small"
            className="pd-tabs"
            style={{ flex: 1, minHeight: 0, padding: "0 6px" }}
            items={[
              ...catalogGroups.map(([category, items]) => ({
                key: category,
                label: category,
                children: (
                  <div style={{ padding: "4px 6px 14px" }}>
                    <Space direction="vertical" size={6} style={{ display: "flex" }}>
                      {items.map((item) => (
                        <div
                          key={item.type}
                          onPointerDown={(e) =>
                            armDrag({ kind: "catalog", item, label: item.label }, e)
                          }
                          onClick={() =>
                            clickInsert(() => insertCatalogItem(item))
                          }
                          style={{
                            border: `1px solid ${tokens.colorBorder}`,
                            borderRadius: 8,
                            padding: "7px 9px",
                            cursor: "grab",
                            userSelect: "none",
                            touchAction: "none",
                            background: tokens.colorBgContainer,
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {item.label}
                          </div>
                          <div
                            style={{
                              color: tokens.colorTextTertiary,
                              fontSize: 11,
                              lineHeight: 1.4,
                            }}
                          >
                            {item.description}
                          </div>
                        </div>
                      ))}
                    </Space>
                  </div>
                ),
              })),
              {
                key: "片段",
                label: "片段",
                children: (
                  <div style={{ padding: "4px 6px 14px" }}>
                    {(fragments ?? []).map((frag) => (
                      <div
                        key={frag.id}
                        onPointerDown={(e) =>
                          armDrag({ kind: "fragment", frag, label: frag.name }, e)
                        }
                        onClick={() => clickInsert(() => insertFragment(frag))}
                        style={{
                          border: `1px solid ${tokens.colorBorder}`,
                          borderRadius: 8,
                          padding: "7px 9px",
                          cursor: "grab",
                          userSelect: "none",
                          touchAction: "none",
                          background: tokens.colorBgContainer,
                          marginBottom: 6,
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {frag.name}
                        </div>
                        <div style={{ color: tokens.colorTextTertiary, fontSize: 11 }}>
                          拖拽到画布，或点击插入（生成新节点 id）
                        </div>
                      </div>
                    ))}
                    {(fragments ?? []).length === 0 && (
                      <Typography.Paragraph
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        暂无片段。在画布选中组件后，在右栏「属性」点「存为片段」即可沉淀复用。
                      </Typography.Paragraph>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>

        {/* 中栏：布局 —— 页管理并入工具栏，下方为画布（运行态真实渲染 + 拖拽排布） */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            background: tokens.colorBgLayout,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderBottom: `1px solid ${tokens.colorBorder}`,
              background: tokens.colorBgContainer,
              flexWrap: "wrap",
            }}
          >
            <Select
              style={{ width: 200 }}
              placeholder="选择页面"
              value={currentPage?.id}
              onChange={(v) => {
                setSelectedPageId(v);
                setSelectedNodeId(null);
              }}
              options={pagesArr.map((p) => ({
                value: p.id,
                label: `${p.name}（${p.route}）`,
              }))}
            />
            <Select
              style={{ width: 210 }}
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
            <Button onClick={() => setNewPageOpen(true)}>新建自定义页</Button>
            {currentPage && (
              <Popconfirm
                title={`删除页面「${currentPage.name}」？`}
                description="仅删除设计页；若该实体再无设计页覆盖，将恢复自动派生。"
                onConfirm={() => deletePage(currentPage)}
              >
                <Button danger>删除页面</Button>
              </Popconfirm>
            )}
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
              {device === "desktop" ? "桌面" : "移动"}布局编辑中 · 按住组件左上角手柄拖拽排布，点选后在右栏改属性
            </Typography.Text>
          </div>
          {undesigned.length > 0 && (
            <div
              style={{
                padding: "6px 14px",
                background: tokens.colorWarningBg,
                borderBottom: `1px solid ${tokens.colorBorder}`,
                fontSize: 12,
                color: tokens.colorTextTertiary,
              }}
            >
              未设计（自动派生）：
              {undesigned.map((e) => `${e.label}（${e.key}）`).join("、")}
            </div>
          )}
          <div
            ref={canvasWrapRef}
            onPointerDown={onCanvasPointerDown}
            style={{
              flex: 1,
              overflow: "auto",
              padding: 16,
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {currentPage ? (
              <div
                style={
                  device === "mobile"
                    ? {
                        width: 390,
                        margin: "0 auto",
                        border: `1px solid ${tokens.colorBorderControl}`,
                        borderRadius: 28,
                        padding: 12,
                        background: tokens.colorBgContainer,
                        minHeight: 620,
                        boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
                      }
                    : {
                        background: tokens.colorBgContainer,
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
                  theme={theme}
                  design={{
                    selectedId: selectedNodeId ?? undefined,
                    onSelect: (id: string) => {
                      if (justDraggedRef.current) return;
                      setSelectedNodeId(id);
                      setRightTab("props");
                    },
                  }}
                />
              </div>
            ) : (
              <Empty
                description="暂无设计页：从工具栏「从实体生成」或「新建自定义页」开始"
                style={{ marginTop: 80 }}
              />
            )}
          </div>
        </div>

        {/* 右栏：属性 / 结构（TAB）—— 选中组件即显示其属性与数据源绑定 */}
        <div
          style={{
            width: 324,
            borderLeft: `1px solid ${tokens.colorBorder}`,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            flexShrink: 0,
            background: tokens.colorBgContainer,
          }}
        >
          <Tabs
            size="small"
            className="pd-tabs"
            activeKey={rightTab}
            onChange={(k) => setRightTab(k as "props" | "tree")}
            style={{ flex: 1, minHeight: 0, padding: "0 6px" }}
            items={[
              {
                key: "props",
                label: "属性",
                children: (
                  <div style={{ padding: "4px 8px 14px" }}>
                    {currentPage ? (
                      selectedNode && selectedNode.id !== currentPage.root.id ? (
                        renderNodeProps(currentPage, selectedNode)
                      ) : (
                        <>
                          {selectedNode &&
                            renderNodeProps(currentPage, selectedNode)}
                          {renderPageSettings(currentPage)}
                        </>
                      )
                    ) : (
                      <Typography.Text type="secondary">
                        先在画布工具栏选择或新建一张页面。
                      </Typography.Text>
                    )}
                  </div>
                ),
              },
              {
                key: "tree",
                label: "结构",
                children: (
                  <div style={{ padding: "4px 8px 14px" }}>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ fontSize: 12, marginBottom: 8 }}
                    >
                      拖拽节点可调整顺序与层级；点选节点后到「属性」页签编辑。
                    </Typography.Paragraph>
                    {currentPage ? (
                      <Tree
                        treeData={[toTreeData(currentPage.root)]}
                        selectedKeys={selectedNodeId ? [selectedNodeId] : []}
                        onSelect={(keys) =>
                          setSelectedNodeId(
                            (keys[0] as string | undefined) ?? null,
                          )
                        }
                        draggable
                        onDrop={onTreeDrop}
                        defaultExpandAll
                        blockNode
                      />
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        无页面
                      </Typography.Text>
                    )}
                  </div>
                ),
              },
            ]}
          />
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
