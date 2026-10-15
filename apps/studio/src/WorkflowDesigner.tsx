import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message as antdMessage,
} from "antd";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type {
  Connection,
  Edge as RFEdge,
  Node as RFNode,
  NodeProps,
  NodeTypes,
  OnSelectionChangeFunc,
} from "@xyflow/react";
import type {
  DataSchema,
  Field,
  PermissionSchema,
  WorkflowNode,
  WorkflowSchema,
} from "@naka1205/schema";
import {
  OPS,
  buildTaskAction,
  connectNodes,
  defaultExtrasFor,
  deleteNode,
  demoWorkflows,
  emptyWorkflow,
  insertNodeAfter,
  layoutWorkflow,
  literalOf,
  metaOf,
  newNodeId,
  nodeById,
  nodeSummary,
  parseSimpleCondition,
  parseTaskAction,
  patchNode,
  removeEdge,
  validateExpression,
  validateWorkflowsClient,
  withMeta,
} from "./workflowModel.js";
import type {
  ActionStep,
  FlowMeta,
  TaskActionExtras,
  WorkflowEdge,
} from "./workflowModel.js";
import "@xyflow/react/dist/style.css";
import "./workflow.css";

/**
 * 流程页签（M5.1，增补契约）：图形化设计器 —— 左「流程列表 + 节点物料」、
 * 中「React Flow 画布」、右「节点属性 / 流程基础设置」。
 * 图即唯一事实源：所有编辑（插入 / 删除 / 连线 / 属性）直接作用于 WorkflowSchema
 * 的 nodes/edges，未编辑的图保存时与原图语义完全一致；节点坐标不落库，
 * 载入时自动分层布局，会话内可拖动调整、「自动布局」一键重排。
 * 改动只改本地 bundle（经 onChange 标脏），保存/发布走设计台统一流；
 * 客户端校验与 api validateWorkflows 等价，问题逐条展示且经 onValidityChange
 * 阻断设计台「保存草稿」（服务端存草稿/发布时仍会再校验一次）。
 */

// M5 模块的公开面保留（演示生成 / 步骤互转仍可从本模块引用）
export {
  buildWorkflow,
  demoWorkflows,
  graphToSteps,
  stepsToGraph,
} from "./workflowModel.js";
export type {
  ActionStep,
  ApprovalStep,
  ConditionStep,
  FlowMeta,
  FlowStep,
} from "./workflowModel.js";

// ---------------------------------------------------------------- 画布节点卡片

type WFNodeData = { wfNode: WorkflowNode; summary: string };
type WFNode = RFNode<WFNodeData, "wf">;

const TYPE_META: Record<
  WorkflowNode["type"],
  { tag: string; text: string; border: string }
> = {
  start: { tag: "cyan", text: "开始", border: "#13c2c2" },
  approval: { tag: "blue", text: "审批", border: "#1677ff" },
  condition: { tag: "orange", text: "条件", border: "#fa8c16" },
  task: { tag: "green", text: "自动动作", border: "#52c41a" },
  end: { tag: "default", text: "结束", border: "#8c8c8c" },
};

function FlowNodeCard({ data, selected }: NodeProps<WFNode>) {
  const n = data.wfNode;
  const meta = TYPE_META[n.type];
  return (
    <div
      className="wf-node"
      style={{
        borderColor: selected ? "#1677ff" : meta.border,
        boxShadow: selected
          ? "0 0 0 3px rgba(22,119,255,0.25), 0 2px 8px rgba(0,0,0,0.12)"
          : undefined,
      }}
    >
      {n.type !== "start" && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="wf-node-head">
        <Tag color={meta.tag} style={{ margin: 0 }}>
          {meta.text}
        </Tag>
        <span className="wf-node-label" title={n.label ?? n.id}>
          {n.label?.trim() ? n.label : n.id}
        </span>
      </div>
      <div className="wf-node-summary" title={data.summary}>
        {data.summary}
      </div>
      {n.type !== "end" && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { wf: FlowNodeCard };

// ---------------------------------------------------------------- 小组件

function StatusValueInput({
  field,
  value,
  onChange,
  placeholder,
  width = 200,
}: {
  field: Field | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  if (field?.type === "enum" && field.options && field.options.length > 0) {
    return (
      <Select
        style={{ width }}
        allowClear
        placeholder={placeholder}
        value={value || undefined}
        onChange={(v) => onChange(v ?? "")}
        options={field.options.map((o) => ({ value: o.value, label: o.label }))}
      />
    );
  }
  return (
    <Input
      style={{ width }}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function PanelRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <Typography.Text style={{ width: 92, flexShrink: 0, paddingTop: 5 }}>
        {label}
      </Typography.Text>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- 主组件

export interface WorkflowDesignerProps {
  appId: string;
  data: DataSchema;
  permissions: PermissionSchema | null;
  workflows: WorkflowSchema[] | null;
  onChange: (next: WorkflowSchema[] | null) => void;
  /** 校验问题回调（已带流程名前缀）；空数组 = 全部合法。用于阻断保存草稿。 */
  onValidityChange?: (issues: string[]) => void;
}

export default function WorkflowDesigner({
  appId,
  data,
  permissions,
  workflows,
  onChange,
  onValidityChange,
}: WorkflowDesignerProps) {
  const list = workflows ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newEntityKey, setNewEntityKey] = useState<string | undefined>(undefined);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  /** 选中态的同步镜像：画布重建（buildNodes/buildEdges）在同一提交周期内读它，避免竞态 */
  const selRef = useRef<{ node: string | null; edge: string | null }>({
    node: null,
    edge: null,
  });
  const selectNode = (id: string | null) => {
    selRef.current.node = id;
    setSelectedNodeId(id);
  };
  const selectEdge = (id: string | null) => {
    selRef.current.edge = id;
    setSelectedEdgeId(id);
  };
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<WFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  /** 会话内手动坐标（不落库）：key = `${workflowId}:${nodeId}` */
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  /**
   * 动作节点的步骤式字段缓存（会话级）：动作对象只承载当前 kind 的字段，
   * 切换动作类型时用它保留其他 kind 先前填过的值（与 M5 步骤模型的体验一致）。
   */
  const stepCacheRef = useRef(
    new Map<string, Omit<ActionStep, "id" | "label">>(),
  );

  const selected = list.find((w) => w.id === selectedId) ?? list[0] ?? null;
  const entityOf = (key: string) => data.entities.find((e) => e.key === key);
  const entity = selected ? entityOf(selected.entity) : undefined;

  const roleOptions = useMemo(
    () =>
      permissions
        ? [
            { value: "admin", label: "管理员（admin）" },
            ...permissions.roles.map((r) => ({
              value: r.key,
              label: `${r.label}（${r.key}）`,
            })),
          ]
        : null,
    [permissions],
  );

  const unboundEntities = data.entities.filter(
    (e) => !e.parentField && !list.some((w) => w.entity === e.key),
  );

  // ------------------------------------------------------------ 校验
  const allIssues = useMemo(
    () => validateWorkflowsClient(list, data),
    [list, data],
  );
  const issuesOf = (wfId: string) =>
    allIssues.filter((i) => i.workflowId === wfId).map((i) => i.message);
  const selectedIssues = selected ? issuesOf(selected.id) : [];

  const lastSentRef = useRef<string>("");
  useEffect(() => {
    if (!onValidityChange) return;
    const flat = allIssues.map((i) => {
      const w = list.find((x) => x.id === i.workflowId);
      return `流程「${w?.name ?? i.workflowId}」${i.message}`;
    });
    const key = JSON.stringify(flat);
    if (key !== lastSentRef.current) {
      lastSentRef.current = key;
      onValidityChange(flat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIssues, onValidityChange]);

  // ------------------------------------------------------------ 画布同步
  const buildNodes = (wf: WorkflowSchema): WFNode[] => {
    const layout = layoutWorkflow(wf);
    return wf.nodes.map((n) => ({
      id: n.id,
      type: "wf" as const,
      position:
        posRef.current.get(`${wf.id}:${n.id}`) ??
        layout.get(n.id) ??
        { x: 0, y: 0 },
      data: { wfNode: n, summary: nodeSummary(n, wf, data) },
      selected: n.id === selRef.current.node,
    }));
  };
  const buildEdges = (wf: WorkflowSchema): RFEdge[] =>
    wf.edges.map((e) => {
      const cond = nodeById(wf, e.from)?.type === "condition";
      const color =
        e.label === "true"
          ? "#389e0d"
          : e.label === "false"
            ? "#cf1322"
            : "#8c8c8c";
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        label: e.label ?? undefined,
        selected: e.id === selRef.current.edge,
        style: { stroke: color, strokeWidth: cond ? 1.6 : 1.2 },
        labelStyle: { fill: color, fontWeight: 700, fontSize: 12 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.9 },
        labelBgPadding: [5, 2] as [number, number],
        labelBgBorderRadius: 3,
      };
    });

  const graphSignature = useMemo(
    () =>
      selected ? JSON.stringify([selected.nodes, selected.edges]) : "",
    [selected],
  );

  useEffect(() => {
    selectNode(null);
    selectEdge(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }
    setRfNodes(buildNodes(selected));
    setRfEdges(buildEdges(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, graphSignature]);

  // ------------------------------------------------------------ 提交
  const commit = (next: WorkflowSchema) => {
    onChange(
      list.map((w) =>
        w.id === next.id
          ? { ...next, updatedAt: new Date().toISOString() }
          : w,
      ),
    );
  };
  const commitAndRender = (next: WorkflowSchema) => {
    commit(next);
    setRfNodes(buildNodes(next));
    setRfEdges(buildEdges(next));
  };

  const patchSelectedNode = (nodeId: string, patch: Partial<WorkflowNode>) => {
    if (!selected) return;
    commit(patchNode(selected, nodeId, patch));
  };

  // ------------------------------------------------------------ 画布事件
  const handleSelectionChange: OnSelectionChangeFunc<WFNode, RFEdge> = ({
    nodes,
    edges,
  }) => {
    if (nodes.length > 0) {
      selectNode(nodes[0]!.id);
      selectEdge(null);
    } else if (edges.length > 0) {
      selectEdge(edges[0]!.id);
      selectNode(null);
    } else {
      selectNode(null);
      selectEdge(null);
    }
  };

  const handleConnect = (conn: Connection) => {
    if (!selected || !conn.source || !conn.target) return;
    const res = connectNodes(selected, conn.source, conn.target);
    if (res.error) {
      void antdMessage.warning(res.error);
      return;
    }
    if (res.wf) commitAndRender(res.wf);
  };

  const removeNodes = (ids: string[]) => {
    if (!selected) return;
    let wf = selected;
    let blocked = false;
    for (const id of ids) {
      const n = nodeById(wf, id);
      if (!n) continue;
      if (n.type === "start" || n.type === "end") {
        blocked = true;
        continue;
      }
      wf = deleteNode(wf, id);
    }
    if (blocked) void antdMessage.warning("开始 / 结束节点不可删除");
    if (wf !== selected) {
      commit(wf);
      if (selRef.current.node && !nodeById(wf, selRef.current.node))
        selectNode(null);
    }
    setRfNodes(buildNodes(wf));
    setRfEdges(buildEdges(wf));
  };

  const removeEdges = (ids: string[]) => {
    if (!selected) return;
    let wf = selected;
    for (const id of ids) wf = removeEdge(wf, id);
    if (wf !== selected) {
      commit(wf);
      if (
        selRef.current.edge &&
        !wf.edges.some((e) => e.id === selRef.current.edge)
      )
        selectEdge(null);
    }
    setRfNodes(buildNodes(wf));
    setRfEdges(buildEdges(wf));
  };

  const autoLayout = () => {
    if (!selected) return;
    for (const k of [...posRef.current.keys()]) {
      if (k.startsWith(`${selected.id}:`)) posRef.current.delete(k);
    }
    setRfNodes(buildNodes(selected));
    setRfEdges(buildEdges(selected));
  };

  // ------------------------------------------------------------ 物料添加
  const defaultRole = () =>
    roleOptions?.[1]?.value ?? roleOptions?.[0]?.value ?? "admin";

  const addNode = (kind: "approval" | "condition" | "action") => {
    if (!selected) return;
    const id = newNodeId(new Set(selected.nodes.map((n) => n.id)));
    let node: WorkflowNode;
    if (kind === "approval") {
      node = {
        id,
        type: "approval",
        label: "审批",
        assigneeRule: { kind: "role", role: defaultRole() },
        config: { mode: "any" },
      };
    } else if (kind === "condition") {
      const numField =
        entity?.fields.find((f) => f.type === "int" || f.type === "decimal") ??
        entity?.fields[0];
      const field = numField?.key ?? "";
      node = {
        id,
        type: "condition",
        label: field ? `条件：${field} >= 0` : "条件",
        expression: field ? `${field} >= 0` : "",
      };
    } else {
      const target =
        unboundEntities[0]?.key ??
        data.entities.find((e) => !e.parentField && e.key !== selected.entity)
          ?.key ??
        "";
      const stepFields: Omit<ActionStep, "id" | "label"> = {
        kind: "action",
        actionKind: "createRecord",
        targetEntity: target,
        seqPrefix: "IN-",
        warehouseId: "wh-01",
        startWorkflow: false,
      };
      node = {
        id,
        type: "task",
        label: "自动动作",
        action: buildTaskAction(stepFields, null, selected.entity, data),
      };
    }
    const wf = insertNodeAfter(selected, selectedNodeId, node);
    commit(wf);
    selectNode(id);
    selectEdge(null);
    setRfNodes(buildNodes(wf));
    setRfEdges(buildEdges(wf));
  };

  const createWorkflow = () => {
    const ent = newEntityKey ? entityOf(newEntityKey) : undefined;
    if (!ent) return;
    const wf = emptyWorkflow(appId, ent);
    onChange([...list, wf]);
    setSelectedId(wf.id);
    setNewEntityKey(undefined);
  };

  const initDemo = () => {
    const demos = demoWorkflows(appId, data);
    if (demos.length === 0) return;
    onChange([...list, ...demos]);
    setSelectedId(demos[0]!.id);
  };

  const roleSelect = (
    value: string,
    onRole: (v: string) => void,
    width = "100%",
  ) => {
    if (!roleOptions) {
      return (
        <Input
          style={{ width }}
          placeholder="角色 key（如 manager）"
          value={value}
          onChange={(e) => onRole(e.target.value)}
        />
      );
    }
    const options = roleOptions.some((o) => o.value === value)
      ? roleOptions
      : [...roleOptions, { value, label: value }];
    return (
      <Select
        style={{ width }}
        value={value || undefined}
        placeholder="选择审批角色"
        onChange={onRole}
        options={options}
      />
    );
  };

  const meta = selected ? metaOf(selected) : null;
  const statusFieldDef = entity?.fields.find(
    (f) => f.key === (meta?.statusField || "status"),
  );
  const selectedNode = selectedNodeId && selected
    ? (nodeById(selected, selectedNodeId) ?? null)
    : null;
  const selectedEdge = selectedEdgeId && selected
    ? (selected.edges.find((e) => e.id === selectedEdgeId) ?? null)
    : null;

  const commitMeta = (next: FlowMeta) => {
    if (!selected) return;
    commit(withMeta(selected, next));
  };

  // ------------------------------------------------------------ 属性面板：审批
  const renderApproval = (
    node: WorkflowNode,
    patch: (p: Partial<WorkflowNode>) => void,
  ) => {
    const rule = (node.assigneeRule ?? {}) as {
      kind?: unknown;
      role?: unknown;
      username?: unknown;
    };
    const cfg = node.config ?? {};
    const advancedRule = rule.kind !== "role" && rule.kind !== "user";
    return (
      <>
        <PanelRow label="指派方式">
          <Select
            style={{ width: "100%" }}
            disabled={advancedRule}
            placeholder={advancedRule ? "高级指派规则" : undefined}
            value={advancedRule ? undefined : (rule.kind as string)}
            onChange={(v) =>
              patch({
                assigneeRule:
                  v === "user"
                    ? {
                        kind: "user",
                        username:
                          typeof rule.username === "string"
                            ? rule.username
                            : "",
                      }
                    : {
                        kind: "role",
                        role:
                          typeof rule.role === "string" && rule.role
                            ? rule.role
                            : defaultRole(),
                      },
              })
            }
            options={[
              { value: "role", label: "按角色" },
              { value: "user", label: "指定用户" },
            ]}
          />
        </PanelRow>
        {advancedRule && (
          <Alert
            type="warning"
            showIcon
            message="该节点的指派规则为高级形态（如按字段指派），图设计器不改写它；审批模式与进入时状态仍可编辑。"
          />
        )}
        {rule.kind === "role" && (
          <PanelRow label="审批角色">
            {roleSelect(
              typeof rule.role === "string" ? rule.role : "",
              (v) => patch({ assigneeRule: { kind: "role", role: v } }),
            )}
          </PanelRow>
        )}
        {rule.kind === "user" && (
          <PanelRow label="指定用户">
            <Input
              placeholder="用户名（如 zhangjing）"
              value={typeof rule.username === "string" ? rule.username : ""}
              onChange={(e) =>
                patch({
                  assigneeRule: { kind: "user", username: e.target.value },
                })
              }
            />
          </PanelRow>
        )}
        <PanelRow label="审批模式">
          <Select
            style={{ width: "100%" }}
            value={cfg.mode === "all" ? "all" : "any"}
            onChange={(v) => patch({ config: { ...cfg, mode: v } })}
            options={[
              { value: "any", label: "或签（一人通过即可）" },
              { value: "all", label: "会签（全部通过）" },
            ]}
          />
        </PanelRow>
        <PanelRow label="进入时状态">
          <StatusValueInput
            field={statusFieldDef}
            value={typeof cfg.statusOnEnter === "string" ? cfg.statusOnEnter : ""}
            onChange={(v) => {
              const c: Record<string, unknown> = { ...cfg };
              if (v) c.statusOnEnter = v;
              else delete c.statusOnEnter;
              patch({ config: c });
            }}
            placeholder="不设置"
            width={212}
          />
        </PanelRow>
      </>
    );
  };

  // ------------------------------------------------------------ 属性面板：条件
  const renderCondition = (
    node: WorkflowNode,
    patch: (p: Partial<WorkflowNode>) => void,
  ) => {
    const expr = node.expression ?? "";
    const simple = expr ? parseSimpleCondition(expr) : null;
    const err = expr ? validateExpression(expr) : null;
    if (simple) {
      const autoLabel = (f: string, op: string, v: string) =>
        `条件：${f} ${op} ${v}`;
      const isAuto =
        !node.label ||
        node.label === autoLabel(simple.field, simple.op, simple.value);
      const applySimple = (f: string, op: string, v: string) =>
        patch({
          expression: `${f} ${op} ${literalOf(v)}`,
          ...(isAuto ? { label: autoLabel(f, op, v) } : {}),
        });
      return (
        <>
          <PanelRow label="字段">
            <Select
              style={{ width: "100%" }}
              placeholder="选择字段"
              value={simple.field || undefined}
              onChange={(v) => applySimple(v, simple.op, simple.value)}
              options={(entity?.fields ?? []).map((f) => ({
                value: f.key,
                label: `${f.label}（${f.key}）`,
              }))}
            />
          </PanelRow>
          <PanelRow label="运算符">
            <Select
              style={{ width: "100%" }}
              value={simple.op}
              onChange={(v) => applySimple(simple.field, v, simple.value)}
              options={OPS.map((o) => ({ value: o, label: o }))}
            />
          </PanelRow>
          <PanelRow label="值">
            <Input
              placeholder="如 5000"
              value={simple.value}
              onChange={(e) => applySimple(simple.field, simple.op, e.target.value)}
            />
          </PanelRow>
          <PanelRow label="表达式原文">
            <Typography.Text code style={{ fontSize: 12 }}>
              {expr}
            </Typography.Text>
          </PanelRow>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            语义：条件成立走 true 边、不成立走 false
            边；两条分支须最终汇合到同一节点或结束节点。
          </Typography.Text>
        </>
      );
    }
    return (
      <>
        <PanelRow label="表达式">
          <Input.TextArea
            rows={3}
            value={expr}
            placeholder="如 total_amount >= 5000 && status == '草稿'"
            onChange={(e) => patch({ expression: e.target.value })}
          />
        </PanelRow>
        {err ? (
          <Alert type="error" showIcon message={`表达式不合法：${err}`} />
        ) : expr ? (
          <Alert
            type="info"
            showIcon
            message="复合表达式模式：含 && / || / 括号的表达式在此直接编辑原文，保存前会做语法校验。"
          />
        ) : (
          <Alert type="warning" showIcon message="尚未设置表达式" />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          单个比较（字段 运算符 值）会自动切换为结构化编辑；条件成立走 true
          边、不成立走 false 边，两支须最终汇合。
        </Typography.Text>
      </>
    );
  };

  // ------------------------------------------------------------ 属性面板：自动动作
  const renderTask = (
    node: WorkflowNode,
    patch: (p: Partial<WorkflowNode>) => void,
  ) => {
    if (!selected) return null;
    const kindOptions = [
      { value: "createRecord", label: "生成记录" },
      { value: "applyInventory", label: "库存增减" },
      { value: "setStatus", label: "设置状态" },
      { value: "webhook", label: "Webhook 通知" },
    ];
    const kindSelect = (
      value: ActionStep["actionKind"] | undefined,
      onKind: (k: ActionStep["actionKind"]) => void,
      placeholder?: string,
    ) => (
      <Select
        style={{ width: "100%" }}
        value={value}
        placeholder={placeholder}
        onChange={onKind}
        options={kindOptions}
      />
    );
    const parsed = node.action
      ? parseTaskAction(node.action, selected.entity, data)
      : null;

    if (!parsed) {
      const kind = (node.action ?? {}).kind;
      return (
        <>
          <PanelRow label="动作类型">
            {kindSelect(undefined, (k) => {
              const base = defaultStepForKind(k);
              stepCacheRef.current.set(node.id, base);
              patch({
                action: buildTaskAction(base, null, selected.entity, data),
              });
            }, "选择类型以替换当前动作")}
          </PanelRow>
          <Alert
            type="warning"
            showIcon
            message="高级动作配置"
            description={`当前动作（${typeof kind === "string" ? kind : "未设置"}）含图设计器未建模的字段映射，本面板不会改写它；节点可改名、移动、删除与连线。选择上方动作类型可整体替换为可编辑动作。`}
          />
        </>
      );
    }

    const step: Omit<ActionStep, "id" | "label"> = {
      ...(stepCacheRef.current.get(node.id) ?? {}),
      ...parsed.step,
    };
    const applyStep = (
      p: Partial<Omit<ActionStep, "id" | "label">>,
      exOverride?: TaskActionExtras,
    ) => {
      const next = { ...step, ...p };
      let ex = exOverride ?? parsed.extras;
      if (p.targetEntity && p.targetEntity !== step.targetEntity) {
        ex = defaultExtrasFor(entityOf(p.targetEntity), selected.entity);
      }
      if (p.seqPrefix !== undefined) ex = { ...ex, hasSeq: true };
      stepCacheRef.current.set(node.id, next);
      patch({ action: buildTaskAction(next, ex, selected.entity, data) });
    };
    const switchKind = (k: ActionStep["actionKind"]) => {
      // 与 M5 步骤模型一致：字段对象累积各 kind 的值，切换类型不丢已填字段；
      // 新类型的缺省值只补空缺（step 已有值优先）。
      const merged: Omit<ActionStep, "id" | "label"> = {
        ...defaultStepForKind(k),
        ...step,
        actionKind: k,
      };
      stepCacheRef.current.set(node.id, merged);
      patch({
        action: buildTaskAction(
          merged,
          k === "createRecord"
            ? defaultExtrasFor(
                entityOf(merged.targetEntity ?? ""),
                selected.entity,
              )
            : null,
          selected.entity,
          data,
        ),
      });
    };

    return (
      <>
        <PanelRow label="动作类型">
          {kindSelect(step.actionKind, switchKind)}
        </PanelRow>
        {step.actionKind === "createRecord" && (
          <>
            <PanelRow label="目标实体">
              <Select
                style={{ width: "100%" }}
                placeholder="选择目标实体"
                value={step.targetEntity || undefined}
                onChange={(v) => applyStep({ targetEntity: v })}
                options={data.entities
                  .filter((e) => !e.parentField)
                  .map((e) => ({
                    value: e.key,
                    label: `${e.label}（${e.key}）`,
                  }))}
              />
            </PanelRow>
            <PanelRow label="单号序列前缀">
              <Input
                value={step.seqPrefix ?? ""}
                onChange={(e) => applyStep({ seqPrefix: e.target.value })}
              />
            </PanelRow>
            <PanelRow label="仓库常量">
              <Input
                placeholder="wh-01"
                value={step.warehouseId ?? ""}
                onChange={(e) => applyStep({ warehouseId: e.target.value })}
              />
            </PanelRow>
            <PanelRow label="自动发起目标流程">
              <Switch
                checked={Boolean(step.startWorkflow)}
                onChange={(v) => applyStep({ startWorkflow: v })}
              />
            </PanelRow>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              生成规则：目标实体的单号字段（in_no）按前缀生成序列；指向本实体的引用字段自动填源记录；仓库常量写入
              warehouse_id（演示主仓库 wh-01，可改）；日期字段（in_date）填当天。
            </Typography.Text>
          </>
        )}
        {step.actionKind === "applyInventory" && (
          <>
            <PanelRow label="模式">
              <Select
                style={{ width: "100%" }}
                value={step.invMode ?? "in"}
                onChange={(v) =>
                  applyStep({ invMode: v as "in" | "out" })
                }
                options={[
                  { value: "in", label: "入库（按明细增加库存）" },
                  { value: "out", label: "出库（按明细扣减库存）" },
                ]}
              />
            </PanelRow>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              入库按本单明细逐项增加库存；出库先校验总量、不足则驳回本次操作。执行后逐物料检查低库存并预警。
            </Typography.Text>
          </>
        )}
        {step.actionKind === "setStatus" && (
          <PanelRow label="状态值">
            <StatusValueInput
              field={statusFieldDef}
              value={step.statusValue ?? ""}
              onChange={(v) => applyStep({ statusValue: v })}
              placeholder="写入状态字段的值"
              width={212}
            />
          </PanelRow>
        )}
        {step.actionKind === "webhook" && (
          <>
            <PanelRow label="URL">
              <Input
                placeholder="https://…"
                value={step.url ?? ""}
                onChange={(e) => applyStep({ url: e.target.value })}
              />
            </PanelRow>
            <PanelRow label="事件名">
              <Input
                placeholder="如 order_approved"
                value={step.event ?? ""}
                onChange={(e) => applyStep({ event: e.target.value })}
              />
            </PanelRow>
          </>
        )}
      </>
    );
  };

  const defaultStepForKind = (
    k: ActionStep["actionKind"],
  ): Omit<ActionStep, "id" | "label"> => {
    switch (k) {
      case "createRecord":
        return {
          kind: "action",
          actionKind: "createRecord",
          targetEntity:
            unboundEntities[0]?.key ??
            data.entities.find(
              (e) => !e.parentField && e.key !== selected?.entity,
            )?.key ??
            "",
          seqPrefix: "IN-",
          warehouseId: "wh-01",
          startWorkflow: false,
        };
      case "applyInventory":
        return { kind: "action", actionKind: "applyInventory", invMode: "in" };
      case "setStatus":
        return { kind: "action", actionKind: "setStatus", statusValue: "" };
      case "webhook":
        return { kind: "action", actionKind: "webhook", url: "", event: "" };
    }
  };

  // ------------------------------------------------------------ 属性面板：节点
  const renderNodePanel = (node: WorkflowNode) => {
    const patch = (p: Partial<WorkflowNode>) => patchSelectedNode(node.id, p);
    const cfg = node.config ?? {};
    return (
      <Space direction="vertical" size={12} style={{ display: "flex" }}>
        <Space size={8}>
          <Tag color={TYPE_META[node.type].tag}>
            {TYPE_META[node.type].text}节点
          </Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {node.id}
          </Typography.Text>
        </Space>
        <PanelRow label="名称">
          <Input
            value={node.label ?? ""}
            placeholder={node.id}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </PanelRow>
        {node.type === "start" && (
          <Alert
            type="info"
            showIcon
            message="开始节点：流程入口。记录处于「可发起状态值」（缺省为草稿）时，可从运行态待办中心发起本流程。"
          />
        )}
        {node.type === "approval" && renderApproval(node, patch)}
        {node.type === "condition" && renderCondition(node, patch)}
        {node.type === "task" && renderTask(node, patch)}
        {node.type === "end" && (
          <>
            <PanelRow label="完成状态值">
              <StatusValueInput
                field={statusFieldDef}
                value={
                  typeof cfg.finalStatus === "string" ? cfg.finalStatus : ""
                }
                onChange={(v) => {
                  const c: Record<string, unknown> = { ...cfg };
                  if (v) c.finalStatus = v;
                  else delete c.finalStatus;
                  patch({ config: c });
                }}
                placeholder="如：已通过"
                width={212}
              />
            </PanelRow>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              流程到达结束节点时，把完成状态镜像写回记录的状态字段；留空则不写回完成状态。
            </Typography.Text>
          </>
        )}
        {node.type !== "start" && node.type !== "end" && (
          <Button danger block onClick={() => removeNodes([node.id])}>
            删除该节点（自动改接上下游）
          </Button>
        )}
      </Space>
    );
  };

  // ------------------------------------------------------------ 属性面板：连线
  const renderEdgePanel = (edge: WorkflowEdge) => {
    if (!selected) return null;
    const from = nodeById(selected, edge.from);
    const to = nodeById(selected, edge.to);
    const nameOf = (n?: WorkflowNode) =>
      n?.label?.trim() ? n.label : (n?.id ?? "?");
    return (
      <Space direction="vertical" size={12} style={{ display: "flex" }}>
        <Space size={8}>
          <Tag>连线</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {edge.id}
          </Typography.Text>
        </Space>
        <PanelRow label="来源">
          <Typography.Text>{nameOf(from)}</Typography.Text>
        </PanelRow>
        <PanelRow label="目标">
          <Typography.Text>{nameOf(to)}</Typography.Text>
        </PanelRow>
        {from?.type === "condition" ? (
          <PanelRow label="分支标签">
            <Select
              style={{ width: "100%" }}
              value={edge.label ?? "true"}
              onChange={(v) =>
                commit({
                  ...selected,
                  edges: selected.edges.map((e) =>
                    e.id === edge.id ? { ...e, label: v } : e,
                  ),
                })
              }
              options={[
                { value: "true", label: "true（条件成立）" },
                { value: "false", label: "false（条件不成立）" },
              ]}
            />
          </PanelRow>
        ) : (
          <PanelRow label="分支标签">
            <Typography.Text type="secondary">普通连线无标签</Typography.Text>
          </PanelRow>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          条件节点的两条出边须分别标记 true 与 false，否则校验不通过。
        </Typography.Text>
        <Button danger block onClick={() => removeEdges([edge.id])}>
          删除连线
        </Button>
      </Space>
    );
  };

  // ------------------------------------------------------------ 属性面板：基础设置
  const renderBasePanel = () => {
    if (!selected || !meta) return null;
    return (
      <Space direction="vertical" size={12} style={{ display: "flex" }}>
        <Typography.Text strong>流程基础设置</Typography.Text>
        <PanelRow label="绑定实体">
          <Tag color="blue">
            {entity?.label ?? selected.entity}（{selected.entity}）
          </Tag>
        </PanelRow>
        <PanelRow label="状态字段">
          <Select
            style={{ width: "100%" }}
            value={meta.statusField}
            onChange={(v) => commitMeta({ ...meta, statusField: v })}
            options={[
              { value: "", label: "（不设置，流程状态不写回记录）" },
              ...(entity?.fields ?? []).map((f) => ({
                value: f.key,
                label: `${f.label}（${f.key}）`,
              })),
            ]}
          />
        </PanelRow>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          审批进入 / 完成 / 驳回时，流程状态镜像写回该字段。
        </Typography.Text>
        <PanelRow label="可发起状态值">
          <StatusValueInput
            field={statusFieldDef}
            value={meta.initialStatus}
            onChange={(v) => commitMeta({ ...meta, initialStatus: v })}
            placeholder="缺省：草稿"
            width={212}
          />
        </PanelRow>
        <PanelRow label="驳回状态值">
          <StatusValueInput
            field={statusFieldDef}
            value={meta.rejectStatus}
            onChange={(v) => commitMeta({ ...meta, rejectStatus: v })}
            placeholder="缺省：已驳回"
            width={212}
          />
        </PanelRow>
        <PanelRow label="完成状态值">
          <StatusValueInput
            field={statusFieldDef}
            value={meta.finalStatus}
            onChange={(v) => commitMeta({ ...meta, finalStatus: v })}
            placeholder="如：已通过"
            width={212}
          />
        </PanelRow>
        <PanelRow label="低库存 Webhook">
          <Input
            placeholder="https://…（留空 = 只记录低库存事件，不投递）"
            value={meta.lowStockWebhookUrl}
            onChange={(e) =>
              commitMeta({ ...meta, lowStockWebhookUrl: e.target.value })
            }
          />
        </PanelRow>
        <PanelRow label="抄送角色">
          {roleOptions ? (
            <Select
              style={{ width: "100%" }}
              mode="multiple"
              allowClear
              placeholder="流程完成 / 驳回时通知这些角色"
              value={meta.ccRoles}
              onChange={(v) => commitMeta({ ...meta, ccRoles: v })}
              options={roleOptions}
            />
          ) : (
            <Select
              style={{ width: "100%" }}
              mode="tags"
              allowClear
              placeholder="输入角色 key 后回车"
              value={meta.ccRoles}
              onChange={(v) => commitMeta({ ...meta, ccRoles: v })}
            />
          )}
        </PanelRow>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          在画布上点选节点编辑其属性，点选连线可改分支标签或删除；从节点右侧圆点拖到另一节点左侧圆点即可连线（条件节点的出边自动补
          true/false 标签）。
        </Typography.Text>
      </Space>
    );
  };

  // ------------------------------------------------------------ 布局
  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* ------------------------------------------------ 左列：流程列表 + 节点物料 */}
      <div
        style={{
          width: 250,
          borderRight: "1px solid #f0f0f0",
          padding: 12,
          overflowY: "auto",
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <Typography.Text strong>流程列表</Typography.Text>
          <div style={{ flex: 1 }} />
          <Tag>{list.length} 条</Tag>
        </div>
        <List
          size="small"
          dataSource={list}
          locale={{ emptyText: "尚未建立任何流程" }}
          renderItem={(w) => {
            const wIssues = issuesOf(w.id);
            return (
              <List.Item
                onClick={() => setSelectedId(w.id)}
                style={{
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: selected?.id === w.id ? "#e6f4ff" : undefined,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{w.name}</div>
                  <div style={{ color: "#9ca3af", fontSize: 12 }}>
                    {entityOf(w.entity)?.label ?? w.entity}（{w.entity}）·{" "}
                    {w.nodes.length} 个节点 · 状态字段{" "}
                    {w.statusField ?? "status"}
                  </div>
                  {wIssues.length > 0 && (
                    <div style={{ color: "#cf1322", fontSize: 12 }}>
                      {wIssues.length} 个校验问题
                    </div>
                  )}
                </div>
              </List.Item>
            );
          }}
        />
        {list.length === 0 && (
          <div style={{ marginTop: 16 }}>
            <Button type="primary" block onClick={initDemo}>
              初始化演示流程
            </Button>
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 8 }}
            >
              一键生成三条演示流程：采购单三档审批（主管 → 金额≥5000 总监 →
              金额≥50000 财务会签 → 自动生成入库单）、入库确认（仓库确认 →
              库存入账）、领用审批发放（经理 → 仓库发放 →
              库存扣减）。生成后进入草稿，核对无误再保存并发布。
            </Typography.Paragraph>
          </div>
        )}
        {selected && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
              节点物料
            </Typography.Text>
            <Space direction="vertical" size={8} style={{ display: "flex" }}>
              <Button block onClick={() => addNode("approval")}>
                + 审批节点
              </Button>
              <Button block onClick={() => addNode("condition")}>
                + 条件节点
              </Button>
              <Button block onClick={() => addNode("action")}>
                + 自动动作
              </Button>
            </Space>
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 8 }}
            >
              选中画布节点后添加 = 插入到该节点之后（条件节点接其 true
              边）；未选中 = 接到主链末尾。画布上可拖线连接节点，Del
              键删除选中的节点 / 连线。
            </Typography.Paragraph>
          </div>
        )}
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
            新建流程
          </Typography.Text>
          <Space.Compact style={{ width: "100%" }}>
            <Select
              style={{ flex: 1 }}
              placeholder="选择未绑定的实体"
              value={newEntityKey}
              onChange={setNewEntityKey}
              options={unboundEntities.map((e) => ({
                value: e.key,
                label: `${e.label}（${e.key}）`,
              }))}
            />
            <Button type="primary" ghost disabled={!newEntityKey} onClick={createWorkflow}>
              新建
            </Button>
          </Space.Compact>
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 8 }}
          >
            一个实体最多绑定一条流程；子表实体不能独立发起流程。
          </Typography.Paragraph>
        </div>
      </div>

      {/* ------------------------------------------------ 中列：画布 */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: 12,
          minWidth: 0,
          background: "#fff",
        }}
      >
        {!selected ? (
          <Typography.Text type="secondary">
            从左侧选择一条流程开始设计，或新建流程 / 初始化演示流程。
          </Typography.Text>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              <span>
                流程名称：
                <Input
                  style={{ width: 220, marginLeft: 8 }}
                  value={selected.name}
                  onChange={(e) =>
                    commit({ ...selected, name: e.target.value })
                  }
                />
              </span>
              <Tag color="blue">
                绑定实体：{entity?.label ?? selected.entity}（{selected.entity}）
              </Tag>
              {selectedIssues.length > 0 ? (
                <Tag color="red">{selectedIssues.length} 个校验问题</Tag>
              ) : (
                <Tag color="green">校验通过</Tag>
              )}
              <div style={{ flex: 1 }} />
              <Button size="small" onClick={autoLayout}>
                自动布局
              </Button>
              <Popconfirm
                title="删除该流程？"
                description="流程将从设计草稿中移除；已在运行的流程实例不受影响，发布后新记录不能再发起该流程。"
                onConfirm={() => {
                  onChange(list.filter((w) => w.id !== selected.id));
                  setSelectedId(null);
                }}
              >
                <Button danger size="small">
                  删除流程
                </Button>
              </Popconfirm>
            </div>
            <div className="wf-canvas-wrap">
              <ReactFlow
                key={selected.id}
                nodes={rfNodes}
                edges={rfEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={handleConnect}
                onSelectionChange={handleSelectionChange}
                onNodesDelete={(ns) => removeNodes(ns.map((n) => n.id))}
                onEdgesDelete={(es) => removeEdges(es.map((e) => e.id))}
                onNodeDragStop={(_, node) => {
                  posRef.current.set(
                    `${selected.id}:${node.id}`,
                    node.position,
                  );
                }}
                nodeTypes={nodeTypes}
                deleteKeyCode={["Backspace", "Delete"]}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                minZoom={0.2}
                maxZoom={1.75}
              >
                <Background gap={16} color="#e5e7eb" />
                <Controls />
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 120, height: 80 }}
                  nodeColor={(n) =>
                    TYPE_META[
                      (n.data as WFNodeData | undefined)?.wfNode.type ??
                        "approval"
                    ].border
                  }
                />
              </ReactFlow>
            </div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 12, marginTop: 8 }}
            >
              节点坐标仅在本次会话内保留（不随草稿保存），重新打开时自动布局排布。条件分支必须汇合：true
              / false 两条出边最终到达同一节点或结束节点。
            </Typography.Text>
          </>
        )}
      </div>

      {/* ------------------------------------------------ 右列：属性 */}
      {selected && (
        <div
          style={{
            width: 340,
            borderLeft: "1px solid #f0f0f0",
            padding: 12,
            overflowY: "auto",
            flexShrink: 0,
            background: "#fff",
          }}
        >
          {selectedIssues.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={`流程校验未通过（${selectedIssues.length}）`}
              description={
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {selectedIssues.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              }
            />
          )}
          {selectedEdge
            ? renderEdgePanel(selectedEdge)
            : selectedNode
              ? renderNodePanel(selectedNode)
              : renderBasePanel()}
        </div>
      )}
    </div>
  );
}
