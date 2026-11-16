import type { ReactNode } from "react";
import { Badge, Tag, Typography } from "antd";
import { tokens } from "@lcdp/ui";

/**
 * 详情统一格式（2026-11-16 用户定）：每块内容一只盒子——标题行
 * （状态圆点＋正在执行什么＋可选次要信息）＋动作行（时间＋状态圆点＋
 * 自然语言文字，平铺），报错记在出错的那只盒子里，盒子按时间从上往
 * 下排，无外层计划框、无任务头。顶部执行过程、计划步骤盒、非计划
 * 任务盒、子代理派发盒、无归属时间线行共用此格式。
 */

export type DetailStatus = "waiting" | "running" | "completed" | "failed";

/** ISO 时间 → 时钟文本 HH:MM:SS（动作行时间口径；无时间戳回 null，不显示时间）。 */
export function formatClock(iso: string | null | undefined): string | null {
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

/** 状态圆点：等待灰、执行中蓝闪、完成绿、失败红（16px，与动作行圆点同宽，文字才对齐）。 */
export function DetailStatusDot({ status }: { status: DetailStatus }) {
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

/** 信息圆点：蓝色实心小点（16px 框内居中，与状态圆点同宽，时间线/完成记录行用）。 */
export function DetailInfoDot() {
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
      <span style={{ color: "#1677ff", fontSize: 8, lineHeight: 1 }}>●</span>
    </span>
  );
}

/** 盒子：标题行（状态圆点＋正在执行什么＋可选次要信息）＋动作行容器。 */
export function DetailBox({
  title,
  status,
  secondary,
  children,
}: {
  title: ReactNode;
  status: DetailStatus;
  secondary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
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
        <DetailStatusDot status={status} />
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
        {secondary !== undefined && secondary !== null && secondary !== "" && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: tokens.colorTextSecondary,
              flexShrink: 0,
            }}
          >
            {secondary}
          </span>
        )}
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
        {children}
      </div>
    </div>
  );
}

/** ReactNode → 纯文本（动作行悬停提示用）：字符串/数字直接取，数组
 * 与片段递归拼，元素只取其文本子节点。 */
function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(reactNodeToText).join("");
  }
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return reactNodeToText(props?.children);
  }
  return "";
}

/** 动作行：时间＋圆点＋文字，平铺；count>1 时显 xN；error 记在行下方（红色）。
 * 文字单行显示、超长省略，鼠标移入悬停显示完整信息（2026-11-16 用户定）。 */
export function DetailActionRow({
  time,
  status,
  children,
  error,
  count,
}: {
  time?: string | null;
  /** 动作状态圆点；传 "info" 时用蓝色信息圆点（时间线/完成记录行）。 */
  status: DetailStatus | "info";
  children: ReactNode;
  error?: string | null;
  count?: number;
}) {
  const fullText = reactNodeToText(children);
  return (
    <div style={{ fontSize: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {status === "info" ? (
          <DetailInfoDot />
        ) : (
          <DetailStatusDot status={status} />
        )}
        {time && (
          <span
            style={{
              fontSize: 11,
              opacity: 0.6,
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {time}
          </span>
        )}
        <span
          title={fullText || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            color: status === "failed" ? "#ff4d4f" : undefined,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {children}
        </span>
        {count !== undefined && count > 1 && (
          <Tag
            style={{ margin: 0, fontSize: 10, padding: "0 4px", lineHeight: "16px" }}
          >
            x{count}
          </Tag>
        )}
      </div>
      {error && (
        <Typography.Text
          type="danger"
          style={{
            fontSize: 12,
            display: "block",
            wordBreak: "break-word",
          }}
        >
          {error}
        </Typography.Text>
      )}
    </div>
  );
}

/** 无边框行：时间线/完成记录行（蓝色圆点＋时间＋文字），与盒子内动作行同左缘。
 * 文字单行显示、超长省略，鼠标移入悬停显示完整信息（2026-11-16 用户定，
 * 与动作行同口径——「阶段完成：…」类完成记录也会很长）。 */
export function DetailPlainRow({
  time,
  children,
  count,
}: {
  time?: string | null;
  children: ReactNode;
  count?: number;
}) {
  const fullText = reactNodeToText(children);
  return (
    <div
      style={{
        fontSize: 12,
        color: tokens.colorTextSecondary,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 0",
      }}
    >
      <DetailInfoDot />
      {time && (
        <span
          style={{
            fontSize: 11,
            opacity: 0.6,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {time}
        </span>
      )}
      <span
        title={fullText || undefined}
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {children}
      </span>
      {count !== undefined && count > 1 && (
        <Tag
          style={{ margin: 0, fontSize: 10, padding: "0 4px", lineHeight: "16px" }}
        >
          x{count}
        </Tag>
      )}
    </div>
  );
}
