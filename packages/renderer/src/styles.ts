import type { CSSProperties } from "react";
import { tokens } from "@lcdp/ui";

/**
 * 渲染器内置样式 = B 端视觉基线在 renderer 的消费点。
 * 令牌单一事实源在 @lcdp/ui（第 73 步片一收口；值与第 49/50 步基线一致）：
 * 主色、文字三级、布局边框 / 控件边框、表头底、卡片圆角 8 / 控件圆角 6。
 * 手写组件（表单/子表/三态）一律经此对象取值，不再散写色值。
 */
export const styles: Record<string, CSSProperties> = {
  page: { fontFamily: "system-ui, -apple-system, sans-serif", color: tokens.colorText },
  title: { fontSize: 20, fontWeight: 600, margin: "4px 0 16px" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  spacer: { flex: 1 },
  btn: {
    padding: "6px 14px",
    borderRadius: tokens.borderRadius,
    border: `1px solid ${tokens.colorBorderControl}`,
    background: tokens.colorBgContainer,
    cursor: "pointer",
    fontSize: 14,
  },
  btnPrimary: {
    padding: "6px 14px",
    borderRadius: tokens.borderRadius,
    border: `1px solid ${tokens.colorPrimary}`,
    background: tokens.colorPrimary,
    color: tokens.colorBgContainer,
    cursor: "pointer",
    fontSize: 14,
  },
  btnDanger: {
    padding: "6px 14px",
    borderRadius: tokens.borderRadius,
    border: `1px solid ${tokens.colorDanger}`,
    background: tokens.colorBgContainer,
    color: tokens.colorDanger,
    cursor: "pointer",
    fontSize: 14,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
    background: tokens.colorBgContainer,
  },
  th: {
    textAlign: "left",
    padding: "10px",
    borderBottom: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorTableHeaderBg,
    color: tokens.colorTextSecondary,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "11px 10px",
    borderBottom: `1px solid ${tokens.colorDivider}`,
    whiteSpace: "nowrap",
  },
  rowHover: { cursor: "pointer" },
  pager: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    fontSize: 14,
    color: tokens.colorTextSecondary,
  },
  form: { maxWidth: 760 },
  formRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  label: {
    width: 110,
    flexShrink: 0,
    paddingTop: 7,
    fontSize: 14,
    color: tokens.colorTextSecondary,
    textAlign: "right",
  },
  required: { color: tokens.colorDanger },
  input: {
    flex: 1,
    padding: "6px 9px",
    border: `1px solid ${tokens.colorBorderControl}`,
    borderRadius: tokens.borderRadius,
    fontSize: 14,
    minWidth: 0,
    background: tokens.colorBgContainer,
  },
  textarea: {
    flex: 1,
    padding: "6px 9px",
    border: `1px solid ${tokens.colorBorderControl}`,
    borderRadius: tokens.borderRadius,
    fontSize: 14,
    minWidth: 0,
    minHeight: 64,
    background: tokens.colorBgContainer,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    margin: "22px 0 10px",
    color: tokens.colorText,
  },
  childTable: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  childTh: {
    textAlign: "left",
    padding: "8px",
    borderBottom: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorTableHeaderBg,
    color: tokens.colorTextSecondary,
    fontWeight: 600,
  },
  childTd: { padding: "6px 8px", borderBottom: `1px solid ${tokens.colorDivider}` },
  childInput: {
    width: "100%",
    padding: "5px 7px",
    border: `1px solid ${tokens.colorBorderControl}`,
    borderRadius: tokens.borderRadius,
    fontSize: 14,
    boxSizing: "border-box",
    background: tokens.colorBgContainer,
  },
  // 注：原 styles.error（错误条样式）自始无消费方，第 73 步片二删除——
  // 错误呈现统一走 antd Alert / @lcdp/ui 的 showError。
  empty: { padding: "28px 0", textAlign: "center", color: tokens.colorTextTertiary, fontSize: 14 },
};
