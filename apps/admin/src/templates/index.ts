import type { TemplateDef } from "../registry";
import { contentTemplate } from "./content";
import { commerceTemplate } from "./commerce";
import { supportTemplate } from "./support";

/**
 * 领域管理模版注册表（第 57 步）：新领域模版在此登记即可获得菜单分区、
 * 可见性谓词与工作台指标/快捷入口消费，无需改外壳。
 * 第 58 步补入 commerce / support 两套模版（forum 模版已按定案作废）。
 */
export const TEMPLATES: TemplateDef[] = [
  contentTemplate,
  commerceTemplate,
  supportTemplate,
];

export function templateForDomain(domain: string | null | undefined): TemplateDef | null {
  if (!domain) return null;
  return TEMPLATES.find((t) => t.domain === domain) ?? null;
}
