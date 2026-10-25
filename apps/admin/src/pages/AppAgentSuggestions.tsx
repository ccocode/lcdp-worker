/**
 * 应用内「智能服务 · 主动建议」页（由原 AppAgentService 拆出）：
 * 本人任务卡 + 本应用审计读时派生的主动建议（第 95 步线 B），
 * 处置三态回写；为空整页呈空态。建议「去办」深链：T 类开助手
 * 弹窗并定位对应任务卡；A1 本应用审计页；A3 客服工单页；A4 本
 * 应用应用设置页；回写失败不拦导航。
 */
import { useCallback, useEffect, useState } from "react";
import { Empty, message } from "antd";
import {
  api,
  type AdminAssistantSuggestion,
  type SuggestionDispositionKind,
} from "../api";
import type { PageKey } from "../registry";
import { useAssistantShell } from "../shell/assistantShellContext";
import SuggestionList from "../components/assistant/SuggestionList";

export default function AppAgentSuggestions({
  appId,
  go,
}: {
  appId: string;
  /** 外壳导航（主动建议 A 类深链用；缺省时深链降级为仅记处置） */
  go?: (key: PageKey) => void;
}) {
  const [suggestions, setSuggestions] = useState<AdminAssistantSuggestion[]>(
    [],
  );
  const [busySuggestionFp, setBusySuggestionFp] = useState<string | null>(
    null,
  );
  const { openAssistant } = useAssistantShell();

  // 与主加载解耦的独立静默读——失败即空；按 severity 降序呈现
  // （服务端同口径，客户端再稳一手）。
  useEffect(() => {
    let alive = true;
    void api.assistant.suggestions
      .getAppSuggestions(appId)
      .then((list) => {
        if (alive) {
          setSuggestions([...list].sort((a, b) => b.severity - a.severity));
        }
      })
      .catch(() => {
        if (alive) setSuggestions([]);
      });
    return () => {
      alive = false;
    };
  }, [appId]);

  /** 建议处置回写：成功才移除该条；失败留条并提示（不静默吞处置） */
  const applyDisposition = useCallback(
    async (
      item: AdminAssistantSuggestion,
      disposition: SuggestionDispositionKind,
    ): Promise<boolean> => {
      setBusySuggestionFp(item.fingerprint);
      try {
        await api.assistant.suggestions.postSuggestionDisposition(
          { appId },
          item.fingerprint,
          { disposition },
        );
        setSuggestions((prev) =>
          prev.filter((s) => s.fingerprint !== item.fingerprint),
        );
        return true;
      } catch (err) {
        message.error(err instanceof Error ? err.message : "操作失败");
        return false;
      } finally {
        setBusySuggestionFp(null);
      }
    },
    [appId],
  );

  const disposeSuggestion = useCallback(
    (item: AdminAssistantSuggestion, disposition: "dismissed" | "snoozed") => {
      void applyDisposition(item, disposition);
    },
    [applyDisposition],
  );

  const goSuggestion = useCallback(
    async (item: AdminAssistantSuggestion) => {
      await applyDisposition(item, "acted");
      const rule = item.rule || item.fingerprint.split(":")[0] || "";
      if (rule.startsWith("T")) {
        const taskId = item.subject?.taskId;
        if (taskId) openAssistant({ taskId, nonce: Date.now() });
      } else if (rule === "A1") {
        go?.("app-audit");
      } else if (rule === "A3") {
        go?.("support-tickets");
      } else if (rule === "A4") {
        go?.("appsettings");
      }
    },
    [applyDisposition, go, openAssistant],
  );

  if (suggestions.length === 0) {
    return <Empty description="暂无主动建议" />;
  }
  return (
    <SuggestionList
      items={suggestions}
      busyFingerprint={busySuggestionFp}
      onGo={(item) => void goSuggestion(item)}
      onDispose={disposeSuggestion}
    />
  );
}
