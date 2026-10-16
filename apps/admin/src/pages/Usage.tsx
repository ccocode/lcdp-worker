import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Row,
  Segmented,
  Statistic,
  Table,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { api, type Row as DataRow } from "../api";
import { asText } from "../helpers";

const { RangePicker } = DatePicker;

type GroupBy = "day" | "app" | "channel" | "model";

const GROUP_LABELS: Record<GroupBy, string> = {
  day: "按日",
  app: "按应用",
  channel: "按通道",
  model: "按模型",
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export default function Usage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [tenantId, setTenantId] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [meteringStart, setMeteringStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.usage.query({
        groupBy,
        tenantId: tenantId || undefined,
        from: range ? range[0].format("YYYY-MM-DD") : undefined,
        to: range ? range[1].format("YYYY-MM-DD") : undefined,
      });
      setRows(res.rows);
      setMeteringStart(res.meteringStart);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用量失败");
    } finally {
      setLoading(false);
    }
  }, [groupBy, tenantId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      calls: rows.reduce((s, r) => s + num(r.calls), 0),
      prompt: rows.reduce((s, r) => s + num(r.prompt_tokens), 0),
      completion: rows.reduce((s, r) => s + num(r.completion_tokens), 0),
      total: rows.reduce((s, r) => s + num(r.total_tokens), 0),
    }),
    [rows],
  );

  const columns: ColumnsType<DataRow> = [
    { title: GROUP_LABELS[groupBy], dataIndex: "bucket", render: (v) => asText(v) },
    { title: "调用次数", dataIndex: "calls", render: (v) => asText(v) },
    { title: "Prompt Tokens", dataIndex: "prompt_tokens", render: (v) => asText(v) },
    {
      title: "Completion Tokens",
      dataIndex: "completion_tokens",
      render: (v) => asText(v),
    },
    { title: "总 Tokens", dataIndex: "total_tokens", render: (v) => asText(v) },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`统计起点：${meteringStart ?? "—"}`}
        description="用量自 M8 计量链上线日起记录，历史消耗不补录；本看板只记 Token 量与调用次数，不折算金额。"
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="调用次数合计" value={totals.calls} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="Prompt Tokens" value={totals.prompt} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="Completion Tokens" value={totals.completion} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="总 Tokens" value={totals.total} />
          </Card>
        </Col>
      </Row>
      <Card
        title="用量明细"
        extra={
          <Segmented
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
            options={(
              Object.keys(GROUP_LABELS) as GroupBy[]
            ).map((k) => ({ label: GROUP_LABELS[k], value: k }))}
          />
        }
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <RangePicker
            onChange={(v) => setRange((v as [Dayjs, Dayjs] | null) ?? null)}
          />
          <Input
            placeholder="租户 tenantId（留空=全部）"
            allowClear
            style={{ width: 200 }}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
          <Button onClick={() => void load()}>查询</Button>
        </div>
        <Table
          rowKey={(r) => asText(r.bucket)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
      </Card>
    </div>
  );
}
