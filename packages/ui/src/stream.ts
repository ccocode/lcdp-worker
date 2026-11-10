/**
 * 智能体助手 SSE 流式消费驱动（Phase 1 B2 & F1）
 *
 * 封装 Fetch ReadableStream 读取 SSE 帧，支持 init / delta / tool_call / done 事件：
 *  - event: init: 会话初始历史消息与工具调用
 *  - event: delta: 助手生成中的增量 token（支持打字机式平滑推进）
 *  - event: tool_call: 运行时工具调用状态更新
 *  - event: done: 回合办结（最终消息状态、确认卡片与结果包）
 * 发生网络异常或服务端不支持时，返回 false 触发静默降级为 1.2s HTTP 轮询兜底。
 */

export interface ConversationStreamOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onInit?: (data: { messages: any[]; toolCalls: any[] }) => void;
  onDelta?: (data: { messageId: string; text: string; delta: string }) => void;
  onToolCall?: (data: { messageId: string; toolCalls: any[] }) => void;
  onDone?: (data: {
    messageId?: string;
    status?: string;
    message?: any;
    toolCalls?: any[];
    messages?: any[];
  }) => void;
  onError?: (err: Error) => void;
}

export async function consumeConversationStream(
  options: ConversationStreamOptions,
): Promise<boolean> {
  const {
    url,
    headers,
    signal,
    onInit,
    onDelta,
    onToolCall,
    onDone,
    onError,
  } = options;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...(headers ?? {}),
      },
      signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE stream failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        let event = "message";
        let dataStr = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr = line.slice(5).trim();
          }
        }

        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          if (event === "init") onInit?.(parsed);
          else if (event === "delta") onDelta?.(parsed);
          else if (event === "tool_call") onToolCall?.(parsed);
          else if (event === "done") onDone?.(parsed);
        } catch {
          // 忽略非 JSON 数据行
        }
      }
    }

    return true;
  } catch (err) {
    if (signal?.aborted) return true;
    onError?.(err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}
