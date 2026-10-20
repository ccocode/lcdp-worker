import { message, Modal } from "antd";
import { errText } from "./format.js";

/**
 * 报错呈现约定（第 73 步片二落码，约定全文见本包 README）：
 * 前端错误统一经 showError —— 映射表优先、未命中回落 err.message。
 * 映射表由第 73 步片三（文案治理）填充：键 = 服务端错误码（err.code）
 * 或原始 message 全文；此处先立落点与查询顺序，表为空时行为 = 直接透传。
 */
const ERROR_TEXT_MAP: Record<string, string> = {};

/** 错误 → 用户可见文本（映射命中优先，其次原文，空原文回落兜底文案） */
export function errorDisplayText(
  err: unknown,
  fallback = "操作失败，请稍后重试",
): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && ERROR_TEXT_MAP[code]) {
    return ERROR_TEXT_MAP[code];
  }
  const raw = errText(err).trim();
  if (raw && ERROR_TEXT_MAP[raw]) return ERROR_TEXT_MAP[raw];
  return raw || fallback;
}

/** 统一报错出口：toast 呈现 errorDisplayText 的结果 */
export function showError(
  err: unknown,
  fallback = "操作失败，请稍后重试",
): void {
  void message.error(errorDisplayText(err, fallback));
}

/**
 * 破坏性确认约定：删除 / 下架 / 不可逆操作一律 Modal.confirm（经此封装，
 * 确认钮 danger + 文案统一）；轻量、可撤销的操作才用 Popconfirm（见 README）。
 */
export function confirmDanger(opts: {
  title: string;
  content?: string;
  okText?: string;
  onOk: () => void | Promise<void>;
}): void {
  Modal.confirm({
    title: opts.title,
    content: opts.content,
    okText: opts.okText ?? "删除",
    okButtonProps: { danger: true },
    cancelText: "取消",
    onOk: opts.onOk,
  });
}
