/**
 * 应用内「智能服务 · 任务记录」页（工作台改版：左栏任务列表
 * 移出后的总览）：运营助手任务记录（只读；监督视图——本应用
 * 管理员档位看本应用全部任务，领域角色档位只看本人任务）。
 * 列表为分页表格，点「查看」在抽屉里看任务详情（只放本实体
 * 数据）；实体之间的关联（任务→派发→子会话）放在列表层处理：
 * 表格有「子代理」列与可展开行，展开可见派发记录，点「查看
 * 会话」在抽屉里回放子会话原文——列表层就是事后找前因后果
 * 的审计面，详情层不跨实体取数。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type AdminAssistantMessage, type AdminAssistantTask } from "../api";
import { fmtTime } from "../helpers";
import TaskDetail, {
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  countPassed,
} from "../components/assistant/TaskDetail";
import { formatDelegationRound } from "../components/assistant/MessageTaskCards";
import { useAssistantShell } from "../shell/assistantShellContext";

/** 派发记录（任务行 artifacts.delegations 的元素，防御式读取） */
interface DelegationRecord {
  childConversationId?: string;
  stepLabel?: string;
  goal?: string;
  status?: string;
  loop?: boolean;
  loopMax?: number;
  rounds?: { verdict: string; failedItems: string[] }[];
}

function readDelegations(task: AdminAssistantTask): DelegationRecord[] {
  const arts = task.artifacts as { delegations?: unknown } | null | undefined;
  const list = arts?.delegations;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is DelegationRecord => !!d && typeof d === "object",
  ) as DelegationRecord[];
}

function depStatusLabel(status?: string): string {
  return status === "running"
    ? "执行中"
    : status === "done"
      ? "已完成"
      : status === "failed"
        ? "失败"
        : (status ?? "未知");
}

export default function AppAgentTasks({ appId }: { appId: string }) {
  const [tasks, setTasks] = useState<AdminAssistantTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AdminAssistantTask | null>(null);
  /** 子会话审计抽屉：派发记录 → 子会话原文（只读） */
  const [childDetail, setChildDetail] = useState<{
    stepLabel: string;
    goal: string;
    messages: AdminAssistantMessage[];
  } | null>(null);
  const [childLoading, setChildLoading] = useState(false);
  const { openAssistant } = useAssistantShell();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await api.assistant.app.tasks(appId, { status: "all" }));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const goAssistant = (t: AdminAssistantTask) => {
    openAssistant({ taskId: t.id, nonce: Date.now() });
  };

  /** 展开行的派发 → 子会话原文：任务抽屉让位，审计一次只看一层 */
  const openChildSession = async (dep: DelegationRecord) => {
    if (!dep.childConversationId) return;
    setDetail(null);
    setChildLoading(true);
    setChildDetail({
      stepLabel: dep.stepLabel ?? "子代理",
      goal: dep.goal ?? "",
      messages: [],
    });
    try {
      const res = await api.assistant.app.conversation(
        appId,
        dep.childConversationId,
      );
      setChildDetail({
        stepLabel: dep.stepLabel ?? "子代理",
        goal: dep.goal ?? "",
        messages: res.messages,
      });
    } catch {
      setChildDetail(null);
    } finally {
      setChildLoading(false);
    }
  };

  const taskColumns: ColumnsType<AdminAssistantTask> = [
    {
      title: "任务",
      render: (_, t) => t.title || "（无标题）",
    },
    {
      title: "种类",
      width: 90,
      render: (_, t) =>
        t.kind ? (
          <Tag style={{ marginInlineEnd: 0 }}>
            {TASK_KIND_LABELS[t.kind] ?? t.kind}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: "状态",
      width: 110,
      render: (_, t) => (
        <Tag style={{ marginInlineEnd: 0 }}>
          {TASK_STATUS_LABELS[t.status] ?? t.status}
        </Tag>
      ),
    },
    {
      title: "清单",
      width: 110,
      render: (_, t) =>
        `${countPassed(t)}/${(t.checklist ?? []).length}`,
    },
    {
      title: "子代理",
      width: 100,
      render: (_, t) => {
        const n = readDelegations(t).length;
        return n > 0 ? `${n} 条` : "—";
      },
    },
    {
      title: "更新时间",
      width: 200,
      render: (_, t) => fmtTime(t.updatedAt),
    },
    {
      title: "操作",
      width: 180,
      render: (_, t) => (
        <>
          <Button type="link" size="small" onClick={() => setDetail(t)}>
            查看
          </Button>
          <Button type="link" size="small" onClick={() => goAssistant(t)}>
            去助手查看
          </Button>
        </>
      ),
    },
  ];

  return (
    <div>
      <Table
        rowKey="id"
        columns={taskColumns}
        dataSource={tasks}
        loading={loading}
        expandable={{
          rowExpandable: (t) => readDelegations(t).length > 0,
          expandedRowRender: (t) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {readDelegations(t).map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {d.stepLabel ?? `第 ${i + 1} 步`}
                  </span>
                  {formatDelegationRound(d) && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDelegationRound(d)}
                    </Typography.Text>
                  )}
                  <Tag
                    style={{ marginInlineEnd: 0 }}
                    color={
                      d.status === "done"
                        ? "success"
                        : d.status === "failed"
                          ? "error"
                          : d.status === "running"
                            ? "processing"
                            : undefined
                    }
                  >
                    {depStatusLabel(d.status)}
                  </Tag>
                  {d.goal && (
                    <Typography.Text
                      type="secondary"
                      ellipsis
                      style={{ fontSize: 12, maxWidth: 320 }}
                      title={d.goal}
                    >
                      {d.goal}
                    </Typography.Text>
                  )}
                  {d.childConversationId && (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: "auto", fontSize: 12 }}
                      onClick={() => void openChildSession(d)}
                    >
                      查看会话
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ),
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{ emptyText: "暂无任务记录" }}
      />
      <Drawer
        title={detail?.title ?? "任务记录"}
        width={"min(520px, 100vw)"}
        open={detail !== null}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <TaskDetail
            task={detail}
            footer={
              <Button type="primary" size="small" onClick={() => goAssistant(detail)}>
                去助手查看
              </Button>
            }
          />
        )}
      </Drawer>
      <Drawer
        title={childDetail?.stepLabel ?? "子会话"}
        width={"min(520px, 100vw)"}
        open={childDetail !== null}
        onClose={() => setChildDetail(null)}
      >
        {childLoading ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <Spin />
          </div>
        ) : childDetail && childDetail.messages.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂无对话记录
          </Typography.Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {childDetail?.goal && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                目标：{childDetail.goal}
              </Typography.Text>
            )}
            {childDetail?.messages.map((m) => (
              <div key={m.id}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {m.role === "user"
                    ? "用户"
                    : m.role === "system"
                      ? "系统"
                      : "助手"}
                </Typography.Text>
                <div
                  style={{
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}
