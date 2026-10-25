import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Empty,
  Segmented,
  Select,
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
import type { DelegationViewTarget } from "./MessageTaskCards";
import { MEMORY_CATEGORY_LABELS } from "./AssistantMemoryPanel";
import { isPendingMemory } from "./turnSteps";

/**
 * 助手全页工作台（第 91 步线 A · A1，设计 8.4 双形态的主场）：
 * 挂应用「智能服务」页内（Q2 定案，不新增一级菜单）。三栏——
 * 左：本人会话列表 + 任务卡列表（可按状态筛选，点任务卡「继续」
 * 带卡开回合）；中：对话（与抽屉同一 ChatPane 共用组件，上下文
 * = 当前应用）；右：选中任务卡详情（清单逐项 + 产物）与长期
 * 记忆速览。抽屉行为不受影响（两形态各自挂载、状态不互串）。
 *
 * 数据全部来自既有一期/线 B 端点（会话、任务、记忆），任一读取
 * 失败静默呈空态，不拖垮整页。
 */

const TASK_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  // 第 103 步步骤 3：计划收尾终态（清单办结后 close 动作转入）
  closed: "已收尾",
};

/** 任务种类中文：左栏行首标明，任务与计划任务同属一张表、只是种类不同 */
const TASK_KIND_LABELS: Record<string, string> = {
  plan: "计划",
  theme_build: "主题",
};

const CHECK_PASSED = new Set([
  "done",
  "passed",
  "pass",
  "ok",
  "complete",
  "completed",
    "success",
  "checked",
]);
const CHECK_FAILED = new Set(["failed", "error", "fail"]);
const CHECK_SKIPPED = new Set(["skipped", "skip"]);

function checkTag(status: string) {
  if (CHECK_PASSED.has(status)) return <Tag color="green">已过</Tag>;
  if (CHECK_FAILED.has(status)) return <Tag color="red">未过</Tag>;
  if (CHECK_SKIPPED.has(status)) return <Tag>跳过</Tag>;
  return <Tag color="orange">待办</Tag>;
}

/** artifacts / decisions 防御式呈现：有什么显示什么，形状不合不造 */
function renderLoose(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => renderLoose(v));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const rows: string[] = [];
    // 主题产物常见形状优先给可读一行
    if (typeof obj.themeId === "string") {
      rows.push(
        `主题：${obj.themeId}${typeof obj.version === "string" ? `@${obj.version}` : ""}`,
      );
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "themeId" || k === "version") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        rows.push(`${k}：${String(v)}`);
      }
    }
    return rows;
  }
  return [];
}

interface PaneSession {
  key: string;
  cid: string | null;
  fresh: boolean;
}

/** 右侧子代理详情：顶部 = 任务名称 + 目标，下方 = 子代理对话记录（只读） */
function DelegationDetail({
  appId,
  target,
  onBack,
}: {
  appId: string;
  target: DelegationViewTarget;
  onBack: () => void;
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
      <div>
        <Button
          size="small"
          type="link"
          style={{ padding: 0, height: "auto", fontSize: 12 }}
          onClick={onBack}
        >
          ← 返回任务详情
        </Button>
      </div>
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
   * 目标任务 id；工作台据此把任务筛选放宽到全部并选中该卡（右栏
   * 详情即其详情）。nonce 仅作触发信号，同 id 再次点击亦生效。
   */
  focusTask?: { taskId: string; nonce: number } | null;
}) {
  const [conversations, setConversations] = useState<AdminAssistantConversation[]>([]);
  const [tasks, setTasks] = useState<AdminAssistantTask[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>("active");
  /** 第 103 步步骤 6 用户修订：左栏会话与任务改选项卡切换 */
  const [leftTab, setLeftTab] = useState<"conversations" | "tasks">(
    "conversations",
  );
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
  /** 待定位的任务 id（第 95 步线 B）：任务列表下一次加载时优先选中它 */
  const pendingFocusTaskRef = useRef<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.assistant.app.conversations(appId));
    } catch {
      // 静默：左栏保持空
    }
  }, [appId]);

  const loadChildCids = useCallback(async () => {
    try {
      const list = await api.assistant.app.tasks(appId, { status: "all" });
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
      // 静默：不过滤
    }
  }, [appId]);

  const loadTasks = useCallback(async () => {
    try {
      const list = await api.assistant.app.tasks(appId, { status: taskStatus });
      setTasks(list);
      const focusId = pendingFocusTaskRef.current;
      if (focusId && list.some((t) => t.id === focusId)) {
        // 定位命中：选中目标卡并清记（后续加载回归缺省选中口径）
        pendingFocusTaskRef.current = null;
        setSelectedTaskId(focusId);
        return;
      }
      if (focusId && taskStatus === "all") {
        // 已放宽到全部仍不在列（卡已消失等）：放弃定位，不留残记
        pendingFocusTaskRef.current = null;
      }
      setSelectedTaskId((prev) =>
        prev && list.some((t) => t.id === prev) ? prev : (list[0]?.id ?? null),
      );
    } catch {
      setTasks([]);
    }
  }, [appId, taskStatus]);

  // 主动建议定位（第 95 步线 B）：已在当前列表则直接选中；不在则
  // 记下目标并放宽筛选到「全部」，由 loadTasks 在新列表里命中选中。
  useEffect(() => {
    if (!focusTask) return;
    const { taskId } = focusTask;
    if (tasks.some((t) => t.id === taskId)) {
      setSelectedTaskId(taskId);
      return;
    }
    pendingFocusTaskRef.current = taskId;
    setTaskStatus("all");
    // 仅以 focusTask 为触发信号：tasks/taskStatus 的变化由上述路径自理
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
    void loadChildCids();
  }, [loadChildCids]);
  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);
  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const openConversation = (cid: string) => {
    setCurrentCid(cid);
    setSession({ key: `conv:${cid}`, cid, fresh: false });
  };

  /** 派发卡片“查看详情”：右侧切到子代理详情（并把右侧展开） */
  const openDelegation = (target: DelegationViewTarget) => {
    setDelegationView(target);
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
      {/* 左栏：会话 + 任务 */}
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
          <Segmented
            size="small"
            style={{ flex: 1 }}
            value={leftTab}
            onChange={(v) => setLeftTab(v as "conversations" | "tasks")}
            options={[
              { label: "会话", value: "conversations" },
              { label: "任务", value: "tasks" },
            ]}
          />
          <Button size="small" onClick={startNew}>
            新对话
          </Button>
        </div>
        {leftTab === "conversations" ? (
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
        ) : (
        <>
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
            任务状态
          </Typography.Text>
          <Select
            size="small"
            value={taskStatus}
            style={{ width: 96 }}
            onChange={(v) => setTaskStatus(v)}
            options={[
              { value: "active", label: "进行中" },
              { value: "done", label: "已完成" },
              { value: "closed", label: "已收尾" },
              { value: "all", label: "全部" },
            ]}
          />
        </div>
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {tasks.length === 0 ? (
            <div style={{ padding: "12px", color: tokens.colorTextTertiary, fontSize: 12 }}>
              暂无任务
            </div>
          ) : (
            tasks.map((t) => {
              const passed = t.checklist.filter((it) =>
                CHECK_PASSED.has(it.status),
              ).length;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  style={{
                    padding: "8px 12px",
                    cursor: "pointer",
                    background:
                      selectedTaskId === t.id ? tokens.colorPrimaryBg : undefined,
                    borderBottom: `1px solid ${tokens.colorDivider}`,
                  }}
                >
                  <Typography.Text
                    ellipsis
                    style={{ fontSize: 13, display: "block" }}
                    title={t.title}
                  >
                    {t.title}
                  </Typography.Text>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 2,
                    }}
                  >
                    {t.kind && (
                      <Tag style={{ marginInlineEnd: 0 }}>
                        {TASK_KIND_LABELS[t.kind] ?? t.kind}
                      </Tag>
                    )}
                    <Tag style={{ marginInlineEnd: 0 }}>
                      {TASK_STATUS_LABELS[t.status] ?? t.status}
                    </Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      清单 {passed}/{t.checklist.length}
                    </Typography.Text>
                    <span style={{ flex: 1 }} />
                    {t.status === "active" && (
                      <Button
                        size="small"
                        type="link"
                        style={{ padding: 0, height: "auto", fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          continueTask(t);
                        }}
                      >
                        继续
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        </>
        )}
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
          onConversationChange={(cid) => {
            setCurrentCid(cid);
            void loadConversations();
            void loadTasks();
            void loadChildCids();
          }}
        />
      </div>

      {/* 右栏：任务详情 + 记忆速览（子代理详情打开时整栏切过去） */}
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
            onBack={() => setDelegationView(null)}
          />
        ) : (
        <>
        <div>
          <Typography.Text strong style={{ fontSize: 13 }}>
            任务详情
          </Typography.Text>
          {selectedTask ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Typography.Text style={{ fontSize: 13, flex: 1 }} ellipsis title={selectedTask.title}>
                  {selectedTask.title}
                </Typography.Text>
                <Tag style={{ marginInlineEnd: 0 }}>
                  {TASK_STATUS_LABELS[selectedTask.status] ?? selectedTask.status}
                </Tag>
              </div>
              {selectedTask.goal && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  目标：{selectedTask.goal}
                </Typography.Text>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {selectedTask.checklist.map((it, i) => (
                  <div
                    key={i}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                  >
                    {checkTag(it.status)}
                    <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
                    {it.evidence && /^https?:\/\//.test(it.evidence) && (
                      <a href={it.evidence} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                        证据
                      </a>
                    )}
                  </div>
                ))}
              </div>
              {renderLoose(selectedTask.artifacts).length > 0 && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    产物
                  </Typography.Text>
                  {renderLoose(selectedTask.artifacts).map((row, i) => (
                    <div key={i} style={{ fontSize: 12, wordBreak: "break-word" }}>
                      {row}
                    </div>
                  ))}
                </div>
              )}
              {renderLoose(selectedTask.decisions).length > 0 && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    已定决定
                  </Typography.Text>
                  {renderLoose(selectedTask.decisions).map((row, i) => (
                    <div key={i} style={{ fontSize: 12, wordBreak: "break-word" }}>
                      {row}
                    </div>
                  ))}
                </div>
              )}
              {selectedTask.nextStep && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  下一步：{selectedTask.nextStep}
                </Typography.Text>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                更新于 {fmtTime(selectedTask.updatedAt)}
              </Typography.Text>
            </div>
          ) : (
            <Empty
              description="点左侧任务查看详情"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ marginTop: 12 }}
            />
          )}
        </div>

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
