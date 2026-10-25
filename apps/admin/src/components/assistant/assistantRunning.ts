import type { AdminAssistantTask } from "../../api";

/**
 * 第 103 步步骤 6：任务在跑判定（弹窗关闭 / 刷新 / 切应用三处提示共用）。
 * 口径与设计稿 §4.5 一致：active 任务卡且有进行中步骤（pending /
 * active 清单项）或有未回的子代理（running 派发）即算在跑；artifacts
 * 形状防御式读取（服务端 artifacts 为 jsonb，客户端类型为 unknown）。
 */
export function hasRunningAssistantTask(
  tasks: AdminAssistantTask[],
): boolean {
  return (tasks ?? []).some((t) => {
    if (t.status !== "active") return false;
    const stepRunning = (t.checklist ?? []).some(
      (s) => s.status === "pending" || s.status === "active",
    );
    const artifacts = t.artifacts as
      | { delegations?: { status?: string }[] }
      | null
      | undefined;
    const delegationRunning = Array.isArray(artifacts?.delegations)
      ? artifacts.delegations.some((d) => d?.status === "running")
      : false;
    return stepRunning || delegationRunning;
  });
}
