/**
 * 状态徽标（呈现层治理·包二）：展示场景中 key 恰为 `status` 的字段值不再渲染为
 * 纯文本，而是按值语义映射到平台默认色板的彩色 pill。
 * 色板按语义类归并：待*（待支付/待审核…）→ 琥珀、未决/终态消极（草稿/已取消…）→ 灰、
 * 积极终态（已完成/已通过…）→ 绿、积极进行态（已支付/已发货/进行中…）→ 蓝、
 * 否定终态（已驳回/失败/异常…）→ 红；未知值回退灰。
 * 应用可用组件 props.statusColors = { 值: 色令牌 } 覆盖个别值（见 parseStatusColors）。
 */
import type { CSSProperties } from "react";

/** 状态色令牌（语义色名，非具体色值；徽标配色在本文件内统一定义） */
export type StatusToken = "amber" | "gray" | "green" | "blue" | "red";

const STATUS_TOKENS: readonly string[] = ["amber", "gray", "green", "blue", "red"];

const TOKEN_COLORS: Record<StatusToken, { bg: string; border: string; color: string }> = {
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

/** 平台默认色板：精确匹配优先，其次「待」前缀（待支付/待审核/待处理/待发货…）归琥珀；无匹配返回 null */
function defaultStatusToken(text: string): StatusToken | null {
  if (!text) return null;
  if (GRAY_EXACT.has(text)) return "gray";
  if (GREEN_EXACT.has(text)) return "green";
  if (BLUE_EXACT.has(text)) return "blue";
  if (RED_EXACT.has(text)) return "red";
  if (text.startsWith("待")) return "amber";
  return null;
}

function isStatusToken(v: unknown): v is StatusToken {
  return typeof v === "string" && STATUS_TOKENS.includes(v);
}

/**
 * 解析组件 props.statusColors（{ 值: 色令牌 }）：只保留形状合法的条目，
 * 非法形状整体视为未声明（回退平台默认色板），不因配置错误影响渲染。
 * 令牌除五色外兼容写法 "neutral" → gray。
 */
export function parseStatusColors(
  raw: unknown,
): Record<string, StatusToken> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, StatusToken> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isStatusToken(v)) out[k] = v;
    else if (v === "neutral") out[k] = "gray";
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 求某状态值的色令牌：应用覆盖优先（先按原始值、再按展示文本查），
 * 其次平台默认色板（先展示文本、再原始值），最终回退灰。
 */
export function resolveStatusToken(
  rawValue: unknown,
  displayText: string,
  overrides?: Record<string, StatusToken>,
): StatusToken {
  if (overrides) {
    for (const key of [rawValue, displayText]) {
      if (key === null || key === undefined) continue;
      const hit = overrides[String(key)];
      if (hit) return hit;
    }
  }
  for (const text of [displayText, rawValue]) {
    if (text === null || text === undefined) continue;
    const hit = defaultStatusToken(String(text));
    if (hit) return hit;
  }
  return "gray";
}

const badgeStyle = (token: StatusToken): CSSProperties => {
  const c = TOKEN_COLORS[token];
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

/** 状态徽标：text 为已格式化的展示文本（枚举标签等），raw 为原始值（供覆盖/色板按原值匹配） */
export function StatusBadge({
  raw,
  text,
  colors,
}: {
  raw?: unknown;
  text: string;
  colors?: Record<string, StatusToken>;
}) {
  const token = resolveStatusToken(raw, text, colors);
  return (
    <span data-status-badge={token} style={badgeStyle(token)}>
      {text}
    </span>
  );
}
