/**
 * 设备桥纯逻辑自检（M13 线 C）：在 apps/runtime 下执行
 *   node scripts/bridge-check.mjs
 * 只测 bridge-core.ts 的纯函数（base64→File、结果形态、降级判定、扫码文本提取），
 * 不碰 DOM/window；桥的装配层（bridge.ts）靠三端构建 + 真机层验收覆盖。
 */
import assert from "node:assert/strict";
import {
  base64ToFile,
  detectNative,
  firstScanText,
  ok,
  unsupported,
} from "../src/bridge-core.ts";

// 1) 结果形态：全桥统一的 supported 判别式
assert.deepEqual(ok(1), { supported: true, value: 1 });
assert.deepEqual(unsupported("x"), { supported: false, reason: "x" });

// 2) base64 → File：字节无损、命名与 MIME 按 format 归一
const f = base64ToFile("aGVsbG8=", "jpeg", 1700000000000); // "hello"
assert.equal(f.name, "photo-1700000000000.jpg");
assert.equal(f.type, "image/jpeg");
assert.equal(f.size, 5);
assert.equal(await f.text(), "hello");
const p = base64ToFile("aGk=", "PNG", 1);
assert.equal(p.name, "photo-1.png");
assert.equal(p.type, "image/png");

// 3) 降级判定：无注入 / web 平台 / 判定函数抛错，一律非原生（→ 调用方走 Web 路径）
assert.equal(detectNative(undefined), false);
assert.equal(detectNative({}), false);
assert.equal(detectNative({ getPlatform: () => "web" }), false);
assert.equal(
  detectNative({
    isNativePlatform: () => {
      throw new Error("boom");
    },
  }),
  false,
);
assert.equal(detectNative({ isNativePlatform: () => true }), true);
assert.equal(detectNative({ getPlatform: () => "android" }), true);

// 4) 扫码文本提取：rawValue 优先、空结果为 null（调用方据此回 unsupported）
assert.equal(firstScanText(undefined), null);
assert.equal(firstScanText([]), null);
assert.equal(firstScanText([{ displayValue: "X" }]), "X");
assert.equal(firstScanText([{ rawValue: "A", displayValue: "B" }]), "A");
assert.equal(firstScanText([{}, { rawValue: "C" }]), "C");

console.log("bridge-check: all assertions passed");
