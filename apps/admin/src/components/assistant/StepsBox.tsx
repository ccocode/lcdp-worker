import type { ReactNode } from "react";
import { tokens } from "@lcdp/ui";

/**
 * 执行步骤框（2026-11-16 详情改版）：与「执行过程」同一只框——
 * 圆角边框容器 + 顶部标题行 + 下方步骤行。回合执行过程、每任务
 * 步骤框、子代理执行记录三处共用此壳，样式单点归一。
 */
export default function StepsBox({
  header,
  children,
}: {
  header: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        border: `1px solid ${tokens.colorDivider}`,
        borderRadius: 8,
        background: tokens.colorBgContainer,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {header}
      </div>
      {children}
    </div>
  );
}
