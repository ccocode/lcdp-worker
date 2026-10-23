import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Empty,
  Select,
  Tag,
  Typography,
} from "antd";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantConversation,
  type AdminAssistantMemory,
  type AdminAssistantTask,
} from "../../api";
import { fmtTime } from "../../helpers";
import ChatPane from "./ChatPane";
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

export default function AssistantWorkbench({
  appId,
  appName,
  onManageMemories,
}: {
  appId: string;
  appName?: string | null;
  /** 右栏记忆速览「管理记忆」点击：父页滚动到记忆管理区 */
  onManageMemories?: () => void;
}) {
  const [conversations, setConversations] = useState<AdminAssistantConversation[]>([]);
  const [tasks, setTasks] = useState<AdminAssistantTask[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>("active");
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

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.assistant.app.conversations(appId));
    } catch {
      // 静默：左栏保持空
    }
  }, [appId]);

  const loadTasks = useCallback(async () => {
    try {
      const list = await api.assistant.app.tasks(appId, { status: taskStatus });
      setTasks(list);
      setSelectedTaskId((prev) =>
        prev && list.some((t) => t.id === prev) ? prev : (list[0]?.id ?? null),
      );
    } catch {
      setTasks([]);
    }
  }, [appId, taskStatus]);

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

  return (
    <div
      style={{
        display: "flex",
        height: 680,
        border: `1px solid ${tokens.colorDivider}`,
        borderRadius: 8,
        overflow: "hidden",
        background: tokens.colorBgContainer,
      }}
    >
      {/* 左栏：会话 + 任务 */}
      <div
        style={{
          width: 264,
          flexShrink: 0,
          borderRight: `1px solid ${tokens.colorDivider}`,
          display: "flex",
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
        <div style={{ overflowY: "auto", maxHeight: 240 }}>
          {conversations.length === 0 ? (
            <div style={{ padding: "12px", color: tokens.colorTextTertiary, fontSize: 12 }}>
              暂无会话
            </div>
          ) : (
            conversations.map((c) => (
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
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderTop: `1px solid ${tokens.colorDivider}`,
            borderBottom: `1px solid ${tokens.colorDivider}`,
          }}
        >
          <Typography.Text strong style={{ fontSize: 13, flex: 1 }}>
            任务
          </Typography.Text>
          <Select
            size="small"
            value={taskStatus}
            style={{ width: 96 }}
            onChange={(v) => setTaskStatus(v)}
            options={[
              { value: "active", label: "进行中" },
              { value: "done", label: "已完成" },
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
      </div>

      {/* 中栏：对话（共用 ChatPane） */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
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
          onConversationChange={(cid) => {
            setCurrentCid(cid);
            void loadConversations();
            void loadTasks();
          }}
        />
      </div>

      {/* 右栏：任务详情 + 记忆速览 */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          borderLeft: `1px solid ${tokens.colorDivider}`,
          overflowY: "auto",
          minHeight: 0,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
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
      </div>
    </div>
  );
}
