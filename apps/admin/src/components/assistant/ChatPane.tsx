import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantMessage,
  type AdminAssistantPayload,
  type AdminAssistantTask,
  type AdminAssistantToolCall,
} from "../../api";
import { fmtTime } from "../../helpers";
import {
  fmtElapsed,
  stepDurationMs,
  turnStepsOf,
  type TurnStep,
} from "./turnSteps";
import {
  DelegationMessageCard,
  PlanMessageCard,
  type DelegationViewTarget,
} from "./MessageTaskCards";

/**
 * 管理台助手对话面（第 83 步片四起，第 90 步线 A 升级，第 91 步线 A
 * 抽为共用组件）：抽屉（AssistantDrawer）与智能服务页全页工作台
 * （AssistantWorkbench）双形态复用同一组件，行为逐字一致、状态
 * 不互串（各自挂载、各自 key）。回合制异步：发送只受理，助手回复
 * 经 1.2s 轮询会话详情取回（上限 180s）；写操作以待确认卡片挂在
 * 助手消息上，确认或取消后由服务端执行并回写结果消息。
 *
 * 语义（代码即文档，手工走查按此核对）：
 * - 会话语义（第 90 步 A1）：以 fresh 标记区分挂载——首次挂载
 *   （fresh=false 且未指定 initialConversationId）才跑「恢复本上下文
 *   最近一段会话」；fresh=true 跳过恢复、conversationId 保持 null，
 *   发送时由服务端新建。即「打开=接着聊、新对话=真空白」。工作台
 *   另可经 initialConversationId 打开左栏点选的指定会话，此时同样
 *   跳过「恢复最近」逻辑、直接载入该会话。
 * - 富渲染（第 90 步 A2）：消息 text 经自写小解析器渲染（linkify +
 *   轻量 markdown 子集），全程走 React 文本节点、天然转义。
 * - 结果卡（第 90 步 A3）：助手消息可带 payload 结构化结果。
 * - 上下文带入（第 90 步 A4）：外壳/页面组装 context 透传回合
 *   （服务端收 pageContext；顶部明示行已于 103-6 用户修订中删
 *   除）；应用上下文另有进行中任务卡横条（A5，工作台形态以
 *   hideTaskBar 关闭——右栏已有任务详情）。
 * - 过程可见（第 91 步 A2）：生成中消息下方呈现步骤流（助手文本
 *   即 say 行 + 工具调用摘要〔turnSteps 适配点归一〕+ 已耗时），
 *   并给「中止」按钮（调线 B 取消端点，失败静默降级不崩）；
 *   failed 消息给「重试本步」入口（重发上一条用户消息承接续办）。
 */

/** 页面上下文（第 90 步 A4）：字段能拿到才带，拿不到不硬造 */
export interface AssistantPageContext {
  path: string;
  pageName?: string;
  appId?: string | null;
  segment: string;
  entityKey?: string;
}

export interface ChatPaneProps {
  appId: string | null;
  /** true = 经「新对话」开局，跳过恢复、从空白开始 */
  fresh: boolean;
  pageContext?: AssistantPageContext;
  onClose?: () => void;
  /** 工作台：打开指定会话（左栏点选）；抽屉不传 */
  initialConversationId?: string | null;
  /** 工作台：当前会话 id 变化时回告（父级刷新左栏列表用） */
  onConversationChange?: (cid: string | null) => void;
  /** 工作台：外部灌入输入框的草稿（如任务卡「继续」），nonce 变化即生效 */
  draftSignal?: { text: string; nonce: number } | null;
  /** 工作台：隐藏 A5 任务卡横条（右栏已有任务详情） */
  hideTaskBar?: boolean;
  /** 工作台：消息内派发卡片的“查看详情”（右侧打开子代理详情）；平台面不传 */
  onOpenDelegation?: (target: DelegationViewTarget) => void;
}

/* ------------------------------------------------------------------ */
/* 富渲染最小集：linkify + 轻量 markdown（加粗 / 行内代码 / 无序列表 / 分段）
 * 全程输出 React 节点：字符串片段作为文本子节点渲染即天然转义，
 * 不使用 dangerouslySetInnerHTML、不引第三方库。                        */
/* ------------------------------------------------------------------ */

const INLINE_RE = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(https?:\/\/[^\s<>"'`）】，。；：！？、]+)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (m[2]) {
      out.push(
        <code
          key={key}
          style={{
            fontFamily: "monospace",
            fontSize: "0.92em",
            background: tokens.colorPrimaryBg,
            borderRadius: 4,
            padding: "0 4px",
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          {tok}
        </a>,
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderRichText(text: string): ReactNode {
  const lines = (text ?? "").split("\n");
  const blocks: ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (listBuf.length === 0) return;
    const items = listBuf;
    listBuf = [];
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        style={{ margin: 0, paddingLeft: 18 }}
      >
        {items.map((it, i) => (
          <li key={i}>{renderInline(it, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
  };
  lines.forEach((raw, li) => {
    const line = raw.trimEnd();
    const listMatch = /^[-•]\s+(.*)$/.exec(line.trim());
    if (listMatch) {
      listBuf.push(listMatch[1]!);
      return;
    }
    flushList();
    if (line.trim() === "") return;
    blocks.push(
      <div key={`p-${li}`}>{renderInline(line.trim(), `p-${li}`)}</div>,
    );
  });
  flushList();
  return blocks;
}

/* ------------------------------------------------------------------ */
/* payload 结果卡                                                       */
/* ------------------------------------------------------------------ */

/** route 站内跳转：沿用外壳的 history + popstate 导航机制 */
function navigateRoute(route: string, onClose?: () => void) {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
  onClose?.();
}

/** themeCreated 的 data 摘要行：有什么显示什么、缺项不造 */
function themeCreatedSummary(data: Record<string, unknown>): string[] {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  const num = (v: unknown): string | null =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  const rows: string[] = [];
  const name = str(data.name);
  const id = str(data.themeId) ?? str(data.id);
  const version = str(data.version);
  if (name) rows.push(`主题：${name}`);
  if (id) rows.push(`标识：${id}${version ? `@${version}` : ""}`);
  else if (version) rows.push(`版本：${version}`);
  const target = str(data.target);
  if (target) rows.push(`槽位：${target === "mobile" ? "移动端" : target === "desktop" ? "桌面端" : target}`);
  const files = num(data.fileCount) ?? num(data.files);
  if (files) rows.push(`文件数：${files}`);
  return rows;
}

function PayloadCard({
  payload,
  onClose,
}: {
  payload: AdminAssistantPayload;
  onClose?: () => void;
}) {
  const isTheme = payload.kind === "themeCreated";
  const title =
    payload.title ?? (isTheme ? "主题已生成" : "已完成");
  const summaryRows =
    isTheme && payload.data ? themeCreatedSummary(payload.data) : [];
  const actions = (payload.actions ?? []).filter(
    (a) => a && typeof a.label === "string" && (a.href || a.route),
  );
  return (
    <Card
      size="small"
      title={title}
      style={{
        borderColor: tokens.colorBorder,
        background: tokens.colorBgContainer,
      }}
    >
      {summaryRows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {summaryRows.map((row, i) => (
            <Typography.Text key={i} style={{ fontSize: 13 }}>
              {row}
            </Typography.Text>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div style={{ marginTop: summaryRows.length ? 10 : 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((a, i) =>
            a.href ? (
              <Button
                key={i}
                size="small"
                type={a.primary ? "primary" : "default"}
                href={a.href}
                target="_blank"
                rel="noreferrer"
              >
                {a.label}
              </Button>
            ) : (
              <Button
                key={i}
                size="small"
                type={a.primary ? "primary" : "default"}
                onClick={() => navigateRoute(a.route!, onClose)}
              >
                {a.label}
              </Button>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 过程可见（第 91 步 A2）：步骤流 + 已耗时 + 中止                        */
/* ------------------------------------------------------------------ */

function StepRow({ step }: { step: TurnStep }) {
  const dur = stepDurationMs(step);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: tokens.colorTextSecondary,
        minWidth: 0,
      }}
    >
      {step.status === "running" ? (
        <Spin size="small" />
      ) : step.status === "done" ? (
        <span style={{ color: tokens.colorSuccess, width: 14, textAlign: "center" }}>✓</span>
      ) : step.status === "failed" ? (
        <span style={{ color: tokens.colorErrorText, width: 14, textAlign: "center" }}>✕</span>
      ) : (
        <span style={{ color: tokens.colorTextTertiary, width: 14, textAlign: "center" }}>·</span>
      )}
      <Typography.Text
        style={{ fontSize: 12, flexShrink: 0 }}
        title={step.tool}
      >
        {step.tool}
      </Typography.Text>
      {step.summary && (
        <Typography.Text
          type="secondary"
          ellipsis
          style={{ fontSize: 12, minWidth: 0 }}
          title={step.summary}
        >
          {step.summary}
        </Typography.Text>
      )}
      {dur !== null && (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {fmtElapsed(dur)}
        </Typography.Text>
      )}
    </div>
  );
}

function TurnProcess({
  steps,
  elapsedMs,
  onCancel,
  cancelling,
  cancelDisabled,
}: {
  steps: TurnStep[];
  /** 本回合已耗时（毫秒） */
  elapsedMs: number;
  onCancel?: () => void;
  cancelling: boolean;
  /** 取消端点调用失败过：本回合不再让点（静默降级） */
  cancelDisabled: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        border: `1px solid ${tokens.colorDivider}`,
        borderRadius: 8,
        background: tokens.colorBgContainer,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
          执行中 · 已耗时 {fmtElapsed(elapsedMs)}
        </Typography.Text>
        {onCancel && (
          <Button
            size="small"
            danger
            type="text"
            loading={cancelling}
            disabled={cancelDisabled}
            style={{ height: "auto", padding: "0 4px", fontSize: 12 }}
            onClick={onCancel}
          >
            中止
          </Button>
        )}
      </div>
      {steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 对话面                                                               */
/* ------------------------------------------------------------------ */

const PASSED_STATUS = new Set([
  "done",
  "passed",
  "pass",
  "ok",
  "complete",
  "completed",
  "success",
  "checked",
]);

export default function ChatPane({
  appId,
  fresh,
  pageContext,
  onClose,
  initialConversationId,
  onConversationChange,
  draftSignal,
  hideTaskBar,
  onOpenDelegation,
}: ChatPaneProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** A5：进行中任务（应用上下文才查；查不到/失败保持 null 不显示） */
  const [activeTask, setActiveTask] = useState<AdminAssistantTask | null>(null);
  /** 线 B · B2：最近一次会话详情顶层的工具调用（步骤流适配点数据源） */
  const [detailToolCalls, setDetailToolCalls] = useState<AdminAssistantToolCall[]>([]);
  /** 中止进行中（防重复点）与本回合取消不可用标记（失败静默降级） */
  const [cancelling, setCancelling] = useState(false);
  const [cancelUnavailable, setCancelUnavailable] = useState(false);
  /** 已耗时秒表（仅 sending 时跳动） */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<TextAreaRef | null>(null);
  /** 轮询代次：新发送或卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);
  /** 本回合起始时刻（已耗时基线；消息自带 createdAt 时优先用消息的） */
  const turnStartRef = useRef<number | null>(null);
  const knownCidRef = useRef<string | null>(null);
  const lastDraftNonceRef = useRef<number | null>(null);

  const chat = (body: { conversationId?: string; text: string; context?: unknown }) =>
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
  const cancelTurn = (cid: string) =>
    appId ? api.assistant.app.cancel(appId, cid) : api.assistant.cancel(cid);

  // 会话 id 变化回告父级（工作台左栏刷新/高亮）；仅在真正变化时通知
  useEffect(() => {
    if (conversationId && conversationId !== knownCidRef.current) {
      knownCidRef.current = conversationId;
      onConversationChange?.(conversationId);
    }
  }, [conversationId, onConversationChange]);

  // 挂载载入：指定会话（工作台点选）直接载入该会话；fresh 跳过；
  // 其余跑「恢复本上下文最近一段会话」（失败静默同旧口径）。
  useEffect(() => {
    let alive = true;
    (async () => {
      if (initialConversationId) {
        try {
          const detail = await fetchConversation(initialConversationId);
          if (alive) {
            setConversationId(detail.conversation?.id ?? initialConversationId);
            setMessages(detail.messages ?? []);
            setDetailToolCalls(detail.toolCalls ?? []);
          }
        } catch {
          // 指定会话读取失败不阻塞使用，界面保持空白可新发
        }
        return;
      }
      if (fresh) return;
      try {
        const list = await fetchList();
        const latest = list[0];
        if (!latest || !alive) return;
        const detail = await fetchConversation(latest.id);
        if (alive) {
          setConversationId(detail.conversation?.id ?? latest.id);
          setMessages(detail.messages ?? []);
          setDetailToolCalls(detail.toolCalls ?? []);
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
  }, [appId, fresh, initialConversationId]);

  // 卸载时停掉在途轮询（fresh 挂载没有恢复 effect 的 cleanup，单独兜底）
  useEffect(() => {
    return () => {
      pollGenRef.current += 1;
    };
  }, []);

  // A5 任务卡横条数据：应用上下文挂载时查一次进行中任务；
  // 平台上下文与工作台形态（hideTaskBar）不查；接口未就绪/失败静默。
  useEffect(() => {
    if (!appId || hideTaskBar) return;
    let alive = true;
    (async () => {
      try {
        const tasks = await api.assistant.app.tasks(appId);
        if (alive) setActiveTask(tasks[0] ?? null);
      } catch {
        // 静默：任务端点为线 B 并行新建，未就绪时不打扰对话
      }
    })();
    return () => {
      alive = false;
    };
  }, [appId, hideTaskBar]);

  // 外部草稿（工作台任务卡「继续」等）：nonce 变化时灌入输入框并聚焦
  useEffect(() => {
    if (!draftSignal) return;
    if (lastDraftNonceRef.current === draftSignal.nonce) return;
    lastDraftNonceRef.current = draftSignal.nonce;
    setInput(draftSignal.text);
    inputRef.current?.focus();
  }, [draftSignal]);

  // 已耗时秒表：回合进行中每秒跳动
  useEffect(() => {
    if (!sending) return;
    setNowMs(Date.now());
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sending]);

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
        setDetailToolCalls(detail.toolCalls ?? []);
        const freshMsgs = msgs.filter(
          (m) => m.role === "assistant" && !knownAssistantIds.has(m.id),
        );
        const done = freshMsgs.find((m) => m.status !== "generating");
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

  /** 发送一回合（发送按钮与「重试本步」共用）：受理后轮询取回回复 */
  const sendText = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || sending) return;
    setTurnError(null);
    setCancelUnavailable(false);
    turnStartRef.current = Date.now();
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
        // A4：页面上下文随回合透传（服务端 ops 回合收 pageContext）
        context: pageContext ?? undefined,
      });
      setConversationId(res.conversationId);
      pollUntilDone(res.conversationId, knownAssistantIds);
    } catch (err) {
      setSending(false);
      setTurnError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    await sendText(text);
  };

  /** 中止本回合：调取消端点；成功即停轮询并回读（消息转 failed 自呈），失败静默降级（端点未就绪时按钮在本回合内停用） */
  const handleCancel = async () => {
    if (!conversationId || cancelling) return;
    setCancelling(true);
    try {
      await cancelTurn(conversationId);
      pollGenRef.current += 1;
      setSending(false);
      try {
        const detail = await fetchConversation(conversationId);
        setMessages(detail.messages ?? []);
        setDetailToolCalls(detail.toolCalls ?? []);
      } catch {
        // 回读失败不追加报错，会话下次打开自会同步
      }
    } catch {
      // 静默降级：取消端点未就绪/失败时不打断轮询，本回合内停用按钮
      setCancelUnavailable(true);
    } finally {
      setCancelling(false);
    }
  };

  /** 重试本步：重发该 failed 消息之前的最近一条用户消息（承接续办，不整单重来） */
  const retryStep = (assistantMsgIndex: number) => {
    for (let i = assistantMsgIndex - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === "user" && m.text.trim()) {
        void sendText(m.text);
        return;
      }
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
        setDetailToolCalls(detail.toolCalls ?? []);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingId(null);
    }
  };

  const renderMessage = (msg: AdminAssistantMessage, index: number) => {
    if (msg.role === "system") {
      return (
        <div
          key={msg.id}
          style={{
            alignSelf: "center",
            color: tokens.colorTextTertiary,
            fontSize: 12,
            textAlign: "center",
            wordBreak: "break-word",
          }}
        >
          {renderRichText(msg.text)}
        </div>
      );
    }
    const isUser = msg.role === "user";
    const generating = !isUser && msg.status === "generating";
    const failed = !isUser && msg.status === "failed";
    const steps = generating ? turnStepsOf(msg, detailToolCalls) : [];
    const startedAtMs = msg.createdAt
      ? Date.parse(msg.createdAt)
      : turnStartRef.current;
    const elapsedMs =
      generating && startedAtMs && !Number.isNaN(startedAtMs)
        ? nowMs - startedAtMs
        : 0;
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
            wordBreak: "break-word",
          }}
        >
          {renderRichText(msg.text)}
          {generating && <Spin size="small" style={{ marginLeft: 8 }} />}
        </div>
        {generating && (
          <TurnProcess
            steps={steps}
            elapsedMs={elapsedMs}
            onCancel={conversationId ? () => void handleCancel() : undefined}
            cancelling={cancelling}
            cancelDisabled={cancelUnavailable}
          />
        )}
        {failed && !sending && (
          <div>
            <Button
              size="small"
              type="link"
              style={{ padding: 0, height: "auto", fontSize: 12 }}
              onClick={() => retryStep(index)}
            >
              重试本步
            </Button>
          </div>
        )}
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
        {!isUser &&
          msg.payload &&
          // 结果卡只在有可展示内容时渲染：路由 verdict 等纯标记
          // payload（无 kind/标题/动作）此前会误出一张空“已完成”卡
          (msg.payload.kind === "themeCreated" ||
            (msg.payload.actions ?? []).length > 0 ||
            !!msg.payload.title) && (
            <PayloadCard payload={msg.payload} onClose={onClose} />
          )}
        {!isUser && appId && msg.payload?.planCard && (
          <PlanMessageCard
            appId={appId}
            taskId={msg.payload.planCard.taskId}
          />
        )}
        {!isUser && appId && msg.payload?.delegationCard && (
          <DelegationMessageCard
            appId={appId}
            taskId={msg.payload.delegationCard.taskId}
            index={msg.payload.delegationCard.index}
            onOpenDelegation={onOpenDelegation}
          />
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

  const taskPassed = activeTask
    ? activeTask.checklist.filter((it) => PASSED_STATUS.has(it.status)).length
    : 0;
  const hasGenerating = messages.some(
    (m) => m.role === "assistant" && m.status === "generating",
  );

  return (
    <>
      {activeTask && !hideTaskBar && (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: `1px solid ${tokens.colorDivider}`,
            background: tokens.colorPrimaryBg,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <Typography.Text
            ellipsis
            style={{ fontSize: 12, flex: 1, minWidth: 0 }}
            title={activeTask.title}
          >
            进行中任务：{activeTask.title}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            清单 {taskPassed}/{activeTask.checklist.length} · 更新于{" "}
            {fmtTime(activeTask.updatedAt)}
          </Typography.Text>
          <Button
            size="small"
            type="link"
            style={{ padding: 0, height: "auto", fontSize: 12 }}
            onClick={() => inputRef.current?.focus()}
          >
            继续
          </Button>
        </div>
      )}
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
          messages.map((m, i) => renderMessage(m, i))
        )}
        {sending && !hasGenerating && (
          <div
            style={{
              alignSelf: "flex-start",
              color: tokens.colorTextTertiary,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Spin size="small" />
            正在处理…
            {turnStartRef.current && (
              <span>已耗时 {fmtElapsed(nowMs - turnStartRef.current)}</span>
            )}
            {conversationId && (
              <Button
                size="small"
                danger
                type="text"
                loading={cancelling}
                disabled={cancelUnavailable}
                style={{ height: "auto", padding: "0 4px", fontSize: 12 }}
                onClick={() => void handleCancel()}
              >
                中止
              </Button>
            )}
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
          ref={inputRef}
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
