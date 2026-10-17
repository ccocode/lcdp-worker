/**
 * Web 侧设备桥（M13 线 C，契约 §5）：运行态调用设备能力的唯一入口。
 *
 * - 本模块把桥实现安装到 `window.lcdpBridge`；能力消费方（renderer 字段控件等）
 *   只读这个全局，不 import 本模块、不依赖 Capacitor。
 * - 桥面能力：takePhoto / pickFile（相机/相册，字节以 File 回传，之后走既有资产链
 *   adapter.uploadAsset 落库，与 M9 资产口径一致）、scan（MLKit 扫码，结果除返回值
 *   外再以 `lcdp:scan` 事件回传，供聚焦中的单号类字段填充）。
 * - push / biometric：契约本期只留接口——占位实现恒返回 unsupported，不接服务端
 *   通道、不调平台 API（决策 4）。
 * - Web 环境（无 Capacitor 注入）全部方法自然降级为 unsupported，调用方回落到既有
 *   `<input type=file>` / 手动输入路径；桥内部异常一律收敛、不向调用方抛。
 * - 不新增 @capacitor 依赖：壳以 server.url 模式加载线上页时，原生层会把
 *   `window.Capacitor` 与插件代理注入页面，这里只按最小结构读取（bridge-core.ts）。
 */
import {
  base64ToFile,
  detectNative,
  errText,
  firstScanText,
  ok,
  unsupported,
  type BridgeResult,
  type CapacitorGlobalLike,
} from "./bridge-core.js";

export type { BridgeResult } from "./bridge-core.js";

/** 扫码结果事件名（契约 §5）：detail = { text: string }。 */
export const SCAN_EVENT = "lcdp:scan";

export interface LcdpBridge {
  isNative: () => boolean;
  takePhoto: () => Promise<BridgeResult<File>>;
  pickFile: () => Promise<BridgeResult<File>>;
  scan: () => Promise<BridgeResult<string>>;
  /** 占位（本期不实现）：恒 unsupported。 */
  push: () => Promise<BridgeResult<never>>;
  /** 占位（本期不实现）：恒 unsupported。 */
  biometric: () => Promise<BridgeResult<never>>;
}

declare global {
  interface Window {
    lcdpBridge?: LcdpBridge;
  }
}

function capacitor(): CapacitorGlobalLike | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobalLike }).Capacitor;
}

function createBridge(): LcdpBridge {
  const isNative = () => detectNative(capacitor());

  /** Camera 插件取图并转 File；source 为插件枚举字面值（'CAMERA' | 'PHOTOS'）。 */
  async function photoFromCamera(
    source: "CAMERA" | "PHOTOS",
  ): Promise<BridgeResult<File>> {
    if (!isNative()) return unsupported("not_native");
    const camera = capacitor()?.Plugins?.Camera;
    if (!camera) return unsupported("camera_plugin_missing");
    try {
      const photo = await camera.getPhoto({
        resultType: "base64",
        source,
        quality: 80,
      });
      if (!photo.base64String) return unsupported("camera_empty_result");
      return ok(base64ToFile(photo.base64String, photo.format, Date.now()));
    } catch (err) {
      return unsupported(`camera_failed: ${errText(err)}`);
    }
  }

  return {
    isNative,

    takePhoto: () => photoFromCamera("CAMERA"),

    /**
     * 文件选择：本期壳只装了 Camera 与扫码插件，文件选择以相册选图覆盖图片场景；
     * 非图片文件无对应插件 → unsupported，调用方回落 `<input type=file>`（WebView
     * 内同样可用）。后续装文件选择插件时只改这一处。
     */
    pickFile: () => photoFromCamera("PHOTOS"),

    scan: async () => {
      if (!isNative()) return unsupported("not_native");
      const scanner = capacitor()?.Plugins?.BarcodeScanner;
      if (!scanner) return unsupported("scanner_plugin_missing");
      try {
        const result = await scanner.scan();
        const text = firstScanText(result.barcodes);
        if (!text) return unsupported("scan_empty_result");
        // 契约事件回传：聚焦中的单号类字段监听此事件填充自身（renderer 侧接入）
        window.dispatchEvent(
          new CustomEvent(SCAN_EVENT, { detail: { text } }),
        );
        return ok(text);
      } catch (err) {
        return unsupported(`scan_failed: ${errText(err)}`);
      }
    },

    push: async () => unsupported("not_implemented"),
    biometric: async () => unsupported("not_implemented"),
  };
}

let bridge: LcdpBridge | null = null;

/** 安装（幂等）：在 runtime 入口尽早调用；返回已安装的桥实例。 */
export function installBridge(): LcdpBridge {
  if (!bridge) {
    bridge = createBridge();
    window.lcdpBridge = bridge;
  }
  return bridge;
}
