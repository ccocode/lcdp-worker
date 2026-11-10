import React, { useState, type ReactNode } from "react";
import { tokens } from "./tokens.js";


const BIZ_CODE_RE =
  /\b(PO-[A-Z0-9_-]+|SO-[A-Z0-9_-]+|REQ-[A-Z0-9_-]+|TKT-[A-Z0-9_-]+|WO-[A-Z0-9_-]+|SF\d{10,14}|XQ-[A-Z]{2,4}-\d{3})\b/g;

function renderPlainWithRecordLinks(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const m of text.matchAll(BIZ_CODE_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    const code = m[0];
    const key = `${keyPrefix}-code-${idx++}`;
    parts.push(
      <span
        key={key}
        onClick={(e) => {
          e.stopPropagation();
          try {
            if (navigator?.clipboard) {
              navigator.clipboard.writeText(code);
            }
          } catch {}
          window.dispatchEvent(
            new CustomEvent("lcdp:locate-record", { detail: { recordId: code } }),
          );
        }}
        title={`点击复制并定位业务单号：${code}`}
        style={{
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "1px 6px",
          margin: "0 2px",
          background: "#e6f4ff",
          border: "1px solid #91caff",
          color: "#0958d9",
          borderRadius: 4,
          fontSize: "0.92em",
          fontFamily: "monospace",
          fontWeight: 500,
          userSelect: "all",
          transition: "all 0.2s",
        }}
      >
        <span style={{ fontSize: "0.85em" }}>🔗</span>
        <span>{code}</span>
      </span>,
    );
    last = start + code.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const INLINE_RE =
  /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>"'`）】，。；：！？、]+)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...renderPlainWithRecordLinks(text.slice(last, idx), `${keyPrefix}-pre-${n}`));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) {
      // **粗体**
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (m[2]) {
      // `行内代码`
      out.push(
        <code
          key={key}
          style={{
            fontFamily: "monospace",
            fontSize: "0.9em",
            background: tokens.colorPrimaryBg ?? "rgba(22, 119, 255, 0.08)",
            color: tokens.colorPrimary ?? "#1677ff",
            borderRadius: 4,
            padding: "1px 5px",
            margin: "0 2px",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[3]) {
      // [链接文字](url)
      const label = tok.slice(1, tok.indexOf("]("));
      const url = m[4]!;
      out.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            color: tokens.colorPrimary ?? "#1677ff",
            textDecoration: "underline",
          }}
        >
          {label}
        </a>,
      );
    } else {
      // 裸 URL
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer"
          style={{
            color: tokens.colorPrimary ?? "#1677ff",
            textDecoration: "underline",
          }}
        >
          {tok}
        </a>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(...renderPlainWithRecordLinks(text.slice(last), `${keyPrefix}-post`));
  return out;
}

interface TableData {
  headers: string[];
  rows: string[][];
}

function parseMarkdownTable(lines: string[]): TableData | null {
  if (lines.length < 2) return null;
  const splitRow = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headers = splitRow(lines[0]!);
  // 检查第二行是否为分隔符行 |---|---|
  const sep = splitRow(lines[1]!);
  if (
    sep.length !== headers.length ||
    !sep.every((s) => /^:?-+:?$/.test(s.trim()))
  ) {
    return null;
  }
  const rows = lines.slice(2).map(splitRow);
  return { headers, rows };
}

export function MarkdownView({
  content,
  className,
  style,
}: {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const rawText = content ?? "";

  // 1. 拆解 <thinking> 思考块
  let thinkingContent: string | null = null;
  let mainText = rawText;
  const thinkMatch = /<thinking>([\s\S]*?)<\/thinking>/i.exec(rawText);
  if (thinkMatch) {
    thinkingContent = thinkMatch[1]!.trim();
    mainText = rawText.replace(thinkMatch[0], "").trim();
  }

  const lines = mainText.split("\n");
  const nodes: ReactNode[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  let tableLines: string[] = [];
  let listItems: Array<{ type: "ul" | "ol"; text: string }> = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const isUl = listItems[0]!.type === "ul";
    const curItems = listItems;
    listItems = [];
    const listKey = `list-${nodes.length}`;
    if (isUl) {
      nodes.push(
        <ul
          key={listKey}
          style={{ margin: "4px 0 6px", paddingLeft: 20, fontSize: 13.5 }}
        >
          {curItems.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 2 }}>
              {renderInline(it.text, `${listKey}-li-${idx}`)}
            </li>
          ))}
        </ul>,
      );
    } else {
      nodes.push(
        <ol
          key={listKey}
          style={{ margin: "4px 0 6px", paddingLeft: 20, fontSize: 13.5 }}
        >
          {curItems.map((it, idx) => (
            <li key={idx} style={{ marginBottom: 2 }}>
              {renderInline(it.text, `${listKey}-li-${idx}`)}
            </li>
          ))}
        </ol>,
      );
    }
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    const curTableLines = tableLines;
    tableLines = [];
    const parsed = parseMarkdownTable(curTableLines);
    if (!parsed) {
      // 无法解析为标准表格时回退普通文本
      curTableLines.forEach((tl, idx) => {
        nodes.push(
          <div key={`fallback-${nodes.length}-${idx}`}>{renderInline(tl, `tb-fallback-${idx}`)}</div>,
        );
      });
      return;
    }
    nodes.push(
      <div
        key={`table-${nodes.length}`}
        style={{
          overflowX: "auto",
          margin: "8px 0",
          borderRadius: 6,
          border: "1px solid #e8e8e8",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            textAlign: "left",
          }}
        >
          <thead style={{ background: "#fafafa" }}>
            <tr>
              {parsed.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    padding: "7px 12px",
                    borderBottom: "1px solid #e8e8e8",
                    fontWeight: 600,
                    color: "#262626",
                    whiteSpace: "nowrap",
                  }}
                >
                  {renderInline(h, `th-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri % 2 === 1 ? "#fafcff" : "#fff",
                  transition: "background 0.2s",
                }}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "6px 12px",
                      borderBottom:
                        ri === parsed.rows.length - 1
                          ? "none"
                          : "1px solid #f0f0f0",
                      color: "#434343",
                    }}
                  >
                    {renderInline(cell, `td-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 检查代码块围栏
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        // 代码块结束
        inCodeBlock = false;
        const codeContent = codeLines.join("\n");
        codeLines = [];
        nodes.push(
          <div
            key={`code-${nodes.length}`}
            style={{
              margin: "8px 0",
              borderRadius: 6,
              background: "#1e1e1e",
              color: "#d4d4d4",
              overflow: "hidden",
            }}
          >
            {codeLang && (
              <div
                style={{
                  padding: "3px 10px",
                  fontSize: 11,
                  background: "#2d2d2d",
                  color: "#858585",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {codeLang}
              </div>
            )}
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                fontSize: 12.5,
                fontFamily: "Consolas, Monaco, monospace",
                overflowX: "auto",
                lineHeight: 1.5,
              }}
            >
              <code>{codeContent}</code>
            </pre>
          </div>,
        );
      } else {
        flushList();
        flushTable();
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 检查表格行 | ... |
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      tableLines.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    // 检查列表
    const ulMatch = /^[-*•]\s+(.*)$/.exec(trimmed);
    const olMatch = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (ulMatch) {
      listItems.push({ type: "ul", text: ulMatch[1]! });
      continue;
    } else if (olMatch) {
      listItems.push({ type: "ol", text: olMatch[2]! });
      continue;
    } else {
      flushList();
    }

    if (trimmed === "") {
      continue;
    }

    // 检查标题
    if (trimmed.startsWith("# ")) {
      nodes.push(
        <div
          key={`h1-${nodes.length}`}
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "10px 0 4px",
            color: "#1f1f1f",
          }}
        >
          {renderInline(trimmed.slice(2), `h1-${nodes.length}`)}
        </div>,
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      nodes.push(
        <div
          key={`h2-${nodes.length}`}
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: "8px 0 3px",
            color: "#262626",
          }}
        >
          {renderInline(trimmed.slice(3), `h2-${nodes.length}`)}
        </div>,
      );
      continue;
    }
    if (trimmed.startsWith("### ")) {
      nodes.push(
        <div
          key={`h3-${nodes.length}`}
          style={{
            fontSize: 14,
            fontWeight: 600,
            margin: "6px 0 2px",
            color: "#434343",
          }}
        >
          {renderInline(trimmed.slice(4), `h3-${nodes.length}`)}
        </div>,
      );
      continue;
    }

    // 检查引用块 >
    if (trimmed.startsWith("> ")) {
      nodes.push(
        <div
          key={`quote-${nodes.length}`}
          style={{
            borderLeft: `3px solid ${tokens.colorPrimary ?? "#1677ff"}`,
            background: tokens.colorPrimaryBg ?? "rgba(22, 119, 255, 0.05)",
            padding: "4px 10px",
            margin: "6px 0",
            fontSize: 13,
            borderRadius: "0 4px 4px 0",
            color: "#595959",
          }}
        >
          {renderInline(trimmed.slice(2), `quote-${nodes.length}`)}
        </div>,
      );
      continue;
    }

    // 普通段落
    nodes.push(
      <div
        key={`p-${nodes.length}`}
        style={{
          margin: "4px 0",
          lineHeight: 1.6,
          fontSize: 14,
          wordBreak: "break-word",
        }}
      >
        {renderInline(trimmed, `p-${nodes.length}`)}
      </div>,
    );
  }

  flushList();
  flushTable();

  return (
    <div className={className} style={{ width: "100%", ...style }}>
      {thinkingContent && (
        <details
          style={{
            marginBottom: 8,
            padding: "5px 10px",
            background: "rgba(0, 0, 0, 0.03)",
            borderRadius: 6,
            border: "1px dashed #d9d9d9",
            fontSize: 12,
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              color: "#8c8c8c",
              fontWeight: 500,
              userSelect: "none",
            }}
          >
            💭 思考过程 (点击展开)
          </summary>
          <div
            style={{
              marginTop: 6,
              color: "#595959",
              whiteSpace: "pre-wrap",
              lineHeight: 1.5,
              paddingTop: 4,
              borderTop: "1px dashed #e8e8e8",
            }}
          >
            {thinkingContent}
          </div>
        </details>
      )}
      {nodes}
    </div>
  );
}
