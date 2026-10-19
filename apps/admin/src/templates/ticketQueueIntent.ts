/**
 * 工单工作台队列一次性意图（第 58 步）：与 articleEditorIntent 同手法——
 * 服务统计页点卡跳转前写入目标队列（状态值），工单工作台挂载时消费一次
 * 即清；无意图（菜单/深链直达）默认「全部」队列。
 */
let pending: string | null = null;

export function setTicketQueueIntent(queue: string | null): void {
  pending = queue;
}

export function consumeTicketQueueIntent(): string | null {
  const v = pending;
  pending = null;
  return v;
}
