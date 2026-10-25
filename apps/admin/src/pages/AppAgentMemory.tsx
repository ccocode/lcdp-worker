/**
 * 应用内「智能服务 · 助手记忆」页（由原 AppAgentService 拆出）：
 * 助手记忆（本人作用域，可查改删 + 待确认区）。面板本体复用
 * AssistantMemoryPanel（弹窗右侧记忆速览同款组件）；本页只负责
 * 读站点属性取应用名。
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import AssistantMemoryPanel from "../components/assistant/AssistantMemoryPanel";

export default function AppAgentMemory({ appId }: { appId: string }) {
  const [appName, setAppName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.site
      .get(appId)
      .then((site) => {
        if (alive) setAppName(site.app?.name ?? null);
      })
      .catch(() => {
        if (alive) setAppName(null);
      });
    return () => {
      alive = false;
    };
  }, [appId]);
  return <AssistantMemoryPanel appId={appId} appName={appName} />;
}
