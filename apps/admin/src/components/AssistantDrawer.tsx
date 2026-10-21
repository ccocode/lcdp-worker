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
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantMessage,
} from "../api";

/**
 * 管理台助手抽屉（第 83 步片四）：外壳顶栏全局入口，双上下文——
 * 有当前应用时是该应用的运营助手、无应用时是平台助手（仅平台
 * 管理员）；上下文随当前应用而定，切换应用即换新会话面，旧会话
 * 不串入新上下文。回合制异步与员工面同形：发送只受理，助手回复
 * 经 1.2s 轮询会话详情取回（上限 180s）；写操作以待确认卡片挂在
 * 助手消息上，确认或取消后由服务端执行并回写结果消息。备稿类
 * 结果（如新主题已生成）就是普通助手消息，原样呈现。
 */
export default function AssistantDrawer({
  open,
  onClose,
  appId,
  appName,
}: {
  open: boolean;
  onClose: () => void;
  appId: string | null;
  appName: string | null;
}) {
  /** 新对话代次：自增即让对话面重挂载、开一段新会话 */
  const [seed, setSeed] = useState(0);
  const title = appId ? `运营助手 · ${appName ?? appId}` : "平台助手";
  return (
    <Drawer
      title={title}
      width={"min(480px, 100vw)"}
      open={open}
      onClose={onClose}
      extra={
        <Button size="small" onClick={() => setSeed((s) => s + 1)}>
          新对话
        </Button>
      }
      styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}
    >
      {open && (
        <ChatPane key={`${appId ?? "platform"}:${seed}`} appId={appId} />
      )}
    </Drawer>
  );
}

function ChatPane({ appId }: { appId: string | null }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 轮询代次：新发送或卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);

  const chat = (body: { conversationId?: string; text: string }) =>
    appId
      ? api.assistant.app.chat(appId, body)
      : api.assistant.chat(body);
  const fetchConversation = (cid: string) =>
    appId
      ? api.assistant.app.conversation(appId, cid)
      : api.assistant.conversation(cid);
  const fetchList = () =>
    appId
      ? api.assistant.app.conversations(appId)
      : api.assistant.conversations();
  const confirmAction = (messageId: string, decision: "confirm" | "cancel") =>
    appId
      ? api.assistant.app.confirm(appId, messageId, decision)
      : api.assistant.confirm(messageId, decision);

  // 打开时恢复本上下文最近一段会话（失败静默：发送时自动新建）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchList();
        const latest = list[0];
        if (!latest || !alive) return;
        const detail = await fetchConversation(latest.id);
        if (alive) {
          setConversationId(detail.conversation?.id ?? latest.id);
          setMessages(detail.messages ?? []);
        }
      } catch {
        // 历史读取失败不阻塞使用（如平台助手对非管理员的拒绝）
      }
    })();
    return () => {
      alive = false;
      pollGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  const pollUntilDone = (cid: string, knownAssistantIds: Set<string>) => {
    const gen = ++pollGenRef.current;
    const deadline = Date.now() + 180_000;
    const tick = async () => {
      if (pollGenRef.current !== gen) return;
      try {
        const detail = await fetchConversation(cid);
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
        // 轮询中的短暂失败不中断，继续到截止时间
      }
      if (Date.now() >= deadline) {
        setSending(false);
        setTurnError("助手响应超时（180 秒），可稍后重新打开查看结果");
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
      {
        id: `tmp-${Date.now()}`,
        role: "user",
        text,
        status: "done",
        createdAt: null,
      },
    ]);
    setSending(true);
    try {
      const res = await chat({
        conversationId: conversationId ?? undefined,
        text,
      });
      setConversationId(res.conversationId);
      pollUntilDone(res.conversationId, knownAssistantIds);
    } catch (err) {
      setSending(false);
      setTurnError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAction = async (
    msg: AdminAssistantMessage,
    decision: "confirm" | "cancel",
  ) => {
    if (!msg.pendingAction || msg.pendingAction.handled || confirmingId) return;
    setConfirmingId(msg.id);
    try {
      const res = await confirmAction(msg.id, decision);
      if (res.message) {
        if (res.executed) antdMessage.success(res.message);
        else antdMessage.info(res.message);
      }
      if (conversationId) {
        const detail = await fetchConversation(conversationId);
        setMessages(detail.messages ?? []);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingId(null);
    }
  };

  const renderMessage = (msg: AdminAssistantMessage) => {
    if (msg.role === "system") {
      return (
        <div
          key={msg.id}
          style={{
            alignSelf: "center",
            color: tokens.colorTextTertiary,
            fontSize: 12,
            textAlign: "center",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {msg.text}
        </div>
      );
    }
    const isUser = msg.role === "user";
    const generating = !isUser && msg.status === "generating";
    const failed = !isUser && msg.status === "failed";
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
            background: isUser
              ? tokens.colorPrimary
              : failed
                ? tokens.colorErrorBg
                : tokens.colorBgLayout,
            color: isUser ? tokens.colorBgContainer : tokens.colorText,
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
            style={{
              borderColor: tokens.colorWarningBorder,
              background: tokens.colorWarningBg,
            }}
          >
            {msg.pendingAction.fields &&
              msg.pendingAction.fields.length > 0 && (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {msg.pendingAction.fields.map((f, i) => (
                    <div key={i} style={{ fontSize: 13 }}>
                      <Typography.Text type="secondary">
                        {f.label}：
                      </Typography.Text>
                      {f.value === "" || f.value == null ? "—" : f.value}
                    </div>
                  ))}
                </div>
              )}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {msg.pendingAction.handled ? (
                <Tag>
                  已处理
                  {msg.pendingAction.handled.outcome
                    ? `：${msg.pendingAction.handled.outcome}`
                    : ""}
                </Tag>
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
            description={
              appId
                ? "查本应用的数据、办业务都可以问我"
                : "平台级事项可以问我"
            }
            style={{ marginTop: 48 }}
          />
        ) : (
          messages.map(renderMessage)
        )}
        {sending &&
          !messages.some(
            (m) => m.role === "assistant" && m.status === "generating",
          ) && (
            <div
              style={{
                alignSelf: "flex-start",
                color: tokens.colorTextTertiary,
                fontSize: 13,
              }}
            >
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
          borderTop: `1px solid ${tokens.colorDivider}`,
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
          placeholder="输入问题或要办的事项，Enter 发送"
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
    </>
  );
}
