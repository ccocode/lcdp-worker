/**
 * 设备桥的消费侧声明（M13 线 C，契约 §5）。
 *
 * 桥实现由 runtime 在入口安装到 `window.lcdpBridge`（见 apps/runtime/src/bridge.ts），
 * renderer 只按这个全局契约读取：不 import runtime 模块、不依赖 Capacitor。
 * Web 环境（无桥或非原生）时全部能力视为不可用，消费方不渲染桥入口、走既有
 * 路径自然降级，桌面/Web 行为零变化。
 */

export type BridgeResult<T> =
  | { supported: true; value: T }
  | { supported: false; reason: string };

/** renderer 实际消费的桥面子集（与 runtime 实现的结构化契约）。 */
export interface LcdpBridgeLike {
  isNative?: () => boolean;
  takePhoto?: () => Promise<BridgeResult<File>>;
  scan?: () => Promise<BridgeResult<string>>;
}

/** 扫码结果事件名（契约 §5）：detail = { text: string }。 */
export const SCAN_EVENT = "lcdp:scan";

export function lcdpBridge(): LcdpBridgeLike | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { lcdpBridge?: LcdpBridgeLike }).lcdpBridge;
  return b ?? null;
}

function bridgeNative(): LcdpBridgeLike | null {
  const b = lcdpBridge();
  if (!b) return null;
  try {
    return b.isNative?.() ? b : null;
  } catch {
    return null;
  }
}

/** 相机能力可用（原生壳内装有桥与相机插件）时才渲染「拍照」入口。 */
export function bridgeCamera(): LcdpBridgeLike | null {
  const b = bridgeNative();
  return b && typeof b.takePhoto === "function" ? b : null;
}

/** 扫码能力可用（原生壳内）时才给单号类文本字段挂填充监听/扫码入口。 */
export function bridgeScanner(): LcdpBridgeLike | null {
  const b = bridgeNative();
  return b && typeof b.scan === "function" ? b : null;
}

/** 从 lcdp:scan 事件里取扫码文本；形态不符返回 null。 */
export function scanTextOf(event: Event): string | null {
  const detail = (event as CustomEvent<{ text?: unknown }>).detail;
  return typeof detail?.text === "string" && detail.text ? detail.text : null;
}
