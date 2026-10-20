import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Modal,
  Segmented,
  Space,
  Typography,
  message,
} from "antd";
import { PageTable, StatusTag, showError, type StatusTone } from "@lcdp/ui";
import type { ColumnsType } from "antd/es/table";
import { api, type AdminDataMeta, type Row } from "../api";
import { asText, fmtTime } from "../helpers";

/**
 * 订单处理（第 58 步专做，商城领域模版）：状态队列 + 行内发货/完成 +
 * 详情抽屉（订单全字段 + 明细子表）。队列分段与动作目标一律取运行时 meta
 * 的 order.status options，不写死骨架枚举（防升版漂移）；状态流转走
 * admindata 更新、按 order 实体 actions 门控、全程审计。
 */

/** 状态徽标色：沿用呈现层默认色板口径（待*→amber、完成→green、已支付/已发货→blue、取消→gray） */
function statusTone(status: string): StatusTone {
  if (status.startsWith("待")) return "amber";
  if (status === "已完成" || status === "已支付") return "blue";
  if (status === "已发货") return "blue";
  return "gray";
}

export default function CommerceOrders({
  appId,
  meta,
}: {
  appId: string;
  meta: AdminDataMeta;
}) {
  const roles = meta.domainModules?.roles ?? {};
  const orderKey = roles["order"] ?? "order";
  const orderItemKey = roles["order_item"] ?? "order_item";
  const productKey = roles["product"] ?? "product";
  const orderMeta = meta.entities.find((e) => e.key === orderKey);
  const canUpdate = (orderMeta?.actions ?? []).includes("update");

  const statusValues = useMemo(() => {
    const f = orderMeta?.fields.find((x) => x.key === "status");
    return (f?.options ?? []).map((o) => (typeof o === "string" ? o : o.value));
  }, [orderMeta]);

  const [queue, setQueue] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [productNames, setProductNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminData.list(appId, orderKey, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        filters: queue === "all" ? undefined : { status: queue },
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      showError(err, "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, [appId, orderKey, queue, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [queue]);

  // 明细子表的商品名映射：进页预载商品清单（id → name），缺失回退显示 id
  useEffect(() => {
    let alive = true;
    void api.adminData
      .list(appId, productKey, { limit: 200 })
      .then((res) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const p of res.rows) map[String(p.id)] = asText(p.name ?? p.id);
        setProductNames(map);
      })
      .catch((err) => {
        if (alive) showError(err, "商品名称加载失败");
      });
    return () => {
      alive = false;
    };
  }, [appId, productKey]);

  const openDetail = async (row: Row) => {
    setDetail(row);
    setItems([]);
    setItemsLoading(true);
    try {
      const res = await api.adminData.list(appId, orderItemKey, {
        limit: 200,
        filters: { order_id: String(row.id) },
      });
      setItems(res.rows);
    } catch (err) {
      showError(err, "加载订单明细失败");
    } finally {
      setItemsLoading(false);
    }
  };

  /** 状态流转：二次确认后 admindata 更新并刷新列表与抽屉 */
  const act = (row: Row, to: string, verb: string) => {
    Modal.confirm({
      title: `确认${verb}？`,
      content: `订单 ${String(row.id)} 的状态将改为「${to}」（操作记入审计）。`,
      okText: verb,
      cancelText: "取消",
      onOk: async () => {
        try {
          // 第 65 步：以回读实际状态为准播报，字段被权限剔除时不再报假成功
          const { row: updated, strippedFields } = await api.adminData.update(appId, orderKey, String(row.id), { status: to });
          const actual = String(updated?.status ?? "");
          if (actual === to) {
            message.success(`已${verb}（操作已记入审计）`);
            setDetail((d) => (d && String(d.id) === String(row.id) ? { ...d, status: to } : d));
          } else if (strippedFields.includes("status")) {
            message.warning(`状态未变更（仍为「${actual}」）：「状态」不在你的可写字段内`);
            setDetail((d) => (d && String(d.id) === String(row.id) ? updated : d));
          } else {
            message.warning(`状态未变更（仍为「${actual}」），请刷新后核对`);
          }
          void load();
        } catch (err) {
          showError(err, `${verb}失败`);
        }
      },
    });
  };

  const rowActions = (row: Row) => {
    const status = String(row.status ?? "");
    return (
      <Space size="small">
        <Button size="small" type="link" onClick={() => void openDetail(row)}>
          详情
        </Button>
        {canUpdate && status === "已支付" && statusValues.includes("已发货") && (
          <Button size="small" type="link" onClick={() => act(row, "已发货", "发货")}>
            发货
          </Button>
        )}
        {canUpdate && status === "已发货" && statusValues.includes("已完成") && (
          <Button size="small" type="link" onClick={() => act(row, "已完成", "完成")}>
            完成
          </Button>
        )}
      </Space>
    );
  };

  const columns: ColumnsType<Row> = [
    {
      title: "订单 ID",
      dataIndex: "id",
      key: "id",
      width: 120,
      render: (v: unknown) => (
        <Typography.Text copyable={{ text: String(v ?? "") }} style={{ fontSize: 12 }}>
          {String(v ?? "—").slice(0, 14)}
        </Typography.Text>
      ),
    },
    { title: "会员", dataIndex: "member_id", key: "member_id", render: (v: unknown) => asText(v) },
    { title: "联系人", dataIndex: "contact_name", key: "contact_name", render: (v: unknown) => asText(v) },
    {
      title: "金额",
      dataIndex: "total_amount",
      key: "total_amount",
      render: (v: unknown) => asText(v),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: unknown) => (
        <StatusTag
          raw={asText(v)}
          text={asText(v)}
          tone={statusTone(asText(v))}
        />
      ),
    },
    {
      title: "支付时间",
      dataIndex: "paid_at",
      key: "paid_at",
      render: (v: unknown) => fmtTime(v),
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: unknown) => fmtTime(v),
    },
    {
      title: "操作",
      key: "actions",
      width: 180,
      render: (_: unknown, row: Row) => rowActions(row),
    },
  ];

  const itemColumns: ColumnsType<Row> = [
    {
      title: "商品",
      dataIndex: "product_id",
      key: "product_id",
      render: (v: unknown) => {
        const id = v === null || v === undefined ? "" : String(v);
        return productNames[id] ?? (id || "—");
      },
    },
    { title: "数量", dataIndex: "quantity", key: "quantity", render: (v: unknown) => asText(v) },
    { title: "单价", dataIndex: "unit_price", key: "unit_price", render: (v: unknown) => asText(v) },
    { title: "金额", dataIndex: "amount", key: "amount", render: (v: unknown) => asText(v) },
  ];

  return (
    <Card title="订单处理">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Segmented
          value={queue}
          onChange={(v) => setQueue(String(v))}
          options={[
            { label: "全部", value: "all" },
            ...statusValues.map((v) => ({ label: v, value: v })),
          ]}
        />
        <PageTable
          rowKey={(r) => String(r.id)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          serverPage={{
            current: page,
            pageSize,
            total,
            onChange: (p, s) => {
              setPage(p);
              setPageSize(s);
            },
          }}
        />
      </Space>
      <Drawer
        title={detail ? `订单详情 · ${String(detail.id)}` : "订单详情"}
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={640}
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions column={1} size="small" bordered>
              {(orderMeta?.fields ?? []).map((f) => (
                <Descriptions.Item key={f.key} label={f.label}>
                  {f.key === "status" ? (
                    <StatusTag
                      raw={asText(detail[f.key])}
                      text={asText(detail[f.key])}
                      tone={statusTone(asText(detail[f.key]))}
                    />
                  ) : f.type === "datetime" || f.type === "date" ? (
                    fmtTime(detail[f.key])
                  ) : (
                    asText(detail[f.key])
                  )}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label="创建时间">
                {fmtTime(detail.created_at)}
              </Descriptions.Item>
            </Descriptions>
            {canUpdate && (
              <Space>
                {String(detail.status ?? "") === "已支付" && statusValues.includes("已发货") && (
                  <Button type="primary" onClick={() => act(detail, "已发货", "发货")}>
                    发货
                  </Button>
                )}
                {String(detail.status ?? "") === "已发货" && statusValues.includes("已完成") && (
                  <Button type="primary" onClick={() => act(detail, "已完成", "完成")}>
                    完成
                  </Button>
                )}
              </Space>
            )}
            <Typography.Title level={5} style={{ margin: 0 }}>
              订单明细
            </Typography.Title>
            <PageTable
              rowKey={(r) => String(r.id)}
              size="small"
              loading={itemsLoading}
              columns={itemColumns}
              dataSource={items}
              noPagination
            />
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
