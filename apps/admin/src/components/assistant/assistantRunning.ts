import type { AdminAssistantTask } from "../../api";

/**
 * 第 103 步步骤 6：任务在跑判定（弹窗关闭 / 刷新 / 切应用三处提示共用）。
 * 第一批（计划一致性）修正：徽标读 runStatus，不读清单——清单待办
 * 不等于执行中（暂停任务 status 仍 active、清单仍 pending，旧口径会
 * 把暂停误标为“进行中”）。runStatus 为空（从未建 run）时不算在跑；
 * 未回的子代理仍算在跑（回合级信号，与 runStatus 互补）。
 */
export function hasRunningAssistantTask(
  tasks: AdminAssistantTask[],
): boolean {
  return (tasks ?? []).some((t) => {
    if (t.status !== "active") return false;
    const artifacts = t.artifacts as
      | { delegations?: { status?: string }[] }
      | null
      | undefined;
    const delegationRunning = Array.isArray(artifacts?.delegations)
      ? artifacts.delegations.some((d) => d?.status === "running")
      : false;
    const runRunning = t.runStatus === "pending" || t.runStatus === "running";
    return runRunning || delegationRunning;
  });
}
