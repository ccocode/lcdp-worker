import type {
  AdminAssistantMemory,
  AdminAssistantMessage,
  AdminAssistantToolCall,
} from "../../api";

/**
 * 第 91 步线 A 的接口适配点：与线 B（B1/B2）的接口形状约定集中在
 * 本文件与 api.ts 的类型注释里。线 B 落地时若字段名或落点不同，
 * 只改本文件的归一函数，组件本体不动。
 *
 * 约定（B2 过程可见）：回合详情里的工具调用有两处可能的落点——
 * ① 消息自带 `toolCalls`；② 会话详情顶层 `toolCalls`（按
 * `messageId` 归属到回合消息）。两处都读、消息自带优先。单条
 * 字段别名防御式取值：工具名 tool|name，对象摘要 summary|target，
 * 状态 status 自由字面归一到 running/done/failed/unknown。
 */

export interface TurnStep {
  id: string;
  /** 工具名（如 theme_files / data_query），缺失时回落「工具调用」 */
  tool: string;
  /** 对象摘要（调了什么、查/改了什么对象），可为空串 */
  summary: string;
  status: "running" | "done" | "failed" | "unknown";
  startedAt: string | null;
  endedAt: string | null;
}

function normStepStatus(raw: string | undefined): TurnStep["status"] {
  const s = (raw ?? "").toLowerCase();
  if (
    s === "running" ||
    s === "pending" ||
    s === "generating" ||
    s === "in_progress" ||
    s === "started"
  ) {
    return "running";
  }
  if (
    s === "done" ||
    s === "success" ||
    s === "succeeded" ||
    s === "ok" ||
    s === "complete" ||
    s === "completed"
  ) {
    return "done";
  }
  if (
    s === "failed" ||
    s === "error" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "aborted"
  ) {
    return "failed";
  }
  return "unknown";
}

function toStep(raw: AdminAssistantToolCall, idx: number): TurnStep {
  return {
    id: raw.id ?? `step-${idx}`,
    tool: raw.tool ?? raw.name ?? "工具调用",
    summary: raw.summary ?? raw.argsSummary ?? raw.target ?? "",
    status: normStepStatus(raw.status),
    startedAt: raw.startedAt ?? raw.createdAt ?? null,
    endedAt: raw.endedAt ?? null,
  };
}

/**
 * 取某条助手消息的回合步骤流：消息自带 toolCalls 优先；
 * 否则从详情顶层 toolCalls 按 messageId 过滤。皆无返回空数组
 * （界面回落为只有耗时与中止的过程区，不报错）。
 */
export function turnStepsOf(
  message: AdminAssistantMessage,
  detailToolCalls?: AdminAssistantToolCall[] | null,
): TurnStep[] {
  const own = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  if (own.length > 0) return own.map(toStep);
  const pool = Array.isArray(detailToolCalls) ? detailToolCalls : [];
  return pool
    .filter((t) => t.messageId === message.id)
    .map(toStep);
}

/** 已耗时文案：<60s 记「N 秒」，否则「M 分 S 秒」 */
export function fmtElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} 秒`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m} 分 ${s} 秒`;
}

/** 步骤自身耗时（起止齐全才有），毫秒 */
export function stepDurationMs(step: TurnStep): number | null {
  if (!step.startedAt || !step.endedAt) return null;
  const a = Date.parse(step.startedAt);
  const b = Date.parse(step.endedAt);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

/**
 * 记忆条目是否为待确认候选（B1 约定）：status="pending"，或
 * writeMode="proposed"（助手提议未确认）。正式条目 status 为
 * active/缺失且 writeMode 为 explicit/proposed_confirmed。
 */
export function isPendingMemory(m: AdminAssistantMemory): boolean {
  if ((m.status ?? "").toLowerCase() === "pending") return true;
  if ((m.writeMode ?? "").toLowerCase() === "proposed") return true;
  return false;
}
