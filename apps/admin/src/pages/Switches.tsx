
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { tokens } from "@lcdp/ui";
import { asText, fmtTime } from "../helpers";

const POOLS = [
  { key: "design", label: "设计态 Agent（design）" },
  { key: "runtime", label: "运行态 Agent（runtime）" },
];

interface ComboRow {
  tenantId: string;
  appId: string;
  pool: string;
  disabled: boolean;
  reason: string;
  updatedBy: string;
  updatedAt: unknown;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Switches() {
  const [apps, setApps] = useState<Row[]>([]);
  const [tenants, setTenants] = useState<Row[]>([]);
  const [switches, setSwitches] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  // 配额覆写
  const [quotaTenant, setQuotaTenant] = useState("default");
  const [quotaValue, setQuotaValue] = useState<number | null>(null);
  const [globalBudget, setGlobalBudget] = useState<string>("—");
  const [tenantOverride, setTenantOverride] = useState<string>("—");
  const [hasOverride, setHasOverride] = useState(false);
  const [todayTokens, setTodayTokens] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t, s] = await Promise.all([
        api.apps.list().catch(() => [] as Row[]),
        api.tenants.list().catch(() => [] as Row[]),
        api.switches.list(),
      ]);
      setApps(a);
      setTenants(t);
      setSwitches(s);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载开关失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const combos = useMemo<ComboRow[]>(() => {
    const tenantIds = tenants.length
      ? tenants.map((t) => String(t.id))
      : ["default"];
    const out: ComboRow[] = [];
    for (const tenantId of tenantIds) {
      for (const app of apps) {
        const appId = String(app.id);
        for (const pool of POOLS) {
          const sw = switches.find(
            (s) =>
              asText(s.tenant_id ?? s.tenantId) === tenantId &&
              asText(s.app_id ?? s.appId) === appId &&
              asText(s.pool) === pool.key,
          );
          out.push({
            tenantId,
            appId,
            pool: pool.key,
            disabled: sw ? sw.disabled === true : false,
            reason: sw ? asText(sw.reason ?? "") : "",
            updatedBy: sw ? asText(sw.updated_by ?? sw.updatedBy ?? "") : "",
            updatedAt: sw ? (sw.updated_at ?? sw.updatedAt) : undefined,
          });
        }
      }
    }
    return out;
  }, [apps, tenants, switches]);

  const toggle = async (row: ComboRow, next: boolean) => {
    const key = `${row.tenantId}:${row.appId}:${row.pool}`;
    setBusyKey(key);
    try {
      await api.switches.put({
        tenantId: row.tenantId,
        appId: row.appId,
        pool: row.pool,
        disabled: !next,
        reason: reasonDraft[key] ?? row.reason ?? "",
      });
      message.success(next ? "已启用该 Agent 池" : "已熔断停用该 Agent 池");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换失败");
    } finally {
      setBusyKey(null);
    }
  };

  // 配额：读全局默认与该租户覆写（走配置接口），并查当日用量对照
  const loadQuota = useCallback(async () => {
    try {
      const items = await api.config.get();
      const g = items.find(
        (i) => asText(i.key) === "llm.tenantTokenBudget" && asText(i.scope) === "global",
      );
      setGlobalBudget(g ? asText(g.value) : "—");
      const t = items.find(
        (i) =>
          asText(i.key) === "llm.tenantTokenBudget" &&
          asText(i.scope) === `tenant:${quotaTenant}`,
      );
      setTenantOverride(t ? asText(t.value) : "未覆写（用全局默认）");
      setHasOverride(!!t);
    } catch {
      setGlobalBudget("—");
      setTenantOverride("—");
      setHasOverride(false);
    }
    try {
      const res = await api.usage.query({
        groupBy: "day",
        from: todayStr(),
        to: todayStr(),
        tenantId: quotaTenant,
      });
      let sum = 0;
      for (const r of res.rows)
        sum += typeof r.total_tokens === "number" ? r.total_tokens : 0;
      setTodayTokens(sum);
    } catch {
      setTodayTokens(null);
    }
  }, [quotaTenant]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  const saveQuota = async () => {
    if (quotaValue === null || quotaValue === undefined) {
      message.warning("请输入日 Token 上限");
      return;
    }
    try {
      await api.config.put([
        {
          key: "llm.tenantTokenBudget",
          scope: `tenant:${quotaTenant}`,
          value: quotaValue,
        },
      ]);
      message.success(`已设置租户 ${quotaTenant} 的日 Token 上限为 ${quotaValue}`);
      void loadQuota();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  // 清除覆写 = PUT value:null，api 侧删 platform_config 覆写行、回落全局默认（审计记 (clear)）
  const clearQuota = () => {
    Modal.confirm({
      title: `清除租户 ${quotaTenant} 的配额覆写？`,
      content: "清除后该租户回落全局默认上限（全局默认为空则不限额）。",
      okText: "清除覆写",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.config.put([
            {
              key: "llm.tenantTokenBudget",
              scope: `tenant:${quotaTenant}`,
              value: null,
            },
          ]);
          message.success(`已清除租户 ${quotaTenant} 的配额覆写`);
          setQuotaValue(null);
          void loadQuota();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "清除失败");
        }
      },
    });
  };

  const columns: ColumnsType<ComboRow> = [
    { title: "租户", dataIndex: "tenantId" },
    { title: "应用", dataIndex: "appId" },
    {
      title: "Agent 池",
      dataIndex: "pool",
      render: (v: string) => POOLS.find((p) => p.key === v)?.label ?? v,
    },
    {
      title: "状态",
      render: (_, r) =>
        r.disabled ? <Tag color="red">已熔断</Tag> : <Tag color="green">启用中</Tag>,
    },
    {
      title: "停用原因",
      render: (_, r) => {
        const key = `${r.tenantId}:${r.appId}:${r.pool}`;
        return (
          <Input
            size="small"
            style={{ width: 200 }}
            placeholder="停用原因（切换时提交）"
            defaultValue={r.reason}
            onChange={(e) =>
              setReasonDraft((d) => ({ ...d, [key]: e.target.value }))
            }
          />
        );
      },
    },
    {
      title: "最近更新",
      render: (_, r) =>
        r.updatedAt
          ? `${fmtTime(r.updatedAt)}${r.updatedBy ? ` · ${r.updatedBy}` : ""}`
          : "—",
    },
    {
      title: "开关",
      width: 110,
      render: (_, r) => (
        <Switch
          checked={!r.disabled}
          loading={busyKey === `${r.tenantId}:${r.appId}:${r.pool}`}
          checkedChildren="启用"
          unCheckedChildren="熔断"
          onChange={(next) => void toggle(r, next)}
        />
      ),
    },
  ];

  return (
    <div>
      <Card title="熔断开关（租户 × 应用 × Agent 池）" style={{ marginBottom: 16 }}>
        <Table
          rowKey={(r) => `${r.tenantId}:${r.appId}:${r.pool}`}
          loading={loading}
          columns={columns}
          dataSource={combos}
          pagination={false}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          熔断后 api 在调用 Agent 的咽喉点直接拒绝并返回 agent_disabled，同时写入审计；恢复即重新启用。
        </Typography.Paragraph>
      </Card>

      <Card title="租户日 Token 上限（配额）">
        <Space wrap align="start">
          <div>
            <div style={{ marginBottom: 4 }}>租户 ID</div>
            <Input
              style={{ width: 200 }}
              value={quotaTenant}
              onChange={(e) => setQuotaTenant(e.target.value)}
            />
          </div>
          <div>
            <div style={{ marginBottom: 4 }}>日上限（tokens）</div>
            <InputNumber
              style={{ width: 200 }}
              min={0}
              value={quotaValue}
              onChange={(v) => setQuotaValue(v ?? null)}
              placeholder="如 100000"
            />
          </div>
          <div style={{ paddingTop: 22 }}>
            <Space>
              <Button type="primary" onClick={() => void saveQuota()}>
                保存覆写
              </Button>
              <Button danger disabled={!hasOverride} onClick={clearQuota}>
                清除覆写
              </Button>
            </Space>
          </div>
        </Space>
        <div style={{ marginTop: 16, color: tokens.colorTextSecondary }}>
          全局默认上限：{globalBudget}；该租户当前覆写：{tenantOverride}；该租户今日已用：
          {todayTokens === null ? "—" : `${todayTokens} tokens`}。超限后新的 AI
          调用将被拒绝（quota_exceeded）并写入审计。
        </div>
      </Card>
    </div>
  );
}
