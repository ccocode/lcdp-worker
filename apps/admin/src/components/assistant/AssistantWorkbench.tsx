import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Empty,
  Tag,
  Typography,
} from "antd";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantConversation,
  type AdminAssistantMemory,
  type AdminAssistantMessage,
  type AdminAssistantTask,
} from "../../api";
import { fmtTime } from "../../helpers";
import ChatPane from "./ChatPane";
import TaskDetail from "./TaskDetail";
import type { DelegationViewTarget } from "./MessageTaskCards";
import { MEMORY_CATEGORY_LABELS } from "./AssistantMemoryPanel";
import { isPendingMemory } from "./turnSteps";

/**
 * 助手全页工作台（第 91 步线 A · A1，设计 8.4 双形态的主场）：
 * 挂应用「智能服务」页内（Q2 定案，不新增一级菜单）。三栏——
 * 左：本人会话列表（子代理会话已滤掉）；中：对话（与弹窗同一
 * ChatPane 共用组件，上下文 = 当前应用）；右：任务详情（消息
 * 内任务卡 / 建议深链 / 任务记录页定位进入，按计划、主题、
 * 子代理三类分体）与长期记忆速览（无任务打开时显示）。
 * 展开逻辑严格从左到右：左列选会话 → 中栏展开对话记录 →
 * 右栏展开卡片详情；右栏只放当前展开那一个实体的数据，不跨
 * 实体取数、不设回链（切会话重置右栏，返回靠中栏重选卡片）。
 * 任务列表不再放左栏：总览改走智能服务「任务记录」页，左栏
 * 只留会话。弹窗与全页工作台双形态复用同一 ChatPane，状态不互串。
 *
 * 数据全部来自既有一期/线 B 端点（会话、任务、记忆），任一读取
 * 失败静默呈空态，不拖垮整页。
 */

interface PaneSession {
  key: string;
  cid: string | null;
  fresh: boolean;
}

/** 右侧子代理详情：顶部 = 步骤名 + 目标，下方 = 子代理对话记录
 * （只读）。只展示派发自己的数据，不回链父任务；返回靠中栏
 * 重选卡片（左到右展开，不设回链）。 */
function DelegationDetail({
  appId,
  target,
}: {
  appId: string;
  target: DelegationViewTarget;
}) {
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const detail = await api.assistant.app.conversation(
          appId,
          target.childConversationId,
        );
        if (alive) setMessages(detail.messages);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [appId, target.childConversationId]);
  const roleLabel = (role: string) =>
    role === "user" ? "用户" : role === "system" ? "系统" : "助手";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Typography.Text strong style={{ fontSize: 13 }}>
        {target.stepLabel}
      </Typography.Text>
      {target.goal && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          目标：{target.goal}
        </Typography.Text>
      )}
      <Typography.Text strong style={{ fontSize: 13 }}>
        对话记录
      </Typography.Text>
      {failed ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          子代理对话记录暂不可用
        </Typography.Text>
      ) : messages.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          暂无对话记录
        </Typography.Text>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
  onManageMemories,
  onExpandRight,
  focusTask,
  leftCollapsed,
  rightCollapsed,
  activePane,
  style,
}: {
  appId: string;
  appName?: string | null;
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
  /**
   * 子会话 id 集：左栏会话列表据此滤掉子代理会话。来源 = 全部任务行
   * artifacts.delegations 的 childConversationId（任务行本身不删除，
   * 故“全部”口径下集合完备，不受任务状态筛选影响）。
   */
  const [childCids, setChildCids] = useState<Set<string>>(new Set());

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.assistant.app.conversations(appId));
    } catch {
      // 静默：左栏保持空
    }
  }, [appId]);

  /**
   * 全量任务行 + 子会话 id 集一次取齐（详情按 id 取、左栏会话
   * 列表据此滤子会话；任务行本身不删除，故“全部”口径下集合
   * 完备，不受任务状态影响）。
   */
  const loadAllTasks = useCallback(async () => {
    try {
      const list = await api.assistant.app.tasks(appId, { status: "all" });
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
    } catch {
      setTasks([]);
    }
  }, [appId]);

  // 主动建议定位（第 95 步线 B）：深链打开任务详情时，中栏一并
  // 切到该任务所属会话、右栏打开其详情（左到右层级一致）；缓存
  // 里没有则重拉一次，选中态 sticky，重拉后派生即命中。
  useEffect(() => {
    if (!focusTask) return;
    const { taskId } = focusTask;
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
    setDelegationView(null);
    onExpandRight?.();
    if (!found) void loadAllTasks();
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
   * 左栏选会话（左到右展开的起点）：中栏切到该会话，右栏重置
   * （详情属于旧会话的卡片，不跟到新会话）；详情自带的“查看
   * 对话”走 viewTaskConversation，不重置。
   */
  const openConversation = (cid: string) => {
    setCurrentCid(cid);
    setSession({ key: `conv:${cid}`, cid, fresh: false });
    setDelegationView(null);
    setSelectedTaskId(null);
  };

  /** 详情自带的“查看对话”：中栏切到该任务所属会话，右栏详情保留 */
  const viewTaskConversation = (cid: string) => {
    setCurrentCid(cid);
    setSession({ key: `conv:${cid}`, cid, fresh: false });
  };

  /** 派发卡片“查看详情”：右侧切到子代理详情（并把右侧展开；
   * 父任务一并选中，点中栏计划卡可回到计划详情；缓存缺失则重拉） */
  const openDelegation = (target: DelegationViewTarget) => {
    setSelectedTaskId(target.taskId);
    if (!tasks.some((t) => t.id === target.taskId)) void loadAllTasks();
    setDelegationView(target);
    onExpandRight?.();
  };

  /** 计划卡片“查看详情”：右侧打开该任务详情（并把右侧展开；
   * 子代理详情中点计划卡即由此回到计划详情） */
  const openTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setDelegationView(null);
    if (!tasks.some((t) => t.id === taskId)) void loadAllTasks();
    onExpandRight?.();
  };

  /** 左栏会话列表：滤掉子代理会话（子会话只在右侧详情里看） */
  const visibleConversations = useMemo(
    () => conversations.filter((c) => !childCids.has(c.id)),
    [conversations, childCids],
  );

  const startNew = () => {
    setCurrentCid(null);
    setSession({ key: `new:${Date.now()}`, cid: null, fresh: true });
    setDelegationView(null);
    setSelectedTaskId(null);
  };

  /** 任务卡「继续」：选中该卡 + 把续办草稿灌进对话面输入框 */
  const continueTask = (task: AdminAssistantTask) => {
    setSelectedTaskId(task.id);
    setDraftSignal({
      text: `继续任务「${task.title}」`,
      nonce: Date.now(),
    });
  };

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
          <Typography.Text strong style={{ fontSize: 13, flex: 1 }}>
            会话
          </Typography.Text>
          <Button size="small" onClick={startNew}>
            新对话
          </Button>
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
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  background:
                    highlightCid === c.id ? tokens.colorPrimaryBg : undefined,
                  borderBottom: `1px solid ${tokens.colorDivider}`,
                }}
              >
                <Typography.Text
                  ellipsis
                  style={{ fontSize: 13, display: "block" }}
                  title={c.title ?? undefined}
                >
                  {c.title || "（无标题）"}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtTime(c.updatedAt)}
                </Typography.Text>
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
          pageContext={{
            path: window.location.pathname + window.location.search,
            pageName: "智能服务 · 助手工作台",
            appId,
            segment: "app",
          }}
          hideTaskBar
          draftSignal={draftSignal}
          onOpenDelegation={openDelegation}
          onOpenTask={openTask}
          onConversationChange={(cid) => {
            setCurrentCid(cid);
            void loadConversations();
            void loadAllTasks();
          }}
        />
      </div>

      {/* 右栏：任务详情（三类分体）+ 记忆速览（无任务打开时） */}
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
        {delegationView ? (
          <DelegationDetail
            appId={appId}
            target={delegationView}
          />
        ) : selectedTask ? (
          <TaskDetail
            task={selectedTask}
            footer={
              <>
                {selectedTask.status === "active" && (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => continueTask(selectedTask)}
                  >
                    继续
                  </Button>
                )}
                {selectedTask.conversationId && (
                  <Button
                    size="small"
                    onClick={() =>
                      viewTaskConversation(selectedTask.conversationId as string)
                    }
                  >
                    查看对话
                  </Button>
                )}
              </>
            }
          />
        ) : (
          <>
            <Empty
              description="点消息内的任务卡查看详情"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
            <div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Typography.Text strong style={{ fontSize: 13, flex: 1 }}>
                  助手记忆
                </Typography.Text>
                {onManageMemories && (
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={onManageMemories}
                  >
                    管理记忆
                  </Button>
                )}
              </div>
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
          </>
        )}
      </div>
    </div>
  );
}
