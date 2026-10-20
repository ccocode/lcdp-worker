import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
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
import { asText } from "../helpers";

/**
 * 应用管理（平台页）：应用上下架 + 站点属性总览（第 68 步：入口装配模型
 * 退役后，域名/主应用都是应用自身字段）——列表直接呈现各应用的绑定
 * 域名与访问形态（专属域名 / 主应用根路径 / 默认域名 /<id> 路径），
 * 主应用以「是/否」开关呈现（拨开经确认后 PUT /admin/apps/:id/site 落盘；
 * 当前主应用不可关闭——主应用只能改设、不能取消；目标应用绑有专属域名
 * 时服务端拒绝、须先在该应用设置里解绑）。
 * 单应用的域名/应用别名维护在应用区「应用设置 · 域名」页签。
 */
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

  const setPrimary = (row: Row) => {
    const id = String(row.id);
    Modal.confirm({
      title: "设为主应用",
      content: `确认把应用 ${id} 设为主应用？主应用占据默认域名的根路径，原主应用随即让位。若该应用已绑定专属域名，服务端会拒绝（须先解绑）。操作会写入审计。`,
      okText: "设为主应用",
      cancelText: "取消",
      onOk: async () => {
        setBusyId(id);
        try {
          await api.site.update(id, { isPrimary: true });
          message.success(`已设为主应用：${id}`);
          void load();
        } catch (err) {
          // 后端口径错误（已绑专属域名须先解绑等）原文呈现
          message.error(err instanceof Error ? err.message : "设置失败");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const columns: ColumnsType<Row> = [
    {
      title: "编号",
      dataIndex: "appNo",
      width: 70,
      render: (v) => (v === null || v === undefined ? "—" : asText(v)),
    },
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
      title: "主应用",
      width: 110,
      render: (_, r) => (
        <Switch
          checked={!!r.isPrimary}
          // 当前主应用不可关（只能改设到别的应用）；改设走确认弹窗
          disabled={!!r.isPrimary}
          loading={busyId === String(r.id)}
          checkedChildren="是"
          unCheckedChildren="否"
          onChange={(next) => {
            if (next) setPrimary(r);
          }}
        />
      ),
    },
    {
      title: "访问形态",
      render: (_, r) => {
        const host = asText(r.boundHost);
        if (host) return <Tag>{host}</Tag>;
        if (r.isPrimary) return <Typography.Text type="secondary">默认域名根路径</Typography.Text>;
        return (
          <Typography.Text type="secondary">
            默认域名 /{String(r.id)}
            {r.nameEn ? `（别名 /${asText(r.nameEn)}）` : ""}
          </Typography.Text>
        );
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
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card title="应用管理">
        <Table
          rowKey={(r) => String(r.id)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          域名是应用的单值属性：绑定、解绑与应用别名在应用区「应用设置 ·
          域名」页签维护；默认域名仅主应用可绑定，未绑定的应用经默认域名
          /&lt;应用ID&gt; 路径访问。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
