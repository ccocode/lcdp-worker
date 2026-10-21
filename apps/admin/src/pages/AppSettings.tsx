import React, { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { showError } from "@lcdp/ui";
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

  // 第 80 步：应用改名（管理员专属，经站点接口落库 + 审计；本地覆盖值
  // 让保存后立即呈现新名，外壳应用列表下次加载时同步）
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  useEffect(() => {
    setNameOverride(null);
    setNameEditing(false);
  }, [appId]);
  const displayName = nameOverride ?? asText(app?.name);
  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v) {
      message.warning("应用名称不能为空");
      return;
    }
    setNameSaving(true);
    try {
      const res = await api.site.update(appId, { name: v });
      setNameOverride(res.app.name);
      setNameEditing(false);
      message.success(`应用名称已改为「${res.app.name}」`);
    } catch (err) {
      showError(err, "改名失败");
    } finally {
      setNameSaving(false);
    }
  };

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
        <Descriptions.Item label="名称">
          {nameEditing ? (
            <Space size={6}>
              <Input
                size="small"
                style={{ width: 220 }}
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
                onPressEnter={() => void saveName()}
              />
              <Button
                size="small"
                type="primary"
                loading={nameSaving}
                onClick={() => void saveName()}
              >
                保存
              </Button>
              <Button size="small" onClick={() => setNameEditing(false)}>
                取消
              </Button>
            </Space>
          ) : (
            <Space size={8}>
              {displayName}
              {isAdmin && (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => {
                    setNameDraft(displayName);
                    setNameEditing(true);
                  }}
                >
                  改名
                </Button>
              )}
            </Space>
          )}
        </Descriptions.Item>
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
    </Card>
  );
}
