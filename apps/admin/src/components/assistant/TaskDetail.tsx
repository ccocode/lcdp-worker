/**
 * 任务详情体（工作台右栏与任务记录页抽屉共用）：
 * 只展示本实体自己的数据，不跨实体取数——统一壳 = 标题 +
 * 种类标 + 状态标 + 目标；任务头下面是步骤清单（✓ + 文字，
 * 当前步骤默认展开显示执行动作、已完成默认收起、全部完成
 * 末尾显示执行完成；中间不显示时间）。
 * 预览卡与绑定审批卡不在此显示，只在对话框里（对话框是
 * 唯一操作面）；详情里只留暂停 / 终审未达标的状态行（对
 * 话框里没有继续运行 / 重试失败节点入口）。
 * 底部不放时间与继续入口（详情只展示，操作走对话框）；
 * 任务记录页仍可由调用方以 footer 注入去助手查看。待决事项的处理入口由调用方以
 * onHandlePending 注入（工作台：切到本任务会话；任务记录页：
 * 去助手查看）；不传则只展示待决、不给入口。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, message, Spin, Tag, Typography } from "antd";
import {
  api,
  type AdminAssistantTask,
  type AdminTaskRunDetail,
} from "../../api";

/** 状态圆点：等待灰、执行中蓝闪、完成绿、失败红（Badge 原生圆点，processing 自带闪烁）。 */
function StatusDot({
  status,
}: {
  status: "waiting" | "running" | "completed" | "failed";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        flexShrink: 0,
      }}
    >
      <Badge
        status={
          status === "running"
            ? "processing"
            : status === "completed"
              ? "success"
              : status === "failed"
                ? "error"
                : "default"
        }
      />
    </span>
  );
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  closed: "已收尾",
  awaiting_preview: "等你验收预览",
  awaiting_bind: "等你确认绑定",
  awaiting_home: "等你确认首页",
};

/** 任务种类中文：计划与主题任务同属一张表、只是种类不同 */
export const TASK_KIND_LABELS: Record<string, string> = {
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

/** 清单“已过”条数（与详情同一口径，跳过不算过） */
export function countPassed(task: AdminAssistantTask): number {
  return (task.checklist ?? []).filter((it) => CHECK_PASSED.has(it.status))
    .length;
}

/** run 状态中文（D6 首批；服务端 run_status 原值直传，缺省回原值） */
export const RUN_STATUS_LABELS: Record<string, string> = {
  pending: "待开始",
  running: "进行中",
  paused: "等你处理",
  completed: "已完成",
  failed: "已失败",
  cancelled: "已取消",
  awaiting_preview: "等你验收预览",
  awaiting_bind: "等你确认绑定",
  awaiting_home: "等你确认首页",
};

/** 节点状态中文（D6 首批） */
export const NODE_STATUS_LABELS: Record<string, string> = {
  pending: "待开始",
  active: "进行中",
  completed: "已完成",
  failed: "已失败",
  skipped: "已跳过",
  cancelled: "已取消",
};

/** 暂停原因中文（D6 首批；服务端 reason 键直传，未列出的回通用文案） */
export const PAUSE_REASON_LABELS: Record<string, string> = {
  "budget-exhausted": "预算已用完",
  "script-failure": "节点执行失败",
  "consecutive-failures": "连续失败",
};

/** 暂停处置动作中文（与服务端通知正文同口径；未知键原样回落） */
export const RECOVERY_ACTION_LABELS: Record<string, string> = {
  "raise-budget": "提高预算",
  abandon: "放弃任务",
  "fix-contract": "修规约",
  "start-successor-run": "开后继任务",
  "inspect-failures": "查看失败节点",
  "retry-nodes": "重试失败节点",
};

export default function TaskDetail({
  task,
  footer,
  appId,
  onHandlePending,
}: {
  task: AdminAssistantTask;
  footer?: ReactNode;
  /** 传了且任务有 runId 时才取 run 详情（不传则不取数；传 null 走平台侧） */
  appId?: string | null;
  /** 待决事项的处理入口（不传则只展示） */
  onHandlePending?: () => void;
}) {
  const [runDetail, setRunDetail] = useState<AdminTaskRunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runTick, setRunTick] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  useEffect(() => {
    if (appId === undefined || !task.runId) {
      setRunDetail(null);
      return;
    }
    let alive = true;
    setRunLoading(true);
    const runPromise =
      appId === null
        ? api.assistant.taskRun(task.id)
        : api.assistant.app.taskRun(appId, task.id);
    void runPromise
      .then((res) => {
        if (alive) setRunDetail(res);
      })
      .finally(() => {
        if (alive) setRunLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [appId, task.id, task.runId, runTick]);
  /**
   * 详情自动滚到底部（2026-10-29 用户定）：内容变化（清单 /
   * 执行动作 / 终态重拉、切任务）后，把最近的可滚动祖先（工作台右栏
   * 或任务记录页抽屉体）滚到底部，最新内容始终可见。
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let p: HTMLElement | null = el.parentElement;
    while (p) {
      const overflowY = window.getComputedStyle(p).overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        p.scrollHeight > p.clientHeight
      ) {
        p.scrollTop = p.scrollHeight;
        break;
      }
      p = p.parentElement;
    }
  }, [runDetail, task.id]);
  /**
   * 详情实时刷新（2026-10-29 用户定）：详情开着时订阅同一条
   * run SSE，流里有动静（执行动作 / 终态）就重拉一次详情，
   * 不再只靠打开时那一次和详情内操作后那一次。首包 snapshot
   * 跳过（打开时已拉过一次，跳过可省一次重复请求）；服务端
   * 3 秒推一次增量，重拉频率与之同频；终态后服务端收流，
   * 客户端不再重连。订阅失败静默降级为打开时那一次。
   */
  useEffect(() => {
    if (appId === undefined || !task.runId) return;
    let first = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onEvent = (ev: { type: string; data: unknown }) => {
      if (first) {
        first = false;
        return;
      }
      if (ev.type === "snapshot") return;
      // 同一轮多个事件只合成为一次重拉（500ms 节流）。
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setRunTick((t) => t + 1);
      }, 500);
    };
    const off =
      appId === null
        ? api.assistant.streamTaskRun(task.id, onEvent)
        : api.assistant.app.streamTaskRun(appId, task.id, onEvent);
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [appId, task.id, task.runId]);
  /**
   * 详情内仅留的处置动作（暂停行的继续运行 / 重试失败节点）：
   * 预览与绑定只在对话框里点，详情里不给入口。
   */
  const runAction = async (kind: "resume" | "retry-nodes") => {
    if (appId === undefined || acting) return;
    setActing(kind);
    try {
      if (kind === "resume") {
        if (appId === null) await api.assistant.resumeRun(task.id);
        else await api.assistant.app.resumeRun(appId, task.id);
      } else {
        if (appId === null) await api.assistant.retryRunNodes(task.id);
        else await api.assistant.app.retryRunNodes(appId, task.id);
      }
      // 成功后重拉 run 详情，界面随重拉结果刷新。
      setRunTick((t) => t + 1);
    } catch {
      message.error("操作失败，请稍后重试");
    } finally {
      setActing(null);
    }
  };
  const arts = task.artifacts as Record<string, unknown> | null | undefined;
  const themeLine =
    task.kind === "theme_build" && typeof arts?.themeId === "string"
      ? `主题：${arts.themeId}${typeof arts.version === "string" ? `@${arts.version}` : ""}`
      : null;

  /** 步骤清单（任务头下面的唯一正文）：✓ + 文字，中间不显示时间。 */
  type StepState = "passed" | "failed" | "skipped" | "pending";
  const stepState = (status: string): StepState =>
    CHECK_PASSED.has(status)
      ? "passed"
      : CHECK_FAILED.has(status)
        ? "failed"
        : CHECK_SKIPPED.has(status)
          ? "skipped"
          : "pending";
  const checklist = task.checklist ?? [];
  const runStatus = runDetail?.run?.runStatus ?? null;
  /** 详情头状态跟 runStatus（收尾1）：等验收/等确认首页等态不再只显示“进行中”，与对话框卡角标同口径；run 详情未到时回落任务行 runStatus。 */
  const headerRunStatus = runStatus ?? task.runStatus ?? null;
  const headerStatusLabel =
    headerRunStatus === "failed"
      ? "已失败"
      : headerRunStatus === "paused"
        ? "已暂停"
        : headerRunStatus === "awaiting_preview"
          ? "等你验收预览"
          : headerRunStatus === "awaiting_bind"
            ? "等你确认绑定"
            : headerRunStatus === "awaiting_home"
              ? "等你确认首页"
              : (TASK_STATUS_LABELS[task.status] ?? task.status);
  const headerStatusColor =
    headerRunStatus === "failed"
      ? "red"
      : headerRunStatus === "paused"
        ? "orange"
        : headerRunStatus === "awaiting_preview"
          ? "blue"
          : headerRunStatus === "awaiting_bind"
            ? "purple"
            : headerRunStatus === "awaiting_home"
              ? "cyan"
              : undefined;
  const isRunning =
    task.status === "active" &&
    runStatus !== "failed" &&
    runStatus !== "paused" &&
    runStatus !== "completed" &&
    runStatus !== "cancelled" &&
    runStatus !== "awaiting_preview" &&
    runStatus !== "awaiting_bind" &&
    runStatus !== "awaiting_home";
  const failedStepIndex = checklist.findIndex(
    (it) => stepState(it.status) === "failed",
  );
  const currentStepIndex = isRunning
    ? checklist.findIndex((it) => stepState(it.status) === "pending")
    : -1;
  // 默认展开：失败步骤优先（看错误），否则当前执行步骤；手动
  // 展开收起优先于默认，轮询重拉不打掉手动选择；切任务清零。
  const defaultExpandedIndex =
    failedStepIndex >= 0 ? failedStepIndex : currentStepIndex;
  const [expandedOverride, setExpandedOverride] = useState<
    Record<number, boolean>
  >({});
  useEffect(() => {
    setExpandedOverride({});
  }, [task.id]);
  const isStepExpanded = (i: number) =>
    expandedOverride[i] ?? (i === defaultExpandedIndex);
  const toggleStep = (i: number) =>
    setExpandedOverride((prev) => ({ ...prev, [i]: !isStepExpanded(i) }));

  /** 执行动作（当前步骤展开区）：在跑的节点 + 最新报告流程，均去时间。 */
  const runningNodes = (runDetail?.nodes ?? []).filter(
    (n) => n.status === "active" || n.status === "running",
  );
  const failedNodes = (runDetail?.nodes ?? []).filter(
    (n) => n.status === "failed",
  );
  const latestTimeline = (runDetail?.timeline ?? []).slice(-5);
  const latestFailedVerdict = (runDetail?.verdicts ?? []).find(
    (v) => v.verdict === "fail",
  );
  /**
   * 第二批（确认门）：某步骤对应的执行节点（按 nodeKind 匹配）。
   * 步骤展开区优先显示本步骤的节点动作（状态／尝试／错误／产物），
   * 而不是只在当前步骤下堆全部在跑节点；无 nodeKind 的旧步骤回落
   * 原口径（当前步骤看在跑节点＋时间线）。
   */
  const stepNodes = (i: number) => {
    const nk = checklist[i]?.nodeKind;
    if (!nk) return [];
    return (runDetail?.nodes ?? []).filter((n) => n.kind === nk);
  };
  /** 某行是否可展开：当前步骤、失败步骤（有错误可看）、已完成
   *  步骤（有证据可看）才给展开；其余只显示标题。 */
  const stepExpandable = (i: number): boolean => {
    if (stepNodes(i).length > 0) return true;
    const st = stepState(checklist[i].status);
    if (i === currentStepIndex) return true;
    if (st === "failed")
      return (
        failedNodes.length > 0 ||
        (latestFailedVerdict?.acceptanceGaps.length ?? 0) > 0
      );
    if (st === "passed")
      return (
        typeof checklist[i].evidence === "string" &&
        checklist[i].evidence.length > 0
      );
    return false;
  };
  /** 全部完成行：任务已关闭，或清单全过且 run 已完成；终审结论并入。 */
  const taskDone = task.status === "done" || task.status === "closed";
  const showDoneRow =
    taskDone ||
    (checklist.length > 0 &&
      checklist.every((it) => stepState(it.status) === "passed") &&
      runStatus === "completed");
  const doneVerdictText =
    runDetail?.latestVerdict === "pass"
      ? "（终审已通过）"
      : runDetail?.latestVerdict === "fail"
        ? "（终审未通过）"
        : "";
  /** 预览卡与绑定卡不在此显示；只留暂停 / 终审未达标行。第三批：首页卡同理只在对话框。 */
  const otherPendings = (runDetail?.pendingItems ?? []).filter(
    (p) => p.type !== "theme-preview" && p.type !== "theme-bind" && p.type !== "theme-home",
  );

  /** 步骤状态圆点：等待灰、执行中蓝闪、完成绿、失败红；当前步骤不再用转圈动画（对话框外已有执行动画）。 */
  const stepIcon = (st: StepState, isCurrent: boolean, i: number) => {
    if (st === "passed") return <StatusDot status="completed" />;
    if (st === "failed") return <StatusDot status="failed" />;
    if (isCurrent) {
      const nodes = stepNodes(i);
      const running =
        nodes.length > 0
          ? nodes.some((n) => n.status === "active" || n.status === "running")
          : runningNodes.length > 0;
      return <StatusDot status={running ? "running" : "waiting"} />;
    }
    return <StatusDot status="waiting" />;
  };
  return (
    <div
      ref={rootRef}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Typography.Text
          style={{ fontSize: 13, flex: 1 }}
          ellipsis
          title={task.title}
        >
          {task.title}
        </Typography.Text>
        {task.kind && (
          <Tag style={{ marginInlineEnd: 0 }}>
            {TASK_KIND_LABELS[task.kind] ?? task.kind}
          </Tag>
        )}
        <Tag style={{ marginInlineEnd: 0 }} color={headerStatusColor}>
          {headerStatusLabel}
        </Tag>
      </div>
      {task.goal && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          目标：{task.goal}
        </Typography.Text>
      )}
      {themeLine && (
        <Typography.Text style={{ fontSize: 12 }}>{themeLine}</Typography.Text>
      )}
      {checklist.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 4,
          }}
        >
          {checklist.map((it, i) => {
            const st = stepState(it.status);
            const isCurrent = i === currentStepIndex;
            const expanded = isStepExpanded(i);
            const expandable = stepExpandable(i);
            // 第二批：本步骤的节点动作（有 nodeKind 匹配时优先），
            // 无匹配时当前步骤回落全部在跑节点，其他步骤无动作。
            const nodesForStep =
              stepNodes(i).length > 0
                ? stepNodes(i)
                : isCurrent
                  ? runningNodes
                  : [];
            const evidenceUrl =
              typeof it.evidence === "string" &&
              /^https?:\/\//.test(it.evidence)
                ? it.evidence
                : null;
            return (
              <div key={i} style={{ fontSize: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: expandable ? "pointer" : undefined,
                  }}
                  onClick={expandable ? () => toggleStep(i) : undefined}
                >
                  {stepIcon(st, isCurrent, i)}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textDecoration:
                        st === "skipped" ? "line-through" : undefined,
                      color: st === "failed" ? "#ff4d4f" : undefined,
                    }}
                  >
                    {it.label}
                  </span>
                  {expandable && (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12, flexShrink: 0 }}
                    >
                      {expanded ? "收起" : "展开"}
                    </Typography.Text>
                  )}
                </div>
                {expanded && (isCurrent || nodesForStep.length > 0) && (
                  <div
                    style={{
                      marginLeft: 22,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      wordBreak: "break-word",
                    }}
                  >
                    {nodesForStep.map((n) => (
                      <div key={n.nodeId}>
                        <div>
                          {n.nodeId}（
                          {NODE_STATUS_LABELS[n.status] ?? n.status}，尝试{" "}
                          {n.attempts} 次）
                        </div>
                        {n.error && (
                          <Typography.Text
                            type="danger"
                            style={{
                              fontSize: 12,
                              display: "block",
                              wordBreak: "break-word",
                            }}
                          >
                            {n.error}
                          </Typography.Text>
                        )}
                        {n.outputArtifacts.length > 0 && (
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontSize: 12,
                              display: "block",
                              wordBreak: "break-word",
                            }}
                          >
                            产物：{n.outputArtifacts.join("、")}
                          </Typography.Text>
                        )}
                      </div>
                    ))}
                    {isCurrent &&
                      latestTimeline.map((e, j) => (
                        <div key={j} style={{ wordBreak: "break-word" }}>
                          {e.summary}
                        </div>
                      ))}
                    {isCurrent &&
                      nodesForStep.length === 0 &&
                      latestTimeline.length === 0 && (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12 }}
                        >
                          正在执行…
                        </Typography.Text>
                      )}
                  </div>
                )}
                {expanded && !isCurrent && st === "failed" && (
                  <div
                    style={{
                      marginLeft: 22,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      wordBreak: "break-word",
                    }}
                  >
                    {failedNodes.map((n) => (
                      <div key={n.nodeId}>
                        <div>{n.nodeId}</div>
                        {n.error && (
                          <Typography.Text
                            type="danger"
                            style={{
                              fontSize: 12,
                              display: "block",
                              wordBreak: "break-word",
                            }}
                          >
                            {n.error}
                          </Typography.Text>
                        )}
                      </div>
                    ))}
                    {(latestFailedVerdict?.acceptanceGaps.length ?? 0) >
                      0 && (
                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          display: "block",
                          wordBreak: "break-word",
                        }}
                      >
                        缺口：
                        {latestFailedVerdict?.acceptanceGaps.join("；")}
                      </Typography.Text>
                    )}
                  </div>
                )}
                {expanded && !isCurrent && st === "passed" && it.evidence && (
                  <div style={{ marginLeft: 22, marginTop: 4 }}>
                    {evidenceUrl ? (
                      <a
                        href={evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12 }}
                      >
                        证据
                      </a>
                    ) : (
                      <Typography.Text
                        type="secondary"
                        style={{
                          fontSize: 12,
                          display: "block",
                          wordBreak: "break-word",
                        }}
                      >
                        {typeof it.evidence === "string" ? it.evidence : ""}
                      </Typography.Text>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {showDoneRow && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid #52c41a",
                  color: "#52c41a",
                  fontSize: 10,
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
              <span>执行完成{doneVerdictText}</span>
            </div>
          )}
        </div>
      )}

      {runLoading && (
        <div style={{ padding: "8px 0" }}>
          <Spin size="small" />
        </div>
      )}
      {otherPendings.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 8,
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            待决事项
          </Typography.Text>
          {otherPendings.map((p, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                {p.type === "pause"
                  ? PAUSE_REASON_LABELS[p.reason ?? ""] ?? "等你处理"
                  : "终审未达标"}
                {p.type === "pause" && p.detail ? `（${p.detail}）` : ""}
                {p.type === "pause" &&
                  p.recoveryActions.length > 0 &&
                  `（可处置：${p.recoveryActions.map((a) => RECOVERY_ACTION_LABELS[a] ?? a).join("、")}）`}
                {p.type === "critic" &&
                  p.gaps.length > 0 &&
                  `：${p.gaps.join("；")}`}
              </span>
              {p.type === "pause" &&
                runDetail?.run?.runStatus === "paused" && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    loading={acting === "resume"}
                    disabled={acting !== null}
                    onClick={() => void runAction("resume")}
                  >
                    继续运行
                  </Button>
                )}
              {p.type === "pause" &&
                runDetail?.run?.runStatus === "paused" &&
                p.recoveryActions.includes("retry-nodes") && (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    loading={acting === "retry-nodes"}
                    disabled={acting !== null}
                    onClick={() => void runAction("retry-nodes")}
                  >
                    重试失败节点
                  </Button>
                )}
              {onHandlePending && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: "auto", fontSize: 12 }}
                  onClick={onHandlePending}
                >
                  去处理
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {footer && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>{footer}</div>
      )}

    </div>
  );
}
