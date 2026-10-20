/**
 * 设备桥纯逻辑层（M13 线 C）：不触碰 window / DOM 全局，可在 Node 里直接单测。
 * 桥的对外统一结果形态：任何能力不可用、未注入或调用失败，都收敛为
 * `{ supported: false, reason }`，绝不向调用方抛异常。
 */

export type BridgeResult<T> =
  | { supported: true; value: T }
  | { supported: false; reason: string };

export function ok<T>(value: T): BridgeResult<T> {
  return { supported: true, value };
}

export function unsupported<T>(reason: string): BridgeResult<T> {
  return { supported: false, reason };
}

/** errText 单一实现已收编 @lcdp/ui（第 73 步片二），此处转出保持既有导入路径 */
export { errText } from "@lcdp/ui";

/** 壳注入的 Capacitor 全局的最小结构（只声明桥实际用到的面，不引 @capacitor 依赖）。 */
export interface CapacitorCameraPhoto {
  base64String?: string;
  format?: string;
}

export interface CapacitorBarcode {
  rawValue?: string;
  displayValue?: string;
}

export interface CapacitorGlobalLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: {
    Camera?: {
      getPhoto: (
        options: Record<string, unknown>,
      ) => Promise<CapacitorCameraPhoto>;
    };
    BarcodeScanner?: {
      scan: (
        options?: Record<string, unknown>,
      ) => Promise<{ barcodes?: CapacitorBarcode[] }>;
    };
  };
}

/** 判定是否原生壳环境：Capacitor 已注入且平台非 web。入参为待检的全局对象（便于单测）。 */
export function detectNative(cap: CapacitorGlobalLike | undefined): boolean {
  if (!cap) return false;
  if (typeof cap.isNativePlatform === "function") {
    try {
      return cap.isNativePlatform() === true;
    } catch {
      return false;
    }
  }
  if (typeof cap.getPlatform === "function") {
    try {
      return cap.getPlatform() !== "web";
    } catch {
      return false;
    }
  }
  return false;
}

/** base64 字符串 → File（照片字节回传 Web 层后走既有资产链上传，入口就是 File）。 */
export function base64ToFile(
  base64: string,
  format: string | undefined,
  now: number,
): File {
  const fmt = (format || "jpeg").toLowerCase();
  const ext = fmt === "jpeg" || fmt === "jpg" ? "jpg" : fmt;
  const mime = fmt === "jpg" ? "image/jpeg" : `image/${fmt}`;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], `photo-${now}.${ext}`, { type: mime });
}

/** 从 MLKit 扫码结果取首个有效文本（rawValue 优先，其次 displayValue）。 */
export function firstScanText(
  barcodes: CapacitorBarcode[] | undefined,
): string | null {
  for (const b of barcodes ?? []) {
    const text = b.rawValue || b.displayValue;
    if (text) return text;
  }
  return null;
}
