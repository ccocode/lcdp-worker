import type { CSSProperties } from "react";
import { Empty, Spin } from "antd";

/**
 * 三态统一封装（第 73 步片二）：加载 / 空 两态全平台同形。
 * 此前 renderer 用纯文本 div、runtime FlowCenter 用 antd Spin/Empty、
 * admin 靠 Table 内建 loading/emptyText，三制并存——新代码一律走此处，
 * 存量按片二改接清单逐步迁入。错误态走 feedback.ts 的 showError / 页内 Alert。
 */

/** 加载态：block = 带留白的居中块（列表/画布占位）；非 block = 行内 Spin（容器自备留白时用） */
export function LoadingState({
  tip = "加载中…",
  size,
  block = false,
  style,
}: {
  tip?: string;
  size?: "small" | "default" | "large";
  block?: boolean;
  style?: CSSProperties;
}) {
  const spin = <Spin tip={tip || undefined} size={size} />;
  if (!block) return spin;
  return (
    <div style={{ padding: "28px 0", textAlign: "center", ...style }}>
      {spin}
    </div>
  );
}

/** 空态：antd Empty 简单图 + 统一文案口径（缺省「暂无数据」，业务空态由消费方传具体描述） */
export function EmptyState({
  description = "暂无数据",
  children,
}: {
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      {children}
    </Empty>
  );
}
