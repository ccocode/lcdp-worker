import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from "antd";
import { tokens, MarkdownView, consumeConversationStream, ActionConfirmCard } from "@lcdp/ui";
import type {
  AssistantContext,
  AssistantFillForm,
  AssistantMessage,
} from "./api.js";
import { api, API_BASE, getToken } from "./api.js";

/**
 * 运行态助手面板（M7）：外壳级悬浮按钮 + 对话抽屉，任意页面可打开。
 * 回合制异步：发送立即返回，助手消息经 1.2s 轮询会话详情取回（≤180s）；
 * 助手消息可带制度引用（来源 chips）与待确认写动作（确认卡片）——
 * 写操作一律经用户确认后由服务端确定性执行；fillForm 类动作不落库，
 * 由前端写 sessionStorage 后跳派生表单回填（表单内由用户最终提交）。
 */

interface ContextPill {
  label: string;
  prompt: string;
}

function getContextPills(appId: string, context: AssistantContext): ContextPill[] {
  const key = (context.entityKey || "").toLowerCase();
  const path = (context.path || "").toLowerCase();

  // 1. 物资管理 (procurement-inventory)
  if (appId === "procurement-inventory" || path.includes("procurement") || path.includes("inventory")) {
    if (key.includes("purchase") || path.includes("purchase")) {
      return [
        { label: "📑 待我审批采购单", prompt: "查询当前待我审批的采购单有哪些？" },
        { label: "📦 查看低库存预警", prompt: "检查仓库中有哪些物料低于安全库存？" },
        { label: "💰 统计本月采购额", prompt: "统计本月已生效的采购总金额及明细" },
      ];
    }
    return [
      { label: "📦 安全库存预警", prompt: "检查哪些物料库存低于安全库存并需要补货？" },
      { label: "📑 查待审批单据", prompt: "查询当前待审批的采购与领用单据" },
      { label: "📝 申请物料领用", prompt: "我想申请领用办公耗材，请协助我登记领用单" },
      { label: "🔍 查在库物料明细", prompt: "列出当前一号仓库中主要办公设备的在库数量" },
    ];
  }

  // 2. 星桥商城 (mall)
  if (appId === "mall" || path.includes("mall") || path.includes("shop")) {
    return [
      { label: "🚚 查待发货订单", prompt: "查询最近的待发货订单列表与物流单号" },
      { label: "📉 查缺货商品", prompt: "有哪些在售商品当前库存为零或不足？" },
      { label: "💰 统计商城销售额", prompt: "统计本月星桥商城的支付订单销售总额" },
      { label: "🔍 查商品价格与上架状态", prompt: "查询在售数码终端的价格与保修政策" },
    ];
  }

  // 3. 协同办公 (oa)
  if (appId === "oa" || path.includes("oa")) {
    return [
      { label: "📑 待我审批事项", prompt: "查询当前需要我审批的办公申请" },
      { label: "💰 发起差旅报销", prompt: "我想申请一笔差旅费用报销" },
      { label: "🏖️ 申请年假调休", prompt: "我想提交年假申请，请说明具体流程与必填项" },
      { label: "📢 查最新公文公告", prompt: "查询公司最近发布的制度与公文公告" },
    ];
  }

  // 4. 供应商服务中心 (support)
  if (appId === "support" || path.includes("support")) {
    return [
      { label: "⚠️ 查待处理售后工单", prompt: "查询当前有哪些未结案的售后工单与客诉？" },
      { label: "📅 查今日交货预约", prompt: "查询今天是否有供应商交货预约？" },
      { label: "📋 登记新售后工单", prompt: "收到客户关于设备故障的反馈，帮我登记一条售后维修工单" },
    ];
  }

  // 5. 官网 / 内容样例站 (www / contentpilot / forum)
  if (appId === "www" || appId === "contentpilot" || appId === "forum") {
    return [
      { label: "📰 查待审文章列表", prompt: "查询当前有哪些草稿或待审核的新闻文章？" },
      { label: "🔍 检查静态站点状态", prompt: "检查官网静态页面的最新生成与发布状态" },
      { label: "💬 查论坛最新帖子", prompt: "查询星桥论坛最近的互动帖子与回复" },
    ];
  }

  // 通用兜底
  return [
    { label: "🔍 查当前数据概览", prompt: "请帮我概括一下当前页面的主要业务数据" },
    { label: "❓ 了解相关规章制度", prompt: "这块业务对应公司哪些管理规定和审批权限？" },
    { label: "📝 快速新建记录", prompt: "我想录入一条新数据，请协助我填写表单" },
  ];
}

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
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem("lcdp_assistant_pinned") === "true";
    } catch {
      return false;
    }
  });
  const [isWide, setIsWide] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 992,
  );
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

  // 视口宽度监听（宽屏支持分屏 Pin 模式）
  useEffect(() => {
    const handleResize = () => {
      setIsWide(window.innerWidth >= 992);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 分屏 Pin 模式下驱动外壳主体右外边距，避免内容被遮挡
  useEffect(() => {
    if (open && pinned && isWide) {
      document.documentElement.style.setProperty("--lcdp-pinned-panel-width", "380px");
    } else {
      document.documentElement.style.setProperty("--lcdp-pinned-panel-width", "0px");
    }
    return () => {
      document.documentElement.style.setProperty("--lcdp-pinned-panel-width", "0px");
    };
  }, [open, pinned, isWide]);

  // AgentChat 组件（renderer）派发的打开事件
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("lcdp:open-assistant", onOpen);
    return () => window.removeEventListener("lcdp:open-assistant", onOpen);
  }, []);

  // 单号深链点击提示与反查通知
  useEffect(() => {
    const onLocate = (e: Event) => {
      const detail = (e as CustomEvent<{ recordId?: string }>).detail;
      if (detail?.recordId) {
        antdMessage.success(`已复制单号并通知页面：${detail.recordId}`);
      }
    };
    window.addEventListener("lcdp:locate-record", onLocate);
    return () => window.removeEventListener("lcdp:locate-record", onLocate);
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


  const streamUntilDone = (cid: string, knownAssistantIds: Set<string>) => {
    const gen = ++pollGenRef.current;
    const abortCtrl = new AbortController();
    const token = getToken();
    const streamUrl = `${API_BASE}/apps/${appId}/assistant/conversations/${cid}/stream`;

    consumeConversationStream({
      url: streamUrl,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: abortCtrl.signal,
      onInit: (data) => {
        if (pollGenRef.current !== gen) return;
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages);
        }
      },
      onDelta: ({ messageId, text }) => {
        if (pollGenRef.current !== gen) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text } : m)),
        );
      },
      onDone: (data) => {
        if (pollGenRef.current !== gen) return;
        setSending(false);
        if (data.message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === data.message.id ? data.message : m)),
          );
          if (data.message.status === "failed") {
            setTurnError(data.message.text || "助手生成失败，请重试");
          }
        } else if (data.messages) {
          setMessages(data.messages);
        }
      },
      onError: () => {
        if (pollGenRef.current === gen) {
          pollUntilDone(cid, knownAssistantIds);
        }
      },
    }).then((ok) => {
      if (!ok && pollGenRef.current === gen) {
        pollUntilDone(cid, knownAssistantIds);
      }
    });
  };

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

  const send = async (explicitText?: string) => {
    const text = typeof explicitText === "string" ? explicitText.trim() : input.trim();
    if (!text || sending) return;
    if (!explicitText) setInput("");
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
      streamUntilDone(res.conversationId, knownAssistantIds);
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
            streamUntilDone(res.conversationId, known);
          } else {
            setSending(false);
          }
          return;
        }
        streamUntilDone(res.conversationId, knownAssistantIds);
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
    patchArgs?: Record<string, unknown>,
  ) => {
    if (!msg.pendingAction || msg.pendingAction.handled || confirmingId) return;
    setConfirmingId(msg.id);
    try {
      const res = await api.assistant.confirmAction(appId, msg.id, decision, patchArgs);
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
          {isUser ? (
            <span>{msg.text}</span>
          ) : (
            <MarkdownView content={msg.text} />
          )}
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
          <ActionConfirmCard
            action={msg.pendingAction}
            loading={confirmingId === msg.id}
            onConfirm={(patchArgs) => void handleAction(msg, "confirm", patchArgs)}
            onCancel={() => void handleAction(msg, "cancel")}
          />
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

  const pills = getContextPills(appId, context);

  const renderPanelBody = () => (
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
          flexDirection: "column",
          gap: 8,
          background: "#fafafa",
        }}
      >
        {pills.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              maxHeight: 64,
              overflowY: "auto",
            }}
          >
            {pills.map((p, idx) => (
              <Tag
                key={idx}
                onClick={() => void send(p.prompt)}
                style={{
                  cursor: "pointer",
                  margin: 0,
                  borderRadius: 12,
                  padding: "2px 8px",
                  fontSize: 12,
                  background: "#fff",
                  borderColor: "#d6e4ff",
                  color: "#1d39c4",
                  userSelect: "none",
                  transition: "all 0.2s",
                }}
              >
                {p.label}
              </Tag>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
      </div>
    </>
  );

  return (
    <>
      {(!open || (!pinned || !isWide)) && (
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
      )}

      {open && pinned && isWide ? (
        <aside
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            width: 380,
            height: "100vh",
            zIndex: 1000,
            background: "#fff",
            borderLeft: "1px solid #e8e8e8",
            display: "flex",
            flexDirection: "column",
            boxShadow: "-2px 0 8px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              height: 56,
              borderBottom: "1px solid #f0f0f0",
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#fafafa",
            }}
          >
            <Typography.Text strong style={{ fontSize: 15 }}>
              {faceName ? `✦ ${faceName}` : "✦ 智能助手"}
            </Typography.Text>
            <Space size="small">
              <Tooltip title="取消固定为侧栏（恢复浮动抽屉）">
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => {
                    setPinned(false);
                    try {
                      localStorage.setItem("lcdp_assistant_pinned", "false");
                    } catch {}
                  }}
                >
                  📌 固定中
                </Button>
              </Tooltip>
              <Button size="small" onClick={startNewConversation}>
                新对话
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => setOpen(false)}
              >
                ✕
              </Button>
            </Space>
          </div>
          {renderPanelBody()}
        </aside>
      ) : (
        <Drawer
          title={faceName ? `✦ ${faceName}` : "✦ 智能助手"}
          width={"min(480px, 100vw)"}
          open={open}
          onClose={() => setOpen(false)}
          extra={
            <Space size="small">
              {isWide && (
                <Tooltip title="固定为右侧常驻侧栏（宽屏分屏协同，不遮挡页面）">
                  <Button
                    size="small"
                    onClick={() => {
                      setPinned(true);
                      try {
                        localStorage.setItem("lcdp_assistant_pinned", "true");
                      } catch {}
                    }}
                  >
                    📍 分屏固定
                  </Button>
                </Tooltip>
              )}
              <Button size="small" onClick={startNewConversation}>
                新对话
              </Button>
            </Space>
          }
          styles={{ body: { display: "flex", flexDirection: "column", padding: 0 } }}
        >
          {renderPanelBody()}
        </Drawer>
      )}
    </>
  );
}
