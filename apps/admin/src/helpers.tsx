import React from "react";
import { Typography } from "antd";

/** 任意值 → 展示文本：字符串原样、其余 JSON 化（容错，不抛错） */
export function asText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** JSON 容错展示：对象/数组美化打印；已是字符串时尝试 parse 后再打印，失败则原样 */
export function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  if (typeof value === "string") {
    try {
      text = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      text = value;
    }
  } else {
    try {
      text = JSON.stringify(value ?? null, null, 2);
    } catch {
      text = String(value);
    }
  }
  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontSize: 12,
        lineHeight: 1.6,
        maxHeight: 420,
        overflow: "auto",
      }}
    >
      {text}
    </pre>
  );
}

/** fmtTime 单一实现已收编 @lcdp/ui（第 73 步片二），此处转出保持既有导入路径 */
export { fmtTime } from "@lcdp/ui";

/** 日期（YYYY-MM-DD）文本 */
export function fmtDate(v: unknown): string {
  if (typeof v !== "string" || !v) return "—";
  return v.slice(0, 10);
}

/** 字节 → 人类可读（B / KB / MB，KB 起保留一位小数；自平台资产页迁入共享） */
export function fmtSize(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text code style={{ fontSize: 12 }}>
      {children}
    </Typography.Text>
  );
}

/**
 * 应用访问形态统一文案（第 71 步口径统一：应用管理列表 / 应用设置·域名 /
 * 应用设置·主题 三处共用同一措辞，基准 = 域名页签 accessHint）：
 * 绑专属域名 → 专属域名直达；主应用 → 默认域名根路径；其余 → 默认域名
 * /<应用ID> 路径（带别名时附别名后缀）。
 */
export function accessFormText(
  app: {
    boundHost?: string | null;
    isPrimary?: boolean;
    id: string;
    nameEn?: string | null;
  },
  defaultHost: string,
): string {
  if (app.boundHost) return `专属域名直达：https://${app.boundHost}/`;
  if (app.isPrimary) return `默认域名根路径（主应用）：https://${defaultHost}/`;
  return `默认域名路径：https://${defaultHost}/${app.id}${
    app.nameEn ? `（应用别名 /${app.nameEn} 亦可达）` : ""
  }`;
}
