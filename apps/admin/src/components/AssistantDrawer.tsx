import { useEffect, useRef, useState, type ReactNode } from "react";
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
import type { TextAreaRef } from "antd/es/input/TextArea";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantMessage,
  type AdminAssistantPayload,
  type AdminAssistantTask,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 管理台助手抽屉（第 83 步片四，第 90 步线 A 升级）：外壳顶栏全局入口，
 * 双上下文——有当前应用时是该应用的运营助手、无应用时是平台助手（仅
 * 平台管理员）；上下文随当前应用而定，切换应用即换新会话面，旧会话
 * 不串入新上下文。回合制异步与员工面同形：发送只受理，助手回复经
 * 1.2s 轮询会话详情取回（上限 180s）；写操作以待确认卡片挂在助手
 * 消息上，确认或取消后由服务端执行并回写结果消息。
 *
 * 第 90 步线 A 的四处语义（代码即文档，手工走查按此核对）：
 * - 会话语义（A1）：ChatPane 以 fresh 标记区分两种挂载——抽屉打开的
 *   首次挂载（seed=0）才跑「恢复本上下文最近一段会话」；点「新对话」
 *   自增 seed 重挂载时 fresh=true，跳过恢复、conversationId 保持
 *   null，发送时由服务端新建会话。即「打开=接着聊、新对话=真空白」。
 * - 富渲染（A2）：消息 text 经自写小解析器渲染（linkify + 轻量
 *   markdown 子集），全程走 React 文本节点、天然转义，不拼 HTML。
 * - 结果卡（A3）：助手消息可带 payload 结构化结果，按 kind 渲染卡片。
 * - 上下文带入（A4）：外壳按当前页组装 context 透传给发送回合，对话
 *   顶部一行小字明示；应用上下文另有进行中任务卡横条（A5）。
 */

/** 外壳组装的页面上下文（A4）：字段能拿到才带，拿不到不硬造 */
export interface AssistantPageContext {
  path: string;
  pageName?: string;
  appId?: string | null;
  segment: string;
  entityKey?: string;
}

export default function AssistantDrawer({
  open,
  onClose,
  appId,
  appName,
  context,
}: {
  open: boolean;
  onClose: () => void;
  appId: string | null;
  appName: string | null;
  context?: AssistantPageContext;
}) {
  /** 新对话代次：自增即让对话面重挂载、开一段新会话（fresh 语义见文件头） */
  const [seed, setSeed] = useState(0);
  const title = appId ? `运营助手 · ${appName ?? appId}` : "平台助手";
  // 关闭即复位代次：抽屉组件在 AppShell 里常驻，seed 若跨开关保留，
  // 点过一次「新对话」后每次打开都会 fresh 跳过恢复（第 90 步验收实证）。
  // 语义锚点：打开 = 恢复最近会话；只有刚点过「新对话」的当次挂载才空白。
  const handleClose = () => {
    setSeed(0);
    onClose();
  };
  return (
    <Drawer
      title={title}
      width={"min(480px, 100vw)"}
      open={open}
      onClose={handleClose}
      extra={
        <Button size="small" onClick={() => setSeed((s) => s + 1)}>
          新对话
        </Button>
      }
      styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}
    >
      {open && (
        <ChatPane
          key={`${appId ?? "platform"}:${seed}`}
          appId={appId}
          fresh={seed > 0}
          pageContext={context}
          onClose={handleClose}
        />
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* A2 富渲染最小集：linkify + 轻量 markdown（加粗 / 行内代码 / 无序列表 / 分段）
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
/* A3 payload 结果卡                                                    */
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

function ChatPane({
  appId,
  fresh,
  pageContext,
  onClose,
}: {
  appId: string | null;
  /** A1：true = 经「新对话」重挂载，跳过恢复、从空白开始 */
  fresh: boolean;
  pageContext?: AssistantPageContext;
  onClose?: () => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** A5：进行中任务（应用上下文才查；查不到/失败保持 null 不显示） */
  const [activeTask, setActiveTask] = useState<AdminAssistantTask | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<TextAreaRef | null>(null);
  /** 轮询代次：新发送或卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);

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

  // A1 恢复：仅抽屉打开的首次挂载（fresh=false）。「新对话」重挂载
  // fresh=true 时整体跳过——不拉列表、不设 conversationId，保持空白，
  // 发送时服务端按 conversationId 缺失新建会话（失败静默同旧口径）。
  useEffect(() => {
    if (fresh) return;
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
  }, [appId, fresh]);

  // 卸载时停掉在途轮询（fresh 挂载没有恢复 effect 的 cleanup，单独兜底）
  useEffect(() => {
    return () => {
      pollGenRef.current += 1;
    };
  }, []);

  // A5 任务卡横条数据：应用上下文挂载时查一次进行中任务；
  // 平台上下文不查；接口未就绪/失败一律静默（横条不显示即可）。
  useEffect(() => {
    if (!appId) return;
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
        {!isUser && msg.payload && (
          <PayloadCard payload={msg.payload} onClose={onClose} />
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

  /** A4 上下文明示行：应用上下文写应用与页面，平台上下文写「平台」 */
  const contextLine = appId
    ? `上下文：本应用${pageContext?.pageName ? ` · ${pageContext.pageName}` : ""}${
        pageContext?.entityKey ? ` · 实体 ${pageContext.entityKey}` : ""
      }`
    : "上下文：平台";
  const taskPassed = activeTask
    ? activeTask.checklist.filter((it) => PASSED_STATUS.has(it.status)).length
    : 0;

  return (
    <>
      <div
        style={{
          padding: "8px 16px",
          borderBottom: `1px solid ${tokens.colorDivider}`,
          color: tokens.colorTextTertiary,
          fontSize: 12,
        }}
      >
        {contextLine}
      </div>
      {activeTask && (
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
