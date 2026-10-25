/**
 * 应用内「智能服务 · 任务记录」页（工作台改版：左栏任务列表
 * 移出后的总览）：运营助手任务记录（只读；监督视图——本应用
 * 管理员档位看本应用全部任务，领域角色档位只看本人任务）。
 * 列表为分页表格，点「查看」在抽屉里看任务详情（计划、主题、
 * 子代理三类分体，与工作台右栏同一 TaskDetail）；点「去助手
 * 查看」在顶栏助手弹窗里打开该任务详情。子代理派发只在详情
 * 里列出，不单独成行（子会话只在派发卡的右侧详情里看）。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type AdminAssistantTask } from "../api";
import { fmtTime } from "../helpers";
import TaskDetail, {
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  countPassed,
} from "../components/assistant/TaskDetail";
import { useAssistantShell } from "../shell/assistantShellContext";

export default function AppAgentTasks({ appId }: { appId: string }) {
  const [tasks, setTasks] = useState<AdminAssistantTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AdminAssistantTask | null>(null);
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
    </div>
  );
}
