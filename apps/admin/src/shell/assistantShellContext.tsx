import { createContext, useContext } from "react";

/**
 * 第 103 步步骤 6：外壳助手入口上下文——页内需要打开助手弹窗时
 * （如智能服务页的工作台入口、主动建议 T 类「去办」定位）经此调
 * 外壳的弹窗，不再各自内嵌工作台。focusTask 为任务定位信号（与
 * 工作台 focusTask 同形），弹窗打开后透传给工作台选中对应任务卡。
 */
export interface AssistantShell {
  openAssistant: (focusTask?: { taskId: string; nonce: number }) => void;
}

export const AssistantShellContext = createContext<AssistantShell>({
  openAssistant: () => {},
});

export const useAssistantShell = () => useContext(AssistantShellContext);
