import type { AdminDataMeta } from "./api";

/**
 * 领域映射健康检查（自 AppSettings 迁出的共享工具，注册表可见性谓词、
 * 应用设置页与工作台共用）：roles 锚点与固有实体都必须在已发布 schema
 * 的实体集内，缺失时领域模版降级为通用模版并显式提示（D12）。
 *
 * 健康比对的是已发布 Schema 的**全量**实体集（meta.schemaEntities）：
 * meta.entities 是按调用者数据权限裁剪的可见集（第 56 步 D2），角色无权
 * 读的实体不在其中——拿它判健康会把「无权读」误报成「映射缺失」、整组
 * 模版误关（第 58 步验收实证：CMS editor 无 message 读权，content 模版
 * 曾整组消失）。schemaEntities 缺失时（旧版服务）才回落 entities。
 */
export function domainHealth(meta: AdminDataMeta): {
  hasDomain: boolean;
  healthy: boolean;
  missing: string[];
} {
  const dm = meta.domainModules;
  if (!meta.app.domain || !dm) return { hasDomain: false, healthy: false, missing: [] };
  const present = new Set(meta.schemaEntities ?? meta.entities.map((e) => e.key));
  const missing = new Set<string>();
  for (const key of Object.values(dm.roles)) if (!present.has(key)) missing.add(key);
  for (const key of dm.inherent.entities) if (!present.has(key)) missing.add(key);
  return { hasDomain: true, healthy: missing.size === 0, missing: [...missing] };
}

/** 模版页所需实体是否齐备：实体 key 直查，或 roles 语义锚点解析后查 */
export function requiredEntitiesPresent(
  meta: AdminDataMeta,
  requires: (string | { role: string })[],
): boolean {
  const present = new Set(meta.entities.map((e) => e.key));
  const roles = meta.domainModules?.roles ?? {};
  return requires.every((r) => {
    const key = typeof r === "string" ? r : (roles[r.role] ?? r.role);
    return present.has(key);
  });
}
