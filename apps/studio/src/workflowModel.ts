import type {
  DataSchema,
  Entity,
  WorkflowNode,
  WorkflowSchema,
} from "@naka1205/schema";

/** schema 包未单独导出边类型，从 WorkflowSchema 派生 */
export type WorkflowEdge = WorkflowSchema["edges"][number];

/**
 * 流程图模型层（M5.1）：WorkflowSchema 图的纯函数集合，无 React / antd 依赖。
 * - 步骤模型与 steps ⇄ graph 互转沿用 M5（演示流程生成器仍按步骤生成再序列化）；
 * - 图编辑操作（插入 / 删除 / 连线 / 删边）直接在图上进行，图即唯一事实源：
 *   载入后不做任何有损往返，未编辑的图保存时与原图语义完全一致；
 * - 客户端校验与 api 的 validateWorkflows 等价（错误文案对齐），外加「节点不可达」提示；
 * - 表达式校验为 api flow.ts 解析器（tokenizer + 递归下降）的等价移植。
 */

// ---------------------------------------------------------------- 步骤模型（M5 保留）

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
  /** setStatus 可选：执行时同时给该 date/datetime 字段盖当前时间戳（如发布时写发布时间） */
  stampField?: string;
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
export function newStepId(): string {
  stepSeq += 1;
  return `s-${Date.now().toString(36)}-${stepSeq}`;
}

let nodeSeq = 0;
/** 图编辑新建节点的 id（与既有节点不冲突即可） */
export function newNodeId(existing: ReadonlySet<string>): string {
  let id = "";
  do {
    nodeSeq += 1;
    id = `n-${Date.now().toString(36)}-${nodeSeq}`;
  } while (existing.has(id));
  return id;
}

// ---------------------------------------------------------------- 序列化（M5）

export const OPS = [">=", "<=", ">", "<", "==", "!="] as const;

/** 表达式字面量：纯数字裸写，其余单引号包裹 */
export function literalOf(value: string): string {
  const t = value.trim();
  if (t !== "" && !Number.isNaN(Number(t))) return t;
  return `'${t.replace(/'/g, "")}'`;
}

export function expressionOf(step: ConditionStep): string {
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

export function actionOf(
  step: ActionStep,
  sourceEntity: string,
  data: DataSchema,
): Record<string, unknown> {
  switch (step.actionKind) {
    case "setStatus":
      return {
        kind: "setStatus",
        value: step.statusValue ?? "",
        ...(step.stampField ? { stampField: step.stampField } : {}),
      };
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

/** 图 → 步骤列表；子集外结构返回 null（M5 兼容路径保留：演示图一致性回归 + 外部引用） */
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

  return { steps, meta: metaOf(wf) };
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
    const parsed = parseSimpleCondition(n.expression);
    if (!parsed) return null;
    return { id: n.id, kind: "condition", ...parsed };
  }
  if (n.type === "task") {
    const parsed = parseTaskAction(n.action ?? {}, wf.entity, data);
    if (!parsed) return null;
    return { ...parsed.step, id: n.id, label: n.label ?? "自动动作" };
  }
  return null;
}

// ---------------------------------------------------------------- 表达式解析（api flow.ts 等价移植）

type Tok = { t: "lp" | "rp" | "and" | "or" | "op" | "ident" | "num" | "str"; v: string };

function tokenizeExpr(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      toks.push({ t: "lp", v: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      toks.push({ t: "rp", v: ch });
      i++;
      continue;
    }
    if (ch === "&" && input[i + 1] === "&") {
      toks.push({ t: "and", v: "&&" });
      i += 2;
      continue;
    }
    if (ch === "|" && input[i + 1] === "|") {
      toks.push({ t: "or", v: "||" });
      i += 2;
      continue;
    }
    if (ch === ">" || ch === "<" || ch === "=" || ch === "!") {
      const two = input.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
        toks.push({ t: "op", v: two });
        i += 2;
        continue;
      }
      if (ch === ">" || ch === "<") {
        toks.push({ t: "op", v: ch });
        i++;
        continue;
      }
      throw new Error(`表达式含不支持的运算符: ${ch}`);
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) throw new Error("表达式字符串未闭合");
      toks.push({ t: "str", v: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      const m = /^-?\d+(\.\d+)?/.exec(input.slice(i));
      if (!m) throw new Error(`表达式数字不合法: ${input.slice(i, i + 8)}`);
      toks.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      toks.push({ t: "ident", v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`表达式含非法字符: ${ch}`);
  }
  return toks;
}

/** 与 api tryParseExpression 等价：合法返回 null，否则返回中文错误信息 */
export function validateExpression(input: string): string | null {
  try {
    const toks = tokenizeExpr(input ?? "");
    if (toks.length === 0) throw new Error("条件表达式为空");
    let pos = 0;
    const peek = (): Tok | undefined => toks[pos];
    function parseOr(): void {
      parseAnd();
      while (peek()?.t === "or") {
        pos++;
        parseAnd();
      }
    }
    function parseAnd(): void {
      parseAtom();
      while (peek()?.t === "and") {
        pos++;
        parseAtom();
      }
    }
    function parseAtom(): void {
      const tk = peek();
      if (!tk) throw new Error("表达式意外结束");
      if (tk.t === "lp") {
        pos++;
        parseOr();
        if (peek()?.t !== "rp") throw new Error("表达式缺少右括号");
        pos++;
        return;
      }
      if (tk.t !== "ident") throw new Error(`表达式应以字段名或括号开头，得到: ${tk.v}`);
      pos++;
      const op = peek();
      if (op?.t !== "op") throw new Error(`字段 ${tk.v} 后缺少比较运算符`);
      pos++;
      const lit = peek();
      if (!lit || (lit.t !== "num" && lit.t !== "str")) {
        throw new Error(`运算符 ${op.v} 后缺少字面量（数字或单引号字符串）`);
      }
      pos++;
    }
    parseOr();
    if (pos !== toks.length) throw new Error("表达式存在无法解析的多余内容");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** 单条比较表达式（field op literal）→ 结构化字段；复合表达式返回 null */
export function parseSimpleCondition(
  expression: string,
): { field: string; op: string; value: string } | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(
    expression.trim(),
  );
  if (!m) return null;
  let value = m[3]!.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    value = value.slice(1, -1);
  return { field: m[1]!, op: m[2]!, value };
}

// ---------------------------------------------------------------- 流程级元数据

/** 主结束节点（第一个 type=end 的节点）：finalStatus 的落点 */
export function primaryEnd(wf: WorkflowSchema): WorkflowNode | undefined {
  return wf.nodes.find((n) => n.type === "end");
}

export function metaOf(wf: WorkflowSchema): FlowMeta {
  const settings = wf.settings ?? {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const endConfig = primaryEnd(wf)?.config ?? {};
  return {
    statusField: wf.statusField ?? "",
    initialStatus: str(settings.initialStatus),
    rejectStatus: str(settings.rejectStatus),
    finalStatus: str(endConfig.finalStatus),
    lowStockWebhookUrl: str(settings.lowStockWebhookUrl),
    ccRoles: Array.isArray(settings.ccRoles)
      ? settings.ccRoles.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/** 以新元数据更新 workflow（节点/边原样保留，仅 statusField / settings / 主 end 的 finalStatus 变化） */
export function withMeta(wf: WorkflowSchema, meta: FlowMeta): WorkflowSchema {
  const settings: Record<string, unknown> = { ...(wf.settings ?? {}) };
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0))
      delete settings[k];
    else settings[k] = v;
  };
  put("initialStatus", meta.initialStatus || undefined);
  put("rejectStatus", meta.rejectStatus || undefined);
  put("lowStockWebhookUrl", meta.lowStockWebhookUrl || undefined);
  put("ccRoles", meta.ccRoles);
  const end = primaryEnd(wf);
  const nodes = wf.nodes.map((n) => {
    if (!end || n.id !== end.id) return n;
    const config: Record<string, unknown> = { ...(n.config ?? {}) };
    if (meta.finalStatus) config.finalStatus = meta.finalStatus;
    else delete config.finalStatus;
    return {
      ...n,
      ...(Object.keys(config).length > 0 ? { config } : { config: undefined }),
    };
  });
  return {
    ...wf,
    statusField: meta.statusField || undefined,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    nodes,
  };
}

/** 以新步骤/元数据重建 workflow（保留 base 字段与未知 settings 键；M5 演示生成路径） */
export function buildWorkflow(
  base: WorkflowSchema,
  steps: FlowStep[],
  meta: FlowMeta,
  data: DataSchema,
): WorkflowSchema {
  const { nodes, edges } = stepsToGraph(steps, meta, base.entity, data);
  const withGraph: WorkflowSchema = { ...base, nodes, edges };
  return {
    ...withMeta(withGraph, meta),
    updatedAt: new Date().toISOString(),
  };
}

export function emptyWorkflow(appId: string, entity: Entity): WorkflowSchema {
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

// ---------------------------------------------------------------- 演示流程（契约 §10，M5 保留）

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

// ---------------------------------------------------------------- 任务动作 ⇄ 编辑字段

/**
 * createRecord 映射的存在性信息：步骤式字段不足以表达「目标实体有 in_no 字段但动作里
 * 没有该映射」这类情况，extras 记录原动作里映射的实际存在性，重建时据此保持原样。
 */
export interface TaskActionExtras {
  /** 指向源实体的引用映射字段 key（缺省 = 目标实体第一个指向源实体的 ref 字段） */
  linkField?: string;
  hasSeq: boolean;
  hasInDate: boolean;
}

/** 目标实体的默认 extras（新建动作 / 切换目标实体时用，与 actionOf 的启发式一致） */
export function defaultExtrasFor(
  target: Entity | undefined,
  sourceEntity: string,
): TaskActionExtras {
  if (!target) return { hasSeq: false, hasInDate: false };
  const has = (k: string) => target.fields.some((f) => f.key === k);
  return {
    linkField: target.fields.find(
      (f) => f.type === "ref" && f.refEntity === sourceEntity,
    )?.key,
    hasSeq: has("in_no"),
    hasInDate: has("in_date"),
  };
}

/**
 * 任务动作 → 步骤式编辑字段；识别不了的形态返回 null（属性面板只读展示，不重写动作）。
 * 与 M5 nodeToStep 的 task 分支同等严格：只有能被完整识别的动作才允许经字段编辑重建。
 */
export function parseTaskAction(
  action: Record<string, unknown>,
  sourceEntity: string,
  data: DataSchema,
): { step: Omit<ActionStep, "id" | "label">; extras: TaskActionExtras } | null {
  const kind = action.kind;
  const extras: TaskActionExtras = { hasSeq: false, hasInDate: false };
  if (kind === "setStatus") {
    if (typeof action.value !== "string") return null;
    if (action.stampField !== undefined && typeof action.stampField !== "string")
      return null;
    return {
      step: {
        kind: "action",
        actionKind: "setStatus",
        statusValue: action.value,
        stampField:
          typeof action.stampField === "string" && action.stampField
            ? action.stampField
            : undefined,
      },
      extras,
    };
  }
  if (kind === "applyInventory") {
    if (action.mode !== "in" && action.mode !== "out") return null;
    return {
      step: { kind: "action", actionKind: "applyInventory", invMode: action.mode },
      extras,
    };
  }
  if (kind === "webhook") {
    if (typeof action.url !== "string") return null;
    if (action.event !== undefined && typeof action.event !== "string") return null;
    return {
      step: {
        kind: "action",
        actionKind: "webhook",
        url: action.url,
        ...(typeof action.event === "string" ? { event: action.event } : {}),
      },
      extras,
    };
  }
  if (kind === "createRecord") {
    if (typeof action.entity !== "string" || !action.entity) return null;
    const target = data.entities.find((e) => e.key === action.entity);
    if (!target) return null;
    const fields = (action.fields ?? {}) as Record<string, unknown>;
    const step: Omit<ActionStep, "id" | "label"> = {
      kind: "action",
      actionKind: "createRecord",
      targetEntity: action.entity,
      startWorkflow: action.startWorkflow === true,
    };
    for (const [k, raw] of Object.entries(fields)) {
      const spec = (raw ?? {}) as Record<string, unknown>;
      if (k === "in_no" && typeof spec.seq === "string") {
        step.seqPrefix = spec.seq;
        extras.hasSeq = true;
      } else if (k === "warehouse_id" && typeof spec.const === "string") {
        step.warehouseId = spec.const;
      } else if (k === "in_date" && spec.today === true) {
        extras.hasInDate = true;
      } else {
        // 仅认「指向源实体的引用字段 ← { from: "id" }」这一固定映射
        const f = target.fields.find((x) => x.key === k);
        if (!f || f.type !== "ref" || f.refEntity !== sourceEntity || spec.from !== "id")
          return null;
        extras.linkField = k;
      }
    }
    return { step, extras };
  }
  return null;
}

/**
 * 编辑字段 → 任务动作。extras 为 null 时与 M5 actionOf 完全一致；
 * 传入 extras 时按其记录的存在性重建（编辑既有动作时保持未编辑部分原样）。
 */
export function buildTaskAction(
  step: Omit<ActionStep, "id" | "label">,
  extras: TaskActionExtras | null,
  sourceEntity: string,
  data: DataSchema,
): Record<string, unknown> {
  if (step.actionKind !== "createRecord") {
    return actionOf(
      { ...step, id: "", label: "" } as ActionStep,
      sourceEntity,
      data,
    );
  }
  const target = data.entities.find((e) => e.key === step.targetEntity);
  const fields: Record<string, unknown> = {};
  if (target) {
    const ex = extras ?? defaultExtrasFor(target, sourceEntity);
    if (ex.hasSeq) fields.in_no = { seq: step.seqPrefix || "IN-" };
    if (ex.linkField) fields[ex.linkField] = { from: "id" };
    if (target.fields.some((f) => f.key === "warehouse_id") && step.warehouseId)
      fields.warehouse_id = { const: step.warehouseId };
    if (ex.hasInDate) fields.in_date = { today: true };
  }
  return {
    kind: "createRecord",
    entity: step.targetEntity ?? "",
    fields,
    ...(step.startWorkflow ? { startWorkflow: true } : {}),
  };
}

// ---------------------------------------------------------------- 图结构操作

export function nodeById(wf: WorkflowSchema, id: string): WorkflowNode | undefined {
  return wf.nodes.find((n) => n.id === id);
}

export function outEdges(wf: WorkflowSchema, id: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.from === id);
}

export function inEdges(wf: WorkflowSchema, id: string): WorkflowEdge[] {
  return wf.edges.filter((e) => e.to === id);
}

/** 边的规范 id（与 stepsToGraph 一致）；冲突时追加序号 */
function makeEdge(
  edges: WorkflowEdge[],
  from: string,
  to: string,
  label?: string,
): WorkflowEdge {
  const base = `e:${from}->${to}${label ? `:${label}` : ""}`;
  let id = base;
  let k = 2;
  while (edges.some((e) => e.id === id)) {
    id = `${base}#${k}`;
    k += 1;
  }
  return { id, from, to, ...(label ? { label } : {}) };
}

/** 从 from 出发沿出边可达的节点集合（含 from 自身） */
export function reachableFrom(wf: WorkflowSchema, from: string): Set<string> {
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of outEdges(wf, cur)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

/** 主链尾：从 start 沿主边（条件走 true 边）行走到的最后一个非 end 节点 */
function mainChainTail(wf: WorkflowSchema): WorkflowNode | undefined {
  const start = wf.nodes.find((n) => n.type === "start");
  if (!start) return undefined;
  let cur: WorkflowNode = start;
  const guard = new Set<string>([cur.id]);
  for (;;) {
    const outs = outEdges(wf, cur.id);
    const main =
      cur.type === "condition"
        ? (outs.find((e) => e.label === "true") ?? outs[0])
        : outs[0];
    if (!main) return cur;
    const next = nodeById(wf, main.to);
    if (!next || next.type === "end" || guard.has(next.id)) return cur;
    guard.add(next.id);
    cur = next;
  }
}

/**
 * 在锚点节点之后插入新节点（改接锚点主出边）：
 * - 锚点为条件节点时接其 true 边；锚点无出边时新节点指向主 end；
 * - 新节点为条件节点时自动生成 true/false 两条出边到原后继；
 * - anchorId 为空或指向 end 时，锚点取主链尾。
 */
export function insertNodeAfter(
  wf: WorkflowSchema,
  anchorId: string | null,
  newNode: WorkflowNode,
): WorkflowSchema {
  const anchorCandidate = anchorId ? nodeById(wf, anchorId) : undefined;
  const anchor =
    anchorCandidate && anchorCandidate.type !== "end"
      ? anchorCandidate
      : mainChainTail(wf);
  const nodes = [...wf.nodes, newNode];
  if (!anchor) return { ...wf, nodes };
  let edges = [...wf.edges];

  // 确定被接管的主出边与后继 T
  const anchorOuts = outEdges(wf, anchor.id);
  const spliced =
    anchor.type === "condition"
      ? (anchorOuts.find((e) => e.label === "true") ?? anchorOuts[0])
      : anchorOuts[0];
  const end = primaryEnd(wf);
  const target = spliced ? spliced.to : end && end.id !== newNode.id ? end.id : undefined;
  if (spliced) edges = edges.filter((e) => e.id !== spliced.id);

  const anchorLabel =
    anchor.type === "condition" ? (spliced?.label ?? "true") : undefined;
  edges.push(makeEdge(edges, anchor.id, newNode.id, anchorLabel));
  if (target) {
    if (newNode.type === "condition") {
      edges.push(makeEdge(edges, newNode.id, target, "true"));
      edges.push(makeEdge(edges, newNode.id, target, "false"));
    } else {
      edges.push(makeEdge(edges, newNode.id, target));
    }
  }
  return { ...wf, nodes, edges };
}

/**
 * 删除节点并改接：前驱改接被删节点的后继（条件节点保留其 true 支目标，
 * false 支目标失去入边、留在画布上由校验提示不可达）。
 * start / end 不可删除（原样返回）。
 */
export function deleteNode(wf: WorkflowSchema, nodeId: string): WorkflowSchema {
  const node = nodeById(wf, nodeId);
  if (!node || node.type === "start" || node.type === "end") return wf;
  const outs = outEdges(wf, nodeId);
  const successor =
    node.type === "condition"
      ? outs.find((e) => e.label === "true")?.to
      : outs[0]?.to;
  const ins = inEdges(wf, nodeId);
  let edges = wf.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
  for (const ie of ins) {
    if (!successor || successor === ie.from) continue;
    if (
      edges.some(
        (e) => e.from === ie.from && e.to === successor && e.label === ie.label,
      )
    )
      continue;
    edges.push(makeEdge(edges, ie.from, successor, ie.label));
  }
  return { ...wf, nodes: wf.nodes.filter((n) => n.id !== nodeId), edges };
}

/** 手动连线：即时拒绝自环 / 成环 / 出边超额；条件节点出边自动补 true/false 标签 */
export function connectNodes(
  wf: WorkflowSchema,
  from: string,
  to: string,
): { wf?: WorkflowSchema; error?: string } {
  const fromNode = nodeById(wf, from);
  const toNode = nodeById(wf, to);
  if (!fromNode || !toNode) return { error: "连线的起点或终点不存在" };
  if (from === to) return { error: "不能把节点连接到自身" };
  if (fromNode.type === "end") return { error: "结束节点不能再连出" };
  if (toNode.type === "start") return { error: "开始节点不能有入边" };
  if (wf.edges.some((e) => e.from === from && e.to === to))
    return { error: "这两个节点之间已经有连线" };
  if (reachableFrom(wf, to).has(from))
    return { error: "该连线会形成环路，已拒绝" };
  const outs = outEdges(wf, from);
  let label: string | undefined;
  if (fromNode.type === "condition") {
    if (outs.length >= 2) return { error: "条件节点已有两条出边（true/false）" };
    label = outs.some((e) => e.label === "true") ? "false" : "true";
  } else if (outs.length >= 1) {
    return { error: "该节点已有一条出边，请先删除原连线再连接" };
  }
  const edges = [...wf.edges, makeEdge(wf.edges, from, to, label)];
  return { wf: { ...wf, edges } };
}

export function removeEdge(wf: WorkflowSchema, edgeId: string): WorkflowSchema {
  return { ...wf, edges: wf.edges.filter((e) => e.id !== edgeId) };
}

/** 以 patch 更新单个节点（其余节点与边原样保留） */
export function patchNode(
  wf: WorkflowSchema,
  nodeId: string,
  patch: Partial<WorkflowNode>,
): WorkflowSchema {
  return {
    ...wf,
    nodes: wf.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
  };
}

// ---------------------------------------------------------------- 自动布局

/**
 * 分层布局：从 start 做最长路径分层（x = 层 × 300），层内按 BFS 访问序排列
 * （条件的 true 支先于 false 支访问，false 支自然下偏），y = 序 × 150。
 * 从 start 不可达的节点统一放到最后一列之后。坐标不落库，仅供画布渲染。
 */
export function layoutWorkflow(
  wf: WorkflowSchema,
): Map<string, { x: number; y: number }> {
  const X_GAP = 300;
  const Y_GAP = 150;
  const start = wf.nodes.find((n) => n.type === "start");
  const depth = new Map<string, number>();
  const visitOrder: string[] = [];
  if (start) {
    depth.set(start.id, 0);
    // 最长路径分层（有界松弛，环存在时也不死循环）
    for (let pass = 0; pass < wf.nodes.length; pass++) {
      let changed = false;
      for (const e of wf.edges) {
        const dFrom = depth.get(e.from);
        if (dFrom === undefined) continue;
        const d = dFrom + 1;
        if (depth.get(e.to) === undefined || depth.get(e.to)! < d) {
          depth.set(e.to, d);
          changed = true;
        }
      }
      if (!changed) break;
    }
    // BFS 访问序：条件先 true 后 false，其余按边序
    const rank = (e: WorkflowEdge) =>
      e.label === "true" ? 0 : e.label === "false" ? 2 : 1;
    const seen = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      visitOrder.push(cur);
      const outs = [...outEdges(wf, cur)].sort((a, b) => rank(a) - rank(b));
      for (const e of outs) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const n of wf.nodes) {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
    if (!visitOrder.includes(n.id)) visitOrder.push(n.id);
  }
  const visitIndex = new Map(visitOrder.map((id, i) => [id, i]));
  const byDepth = new Map<number, string[]>();
  for (const n of wf.nodes) {
    const d = depth.get(n.id)!;
    byDepth.set(d, [...(byDepth.get(d) ?? []), n.id]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of byDepth) {
    ids
      .sort((a, b) => (visitIndex.get(a) ?? 0) - (visitIndex.get(b) ?? 0))
      .forEach((id, i) => positions.set(id, { x: d * X_GAP, y: i * Y_GAP }));
  }
  return positions;
}

// ---------------------------------------------------------------- 节点摘要（画布卡片第二行）

export function nodeSummary(
  n: WorkflowNode,
  wf: WorkflowSchema,
  data: DataSchema,
): string {
  switch (n.type) {
    case "start":
      return "流程入口";
    case "end": {
      const fs = n.config?.finalStatus;
      return typeof fs === "string" && fs ? `完成状态：${fs}` : "流程结束";
    }
    case "approval": {
      const rule = n.assigneeRule ?? {};
      const who =
        rule.kind === "role" && typeof rule.role === "string"
          ? `角色 ${rule.role}`
          : rule.kind === "user" && typeof rule.username === "string"
            ? `用户 ${rule.username}`
            : "高级指派规则";
      const mode = n.config?.mode === "all" ? "会签" : "或签";
      const soe = n.config?.statusOnEnter;
      return `${who} · ${mode}${typeof soe === "string" && soe ? ` · 进入置「${soe}」` : ""}`;
    }
    case "condition":
      return n.expression ?? "（未设置表达式）";
    case "task": {
      const parsed = parseTaskAction(n.action ?? {}, wf.entity, data);
      if (!parsed) {
        const kind = (n.action ?? {}).kind;
        return `动作：${typeof kind === "string" ? kind : "未知"}`;
      }
      const s = parsed.step;
      switch (s.actionKind) {
        case "createRecord":
          return `生成记录 → ${s.targetEntity ?? "—"}${s.startWorkflow ? " · 自动发起其流程" : ""}`;
        case "applyInventory":
          return s.invMode === "out" ? "库存出库扣减" : "库存入库增加";
        case "setStatus":
          return `设置状态 = ${s.statusValue ?? ""}${s.stampField ? ` · 盖时间戳 ${s.stampField}` : ""}`;
        case "webhook":
          return `Webhook ${s.url ?? ""}`;
      }
    }
  }
}

// ---------------------------------------------------------------- 客户端校验（与 api validateWorkflows 等价）

export interface WorkflowIssue {
  workflowId: string;
  message: string;
}

const ACTION_KINDS = ["setStatus", "createRecord", "applyInventory", "webhook"];

/**
 * 校验全部流程，收集所有问题（api 版只返回第一条；客户端逐条列出便于定位）。
 * 文案与 api 对齐；额外报告「从开始节点不可达」的节点（契约图子集要求全节点可达，
 * 也是删条件节点后 false 支孤儿的修复指引）。
 */
export function validateWorkflowsClient(
  workflows: WorkflowSchema[],
  data: DataSchema,
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const entityByKey = new Map(data.entities.map((e) => [e.key, e]));
  const boundEntities = new Set<string>();

  for (const wf of workflows) {
    const push = (message: string) => issues.push({ workflowId: wf.id, message });
    const entity = entityByKey.get(wf.entity);
    if (!entity) {
      push(`绑定的实体不存在: ${wf.entity}`);
      continue;
    }
    if (entity.parentField) {
      push(`不能绑定子表实体: ${wf.entity}（子表通过父单据参与流程）`);
    }
    if (boundEntities.has(wf.entity)) {
      push(`实体 ${wf.entity} 已绑定其他流程（同一实体最多一个流程）`);
    }
    boundEntities.add(wf.entity);
    if (wf.statusField && !entity.fields.some((f) => f.key === wf.statusField)) {
      push(`状态镜像字段不存在: ${wf.entity}.${wf.statusField}`);
    }

    const nodeIds = new Set<string>();
    for (const n of wf.nodes) {
      if (nodeIds.has(n.id)) push(`节点 id 重复: ${n.id}`);
      nodeIds.add(n.id);
    }
    const starts = wf.nodes.filter((n) => n.type === "start");
    if (starts.length !== 1)
      push(`必须恰好有一个开始节点（当前 ${starts.length} 个）`);
    const ends = wf.nodes.filter((n) => n.type === "end");
    if (ends.length < 1) push(`至少需要一个结束节点`);
    for (const e of wf.edges) {
      if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
        push(`边引用了不存在的节点: ${e.from} -> ${e.to}`);
      }
    }
    const labelOf = (n: WorkflowNode) => (n.label?.trim() ? n.label : n.id);
    for (const n of wf.nodes) {
      const outs = outEdges(wf, n.id);
      const label = labelOf(n);
      if (n.type === "end") {
        if (outs.length !== 0) push(`结束节点「${label}」不应有出边`);
      } else if (n.type === "condition") {
        if (outs.length !== 2) {
          push(`条件节点「${label}」必须恰好有两条出边（true/false）`);
        } else {
          const labels = outs.map((e) => e.label);
          if (!labels.includes("true") || !labels.includes("false")) {
            push(`条件节点「${label}」的两条出边须分别标记 true 与 false`);
          }
        }
      } else if (outs.length !== 1) {
        push(`节点「${label}」必须恰好有一条出边（当前 ${outs.length} 条）`);
      }
    }
    if (starts.length === 1) {
      const reachable = reachableFrom(wf, starts[0]!.id);
      if (!ends.some((n) => reachable.has(n.id))) {
        push(`从开始节点无法到达任何结束节点`);
      }
      for (const n of wf.nodes) {
        if (!reachable.has(n.id)) {
          push(`节点「${labelOf(n)}」从开始节点不可达（请连线接入或删除）`);
        }
      }
    }

    const statusField = entity.fields.find(
      (f) => f.key === (wf.statusField ?? "status"),
    );
    for (const n of wf.nodes) {
      const label = labelOf(n);
      if (n.type === "approval") {
        const rule = (n.assigneeRule ?? {}) as {
          kind?: unknown;
          role?: unknown;
          username?: unknown;
        };
        if (rule.kind === "role") {
          if (typeof rule.role !== "string" || !rule.role) {
            push(`审批节点「${label}」按角色指派时角色不能为空`);
          }
        } else if (rule.kind === "user") {
          if (typeof rule.username !== "string" || !rule.username) {
            push(`审批节点「${label}」按用户指派时用户名不能为空`);
          }
        } else {
          push(`审批节点「${label}」的指派规则不合法（仅支持 kind=role / kind=user）`);
        }
        const cfg = (n.config ?? {}) as { mode?: unknown; statusOnEnter?: unknown };
        if (cfg.mode !== undefined && cfg.mode !== "any" && cfg.mode !== "all") {
          push(`审批节点「${label}」的会签模式不合法（须为 any 或 all）`);
        }
        if (
          typeof cfg.statusOnEnter === "string" &&
          statusField?.type === "enum" &&
          !(statusField.options ?? []).some((o) => o.value === cfg.statusOnEnter)
        ) {
          push(`审批节点「${label}」的进入状态不在枚举选项内: ${cfg.statusOnEnter}`);
        }
      } else if (n.type === "condition") {
        if (!n.expression) {
          push(`条件节点「${label}」缺少表达式`);
        } else {
          const perr = validateExpression(n.expression);
          if (perr) push(`条件节点「${label}」表达式不合法: ${perr}`);
        }
      } else if (n.type === "task") {
        const action = (n.action ?? {}) as Record<string, unknown>;
        const kind = typeof action.kind === "string" ? action.kind : "";
        if (!ACTION_KINDS.includes(kind)) {
          push(`动作节点「${label}」的动作类型不合法: ${kind || "(未设置)"}`);
          continue;
        }
        if (kind === "createRecord") {
          const targetKey = typeof action.entity === "string" ? action.entity : "";
          if (!entityByKey.has(targetKey)) {
            push(`动作节点「${label}」的 createRecord 目标实体不存在: ${targetKey}`);
          } else {
            const fields =
              action.fields && typeof action.fields === "object"
                ? (action.fields as Record<string, unknown>)
                : {};
            for (const [fk, spec] of Object.entries(fields)) {
              if (spec && typeof spec === "object" && "from" in spec) {
                const from = (spec as { from?: unknown }).from;
                if (
                  typeof from !== "string" ||
                  (from !== "id" && !entity.fields.some((f) => f.key === from))
                ) {
                  push(`动作节点「${label}」的字段 ${fk} 引用了源实体不存在的字段: ${String(from)}`);
                }
              }
            }
          }
        } else if (kind === "applyInventory") {
          if (action.mode === "in") {
            for (const need of ["order_id", "warehouse_id"]) {
              if (!entity.fields.some((f) => f.key === need)) {
                push(`动作节点「${label}」：入库（in）要求绑定实体有 ${need} 字段`);
              }
            }
          } else if (action.mode === "out") {
            const child = data.entities.find((e) => {
              if (!e.parentField) return false;
              const pf = e.fields.find((f) => f.key === e.parentField);
              return pf?.refEntity === entity.key;
            });
            const ok =
              child &&
              child.fields.some((f) => f.key === "material_id") &&
              child.fields.some((f) => f.key === "quantity");
            if (!ok) {
              push(`动作节点「${label}」：出库（out）要求绑定实体有含 material_id/quantity 的明细子表`);
            }
          } else {
            push(`动作节点「${label}」的 applyInventory mode 须为 in 或 out`);
          }
        } else if (kind === "webhook") {
          if (typeof action.url !== "string" || !action.url) {
            push(`动作节点「${label}」的 webhook 缺少 url`);
          }
        } else if (kind === "setStatus") {
          if (typeof action.value !== "string" || !action.value) {
            push(`动作节点「${label}」的 setStatus 缺少 value`);
          }
          // 盖时间戳字段（可选，与服务端 flow 引擎同口径）：非空时须为绑定实体的 date/datetime 字段
          const stamp = action.stampField;
          if (stamp !== undefined && stamp !== null && stamp !== "") {
            const sf =
              typeof stamp === "string"
                ? entity.fields.find((f) => f.key === stamp)
                : undefined;
            if (!sf || (sf.type !== "date" && sf.type !== "datetime")) {
              push(
                `动作节点「${label}」的 setStatus 盖时间戳字段须为绑定实体的日期/时间字段: ${String(stamp)}`,
              );
            }
          }
        }
      }
    }
  }
  return issues;
}
