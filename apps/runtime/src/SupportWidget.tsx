import { useEffect, useRef, useState } from "react";
import {
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
  SupportMessage,
  SupportSessionDetail,
} from "./api.js";
import { api } from "./api.js";

/**
 * 访客客服咨询窗（M12）：外壳级悬浮按钮 + 对话面板，交互模式对齐 AssistantPanel
 * （发送立即返回、助手消息经 1.2s 轮询会话详情取回、generating 占位）。
 * 与登录态助手的区别：匿名能力凭证 = sessionId + X-Visitor-Key（创建会话时一次性下发），
 * 访客身份与会话恢复信息存 localStorage `lcdp.support.visitor`，刷新/断线后恢复同一会话。
 * config.enabled=false（应用未发布客服智能体）时不渲染任何东西；
 * config.turnstileSiteKey 非空时渲染 Cloudflare Turnstile 官方 widget，建会话时取 token 传入。
 */

const VISITOR_STORE_KEY = "lcdp.support.visitor";

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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 轮询代次：新发送/新会话/卸载时自增，旧轮询自停 */
  const pollGenRef = useRef(0);

  const sessionId = store.sessionId;
  const visitorKey = store.visitorKey;
  const sessionStatus = detail?.session.status;
  const ticketId = detail?.session.ticketId ?? null;
  const title = config?.title || fallbackTitle || "在线咨询";

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
      const res = await api.support.createSession(appId, {
        turnstileToken: tsToken ?? undefined,
        visitorName: visitorName.trim() || undefined,
        contact: contact.trim() || undefined,
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
        setStartError(err instanceof Error ? err.message : String(err));
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
      setTurnError(err instanceof Error ? err.message : String(err));
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
      antdMessage.error(err instanceof Error ? err.message : String(err));
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
      antdMessage.error(err instanceof Error ? err.message : String(err));
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
      antdMessage.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRateBusy(false);
    }
  };

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
          bottom: 84,
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
            <Button size="small" onClick={startNewSession}>
              新会话
            </Button>
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
