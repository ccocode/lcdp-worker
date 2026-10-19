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

/** ISO 时间 → 本地可读文本（防御式：解析失败原样返回） */
export function fmtTime(v: unknown): string {
  if (typeof v !== "string" && typeof v !== "number") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("zh-CN", { hour12: false });
}

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
