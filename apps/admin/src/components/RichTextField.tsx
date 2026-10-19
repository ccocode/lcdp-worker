import React, { useEffect, useMemo, useRef, useState } from "react";
import { message } from "antd";
import { Editor, Toolbar } from "@wangeditor/editor-for-react";
import type { IDomEditor, IEditorConfig } from "@wangeditor/editor";
import "@wangeditor/editor/dist/css/style.css";
import { API_BASE, api } from "../api";

/**
 * 管理台富文本编辑控件（第 58 步，与运行态 renderer 的 RichTextInput 同款
 * wangEditor v5、同行为口径）：value = HTML 字符串，onChange 回 HTML。
 * 接口兼容 antd Form 注入（value/onChange），DataAdmin 表单与文章写稿面共用。
 * 插图走平台资产通道：以 visibility=public 登记、插入「裸内容地址」——
 * 内容地址若带令牌查询串（?t=）必须剥离，令牌绝不能写进正文落库
 * （public 资产裸地址可匿名读，前台官网可直显）。
 */
export interface RichTextFieldProps {
  value?: string;
  onChange?: (html: string) => void;
  /** 上传资产归属应用（插图登记到本应用资产下） */
  appId: string;
  /** 编辑区高度（px）：正文默认 320，写稿面传更高 */
  height?: number;
  /** 只读呈现：遮罩兜住 contenteditable 区（Form disabled 管不到编辑器内部） */
  readOnly?: boolean;
}

export default function RichTextField({
  value,
  onChange,
  appId,
  height = 320,
  readOnly = false,
}: RichTextFieldProps) {
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
            api.assets
              .upload(file, appId, "public")
              .then((meta) => {
                // 裸内容地址：剥一切查询串（令牌绝不落库），与 renderer 插图口径一致
                const url = `${API_BASE}${meta.contentUrl}`.split("?")[0]!;
                insertFn(url, meta.name ?? "", url);
              })
              .catch((err: unknown) => {
                message.error(
                  `图片上传失败：${err instanceof Error ? err.message : String(err)}`,
                );
              });
          },
        },
      },
    }),
    [appId],
  );

  return (
    <div
      style={{
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        width: "100%",
        // 工具栏弹层需压过 antd 常规层级（与基线令牌同口径）
        zIndex: 100,
        ...(readOnly ? { pointerEvents: "none" as const, opacity: 0.75 } : {}),
      }}
    >
      <Toolbar
        editor={editor}
        mode="default"
        style={{ borderBottom: "1px solid #e8e8e8" }}
      />
      <Editor
        defaultConfig={editorConfig}
        value={html}
        onCreated={setEditor}
        onChange={(ed) => {
          const next = ed.getHtml();
          knownRef.current = next;
          setHtml(next);
          onChange?.(next);
        }}
        mode="default"
        style={{ height: `${height}px`, overflowY: "hidden" }}
      />
    </div>
  );
}
