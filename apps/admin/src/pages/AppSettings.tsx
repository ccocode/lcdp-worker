import React, { useEffect, useState } from "react";
import { Alert, Card, Descriptions, Table, Tabs, Tag, Typography } from "antd";
import { api, type AdminDataMeta, type AppOperator, type Row } from "../api";
import { domainHealth } from "../domainHealth";
import { asText } from "../helpers";
import DomainBindings from "./DomainBindings";
import AppThemeSettings, { domainLabel } from "./AppThemeSettings";
import StaticStatus from "./StaticStatus";

/**
 * 应用设置（对象形态归正 W3）：单个应用的设置是对象的**属性表**，不是列表——
 * 本页为 Tabs 容器，五页签均为本应用的属性面：
 * 基本信息（应用资料 + 领域映射健康）/ 域名（单值属性，读写本应用的
 * 站点字段）/ 主题（本应用主题列表为主体，绑定存本应用主题双槽）/
 * 静态（本应用的站点模式与快照状态）/ 授权名单（grant ∪ 推导，只读）。
 * 深链种子 settingsTabSeed（/domains 等存量深链经外壳别名携带）决定初始页签。
 */
export default function AppSettings({
  appId,
  app,
  meta,
  isAdmin,
  settingsTabSeed,
}: {
  appId: string;
  app: Row | null;
  meta: AdminDataMeta | null;
  isAdmin: boolean;
  settingsTabSeed?: string | null;
}) {
  const [tab, setTab] = useState<string>(settingsTabSeed ?? "basic");
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

  const basicTab = (
    <div>
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
        <Alert type="info" showIcon message="领域信息加载中或暂不可用（以数据维护页的元数据为准）" />
      )}
      {meta && !health?.hasDomain && (
        <Alert type="info" showIcon message="该应用未绑定主领域（空白领域），仅提供通用模版" />
      )}
      {meta && health?.hasDomain && (
        <>
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="主领域">{domainLabel(meta.app.domain)}</Descriptions.Item>
            <Descriptions.Item label="领域模型版本">
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
    </div>
  );

  const grantsTab = (
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
              <Tag color="purple">领域角色成员</Tag>
            ) : (
              <Tag color="blue">运营授权</Tag>
            ),
        },
      ]}
    />
  );

  return (
    <Card title="应用设置">
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "basic", label: "基本信息", children: basicTab },
          {
            key: "domains",
            label: "域名",
            children: <DomainBindings appId={appId} isAdmin={isAdmin} />,
          },
          {
            key: "theme",
            label: "主题",
            children: (
              <AppThemeSettings
                appId={appId}
                isAdmin={isAdmin}
                appDomain={meta?.app.domain ?? null}
              />
            ),
          },
          {
            key: "static",
            label: "静态",
            children: <StaticStatus appId={appId} isAdmin={isAdmin} />,
          },
          { key: "grants", label: "授权名单", children: grantsTab },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        本页各页签即本应用的属性维护面（域名 / 主题 / 静态为本应用的属性，授权名单只读）；
        授权的发放与回收在平台区「用户与角色」，应用启停与主应用设置在平台区「应用管理」，
        访问形态说明见「域名」页签，设计与发布在 Studio；
        领域在创建应用时确定、不可变更，推导名单随领域角色映射与已发布权限自动变化。
      </Typography.Paragraph>
    </Card>
  );
}
