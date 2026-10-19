import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  DatePicker,
  Drawer,
  Input,
  Space,
  Table,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { api, type Row } from "../api";
import { JsonBlock, Mono, asText, fmtTime } from "../helpers";

const { RangePicker } = DatePicker;

interface Filters {
  action: string;
  actor: string;
  appId: string;
  tenantId: string;
  range: [Dayjs, Dayjs] | null;
}

const EMPTY: Filters = { action: "", actor: "", appId: "", tenantId: "", range: null };

export default function Audit({
  scope,
  appId,
}: {
  /** platform = 只取无应用归属事件；app = 固定本应用（P2 按应用端点） */
  scope: "platform" | "app";
  appId?: string;
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(
    async (f: Filters, p: number, ps: number) => {
      setLoading(true);
      try {
        const rangeParams = {
          from: f.range ? f.range[0].toISOString() : undefined,
          to: f.range ? f.range[1].toISOString() : undefined,
        };
        const res =
          scope === "app" && appId
            ? await api.audit.listForApp(appId, {
                action: f.action || undefined,
                actor: f.actor || undefined,
                ...rangeParams,
                page: p,
                pageSize: ps,
              })
            : await api.audit.list({
                action: f.action || undefined,
                actor: f.actor || undefined,
                tenantId: f.tenantId || undefined,
                scope: "platform",
                ...rangeParams,
                page: p,
                pageSize: ps,
              });
        setRows(res.rows);
        setTotal(res.total);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "加载审计失败");
      } finally {
        setLoading(false);
      }
    },
    [scope, appId],
  );

  useEffect(() => {
    void load(filters, page, pageSize);
    // 仅在翻页时自动加载；筛选条件变更走「查询」按钮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const columns: ColumnsType<Row> = [
    { title: "时间", width: 180, render: (_, r) => fmtTime(r.created_at ?? r.createdAt) },
    { title: "动作", dataIndex: "action", render: (v) => <Mono>{asText(v)}</Mono> },
    { title: "操作者", dataIndex: "actor", render: (v) => asText(v) },
    {
      title: "租户",
      render: (_, r) => asText(r.tenant_id ?? r.tenantId),
    },
    // app scope 下应用恒为本应用，不再单列；platform scope 下平台级事件本无应用归属
    ...(scope === "app"
      ? []
      : [
          {
            title: "应用",
            render: (_: unknown, r: Row) => asText(r.app_id ?? r.appId),
          } as ColumnsType<Row>[number],
        ]),
    {
      title: "摘要",
      render: (_, r) => {
        const d = r.detail;
        const s = typeof d === "string" ? d : asText(d);
        return s.length > 80 ? `${s.slice(0, 80)}…` : s;
      },
    },
    {
      title: "",
      width: 80,
      render: (_, r) => (
        <Button size="small" onClick={() => setDetail(r)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Card title={scope === "app" ? "审计日志" : "审计中心"}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          placeholder="动作 action（如 assistant.action）"
          allowClear
          style={{ width: 240 }}
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <Input
          placeholder="操作者 actor（如 zhangjing）"
          allowClear
          style={{ width: 200 }}
          value={filters.actor}
          onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
        />
        {scope === "platform" && (
          <Input
            placeholder="租户 tenantId"
            allowClear
            style={{ width: 160 }}
            value={filters.tenantId}
            onChange={(e) => setFilters({ ...filters, tenantId: e.target.value })}
          />
        )}
        <RangePicker
          showTime
          onChange={(v) =>
            setFilters({ ...filters, range: (v as [Dayjs, Dayjs] | null) ?? null })
          }
        />
        <Button
          type="primary"
          onClick={() => {
            setPage(1);
            void load(filters, 1, pageSize);
          }}
        >
          查询
        </Button>
        <Button
          onClick={() => {
            setFilters(EMPTY);
            setPage(1);
            void load(EMPTY, 1, pageSize);
          }}
        >
          重置
        </Button>
      </Space>

      <Table
        rowKey={(r) => String(r.id)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Drawer
        title="审计详情"
        width={640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail ? (
          <div>
            <p>
              动作：<Mono>{asText(detail.action)}</Mono>
            </p>
            <p>操作者：{asText(detail.actor)}</p>
            <p>时间：{fmtTime(detail.created_at ?? detail.createdAt)}</p>
            <p>detail 原文：</p>
            <JsonBlock value={detail.detail} />
          </div>
        ) : null}
      </Drawer>
    </Card>
  );
}
