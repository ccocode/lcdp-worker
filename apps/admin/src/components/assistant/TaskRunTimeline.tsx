/**
 * 任务 run 执行记录时间线（对话框内实时显示）。
 *
 * 对话窗口口径（2026-10-29 用户定）：对话框只显任务状态与步骤，
 * 加执行中动画；产物版本、终审理由等细节不在对话框展开，统一
 * 走自动打开的右侧详情。订阅 api.assistant.streamTaskRun：首包
 * snapshot 建初始行，增量事件按 key upsert（节点行就地更新状态），
 * 终态行常驻。无 run 或订阅失败时渲染空（静默降级，与 taskRun
 * 的 null 口径一致）。
 */
import { useEffect, useState } from "react";
import { Spin, Typography } from "antd";
import { api } from "../../api";

type Tone = "danger" | "success" | "secondary" | undefined;

interface Line {
  key: string;
  text: string;
  tone: Tone;
}

interface StreamNode {
  nodeId: string;
  kind: string | null;
  status: string;
  attempts: number;
  error: string | null;
}

interface StreamArtifact {
  artifactId: string;
  kind: string | null;
  version: number;
  bytes: number | null;
  createdAt: string | null;
}

interface StreamVerdict {
  round: number;
  verdict: string | null;
  reasoning?: string | null;
  createdAt: string | null;
}

interface RunSnapshot {
  taskStatus: string;
  runStatus: string | null;
  checklistDone: number;
  checklistTotal: number;
  nodes: StreamNode[];
  artifacts: StreamArtifact[];
  verdicts: StreamVerdict[];
  canBind: boolean;
}

const RUN_LABELS: Record<string, string> = {
  pending: "等待执行",
  running: "执行进行中",
  paused: "已暂停",
  awaiting_preview: "预览已就绪，等你验收",
  awaiting_bind: "绑定待确认",
  completed: "执行完成",
  failed: "执行失败",
  cancelled: "已取消",
};

const TASK_LABELS: Record<string, string> = {
  active: "进行中",
  done: "已完成",
  abandoned: "已放弃",
  closed: "已收尾",
  awaiting_preview: "等你验收预览",
  awaiting_bind: "等你确认绑定",
};

const NODE_LABELS: Record<string, string> = {
  pending: "待开始",
  active: "执行中",
  completed: "已完成",
  failed: "已失败",
};

function nodeLine(node: StreamNode): Line {
  let text = `节点 ${node.nodeId}：${NODE_LABELS[node.status] ?? node.status}`;
  if (node.attempts > 1) text += `（尝试 ${node.attempts} 次）`;
  if (node.error) text += `：${node.error}`;
  return {
    key: `node:${node.nodeId}`,
    text,
    tone: node.status === "failed" ? "danger" : undefined,
  };
}

function verdictLine(v: StreamVerdict): Line {
  const verdict =
    v.verdict === "pass" ? "通过" : v.verdict === "fail" ? "未通过" : (v.verdict ?? "未知");
  const reasoning =
    typeof v.reasoning === "string" && v.reasoning.length > 0
      ? v.reasoning.slice(0, 200)
      : "";
  return {
    key: `verdict:${v.round}@${v.createdAt ?? ""}`,
    text: `终审第 ${v.round} 轮：${verdict}${reasoning ? `（${reasoning}）` : ""}`,
    tone: v.verdict === "fail" ? "danger" : v.verdict === "pass" ? "success" : undefined,
  };
}

function snapshotLines(snap: RunSnapshot): Line[] {
  const lines: Line[] = [];
  if (snap.runStatus) {
    lines.push({
      key: "run",
      text: RUN_LABELS[snap.runStatus] ?? snap.runStatus,
      tone:
        snap.runStatus === "failed"
          ? "danger"
          : snap.runStatus === "completed"
            ? "success"
            : undefined,
    });
  }
  if (snap.checklistTotal > 0) {
    lines.push({
      key: "checklist",
      text: `清单 ${snap.checklistDone}/${snap.checklistTotal}`,
      tone: "secondary",
    });
  }
  for (const node of snap.nodes) lines.push(nodeLine(node));
  // 产物快照只取每 artifact 最新版（历史版在事件流里逐条追加）。
  const latest = new Map<string, StreamArtifact>();
  for (const a of snap.artifacts) {
    const old = latest.get(a.artifactId);
    if (!old || old.version < a.version) latest.set(a.artifactId, a);
  }
  for (const a of latest.values()) {
    lines.push({
      key: `artifact:${a.artifactId}:${a.version}`,
      text: `产物 ${a.artifactId} 第 ${a.version} 版`,
      tone: "secondary",
    });
  }
  for (const v of snap.verdicts) lines.push(verdictLine(v));
  return lines;
}

function upsert(lines: Line[], line: Line): Line[] {
  const idx = lines.findIndex((l) => l.key === line.key);
  if (idx < 0) return [...lines, line].slice(-50);
  const next = [...lines];
  next[idx] = line;
  return next;
}

function applyEvent(lines: Line[], ev: { type: string; data: unknown }): Line[] {
  const data = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case "snapshot": {
      const snap = (data as { snapshot?: RunSnapshot }).snapshot;
      return snap ? snapshotLines(snap) : lines;
    }
    case "task": {
      const status = String(data.status ?? "");
      if (!status) return lines;
      return upsert(lines, {
        key: "task",
        text: `任务状态：${TASK_LABELS[status] ?? status}`,
        tone: "secondary",
      });
    }
    case "run": {
      const runStatus = (data.runStatus as string | null) ?? null;
      if (!runStatus) return lines;
      return upsert(lines, {
        key: "run",
        text: RUN_LABELS[runStatus] ?? runStatus,
        tone:
          runStatus === "failed"
            ? "danger"
            : runStatus === "completed"
              ? "success"
              : undefined,
      });
    }
    case "checklist": {
      const done = Number(data.done ?? 0);
      const total = Number(data.total ?? 0);
      if (total <= 0) return lines;
      return upsert(lines, {
        key: "checklist",
        text: `清单 ${done}/${total}`,
        tone: "secondary",
      });
    }
    case "node": {
      const node = data.node as StreamNode | undefined;
      return node ? upsert(lines, nodeLine(node)) : lines;
    }
    case "artifact": {
      const artifact = data.artifact as StreamArtifact | undefined;
      if (!artifact) return lines;
      return upsert(lines, {
        key: `artifact:${artifact.artifactId}:${artifact.version}`,
        text: `产物 ${artifact.artifactId} 第 ${artifact.version} 版`,
        tone: "secondary",
      });
    }
    case "verdict": {
      const verdict = data.verdict as StreamVerdict | undefined;
      return verdict ? upsert(lines, verdictLine(verdict)) : lines;
    }
    case "terminal": {
      const runStatus = (data.runStatus as string | null) ?? null;
      if (!runStatus) return lines;
      return upsert(lines, {
        key: "terminal",
        text:
          runStatus === "failed"
            ? "执行失败，原因见上方节点/终审"
            : runStatus === "completed"
              ? "执行完成"
              : "已取消",
        tone:
          runStatus === "failed"
            ? "danger"
            : runStatus === "completed"
              ? "success"
              : undefined,
      });
    }
    default:
      return lines;
  }
}

/** 对话窗口只显状态与步骤：产物、终审细节过滤掉（详情里看）。 */
function dialogLines(lines: Line[]): Line[] {
  return lines.filter(
    (l) =>
      l.key === "run" ||
      l.key === "task" ||
      l.key === "checklist" ||
      l.key === "terminal" ||
      l.key.startsWith("node:"),
  );
}

export function TaskRunTimeline({
  appId,
  taskId,
}: {
  appId: string;
  taskId: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  useEffect(() => {
    setLines([]);
    setRunStatus(null);
    const off = api.assistant.app.streamTaskRun(appId, taskId, (ev) => {
      const data = (ev.data ?? {}) as Record<string, unknown>;
      const snap = data.snapshot as RunSnapshot | undefined;
      const status =
        snap?.runStatus ??
        (typeof data.runStatus === "string" ? data.runStatus : null);
      if (status) setRunStatus(status);
      setLines((prev) => applyEvent(prev, ev));
    });
    return off;
  }, [appId, taskId]);
  const shown = dialogLines(lines);
  if (shown.length === 0) return null;
  // 执行中动画：run 正在跑（pending/running）时才转；暂停、等验收、
  // 等绑定、终态都不转——转圈 = 还在执行，不是“窗口卡住”。
  const executing = runStatus === "pending" || runStatus === "running";
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px dashed #d9d9d9",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        执行记录
      </Typography.Text>
      {executing && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <Spin size="small" style={{ marginRight: 6 }} />
          执行中…
        </Typography.Text>
      )}
      {shown.map((line) => (
        <Typography.Text
          key={line.key}
          type={line.tone}
          style={{ fontSize: 12 }}
        >
          {line.text}
        </Typography.Text>
      ))}
    </div>
  );
}
