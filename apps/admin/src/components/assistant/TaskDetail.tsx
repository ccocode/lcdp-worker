/**
 * 任务详情体（工作台右栏与任务记录页抽屉共用）：
 * 只展示本实体自己的数据，不跨实体取数——统一壳 = 标题 +
 * 种类标 + 状态标 + 目标；正文按种类分体：计划是步骤清单 +
 * 已定决定 + 下一步，主题是主题 id@版本行 + 步骤清单 + 产物。
 * 派发记录不在此汇总（只从消息内的派发卡进入子代理详情）。
 * 底部操作由调用方以 footer 注入（工作台：继续 / 查看对话；
 * 任务记录页：去助手查看）。
 */
import type { ReactNode } from "react";
import { Tag, Typography } from "antd";
import type { AdminAssistantTask } from "../../api";
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
}: {
  task: AdminAssistantTask;
  footer?: ReactNode;
}) {
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
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        更新于 {fmtTime(task.updatedAt)}
      </Typography.Text>
      {footer && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>{footer}</div>
      )}
    </div>
  );
}
