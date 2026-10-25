/**
 * 对话记录里的计划 / 派发卡片（第 103 步步骤 6 用户修订）。
 *
 * 服务端只在消息 payload 里放指针（任务 id、派发序号），不放快照；
 * 卡片挂载时读任务行最新状态（与左栏/右栏同源），派发进行中或
 * 计划进行中时每 20 秒轮询一次、终态即停——子回合收尾只改任务行，
 * 卡片随之翻状态，不往父会话插消息。
 */
import { useEffect, useState } from "react";
import { Button, Card, Tag, Typography } from "antd";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantTask,
} from "../../api";

/** 任务状态中文（与工作台左栏/详情同一张表） */
const TASK_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  closed: "已收尾",
};

/** 清单“已过”口径（与工作台左栏 CHECK_PASSED 一致，跳过不算过） */
const CHECK_PASSED_CARD = new Set([
  "done",
  "passed",
  "pass",
  "ok",
  "complete",
  "completed",
  "success",
  "checked",
]);

/** 派发记录（任务行 artifacts.delegations 的元素，防御式读取） */
interface DelegationRecord {
  childConversationId?: string;
  stepLabel?: string;
  goal?: string;
  status?: string;
  resultPointer?: string | null;
}

function readDelegations(task: AdminAssistantTask): DelegationRecord[] {
  const arts = task.artifacts as { delegations?: unknown } | null | undefined;
  const list = arts?.delegations;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is DelegationRecord =>
      !!d && typeof d === "object",
  ) as DelegationRecord[];
}

/** 读一张任务卡（全部状态里找；找不到即已不在列表中） */
function useTaskCard(appId: string, taskId: string) {
  const [task, setTask] = useState<AdminAssistantTask | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const tasks = await api.assistant.app.tasks(appId, {
          status: "all",
        });
        if (!alive) return;
        const found = tasks.find((t) => t.id === taskId) ?? null;
        setTask(found);
        setMissing(!found);
        // 进行中才继续轮询；终态（已完成/已收尾/已放弃等）即停
        if (found && found.status === "active") {
          timer ??= setInterval(() => void load(), 20000);
        } else if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
      } catch {
        if (alive) setMissing(true);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [appId, taskId]);
  return { task, missing };
}

const CHECK_ICON: Record<string, string> = {
  done: "✓",
  passed: "✓",
  failed: "✗",
  skipped: "–",
  active: "▸",
  pending: "○",
};

function ChecklistRows({ task }: { task: AdminAssistantTask }) {
  if (!task.checklist || task.checklist.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {task.checklist.map((it, i) => (
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 13 }}>
          <span style={{ color: tokens.colorTextSecondary }}>
            {CHECK_ICON[it.status] ?? "○"}
          </span>
          <Typography.Text
            style={{ flex: 1 }}
            delete={it.status === "skipped"}
            type={it.status === "failed" ? "danger" : undefined}
          >
            {it.label}
          </Typography.Text>
          <Tag style={{ margin: 0 }}>{it.status}</Tag>
        </div>
      ))}
    </div>
  );
}

/**
 * 对话记录里的计划卡片（去重方案 A）：默认只显示标题 + 状态 +
 * 进度 + 下一步，目标与全部步骤收在“展开清单”之后——完整清单
 * 只在右侧详情里常驻，消息区不再与详情重复展开同一份清单。
 * 清单为空时无可折叠内容，目标直接显示。
 */
export function PlanMessageCard({
  appId,
  taskId,
}: {
  appId: string;
  taskId: string;
}) {
  const { task, missing } = useTaskCard(appId, taskId);
  const [expanded, setExpanded] = useState(false);
  if (missing) {
    return (
      <Card size="small" title="计划">
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          该计划卡已不在任务列表中
        </Typography.Text>
      </Card>
    );
  }
  if (!task) {
    return (
      <Card size="small" title="计划">
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          正在读取计划…
        </Typography.Text>
      </Card>
    );
  }
  const list = task.checklist ?? [];
  const passed = list.filter((it) => CHECK_PASSED_CARD.has(it.status)).length;
  return (
    <Card
      size="small"
      title="计划"
      extra={
        <Tag style={{ margin: 0 }}>
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </Tag>
      }
      style={{
        borderColor: tokens.colorBorder,
        background: tokens.colorBgContainer,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {task.title}
        </Typography.Text>
        {list.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            清单 {passed}/{list.length}
          </Typography.Text>
        )}
        {task.nextStep && (
          <Typography.Text style={{ fontSize: 13 }}>
            下一步：{task.nextStep}
          </Typography.Text>
        )}
        {(expanded || list.length === 0) && task.goal && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            目标：{task.goal}
          </Typography.Text>
        )}
        {expanded && <ChecklistRows task={task} />}
        {list.length > 0 && (
          <Button
            type="link"
            size="small"
            style={{ padding: 0, alignSelf: "flex-start" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起清单" : `展开清单（${list.length} 步）`}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** 对话记录里的派发卡片：步骤 + 目标 + 执行状态 + 指针 + 子会话入口 */
export function DelegationMessageCard({
  appId,
  taskId,
  index,
  onOpenConversation,
}: {
  appId: string;
  taskId: string;
  index: number;
  onOpenConversation?: (cid: string) => void;
}) {
  const { task, missing } = useTaskCard(appId, taskId);
  if (missing) {
    return (
      <Card size="small" title="子代理">
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          该派发所属的任务卡已不在任务列表中
        </Typography.Text>
      </Card>
    );
  }
  if (!task) {
    return (
      <Card size="small" title="子代理">
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          正在读取派发状态…
        </Typography.Text>
      </Card>
    );
  }
  const dep = readDelegations(task)[index];
  if (!dep) {
    return (
      <Card size="small" title="子代理">
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          该派发记录已不在任务卡上
        </Typography.Text>
      </Card>
    );
  }
  const statusLabel =
    dep.status === "running"
      ? "执行中"
      : dep.status === "done"
        ? "已完成"
        : dep.status === "failed"
          ? "失败"
          : (dep.status ?? "未知");
  return (
    <Card
      size="small"
      title="子代理"
      extra={
        <Tag
          color={
            dep.status === "done"
              ? "success"
              : dep.status === "failed"
                ? "error"
                : "processing"
          }
          style={{ margin: 0 }}
        >
          {statusLabel}
        </Tag>
      }
      style={{
        borderColor: tokens.colorBorder,
        background: tokens.colorBgContainer,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {dep.stepLabel ?? `第 ${index + 1} 步`}
        </Typography.Text>
        {dep.goal && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            目标：{dep.goal}
          </Typography.Text>
        )}
        {dep.resultPointer && (
          <Typography.Text
            style={{ fontSize: 12 }}
            ellipsis
            title={dep.resultPointer}
          >
            产物指针：{dep.resultPointer}
          </Typography.Text>
        )}
        {dep.childConversationId && onOpenConversation && (
          <div>
            <Button
              size="small"
              onClick={() =>
                onOpenConversation(dep.childConversationId as string)
              }
            >
              查看子代理会话
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
