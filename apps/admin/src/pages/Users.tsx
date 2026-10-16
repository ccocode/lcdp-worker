import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row, type UserInfo } from "../api";
import { asText, fmtTime } from "../helpers";

/** 常见角色（服务端接受任意非空字符串，下拉外也可手填） */
const ROLE_OPTIONS = [
  "admin",
  "manager",
  "director",
  "finance",
  "employee",
  "warehouse",
];

export default function Users({ currentUser }: { currentUser: UserInfo }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.users.list());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = async () => {
    const v = (await form.validateFields()) as {
      username: string;
      password: string;
      role: string;
      displayName?: string;
      departmentId?: string;
    };
    try {
      await api.users.create({
        username: v.username.trim(),
        password: v.password,
        role: v.role,
        displayName: v.displayName?.trim() || null,
        departmentId: v.departmentId?.trim() || null,
      });
      message.success("用户已创建");
      setCreateOpen(false);
      form.resetFields();
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    const v = (await form.validateFields()) as {
      role: string;
      displayName?: string;
      departmentId?: string;
      password?: string;
    };
    try {
      await api.users.update(String(editing.id), {
        role: v.role,
        displayName: v.displayName?.trim() || null,
        departmentId: v.departmentId?.trim() || null,
        ...(v.password ? { password: v.password } : {}),
      });
      message.success("已保存");
      setEditing(null);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  const columns: ColumnsType<Row> = [
    { title: "用户名", dataIndex: "username", render: (v) => asText(v) },
    {
      title: "角色",
      dataIndex: "role",
      render: (v) => <Tag color={v === "admin" ? "red" : "blue"}>{asText(v)}</Tag>,
    },
    {
      title: "显示名",
      render: (_, r) => asText(r.displayName ?? r.display_name),
    },
    {
      title: "部门",
      render: (_, r) => asText(r.departmentId ?? r.department_id),
    },
    {
      title: "创建时间",
      render: (_, r) => fmtTime(r.createdAt ?? r.created_at),
    },
    {
      title: "操作",
      width: 180,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditing(r);
              form.setFieldsValue({
                role: asText(r.role),
                displayName: (r.displayName as string) ?? "",
                departmentId: (r.departmentId as string) ?? "",
                password: undefined,
              });
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title={`删除用户 ${asText(r.username)}？`}
            description={
              String(r.id) === currentUser.id
                ? "不能删除自己的账号（服务端也会拒绝）"
                : undefined
            }
            okText="删除"
            cancelText="取消"
            disabled={String(r.id) === currentUser.id}
            onConfirm={async () => {
              try {
                await api.users.remove(String(r.id));
                message.success("已删除");
                void load();
              } catch (err) {
                message.error(err instanceof Error ? err.message : "删除失败");
              }
            }}
          >
            <Button size="small" danger disabled={String(r.id) === currentUser.id}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="用户与角色（当前租户）"
      extra={
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setCreateOpen(true);
          }}
        >
          新建用户
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

      <Modal
        title="新建用户"
        open={createOpen}
        onOk={submitCreate}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入初始密码" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: "请选择或输入角色" }]}
          >
            <Select
              mode="tags"
              maxCount={1}
              options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
              placeholder="选择常用角色或输入自定义角色"
            />
          </Form.Item>
          <Form.Item label="显示名" name="displayName">
            <Input />
          </Form.Item>
          <Form.Item label="部门 ID" name="departmentId">
            <Input placeholder="如 dep-01" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑用户 ${editing ? asText(editing.username) : ""}`}
        open={!!editing}
        onOk={submitEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: "请选择或输入角色" }]}
          >
            <Select
              mode="tags"
              maxCount={1}
              options={ROLE_OPTIONS.map((r) => ({ value: r, label: r }))}
            />
          </Form.Item>
          <Form.Item label="显示名" name="displayName">
            <Input />
          </Form.Item>
          <Form.Item label="部门 ID" name="departmentId">
            <Input />
          </Form.Item>
          <Form.Item label="重置密码（留空不改）" name="password">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
