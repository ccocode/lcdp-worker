import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Empty,
  Popconfirm,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantConversation,
  type AdminAssistantMemory,
  type AdminAssistantMessage,
  type AdminAssistantTask,
  type AdminAssistantToolCall,
} from "../../api";
import { fmtTime } from "../../helpers";
import ChatPane, {
  TurnProcess,
  type AssistantPageContext,
  type TurnProcessSnapshot,
} from "./ChatPane";
import TaskDetail from "./TaskDetail";
import type { DelegationViewTarget } from "./MessageTaskCards";
import { MEMORY_CATEGORY_LABELS } from "./AssistantMemoryPanel";
import { isPendingMemory, turnStepsOf } from "./turnSteps";
import { humanizeOpsCopy, humanizeStepLabel } from "./semanticLabels";

/**
 * 助手全页工作台（第 91 步线 A · A1，设计 8.4 双形态的主场）：
 * 挂应用「智能服务」页内（Q2 定案，不新增一级菜单）。三栏——
 * 左：本人会话列表（子代理会话已滤掉；2026-11-16 按当前应用
 * 过滤，只显当前应用的数据，标题为应用名）；中：对话（与弹窗
 * 同一 ChatPane 共用组件，上下文 = 当前应用）；右：详情与记忆
 * （选项卡分开展示：详情 = 消息内任务卡 / 建议深链 / 任务记录
 * 页定位进入的任务或子代理详情，记忆 = 长期记忆速览）。
 * 展开逻辑严格从左到右：左列选会话 → 中栏展开对话记录 →
 * 右栏展开卡片详情；右栏只放当前展开那一个实体的数据，不跨
 * 实体取数、不设回链（切会话重置右栏，返回靠中栏重选卡片）。
 * 任务列表不再放左栏：总览改走智能服务「任务记录」页，左栏
 * 只留会话。弹窗与全页工作台双形态复用同一 ChatPane，状态不互串。
 * 清除与删除只标记（服务端置 deleted_at，不物理删）。
 *
 * 数据全部来自既有一期/线 B 端点（会话、任务、记忆），任一读取
 * 失败静默呈空态，不拖垮整页。
 */

interface PaneSession {
  key: string;
  cid: string | null;
  fresh: boolean;
}

/** 右侧子代理详情（2026-11-16 详情改版）：与「执行过程」同一只框——
 * 框内只显示子代理的执行步骤（子会话各消息的工具调用按时序汇总），
 * 标题行 = 步骤名 + 共 N 个步骤；无工具调用时回落为对话记录（只读）。
 * 只展示派发自己的数据，不回链父任务；返回靠中栏重选卡片。 */
function DelegationDetail({
  appId,
  target,
}: {
  appId: string | null;
  target: DelegationViewTarget;
}) {
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<AdminAssistantToolCall[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const detail = appId
          ? await api.assistant.app.conversation(
              appId,
              target.childConversationId,
            )
          : await api.assistant.conversation(target.childConversationId);
        if (alive) {
          setMessages(detail.messages);
          setToolCalls(detail.toolCalls ?? []);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [appId, target.childConversationId]);
  const steps = useMemo(() => {
    const all = messages.flatMap((m) => turnStepsOf(m, toolCalls));
    return all
      .map((step, idx) => ({ step, idx }))
      .sort((a, b) => {
        const ta = a.step.startedAt ? Date.parse(a.step.startedAt) : null;
        const tb = b.step.startedAt ? Date.parse(b.step.startedAt) : null;
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        if (ta !== null && tb === null) return -1;
        if (ta === null && tb !== null) return 1;
        return a.idx - b.idx;
      })
      .map(({ step }) => step);
  }, [messages, toolCalls]);
  const roleLabel = (role: string) =>
    role === "user" ? "用户" : role === "system" ? "系统" : "助手";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {target.goal && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          目标：{humanizeOpsCopy(target.goal)}
        </Typography.Text>
      )}
      {target.roundLabel && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {target.roundLabel}
        </Typography.Text>
      )}
      {failed ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          子代理执行记录暂不可用
        </Typography.Text>
      ) : steps.length > 0 ? (
        <TurnProcess
          steps={steps}
          elapsedMs={0}
          completed
          defaultCollapsed={false}
          title={humanizeStepLabel(target.stepLabel)}
          cancelling={false}
          cancelDisabled={false}
        />
      ) : messages.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          暂无对话记录
        </Typography.Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            对话记录
          </Typography.Text>
          {messages.map((m) => (
            <div key={m.id}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {roleLabel(m.role)}
              </Typography.Text>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssistantWorkbench({
  appId,
  appName,
  selectorAppName,
  onManageMemories,
  onExpandRight,
  focusTask,
  leftCollapsed,
  rightCollapsed,
  activePane,
  style,
  freshNonce,
  pageContext,
}: {
  appId: string | null;
  appName?: string | null;
  /** 顶栏选择器当前应用名（平台上下文时左栏标题用；应用上下文时与 appName 同值） */
  selectorAppName?: string | null;
  /** 弹窗标题栏“新对话”信号：代次变化时开一个全新会话（两边同壳后平台与应用共用此入口） */
  freshNonce?: number;
  /** 页内入口带来的页面上下文（弹窗平台侧沿用 AppShell 的当前页上下文；不传则工作台自造） */
  pageContext?: AssistantPageContext;
  /** 弹窗壳：打开子代理详情时把右侧展开（默认收起时否则点后无可见变化） */
  onExpandRight?: () => void;
  /** 第 103 步步骤 6：弹窗壳的收起与窄屏控制（页内工作台不用，默认全展开） */
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  /** 窄屏下只显一栏（null = 三栏全显） */
  activePane?: "left" | "chat" | "right" | null;
  style?: React.CSSProperties;
  /** 右栏记忆速览「管理记忆」点击：父页滚动到记忆管理区 */
  onManageMemories?: () => void;
  /**
   * 主动建议深链定位（第 95 步线 B）：父页点 T 类建议「去办」时置入
   * 目标任务 id；工作台据此选中该任务并在右栏打开其详情（缓存
   * 缺失时重拉全量）。nonce 仅作触发信号，同 id 再次点击亦生效。
   */
  focusTask?: { taskId: string; nonce: number } | null;
}) {
  const [conversations, setConversations] = useState<AdminAssistantConversation[]>([]);
  /**
   * 任务行全量缓存（左栏不再渲染任务列表，但右栏详情、子会话
   * 过滤、建议深链定位都按 id 从这里取；不按状态筛选）。
   */
  const [tasks, setTasks] = useState<AdminAssistantTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [session, setSession] = useState<PaneSession>({
    key: "latest",
    cid: null,
    fresh: false,
  });
  /** 对话面当前会话（回调同步，用于左栏高亮，不触发重挂载） */
  const [currentCid, setCurrentCid] = useState<string | null>(null);
  const [draftSignal, setDraftSignal] = useState<{ text: string; nonce: number } | null>(null);
  const [memories, setMemories] = useState<AdminAssistantMemory[]>([]);
  const [memoriesOk, setMemoriesOk] = useState(true);
  /** 右侧正在查看的子代理详情（null = 任务详情 + 记忆速览） */
  const [delegationView, setDelegationView] =
    useState<DelegationViewTarget | null>(null);
  /** 右栏选项卡：任务 / 记忆（2026-11-16 记忆与详情合一图标后按类型分开展示；2026-11-16 详情页签改名任务） */
  const [rightTab, setRightTab] = useState<"detail" | "memory">("memory");
  /** 2026-11-16：最新回合执行过程快照（ChatPane 上报；右侧任务页签顶部渲染，执行步骤与执行过程只在此处显示） */
  const [turnProcess, setTurnProcess] = useState<TurnProcessSnapshot | null>(null);
  /** 2026-11-16 详情改版：右栏任务框的展开集（受控；切会话时重置为最新一只，新任务落成时自动展开它） */
  const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  /** 2026-11-16：回合开始执行时切到任务页签，让执行过程可见（只在进入执行中那一刻切一次，不反复抢页签） */
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    const generating = !!turnProcess && !turnProcess.completed;
    if (generating && !wasGeneratingRef.current) setRightTab("detail");
    wasGeneratingRef.current = generating;
  }, [turnProcess]);
  /** 左栏悬停的会话 id（悬停时右侧显删除图标） */
  const [hoverCid, setHoverCid] = useState<string | null>(null);
  /**
   * 顶栏选择器当前应用（左栏按应用过滤的基准）：页面上下文的
   * appId 恒为选择器当前应用；无上下文时回落对话框应用。
   */
  const selectorAppId = pageContext?.appId ?? appId ?? null;
  /**
   * 子会话 id 集：左栏会话列表据此滤掉子代理会话。来源 = 全部任务行
   * artifacts.delegations 的 childConversationId（任务行本身不删除，
   * 故“全部”口径下集合完备，不受任务状态筛选影响）。
   */
  const [childCids, setChildCids] = useState<Set<string>>(new Set());

  const loadConversations = useCallback(async () => {
    try {
      setConversations(
        appId
          ? await api.assistant.app.conversations(appId)
          : await api.assistant.conversations(),
      );
    } catch {
      // 静默：左栏保持空
    }
  }, [appId]);

  /**
   * 全量任务行 + 子会话 id 集一次取齐（详情按 id 取、左栏会话
   * 列表据此滤子会话；任务行本身不删除，故“全部”口径下集合
   * 完备，不受任务状态影响）。
   */
  const loadAllTasks = useCallback(async (): Promise<AdminAssistantTask[]> => {
    try {
      const list = appId
        ? await api.assistant.app.tasks(appId, { status: "all" })
        : await api.assistant.tasks({ status: "all" });
      setTasks(list);
      const ids = new Set<string>();
      for (const t of list) {
        const arts = t.artifacts as { delegations?: unknown } | null | undefined;
        const deps = arts?.delegations;
        if (!Array.isArray(deps)) continue;
        for (const d of deps) {
          const rec = d as { childConversationId?: unknown } | null;
          if (rec && typeof rec.childConversationId === "string") {
            ids.add(rec.childConversationId);
          }
        }
      }
      setChildCids(ids);
      return list;
    } catch {
      setTasks([]);
      return [];
    }
  }, [appId]);

  /** 深链目标任务 id（防连续深链时旧的重拉回包抢切中栏） */
  const focusTaskIdRef = useRef<string | null>(null);

  // 主动建议定位（第 95 步线 B）：深链打开任务详情时，中栏一并
  // 切到该任务所属会话、右栏打开其详情（左到右层级一致）。
  // 缓存里没有（如弹窗刚挂载、任务尚未拉回）则链式重拉一次，
  // 以回包里的任务补切中栏——深链落位不再依赖详情内的按钮。
  useEffect(() => {
    if (!focusTask) return;
    const { taskId } = focusTask;
    focusTaskIdRef.current = taskId;
    const found = tasks.find((t) => t.id === taskId);
    if (found?.conversationId) {
      setCurrentCid(found.conversationId);
      setSession({
        key: `conv:${found.conversationId}`,
        cid: found.conversationId,
        fresh: false,
      });
    }
    setSelectedTaskId(taskId);
    setExpandedTaskIds((prev) => new Set(prev).add(taskId));
    setDelegationView(null);
    onExpandRight?.();
    if (!found) {
      void loadAllTasks().then((list) => {
        if (focusTaskIdRef.current !== taskId) return;
        const f = list.find((t) => t.id === taskId);
        if (!f?.conversationId) return;
        setCurrentCid(f.conversationId);
        setSession({
          key: `conv:${f.conversationId}`,
          cid: f.conversationId,
          fresh: false,
        });
      });
    }
    // 仅以 focusTask 为触发信号：缓存变化由派生自理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTask]);

  const loadMemories = useCallback(async () => {
    try {
      const list = await api.assistant.memories.list({});
      setMemories(list.filter((m) => !isPendingMemory(m)).slice(0, 5));
      setMemoriesOk(true);
    } catch {
      setMemories([]);
      setMemoriesOk(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    void loadAllTasks();
  }, [loadAllTasks]);
  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  /**
   * 2026-11-16 详情改版：当前会话的任务框（按创建时间升序）；
   * 被选中的任务即使不在当前会话也追加一只框（建议深链直达兜底）。
   */
  const conversationTasks = useMemo(() => {
    const list = tasks.filter(
      (t) => currentCid && t.conversationId === currentCid,
    );
    const sorted = [...list].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return ta - tb;
    });
    if (selectedTask && !sorted.some((t) => t.id === selectedTask.id)) {
      sorted.push(selectedTask);
    }
    return sorted;
  }, [tasks, currentCid, selectedTask]);

  /** 切会话重置展开集、新任务落成自动展开：只认会话切换与最新任务变化，用户手动收起不被任务重拉打回 */
  const boxResetCidRef = useRef<string | null | undefined>(undefined);
  const boxLatestIdRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = conversationTasks[conversationTasks.length - 1] ?? null;
    if (boxResetCidRef.current !== currentCid) {
      boxResetCidRef.current = currentCid;
      boxLatestIdRef.current = latest?.id ?? null;
      setExpandedTaskIds(latest ? new Set([latest.id]) : new Set());
      return;
    }
    if (latest && boxLatestIdRef.current !== latest.id) {
      boxLatestIdRef.current = latest.id;
      setExpandedTaskIds((prev) => new Set(prev).add(latest.id));
    }
    // 仅以会话与任务列表变化为触发信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCid, conversationTasks]);

  const toggleTaskBox = (id: string, v: boolean) =>
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });

  /**
   * 左栏选会话（左到右展开的起点）：中栏切到该会话，右栏重置
   * （详情属于旧会话的卡片，不跟到新会话）；右栏回到记忆页签。
   */
  const openConversation = (cid: string) => {
    setCurrentCid(cid);
    setSession({ key: `conv:${cid}`, cid, fresh: false });
    setDelegationView(null);
    setSelectedTaskId(null);
    setRightTab("memory");
    setTurnProcess(null);
  };

  /** 派发卡片“查看详情”：右侧切到子代理详情（并把右侧展开；
   * 父任务一并选中，点中栏计划卡可回到计划详情；缓存缺失则重拉） */
  const openDelegation = (target: DelegationViewTarget) => {
    setSelectedTaskId(target.taskId);
    if (!tasks.some((t) => t.id === target.taskId)) void loadAllTasks();
    setDelegationView(target);
    setRightTab("detail");
    onExpandRight?.();
  };

  /** 计划卡片“查看详情”：右侧打开该任务详情（并把右侧展开；
   * 子代理详情中点计划卡即由此回到计划详情；每次打开刷新任务快照防旧进度） */
  const openTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDelegationView(null);
    setRightTab("detail");
    setExpandedTaskIds((prev) => new Set(prev).add(taskId));
    void loadAllTasks();
    onExpandRight?.();
    // 框渲染后滚到该任务框（卡片在对话框里，框在右栏）
    requestAnimationFrame(() => {
      document
        .getElementById(`task-box-${taskId}`)
        ?.scrollIntoView({ block: "start" });
    });
  };

  /**
   * 会话 → 应用归属（左栏按应用过滤用）：会话本身不带应用，
   * 以其任务行的目标应用为准（任务行 appId 即目标应用；平台级
   * 任务 appId 为空串，不归属任何应用）。无任务的会话不归属
   * 任何应用，在按应用过滤时不显示。
   */
  const convAppIds = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of tasks) {
      if (!t.conversationId || !t.appId) continue;
      let set = map.get(t.conversationId);
      if (!set) {
        set = new Set();
        map.set(t.conversationId, set);
      }
      set.add(t.appId);
    }
    return map;
  }, [tasks]);

  /** 左栏会话列表：滤掉子代理会话（子会话只在右侧详情里看）；
   * 平台上下文再按选择器当前应用过滤（应用上下文服务端已按应用取数）。 */
  const visibleConversations = useMemo(
    () =>
      conversations.filter(
        (c) =>
          !childCids.has(c.id) &&
          (appId !== null ||
            !selectorAppId ||
            convAppIds.get(c.id)?.has(selectorAppId)),
      ),
    [conversations, childCids, appId, selectorAppId, convAppIds],
  );

  /** 开全新会话（中栏回到空白输入；左栏标题栏“新对话”与删/清空当前会话后共用） */
  const startNew = useCallback(() => {
    setCurrentCid(null);
    setSession({ key: `new:${Date.now()}`, cid: null, fresh: true });
    setDelegationView(null);
    setSelectedTaskId(null);
    setTurnProcess(null);
  }, []);

  /**
   * 2026-11-16 切换应用状态残留修复：顶栏选择器换应用时，中栏回到
   * 空白会话（旧会话不跟到新应用），会话与任务列表重拉一份。
   * 跑任务中切换已有 AppShell 侧提示拦截，点取消不换应用、本
   * effect 不触发；首挂载跳过（不因初始值误重置）。
   */
  const selectorAppIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (selectorAppIdRef.current === undefined) {
      selectorAppIdRef.current = selectorAppId;
      return;
    }
    if (selectorAppIdRef.current === selectorAppId) return;
    selectorAppIdRef.current = selectorAppId;
    startNew();
    setRightTab("memory");
    void loadConversations();
    void loadAllTasks();
    // 仅以选择器当前应用变化为触发信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorAppId]);

  /** 软删除单条会话（只标记）：删的是当前会话时中栏回到全新会话 */
  const deleteConversation = useCallback(
    async (cid: string) => {
      try {
        if (appId) {
          await api.assistant.app.deleteConversation(appId, cid);
        } else {
          await api.assistant.deleteConversation(cid);
        }
        if (currentCid === cid) {
          startNew();
        }
        await loadConversations();
      } catch {
        // 静默：列表保持原样
      }
    },
    [appId, currentCid, loadConversations, startNew],
  );

  /** 清空列表（只清当前可见的会话，软删除）：清掉当前会话时中栏回到全新会话 */
  const clearConversations = useCallback(async () => {
    const ids = visibleConversations.map((c) => c.id);
    if (ids.length === 0) return;
    try {
      if (appId) {
        await api.assistant.app.clearConversations(appId, ids);
      } else {
        await api.assistant.clearConversations(ids);
      }
      if (currentCid && ids.includes(currentCid)) {
        startNew();
      }
      await loadConversations();
    } catch {
      // 静默：列表保持原样
    }
  }, [appId, currentCid, visibleConversations, loadConversations, startNew]);

  // 弹窗标题栏“新对话”：代次变化即开全新会话；首挂载跳过（上下文
  // 切换重挂载时只显最新会话，不因沿用代次误开新会话）
  const freshNonceFirst = useRef(true);
  useEffect(() => {
    if (freshNonceFirst.current) {
      freshNonceFirst.current = false;
      return;
    }
    if (!freshNonce) return;
    startNew();
    // 仅以 freshNonce 为触发信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshNonce]);

  const highlightCid = currentCid ?? session.cid;

  const leftHidden =
    leftCollapsed === true ||
    (activePane !== null &&
      activePane !== undefined &&
      activePane !== "left");
  const rightHidden =
    rightCollapsed === true ||
    (activePane !== null &&
      activePane !== undefined &&
      activePane !== "right");
  const chatHidden =
    activePane !== null && activePane !== undefined && activePane !== "chat";
  return (
    <div
      style={{
        display: "flex",
        // 弹窗里父容器是横向 flex：外层不撑满时容器按内容收缩，
        // 中栏 flex:1 只能拿到内容固有宽（约 370），两边一开即变窄
        // （2026-10-29 复现）。flex:1 + width:100% 让它先占满父容器，
        // 中栏再按剩余宽分配；页内块级父容器下 flex 被忽略、width 生效。
        flex: 1,
        width: "100%",
        height: 680,
        border: `1px solid ${tokens.colorDivider}`,
        borderRadius: 8,
        overflow: "hidden",
        background: tokens.colorBgContainer,
        ...style,
      }}
    >
      {/* 左栏：会话（任务列表已移出，总览走任务记录页） */}
      <div
        style={{
          width: 264,
          flexShrink: 0,
          borderRight: `1px solid ${tokens.colorDivider}`,
          display: leftHidden ? "none" : "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: `1px solid ${tokens.colorDivider}`,
          }}
        >
          <Typography.Text
            strong
            ellipsis
            style={{ fontSize: 13, flex: 1, minWidth: 0 }}
            title={selectorAppName ?? appName ?? undefined}
          >
            {selectorAppName ?? appName ?? "会话"}
          </Typography.Text>
          <Popconfirm
            title="清空当前应用的全部对话？"
            description="列表里的对话将全部清除（只标记，不删除任务数据）。"
            okText="清空"
            cancelText="取消"
            onConfirm={() => void clearConversations()}
          >
            <Button size="small" disabled={visibleConversations.length === 0}>
              清除对话
            </Button>
          </Popconfirm>
        </div>
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {visibleConversations.length === 0 ? (
            <div style={{ padding: "12px", color: tokens.colorTextTertiary, fontSize: 12 }}>
              暂无会话
            </div>
          ) : (
            visibleConversations.map((c) => (
              <div
                key={c.id}
                onClick={() => openConversation(c.id)}
                onMouseEnter={() => setHoverCid(c.id)}
                onMouseLeave={() => setHoverCid((v) => (v === c.id ? null : v))}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background:
                    highlightCid === c.id ? tokens.colorPrimaryBg : undefined,
                  borderBottom: `1px solid ${tokens.colorDivider}`,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 4,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Typography.Text
                    ellipsis
                    style={{ fontSize: 13, display: "block" }}
                    title={c.title ? humanizeOpsCopy(c.title) : undefined}
                  >
                    {c.title ? humanizeOpsCopy(c.title) : "（无标题）"}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(c.updatedAt)}
                  </Typography.Text>
                </div>
                {hoverCid === c.id && (
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    title="删除该对话"
                    style={{ flexShrink: 0, padding: 0, width: 20, height: 20, minWidth: 20 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteConversation(c.id);
                    }}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 中栏：对话（共用 ChatPane） */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: chatHidden ? "none" : "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <ChatPane
          key={session.key}
          appId={appId}
          fresh={session.fresh}
          initialConversationId={session.cid}
          pageContext={
            pageContext ?? {
              path: window.location.pathname + window.location.search,
              pageName: "智能服务 · 助手工作台",
              appId,
              segment: appId ? "app" : "platform",
            }
          }
          hideTaskBar
          draftSignal={draftSignal}
          onOpenDelegation={openDelegation}
          onOpenTask={openTask}
          onTasksSync={() => {
            void loadAllTasks();
          }}
          onTurnProcessChange={setTurnProcess}
          onConversationChange={(cid) => {
            setCurrentCid(cid);
            void loadConversations();
            void loadAllTasks();
          }}
        />
      </div>

      {/* 右栏：详情与记忆（选项卡按类型分开展示；入口为标题栏合一图标） */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          borderLeft: `1px solid ${tokens.colorDivider}`,
          overflowY: "auto",
          minHeight: 0,
          padding: 12,
          display: rightHidden ? "none" : "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Tabs
          size="small"
          activeKey={rightTab}
          onChange={(k) => setRightTab(k as "detail" | "memory")}
          items={[
            {
              key: "detail",
              label: "任务",
              children: (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* 2026-11-16：最新回合执行过程（步骤按时序自上而下，失败步行内跟错误文本） */}
                  {turnProcess && (
                    <TurnProcess
                      steps={turnProcess.steps}
                      elapsedMs={turnProcess.elapsedMs}
                      completed={turnProcess.completed}
                      defaultCollapsed={false}
                      onCancel={turnProcess.onCancel}
                      cancelling={turnProcess.cancelling}
                      cancelDisabled={turnProcess.cancelDisabled}
                    />
                  )}
                  {/* 2026-11-16 详情改版：只显示执行步骤——每任务一只
                      执行过程样式的框（子代理详情同样式）；任务列表
                      与对话框计划卡重复的头部/目标/清单展示已去掉 */}
                  {delegationView ? (
                    <DelegationDetail
                      appId={appId}
                      target={delegationView}
                    />
                  ) : conversationTasks.length > 0 ? (
                    conversationTasks.map((t) => (
                      <div key={t.id} id={`task-box-${t.id}`}>
                        <TaskDetail
                          task={t}
                          appId={appId}
                          expanded={expandedTaskIds.has(t.id)}
                          onExpandedChange={(v) => toggleTaskBox(t.id, v)}
                          onHandlePending={
                            t.conversationId
                              ? () =>
                                  openConversation(t.conversationId as string)
                              : undefined
                          }
                        />
                      </div>
                    ))
                  ) : (
                    !turnProcess && (
                      <Empty
                        description="点消息内的任务卡查看详情"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    )
                  )}
                </div>
              ),
            },
            {
              key: "memory",
              label: "记忆",
              children: (
                <div>
                  {onManageMemories && (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        size="small"
                        type="link"
                        style={{ padding: 0, height: "auto", fontSize: 12 }}
                        onClick={onManageMemories}
                      >
                        管理记忆
                      </Button>
                    </div>
                  )}
                  {!memoriesOk ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                      记忆服务暂不可用
                    </Typography.Text>
                  ) : memories.length === 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
                      暂无长期记忆
                    </Typography.Text>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {memories.map((m) => (
                        <div key={m.id} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                          <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                            {MEMORY_CATEGORY_LABELS[m.category] ?? m.category}
                          </Tag>
                          <Typography.Text
                            ellipsis
                            style={{ fontSize: 12, minWidth: 0 }}
                            title={m.content}
                          >
                            {m.content}
                          </Typography.Text>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
