import React from "react";
import { Alert, Card, Descriptions, Table, Tag, Typography } from "antd";
import type { AdminDataMeta, Row } from "../api";
import { asText } from "../helpers";

/**
 * 应用设置（M15 第③步通用模版，只读）：应用基本信息 + 领域信息与
 * 角色映射健康检查（D12：映射缺失时领域模版降级为通用模版并显式提示）。
 */

/** 领域映射健康：roles 锚点与固有实体都必须在已发布 schema 的实体集内 */
export function domainHealth(meta: AdminDataMeta): {
  hasDomain: boolean;
  healthy: boolean;
  missing: string[];
} {
  const dm = meta.domainModules;
  if (!meta.app.domain || !dm) return { hasDomain: false, healthy: false, missing: [] };
  const present = new Set(meta.entities.map((e) => e.key));
  const missing = new Set<string>();
  for (const key of Object.values(dm.roles)) if (!present.has(key)) missing.add(key);
  for (const key of dm.inherent.entities) if (!present.has(key)) missing.add(key);
  return { hasDomain: true, healthy: missing.size === 0, missing: [...missing] };
}

export default function AppSettings({
  app,
  meta,
}: {
  app: Row | null;
  meta: AdminDataMeta | null;
}) {
  const health = meta ? domainHealth(meta) : null;
  return (
    <Card title="应用设置">
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="应用 ID">{asText(app?.id)}</Descriptions.Item>
        <Descriptions.Item label="名称">{asText(app?.name)}</Descriptions.Item>
        <Descriptions.Item label="场景">{asText(app?.scenario)}</Descriptions.Item>
        <Descriptions.Item label="状态">
          {app?.status === "active" ? (
            <Tag color="success">启用</Tag>
          ) : (
            <Tag>{asText(app?.status)}</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="当前发布版本">
          {app?.currentVersion ? `v${String(app.currentVersion)}` : "未发布"}
        </Descriptions.Item>
        <Descriptions.Item label="所属租户">{asText(app?.tenantId)}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        领域信息
      </Typography.Title>
      {!meta && (
        <Alert type="info" showIcon message="领域信息加载中或暂不可用（以数据管理页的元数据为准）" />
      )}
      {meta && !health?.hasDomain && (
        <Alert type="info" showIcon message="该应用未绑定主领域（空白领域），仅提供通用模版" />
      )}
      {meta && health?.hasDomain && (
        <>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="主领域">{meta.app.domain}</Descriptions.Item>
            <Descriptions.Item label="骨架版本">
              {meta.domainModules?.skeleton ?? "—"}
            </Descriptions.Item>
          </Descriptions>
          {health.healthy ? (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 16 }}
              message="角色映射健康：领域模版可用"
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="角色映射不完整，领域模版已降级为通用模版"
              description={`已发布设计中缺少实体：${health.missing.join("、")}。请在 Studio 补齐或重新发布。`}
            />
          )}
          <Table
            style={{ marginTop: 16 }}
            size="small"
            pagination={false}
            rowKey="role"
            dataSource={Object.entries(meta.domainModules?.roles ?? {}).map(
              ([role, entity]) => ({ role, entity }),
            )}
            columns={[
              { title: "语义角色", dataIndex: "role", key: "role" },
              { title: "实体 key", dataIndex: "entity", key: "entity" },
              {
                title: "在已发布设计中",
                key: "present",
                render: (_: unknown, r: { entity: string }) =>
                  meta.entities.some((e) => e.key === r.entity) ? (
                    <Tag color="success">存在</Tag>
                  ) : (
                    <Tag color="error">缺失</Tag>
                  ),
              },
            ]}
          />
        </>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        本页只读：应用上下架在平台区「应用管理」，设计与发布在 Studio，领域在创建应用时确定、不可变更。
      </Typography.Paragraph>
    </Card>
  );
}
