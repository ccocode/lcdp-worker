import React, { useCallback, useEffect, useState } from "react";
import {
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

function statusTag(v: unknown) {
  const s = asText(v);
  if (s === "ready" || s === "active") return <Tag color="green">{statusText(s)}</Tag>;
  if (s === "pending" || s === "pending_review")
    return <Tag color="orange">{statusText(s)}</Tag>;
  if (s === "failed") return <Tag color="red">{statusText(s)}</Tag>;
  return <Tag>{statusText(s)}</Tag>;
}

function Documents() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [appFilter, setAppFilter] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.kb.documents(appFilter || undefined));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载文档失败");
    } finally {
      setLoading(false);
    }
  }, [appFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitUpload = async () => {
    const v = (await form.validateFields()) as {
      appId: string;
      title: string;
      content: string;
    };
    try {
      await api.kb.create({
        appId: v.appId.trim(),
        title: v.title.trim(),
        content: v.content,
      });
      message.success("已上传并完成向量化（结果见列表「向量化」列）");
      setUploadOpen(false);
      form.resetFields();
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    }
  };

  const columns: ColumnsType<Row> = [
    { title: "标题", dataIndex: "title", render: (v) => asText(v) },
    { title: "应用", render: (_, r) => asText(r.app_id ?? r.appId) },
    { title: "来源", dataIndex: "source", render: (v) => asText(v) },
    { title: "状态", dataIndex: "status", render: (v) => statusTag(v) },
    {
      title: "向量化",
      render: (_, r) => statusTag(r.embedStatus ?? r.embed_status),
    },
    {
      title: "Chunk 数",
      render: (_, r) => asText(r.chunks ?? r.chunk_count ?? r.chunkCount),
    },
    {
      title: "操作",
      width: 170,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={async () => {
              try {
                await api.kb.reembed(String(r.id));
                message.success("已触发重新向量化");
                void load();
              } catch (err) {
                message.error(err instanceof Error ? err.message : "重新向量化失败");
              }
            }}
          >
            重新向量化
          </Button>
          <Popconfirm
            title="删除该文档？其向量片段将一并移除，助手将不再引用它。"
            okText="删除"
            cancelText="取消"
            onConfirm={async () => {
              try {
                await api.kb.remove(String(r.id));
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

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="按应用 ID 筛选（留空 = 全部）"
          allowClear
          style={{ width: 240 }}
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
        />
        <Button onClick={() => void load()}>查询</Button>
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setUploadOpen(true);
          }}
        >
          上传文档
        </Button>
        <Button onClick={() => void load()}>刷新状态</Button>
      </Space>
      <Table
        rowKey={(r) => String(r.id)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
      <Modal
        title="上传知识文档（文本 / Markdown）"
        width={720}
        open={uploadOpen}
        onOk={submitUpload}
        onCancel={() => setUploadOpen(false)}
        okText="上传并向量化"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="所属应用 ID"
            name="appId"
            rules={[{ required: true, message: "请输入应用 ID" }]}
          >
            <Input placeholder="如 procurement-inventory；平台通用文档填 platform" />
          </Form.Item>
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
    </div>
  );
}

function PendingReview() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.kb.pending());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载待审队列失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.kb.review(id, decision);
      message.success(decision === "approve" ? "已通过" : "已驳回");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审核失败");
    }
  };

  const columns: ColumnsType<Row> = [
    { title: "标题", dataIndex: "title", render: (v) => asText(v) },
    { title: "应用", render: (_, r) => asText(r.app_id ?? r.appId) },
    { title: "来源", dataIndex: "source", render: (v) => asText(v) },
    {
      title: "内容摘要",
      render: (_, r) => {
        const s = asText(r.content ?? r.snippet);
        return s.length > 100 ? `${s.slice(0, 100)}…` : s;
      },
    },
    {
      title: "操作",
      width: 160,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" onClick={() => void review(String(r.id), "approve")}>
            通过
          </Button>
          <Button size="small" danger onClick={() => void review(String(r.id), "reject")}>
            驳回
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Table
      rowKey={(r) => String(r.id)}
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={false}
      locale={{
        emptyText: (
          <Empty description="暂无待审" />
        ),
      }}
    />
  );
}

export default function Kb() {
  return (
    <Card title="知识库">
      {/* 页签切换销毁非活动面板：两面板均只在挂载时取数，不销毁则切换后
          长期停在首次数据（待审队列尤其误导），销毁后每次切入按既有挂载取数重拉 */}
      <Tabs
        destroyInactiveTabPane
        items={[
          { key: "docs", label: "文档", children: <Documents /> },
          { key: "pending", label: "FAQ 待审", children: <PendingReview /> },
        ]}
      />
    </Card>
  );
}
