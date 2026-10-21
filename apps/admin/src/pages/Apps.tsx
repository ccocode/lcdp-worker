import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  Modal,
  Space,
  Switch,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { asText } from "../helpers";

/** 领域 key → 展示名（与 AppThemeSettings 的 DOMAIN_LABEL 同步） */
const DOMAIN_LABEL: Record<string, string> = {
  content: "内容",
  commerce: "商城",
  forum: "论坛",
  support: "客服",
  oa: "审批协同",
  generic: "空白",
};

/**
 * 应用管理（平台页）：应用总览 + 启用/停用（第 68 步：入口装配模型
 * 退役后，域名/主应用都是应用自身字段；第 75 步列表优化：加应用名称与
 * 领域模型列、去掉访问形态列、状态即开关——拨动经确认后落盘，停用后
 * 运行态全拒绝 403 app_disabled）。主应用以「是/否」开关呈现（拨开经
 * 确认后 PUT /admin/apps/:id/site 落盘；当前主应用不可关闭——主应用
 * 只能改设、不能取消；目标应用绑有专属域名时服务端拒绝、须先在该
 * 应用设置里解绑）。单应用的域名/应用别名维护在应用区「应用设置 ·
 * 域名」页签。
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
      title: next ? "启用应用" : "停用应用",
      content: next
        ? `确认启用应用 ${id}？运行态将重新可访问。`
        : `确认停用应用 ${id}？停用后运行态入口、数据、流程、助手与公开页将全部拒绝访问（403 app_disabled）；设计态与管理台不受影响。操作会写入审计。`,
      okText: next ? "启用" : "停用",
      okButtonProps: next ? {} : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusyId(id);
        try {
          await api.apps.setStatus(id, status);
          message.success(next ? "已启用" : "已停用");
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
    {
      title: "应用名称",
      dataIndex: "name",
      render: (v) => asText(v) || "—",
    },
    {
      title: "领域模型",
      dataIndex: "domain",
      render: (v) => {
        const key = asText(v);
        if (!key) return "—";
        const label = DOMAIN_LABEL[key];
        return label ? `${label}（${key}）` : key;
      },
    },
    { title: "租户", dataIndex: "tenant_id", render: (v, r) => asText(v ?? r.tenantId) },
    { title: "场景", dataIndex: "scenario", render: (v) => asText(v) },
    {
      title: "当前版本",
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
      title: "状态",
      width: 110,
      render: (_, r) => (
        <Switch
          checked={asText(r.status ?? "active") !== "disabled"}
          loading={busyId === String(r.id)}
          checkedChildren="启用"
          unCheckedChildren="停用"
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
