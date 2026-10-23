import { useState } from "react";
import { Button, Drawer } from "antd";
import ChatPane, {
  type AssistantPageContext,
} from "./assistant/ChatPane";

/**
 * 管理台助手抽屉（第 83 步片四）：外壳顶栏全局入口，双上下文——
 * 有当前应用时是该应用的运营助手、无应用时是平台助手（仅平台
 * 管理员）；上下文随当前应用而定，切换应用即换新会话面，旧会话
 * 不串入新上下文。对话面本体为共用组件 ChatPane（第 91 步线 A
 * 抽出，与智能服务页全页工作台双形态复用），本文件只剩抽屉壳：
 * 标题、宽度、开合与「新对话」代次管理。
 *
 * 会话语义锚点：点「新对话」自增 seed 重挂载 ChatPane 并传
 * fresh=true（跳过恢复、真空白）；关闭即复位代次——抽屉组件在
 * AppShell 里常驻，seed 若跨开关保留，点过一次「新对话」后每次
 * 打开都会 fresh 跳过恢复（第 90 步验收实证）。即「打开抽屉 =
 * 恢复最近会话，只有刚点过新对话的当次挂载才空白」。
 */

export type { AssistantPageContext };

export default function AssistantDrawer({
  open,
  onClose,
  appId,
  appName,
  context,
}: {
  open: boolean;
  onClose: () => void;
  appId: string | null;
  appName: string | null;
  context?: AssistantPageContext;
}) {
  /** 新对话代次：自增即让对话面重挂载、开一段新会话（fresh 语义见文件头） */
  const [seed, setSeed] = useState(0);
  const title = appId ? `运营助手 · ${appName ?? appId}` : "平台助手";
  // 关闭即复位代次（理由见文件头语义锚点）
  const handleClose = () => {
    setSeed(0);
    onClose();
  };
  return (
    <Drawer
      title={title}
      width={"min(480px, 100vw)"}
      open={open}
      onClose={handleClose}
      extra={
        <Button size="small" onClick={() => setSeed((s) => s + 1)}>
          新对话
        </Button>
      }
      styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}
    >
      {open && (
        <ChatPane
          key={`${appId ?? "platform"}:${seed}`}
          appId={appId}
          fresh={seed > 0}
          pageContext={context}
          onClose={handleClose}
        />
      )}
    </Drawer>
  );
}
