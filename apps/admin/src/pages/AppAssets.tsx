import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  Modal,
  Space,
  Upload,
  message,
} from "antd";
import { PageTable, StatusTag, showError } from "@lcdp/ui";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { api, assetOpenUrl, type AssetItem } from "../api";
import { asText, fmtSize, fmtTime } from "../helpers";

/**
 * 资产管理（第 57 步新增基础页）：按当前应用圈定——列表/删除走
 * /admin/apps/:appId/assets（第 56 步，归属按 app_id 收口），上传带 appId
 * 归属本应用。表格/打开逻辑自退役的平台资产页移植；平台不设资产总览页。
 */

const PAGE_SIZE = 20;

/** 关联拼显：entity · recordId · field，缺项跳过，全空为 — */
function fmtLinkage(r: AssetItem): string {
  const parts = [r.entity, r.recordId, r.field]
    .map((x) => (x === null || x === undefined ? "" : String(x).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export default function AppAssets({ appId }: { appId: string }) {
  const [rows, setRows] = useState<AssetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.appAssets.list(appId, {
        q: keyword || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      showError(err, "加载资产失败");
    } finally {
      setLoading(false);
    }
  }, [appId, keyword, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    customRequest: async (options) => {
      try {
        const asset = await api.assets.upload(options.file as File, appId);
        message.success(`已上传：${asset.name}`);
        options.onSuccess?.(asset);
        setPage(1);
        void load();
      } catch (err) {
        const text = err instanceof Error ? err.message : "上传失败";
        showError(err, "上传失败");
        options.onError?.(err instanceof Error ? err : new Error(text));
      }
    },
  };

  const remove = (r: AssetItem) => {
    Modal.confirm({
      title: "删除该资产？",
      content: `将删除「${r.name}」，R2 对象与登记行一并移除，引用它的业务字段将显示为缺失。此操作不可撤销（审计 asset.delete）。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.appAssets.remove(appId, r.id);
          message.success("已删除");
          void load();
        } catch (err) {
          showError(err, "删除失败");
        }
      },
    });
  };

  const columns: ColumnsType<AssetItem> = [
    { title: "文件名", dataIndex: "name", render: (v) => asText(v) },
    { title: "类型", dataIndex: "mime", width: 170, render: (v) => asText(v) },
    { title: "大小", dataIndex: "size", width: 100, render: (v) => fmtSize(v) },
    { title: "上传人", width: 120, render: (_, r) => asText(r.createdBy) },
    { title: "关联", render: (_, r) => fmtLinkage(r) },
    {
      title: "可见性",
      dataIndex: "visibility",
      width: 100,
      render: (v) => (
        <StatusTag
          raw={asText(v)}
          text={asText(v)}
          tone={asText(v) === "public" ? "green" : "gray"}
        />
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
    <Card title="资产管理">
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="按文件名搜索"
          allowClear
          style={{ width: 240 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onSearch={(v) => {
            setPage(1);
            setKeyword(v.trim());
          }}
        />
        <Upload {...uploadProps}>
          <Button type="primary" icon={<UploadOutlined />}>
            上传文件（归属本应用）
          </Button>
        </Upload>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <PageTable
        rowKey={(r) => r.id}
        loading={loading}
        columns={columns}
        dataSource={rows}
        serverPage={{
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        totalText={(t) => `共 ${t} 个资产`}
      />
    </Card>
  );
}
