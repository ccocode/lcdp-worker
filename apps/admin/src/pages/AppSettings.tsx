import React, { useEffect, useState } from "react";
import { Alert, Card, Descriptions, Table, Tag, Typography } from "antd";
import { api, type AdminDataMeta, type AppOperator, type Row } from "../api";
import { domainHealth } from "../domainHealth";
import { asText } from "../helpers";

/**
 * 应用设置（M15 第③步通用模版，只读）：应用基本信息 + 领域信息与
 * 角色映射健康检查（D12：映射缺失时领域模版降级为通用模版并显式提示）
 * + 授权名单（第 57 步：消费第 56 步按应用运营名单端点，grant 与领域
 * 角色推导合并呈现、逐项标注来源，只读）。
 */

export default function AppSettings({
  appId,
  app,
  meta,
}: {
  appId: string;
  app: Row | null;
  meta: AdminDataMeta | null;
}) {
  const [operators, setOperators] = useState<AppOperator[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .grants.listForApp(appId)
      .then((list) => {
        if (!cancelled) setOperators(list);
      })
      .catch(() => {
        if (!cancelled) setOperators([]);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);
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
      <Typography.Title level={5} style={{ marginTop: 24 }}>
        授权名单（谁可运营本应用）
      </Typography.Title>
      <Table
        size="small"
        pagination={false}
        rowKey="userId"
        loading={operators === null}
        dataSource={operators ?? []}
        locale={{ emptyText: "暂无运营者（仅平台管理员可进入）" }}
        columns={[
          {
            title: "用户",
            key: "user",
            render: (_: unknown, o: AppOperator) =>
              `${o.displayName ?? o.username}（${o.username}）`,
          },
          { title: "平台角色", dataIndex: "role", key: "role", width: 140 },
          {
            title: "来源",
            dataIndex: "source",
            key: "source",
            width: 220,
            render: (v: string) =>
              v === "derived" ? (
                <Tag color="purple">领域角色推导（命中本应用角色映射）</Tag>
              ) : (
                <Tag color="blue">运营授权</Tag>
              ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        本页只读：授权的发放与回收在平台区「用户与角色」，推导名单随领域角色映射与已发布权限自动变化；应用上下架在平台区「应用管理」，设计与发布在 Studio，领域在创建应用时确定、不可变更。
      </Typography.Paragraph>
    </Card>
  );
}
