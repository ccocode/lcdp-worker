import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from "antd";
import type {
  AssistantContext,
  AssistantFillForm,
  AssistantMessage,
} from "./api.js";
import { api } from "./api.js";

/**
 * 运行态助手面板（M7）：外壳级悬浮按钮 + 对话抽屉，任意页面可打开。
 * 回合制异步：发送立即返回，助手消息经 1.2s 轮询会话详情取回（≤180s）；
 * 助手消息可带制度引用（来源 chips）与待确认写动作（确认卡片）——
 * 写操作一律经用户确认后由服务端确定性执行；fillForm 类动作不落库，
 * 由前端写 sessionStorage 后跳派生表单回填（表单内由用户最终提交）。
 */
export default function AssistantPanel({
  appId,
  context,
  navigate,
}: {
  appId: string;
  /** 当前页面上下文（外壳按路由尽力推导：path/pageName/entityKey/recordId） */
  context: AssistantContext;
  /** 应用内导航（外壳 goPage，已处理预览前缀） */
  navigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  /** 一轮生成进行中（发送后轮询未结束） */
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 轮询代次：新发送/新对话/卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);

  // AgentChat 组件（renderer）派发的打开事件
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("lcdp:open-assistant", onOpen);
    return () => window.removeEventListener("lcdp:open-assistant", onOpen);
  }, []);

  // 挂载时恢复我的最近会话（失败静默：发送时自动新建）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.assistant.conversations(appId);
        const latest = list[0];
        if (!latest || !alive) return;
        const detail = await api.assistant.conversation(appId, latest.id);
        if (alive) {
          setConversationId(detail.conversation?.id ?? latest.id);
          setMessages(detail.messages ?? []);
        }
      } catch {
        // 历史拉取失败不阻塞使用
      }
    })();
    return () => {
      alive = false;
      pollGenRef.current += 1;
    };
  }, [appId]);

  // 新消息后滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, sending]);

  const pollUntilDone = (cid: string, knownAssistantIds: Set<string>) => {
    const gen = ++pollGenRef.current;
    const deadline = Date.now() + 180_000;
    const tick = async () => {
      if (pollGenRef.current !== gen) return;
      try {
        const detail = await api.assistant.conversation(appId, cid);
        if (pollGenRef.current !== gen) return;
        const msgs = detail.messages ?? [];
        setMessages(msgs);
        const fresh = msgs.filter(
          (m) => m.role === "assistant" && !knownAssistantIds.has(m.id),
        );
        const done = fresh.find((m) => m.status !== "generating");
        if (done) {
          setSending(false);
          if (done.status === "failed") {
            setTurnError(done.text || "助手生成失败，请重试");
          }
          return;
        }
      } catch {
        // 轮询瞬时失败不中断，继续到截止时间
      }
      if (Date.now() >= deadline) {
        setSending(false);
        setTurnError("助手响应超时（180 秒），可稍后重新打开面板查看结果");
        return;
      }
      window.setTimeout(() => void tick(), 1200);
    };
    void tick();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setTurnError(null);
    const knownAssistantIds = new Set(
      messages.filter((m) => m.role === "assistant").map((m) => m.id),
    );
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", text },
    ]);
    setSending(true);
    try {
      const res = await api.assistant.chat(appId, {
        conversationId: conversationId ?? undefined,
        text,
        context,
      });
      setConversationId(res.conversationId);
      pollUntilDone(res.conversationId, knownAssistantIds);
    } catch (err) {
      setSending(false);
      setTurnError(err instanceof Error ? err.message : String(err));
    }
  };

  const startNewConversation = () => {
    pollGenRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setTurnError(null);
    setSending(false);
  };

  /** fillForm 执行：写一次性预填 → 跳派生表单（已在该表单时派发事件触发再次读取） */
  const doFillForm = (ff: AssistantFillForm) => {
    try {
      window.sessionStorage.setItem(
        `lcdp.fill.${ff.entity}`,
        JSON.stringify({ values: ff.values ?? {}, items: ff.items }),
      );
    } catch {
      // sessionStorage 不可用时仍跳转表单（用户手动填写）
    }
    const target = `/e/${ff.entity}/form`;
    if (context.path === target) {
      window.dispatchEvent(
        new CustomEvent("lcdp:fill-form", { detail: { entity: ff.entity } }),
      );
    } else {
      navigate(target);
    }
    setOpen(false);
  };

  const handleAction = async (
    msg: AssistantMessage,
    decision: "confirm" | "cancel",
  ) => {
    if (!msg.pendingAction || msg.pendingAction.handled || confirmingId) return;
    setConfirmingId(msg.id);
    try {
      const res = await api.assistant.confirmAction(appId, msg.id, decision);
      if (res.message) {
        if (res.executed) antdMessage.success(res.message);
        else antdMessage.info(res.message);
      }
      if (decision === "confirm" && res.fillForm) doFillForm(res.fillForm);
      // 刷新会话：回读 handled 状态与服务端回写的结果消息
      if (conversationId) {
        const detail = await api.assistant.conversation(appId, conversationId);
        setMessages(detail.messages ?? []);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingId(null);
    }
  };

  const formatActionValue = (v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const renderMessage = (msg: AssistantMessage) => {
    const isUser = msg.role === "user";
    const generating = !isUser && msg.status === "generating";
    return (
      <div
        key={msg.id}
        style={{
          alignSelf: isUser ? "flex-end" : "flex-start",
          maxWidth: "88%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            background: isUser ? "#1677ff" : "#f5f5f5",
            color: isUser ? "#fff" : "inherit",
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 14,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {msg.text}
          {generating && <Spin size="small" style={{ marginLeft: 8 }} />}
        </div>
        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {msg.citations.map((c, i) => (
              <Tooltip key={i} title={c.snippet}>
                <Tag style={{ cursor: "help", marginInlineEnd: 0 }}>
                  📄 {c.docTitle}
                </Tag>
              </Tooltip>
            ))}
          </div>
        )}
        {!isUser && msg.pendingAction && (
          <Card
            size="small"
            title={msg.pendingAction.summary}
            style={{ borderColor: "#ffe58f", background: "#fffbe6" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {msg.pendingAction.fields.map((f, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <Typography.Text type="secondary">{f.label}：</Typography.Text>
                  {formatActionValue(f.value)}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {msg.pendingAction.handled ? (
                <Tag color="default">已处理</Tag>
              ) : (
                <>
                  <Button
                    type="primary"
                    size="small"
                    loading={confirmingId === msg.id}
                    onClick={() => void handleAction(msg, "confirm")}
                  >
                    确认执行
                  </Button>
                  <Button
                    size="small"
                    disabled={confirmingId === msg.id}
                    onClick={() => void handleAction(msg, "cancel")}
                  >
                    取消
                  </Button>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    );
  };

  return (
    <>
      <Button
        type="primary"
        shape="round"
        size="large"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 999,
          boxShadow: "0 6px 16px rgba(0,0,0,0.24)",
        }}
      >
        ✦ 助手
      </Button>
      <Drawer
        title="✦ 智能助手"
        width={"min(480px, 100vw)"}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button size="small" onClick={startNewConversation}>
            新对话
          </Button>
        }
        styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}
      >
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {messages.length === 0 && !sending ? (
            <Empty
              description="问我查数据、办业务或制度问题都可以"
              style={{ marginTop: 48 }}
            />
          ) : (
            messages.map(renderMessage)
          )}
          {sending &&
            !messages.some(
              (m) => m.role === "assistant" && m.status === "generating",
            ) && (
              <div style={{ alignSelf: "flex-start", color: "#8c8c8c", fontSize: 13 }}>
                <Spin size="small" style={{ marginRight: 8 }} />
                正在处理…
              </div>
            )}
          {turnError && (
            <Typography.Text type="danger" style={{ fontSize: 13 }}>
              {turnError}
            </Typography.Text>
          )}
        </div>
        <div
          style={{
            borderTop: "1px solid #f0f0f0",
            padding: 12,
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="输入问题或业务指令，Enter 发送（Shift+Enter 换行）"
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="primary"
            loading={sending}
            disabled={!input.trim()}
            onClick={() => void send()}
          >
            发送
          </Button>
        </div>
      </Drawer>
    </>
  );
}
