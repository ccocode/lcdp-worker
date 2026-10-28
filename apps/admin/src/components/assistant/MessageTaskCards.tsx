/**
 * 对话记录里的计划 / 派发卡片（第 103 步步骤 6 用户修订）。
 *
 * 服务端只在消息 payload 里放指针（任务 id、派发序号），不放快照；
 * 卡片挂载时读任务行最新状态（与左栏/右栏同源），派发进行中或
 * 计划进行中时每 20 秒轮询一次、终态即停——子回合收尾只改任务行，
 * 卡片随之翻状态，不往父会话插消息。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Card, Tag, Typography } from "antd";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantOptionsCard,
  type AdminAssistantTask,
} from "../../api";
import { TaskRunTimeline } from "./TaskRunTimeline";

/** 任务状态中文（与工作台左栏/详情同一张表） */
const TASK_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  closed: "已收尾",
  awaiting_preview: "等你验收预览",
  awaiting_bind: "等你确认绑定",
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
  loop?: boolean;
  loopMax?: number;
  rounds?: {
    round: number;
    verdict: string;
    failedItems: string[];
    messageId: string;
  }[];
}

/**
 * 有界循环轮次文案（仅 loop 派发）：进行中为已完成轮数加一，终态为
 * 总轮数；末轮未过时附本轮未过原因。一轮制派发返回 null，显示原样。
 */
export function formatDelegationRound(dep: {
  loop?: boolean;
  loopMax?: number;
  status?: string;
  rounds?: { verdict: string; failedItems: string[] }[];
}): string | null {
  if (!dep.loop) return null;
  const done = dep.rounds?.length ?? 0;
  const cur = dep.status === "running" ? done + 1 : done;
  const last = (dep.rounds ?? [])[done - 1];
  const failText =
    last && last.verdict === "failed" && last.failedItems.length > 0
      ? `（本轮未过：${last.failedItems.join("、")}）`
      : "";
  return `第 ${cur}/${dep.loopMax ?? 3} 轮${failText}`;
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
 * 下一步，目标与全部步骤收在“展开清单”之后——完整清单只在
 * 右侧详情里常驻，消息区不再与详情重复展开同一份清单；清单
 * 进度并入展开按钮（已过/总数），不再单列一行。清单为空时
 * 无可折叠内容，目标直接显示。
 */
export function PlanMessageCard({
  appId,
  taskId,
  onOpenTask,
  autoOpen,
}: {
  appId: string;
  taskId: string;
  /** 工作台：卡片“查看详情”（右侧打开该任务详情）；不传则不渲染 */
  onOpenTask?: (taskId: string) => void;
  /**
   * 执行中自动打开详情（2026-10-29 用户定）：最新一张计划卡、
   * 任务进行中时挂载即打开右侧详情一次，不等用户点“查看详情”；
   * 终态任务不自动打开，用户手动点才开。
   */
  autoOpen?: boolean;
}) {
  const { task, missing } = useTaskCard(appId, taskId);
  const [expanded, setExpanded] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current || !onOpenTask) return;
    if (!task || task.status !== "active") return;
    autoOpenedRef.current = true;
    onOpenTask(taskId);
  }, [autoOpen, task, taskId, onOpenTask]);
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
        <div style={{ display: "flex", gap: 8 }}>
          {list.length > 0 && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "收起清单" : `展开清单（${passed}/${list.length}）`}
            </Button>
          )}
          {onOpenTask && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => onOpenTask(taskId)}
            >
              查看详情
            </Button>
          )}
        </div>
        <TaskRunTimeline appId={appId} taskId={taskId} />
      </div>
    </Card>
  );
}

/** 子代理详情在右侧打开时所需的信息（卡片从任务行读到后上递） */
export interface DelegationViewTarget {
  taskId: string;
  index: number;
  stepLabel: string;
  goal: string;
  childConversationId: string;
  roundLabel?: string;
}

/**
 * 对话记录里的派发卡片：步骤 + 目标 + 执行状态 + 右侧详情入口。
 * 产物指针只留任务行数据、不在卡片上显示；子代理对话记录改在
 * 右侧详情里呈现，不再把子会话载入中栏对话面。
 */
export function DelegationMessageCard({
  appId,
  taskId,
  index,
  onOpenDelegation,
}: {
  appId: string;
  taskId: string;
  index: number;
  onOpenDelegation?: (target: DelegationViewTarget) => void;
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
  const roundLabel = formatDelegationRound(dep);
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
        {roundLabel && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {roundLabel}
          </Typography.Text>
        )}
        {dep.childConversationId && onOpenDelegation && (
          <div>
            <Button
              size="small"
              onClick={() =>
                onOpenDelegation({
                  taskId,
                  index,
                  stepLabel: dep.stepLabel ?? `第 ${index + 1} 步`,
                  goal: dep.goal ?? "",
                  childConversationId: dep.childConversationId as string,
                  roundLabel: roundLabel ?? undefined,
                })
              }
            >
              查看详情
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * 选项卡片（选项类型消息）：助手出选择题时挂在气泡下方，点选项即
 * 确认——调用方先记选择、再以所选项发用户消息续跑。推荐项主按钮 +
 * “推荐”标记 + 理由小字；已选后全部按钮禁用并显示已选项（服务端
 * chosenKey 持久化，刷新不复活）。卡片自身不发请求，只呈现与回调。
 */
export function OptionsMessageCard({
  card,
  choosingKey,
  onChoose,
}: {
  card: AdminAssistantOptionsCard;
  choosingKey?: string | null;
  onChoose: (key: string, label: string) => void;
}) {
  const chosen = card.options.find((o) => o.key === card.chosenKey) ?? null;
  const options = Array.isArray(card.options) ? card.options : [];
  if (options.length === 0) return null;
  return (
    <Card
      size="small"
      title={card.question ? `请选择：${card.question}` : "请选择"}
      style={{ borderColor: tokens.colorPrimary }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((o) => {
          const isRecommended = o.key === card.recommendedKey;
          const isChosen = o.key === card.chosenKey;
          return (
            <div key={o.key}>
              <Button
                block
                size="small"
                type={isRecommended && !chosen ? "primary" : "default"}
                disabled={!!chosen || !!choosingKey}
                loading={choosingKey === o.key}
                onClick={() => onChoose(o.key, o.label)}
                style={{ justifyContent: "flex-start", height: "auto", padding: "4px 8px", whiteSpace: "normal", textAlign: "left" }}
              >
                {o.label}
                {isRecommended && !chosen ? "（推荐）" : ""}
                {isChosen ? "（已选）" : ""}
              </Button>
              {o.description ? (
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: 12, marginTop: 2 }}
                >
                  {o.description}
                </Typography.Text>
              ) : null}
            </div>
          );
        })}
        {chosen ? (
          <Tag color="success">已选：{chosen.label}</Tag>
        ) : card.recommendReason ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            推荐理由：{card.recommendReason}
          </Typography.Text>
        ) : null}
      </div>
    </Card>
  );
}
