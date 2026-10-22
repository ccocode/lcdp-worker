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
  staffName,
  staffEnabled,
}: {
  appId: string;
  /** 当前页面上下文（外壳按路由尽力推导：path/pageName/entityKey/recordId） */
  context: AssistantContext;
  /** 应用内导航（外壳 goPage，已处理预览前缀） */
  navigate: (to: string) => void;
  /**
   * 员工面声明名（快照 agents.staff.name，第 84 步片六）：有值时抽屉标题
   * 显示该名，无值（段缺失/未声明名）回落「智能助手」。
   */
  staffName?: string | null;
  /**
   * 员工面启停（快照 agents.staff.enabled）：明确 false 时不渲染任何入口
   * （与服务端 chat 403 口径对齐）；缺失时按启用处理。
   */
  staffEnabled?: boolean;
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
  /** 挂载恢复（最近会话）是否已 settle：对齐触发须等它完成，防抢先新建会话 */
  const [restored, setRestored] = useState(false);
  /**
   * 上下文对齐在飞集合（第 84 步片七）：键 = 会话 id（未知时 "new"）+ 触发标记。
   * 与「消息内容扫描 + 服务端去重」共同防重复对齐；发起失败也保留键，
   * 不自动重试（用户仍可手动提问），新对话时整表清空。
   */
  const alignInFlightRef = useRef<Set<string>>(new Set());

  // AgentChat 组件（renderer）派发的打开事件
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("lcdp:open-assistant", onOpen);
    return () => window.removeEventListener("lcdp:open-assistant", onOpen);
  }, []);

  // 回填结果留痕上报（第 84 步片三② / 第 85 步分桶）：renderer 表单回读后
  // 派发 lcdp:fill-outcome（detail = { entity, messageId, missed[],
  // unverifiable[] }），未落与无法核对分开透传。防串应用口径：doFillForm
  // 发起回填时已把「来源消息 id → 发起应用 id」绑定写入 sessionStorage，
  // 本监听只在绑定存在且与本面板当前 appId 一致时才上报（应用切换瞬间
  // 到达的事件绑定必属别的应用、直接跳过）；绑定一次性消费。留痕尽力
  // 而为，失败静默。
  useEffect(() => {
    const onFillOutcome = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          messageId?: unknown;
          missed?: unknown;
          unverifiable?: unknown;
        }>
      ).detail;
      const messageId =
        typeof detail?.messageId === "string" ? detail.messageId : "";
      if (!messageId) return;
      let boundAppId: string | null = null;
      try {
        boundAppId = window.sessionStorage.getItem(
          `lcdp.fillbind.${messageId}`,
        );
        window.sessionStorage.removeItem(`lcdp.fillbind.${messageId}`);
      } catch {
        return;
      }
      if (boundAppId !== appId) return;
      const missed = Array.isArray(detail?.missed)
        ? detail.missed.filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      const unverifiable = Array.isArray(detail?.unverifiable)
        ? detail.unverifiable.filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      void api.assistant
        .reportFillResult(appId, messageId, missed, unverifiable)
        .catch(() => {
          // 留痕上报失败静默，不阻塞用户
        });
    };
    window.addEventListener("lcdp:fill-outcome", onFillOutcome);
    return () =>
      window.removeEventListener("lcdp:fill-outcome", onFillOutcome);
  }, [appId]);

  // 挂载时恢复我的最近会话（失败静默：发送时自动新建）
  useEffect(() => {
    let alive = true;
    setRestored(false);
    alignInFlightRef.current.clear();
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
      } finally {
        if (alive) setRestored(true);
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

  /**
   * 上下文主动对齐（第 84 步片七）：在单据页（context 带 entityKey + recordId）
   * 打开助手时，自动发起一轮对齐回合——服务端落 system 触发消息（带 trigger
   * 标记、不冒充用户发言），助手先取数给现状摘要 + 可办下一步（提案形式）。
   * 打扰边界：仅打开抽屉时触发，不主动弹窗、不后台轮询。防重复三层：
   * 本 effect 的消息扫描（已含同标记消息不再发）+ 在飞集合 + 服务端
   * alreadyAligned 去重；同一会话对同一记录只对齐一次，换记录/新会话可再对齐。
   */
  useEffect(() => {
    if (!open || !restored || sending) return;
    const entity = context.entityKey;
    const recordId = context.recordId;
    if (!entity || !recordId) return;
    const token = `context_align:${entity}:${recordId}`;
    if (messages.some((m) => m.trigger === token)) return;
    const flightKey = `${conversationId ?? "new"}|${token}`;
    if (alignInFlightRef.current.has(flightKey)) return;
    alignInFlightRef.current.add(flightKey);
    void (async () => {
      setTurnError(null);
      const knownAssistantIds = new Set(
        messages.filter((m) => m.role === "assistant").map((m) => m.id),
      );
      setSending(true);
      try {
        const res = await api.assistant.chat(appId, {
          conversationId: conversationId ?? undefined,
          align: { entity, recordId },
          context,
        });
        setConversationId(res.conversationId);
        alignInFlightRef.current.delete(flightKey);
        alignInFlightRef.current.add(`${res.conversationId}|${token}`);
        if (res.alreadyAligned) {
          // 服务端已有该记录的对齐回合：回读会话即可；若它还在生成中转入轮询
          const detail = await api.assistant.conversation(
            appId,
            res.conversationId,
          );
          const msgs = detail.messages ?? [];
          setMessages(msgs);
          const target = msgs.find((m) => m.id === res.messageId);
          if (target && target.status === "generating") {
            const known = new Set(
              msgs
                .filter((m) => m.role === "assistant" && m.id !== res.messageId)
                .map((m) => m.id),
            );
            pollUntilDone(res.conversationId, known);
          } else {
            setSending(false);
          }
          return;
        }
        pollUntilDone(res.conversationId, knownAssistantIds);
      } catch (err) {
        setSending(false);
        setTurnError(err instanceof Error ? err.message : String(err));
      }
    })();
    // context 对象每次渲染都是新引用，只取其标量字段作依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    restored,
    sending,
    appId,
    conversationId,
    context.entityKey,
    context.recordId,
    messages,
  ]);

  const startNewConversation = () => {
    pollGenRef.current += 1;
    alignInFlightRef.current.clear();
    setConversationId(null);
    setMessages([]);
    setTurnError(null);
    setSending(false);
  };

  /**
   * fillForm 执行：写一次性预填 → 跳派生表单（已在该表单时派发事件触发再次读取）。
   * 回填保真（第 84 步片三）：除 values/items 外，把用户刚确认的提案字段
   * （expect：标签+展示值，仅含有值项）与来源消息 id 一并写入预填载荷——
   * 表单侧据此在回填后逐字段回读比对，未落字段明示用户手动补齐
   * （载荷形状与 renderer EntityForm 的 applyAssistantFill 读取端对齐）。
   */
  const doFillForm = (ff: AssistantFillForm, source?: AssistantMessage) => {
    try {
      window.sessionStorage.setItem(
        `lcdp.fill.${ff.entity}`,
        JSON.stringify({
          values: ff.values ?? {},
          items: ff.items,
          expect: (source?.pendingAction?.fields ?? []).filter(
            (f) =>
              f.value !== null && f.value !== undefined && f.value !== "",
          ),
          sourceMessageId: source?.id,
        }),
      );
      // 回填归属绑定（第 84 步片三②）：表单回读事件到达时据此判定该回填
      // 属于哪个应用，防应用切换瞬间把留痕串报到别的应用（见上方监听）。
      if (source?.id) {
        window.sessionStorage.setItem(`lcdp.fillbind.${source.id}`, appId);
      }
    } catch {
      // sessionStorage 不可用时仍跳转表单（用户手动填写）
    }
    const target = `/e/${ff.entity}/form`;
    // 第 89 步 B2（F13）：同实体**编辑**表单页（path 同为表单路由、但带记录
    // id——id 承载于 URL query ?id=，见 DataTable.openRow 与 EntityForm 的
    // ctx.params.id）不能走事件路径：renderer 的 applyAssistantFill 有 isEdit
    // 守卫，事件到达会被静默吞掉、载荷滞留 sessionStorage。fillForm 语义是
    // 起草新单，故编辑态一律 navigate 到无 id 的新建表单；宿主 SchemaRenderer
    // 已按 路由+id 换 key，id 消失即整页重挂载，新表单挂载时自动消费载荷。
    if (context.path === target && !context.recordId) {
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
      if (decision === "confirm" && res.fillForm) doFillForm(res.fillForm, msg);
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
    // 系统消息（确认结果通知、上下文对齐触发标签）：居中浅色小字一行，
    // 不套用户/助手气泡——它们不是任何一方的发言（第 84 步片七回放诚实）
    if (msg.role === "system") {
      return (
        <div
          key={msg.id}
          style={{
            alignSelf: "center",
            maxWidth: "92%",
            color: "#8c8c8c",
            fontSize: 12,
            textAlign: "center",
            padding: "2px 8px",
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
            {msg.pendingAction.droppedKeys &&
              msg.pendingAction.droppedKeys.length > 0 && (
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <Typography.Text type="secondary">
                    提案中有 {msg.pendingAction.droppedKeys.length}{" "}
                    个字段与数据模型不匹配，已忽略：
                    {msg.pendingAction.droppedKeys.join("、")}
                  </Typography.Text>
                </div>
              )}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {msg.pendingAction.fields.map((f, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <Typography.Text type="secondary">{f.label}：</Typography.Text>
                  {formatActionValue(f.value)}
                </div>
              ))}
            </div>
            {(msg.pendingAction.kind === "fillForm" ||
              msg.pendingAction.kind === "createRecord") &&
              msg.pendingAction.missingFields &&
              msg.pendingAction.missingFields.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary
                    style={{
                      fontSize: 13,
                      cursor: "pointer",
                      color: tokens.colorTextSecondary,
                    }}
                  >
                    未提供的字段（{msg.pendingAction.missingFields.length}）
                  </summary>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      marginTop: 4,
                    }}
                  >
                    {msg.pendingAction.missingFields.map((label, i) => (
                      <div key={i} style={{ fontSize: 13 }}>
                        <Typography.Text type="secondary">
                          {label}：
                        </Typography.Text>
                        未提供
                      </div>
                    ))}
                  </div>
                </details>
              )}
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

  // 片六：抽屉标题读员工面声明名（staffName），无名回落通用称呼；
  // 员工面明确停用（staffEnabled === false）时不渲染任何入口——本 return 在
  // 全部 hook 之后，hook 顺序不受影响。
  const faceName =
    typeof staffName === "string" && staffName.trim()
      ? staffName.trim()
      : null;
  if (staffEnabled === false) return null;

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
          bottom: "calc(24px + var(--lcdp-nav-offset, 0px))",
          zIndex: 999,
          boxShadow: "0 6px 16px rgba(0,0,0,0.24)",
        }}
      >
        ✦ 助手
      </Button>
      <Drawer
        title={faceName ? `✦ ${faceName}` : "✦ 智能助手"}
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
