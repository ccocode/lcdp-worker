import DOMPurify from "dompurify";

/**
 * 富文本净化与摘要（第 58 步）：口径逐行对齐运行态 renderer 的
 * packages/renderer/src/richtext.tsx——正文以 HTML 字符串存储、入库不
 * 预处理，呈现/摘要端统一 DOMPurify 默认白名单 + 显式禁 style 属性，
 * 保证管理台与运行态对同一份正文的解读不漂移。
 */

/**
 * HTML 净化：DOMPurify 默认白名单起步（脚本/事件属性/危险协议默认即被剥离），
 * 再显式禁 style 属性——避免内联样式污染宿主排版（安全优先口径）。
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { FORBID_ATTR: ["style"] });
}

/** 富文本 → 纯文本摘要（表格单元格等纯文本场景用）：先净化再取 textContent，空白归一并按长度截断 */
export function htmlToText(html: string, maxLen = 120): string {
  if (!html) return "";
  const clean = sanitizeHtml(html);
  let text: string;
  if (typeof document !== "undefined") {
    const div = document.createElement("div");
    div.innerHTML = clean;
    text = div.textContent ?? "";
  } else {
    text = clean.replace(/<[^>]*>/g, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
