/**
 * 格式化与错误文本——全平台单一实现（第 73 步片二收编）。
 * 此前 fmtTime 有四路副本（admin helpers / FlowCenter 本地 / studio 三处内联 /
 * runtime App 默认区域内联）、errText 有五路副本（runtime ×2 / studio ×3），
 * 一律以此为准，各端不得再自带实现。
 */

/** ISO 时间 → 本地可读文本（口径 = 原 admin helpers 版：zh-CN + hour12:false；类型不对回「—」，解析失败原样返回） */
export function fmtTime(v: unknown): string {
  if (typeof v !== "string" && typeof v !== "number") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** 金额 → ¥ 千分位无关的定点两位文本（原 renderer 购物车 money 口径）；非数值回「—」 */
export function fmtAmount(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `¥${n.toFixed(2)}`;
}

/** 任意错误 → 展示文本（Error 取 message，其余 String 化） */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
