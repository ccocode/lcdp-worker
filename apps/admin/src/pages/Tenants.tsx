import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Form, Input, Modal, Table, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { asText, fmtTime } from "../helpers";
import { tokens } from "@lcdp/ui";

export default function Tenants() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.tenants.list());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载租户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    form.resetFields();
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const values = (await form.validateFields()) as {
      id?: string;
      name: string;
    };
    try {
      await api.tenants.create({
        id: values.id?.trim() || undefined,
        name: values.name.trim(),
      });
      message.success("租户已创建");
      setCreateOpen(false);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const values = (await form.validateFields()) as { name: string };
    try {
      await api.tenants.update(String(editing.id), { name: values.name.trim() });
      message.success("已保存");
      setEditing(null);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  const columns: ColumnsType<Row> = [
    { title: "租户 ID", dataIndex: "id", render: (v) => asText(v) },
    { title: "名称", dataIndex: "name", render: (v) => asText(v) },
    {
      title: "创建时间",
      dataIndex: "created_at",
      render: (v, r) => fmtTime(v ?? r.createdAt),
    },
    {
      title: "操作",
      width: 160,
      render: (_, r) => (
        <Button
          size="small"
          onClick={() => {
            setEditing(r);
            form.setFieldsValue({ name: asText(r.name) });
          }}
        >
          改名
        </Button>
      ),
    },
  ];

  return (
    <Card
      title="租户"
      extra={
        <Button type="primary" onClick={openCreate}>
          新建租户
        </Button>
      }
    >
      <Table
        rowKey={(r) => String(r.id)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
      <div style={{ marginTop: 12, color: tokens.colorTextTertiary, fontSize: 12 }}>
        说明：default 为系统默认租户，不提供删除（契约约束）。
      </div>

      <Modal
        title="新建租户"
        open={createOpen}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="租户 ID（留空由服务端生成）" name="id">
            <Input placeholder="如 acme" />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入租户名称" }]}
          >
            <Input placeholder="租户名称" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="租户改名"
        open={!!editing}
        onOk={submitEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入租户名称" }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
