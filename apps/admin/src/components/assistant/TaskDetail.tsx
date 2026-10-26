/**
 * 任务详情体（工作台右栏与任务记录页抽屉共用）：
 * 只展示本实体自己的数据，不跨实体取数——统一壳 = 标题 +
 * 种类标 + 状态标 + 目标；正文按种类分体：计划是步骤清单 +
 * 已定决定 + 下一步，主题是主题 id@版本行 + 步骤清单 + 产物。
 * 派发记录不在此汇总（只从消息内的派发卡进入子代理详情）。
 * D6 首批：有 run 的任务另取本任务 run 详情（节点、待决、
 * 通知、主产物版本、终审门信号），仍是单实体取数；无 run 或
 * 取数失败时该区不出现，旧形态不变。
 * 底部操作由调用方以 footer 注入（工作台：继续，仅进行中；
 * 任务记录页：去助手查看）。待决事项的处理入口由调用方以
 * onHandlePending 注入（工作台：切到本任务会话；任务记录页：
 * 去助手查看）；不传则只展示待决、不给入口。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button, Spin, Tag, Typography } from "antd";
import {
  api,
  type AdminAssistantTask,
  type AdminTaskRunDetail,
} from "../../api";
import { fmtTime } from "../../helpers";

export const TASK_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  closed: "已收尾",
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

function checkTag(status: string) {
  if (CHECK_PASSED.has(status)) return <Tag color="green">已过</Tag>;
  if (CHECK_FAILED.has(status)) return <Tag color="red">未过</Tag>;
  if (CHECK_SKIPPED.has(status)) return <Tag>跳过</Tag>;
  return <Tag color="orange">待办</Tag>;
}

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

function nodeStatusTag(status: string) {
  if (status === "completed") return <Tag color="green">已完成</Tag>;
  if (status === "failed") return <Tag color="red">已失败</Tag>;
  if (status === "skipped" || status === "cancelled") return <Tag>跳过</Tag>;
  if (status === "active" || status === "running")
    return <Tag color="processing">进行中</Tag>;
  return <Tag color="orange">待开始</Tag>;
}

/** 防御式呈现：有什么显示什么，形状不合不造；skip 键不展开 */
function renderLoose(value: unknown, skip: Set<string>): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => renderLoose(v, skip));
  }
  if (typeof value === "object") {
    const rows: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (skip.has(k)) continue;
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        rows.push(`${k}：${String(v)}`);
      }
    }
    return rows;
  }
  return [];
}

export default function TaskDetail({
  task,
  footer,
  appId,
  onHandlePending,
}: {
  task: AdminAssistantTask;
  footer?: ReactNode;
  /** 传了且任务有 runId 时才取 run 详情（不传则不取数） */
  appId?: string;
  /** 待决事项的处理入口（不传则只展示） */
  onHandlePending?: () => void;
}) {
  const [runDetail, setRunDetail] = useState<AdminTaskRunDetail | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runTick, setRunTick] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  useEffect(() => {
    if (!appId || !task.runId) {
      setRunDetail(null);
      return;
    }
    let alive = true;
    setRunLoading(true);
    void api.assistant.app
      .taskRun(appId, task.id)
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
  const runAction = async (kind: "resume" | "retry-nodes") => {
    if (!appId || acting) return;
    setActing(kind);
    try {
      if (kind === "resume") await api.assistant.app.resumeRun(appId, task.id);
      else await api.assistant.app.retryRunNodes(appId, task.id);
      setRunTick((t) => t + 1);
    } finally {
      setActing(null);
    }
  };
  const arts = task.artifacts as Record<string, unknown> | null | undefined;
  const themeLine =
    task.kind === "theme_build" && typeof arts?.themeId === "string"
      ? `主题：${arts.themeId}${typeof arts.version === "string" ? `@${arts.version}` : ""}`
      : null;
  const artifactRows = renderLoose(
    task.artifacts,
    new Set(["delegations", "themeId", "version"]),
  );
  const decisionRows = renderLoose(task.decisions, new Set());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
        <Tag style={{ marginInlineEnd: 0 }}>
          {TASK_STATUS_LABELS[task.status] ?? task.status}
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
      {(task.checklist ?? []).length > 0 && (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            步骤
          </Typography.Text>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              marginTop: 4,
            }}
          >
            {task.checklist.map((it, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                }}
              >
                {checkTag(it.status)}
                <span style={{ flex: 1, minWidth: 0 }}>{it.label}</span>
                {it.evidence && /^https?:\/\//.test(it.evidence) && (
                  <a
                    href={it.evidence}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12 }}
                  >
                    证据
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {artifactRows.length > 0 && (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            产物
          </Typography.Text>
          {artifactRows.map((row, i) => (
            <div
              key={i}
              style={{ fontSize: 12, wordBreak: "break-word" }}
            >
              {row}
            </div>
          ))}
        </div>
      )}
      {decisionRows.length > 0 && (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已定决定
          </Typography.Text>
          {decisionRows.map((row, i) => (
            <div
              key={i}
              style={{ fontSize: 12, wordBreak: "break-word" }}
            >
              {row}
            </div>
          ))}
        </div>
      )}
      {task.nextStep && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          下一步：{task.nextStep}
        </Typography.Text>
      )}
      {runLoading && (
        <div style={{ padding: "8px 0" }}>
          <Spin size="small" />
        </div>
      )}
      {runDetail && runDetail.run && (
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            运行
          </Typography.Text>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
              fontSize: 12,
            }}
          >
            <Tag style={{ marginInlineEnd: 0 }}>
              {RUN_STATUS_LABELS[runDetail.run.runStatus ?? ""] ??
                runDetail.run.runStatus ??
                "—"}
            </Tag>
            {runDetail.latestVerdict === "pass" ? (
              <Tag color="green" style={{ marginInlineEnd: 0 }}>
                终审已通过
              </Tag>
            ) : runDetail.latestVerdict === "fail" ? (
              <Tag color="red" style={{ marginInlineEnd: 0 }}>
                终审未通过
              </Tag>
            ) : (
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                待终审
              </Tag>
            )}
            {runDetail.primaryArtifact && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                主产物：{runDetail.primaryArtifact.path}（第{" "}
                {runDetail.primaryArtifact.version} 版）
              </Typography.Text>
            )}
          </div>
          {runDetail.nodes.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 8,
              }}
            >
              {runDetail.nodes.map((n) => (
                <div key={n.nodeId} style={{ fontSize: 12 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {nodeStatusTag(n.status)}
                    <span style={{ flex: 1, minWidth: 0 }}>{n.nodeId}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      尝试 {n.attempts} 次
                    </Typography.Text>
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
            </div>
          )}
          {runDetail.pendingItems.length > 0 && (
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
              {runDetail.pendingItems.map((p, i) => (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    {p.type === "pause"
                      ? PAUSE_REASON_LABELS[p.reason ?? ""] ?? "等你处理"
                      : "终审未达标"}
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
          {runDetail.notifications.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginTop: 8,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                通知
              </Typography.Text>
              {runDetail.notifications.map((n, i) => (
                <div key={i} style={{ fontSize: 12 }}>
                  <div>{n.title}</div>
                  {n.body && (
                    <Typography.Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        display: "block",
                        wordBreak: "break-word",
                      }}
                    >
                      {n.body}
                    </Typography.Text>
                  )}
                  {n.createdAt && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(n.createdAt)}
                    </Typography.Text>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        更新于 {fmtTime(task.updatedAt)}
      </Typography.Text>
      {footer && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>{footer}</div>
      )}
    </div>
  );
}
