import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type EntryView } from "../api";

/**
 * 域名绑定（第 57 步新增基础页，Sites 页解散后的应用视角承接）：
 * 域名绑定是单应用的事——只列「绑定应用含当前应用」的入口。
 * 与平台区「应用管理」的装配编辑写同一端点（PUT /admin/entries/:id），
 * 写权同为 admin-only；operator 只读。appIds 不在此页改（归装配编辑），
 * siteMode 切换在「静态状态」页承接、不在此重复实现。
 */

const MODE_META: Record<string, { color: string; text: string }> = {
  static: { color: "success", text: "真静态" },
  pseudo: { color: "processing", text: "伪静态" },
  dynamic: { color: "default", text: "动态" },
};

export default function DomainBindings({
  appId,
  isAdmin,
}: {
  appId: string;
  isAdmin: boolean;
}) {
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<EntryView | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ hosts: string[] }>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.entries.list();
      setEntries(all.filter((e) => e.appIds.includes(appId)));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载入口失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (entry: EntryView) => {
    setEditing(entry);
    form.setFieldsValue({ hosts: entry.hosts });
  };

  const save = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const hosts = [...new Set(values.hosts.map((h) => h.trim()).filter(Boolean))];
    setSaving(true);
    try {
      await api.entries.update(editing.id, { hosts });
      message.success("域名已保存（审计 entry.update 已记录）");
      setEditing(null);
      void load();
    } catch (err) {
      // 后端口径错误（如域名已被其他入口占用）原文呈现，不吞
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<EntryView> = [
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
      title: "本应用地位",
      width: 120,
      render: (_: unknown, e: EntryView) =>
        e.appIds[0] === appId ? (
          <Tag color="blue">主应用</Tag>
        ) : (
          <Tag>绑定应用</Tag>
        ),
    },
    {
      title: "运行模式",
      dataIndex: "siteMode",
      width: 110,
      render: (v: string) => (
        <Tag color={MODE_META[v]?.color ?? "default"}>
          {MODE_META[v]?.text ?? v}
        </Tag>
      ),
    },
    ...(isAdmin
      ? [
          {
            title: "操作",
            key: "actions",
            width: 110,
            render: (_: unknown, e: EntryView) => (
              <Button size="small" type="link" onClick={() => openEdit(e)}>
                编辑域名
              </Button>
            ),
          } as ColumnsType<EntryView>[number],
        ]
      : []),
  ];

  return (
    <Card title="域名绑定">
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="本页只读：入口装配（域名与绑定应用）由平台管理员在平台区「应用管理」中维护"
        />
      )}
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={entries}
        pagination={false}
        locale={{
          emptyText: <Empty description="当前应用未绑在任何入口上（无对外域名）" />,
        }}
      />
      <Modal
        title={editing ? `编辑域名 · ${editing.name}` : "编辑域名"}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
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
        </Form>
      </Modal>
    </Card>
  );
}
