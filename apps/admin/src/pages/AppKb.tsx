import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { statusText } from "@lcdp/ui";
import { asText } from "../helpers";

/**
 * 应用面知识库（第 81 步 G4）：知识库补应用维度——本应用的文档与
 * 待审 FAQ 在应用上下文内治理，不再只有平台管理员能管。
 * 档位口径（服务端断言、前端只呈现结果）：文档面限 t0/t1；待审队列
 * 另对 support 领域 t2 开放。两面都 403 时呈无权态；仅待审可达时
 * 只呈现待审页签（如客服角色）。
 */

function statusTag(v: unknown) {
  const s = asText(v);
  if (s === "ready" || s === "active") return <Tag color="green">{statusText(s)}</Tag>;
  if (s === "pending" || s === "pending_review")
    return <Tag color="orange">{statusText(s)}</Tag>;
  if (s === "failed") return <Tag color="red">{statusText(s)}</Tag>;
  return <Tag>{statusText(s)}</Tag>;
}

function isForbidden(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { status?: unknown }).status === 403
  );
}

export default function AppKb({ appId }: { appId: string }) {
  const [docs, setDocs] = useState<Row[]>([]);
  const [docsDenied, setDocsDenied] = useState(false);
  const [pending, setPending] = useState<Row[]>([]);
  const [pendingDenied, setPendingDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocs(await api.kb.app.documents(appId));
      setDocsDenied(false);
    } catch (err) {
      if (isForbidden(err)) setDocsDenied(true);
      else message.error(err instanceof Error ? err.message : "加载文档失败");
    }
    try {
      setPending(await api.kb.app.pending(appId));
      setPendingDenied(false);
    } catch (err) {
      if (isForbidden(err)) setPendingDenied(true);
      else message.error(err instanceof Error ? err.message : "加载待审队列失败");
    }
    setLoading(false);
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitUpload = async () => {
    const v = (await form.validateFields()) as { title: string; content: string };
    try {
      await api.kb.app.create(appId, { title: v.title, content: v.content });
      message.success("文档已创建并向量化");
      setUploadOpen(false);
      form.resetFields();
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建文档失败");
    }
  };

  const review = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.kb.app.review(appId, id, decision);
      message.success(decision === "approve" ? "已通过" : "已驳回");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审核失败");
    }
  };

  const docColumns: ColumnsType<Row> = [
    { title: "标题", dataIndex: "title", render: (v) => asText(v) },
    { title: "来源", dataIndex: "source", render: (v) => asText(v) },
    { title: "状态", dataIndex: "status", render: (v) => statusTag(v) },
    { title: "向量化", dataIndex: "embedStatus", render: (v) => statusTag(v) },
    { title: "分片", dataIndex: "chunks", render: (v) => asText(v) },
    {
      title: "操作",
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={async () => {
              try {
                await api.kb.app.reembed(appId, String(r.id));
                message.success("已重新向量化");
                void load();
              } catch (err) {
                message.error(err instanceof Error ? err.message : "重嵌失败");
              }
            }}
          >
            重新向量化
          </Button>
          <Popconfirm
            title="删除该文档及其全部向量分片？"
            onConfirm={async () => {
              try {
                await api.kb.app.remove(appId, String(r.id));
                message.success("已删除");
                void load();
              } catch (err) {
                message.error(err instanceof Error ? err.message : "删除失败");
              }
            }}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pendingColumns: ColumnsType<Row> = [
    { title: "标题", dataIndex: "title", render: (v) => asText(v) },
    { title: "来源", dataIndex: "source", render: (v) => asText(v) },
    {
      title: "内容摘要",
      render: (_, r) => {
        const s = asText(r.content);
        return s.length > 100 ? `${s.slice(0, 100)}…` : s;
      },
    },
    {
      title: "操作",
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            type="primary"
            onClick={() => void review(String(r.id), "approve")}
          >
            通过
          </Button>
          <Popconfirm
            title="驳回后该内容将被删除、不入知识库，确认？"
            onConfirm={() => void review(String(r.id), "reject")}
          >
            <Button size="small" danger>
              驳回
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (docsDenied && pendingDenied) {
    return (
      <Alert
        type="warning"
        showIcon
        message="当前身份无权管理本应用知识库"
        description="知识库文档管理限平台管理员与本应用管理员；待审队列另对客服领域角色开放。"
      />
    );
  }

  const tabs = [];
  if (!docsDenied) {
    tabs.push({
      key: "documents",
      label: "本应用文档",
      children: (
        <div>
          <div style={{ marginBottom: 12 }}>
            <Button type="primary" onClick={() => setUploadOpen(true)}>
              新增文档
            </Button>
          </div>
          <Table
            rowKey={(r) => String(r.id)}
            loading={loading}
            columns={docColumns}
            dataSource={docs}
            pagination={false}
            locale={{ emptyText: <Empty description="本应用暂无知识文档" /> }}
          />
        </div>
      ),
    });
  }
  if (!pendingDenied) {
    tabs.push({
      key: "pending",
      label: `待审队列${pending.length ? `（${pending.length}）` : ""}`,
      children: (
        <Table
          rowKey={(r) => String(r.id)}
          loading={loading}
          columns={pendingColumns}
          dataSource={pending}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无待审内容" /> }}
        />
      ),
    });
  }

  return (
    <Card title="知识库">
      <Tabs items={tabs} />
      <Modal
        title="新增知识文档（文本 / Markdown）"
        width={720}
        open={uploadOpen}
        onOk={submitUpload}
        onCancel={() => setUploadOpen(false)}
        okText="创建并向量化"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="标题"
            name="title"
            rules={[{ required: true, message: "请输入标题" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="内容"
            name="content"
            rules={[{ required: true, message: "请输入文档内容" }]}
          >
            <Input.TextArea rows={12} placeholder="粘贴制度 / 规范全文（Markdown 可）" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
