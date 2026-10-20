/**
 * 状态徽标（呈现层治理·包二）：展示场景中 key 恰为 `status` 的字段值按值语义
 * 映射到平台默认色板的彩色 pill。第 73 步片二起，色板/解析/渲染的单一实现
 * 已收编到 @lcdp/ui 的 StatusTag，本文件只保留 renderer 既有导出名的兼容层
 * （StatusToken / parseStatusColors / resolveStatusToken / StatusBadge），
 * 渲染结果与收编前逐值一致。
 */
import {
  StatusTag,
  parseStatusColors as parseStatusColorsImpl,
  resolveStatusTone,
  type StatusTone,
} from "@lcdp/ui";

/** 状态色令牌（语义色名）——即 @lcdp/ui 的 StatusTone */
export type StatusToken = StatusTone;

export const parseStatusColors = parseStatusColorsImpl;

export function resolveStatusToken(
  rawValue: unknown,
  displayText: string,
  overrides?: Record<string, StatusToken>,
): StatusToken {
  return resolveStatusTone(rawValue, displayText, overrides);
}

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
  return <StatusTag raw={raw} text={text} colors={colors} />;
}
