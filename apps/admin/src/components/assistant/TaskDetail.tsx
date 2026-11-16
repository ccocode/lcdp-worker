import {
  humanizeNodeName,
  humanizeOpsCopy,
  humanizeStepLabel,
  humanizeTaskTitle,
  humanizeTechnicalDetail,
  humanizeTimelineSummary,
  humanizeToolName,
  humanizeToolSummary,
  summarizeArtifactFiles,
} from "./semanticLabels";
/**
 * 任务执行轨迹（工作台右栏每任务一段，与任务记录页抽屉共用）：
 * 详情只显示、不操作——这里是本任务的执行轨迹。计划标题不列在
 * 详情里（2026-11-16 用户定）：任务头（标题 + 种类 + 状态 +
 * 收起/展开）整个去掉，步骤框直接顶格平铺、内容始终展开；
 * 计划本身只在对话框计划卡里。详情只放执行（2026-11-16 用户定，
 * 详情数据模型定稿）：①有执行动作的计划步骤，一步一只框，框里是
 * 这一步具体执行了哪些动作（自然语言，不出现程序化描述），哪一步
 * 报错就写在哪一步；②不属于任何步骤的时间线事件（任务创建、开始
 * 执行、收尾消息等）作无边框行，与步骤框按时间从上往下混排；
 * ③执行完成行、待决事项。没有执行动作的步骤不在详情里占位
 * （其完成状态在计划卡里），不放证据文案作填充。步骤框内只显示
 * 任务执行动作，按执行时序从上往下排列（2026-11-16 用户定）。
 * 计划任务：每一步一只框（2026-11-16 用户定：计划任务中规划的
 * 步骤就是一个框），框里是这一步具体执行了哪些动作（自然语言，
 * 不出现程序化描述），哪一步报错就写在哪一步；执行到哪一步就显
 * 示哪一步的框，已完成的不隐藏，未执行到的不显示；步骤按计划顺
 * 序（即执行顺序）从上往下排，框内动作按创建时间排；无动作的步
 * 骤不在详情里占位。这不是计划清单的重
 * 复——框的标题是步骤名，内容是动作；计划清单本身只在对话框计
 * 划卡里。
 * 非计划任务：全部节点动作归入一只盒子（标题 = 任务名）。
 * 子代理派发：每个派发一只盒子（标题 = 派发步骤名/目标，内含子
 * 代理的执行步骤动作行），按时间与父任务的盒子混排。
 * 无归属的时间线事件作无边框行，按时间混排。预览/绑定/首页确认卡只在对话框里，详情里
 * 不出现；详情里没有任何按钮——继续运行、重试、去处理等操作一律
 * 走对话框，详情不给入口。底部不放时间与继续入口（详情只展示，
 * 操作走对话框）。
 */
import { useEffect, useRef, useState } from "react";
import { Spin, Typography } from "antd";
import {
  api,
  type AdminAssistantMessage,
  type AdminAssistantTask,
  type AdminAssistantToolCall,
  type AdminTaskRunDetail,
  type AdminTaskRunNode,
  type AdminTaskRunTimelineEvent,
} from "../../api";
import {
  DetailActionRow,
  DetailBox,
  DetailPlainRow,
  formatClock,
  type DetailStatus,
} from "./DetailBox";
import {
  effectiveStepStatus,
  turnStepsOf,
  type TurnStep,
} from "./turnSteps";

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
/** 时间线事件去重：连续相同文案合并计数，保留最晚时间 */
function dedupeTimeline(
  events: AdminTaskRunTimelineEvent[],
  opts: { isRunning: boolean; lastEvent: AdminTaskRunTimelineEvent | null },
): { text: string; time: string | null; count: number; ts: number | null }[] {
  const deduped: { text: string; time: string | null; count: number; ts: number | null }[] = [];
  for (const ev of events) {
    const isLastAndRunning = opts.isRunning && ev === opts.lastEvent;
    const text = humanizeTimelineSummary(ev.summary, { isLastAndRunning });
    if (!text) continue;
    const time = formatClock(ev.createdAt);
    const ts = ev.createdAt ? Date.parse(ev.createdAt) : NaN;
    const tsVal = Number.isNaN(ts) ? null : ts;
    if (deduped.length > 0 && deduped[deduped.length - 1]!.text === text) {
      deduped[deduped.length - 1]!.count++;
      if (time) deduped[deduped.length - 1]!.time = time;
      if (tsVal !== null) deduped[deduped.length - 1]!.ts = tsVal;
    } else {
      deduped.push({ text, time, count: 1, ts: tsVal });
    }
  }
  return deduped;
}

export default function TaskDetail({
  task,
  appId,
}: {
  task: AdminAssistantTask;
  /** 传了且任务有 runId 时才取 run 详情（不传则不取数；传 null 走平台侧） */
  appId?: string | null;
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
  const runStatus = runDetail?.run?.runStatus ?? null;

  /** 子代理派发（2026-11-16 统一详情格式）：派发记在任务行
   * artifacts.delegations[]（后端第 103 步步骤 5），每条带
   * childConversationId。子代理的执行步骤此前只在点开派发卡才见
   * DelegationDetail、从未进任务详情——此处把它取出来，在父任务
   * 详情里按时间混排成一只盒子。 */
  interface DelegationLike {
    childConversationId: string;
    stepLabel?: string;
    goal?: string;
    status?: string;
  }
  const delegations: DelegationLike[] = (() => {
    const a = activeTask.artifacts as { delegations?: unknown } | null | undefined;
    const list = a?.delegations;
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (d): d is DelegationLike =>
          !!d && typeof d === "object" && typeof (d as DelegationLike).childConversationId === "string",
      )
      .map((d) => ({
        childConversationId: d.childConversationId,
        stepLabel: typeof d.stepLabel === "string" ? d.stepLabel : undefined,
        goal: typeof d.goal === "string" ? d.goal : undefined,
        status: typeof d.status === "string" ? d.status : undefined,
      }));
  })();
  const delegationIdsKey = delegations.map((d) => d.childConversationId).join(",");
  const [delegationSteps, setDelegationSteps] = useState<
    Record<string, { steps: TurnStep[]; failed: boolean }>
  >({});
  useEffect(() => {
    if (delegationIdsKey === "") {
      setDelegationSteps({});
      return;
    }
    let alive = true;
    (async () => {
      const ids = delegationIdsKey.split(",");
      const next: Record<string, { steps: TurnStep[]; failed: boolean }> = {};
      await Promise.all(
        ids.map(async (cid) => {
          try {
            const detail =
              appId === null
                ? await api.assistant.conversation(cid)
                : await api.assistant.app.conversation(appId ?? "", cid);
            const steps = (detail.messages ?? []).flatMap((m: AdminAssistantMessage) =>
              turnStepsOf(m, detail.toolCalls ?? []),
            );
            steps.sort((a, b) => {
              const ta = a.startedAt ? Date.parse(a.startedAt) : null;
              const tb = b.startedAt ? Date.parse(b.startedAt) : null;
              if (ta !== null && tb !== null && ta !== tb) return ta - tb;
              if (ta !== null && tb === null) return -1;
              if (ta === null && tb !== null) return 1;
              return 0;
            });
            next[cid] = { steps, failed: false };
          } catch {
            next[cid] = { steps: [], failed: true };
          }
        }),
      );
      if (alive) setDelegationSteps(next);
    })();
    return () => {
      alive = false;
    };
    // 派发集合变化时重取（子会话 id 集作 key）；appId 变化时重取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, delegationIdsKey]);
  /** 详情头状态跟 runStatus（收尾1）：等验收/等确认首页等态不再只显示“进行中”，与对话框卡角标同口径；run 详情未到时回落任务行 runStatus。 */
  const headerRunStatus = runStatus ?? activeTask.runStatus ?? null;
  /** C 批（状态口径统一）：在跑必须由 run_status 正面确立（pending/running）。
   * 旧口径以 task.status === "active" 为主、runStatus 只做排除，run_status 为
   * null（审批前、run 未创建）时会漏网成“在跑”，首步误显“正在执行…”。
   * 用 headerRunStatus（含任务行 runStatus 回落），run 详情未到时也有口径。 */
  const isRunning =
    headerRunStatus === "pending" || headerRunStatus === "running";

  /** 执行轨迹：节点动作按执行顺序；时间线事件按 nodeId 挂到所属
   * 节点行下。无归属的生命周期事件（任务已创建、开始执行、收尾
   * 消息等）不在详情里展示——2026-11-16 用户定：它们在对话框
   * 加载动画处实时显示，加载动画消失时一并隐藏。节点无时间戳，
   * 不做跨组混排——组内各自按序，组间节点在前、时间线在后。 */
  const nodes = runDetail?.nodes ?? [];
  const timeline = [...(runDetail?.timeline ?? [])].sort(
    (a, b) => (a.seq ?? 0) - (b.seq ?? 0),
  );
  const lastEvent = timeline.length > 0 ? timeline[timeline.length - 1]! : null;
  const eventsByNode = new Map<string, AdminTaskRunTimelineEvent[]>();
  for (const ev of timeline) {
    if (ev.nodeId && nodes.some((n) => n.nodeId === ev.nodeId)) {
      const arr = eventsByNode.get(ev.nodeId) ?? [];
      arr.push(ev);
      eventsByNode.set(ev.nodeId, arr);
    }
    // 无归属事件直接丢弃（不在详情里占位）。
  }
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
  /** 详情按时间从上往下排（2026-11-16 用户定：20:57 的记录不许排到
   * 20:58 的步骤框后面）：步骤框/节点的排序时间取其事件的最早时间；
   * 无事件的沿用上一项的时间，保证仍按计划顺序排、不乱序。 */
  const eventTs = (ev: AdminTaskRunTimelineEvent): number | null => {
    if (!ev.createdAt) return null;
    const t = Date.parse(ev.createdAt);
    return Number.isNaN(t) ? null : t;
  };
  const stepBoxTs = (idx: number): number | null => {
    let min: number | null = null;
    for (const n of stepNodeMap.get(idx) ?? []) {
      for (const ev of eventsByNode.get(n.nodeId) ?? []) {
        const t = eventTs(ev);
        if (t !== null && (min === null || t < min)) min = t;
      }
    }
    return min;
  };
  const nodeTs = (n: AdminTaskRunNode): number | null => {
    let min: number | null = null;
    for (const ev of eventsByNode.get(n.nodeId) ?? []) {
      const t = eventTs(ev);
      if (t !== null && (min === null || t < min)) min = t;
    }
    return min;
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
    // 报错只在节点真正失败时才红字跟在动作行下方（2026-11-16 用户
    // 定）：重试中的节点（网关 503 等瞬时错、attempts>1）只显示
    // 「正在优化调整」与时间线里的「本阶段生成遇阻」，不把上一次
    // 尝试的原始报错顶在动作最上面——否则一个还没失败的节点顶着
    // 一行红字，夹在执行动作中间，看着像已经失败了。
    const nodeFailed = CHECK_FAILED.has(n.status);
    return (
      <div key={n.nodeId} style={{ fontSize: 12 }}>
        <DetailActionRow
          time={nodeTime}
          status={nodeDot(n.status)}
          error={nodeFailed && n.error ? humanizeTechnicalDetail(n.error) : null}
        >
          {humanizeNodeName(n.nodeId, n.kind)}
          {n.attempts > 1 ? "，正在优化调整" : ""}
        </DetailActionRow>
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
          <DetailPlainRow key={j} time={item.time} count={item.count}>
            {item.text}
          </DetailPlainRow>
        ))}
      </div>
    );
  };
  /** 计划步骤框：只显示已执行到的步骤（未执行到的不显示，已完成的
   * 不隐藏）；标题 = 步骤名（自然语言）+ 执行态圆点；框里是这一步
   * 的执行动作（按创建时间排）。 */
  const renderStepBox = (idx: number) => {
    const item = checklist[idx];
    if (!item) return null;
    // 执行到哪一步就显示哪一步的框（2026-11-16 用户定）；未执行到
    // 的步骤不显示框，已完成的不隐藏。
    if (!isStepReached(idx)) return null;
    const stepNodes = stepNodeMap.get(idx) ?? [];
    return (
      <DetailBox
        key={idx}
        title={humanizeStepLabel(item.label)}
        status={stepDot(idx)}
      >
        {stepNodes.map(renderNode)}
      </DetailBox>
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
  /** 预览卡与绑定卡不在此显示；只留暂停 / 终审未达标行（纯展示，无按钮、无处置入口，处置走对话框）。 */
  const otherPendings = (runDetail?.pendingItems ?? []).filter(
    (p) => p.type !== "theme-preview" && p.type !== "theme-bind" && p.type !== "theme-home",
  );
  const hasTrace =
    nodes.length > 0 || timeline.length > 0 || otherPendings.length > 0;

  /** 详情块按时间从上往下排（2026-11-16 用户定）：步骤框、无归属节点
   * 按各自最早时间合并排序。无归属的生命周期行已不再进详情（见上）。 */
  const detailBlocks: { ts: number; order: number; el: React.ReactNode }[] = [];
  {
    let order = 0;
    let lastTs = 0;
    const push = (ts: number | null, el: React.ReactNode) => {
      const t = ts ?? lastTs;
      lastTs = t;
      detailBlocks.push({ ts: t, order: order++, el });
    };
    if (isPlanTask && checklist.length > 0 && nodes.length > 0) {
      for (let idx = 0; idx < checklist.length; idx++) {
        if (!isStepReached(idx)) continue;
        // 详情只放执行（2026-11-16 用户定）：没有执行动作的步骤不在
        // 详情里占位——它的完成状态在对话框计划卡里，不必另开一只空框
        // 只放一句证据文案。计划 6 步、执行只 4 个阶段（梳理/匹配/
        // 生成/签发），「首页确认」「完成其余页面编排」两步的活本就记
        // 在「生成主题方案」节点下，单开空框等于重复占位。
        if ((stepNodeMap.get(idx) ?? []).length === 0) continue;
        push(stepBoxTs(idx), renderStepBox(idx));
      }
      for (const n of ungroupedNodes) push(nodeTs(n), renderNode(n));
    } else if (nodes.length > 0) {
      // 非计划任务（2026-11-16 统一详情格式）：全部节点动作归入一
      // 只盒子（标题 = 任务名），与其他类型同格式，不再裸铺节点。
      const nonPlanStatus: DetailStatus = nodes.some(
        (n) => nodeDot(n.status) === "failed",
      )
        ? "failed"
        : runningNodes.length > 0 || isRunning
          ? "running"
          : showDoneRow
            ? "completed"
            : "waiting";
      const nonPlanTs = nodes.reduce<number | null>((min, n) => {
        const t = nodeTs(n);
        return t !== null && (min === null || t < min) ? t : min;
      }, null);
      push(
        nonPlanTs,
        <DetailBox
          key="nonplan"
          title={humanizeTaskTitle(activeTask.title)}
          status={nonPlanStatus}
        >
          {nodes.map(renderNode)}
        </DetailBox>,
      );
    }
    // 子代理派发盒（2026-11-16 统一详情格式）：每个派发一只盒子，
    // 标题 = 派发步骤名/目标，内含子代理的执行步骤动作行，按时间与
    // 父任务的盒子混排。子会话尚未取到、或无步骤时不占位。
    for (const d of delegations) {
      const entry = delegationSteps[d.childConversationId];
      if (!entry) continue;
      const steps = entry.steps;
      if (!entry.failed && steps.length === 0) continue;
      const firstTs =
        steps.length > 0 && steps[0]!.startedAt
          ? Date.parse(steps[0]!.startedAt)
          : null;
      const depTitle = d.stepLabel
        ? humanizeOpsCopy(d.stepLabel)
        : d.goal
          ? humanizeOpsCopy(d.goal)
          : "子代理执行";
      const depStatus: DetailStatus =
        d.status === "failed"
          ? "failed"
          : d.status === "done"
            ? "completed"
            : d.status === "running"
              ? "running"
              : "waiting";
      push(
        Number.isNaN(firstTs) ? null : firstTs,
        <DetailBox
          key={`delegation-${d.childConversationId}`}
          title={depTitle}
          status={depStatus}
          secondary="子代理"
        >
          {entry.failed ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              子代理执行记录暂不可用
            </Typography.Text>
          ) : (
            steps.map((s) => {
              const st = effectiveStepStatus(s, false);
              const dotStatus: DetailStatus =
                st === "running"
                  ? "running"
                  : st === "done"
                    ? "completed"
                    : st === "failed"
                      ? "failed"
                      : "waiting";
              const toolText = humanizeToolName(s.tool);
              const summaryText = humanizeToolSummary(s.tool, s.summary);
              return (
                <DetailActionRow
                  key={s.id}
                  time={formatClock(s.startedAt)}
                  status={dotStatus}
                  error={st === "failed" && s.result ? s.result : null}
                >
                  {summaryText ? `${toolText}：${summaryText}` : toolText}
                </DetailActionRow>
              );
            })
          )}
        </DetailBox>,
      );
    }
    // 2026-11-16 用户定：无归属的生命周期行（任务已创建、开始执行、
    // 收尾消息等）不进详情——详情只放执行盒子；生命周期状态在对话框
    // 加载动画处实时显示、动态刷新。故此处不再把 orphanRows 推入
    // detailBlocks。
    detailBlocks.sort((a, b) => a.ts - b.ts || a.order - b.order);
  }

  return (
    // 详情只放执行内容（2026-11-16 用户定：计划标题不列在详情里）：
    // 任务头（标题 + 种类 + 状态 + 收起/展开）整个去掉，步骤框直接
    // 顶格平铺、内容始终展开。计划本身只在对话框计划卡里。
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
          {detailBlocks.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 4,
              }}
            >
              {detailBlocks.map((b) => b.el)}
            </div>
          )}
          {isRunning && runningNodes.length === 0 && timeline.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              正在执行…
            </Typography.Text>
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
    </div>
  );
}
