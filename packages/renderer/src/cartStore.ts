/**
 * 本地购物车（商城线）：条目只存 { productId, quantity }——商品信息（名称/现价/
 * 状态/封面）一律在渲染时经当前适配器现拉、结算金额以服务端 checkout 重算为准，
 * 本地不缓存价格（前端改价无效口径从存储层就成立）。
 *
 * 存储键 `lcdp.cart.<host>`：与会员会话键 `lcdp.member.<host>` 同风格按 host 隔离
 * （不同店面域名购物车互不串扰）。SSR/测试等无 window/localStorage 的环境降级为
 * 内存存储，保证模块在任何宿主可 import。变更通知双通道：subscribe 订阅回调
 * （同页组件）+ window 事件 `lcdp:cart-changed`（宿主外壳页眉角标等跨树监听）。
 */

export interface CartItem {
  productId: string;
  quantity: number;
}

/** 购物车变更事件名（window CustomEvent，detail 为最新条目数） */
export const CART_CHANGED_EVENT = "lcdp:cart-changed";

type Listener = () => void;

const listeners = new Set<Listener>();
/** 无 localStorage 环境的内存兜底（按存储键分桶） */
const memoryStore = new Map<string, CartItem[]>();

function storageKey(): string {
  const host =
    typeof window !== "undefined" && window.location
      ? window.location.host
      : "";
  return `lcdp.cart.${host}`;
}

function readRaw(): CartItem[] {
  const key = storageKey();
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(key)
        : null;
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (it): it is CartItem =>
              !!it &&
              typeof it === "object" &&
              typeof (it as CartItem).productId === "string" &&
              typeof (it as CartItem).quantity === "number",
          )
          .map((it) => ({
            productId: it.productId,
            quantity: Math.max(1, Math.floor(it.quantity)),
          }));
      }
      return [];
    }
  } catch {
    // localStorage 不可用/内容损坏时回落内存桶
  }
  return [...(memoryStore.get(key) ?? [])];
}

function writeRaw(items: CartItem[]): void {
  const key = storageKey();
  memoryStore.set(key, [...items]);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(items));
    }
  } catch {
    // 写入失败仅影响持久化，内存桶仍保持最新
  }
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // 单个订阅者异常不阻断其余通知
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CART_CHANGED_EVENT, {
        detail: { count: items.reduce((s, it) => s + it.quantity, 0) },
      }),
    );
  }
}

function sanitizeQty(qty: number): number {
  if (!Number.isFinite(qty)) return 1;
  return Math.max(1, Math.floor(qty));
}

export const cartStore = {
  /** 全部条目（拷贝，外部修改不影响存储） */
  list(): CartItem[] {
    return readRaw().map((it) => ({ ...it }));
  },
  /** 加入购物车：已有同商品则数量累加；qty 缺省 1、不足 1 按 1 计 */
  add(productId: string, qty = 1): void {
    if (!productId) return;
    const items = readRaw();
    const found = items.find((it) => it.productId === productId);
    if (found) found.quantity += sanitizeQty(qty);
    else items.push({ productId, quantity: sanitizeQty(qty) });
    writeRaw(items);
  },
  /** 设置数量：qty ≤ 0 视为移除该条目 */
  setQty(productId: string, qty: number): void {
    if (!Number.isFinite(qty) || qty <= 0) {
      cartStore.remove(productId);
      return;
    }
    const items = readRaw();
    const found = items.find((it) => it.productId === productId);
    if (!found) return;
    found.quantity = Math.floor(qty);
    writeRaw(items);
  },
  /** 移除一条 */
  remove(productId: string): void {
    writeRaw(readRaw().filter((it) => it.productId !== productId));
  },
  /** 清空购物车（下单成功后调用） */
  clear(): void {
    writeRaw([]);
  },
  /** 条目总件数（页眉角标用：各行 quantity 求和） */
  count(): number {
    return readRaw().reduce((sum, it) => sum + it.quantity, 0);
  },
  /** 订阅变更（返回退订函数）；与会话存储同风格的轻量实现 */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
