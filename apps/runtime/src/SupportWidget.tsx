import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Rate,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from "antd";
import type {
  SupportConfig,
  SupportMemberMemory,
  SupportMessage,
  SupportSessionDetail,
} from "./api.js";
import { api, loadMemberSession } from "./api.js";

/**
 * 访客客服咨询窗（M12）：外壳级悬浮按钮 + 对话面板，交互模式对齐 AssistantPanel
 * （发送立即返回、助手消息经 1.2s 轮询会话详情取回、generating 占位）。
 * 与登录态助手的区别：匿名能力凭证 = sessionId + X-Visitor-Key（创建会话时一次性下发），
 * 访客身份与会话恢复信息存 localStorage `lcdp.support.visitor`，刷新/断线后恢复同一会话。
 * 第 94 步会员面记忆：建会话时若本机有该应用的会员会话，令牌只在建会话请求里
 * 带一次（绝不落任何本地存储），服务端绑定成功后会话详情带 memberBound，咨询窗
 * 才在头部显示「记忆」入口并在 Drawer 内切换出记忆视图（待确认确认/忽略、已记住删除）；
 * memberBound 为假/缺省时不渲染记忆 UI、不调记忆端点，界面与此前逐字一致。
 * config.enabled=false（应用未发布客服智能体）时不渲染任何东西；
 * config.turnstileSiteKey 非空时渲染 Cloudflare Turnstile 官方 widget，建会话时取 token 传入。
 */

const VISITOR_STORE_KEY = "lcdp.support.visitor";

/** 会员记忆四分类的中文标签（与员工面 L4 同分类口径） */
const MEMORY_CATEGORY_TEXT: Record<string, string> = {
  preference: "偏好",
  decision: "决定",
  longterm: "长期",
  fact: "事实",
};

interface VisitorStore {
  visitorId: string;
  sessionId?: string;
  visitorKey?: string;
}

function newVisitorId(): string {
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function loadVisitorStore(): VisitorStore {
  try {
    const raw = localStorage.getItem(VISITOR_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as VisitorStore;
      if (typeof parsed.visitorId === "string" && parsed.visitorId) {
        return parsed;
      }
    }
  } catch {
    // 存储损坏时重新生成访客身份
  }
  const fresh: VisitorStore = { visitorId: newVisitorId() };
  saveVisitorStore(fresh);
  return fresh;
}

function saveVisitorStore(store: VisitorStore): void {
  try {
    localStorage.setItem(VISITOR_STORE_KEY, JSON.stringify(store));
  } catch {
    // localStorage 不可用时仅本次会话内有效
  }
}

/* ---------- Turnstile（官方脚本 explicit 渲染，脚本单例加载） ---------- */

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("人机验证脚本加载失败"));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

function TurnstileBox({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadTurnstileScript()
      .then(() => {
        if (!alive || !boxRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(boxRef.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      alive = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // widget 已随 DOM 卸载时忽略
        }
        widgetIdRef.current = null;
      }
    };
    // onToken 为宿主 setState 包装，身份稳定即可；仅随 siteKey 重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  return <div ref={boxRef} />;
}

/* ---------- 咨询窗本体 ---------- */

export default function SupportWidget({
  appId,
  fallbackTitle,
}: {
  appId: string;
  /** 外壳 globalVars.support.title（config.title 缺省时兜底） */
  fallbackTitle?: string;
}) {
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [store, setStore] = useState<VisitorStore>(() => loadVisitorStore());
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SupportSessionDetail | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  /** 开始咨询表单（姓名/联系方式可选，Turnstile token 在启用时必填） */
  const [visitorName, setVisitorName] = useState("");
  const [contact, setContact] = useState("");
  const [tsToken, setTsToken] = useState<string | null>(null);
  /** Turnstile 重置计数：建会话被拒时自增以重挂 widget 取新 token */
  const [tsNonce, setTsNonce] = useState(0);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  /** 评分本地态：已提交的分数（服务端已存的以 detail.session.rating 为准） */
  const [rateValue, setRateValue] = useState(5);
  const [ratedScore, setRatedScore] = useState<number | null>(null);
  const [rateBusy, setRateBusy] = useState(false);
  /** 会员记忆（第 94 步）：仅 memberBound 会话才有数据；视图在 Drawer 内与聊天切换 */
  const [view, setView] = useState<"chat" | "memory">("chat");
  const [memories, setMemories] = useState<SupportMemberMemory[]>([]);
  const [memLoading, setMemLoading] = useState(false);
  const [memError, setMemError] = useState<string | null>(null);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 轮询代次：新发送/新会话/卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);

  const sessionId = store.sessionId;
  const visitorKey = store.visitorKey;
  const sessionStatus = detail?.session.status;
  const ticketId = detail?.session.ticketId ?? null;
  const title = config?.title || fallbackTitle || "在线咨询";
  /** 会员绑定以会话详情为唯一事实源；未绑时记忆状态恒为空、不渲染入口 */
  const memberBound = detail?.session.memberBound === true;
  const pendingMemories = memories.filter((m) => m.status === "pending");
  const activeMemories = memories.filter((m) => m.status !== "pending");

  // 挂载时拉咨询窗配置：enabled=false 不渲染（失败同样不渲染，不打扰访客）
  useEffect(() => {
    let alive = true;
    api
      .support
      .config(appId)
      .then((cfg) => {
        if (alive) setConfig(cfg);
      })
      .catch(() => {
        if (alive) setConfig({ enabled: false, turnstileSiteKey: null });
      });
    return () => {
      alive = false;
      pollGenRef.current += 1;
    };
  }, [appId]);

  const refreshDetail = async (
    sid: string,
    key: string,
  ): Promise<SupportSessionDetail | null> => {
    try {
      const d = await api.support.session(appId, sid, key);
      setDetail(d);
      setMessages(d.messages);
      if (d.session.rating) setRatedScore(d.session.rating);
      return d;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403 || status === 404) {
        // 会话或凭证已失效：清掉本地会话，回到开始咨询态重新建
        setStore((prev) => {
          const next: VisitorStore = { visitorId: prev.visitorId };
          saveVisitorStore(next);
          return next;
        });
        setDetail(null);
        setMessages([]);
        setRatedScore(null);
        setView("chat");
        setMemories([]);
        setMemError(null);
      }
      return null;
    }
  };

  // 打开面板且已有会话时恢复详情（含未完成的生成回合则继续轮询）
  useEffect(() => {
    if (!open || !sessionId || !visitorKey) return;
    let alive = true;
    void (async () => {
      const d = await refreshDetail(sessionId, visitorKey);
      if (alive && d?.messages.some((m) => m.status === "generating")) {
        pollUntilDone(sessionId, visitorKey);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, visitorKey]);

  // 新消息后滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, sending]);

  const pollUntilDone = (sid: string, key: string) => {
    const gen = ++pollGenRef.current;
    const deadline = Date.now() + 180_000;
    const tick = async () => {
      if (pollGenRef.current !== gen) return;
      try {
        const d = await api.support.session(appId, sid, key);
        if (pollGenRef.current !== gen) return;
        setDetail(d);
        setMessages(d.messages);
        if (d.session.rating) setRatedScore(d.session.rating);
        const generating = d.messages.some(
          (m) => m.role === "assistant" && m.status === "generating",
        );
        const failed = d.messages.find(
          (m) => m.role === "assistant" && m.status === "failed",
        );
        if (!generating) {
          setSending(false);
          if (failed) setTurnError(failed.text || "客服助手生成失败，请重试");
          return;
        }
      } catch {
        // 轮询瞬时失败不中断，继续到截止时间
      }
      if (Date.now() >= deadline) {
        setSending(false);
        setTurnError("客服助手响应超时（180 秒），可稍后重新打开面板查看结果");
        return;
      }
      window.setTimeout(() => void tick(), 1200);
    };
    void tick();
  };

  const startSession = async () => {
    if (!config || startBusy) return;
    if (config.turnstileSiteKey && !tsToken) {
      setStartError("请先完成人机验证");
      return;
    }
    setStartBusy(true);
    setStartError(null);
    try {
      // 本机已登录会员时把会员令牌带入建会话请求（只用这一次，不落任何存储）；
      // 服务端校验不过会静默降级为匿名会话，不挡咨询。
      const memberSession = loadMemberSession(window.location.host, appId);
      const res = await api.support.createSession(appId, {
        turnstileToken: tsToken ?? undefined,
        visitorName: visitorName.trim() || undefined,
        contact: contact.trim() || undefined,
        memberToken: memberSession?.token || undefined,
      });
      const next: VisitorStore = {
        visitorId: store.visitorId,
        sessionId: res.sessionId,
        visitorKey: res.visitorKey,
      };
      saveVisitorStore(next);
      setStore(next);
      setDetail(null);
      setMessages([]);
      setRatedScore(null);
      setView("chat");
      setMemories([]);
      setMemError(null);
      await refreshDetail(res.sessionId, res.visitorKey);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 403) {
        // 人机验证未通过：重挂 widget 取新 token 后重试
        setTsToken(null);
        setTsNonce((n) => n + 1);
        setStartError("人机验证未通过，请重新完成验证后再试");
      } else if (status === 429) {
        setStartError("操作过于频繁，请稍后再试");
      } else {
        setStartError("客服接入失败，请稍后重试");
      }
    } finally {
      setStartBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending || !sessionId || !visitorKey) return;
    setInput("");
    setTurnError(null);
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "visitor", text },
    ]);
    setSending(true);
    try {
      await api.support.postMessage(appId, sessionId, visitorKey, text);
      pollUntilDone(sessionId, visitorKey);
    } catch (err) {
      setSending(false);
      setTurnError("消息发送失败，请重试");
    }
  };

  const doHandoff = async () => {
    if (!sessionId || !visitorKey || handoffBusy) return;
    setHandoffBusy(true);
    try {
      const res = await api.support.handoff(appId, sessionId, visitorKey);
      await refreshDetail(sessionId, visitorKey);
      antdMessage.success(
        res.ticketId
          ? `已转接人工服务，工单号 ${res.ticketId}`
          : "已转接人工服务",
      );
    } catch (err) {
      antdMessage.error("转接人工失败，请稍后重试");
    } finally {
      setHandoffBusy(false);
    }
  };

  const handleProposal = async (
    msg: SupportMessage,
    decision: "confirm" | "cancel",
  ) => {
    if (
      !sessionId ||
      !visitorKey ||
      !msg.pendingAction ||
      msg.pendingAction.handled ||
      confirmingId
    )
      return;
    setConfirmingId(msg.id);
    try {
      await api.support.confirmAction(
        appId,
        sessionId,
        visitorKey,
        msg.id,
        decision,
      );
      await refreshDetail(sessionId, visitorKey);
    } catch (err) {
      antdMessage.error("操作失败，请稍后重试");
    } finally {
      setConfirmingId(null);
    }
  };

  const submitRating = async () => {
    if (!sessionId || !visitorKey || rateBusy) return;
    setRateBusy(true);
    try {
      await api.support.rate(appId, sessionId, visitorKey, rateValue);
      setRatedScore(rateValue);
      antdMessage.success("感谢您的评价");
    } catch (err) {
      antdMessage.error("评价提交失败，请稍后重试");
    } finally {
      setRateBusy(false);
    }
  };

  /* ---------- 会员记忆（第 94 步）：仅 memberBound 会话调用，归属由服务端按会话行取 ---------- */

  const loadMemories = async (sid: string, key: string) => {
    setMemLoading(true);
    try {
      const res = await api.support.memories(appId, sid, key);
      setMemories(res.memories);
      setMemError(null);
    } catch {
      setMemError("记忆加载失败，请稍后重试");
    } finally {
      setMemLoading(false);
    }
  };

  const openMemoryView = () => {
    setView("memory");
    if (sessionId && visitorKey) void loadMemories(sessionId, visitorKey);
  };

  const actOnMemory = async (
    m: SupportMemberMemory,
    action: "confirm" | "ignore" | "delete",
  ) => {
    if (!sessionId || !visitorKey || memoryBusyId) return;
    setMemoryBusyId(m.id);
    try {
      if (action === "confirm") {
        await api.support.confirmMemory(appId, sessionId, visitorKey, m.id);
        antdMessage.success("已确认记住");
      } else if (action === "ignore") {
        await api.support.ignoreMemory(appId, sessionId, visitorKey, m.id);
        antdMessage.success("已忽略这条待确认记忆");
      } else {
        await api.support.deleteMemory(appId, sessionId, visitorKey, m.id);
        antdMessage.success("已删除这条记忆");
      }
      await loadMemories(sessionId, visitorKey);
    } catch {
      antdMessage.error("操作失败，请稍后重试");
    } finally {
      setMemoryBusyId(null);
    }
  };

  // 待确认条数角标刷新：绑定态确立、或新消息到达后拉一次列表（不做实时推送）；
  // memberBound 为假时绝不调用记忆端点。
  useEffect(() => {
    if (memberBound && sessionId && visitorKey) {
      void loadMemories(sessionId, visitorKey);
    }
    // loadMemories 仅依赖入参，身份稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberBound, messages.length, sessionId, visitorKey]);

  const startNewSession = () => {
    pollGenRef.current += 1;
    const next: VisitorStore = { visitorId: store.visitorId };
    saveVisitorStore(next);
    setStore(next);
    setDetail(null);
    setMessages([]);
    setTurnError(null);
    setSending(false);
    setRatedScore(null);
    setView("chat");
    setMemories([]);
    setMemError(null);
    setTsToken(null);
    setTsNonce((n) => n + 1);
    setStartError(null);
  };

  if (!config || !config.enabled) return null;

  const inSession = Boolean(sessionId && visitorKey);
  const handoffDone = sessionStatus === "handoff" || sessionStatus === "closed";
  const showRating =
    inSession &&
    handoffDone &&
    !ratedScore &&
    !detail?.session.rating;

  const renderMemoryRow = (m: SupportMemberMemory, pending: boolean) => (
    <Card key={m.id} size="small">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Typography.Text style={{ fontSize: 14 }}>{m.content}</Typography.Text>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Tag style={{ marginInlineEnd: 0 }}>
            {MEMORY_CATEGORY_TEXT[m.category ?? ""] ?? "其他"}
          </Tag>
          {pending ? <Tag color="orange">待确认</Tag> : null}
          {m.createdAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {m.createdAt.slice(0, 10)}
            </Typography.Text>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {pending ? (
            <>
              <Button
                type="primary"
                size="small"
                loading={memoryBusyId === m.id}
                onClick={() => void actOnMemory(m, "confirm")}
              >
                确认记住
              </Button>
              <Button
                size="small"
                disabled={memoryBusyId === m.id}
                onClick={() => void actOnMemory(m, "ignore")}
              >
                忽略
              </Button>
            </>
          ) : (
            <Button
              danger
              size="small"
              loading={memoryBusyId === m.id}
              onClick={() => void actOnMemory(m, "delete")}
            >
              删除
            </Button>
          )}
        </div>
      </div>
    </Card>
  );

  const renderMessage = (msg: SupportMessage) => {
    const isVisitor = msg.role === "visitor" || msg.role === "user";
    if (msg.role === "system") {
      return (
        <div
          key={msg.id}
          style={{
            alignSelf: "center",
            color: "#8c8c8c",
            fontSize: 12,
            textAlign: "center",
            maxWidth: "92%",
          }}
        >
          {msg.text}
        </div>
      );
    }
    const generating = !isVisitor && msg.status === "generating";
    const proposal =
      !isVisitor && msg.pendingAction?.kind === "humanHandoff"
        ? msg.pendingAction
        : null;
    return (
      <div
        key={msg.id}
        style={{
          alignSelf: isVisitor ? "flex-end" : "flex-start",
          maxWidth: "88%",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div
          style={{
            background: isVisitor ? "#1677ff" : "#f5f5f5",
            color: isVisitor ? "#fff" : "inherit",
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
        {!isVisitor && msg.citations && msg.citations.length > 0 && (
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
        {proposal && (
          <Card
            size="small"
            title="建议转人工处理"
            style={{ borderColor: "#ffe58f", background: "#fffbe6" }}
          >
            {proposal.summary ? (
              <Typography.Text style={{ fontSize: 13 }}>
                {proposal.summary}
              </Typography.Text>
            ) : null}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              {proposal.handled ? (
                <Tag color="default">已处理</Tag>
              ) : (
                <>
                  <Button
                    type="primary"
                    size="small"
                    loading={confirmingId === msg.id}
                    onClick={() => void handleProposal(msg, "confirm")}
                  >
                    确认转人工
                  </Button>
                  <Button
                    size="small"
                    disabled={confirmingId === msg.id}
                    onClick={() => void handleProposal(msg, "cancel")}
                  >
                    继续自助咨询
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
          bottom: "calc(84px + var(--lcdp-nav-offset, 0px))",
          zIndex: 999,
          boxShadow: "0 6px 16px rgba(0,0,0,0.24)",
          background: "#52c41a",
          borderColor: "#52c41a",
        }}
      >
        💬 {title}
      </Button>
      <Drawer
        title={`💬 ${title}`}
        width={"min(440px, 100vw)"}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          inSession ? (
            memberBound ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge
                  count={pendingMemories.length}
                  size="small"
                  offset={[-2, 2]}
                >
                  <Button size="small" onClick={openMemoryView}>
                    记忆
                  </Button>
                </Badge>
                <Button size="small" onClick={startNewSession}>
                  新会话
                </Button>
              </div>
            ) : (
              <Button size="small" onClick={startNewSession}>
                新会话
              </Button>
            )
          ) : undefined
        }
        styles={{
          body: { display: "flex", flexDirection: "column", padding: 0 },
        }}
      >
        {!inSession ? (
          <div
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              您好，这里是{title}
              。送货预约、售后政策、质量问题都可以先问智能客服；需要人工跟进时可一键转人工建工单。
            </Typography.Paragraph>
            <Input
              placeholder="您的姓名（可选）"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              maxLength={50}
            />
            <Input
              placeholder="联系方式（可选，便于人工回访）"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={100}
            />
            {config.turnstileSiteKey ? (
              <TurnstileBox
                key={tsNonce}
                siteKey={config.turnstileSiteKey}
                onToken={setTsToken}
              />
            ) : null}
            {startError && (
              <Typography.Text type="danger" style={{ fontSize: 13 }}>
                {startError}
              </Typography.Text>
            )}
            <Button
              type="primary"
              loading={startBusy}
              disabled={Boolean(config.turnstileSiteKey) && !tsToken}
              onClick={() => void startSession()}
            >
              开始咨询
            </Button>
          </div>
        ) : view === "memory" ? (
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Button size="small" onClick={() => setView("chat")}>
                ← 返回聊天
              </Button>
              <Typography.Text strong style={{ fontSize: 15 }}>
                我的记忆
              </Typography.Text>
            </div>
            <Typography.Paragraph
              type="secondary"
              style={{ marginBottom: 0, fontSize: 13 }}
            >
              这里是客服记住的、关于您的长期信息，后续咨询时会作为参考。待确认的条目经您确认后才生效；已记住的条目可随时删除。
            </Typography.Paragraph>
            {memError ? (
              <Typography.Text type="danger" style={{ fontSize: 13 }}>
                {memError}
              </Typography.Text>
            ) : null}
            {memLoading && memories.length === 0 ? (
              <div style={{ textAlign: "center", marginTop: 48 }}>
                <Spin />
              </div>
            ) : memories.length === 0 ? (
              memError ? null : (
                <Empty
                  description="还没有记住任何内容。在对话里说「请记住……」，客服就会把您的偏好记下来。"
                  style={{ marginTop: 32 }}
                />
              )
            ) : (
              <>
                {pendingMemories.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <Typography.Text strong>
                      待确认（{pendingMemories.length}）
                    </Typography.Text>
                    {pendingMemories.map((m) => renderMemoryRow(m, true))}
                  </div>
                ) : null}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <Typography.Text strong>
                    已记住（{activeMemories.length}）
                  </Typography.Text>
                  {activeMemories.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      暂无已生效的记忆。
                    </Typography.Text>
                  ) : (
                    activeMemories.map((m) => renderMemoryRow(m, false))
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
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
                  description="您好，请问有什么可以帮您？"
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
                      color: "#8c8c8c",
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
              {showRating && (
                <Card size="small" title="请为本次服务评分">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <Rate
                      value={rateValue}
                      onChange={(v) => setRateValue(v || 5)}
                    />
                    <Button
                      type="primary"
                      size="small"
                      loading={rateBusy}
                      onClick={() => void submitRating()}
                    >
                      提交评分
                    </Button>
                  </div>
                </Card>
              )}
              {handoffDone && ratedScore ? (
                <Typography.Text
                  type="secondary"
                  style={{ alignSelf: "center", fontSize: 13 }}
                >
                  感谢您的评价（{ratedScore} 星）🌟
                </Typography.Text>
              ) : null}
            </div>
            <div
              style={{
                borderTop: "1px solid #f0f0f0",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div>
                {handoffDone ? (
                  <Tag color="green" style={{ fontSize: 13 }}>
                    已转人工{ticketId ? ` · 工单号 ${ticketId}` : ""}
                    ，坐席将尽快跟进
                  </Tag>
                ) : (
                  <Button
                    size="small"
                    loading={handoffBusy}
                    onClick={() => void doHandoff()}
                  >
                    转人工
                  </Button>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-end",
                }}
              >
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  disabled={handoffDone}
                  placeholder={
                    handoffDone
                      ? "已转人工，如需新的咨询请点右上角「新会话」"
                      : "输入您的问题，Enter 发送（Shift+Enter 换行）"
                  }
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
                  disabled={!input.trim() || handoffDone}
                  onClick={() => void send()}
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}

/**
 * 匿名面挂载探测：逐个候选应用查 support/config，首个 enabled 的渲染咨询窗。
 * 匿名公开外壳拿不到各装配应用的 appConfig（只有入口主应用），故走公开可读的
 * config 端点探测；登录态外壳则由 AppView 按 globalVars.support 命中后直接挂
 * SupportWidget，两条路径在组件内统一收敛到 config 门控。
 */
export function SupportAutoMount({ appIds }: { appIds: string[] }) {
  const [appId, setAppId] = useState<string | null>(null);
  const key = appIds.join(",");

  useEffect(() => {
    let alive = true;
    setAppId(null);
    void (async () => {
      for (const id of appIds) {
        try {
          const cfg = await api.support.config(id);
          if (cfg.enabled) {
            if (alive) setAppId(id);
            return;
          }
        } catch {
          // 该应用无客服能力或配置端点不可用，看下一个
        }
      }
    })();
    return () => {
      alive = false;
    };
    // appIds 以 key 标识（顺序敏感）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!appId) return null;
  return <SupportWidget appId={appId} />;
}
