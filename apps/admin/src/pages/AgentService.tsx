import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  Col,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type AgentFaceKey, type AgentOverrideRow, type Row as DataRow } from "../api";
import { asText, fmtTime } from "../helpers";

/**
 * 平台区「智能服务」页（第 83 步片四第 2 点）：呈现层汇总——两项
 * 服务（设计助手 / 应用助手）的模型设置、停用情况与平台用量，
 * 外加各应用日常调整的存在概览。本页只读：停用开关在「熔断与
 * 配额」维护、用量明细在「成本看板」查看、应用的日常调整在
 * 各应用的「智能服务」页进行，这里不复制第二套维护面。
 * 用量按现有统计给出今日与累计总量，不预造未落地的分组维度。
 */

const SERVICES = [
  { key: "design", label: "设计助手服务", desc: "支撑设计台的智能生成" },
  { key: "runtime", label: "应用助手服务", desc: "支撑各应用内的助手" },
] as const;

const FACE_LABELS: Record<AgentFaceKey, string> = {
  staff: "员工助手",
  visitor: "访客客服",
  ops: "运营助手",
};
const FACE_KEYS: AgentFaceKey[] = ["staff", "visitor", "ops"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" ? v : 0);

interface AppOverview {
  appId: string;
  appName: string;
  rows: AgentOverrideRow[] | null;
  error: boolean;
  latest: string | null;
}

export default function AgentService() {
  const [configItems, setConfigItems] = useState<DataRow[]>([]);
  const [switchRows, setSwitchRows] = useState<DataRow[]>([]);
  const [usageRows, setUsageRows] = useState<DataRow[]>([]);
  const [overviews, setOverviews] = useState<AppOverview[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, sw, usage, apps] = await Promise.all([
        api.config.get().catch(() => [] as DataRow[]),
        api.switches.list().catch(() => [] as DataRow[]),
        api.usage
          .query({ groupBy: "day" })
          .catch(() => ({ meteringStart: null, rows: [] as DataRow[] })),
        api.apps.list().catch(() => [] as DataRow[]),
      ]);
      setConfigItems(cfg);
      setSwitchRows(sw);
      setUsageRows(usage.rows);
      const list: AppOverview[] = [];
      for (const a of apps) {
        const appId = String(a.id);
        try {
          const rows = await api.agents.overrides(appId);
          const latest = rows.reduce<string | null>(
            (acc, r) => (acc === null || r.updatedAt > acc ? r.updatedAt : acc),
            null,
          );
          list.push({
            appId,
            appName: asText(a.name ?? appId),
            rows,
            error: false,
            latest,
          });
        } catch {
          // 单个应用读取失败只标该行，不拖垮整页
          list.push({
            appId,
            appName: asText(a.name ?? appId),
            rows: null,
            error: true,
            latest: null,
          });
        }
      }
      setOverviews(list);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 配置读数：取全局那份的值，未设置时回短态 */
  const configValue = (key: string): string => {
    const item = configItems.find(
      (i) => asText(i.key) === key && asText(i.scope ?? "global") === "global",
    );
    if (!item) return "未配置";
    const v = asText(item.value ?? "");
    return v ? v : "未配置";
  };

  const blockedOf = (pool: string) =>
    switchRows.filter(
      (s) => asText(s.pool) === pool && s.disabled === true,
    );

  const today = todayStr();
  const todayRow = usageRows.find((r) => asText(r.bucket) === today);
  const totals = {
    calls: usageRows.reduce((s, r) => s + num(r.calls), 0),
    tokens: usageRows.reduce((s, r) => s + num(r.total_tokens), 0),
  };

  const columns: ColumnsType<AppOverview> = [
    { title: "应用", render: (_, r) => r.appName },
    ...FACE_KEYS.map(
      (face): ColumnsType<AppOverview>[number] => ({
        title: FACE_LABELS[face],
        render: (_, r) => {
          if (r.error) return "读取失败";
          const row = r.rows?.find((x) => x.face === face);
          return row ? fmtTime(row.updatedAt) : "—";
        },
      }),
    ),
    {
      title: "最近调整",
      render: (_, r) => (r.error ? "读取失败" : r.latest ? fmtTime(r.latest) : "—"),
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin tip="加载中…" />
      </div>
    );
  }

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {SERVICES.map((svc) => {
          const blocked = blockedOf(svc.key);
          return (
            <Col key={svc.key} xs={24} lg={12}>
              <Card
                title={
                  <Space>
                    {svc.label}
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                    >
                      {svc.desc}
                    </Typography.Text>
                  </Space>
                }
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <div>
                    强模型：{configValue("chat.modelStrong")}；快模型：
                    {configValue("chat.modelFast")}
                  </div>
                  <div>租户日 Token 上限：{configValue("llm.tenantTokenBudget")}</div>
                  <div>
                    停用情况：
                    {blocked.length === 0 ? (
                      <Tag color="green">全部启用中</Tag>
                    ) : (
                      <Space size={4} wrap>
                        <Tag color="red">{`已停用 ${blocked.length} 处`}</Tag>
                        {blocked.slice(0, 4).map((s, i) => (
                          <Tag key={i}>
                            {asText(s.tenant_id ?? s.tenantId ?? "default")}
                            {" · "}
                            {asText(s.app_id ?? s.appId ?? "")}
                          </Tag>
                        ))}
                        {blocked.length > 4 ? <Tag>…</Tag> : null}
                      </Space>
                    )}
                  </div>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card title="平台用量" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} lg={6}>
            <Statistic title="今日调用次数" value={num(todayRow?.calls)} />
          </Col>
          <Col xs={12} lg={6}>
            <Statistic title="今日 Token" value={num(todayRow?.total_tokens)} />
          </Col>
          <Col xs={12} lg={6}>
            <Statistic title="累计调用次数" value={totals.calls} />
          </Col>
          <Col xs={12} lg={6}>
            <Statistic title="累计 Token" value={totals.tokens} />
          </Col>
        </Row>
      </Card>

      <Card title="各应用日常调整概览">
        <Table
          rowKey="appId"
          columns={columns}
          dataSource={overviews}
          pagination={false}
          locale={{ emptyText: "暂无应用" }}
        />
      </Card>
    </div>
  );
}
