import type { TemplateDef } from "../registry";
import { contentTemplate } from "./content";

/**
 * 领域管理模版注册表（第 57 步）：新领域模版在此登记即可获得菜单分区、
 * 可见性谓词与工作台指标/快捷入口消费，无需改外壳。
 * commerce / support 两套新模版在第 58 步（P3）随此结构补入。
 */
export const TEMPLATES: TemplateDef[] = [contentTemplate];

export function templateForDomain(domain: string | null | undefined): TemplateDef | null {
  if (!domain) return null;
  return TEMPLATES.find((t) => t.domain === domain) ?? null;
}
