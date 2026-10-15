import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import type {
  DataSchema,
  Entity,
  Field,
  PermissionSchema,
  WorkflowNode,
  WorkflowSchema,
} from "@naka1205/schema";

/** schema 包未单独导出边类型，从 WorkflowSchema 派生 */
type WorkflowEdge = WorkflowSchema["edges"][number];

/**
 * 流程页签（M5，契约 §9）：步骤式编辑器 ⇄ WorkflowSchema 图序列化。
 * 步骤模型是 §4.1 图子集的线性表示：审批 / 条件 / 动作三类步骤顺序排列，
 * 条件步骤门控其下一步骤（true 走下一步骤，false 跳过下一步骤）。
 * steps ⇄ graph 互转在本文件内实现；graphToSteps 遇到子集外结构返回 null，
 * UI 显示「高级结构，步骤视图只读」且不产生任何 bundle 改动。
 * 流程配置属于设计包的一部分：改动只改本地 bundle（经 onChange 标脏），
 * 走设计台既有「保存草稿 → 发布」流，服务端在存草稿/发布时做 validateWorkflows 校验。
 */

// ---------------------------------------------------------------- 步骤模型

export interface ApprovalStep {
  id: string;
  kind: "approval";
  label: string;
  role: string;
  mode: "any" | "all";
  statusOnEnter?: string;
}

export interface ConditionStep {
  id: string;
  kind: "condition";
  field: string;
  op: string;
  /** UI 内以文本保存；序列化时纯数字写裸数字、其余写单引号字符串 */
  value: string;
}

export interface ActionStep {
  id: string;
  kind: "action";
  label: string;
  actionKind: "createRecord" | "applyInventory" | "setStatus" | "webhook";
  // createRecord
  targetEntity?: string;
  seqPrefix?: string;
  warehouseId?: string;
  startWorkflow?: boolean;
  // applyInventory
  invMode?: "in" | "out";
  // setStatus
  statusValue?: string;
  // webhook
  url?: string;
  event?: string;
}

export type FlowStep = ApprovalStep | ConditionStep | ActionStep;

/** 流程级编辑元数据（落在 WorkflowSchema 的 statusField / settings / end 节点 config） */
export interface FlowMeta {
  /** 空串 = 不设置 statusField（引擎缺省 status，且实体无该字段时不镜像） */
  statusField: string;
  initialStatus: string;
  rejectStatus: string;
  finalStatus: string;
  lowStockWebhookUrl: string;
  ccRoles: string[];
}

let stepSeq = 0;
function newStepId(): string {
  stepSeq += 1;
  return `s-${Date.now().toString(36)}-${stepSeq}`;
}

// ---------------------------------------------------------------- 序列化

const OPS = [">=", "<=", ">", "<", "==", "!="] as const;

/** 表达式字面量：纯数字裸写，其余单引号包裹 */
function literalOf(value: string): string {
  const t = value.trim();
  if (t !== "" && !Number.isNaN(Number(t))) return t;
  return `'${t.replace(/'/g, "")}'`;
}

function expressionOf(step: ConditionStep): string {
  return `${step.field} ${step.op} ${literalOf(step.value)}`;
}

/** 步骤列表 → 图（§4.1 子集）：start → 步骤链 → end，条件步骤以 true/false 边门控下一步骤 */
export function stepsToGraph(
  steps: FlowStep[],
  meta: FlowMeta,
  sourceEntity: string,
  data: DataSchema,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = [{ id: "start", type: "start", label: "开始" }];
  const edges: WorkflowEdge[] = [];
  const edge = (from: string, to: string, label?: string) =>
    edges.push({ id: `e:${from}->${to}${label ? `:${label}` : ""}`, from, to, ...(label ? { label } : {}) });

  for (const step of steps) {
    if (step.kind === "approval") {
      nodes.push({
        id: step.id,
        type: "approval",
        label: step.label,
        assigneeRule: { kind: "role", role: step.role },
        config: {
          mode: step.mode,
          ...(step.statusOnEnter ? { statusOnEnter: step.statusOnEnter } : {}),
        },
      });
    } else if (step.kind === "condition") {
      nodes.push({
        id: step.id,
        type: "condition",
        label: `条件：${step.field} ${step.op} ${step.value}`,
        expression: expressionOf(step),
      });
    } else {
      nodes.push({
        id: step.id,
        type: "task",
        label: step.label,
        action: actionOf(step, sourceEntity, data),
      });
    }
  }
  nodes.push({
    id: "end",
    type: "end",
    label: "结束",
    ...(meta.finalStatus ? { config: { finalStatus: meta.finalStatus } } : {}),
  });

  const nodeIdAt = (i: number): string => (i < steps.length ? steps[i]!.id : "end");
  edge("start", nodeIdAt(0));
  steps.forEach((step, i) => {
    if (step.kind === "condition") {
      edge(step.id, nodeIdAt(i + 1), "true");
      edge(step.id, nodeIdAt(i + 2), "false");
    } else {
      edge(step.id, nodeIdAt(i + 1));
    }
  });
  return { nodes, edges };
}

function actionOf(
  step: ActionStep,
  sourceEntity: string,
  data: DataSchema,
): Record<string, unknown> {
  switch (step.actionKind) {
    case "setStatus":
      return { kind: "setStatus", value: step.statusValue ?? "" };
    case "applyInventory":
      return { kind: "applyInventory", mode: step.invMode ?? "in" };
    case "webhook":
      return {
        kind: "webhook",
        url: step.url ?? "",
        ...(step.event ? { event: step.event } : {}),
      };
    case "createRecord": {
      const target = data.entities.find((e) => e.key === step.targetEntity);
      const fields: Record<string, unknown> = {};
      if (target) {
        const has = (k: string) => target.fields.some((f) => f.key === k);
        if (has("in_no")) fields.in_no = { seq: step.seqPrefix || "IN-" };
        // 指向源实体的引用字段（如入库单的 order_id）← 源记录 id
        const link = target.fields.find(
          (f) => f.type === "ref" && f.refEntity === sourceEntity,
        );
        if (link) fields[link.key] = { from: "id" };
        if (has("warehouse_id") && step.warehouseId)
          fields.warehouse_id = { const: step.warehouseId };
        if (has("in_date")) fields.in_date = { today: true };
      }
      return {
        kind: "createRecord",
        entity: step.targetEntity ?? "",
        fields,
        ...(step.startWorkflow ? { startWorkflow: true } : {}),
      };
    }
  }
}

/** 图 → 步骤列表；子集外结构返回 null（UI 只读） */
export function graphToSteps(
  wf: WorkflowSchema,
  data: DataSchema,
): { steps: FlowStep[]; meta: FlowMeta } | null {
  const nodeMap = new Map<string, WorkflowNode>();
  for (const n of wf.nodes) {
    if (nodeMap.has(n.id)) return null;
    nodeMap.set(n.id, n);
  }
  const start = nodeMap.get("start");
  const end = nodeMap.get("end");
  if (!start || start.type !== "start" || !end || end.type !== "end") return null;
  if (wf.nodes.filter((n) => n.type === "start" || n.type === "end").length !== 2)
    return null;

  const out = new Map<string, WorkflowEdge[]>();
  for (const e of wf.edges) {
    if (!nodeMap.has(e.from) || !nodeMap.has(e.to)) return null;
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
  }
  if ((out.get("end") ?? []).length !== 0) return null;

  // 沿主链行走：普通节点走唯一出边，条件节点走 true 边
  const order: WorkflowNode[] = [];
  const visited = new Set<string>(["start"]);
  let cur: WorkflowNode = start;
  for (;;) {
    const outs = out.get(cur.id) ?? [];
    let nextId: string;
    if (cur.type === "condition") {
      if (outs.length !== 2) return null;
      const t = outs.find((e) => e.label === "true");
      const f = outs.find((e) => e.label === "false");
      if (!t || !f) return null;
      nextId = t.to;
    } else {
      if (outs.length !== 1) return null;
      nextId = outs[0]!.to;
    }
    if (nextId === "end") break;
    const next = nodeMap.get(nextId);
    if (!next || visited.has(nextId)) return null;
    visited.add(nextId);
    order.push(next);
    cur = next;
  }
  if (order.length !== wf.nodes.length - 2) return null; // 有不可达节点

  // 校验每条边都与子集形态一致（主链边 + 条件 false 边指向下下个节点）
  const idAt = (i: number): string => (i < order.length ? order[i]!.id : "end");
  const expected = new Map<string, number>();
  const expect = (from: string, to: string, label?: string) => {
    const k = `${from}->${to}:${label ?? ""}`;
    expected.set(k, (expected.get(k) ?? 0) + 1);
  };
  expect("start", idAt(0));
  order.forEach((n, i) => {
    if (n.type === "condition") {
      expect(n.id, idAt(i + 1), "true");
      expect(n.id, idAt(i + 2), "false");
    } else {
      expect(n.id, idAt(i + 1));
    }
  });
  for (const e of wf.edges) {
    const k = `${e.from}->${e.to}:${e.label ?? ""}`;
    const left = expected.get(k) ?? 0;
    if (left <= 0) return null;
    expected.set(k, left - 1);
  }

  const steps: FlowStep[] = [];
  for (const n of order) {
    const step = nodeToStep(n, wf, data);
    if (!step) return null;
    steps.push(step);
  }

  const settings = wf.settings ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const endConfig = end.config ?? {};
  const meta: FlowMeta = {
    statusField: wf.statusField ?? "",
    initialStatus: str(settings.initialStatus),
    rejectStatus: str(settings.rejectStatus),
    finalStatus: str(endConfig.finalStatus),
    lowStockWebhookUrl: str(settings.lowStockWebhookUrl),
    ccRoles: Array.isArray(settings.ccRoles)
      ? settings.ccRoles.filter((x): x is string => typeof x === "string")
      : [],
  };
  return { steps, meta };
}

function nodeToStep(
  n: WorkflowNode,
  wf: WorkflowSchema,
  data: DataSchema,
): FlowStep | null {
  if (n.type === "approval") {
    const rule = n.assigneeRule ?? {};
    if (rule.kind !== "role" || typeof rule.role !== "string" || !rule.role)
      return null;
    const config = n.config ?? {};
    const mode = config.mode ?? "any";
    if (mode !== "any" && mode !== "all") return null;
    const statusOnEnter = config.statusOnEnter;
    if (statusOnEnter !== undefined && typeof statusOnEnter !== "string")
      return null;
    return {
      id: n.id,
      kind: "approval",
      label: n.label ?? "审批",
      role: rule.role,
      mode,
      ...(statusOnEnter ? { statusOnEnter } : {}),
    };
  }
  if (n.type === "condition") {
    if (!n.expression) return null;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(
      n.expression.trim(),
    );
    if (!m) return null;
    let value = m[3]!.trim();
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
      value = value.slice(1, -1);
    return { id: n.id, kind: "condition", field: m[1]!, op: m[2]!, value };
  }
  if (n.type === "task") {
    const action = n.action ?? {};
    const kind = action.kind;
    const label = n.label ?? "自动动作";
    if (kind === "setStatus") {
      if (typeof action.value !== "string") return null;
      return { id: n.id, kind: "action", label, actionKind: "setStatus", statusValue: action.value };
    }
    if (kind === "applyInventory") {
      if (action.mode !== "in" && action.mode !== "out") return null;
      return { id: n.id, kind: "action", label, actionKind: "applyInventory", invMode: action.mode };
    }
    if (kind === "webhook") {
      if (typeof action.url !== "string") return null;
      if (action.event !== undefined && typeof action.event !== "string") return null;
      return {
        id: n.id,
        kind: "action",
        label,
        actionKind: "webhook",
        url: action.url,
        ...(typeof action.event === "string" ? { event: action.event } : {}),
      };
    }
    if (kind === "createRecord") {
      if (typeof action.entity !== "string" || !action.entity) return null;
      const target = data.entities.find((e) => e.key === action.entity);
      if (!target) return null;
      const fields = (action.fields ?? {}) as Record<string, unknown>;
      const step: ActionStep = {
        id: n.id,
        kind: "action",
        label,
        actionKind: "createRecord",
        targetEntity: action.entity,
        startWorkflow: action.startWorkflow === true,
      };
      for (const [k, raw] of Object.entries(fields)) {
        const spec = (raw ?? {}) as Record<string, unknown>;
        if (k === "in_no" && typeof spec.seq === "string") {
          step.seqPrefix = spec.seq;
        } else if (k === "warehouse_id" && typeof spec.const === "string") {
          step.warehouseId = spec.const;
        } else if (k === "in_date" && spec.today === true) {
          // 固定映射（{ today: true }），无 UI 参数
        } else {
          // 仅认「指向源实体的引用字段 ← { from: "id" }」这一固定映射
          const f = target.fields.find((x) => x.key === k);
          if (!f || f.type !== "ref" || f.refEntity !== wf.entity || spec.from !== "id")
            return null;
        }
      }
      return step;
    }
    return null;
  }
  return null;
}

/** 以新步骤/元数据重建 workflow（保留 base 字段与未知 settings 键） */
export function buildWorkflow(
  base: WorkflowSchema,
  steps: FlowStep[],
  meta: FlowMeta,
  data: DataSchema,
): WorkflowSchema {
  const { nodes, edges } = stepsToGraph(steps, meta, base.entity, data);
  const settings: Record<string, unknown> = { ...(base.settings ?? {}) };
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
      delete settings[k];
    else settings[k] = v;
  };
  put("initialStatus", meta.initialStatus || undefined);
  put("rejectStatus", meta.rejectStatus || undefined);
  put("lowStockWebhookUrl", meta.lowStockWebhookUrl || undefined);
  put("ccRoles", meta.ccRoles);
  return {
    ...base,
    statusField: meta.statusField || undefined,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    nodes,
    edges,
    updatedAt: new Date().toISOString(),
  };
}

function emptyWorkflow(appId: string, entity: Entity): WorkflowSchema {
  const now = new Date().toISOString();
  const hasStatus = entity.fields.some((f) => f.key === "status");
  const base: WorkflowSchema = {
    id: `${appId}:workflow:${entity.key}`,
    kind: "workflow",
    version: 1,
    formatVersion: 1,
    name: `${entity.label}流程`,
    entity: entity.key,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  const meta: FlowMeta = {
    statusField: hasStatus ? "status" : "",
    initialStatus: "",
    rejectStatus: "",
    finalStatus: "",
    lowStockWebhookUrl: "",
    ccRoles: [],
  };
  return buildWorkflow(base, [], meta, { entities: [entity] } as DataSchema);
}

// ---------------------------------------------------------------- 演示流程（契约 §10）

/** 一键生成三条演示流程的步骤模型并序列化；实体不存在的流程跳过 */
export function demoWorkflows(appId: string, data: DataSchema): WorkflowSchema[] {
  const byKey = (k: string) => data.entities.find((e) => e.key === k && !e.parentField);
  const out: WorkflowSchema[] = [];
  const make = (
    entity: Entity,
    meta: FlowMeta,
    steps: FlowStep[],
  ): WorkflowSchema => {
    const now = new Date().toISOString();
    const base: WorkflowSchema = {
      id: `${appId}:workflow:${entity.key}`,
      kind: "workflow",
      version: 1,
      formatVersion: 1,
      name: `${entity.label}流程`,
      entity: entity.key,
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    };
    return buildWorkflow(base, steps, meta, data);
  };

  const po = byKey("purchase_order");
  if (po) {
    const amountField =
      po.fields.find((f) => f.key === "total_amount") ??
      po.fields.find((f) => f.type === "decimal" || f.type === "int");
    const steps: FlowStep[] = [
      { id: newStepId(), kind: "approval", label: "主管审批", role: "manager", mode: "any", statusOnEnter: "待审批" },
    ];
    if (amountField) {
      steps.push(
        { id: newStepId(), kind: "condition", field: amountField.key, op: ">=", value: "5000" },
        { id: newStepId(), kind: "approval", label: "总监审批", role: "director", mode: "any", statusOnEnter: "主管已批" },
        { id: newStepId(), kind: "condition", field: amountField.key, op: ">=", value: "50000" },
        { id: newStepId(), kind: "approval", label: "财务会签", role: "finance", mode: "all", statusOnEnter: "总监已批" },
      );
    }
    if (byKey("stock_in")) {
      steps.push({
        id: newStepId(),
        kind: "action",
        label: "生成入库单",
        actionKind: "createRecord",
        targetEntity: "stock_in",
        seqPrefix: "IN-",
        warehouseId: "wh-01",
        startWorkflow: true,
      });
    }
    out.push(
      make(
        po,
        { statusField: "status", initialStatus: "草稿", rejectStatus: "已驳回", finalStatus: "已通过", lowStockWebhookUrl: "", ccRoles: [] },
        steps,
      ),
    );
  }

  const stockIn = byKey("stock_in");
  if (stockIn) {
    out.push(
      make(
        stockIn,
        { statusField: "", initialStatus: "", rejectStatus: "", finalStatus: "", lowStockWebhookUrl: "", ccRoles: [] },
        [
          { id: newStepId(), kind: "approval", label: "仓库确认", role: "warehouse", mode: "any" },
          { id: newStepId(), kind: "action", label: "库存入账", actionKind: "applyInventory", invMode: "in" },
        ],
      ),
    );
  }

  const req = byKey("requisition");
  if (req) {
    out.push(
      make(
        req,
        { statusField: "status", initialStatus: "待审批", rejectStatus: "已驳回", finalStatus: "已出库", lowStockWebhookUrl: "", ccRoles: [] },
        [
          { id: newStepId(), kind: "approval", label: "经理审批", role: "manager", mode: "any", statusOnEnter: "待审批" },
          { id: newStepId(), kind: "approval", label: "仓库发放", role: "warehouse", mode: "any" },
          { id: newStepId(), kind: "action", label: "库存发放", actionKind: "applyInventory", invMode: "out" },
        ],
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------- 小组件

function StatusValueInput({
  field,
  value,
  onChange,
  placeholder,
  width = 190,
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

const KIND_TAG: Record<FlowStep["kind"], { color: string; text: string }> = {
  approval: { color: "blue", text: "审批" },
  condition: { color: "orange", text: "条件" },
  action: { color: "green", text: "动作" },
};

function stepSummary(step: FlowStep): string {
  if (step.kind === "approval")
    return `${step.label} · 角色 ${step.role}${step.mode === "all" ? " · 会签" : ""}`;
  if (step.kind === "condition")
    return `当 ${step.field} ${step.op} ${step.value} 时执行下一步骤，否则跳过`;
  switch (step.actionKind) {
    case "createRecord":
      return `${step.label} · 生成记录 → ${step.targetEntity ?? "—"}`;
    case "applyInventory":
      return `${step.label} · 库存${step.invMode === "out" ? "出库扣减" : "入库增加"}`;
    case "setStatus":
      return `${step.label} · 设置状态 = ${step.statusValue ?? ""}`;
    case "webhook":
      return `${step.label} · Webhook ${step.url ?? ""}`;
  }
}

// ---------------------------------------------------------------- 主组件

export interface WorkflowDesignerProps {
  appId: string;
  data: DataSchema;
  permissions: PermissionSchema | null;
  workflows: WorkflowSchema[] | null;
  onChange: (next: WorkflowSchema[] | null) => void;
}

export default function WorkflowDesigner({
  appId,
  data,
  permissions,
  workflows,
  onChange,
}: WorkflowDesignerProps) {
  const list = workflows ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newEntityKey, setNewEntityKey] = useState<string | undefined>(undefined);

  const selected = list.find((w) => w.id === selectedId) ?? list[0] ?? null;
  const parsed = useMemo(
    () => (selected ? graphToSteps(selected, data) : null),
    [selected, data],
  );

  const entityOf = (key: string) => data.entities.find((e) => e.key === key);
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

  const commit = (steps: FlowStep[], meta: FlowMeta, name?: string) => {
    if (!selected || !parsed) return;
    const base = name !== undefined ? { ...selected, name } : selected;
    const next = buildWorkflow(base, steps, meta, data);
    onChange(list.map((w) => (w.id === selected.id ? next : w)));
  };
  const commitSteps = (steps: FlowStep[]) =>
    parsed && commit(steps, parsed.meta);
  const commitMeta = (meta: FlowMeta) =>
    parsed && commit(parsed.steps, meta);
  const patchStep = (idx: number, patch: Partial<FlowStep>) => {
    if (!parsed) return;
    const steps = parsed.steps.map((s, i) =>
      i === idx ? ({ ...s, ...patch } as FlowStep) : s,
    );
    commitSteps(steps);
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    if (!parsed) return;
    const j = idx + dir;
    if (j < 0 || j >= parsed.steps.length) return;
    const steps = [...parsed.steps];
    const tmp = steps[idx]!;
    steps[idx] = steps[j]!;
    steps[j] = tmp;
    commitSteps(steps);
  };

  const addStep = (kind: FlowStep["kind"]) => {
    if (!parsed || !selected) return;
    const entity = entityOf(selected.entity);
    let step: FlowStep;
    if (kind === "approval") {
      step = {
        id: newStepId(),
        kind: "approval",
        label: "审批",
        role: roleOptions?.[1]?.value ?? roleOptions?.[0]?.value ?? "admin",
        mode: "any",
      };
    } else if (kind === "condition") {
      const numField = entity?.fields.find(
        (f) => f.type === "int" || f.type === "decimal",
      );
      step = {
        id: newStepId(),
        kind: "condition",
        field: numField?.key ?? "",
        op: ">=",
        value: "",
      };
    } else {
      step = {
        id: newStepId(),
        kind: "action",
        label: "自动动作",
        actionKind: "createRecord",
        targetEntity: unboundEntities[0]?.key ?? data.entities.find((e) => !e.parentField && e.key !== selected.entity)?.key ?? "",
        seqPrefix: "IN-",
        warehouseId: "wh-01",
        startWorkflow: false,
        invMode: "in",
        statusValue: "",
        url: "",
        event: "",
      };
    }
    commitSteps([...parsed.steps, step]);
  };

  const createWorkflow = () => {
    const entity = newEntityKey ? entityOf(newEntityKey) : undefined;
    if (!entity) return;
    const wf = emptyWorkflow(appId, entity);
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
    width = 220,
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

  const entity = selected ? entityOf(selected.entity) : undefined;
  const statusFieldDef = entity?.fields.find(
    (f) => f.key === (parsed?.meta.statusField || "status"),
  );

  return (
    <div style={{ display: "flex", height: "100%" }}>
      {/* ------------------------------------------------ 左列：流程列表 */}
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
            const p = graphToSteps(w, data);
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
                    {p ? `${p.steps.length} 个步骤` : "高级结构"} · 状态字段{" "}
                    {w.statusField ?? "status"}
                  </div>
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

      {/* ------------------------------------------------ 右列：编辑区 */}
      <div style={{ flex: 1, padding: 20, overflowY: "auto", background: "#fff", minWidth: 0 }}>
        {!selected ? (
          <Typography.Text type="secondary">
            从左侧选择一条流程开始设计，或新建流程 / 初始化演示流程。
          </Typography.Text>
        ) : !parsed ? (
          <>
            <Space size={12} style={{ marginBottom: 12 }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {selected.name}
              </Typography.Title>
              <Tag>{entity?.label ?? selected.entity}</Tag>
            </Space>
            <Alert
              type="warning"
              showIcon
              message="该流程为高级结构，步骤视图只读"
              description={`该流程的节点/边结构超出步骤式编辑子集（共 ${selected.nodes.length} 个节点、${selected.edges.length} 条边），步骤视图无法编辑，本页签不会对它做任何修改。可通过接口或后续的图形编辑器维护。`}
            />
          </>
        ) : (
          <>
            <Space size={12} wrap style={{ marginBottom: 4 }}>
              <span>
                流程名称：
                <Input
                  style={{ width: 220, marginLeft: 8 }}
                  value={selected.name}
                  onChange={(e) =>
                    commit(parsed.steps, parsed.meta, e.target.value)
                  }
                />
              </span>
              <Tag color="blue">
                绑定实体：{entity?.label ?? selected.entity}（{selected.entity}）
              </Tag>
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
            </Space>

            {/* ------------------------------------------ 基础区 */}
            <Card size="small" title="基础设置" style={{ marginTop: 12 }}>
              <Space direction="vertical" size={12} style={{ display: "flex" }}>
                <Space size={10} wrap>
                  <Typography.Text style={{ width: 110 }}>状态字段</Typography.Text>
                  <Select
                    style={{ width: 240 }}
                    value={parsed.meta.statusField}
                    onChange={(v) => commitMeta({ ...parsed.meta, statusField: v })}
                    options={[
                      { value: "", label: "（不设置，流程状态不写回记录）" },
                      ...(entity?.fields ?? []).map((f) => ({
                        value: f.key,
                        label: `${f.label}（${f.key}）`,
                      })),
                    ]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    审批进入 / 完成 / 驳回时，流程状态镜像写回该字段
                  </Typography.Text>
                </Space>
                <Space size={10} wrap>
                  <Typography.Text style={{ width: 110 }}>可发起状态值</Typography.Text>
                  <StatusValueInput
                    field={statusFieldDef}
                    value={parsed.meta.initialStatus}
                    onChange={(v) => commitMeta({ ...parsed.meta, initialStatus: v })}
                    placeholder="缺省：草稿"
                  />
                  <Typography.Text style={{ width: 110 }}>驳回状态值</Typography.Text>
                  <StatusValueInput
                    field={statusFieldDef}
                    value={parsed.meta.rejectStatus}
                    onChange={(v) => commitMeta({ ...parsed.meta, rejectStatus: v })}
                    placeholder="缺省：已驳回"
                  />
                  <Typography.Text style={{ width: 110 }}>完成状态值</Typography.Text>
                  <StatusValueInput
                    field={statusFieldDef}
                    value={parsed.meta.finalStatus}
                    onChange={(v) => commitMeta({ ...parsed.meta, finalStatus: v })}
                    placeholder="如：已通过"
                  />
                </Space>
                <Space size={10} wrap>
                  <Typography.Text style={{ width: 110 }}>低库存 Webhook</Typography.Text>
                  <Input
                    style={{ width: 430 }}
                    placeholder="https://…（留空 = 只记录低库存事件，不投递）"
                    value={parsed.meta.lowStockWebhookUrl}
                    onChange={(e) =>
                      commitMeta({ ...parsed.meta, lowStockWebhookUrl: e.target.value })
                    }
                  />
                </Space>
                <Space size={10} wrap>
                  <Typography.Text style={{ width: 110 }}>抄送角色</Typography.Text>
                  {roleOptions ? (
                    <Select
                      style={{ width: 430 }}
                      mode="multiple"
                      allowClear
                      placeholder="流程完成 / 驳回时通知这些角色"
                      value={parsed.meta.ccRoles}
                      onChange={(v) => commitMeta({ ...parsed.meta, ccRoles: v })}
                      options={roleOptions}
                    />
                  ) : (
                    <Select
                      style={{ width: 430 }}
                      mode="tags"
                      allowClear
                      placeholder="输入角色 key 后回车（未建立权限配置时的文本兜底）"
                      value={parsed.meta.ccRoles}
                      onChange={(v) => commitMeta({ ...parsed.meta, ccRoles: v })}
                    />
                  )}
                </Space>
              </Space>
            </Card>

            {/* ------------------------------------------ 步骤区 */}
            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5} style={{ margin: "0 0 8px" }}>
                步骤（按顺序执行）
              </Typography.Title>
              <Space direction="vertical" size={10} style={{ display: "flex" }}>
                {parsed.steps.map((step, idx) => (
                  <Card
                    key={step.id}
                    size="small"
                    title={
                      <Space size={8}>
                        <span>步骤 {idx + 1}</span>
                        <Tag color={KIND_TAG[step.kind].color}>
                          {KIND_TAG[step.kind].text}
                        </Tag>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {stepSummary(step)}
                        </Typography.Text>
                      </Space>
                    }
                    extra={
                      <Space size={4}>
                        <Button size="small" onClick={() => moveStep(idx, -1)}>
                          上移
                        </Button>
                        <Button size="small" onClick={() => moveStep(idx, 1)}>
                          下移
                        </Button>
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            commitSteps(parsed.steps.filter((_, i) => i !== idx))
                          }
                        >
                          删除
                        </Button>
                      </Space>
                    }
                  >
                    {step.kind === "approval" && (
                      <Space size={10} wrap>
                        <span>
                          名称：
                          <Input
                            style={{ width: 150, marginLeft: 6 }}
                            value={step.label}
                            onChange={(e) => patchStep(idx, { label: e.target.value })}
                          />
                        </span>
                        <span>
                          审批角色：
                          <span style={{ marginLeft: 6 }}>
                            {roleSelect(step.role, (v) => patchStep(idx, { role: v }))}
                          </span>
                        </span>
                        <span>
                          模式：
                          <Select
                            style={{ width: 170, marginLeft: 6 }}
                            value={step.mode}
                            onChange={(v) => patchStep(idx, { mode: v })}
                            options={[
                              { value: "any", label: "或签（一人通过即可）" },
                              { value: "all", label: "会签（全部通过）" },
                            ]}
                          />
                        </span>
                        <span>
                          进入时状态：
                          <span style={{ marginLeft: 6 }}>
                            <StatusValueInput
                              field={statusFieldDef}
                              value={step.statusOnEnter ?? ""}
                              onChange={(v) =>
                                patchStep(idx, { statusOnEnter: v || undefined })
                              }
                              placeholder="不设置"
                              width={150}
                            />
                          </span>
                        </span>
                      </Space>
                    )}
                    {step.kind === "condition" && (
                      <Space direction="vertical" size={8} style={{ display: "flex" }}>
                        <Space size={10} wrap>
                          <span>
                            字段：
                            <Select
                              style={{ width: 200, marginLeft: 6 }}
                              placeholder="选择数值字段"
                              value={step.field || undefined}
                              onChange={(v) => patchStep(idx, { field: v })}
                              options={(entity?.fields ?? [])
                                .filter((f) => f.type === "int" || f.type === "decimal")
                                .map((f) => ({
                                  value: f.key,
                                  label: `${f.label}（${f.key}）`,
                                }))}
                            />
                          </span>
                          <span>
                            运算符：
                            <Select
                              style={{ width: 90, marginLeft: 6 }}
                              value={step.op}
                              onChange={(v) => patchStep(idx, { op: v })}
                              options={OPS.map((o) => ({ value: o, label: o }))}
                            />
                          </span>
                          <span>
                            值：
                            <Input
                              style={{ width: 130, marginLeft: 6 }}
                              placeholder="如 5000"
                              value={step.value}
                              onChange={(e) => patchStep(idx, { value: e.target.value })}
                            />
                          </span>
                        </Space>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          固定语义：条件满足时执行下一步骤；不满足时跳过下一步骤，直接进入再下一步骤（或结束）。
                        </Typography.Text>
                      </Space>
                    )}
                    {step.kind === "action" && (
                      <Space direction="vertical" size={8} style={{ display: "flex" }}>
                        <Space size={10} wrap>
                          <span>
                            名称：
                            <Input
                              style={{ width: 150, marginLeft: 6 }}
                              value={step.label}
                              onChange={(e) => patchStep(idx, { label: e.target.value })}
                            />
                          </span>
                          <span>
                            动作类型：
                            <Select
                              style={{ width: 170, marginLeft: 6 }}
                              value={step.actionKind}
                              onChange={(v) => patchStep(idx, { actionKind: v })}
                              options={[
                                { value: "createRecord", label: "生成记录" },
                                { value: "applyInventory", label: "库存增减" },
                                { value: "setStatus", label: "设置状态" },
                                { value: "webhook", label: "Webhook 通知" },
                              ]}
                            />
                          </span>
                        </Space>
                        {step.actionKind === "createRecord" && (
                          <Space size={10} wrap>
                            <span>
                              目标实体：
                              <Select
                                style={{ width: 200, marginLeft: 6 }}
                                placeholder="选择目标实体"
                                value={step.targetEntity || undefined}
                                onChange={(v) => patchStep(idx, { targetEntity: v })}
                                options={data.entities
                                  .filter((e) => !e.parentField)
                                  .map((e) => ({
                                    value: e.key,
                                    label: `${e.label}（${e.key}）`,
                                  }))}
                              />
                            </span>
                            <span>
                              单号序列前缀：
                              <Input
                                style={{ width: 110, marginLeft: 6 }}
                                value={step.seqPrefix ?? ""}
                                onChange={(e) => patchStep(idx, { seqPrefix: e.target.value })}
                              />
                            </span>
                            <span>
                              仓库常量：
                              <Input
                                style={{ width: 110, marginLeft: 6 }}
                                placeholder="wh-01"
                                value={step.warehouseId ?? ""}
                                onChange={(e) => patchStep(idx, { warehouseId: e.target.value })}
                              />
                            </span>
                            <span>
                              自动发起目标流程：
                              <Switch
                                style={{ marginLeft: 6 }}
                                checked={Boolean(step.startWorkflow)}
                                onChange={(v) => patchStep(idx, { startWorkflow: v })}
                              />
                            </span>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              生成规则：目标实体的单号字段（in_no）按前缀生成序列；指向本实体的引用字段自动填源记录；仓库常量写入
                              warehouse_id（演示主仓库 wh-01，可改）；日期字段（in_date）填当天。
                            </Typography.Text>
                          </Space>
                        )}
                        {step.actionKind === "applyInventory" && (
                          <Space size={10} wrap>
                            <span>
                              模式：
                              <Select
                                style={{ width: 220, marginLeft: 6 }}
                                value={step.invMode ?? "in"}
                                onChange={(v) => patchStep(idx, { invMode: v })}
                                options={[
                                  { value: "in", label: "入库（按明细增加库存）" },
                                  { value: "out", label: "出库（按明细扣减库存）" },
                                ]}
                              />
                            </span>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              入库按本单明细逐项增加库存；出库先校验总量、不足则驳回本次操作。执行后逐物料检查低库存并预警。
                            </Typography.Text>
                          </Space>
                        )}
                        {step.actionKind === "setStatus" && (
                          <span>
                            状态值：
                            <span style={{ marginLeft: 6 }}>
                              <StatusValueInput
                                field={statusFieldDef}
                                value={step.statusValue ?? ""}
                                onChange={(v) => patchStep(idx, { statusValue: v })}
                                placeholder="写入状态字段的值"
                                width={190}
                              />
                            </span>
                          </span>
                        )}
                        {step.actionKind === "webhook" && (
                          <Space size={10} wrap>
                            <span>
                              URL：
                              <Input
                                style={{ width: 320, marginLeft: 6 }}
                                placeholder="https://…"
                                value={step.url ?? ""}
                                onChange={(e) => patchStep(idx, { url: e.target.value })}
                              />
                            </span>
                            <span>
                              事件名：
                              <Input
                                style={{ width: 150, marginLeft: 6 }}
                                placeholder="如 order_approved"
                                value={step.event ?? ""}
                                onChange={(e) => patchStep(idx, { event: e.target.value })}
                              />
                            </span>
                          </Space>
                        )}
                      </Space>
                    )}
                  </Card>
                ))}
                {parsed.steps.length === 0 && (
                  <Typography.Text type="secondary">
                    暂无步骤。用下方按钮添加第一个步骤；只有开始与结束的流程会在发起后直接完成。
                  </Typography.Text>
                )}
              </Space>
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" ghost onClick={() => addStep("approval")}>
                  添加审批
                </Button>
                <Button type="primary" ghost onClick={() => addStep("condition")}>
                  添加条件
                </Button>
                <Button type="primary" ghost onClick={() => addStep("action")}>
                  添加自动动作
                </Button>
              </Space>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
