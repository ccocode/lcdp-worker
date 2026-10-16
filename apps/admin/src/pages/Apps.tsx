import React, { useCallback, useEffect, useState } from "react";
import { Card, Modal, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { asText } from "../helpers";

export default function Apps() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.apps.list());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载应用失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (row: Row, next: boolean) => {
    const id = String(row.id);
    const status = next ? "active" : "disabled";
    Modal.confirm({
      title: next ? "恢复应用（上架）" : "下架应用",
      content: next
        ? `确认恢复应用 ${id}？运行态将重新可访问。`
        : `确认下架应用 ${id}？下架后运行态入口、数据、流程、助手与公开页将全部拒绝访问（403 app_disabled）；设计态与管理台不受影响。操作会写入审计。`,
      okText: next ? "恢复" : "下架",
      okButtonProps: next ? {} : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusyId(id);
        try {
          await api.apps.setStatus(id, status);
          message.success(next ? "已恢复上架" : "已下架");
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "操作失败");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const columns: ColumnsType<Row> = [
    { title: "应用 ID", dataIndex: "id", render: (v) => asText(v) },
    { title: "租户", dataIndex: "tenant_id", render: (v, r) => asText(v ?? r.tenantId) },
    { title: "场景", dataIndex: "scenario", render: (v) => asText(v) },
    {
      title: "当前发布版本",
      render: (_, r) => {
        const v = r.current_version ?? r.currentVersion;
        return v === null || v === undefined ? "未发布" : `v${asText(v)}`;
      },
    },
    {
      title: "状态",
      render: (_, r) =>
        asText(r.status ?? "active") === "disabled" ? (
          <Tag color="red">已下架</Tag>
        ) : (
          <Tag color="green">上架中</Tag>
        ),
    },
    {
      title: "上下架",
      width: 120,
      render: (_, r) => (
        <Switch
          checked={asText(r.status ?? "active") !== "disabled"}
          loading={busyId === String(r.id)}
          checkedChildren="上架"
          unCheckedChildren="下架"
          onChange={(next) => toggle(r, next)}
        />
      ),
    },
  ];

  return (
    <Card title="应用管理">
      <Table
        rowKey={(r) => String(r.id)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
    </Card>
  );
}
