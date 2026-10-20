import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Editor, Toolbar } from "@wangeditor/editor-for-react";
import type { IDomEditor, IEditorConfig } from "@wangeditor/editor";
import "@wangeditor/editor/dist/css/style.css";
import type { RuntimeAdapter } from "./adapter.js";
import { tokens } from "@lcdp/ui";

/**
 * 富文本（M10）三件套：净化、纯文本摘要、呈现视图与编辑控件。
 * 正文以 HTML 字符串存储（richtext 字段），净化统一在渲染端做——
 * 入库不预处理，存量与新数据走同一道 DOMPurify 白名单，公开匿名页呈现也安全。
 */

/**
 * HTML 净化：DOMPurify 默认白名单起步（脚本/事件属性/危险协议默认即被剥离），
 * 再显式禁 style 属性——避免内联样式污染宿主排版，编辑器产出的对齐/颜色等样式在呈现端不生效（安全优先口径）。
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

let richTextCssInjected = false;
/** 正文呈现的最小排版兜底（图片不溢出、表格有边框），注入一次全局样式 */
function ensureRichTextCss() {
  if (richTextCssInjected || typeof document === "undefined") return;
  richTextCssInjected = true;
  const el = document.createElement("style");
  el.textContent = [
    ".lcdp-richtext{line-height:1.7;word-break:break-word}",
    ".lcdp-richtext img{max-width:100%;height:auto}",
    ".lcdp-richtext p{margin:0 0 8px}",
    ".lcdp-richtext table{border-collapse:collapse}",
    `.lcdp-richtext td,.lcdp-richtext th{border:1px solid ${tokens.colorBorderControl};padding:4px 8px}`,
  ].join("");
  document.head.appendChild(el);
}

/** 富文本呈现：净化后 HTML 直出（Detail 与表单只读态共用）；空值按全站口径显示「—」 */
export function RichTextView({ html }: { html: string }) {
  ensureRichTextCss();
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (!clean.trim()) return <>—</>;
  return (
    <div
      className="lcdp-richtext"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

interface RichTextInputProps {
  value: unknown;
  onChange: (value: unknown) => void;
  adapter: RuntimeAdapter;
  /** 本字段 key（资产上传关联标注用） */
  fieldKey: string;
  /** 资产上传关联（与 file/image 字段同一 linkage 口径） */
  linkage?: { entity?: string; recordId?: string };
}

/**
 * 富文本编辑控件（wangEditor v5）：value = HTML 字符串，onChange 回 HTML。
 * 插图走平台资产通道（adapter.uploadAsset，复用 M9 的 file/image 上传路径），
 * 以 visibility=public 登记并插入「裸内容地址」——assetContentUrl 带当前登录令牌 ?t=，
 * 令牌绝不能写进正文落库，故插入前剥离查询串（public 资产裸地址可匿名读，前台官网可直显）。
 */
export function RichTextInput({
  value,
  onChange,
  adapter,
  fieldKey,
  linkage,
}: RichTextInputProps) {
  const initial = typeof value === "string" ? value : "";
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const [html, setHtml] = useState(initial);
  // 最近一次「已知内容」（外部传入或编辑产出）：外部值与之不同才同步进编辑器，避免打字回环重置光标
  const knownRef = useRef(initial);

  useEffect(() => {
    const incoming = typeof value === "string" ? value : "";
    if (incoming !== knownRef.current) {
      knownRef.current = incoming;
      setHtml(incoming);
    }
  }, [value]);

  // 组件卸载时销毁编辑器实例（wangEditor 官方推荐口径）
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy();
        setEditor(null);
      }
    };
  }, [editor]);

  const editorConfig = useMemo<Partial<IEditorConfig>>(
    () => ({
      placeholder: "请输入正文内容…",
      MENU_CONF: {
        uploadImage: {
          customUpload: (
            file: File,
            insertFn: (url: string, alt: string, href: string) => void,
          ) => {
            adapter
              .uploadAsset(file, {
                entity: linkage?.entity,
                recordId: linkage?.recordId,
                field: fieldKey,
                visibility: "public",
              })
              .then((meta) => {
                const url = adapter.assetContentUrl(meta.id).split("?")[0]!;
                insertFn(url, meta.name ?? "", url);
              })
              .catch((err: unknown) => {
                adapter.notify(
                  `图片上传失败：${err instanceof Error ? err.message : String(err)}`,
                  "error",
                );
              });
          },
        },
      },
    }),
    [adapter, fieldKey, linkage?.entity, linkage?.recordId],
  );

  return (
    <div
      style={{
        border: `1px solid ${tokens.colorBorderControl}`,
        borderRadius: 6,
        width: "100%",
        // 工具栏弹层需压过 antd 常规层级
        zIndex: 100,
      }}
    >
      <Toolbar
        editor={editor}
        mode="default"
        style={{ borderBottom: `1px solid ${tokens.colorBorder}` }}
      />
      <Editor
        defaultConfig={editorConfig}
        value={html}
        onCreated={setEditor}
        onChange={(ed) => {
          const next = ed.getHtml();
          knownRef.current = next;
          setHtml(next);
          onChange(next);
        }}
        mode="default"
        style={{ height: "320px", overflowY: "hidden" }}
      />
    </div>
  );
}
