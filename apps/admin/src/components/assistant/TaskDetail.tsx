import {
  humanizeNodeName,
  humanizeStepLabel,
  humanizeTaskTitle,
  humanizeTechnicalDetail,
  humanizeTimelineSummary,
  summarizeArtifactFiles,
} from "./semanticLabels";
/**
 * 任务执行轨迹框（工作台右栏每任务一只框，与任务记录页抽屉共用）：
 * 详情只显示、不操作——框内是本任务的执行轨迹，与「执行过程」
 * 同一只框（StepsBox）：标题行 = 任务名 + 共 N 个执行动作 + 种
 * 类标 + 状态标 + 展开/收起。框内只显示任务执行动作，按执行
 * 时序从上往下排列（2026-11-16 用户定）。
 * 计划任务：每一步一只框（2026-11-16 用户定：计划任务中规划的
 * 步骤就是一个框），框里是这一步具体执行了哪些动作（自然语言，
 * 不出现程序化描述），哪一步报错就写在哪一步；执行到哪一步就显
 * 示哪一步的框，已完成的不隐藏，未执行到的不显示；步骤按计划顺
 * 序（即执行顺序）从上往下排，框内动作按创建时间排；无动作的步
 * 骤只显一条结果说明（清单 evidence）。框内动作与完成记录放平
 * （同级行，各带时间，不再一上一下嵌套）。这不是计划清单的重
 * 复——框的标题是步骤名，内容是动作；计划清单本身只在对话框计
 * 划卡里。
 * 非计划任务、或无 phase 的节点仍按创建顺序平铺；无归属的时间线
 * 事件按 seq 排在末尾。预览/绑定/首页确认卡只在对话框里，详情里
 * 不出现；详情里没有任何按钮——继续运行、重试、去处理等操作一律
 * 走对话框，详情不给入口。底部不放时间与继续入口（详情只展示，
 * 操作走对话框）。
 */
import { useEffect, useRef, useState } from "react";
import { Badge, Spin, Tag, Typography } from "antd";
import { tokens } from "@lcdp/ui";
import StepsBox from "./StepsBox";
import {
  api,
  type AdminAssistantTask,
  type AdminTaskRunDetail,
  type AdminTaskRunNode,
  type AdminTaskRunTimelineEvent,
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
  "budget-exhausted": "单次调用达到上限",
  "script-failure": "设计步骤执行遇阻",
  "consecutive-failures": "多次尝试未成功",
  "home-gate-stalled": "等待首页风格确认",
};

/** 节点状态 → 圆点状态 */
function nodeDot(status: string): "waiting" | "running" | "completed" | "failed" {
  if (CHECK_FAILED.has(status)) return "failed";
  if (status === "active" || status === "running") return "running";
  if (CHECK_PASSED.has(status)) return "completed";
  return "waiting";
}

/** HH:MM:SS（24 小时制），与时间线事件同一口径。 */
function formatClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** 时间线事件去重：连续相同文案合并计数，保留最晚时间 */
function dedupeTimeline(
  events: AdminTaskRunTimelineEvent[],
  opts: { isRunning: boolean; lastEvent: AdminTaskRunTimelineEvent | null },
): { text: string; time: string | null; count: number }[] {
  const deduped: { text: string; time: string | null; count: number }[] = [];
  for (const ev of events) {
    const isLastAndRunning = opts.isRunning && ev === opts.lastEvent;
    const text = humanizeTimelineSummary(ev.summary, { isLastAndRunning });
    if (!text) continue;
    const time = formatClock(ev.createdAt);
    if (deduped.length > 0 && deduped[deduped.length - 1]!.text === text) {
      deduped[deduped.length - 1]!.count++;
      if (time) deduped[deduped.length - 1]!.time = time;
    } else {
      deduped.push({ text, time, count: 1 });
    }
  }
  return deduped;
}

export default function TaskDetail({
  task,
  appId,
  /** 受控展开态（工作台多框用）；不传则内部管理，默认展开 */
  expanded,
  onExpandedChange,
  /** 非受控时的默认折叠（工作台：非焦点任务默认收起） */
  defaultCollapsed = false,
}: {
  task: AdminAssistantTask;
  /** 传了且任务有 runId 时才取 run 详情（不传则不取数；传 null 走平台侧） */
  appId?: string | null;
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
  defaultCollapsed?: boolean;
}) {
  const [runDetail, setRunDetail] = useState<AdminTaskRunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runTick, setRunTick] = useState(0);
  // 收尾修复 7：已加载过的任务 id——周期刷新静默取数，不再闪加载动画。
  const loadedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (appId === undefined || !task.runId) {
      setRunDetail(null);
      return;
    }
    let alive = true;
    const first = loadedTaskRef.current !== task.id;
    if (first) setRunLoading(true);
    const runPromise =
      appId === null
        ? api.assistant.taskRun(task.id)
        : api.assistant.app.taskRun(appId, task.id);
    void runPromise
      .then((res) => {
        if (alive) setRunDetail(res);
      })
      .finally(() => {
        if (alive) {
          setRunLoading(false);
          loadedTaskRef.current = task.id;
        }
      });
    return () => {
      alive = false;
    };
  }, [appId, task.id, task.runId, runTick]);
  /**
   * 收尾修复 7（2026-11-02 18:41 重测实锤）：详情面板此前只在打开／
   * 切换时加载，执行中不刷新，与 20 秒轮询的计划卡节奏不一致、
   * 两边状态乱序。任务仍 active 时以 20 秒节奏静默刷新（与计划卡
   * 同节奏），刷新走 runTick 复用上条 effect，加载动画只在首载出现。
   */
  useEffect(() => {
    if (task.status !== "active" || appId === undefined || !task.runId) {
      return;
    }
    const id = window.setInterval(() => {
      setRunTick((t) => t + 1);
    }, 3_000);
    return () => window.clearInterval(id);
  }, [task.status, appId, task.runId]);
  /**
   * 2026-11-16 详情改版：右栏多只任务框并列，不再自动滚到底部
   * （多框时滚到底会抢走用户正在看的框）；最新内容由最新一只
   * 框默认展开呈现，点卡片查看详情时由工作台滚到对应框。
   */
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
  // 始终以服务端最新返回的 runDetail.task 为准，防止左侧计划卡已推进（1/5、3/5）而右侧仍滞后为 0/5
  const activeTask = runDetail?.task ?? task;
  /** 框折叠态（受控时由父级管；非受控默认展开，任务记录页抽屉即此态） */
  const [userBoxExpanded, setUserBoxExpanded] = useState<boolean | null>(null);
  const boxExpanded =
    expanded !== undefined ? expanded : (userBoxExpanded ?? !defaultCollapsed);
  const toggleBox = () => {
    const next = !boxExpanded;
    if (onExpandedChange) onExpandedChange(next);
    else setUserBoxExpanded(next);
  };

  const runStatus = runDetail?.run?.runStatus ?? null;
  /** 详情头状态跟 runStatus（收尾1）：等验收/等确认首页等态不再只显示“进行中”，与对话框卡角标同口径；run 详情未到时回落任务行 runStatus。 */
  const headerRunStatus = runStatus ?? activeTask.runStatus ?? null;
  /** C 批（状态口径统一）：审批前 run_status 为 null 时详情栏显示“待审批”，
   * 不许回落到 task.status 的“进行中”（与计划卡同口径，见 MessageTaskCards）。 */
  const headerStatusLabel =
    headerRunStatus === null
      ? "待审批"
      : headerRunStatus === "failed"
        ? "已失败"
        : headerRunStatus === "paused"
          ? "已暂停"
          : headerRunStatus === "awaiting_preview"
            ? "等你验收预览"
            : headerRunStatus === "awaiting_bind"
              ? "等你确认绑定"
              : headerRunStatus === "awaiting_home"
                ? "等你确认首页"
                : (TASK_STATUS_LABELS[activeTask.status] ?? activeTask.status);
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
  /** C 批（状态口径统一）：在跑必须由 run_status 正面确立（pending/running）。
   * 旧口径以 task.status === "active" 为主、runStatus 只做排除，run_status 为
   * null（审批前、run 未创建）时会漏网成“在跑”，首步误显“正在执行…”。
   * 用 headerRunStatus（含任务行 runStatus 回落），run 详情未到时也有口径。 */
  const isRunning =
    headerRunStatus === "pending" || headerRunStatus === "running";

  /** 执行轨迹：节点动作按执行顺序；时间线事件按 nodeId 挂到所属
   * 节点行下，无归属的按 seq 排在末尾。节点无时间戳，不做跨组
   * 混排——组内各自按序，组间节点在前、时间线在后。 */
  const nodes = runDetail?.nodes ?? [];
  const timeline = [...(runDetail?.timeline ?? [])].sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  const lastEvent = timeline.length > 0 ? timeline[timeline.length - 1]! : null;
  const eventsByNode = new Map<string, AdminTaskRunTimelineEvent[]>();
  const orphanEvents: AdminTaskRunTimelineEvent[] = [];
  for (const ev of timeline) {
    if (ev.nodeId && nodes.some((n) => n.nodeId === ev.nodeId)) {
      const arr = eventsByNode.get(ev.nodeId) ?? [];
      arr.push(ev);
      eventsByNode.set(ev.nodeId, arr);
    } else {
      orphanEvents.push(ev);
    }
  }
  const orphanRows = dedupeTimeline(orphanEvents, {
    isRunning,
    lastEvent,
  });
  const traceCount = nodes.length + orphanRows.length;
  /** 计划任务：节点按 phase=plan:<序号> 归属到计划步骤，每一步一只框；
   * 步骤按计划顺序（即执行顺序）从上往下排；无 phase 或序号越界的节点
   * 不分组，仍平铺在步骤框之后。 */
  const isPlanTask = activeTask.kind === "plan";
  const checklist = activeTask.checklist ?? [];
  const stepNodeMap = new Map<number, AdminTaskRunNode[]>();
  const ungroupedNodes: AdminTaskRunNode[] = [];
  for (const n of nodes) {
    const m = typeof n.phase === "string" ? n.phase.match(/^plan:(\d+)$/) : null;
    if (isPlanTask && m) {
      const idx = Number(m[1]);
      if (idx >= 0 && idx < checklist.length) {
        const arr = stepNodeMap.get(idx) ?? [];
        arr.push(n);
        stepNodeMap.set(idx, arr);
        continue;
      }
    }
    ungroupedNodes.push(n);
  }
  /** 步骤执行态：有失败动作 → 失败；有进行中 → 进行中；全完成 → 完成；
   * 无动作时看清单状态（done → 完成，failed → 失败，其余 → 等待）。 */
  const stepDot = (idx: number): "waiting" | "running" | "completed" | "failed" => {
    const ns = stepNodeMap.get(idx) ?? [];
    if (ns.some((n) => CHECK_FAILED.has(n.status))) return "failed";
    if (ns.some((n) => n.status === "active" || n.status === "running")) return "running";
    if (ns.length > 0 && ns.every((n) => CHECK_PASSED.has(n.status))) return "completed";
    const item = checklist[idx];
    if (item && CHECK_PASSED.has(item.status)) return "completed";
    if (item && CHECK_FAILED.has(item.status)) return "failed";
    return "waiting";
  };
  /** 步骤是否已执行到：有执行动作，或清单状态已离开待开始（进行中/
   * 已完成/已失败）。执行到哪一步就显示哪一步的框，已完成的不隐藏，
   * 未执行到的步骤（无动作且清单仍为 pending）不显示框。 */
  const isStepReached = (idx: number): boolean => {
    if ((stepNodeMap.get(idx) ?? []).length > 0) return true;
    const item = checklist[idx];
    return !!item && item.status !== "pending";
  };
  /** 节点行：动作与完成记录放平（同级行，各带时间）——动作行、错误/
   * 产物行、时间线事件行一律不缩进，不再一上一下嵌套（2026-11-16
   * 用户定：动作和完成记录放平）。 */
  const renderNode = (n: AdminTaskRunNode) => {
    const rawNodeEvents = eventsByNode.get(n.nodeId) ?? [];
    const nodeEvents = dedupeTimeline(rawNodeEvents, {
      isRunning,
      lastEvent,
    });
    // 动作行时间（2026-11-16 用户定：动作行也带时间）：取该动作最新一条
    // 时间线事件的时间（完成时即完成事件的时间，与其下完成记录同一口径）；
    // 无事件的动作（尚未开始）不显示时间。
    const lastRawEvent =
      rawNodeEvents.length > 0 ? rawNodeEvents[rawNodeEvents.length - 1]! : null;
    const nodeTime = formatClock(lastRawEvent?.createdAt);
    return (
      <div key={n.nodeId} style={{ fontSize: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <StatusDot status={nodeDot(n.status)} />
          {nodeTime && (
            <span
              style={{
                fontSize: 11,
                opacity: 0.6,
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {nodeTime}
            </span>
          )}
          <span
            style={{
              flex: 1,
              minWidth: 0,
              color:
                nodeDot(n.status) === "failed" ? "#ff4d4f" : undefined,
            }}
          >
            {humanizeNodeName(n.nodeId, n.kind)}
            {n.attempts > 1 ? "，正在优化调整" : ""}
          </span>
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
            {humanizeTechnicalDetail(n.error)}
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
            {summarizeArtifactFiles(n.outputArtifacts)}
          </Typography.Text>
        )}
        {nodeEvents.map((item, j) => (
          <div
            key={j}
            style={{
              fontSize: 12,
              color: tokens.colorTextSecondary,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 0",
              wordBreak: "break-word",
            }}
          >
            {/* 完成记录圆点与动作行 StatusDot 同宽 16（2026-11-16 补：旧版
             * 蓝点仅 8px 宽，动作行与完成记录的文字错开 8px、视觉上仍嵌套；
             * 此处与 StatusDot 同结构，圆点、时间、文字三者才真正对齐） */}
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
              <span style={{ color: "#1677ff", fontSize: 8, lineHeight: 1 }}>●</span>
            </span>
            {item.time && (
              <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                {item.time}
              </span>
            )}
            <span style={{ flex: 1 }}>{item.text}</span>
            {item.count > 1 && (
              <Tag style={{ margin: 0, fontSize: 10, padding: "0 4px", lineHeight: "16px" }}>
                x{item.count}
              </Tag>
            )}
          </div>
        ))}
      </div>
    );
  };
  /** 计划步骤框：只显示已执行到的步骤（未执行到的不显示，已完成的
   * 不隐藏）；标题 = 步骤名（自然语言）+ 执行态圆点；框里是这一步
   * 的执行动作（按创建时间排）；无动作的步骤只显一条结果说明。 */
  const renderStepBox = (idx: number) => {
    const item = checklist[idx];
    if (!item) return null;
    // 执行到哪一步就显示哪一步的框（2026-11-16 用户定）；未执行到
    // 的步骤不显示框，已完成的不隐藏。
    if (!isStepReached(idx)) return null;
    const stepNodes = stepNodeMap.get(idx) ?? [];
    const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    return (
      <div
        key={idx}
        style={{
          border: `1px solid ${tokens.colorBorder}`,
          borderRadius: 8,
          padding: "8px 10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <StatusDot status={stepDot(idx)} />
          <span style={{ flex: 1, minWidth: 0 }}>{humanizeStepLabel(item.label)}</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            marginTop: 4,
            paddingLeft: 22,
          }}
        >
          {stepNodes.map(renderNode)}
          {stepNodes.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {evidence ? humanizeStepLabel(evidence) : "暂无执行记录"}
            </Typography.Text>
          )}
        </div>
      </div>
    );
  };
  const runningNodes = nodes.filter(
    (n) => n.status === "active" || n.status === "running",
  );
  const latestFailedVerdict = (runDetail?.verdicts ?? []).find(
    (v) => v.verdict === "fail",
  );
  /** 全部完成行：任务已关闭，或 run 已完成；终审结论并入。 */
  const taskDone = activeTask.status === "done" || activeTask.status === "closed";
  const showDoneRow = taskDone || runStatus === "completed";
  const doneVerdictText =
    runDetail?.latestVerdict === "pass"
      ? "（终审已通过）"
      : runDetail?.latestVerdict === "fail"
        ? "（终审未通过）"
        : "";
  /** 预览卡与绑定卡不在此显示；只留暂停 / 终审未达标行（纯展示，无按钮、无处置入口，处置走对话框）。 */
  const otherPendings = (runDetail?.pendingItems ?? []).filter(
    (p) => p.type !== "theme-preview" && p.type !== "theme-bind" && p.type !== "theme-home",
  );
  const hasTrace =
    nodes.length > 0 || timeline.length > 0 || otherPendings.length > 0;

  const headerText = `${humanizeTaskTitle(activeTask.title)}${
    traceCount > 0 ? ` · 共 ${traceCount} 个执行动作` : ""
  }`;
  return (
    <StepsBox
      header={
        <>
          <div
            onClick={toggleBox}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <Typography.Text
              ellipsis
              style={{ fontSize: 12, flex: 1, minWidth: 0 }}
              title={headerText}
            >
              {headerText}
            </Typography.Text>
            <span
              style={{
                marginLeft: 8,
                color: tokens.colorPrimary,
                flexShrink: 0,
              }}
            >
              {boxExpanded ? "收起" : "展开"}
            </span>
          </div>
          {activeTask.kind && (
            <Tag style={{ marginInlineEnd: 0 }}>
              {TASK_KIND_LABELS[activeTask.kind] ?? activeTask.kind}
            </Tag>
          )}
          <Tag style={{ marginInlineEnd: 0 }} color={headerStatusColor}>
            {headerStatusLabel}
          </Tag>
        </>
      }
    >
      {boxExpanded && (
        <>
          {runLoading && (
            <div style={{ padding: "8px 0" }}>
              <Spin size="small" />
            </div>
          )}
          {!runLoading && !hasTrace && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              暂无执行记录
            </Typography.Text>
          )}
          {isPlanTask && checklist.length > 0 && nodes.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 4,
              }}
            >
              {checklist.map((_it, idx) => renderStepBox(idx))}
              {ungroupedNodes.map(renderNode)}
            </div>
          ) : (
            nodes.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginTop: 4,
                }}
              >
                {nodes.map(renderNode)}
              </div>
            )
          )}
          {orphanRows.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 4,
              }}
            >
              {orphanRows.map((item, j) => (
                <div
                  key={j}
                  style={{
                    fontSize: 12,
                    color: tokens.colorTextSecondary,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 0",
                    wordBreak: "break-word",
                  }}
                >
                  {/* 圆点与 StatusDot 同宽 16，见 renderNode 处注释 */}
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
                    <span style={{ color: "#1677ff", fontSize: 8, lineHeight: 1 }}>●</span>
                  </span>
                  {item.time && (
                    <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                      {item.time}
                    </span>
                  )}
                  <span style={{ flex: 1 }}>{item.text}</span>
                  {item.count > 1 && (
                    <Tag style={{ margin: 0, fontSize: 10, padding: "0 4px", lineHeight: "16px" }}>
                      x{item.count}
                    </Tag>
                  )}
                </div>
              ))}
            </div>
          )}
          {isRunning && runningNodes.length === 0 && timeline.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              正在执行…
            </Typography.Text>
          )}
          {showDoneRow && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                marginTop: 4,
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
          {(latestFailedVerdict?.acceptanceGaps.length ?? 0) > 0 && (
            <Typography.Text
              type="secondary"
              style={{
                fontSize: 12,
                display: "block",
                wordBreak: "break-word",
                marginTop: 4,
              }}
            >
              待完善项：
              {latestFailedVerdict?.acceptanceGaps
                .map(humanizeTechnicalDetail)
                .join("；")}
            </Typography.Text>
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
                <div key={i} style={{ fontSize: 12 }}>
                  {p.type === "pause"
                    ? (PAUSE_REASON_LABELS[p.reason ?? ""] ?? "等你处理")
                    : "终审未达标"}
                  {p.type === "pause" && p.detail
                    ? `（${humanizeTechnicalDetail(p.detail)}）`
                    : ""}
                  {p.type === "critic" &&
                    p.gaps.length > 0 &&
                    `：${p.gaps.map(humanizeTechnicalDetail).join("；")}`}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </StepsBox>
  );
}
