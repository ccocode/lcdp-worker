import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type EntryView, type Row } from "../api";
import { asText } from "../helpers";

/**
 * 应用管理（平台页）：应用上下架 + 入口装配编辑（第 57 步，Sites 页解散
 * 后的平台视角承接）。装配写走 PUT /admin/entries/:id（第 56 步 admin
 * 分支：hosts/appIds 可写，审计 entry.update）；应用区「域名绑定」页是
 * 同一端点的单应用视角（写权同为 admin-only）。
 */
export default function Apps() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [editing, setEditing] = useState<EntryView | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ hosts: string[]; appIds: string[] }>();

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

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      setEntries(await api.entries.list());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载入口装配失败");
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadEntries();
  }, [load, loadEntries]);

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

  const openAssembly = (entry: EntryView) => {
    setEditing(entry);
    form.setFieldsValue({ hosts: entry.hosts, appIds: entry.appIds });
  };

  const saveAssembly = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const hosts = [...new Set(values.hosts.map((h) => h.trim()).filter(Boolean))];
    setSaving(true);
    try {
      await api.entries.update(editing.id, { hosts, appIds: values.appIds });
      message.success("装配已保存（审计 entry.update 已记录）");
      setEditing(null);
      void loadEntries();
    } catch (err) {
      // 后端口径错误（域名已被其他入口占用 / 应用不属于本租户等）原文呈现
      message.error(err instanceof Error ? err.message : "保存装配失败");
    } finally {
      setSaving(false);
    }
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

  const entryColumns: ColumnsType<EntryView> = [
    { title: "入口", dataIndex: "name", width: 180 },
    {
      title: "域名",
      dataIndex: "hosts",
      render: (hosts: string[]) => (
        <Space size={[4, 4]} wrap>
          {hosts.map((h) => (
            <Tag key={h}>{h}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "绑定应用（首位 = 主应用）",
      dataIndex: "appIds",
      render: (appIds: string[]) => (
        <Space size={[4, 4]} wrap>
          {appIds.map((id, i) => (
            <Tag key={id} color={i === 0 ? "blue" : undefined}>
              {id}
              {i === 0 ? " · 主" : ""}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_: unknown, e: EntryView) => (
        <Button size="small" type="link" onClick={() => openAssembly(e)}>
          编辑装配
        </Button>
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
      </Card>
      <Card
        title="入口装配"
        extra={
          <Typography.Text type="secondary">
            入口与应用的装配在此统一维护；单应用视角见应用区「域名绑定」
          </Typography.Text>
        }
      >
        <Table
          rowKey="id"
          loading={entriesLoading}
          columns={entryColumns}
          dataSource={entries}
          pagination={false}
        />
      </Card>
      <Modal
        title={editing ? `编辑装配 · ${editing.name}` : "编辑装配"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveAssembly()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="hosts"
            label="域名（回车分隔多个；不可与其他入口重复）"
            rules={[{ required: true, message: "至少填写一个域名" }]}
          >
            <Select
              mode="tags"
              tokenSeparators={[",", " "]}
              placeholder="如 www.example.com"
              open={false}
            />
          </Form.Item>
          <Form.Item
            name="appIds"
            label="绑定应用（顺序首位为主应用；仅限本租户应用）"
            rules={[{ required: true, message: "至少绑定一个应用" }]}
          >
            <Select
              mode="multiple"
              placeholder="选择应用"
              options={rows.map((r) => ({
                value: String(r.id),
                label: `${asText(r.name ?? r.id)}（${String(r.id)}）`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
