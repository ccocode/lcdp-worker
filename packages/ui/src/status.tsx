import type { CSSProperties } from "react";

/**
 * 状态呈现——全平台单一渲染点（第 73 步片二收编）。
 * 色板与解析逻辑原样迁自 renderer 的 StatusBadge（呈现层治理·包二落地）：
 * 待*（待支付/待审核…）→ 琥珀、未决/终态消极（草稿/已取消…）→ 灰、
 * 积极终态（已完成/已通过…）→ 绿、积极进行态（已支付/已发货/进行中…）→ 蓝、
 * 否定终态（已驳回/失败/异常…）→ 红；未知值回退灰。
 * 消费方：renderer 的 StatusBadge（运行态字段渲染，兼容原导出）、admin 各页
 * 状态映射表（映射数据经 meta 传入，文本/色调仍由页面数据决定、渲染在此单点）。
 */

/** 状态色调（语义名，非具体色值；配色在本文件内统一定义） */
export type StatusTone = "amber" | "gray" | "green" | "blue" | "red";

const STATUS_TONES: readonly string[] = ["amber", "gray", "green", "blue", "red"];

export const statusPalette: Record<
  StatusTone,
  { bg: string; border: string; color: string }
> = {
  amber: { bg: "#fff7e6", border: "#ffd591", color: "#d46b08" },
  gray: { bg: "#fafafa", border: "#d9d9d9", color: "#595959" },
  green: { bg: "#f6ffed", border: "#b7eb8f", color: "#389e0d" },
  blue: { bg: "#e6f4ff", border: "#91caff", color: "#0958d9" },
  red: { bg: "#fff2f0", border: "#ffccc7", color: "#cf1322" },
};

const GRAY_EXACT = new Set(["草稿", "未开始", "已取消", "已下线"]);
const GREEN_EXACT = new Set(["已完成", "已通过", "已发布", "已解决", "正常", "启用"]);
const BLUE_EXACT = new Set(["已支付", "已发货", "进行中", "处理中"]);
const RED_EXACT = new Set(["已驳回", "已拒绝", "失败", "异常"]);

/** 平台默认色板：精确匹配优先，其次「待」前缀归琥珀；无匹配返回 null */
export function defaultStatusTone(text: string): StatusTone | null {
  if (!text) return null;
  if (GRAY_EXACT.has(text)) return "gray";
  if (GREEN_EXACT.has(text)) return "green";
  if (BLUE_EXACT.has(text)) return "blue";
  if (RED_EXACT.has(text)) return "red";
  if (text.startsWith("待")) return "amber";
  return null;
}

export function isStatusTone(v: unknown): v is StatusTone {
  return typeof v === "string" && STATUS_TONES.includes(v);
}

/**
 * 解析组件 props.statusColors（{ 值: 色调 }）：只保留形状合法的条目，
 * 非法形状整体视为未声明（回退平台默认色板），不因配置错误影响渲染。
 * 色调除五色外兼容写法 "neutral" → gray。
 */
export function parseStatusColors(
  raw: unknown,
): Record<string, StatusTone> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, StatusTone> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isStatusTone(v)) out[k] = v;
    else if (v === "neutral") out[k] = "gray";
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 求某状态值的色调：显式覆盖优先（先按原始值、再按展示文本查），
 * 其次平台默认色板（先展示文本、再原始值），最终回退灰。
 */
export function resolveStatusTone(
  rawValue: unknown,
  displayText: string,
  overrides?: Record<string, StatusTone>,
): StatusTone {
  if (overrides) {
    for (const key of [rawValue, displayText]) {
      if (key === null || key === undefined) continue;
      const hit = overrides[String(key)];
      if (hit) return hit;
    }
  }
  for (const text of [displayText, rawValue]) {
    if (text === null || text === undefined) continue;
    const hit = defaultStatusTone(String(text));
    if (hit) return hit;
  }
  return "gray";
}

const badgeStyle = (tone: StatusTone): CSSProperties => {
  const c = statusPalette[tone];
  return {
    display: "inline-block",
    padding: "0 8px",
    lineHeight: "20px",
    fontSize: 12,
    borderRadius: 999,
    border: `1px solid ${c.border}`,
    background: c.bg,
    color: c.color,
    whiteSpace: "nowrap",
  };
};

/** 状态映射表条目（admin 各页传入：原始值 → 展示文本 + 色调） */
export interface StatusMetaItem {
  text?: string;
  tone: StatusTone;
}

export interface StatusTagProps {
  /** 原始状态值（供映射/色板匹配） */
  raw?: unknown;
  /** 展示文本（缺省：meta 文本 → 原始值文本） */
  text?: string;
  /** 显式色调（最高优先，页面自有规则算出的色调经此传入） */
  tone?: StatusTone;
  /** 值 → {text, tone} 映射表（admin 状态映射表形态） */
  meta?: Record<string, StatusMetaItem>;
  /** 值 → 色调覆盖（renderer 组件 props.statusColors 形态） */
  colors?: Record<string, StatusTone>;
}

/**
 * 状态标签（pill 形态，全平台单点渲染）。
 * 色调解析序：tone prop → meta[raw] → colors 覆盖 → 默认色板 → 灰。
 * 展示文本序：meta[raw].text → text prop → String(raw)。
 */
export function StatusTag({ raw, text, tone, meta, colors }: StatusTagProps) {
  const metaItem =
    raw === null || raw === undefined ? undefined : meta?.[String(raw)];
  const display = metaItem?.text ?? text ?? (raw == null ? "" : String(raw));
  const resolved =
    tone ??
    metaItem?.tone ??
    resolveStatusTone(raw, display, colors);
  return (
    <span data-status-badge={resolved} style={badgeStyle(resolved)}>
      {display}
    </span>
  );
}
