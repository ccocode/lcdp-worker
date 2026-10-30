/**
 * 对话记录里的计划 / 派发卡片（第 103 步步骤 6 用户修订）。
 *
 * 服务端只在消息 payload 里放指针（任务 id、派发序号），不放快照；
 * 卡片挂载时读任务行最新状态（与左栏/右栏同源），派发进行中或
 * 计划进行中时每 20 秒轮询一次、终态即停——子回合收尾只改任务行，
 * 卡片随之翻状态，不往父会话插消息。
 */
import { useEffect, useRef, useState } from "react";
import { Button, Card, Spin, Tag, Typography } from "antd";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantOptionsCard,
  type AdminAssistantTask,
  type AdminTaskRunDetail,
  type AdminTaskRunPending,
} from "../../api";
import { PAUSE_REASON_LABELS } from "./TaskDetail";

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
function useTaskCard(appId: string, taskId: string, refreshKey = 0) {
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
  }, [appId, taskId, refreshKey]);
  return { task, missing };
}

/**
 * 主题预览 payload 防御式读取（待决项 preview 字段优先、顶层
 * 同名字段回落；缺失时返回空，界面以通用文案呈现、不现编主题名）。
 */
function readDialogPreview(p: AdminTaskRunPending): {
  themeName: string | null;
  styleSummary: string | null;
  pages: string[];
  changes: string[];
  previewUrl: string | null;
  previewExpiresAt: string | null;
  previewError: string | null;
} {
  const inner = p.preview ?? null;
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
      : [];
  const pages = list(inner?.pages);
  const changes = list(inner?.changes);
  return {
    themeName: text(inner?.themeName) ?? text(p.themeName),
    styleSummary: text(inner?.styleSummary) ?? text(p.styleSummary),
    pages: pages.length > 0 ? pages : list(p.pages),
    changes: changes.length > 0 ? changes : list(p.changes),
    previewUrl: text(inner?.previewUrl) ?? text(p.previewUrl),
    previewExpiresAt:
      text(inner?.previewExpiresAt) ?? text(p.previewExpiresAt),
    previewError: text(inner?.previewError) ?? text(p.previewError),
  };
}

/**
 * 对话框并行卡片用的 run 详情：只在等验收 / 等绑定时取数，
 * 等待态每 20 秒轮询一次、终态即停（与任务卡轮询同频）。
 * 取不到时返回 null，卡片以通用文案 + 按钮回落，不阻塞验收。
 */
function useTaskRunDetail(
  appId: string,
  taskId: string,
  enabled: boolean,
  refreshKey = 0,
): AdminTaskRunDetail | null {
  const [detail, setDetail] = useState<AdminTaskRunDetail | null>(null);
  useEffect(() => {
    if (!enabled) {
      setDetail(null);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const res = await api.assistant.app.taskRun(appId, taskId);
        if (alive) setDetail(res);
      } catch {
        // 静默：卡片回落为通用文案，详情里仍可看完整待决
      }
    };
    void load();
    timer = setInterval(() => void load(), 20000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [appId, taskId, enabled, refreshKey]);
  return detail;
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
 * 对话记录里的计划卡片（2026-10-29 用户定，墨绿色重测定稿）：
 * 默认收起清单；目标两态都显示；标题与下一步不进对话框
 * （标题与目标近乎重复，下一步是内部指令）；展开时显示
 * 清单项，收起时只显示目标与按钮上的清单进度（已过/总数）。
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
  const [refreshKey, setRefreshKey] = useState(0);
  const { task, missing } = useTaskCard(appId, taskId, refreshKey);
  const [expanded, setExpanded] = useState(false);
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current || !onOpenTask) return;
    if (!task || task.status !== "active") return;
    autoOpenedRef.current = true;
    onOpenTask(taskId);
  }, [autoOpen, task, taskId, onOpenTask]);
  // 对话框并行卡片（2026-10-29 用户定）：预览卡与绑定审批卡
  // 与计划卡并行出现在对话框里，用户只盯对话框就能走完
  // “需求发起 → 规划执行 → 预览验收 → 收尾总结”全程；收尾
  // 总结是后端在对话里发的 closing 消息（accept/approve 后
  // 的 appendApprovalMessage），此处不再另造一张总结卡。
  // 注意：任务行 status 与 run_status 是两列——setRunStatus
  // 只改 run_status，任务 status 在关闭前一直是 active；等验收
  // / 等绑定必须读任务行自带的 runStatus，不能读 task.status
  // （2026-10-29 线上实证：等验收任务的计划卡仍标“进行中”）。
  const runStatus = task?.runStatus ?? null;
  const awaitingPreview = runStatus === "awaiting_preview";
  const awaitingBind = runStatus === "awaiting_bind";
  const runDetail = useTaskRunDetail(
    appId,
    taskId,
    awaitingPreview ||
      awaitingBind ||
      runStatus === "failed" ||
      runStatus === "paused",
    refreshKey,
  );
  const previewPending =
    runDetail?.pendingItems.find((p) => p.type === "theme-preview") ?? null;
  const bindPending =
    runDetail?.pendingItems.find((p) => p.type === "theme-bind") ?? null;
  // 异常在对话框可见（2026-10-31 用户定）：run 失败 / 暂停时，
  // 计划卡头改读 runStatus、卡上加一行原因，不开详情也能看到
  // 为什么停；详情栏关掉也不影响。
  const failedNode = runDetail?.nodes.find((n) => n.status === "failed");
  const failedVerdict = runDetail?.verdicts.find((v) => v.verdict === "fail");
  const pausePending =
    runDetail?.pendingItems.find((p) => p.type === "pause") ?? null;
  const criticPending =
    runDetail?.pendingItems.find((p) => p.type === "critic") ?? null;
  const exceptionReason =
    runStatus === "failed"
      ? failedNode?.error
        ? `失败原因：${failedNode.error.slice(0, 120)}`
        : failedVerdict && failedVerdict.acceptanceGaps.length > 0
          ? `终审未通过：${failedVerdict.acceptanceGaps.join("；")}`
          : null
      : runStatus === "paused"
        ? `暂停原因：${PAUSE_REASON_LABELS[pausePending?.reason ?? ""] ?? "等你处理"}${criticPending && criticPending.gaps.length > 0 ? `：${criticPending.gaps.join("；")}` : ""}`
        : null;
  const [acting, setActing] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const act = async (
    kind:
      | "preview-accept"
      | "preview-reject"
      | "preview-reissue"
      | "bind-approve"
      | "bind-reject",
  ) => {
    if (acting) return;
    setActing(kind);
    setActError(null);
    try {
      if (kind === "preview-accept")
        await api.assistant.app.acceptPreview(appId, taskId);
      else if (kind === "preview-reject")
        await api.assistant.app.rejectPreview(appId, taskId);
      else if (kind === "preview-reissue")
        await api.assistant.app.reissuePreview(appId, taskId);
      else if (kind === "bind-approve")
        await api.assistant.app.approveBind(appId, taskId);
      else await api.assistant.app.rejectBind(appId, taskId);
      // 服务端状态已变：重拉任务行与 run 详情，卡片随之翻态
      // （验收通过 → 绑定审批卡或已完成；暂不验收 → 仍停在
      // 预览卡，等用户在输入框发整改需求再循环）。
      setRefreshKey((k) => k + 1);
    } catch {
      setActError("操作失败，请稍后重试");
    } finally {
      setActing(null);
    }
  };
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
  const preview = previewPending ? readDialogPreview(previewPending) : null;
  const bindThemeName = bindPending
    ? readDialogPreview(bindPending).themeName
    : null;
  return (
    <>
    <Card
      size="small"
      title="计划"
      extra={
        <Tag
          style={{ margin: 0 }}
          color={
            runStatus === "failed"
              ? "red"
              : runStatus === "paused"
                ? "orange"
                : undefined
          }
        >
          {runStatus === "failed"
            ? "已失败"
            : runStatus === "paused"
              ? "已暂停"
              : (TASK_STATUS_LABELS[task.status] ?? task.status)}
        </Tag>
      }
      style={{
        borderColor: tokens.colorBorder,
        background: tokens.colorBgContainer,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {task.goal && (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            目标：{task.goal}
          </Typography.Text>
        )}
        {exceptionReason && (
          <Typography.Text
            type={runStatus === "failed" ? "danger" : "warning"}
            style={{ fontSize: 13, wordBreak: "break-word" }}
          >
            {exceptionReason}
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
      </div>
    </Card>
    {/*
      执行动画（2026-10-29 用户定）：计划卡里不放执行记录，
      动画在计划卡外面、下方，只表示对话没有停止；任务进行中
      才转，等验收 / 终态即停。执行记录与细节只在右侧详情里。
    */}
    {task.status === "active" &&
      runStatus !== "awaiting_preview" &&
      runStatus !== "awaiting_bind" &&
      runStatus !== "completed" &&
      runStatus !== "failed" &&
      runStatus !== "cancelled" &&
      runStatus !== "paused" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "2px 0",
          }}
        >
          <Spin size="small" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            执行中…
          </Typography.Text>
        </div>
      )}
    {awaitingPreview && (
      <Card
        size="small"
        title="预览"
        extra={
          <Tag color="orange" style={{ margin: 0 }}>
            等你验收预览
          </Tag>
        }
        style={{
          borderColor: tokens.colorBorder,
          background: tokens.colorBgContainer,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {preview?.themeName ?? "新主题"}
          </Typography.Text>
          {preview?.styleSummary && (
            <Typography.Text style={{ fontSize: 13 }}>
              {preview.styleSummary}
            </Typography.Text>
          )}
          {preview && preview.pages.length > 0 && (
            <Typography.Text style={{ fontSize: 13 }}>
              覆盖页面：{preview.pages.join("、")}
            </Typography.Text>
          )}
          {preview && preview.changes.length > 0 && (
            <div>
              <Typography.Text style={{ fontSize: 13 }}>
                主要变化：
              </Typography.Text>
              {preview.changes.map((c, j) => (
                <div key={j} style={{ fontSize: 13 }}>
                  · {c}
                </div>
              ))}
            </div>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            暂不验收时，草稿会保留在原处；请在输入框告诉我哪里有问题，我按你的意见改。
          </Typography.Text>
          {preview?.previewUrl ? (
            <div
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <Button
                type="primary"
                size="small"
                href={preview.previewUrl}
                target="_blank"
                rel="noreferrer"
                disabled={acting !== null}
              >
                打开预览
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                预览与线上绑定隔离，不影响线上呈现
              </Typography.Text>
            </div>
          ) : (
            <div
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                预览地址暂不可用
                {preview?.previewError ? `：${preview.previewError}` : ""}
                ，请重新签发后再预览验收。
              </Typography.Text>
              <Button
                size="small"
                loading={acting === "preview-reissue"}
                disabled={acting !== null}
                onClick={() => void act("preview-reissue")}
              >
                重新签发预览
              </Button>
            </div>
          )}
          {actError && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {actError}
            </Typography.Text>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="primary"
              size="small"
              loading={acting === "preview-accept"}
              disabled={acting !== null}
              onClick={() => void act("preview-accept")}
            >
              确认验收
            </Button>
            <Button
              size="small"
              loading={acting === "preview-reject"}
              disabled={acting !== null}
              onClick={() => void act("preview-reject")}
            >
              暂不验收
            </Button>
          </div>
        </div>
      </Card>
    )}
    {awaitingBind && (
      <Card
        size="small"
        title="绑定审批"
        extra={
          <Tag color="orange" style={{ margin: 0 }}>
            等你确认绑定
          </Tag>
        }
        style={{
          borderColor: tokens.colorBorder,
          background: tokens.colorBgContainer,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            将绑定的主题：{bindThemeName ?? "新主题"}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 13 }}>
            目标：电脑版
          </Typography.Text>
          <Typography.Text style={{ fontSize: 13 }}>
            确认后将换上该主题并重新生成页面。
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            如果不绑定，草稿会保留在原处，任务仍开着。
          </Typography.Text>
          {actError && (
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {actError}
            </Typography.Text>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="primary"
              size="small"
              loading={acting === "bind-approve"}
              disabled={acting !== null}
              onClick={() => void act("bind-approve")}
            >
              确认绑定
            </Button>
            <Button
              size="small"
              loading={acting === "bind-reject"}
              disabled={acting !== null}
              onClick={() => void act("bind-reject")}
            >
              不绑定
            </Button>
          </div>
        </div>
      </Card>
    )}
    </>
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
