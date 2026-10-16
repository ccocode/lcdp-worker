import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { api, assetOpenUrl, type AssetItem } from "../api";
import { asText, fmtTime } from "../helpers";

const PAGE_SIZE = 20;

/** 字节 → 人类可读（B / KB / MB，KB 起保留一位小数） */
function fmtSize(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 关联拼显：appId · entity · recordId，缺项跳过，全空为 — */
function fmtLinkage(r: AssetItem): string {
  const parts = [r.appId, r.entity, r.recordId]
    .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export default function Assets() {
  const [rows, setRows] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [tenant, setTenant] = useState("");
  const [q, setQ] = useState("");
  // 已提交的过滤条件（点查询才生效，避免逐字打请求）
  const [filter, setFilter] = useState<{ tenant: string; q: string }>({
    tenant: "",
    q: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminAssets.list({
        tenant: filter.tenant || undefined,
        q: filter.q || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载媒体资产失败");
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilter = () => {
    setPage(1);
    setFilter({ tenant: tenant.trim(), q: q.trim() });
  };

  const uploadProps: UploadProps = {
    showUploadList: false,
    customRequest: async (options) => {
      try {
        const asset = await api.assets.upload(options.file as File);
        message.success(`已上传：${asset.name}`);
        options.onSuccess?.(asset);
        setPage(1);
        void load();
      } catch (err) {
        const text = err instanceof Error ? err.message : "上传失败";
        message.error(text);
        options.onError?.(err instanceof Error ? err : new Error(text));
      }
    },
  };

  const remove = (r: AssetItem) => {
    Modal.confirm({
      title: "删除该资产？",
      content: `将删除「${r.name}」，R2 对象与登记行一并移除，引用它的业务字段将显示为缺失。此操作不可撤销。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.adminAssets.remove(r.id);
          message.success("已删除");
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const columns: ColumnsType<AssetItem> = [
    { title: "文件名", dataIndex: "name", render: (v) => asText(v) },
    { title: "类型", dataIndex: "mime", width: 170, render: (v) => asText(v) },
    { title: "大小", dataIndex: "size", width: 100, render: (v) => fmtSize(v) },
    {
      title: "租户",
      width: 120,
      render: (_, r) => asText(r.tenantId ?? r.tenant_id),
    },
    { title: "上传人", width: 120, render: (_, r) => asText(r.createdBy) },
    { title: "关联", render: (_, r) => fmtLinkage(r) },
    {
      title: "可见性",
      dataIndex: "visibility",
      width: 100,
      render: (v) =>
        asText(v) === "public" ? (
          <Tag color="green">public</Tag>
        ) : (
          <Tag>{asText(v)}</Tag>
        ),
    },
    {
      title: "创建时间",
      width: 180,
      render: (_, r) => fmtTime(r.createdAt ?? r.created_at),
    },
    {
      title: "操作",
      width: 150,
      render: (_, r) => (
        <Space>
          <Button
            size="small"
            onClick={() => window.open(assetOpenUrl(r.contentUrl), "_blank")}
          >
            打开
          </Button>
          <Button size="small" danger onClick={() => remove(r)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="媒体资产">
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          placeholder="租户 ID（留空=全部）"
          allowClear
          style={{ width: 200 }}
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
          onPressEnter={applyFilter}
        />
        <Input
          placeholder="按文件名搜索"
          allowClear
          style={{ width: 220 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={applyFilter}
        />
        <Button onClick={applyFilter}>查询</Button>
        <Upload {...uploadProps}>
          <Button type="primary" icon={<UploadOutlined />}>
            上传文件
          </Button>
        </Upload>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey={(r) => r.id}
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showTotal: (t) => `共 ${t} 个资产`,
          onChange: (p) => setPage(p),
        }}
      />
    </Card>
  );
}
