import { message, Modal } from "antd";
import { errText } from "./format.js";

/**
 * 报错呈现约定（第 73 步片二落码，约定全文见本包 README）：
 * 前端错误统一经 showError —— 映射表优先、未命中回落 err.message。
 * 映射表（第 73 步片三填充）：键 = 服务端错误码（err.code）或原始
 * message 全文。服务端 message 本身已是用户中文时不入表、直接透传；
 * 入表的只有机器码与浏览器网络原文这类用户看不懂的形态。
 */
const ERROR_TEXT_MAP: Record<string, string> = {
  unauthorized: "登录已失效，请重新登录",
  forbidden: "无权执行此操作",
  not_found: "记录不存在或已被删除",
  conflict: "操作冲突，请刷新后重试",
  validation_failed: "提交内容校验未通过，请检查后重试",
  bad_request: "请求不合要求，请检查后重试",
  rate_limited: "操作过于频繁，请稍后再试",
  quota_exceeded: "用量已达上限，请联系管理员",
  internal: "服务内部错误，请稍后再试",
  referenced: "该记录仍被其他记录引用，不能删除",
  field_not_writable: "包含不可修改的字段",
  locked: "该功能已锁定",
  app_disabled: "该应用已下架，暂不可用",
  provider_not_configured: "相关服务尚未配置，请联系管理员",
  config_unavailable: "服务配置未加载，请稍后再试",
  "Failed to fetch": "网络请求失败，请稍后重试",
  "NetworkError when attempting to fetch resource.":
    "网络请求失败，请稍后重试",
  "Load failed": "网络请求失败，请稍后重试",
};

/** 错误 → 用户可见文本（映射命中优先，其次原文，空原文回落兜底文案） */
export function errorDisplayText(
  err: unknown,
  fallback = "操作失败，请稍后重试",
): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && ERROR_TEXT_MAP[code]) {
    return ERROR_TEXT_MAP[code];
  }
  // 浏览器网络失败以 TypeError 抛出（原文因浏览器而异），统一为友好文案
  if (err instanceof TypeError) return "网络请求失败，请稍后重试";
  const raw = errText(err).trim();
  if (raw && ERROR_TEXT_MAP[raw]) return ERROR_TEXT_MAP[raw];
  // 网络失败短语（各浏览器原文措辞不一，非 TypeError 包装时按短语识别）
  if (
    /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(
      raw,
    )
  ) {
    return "网络请求失败，请稍后重试";
  }
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
