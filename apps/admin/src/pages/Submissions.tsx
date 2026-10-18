import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type SubmissionItem } from "../api";
import { JsonBlock, asText, fmtTime } from "../helpers";

/**
 * 提交审核（M15 第③步通用模版）：公开表单提交（留言等）的待审队列。
 * 端点为既有 /admin/apps/:appId/submissions（通过 = 落成正式行，服务端处理）。
 * entityFilter 用于领域模版的预置入口（如内容领域的留言审核）。
 */

const STATUS_META: Record<string, { color: string; text: string }> = {
  pending: { color: "processing", text: "待处理" },
  approved: { color: "success", text: "已通过" },
  rejected: { color: "error", text: "已驳回" },
};

function summaryOf(body: Record<string, unknown>): string {
  for (const k of ["title", "name", "content", "subject"]) {
    const v = body[k];
    if (typeof v === "string" && v.trim()) return v.slice(0, 80);
  }
  const first = Object.values(body).find(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  return typeof first === "string" ? first.slice(0, 80) : "（无文本内容）";
}

export default function Submissions({
  appId,
  entityFilter,
  title,
}: {
  appId: string;
  entityFilter?: string;
  title?: string;
}) {
  const [statusTab, setStatusTab] = useState<string>("pending");
  const [rows, setRows] = useState<SubmissionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SubmissionItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.submissions.list(
        appId,
        statusTab === "all" ? undefined : statusTab,
      );
      setRows(entityFilter ? list.filter((s) => s.entity === entityFilter) : list);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载提交失败");
    } finally {
      setLoading(false);
    }
  }, [appId, statusTab, entityFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: SubmissionItem, kind: "approve" | "reject") => {
    setBusyId(row.id);
    try {
      if (kind === "approve") await api.submissions.approve(appId, row.id);
      else await api.submissions.reject(appId, row.id);
      message.success(kind === "approve" ? "已通过，内容已发布" : "已驳回");
      setDetail(null);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "处理失败");
    } finally {
      setBusyId(null);
    }
  };

  const columns: ColumnsType<SubmissionItem> = useMemo(
    () => [
      {
        title: "提交时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 170,
        render: (v: unknown) => fmtTime(v),
      },
      { title: "来源表单", dataIndex: "entity", key: "entity", width: 120 },
      {
        title: "内容摘要",
        key: "summary",
        ellipsis: true,
        render: (_: unknown, r: SubmissionItem) => summaryOf(r.body),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: 100,
        render: (v: string) => (
          <Tag color={STATUS_META[v]?.color ?? "default"}>
            {STATUS_META[v]?.text ?? v}
          </Tag>
        ),
      },
      {
        title: "处理人",
        dataIndex: "reviewedBy",
        key: "reviewedBy",
        width: 120,
        render: (v: unknown) => asText(v),
      },
      {
        title: "操作",
        key: "actions",
        width: 200,
        render: (_: unknown, r: SubmissionItem) => (
          <Space size="small">
            <Button size="small" type="link" onClick={() => setDetail(r)}>
              详情
            </Button>
            {r.status === "pending" && (
              <>
                <Button
                  size="small"
                  type="link"
                  loading={busyId === r.id}
                  onClick={() => void act(r, "approve")}
                >
                  通过
                </Button>
                <Button
                  size="small"
                  type="link"
                  danger
                  loading={busyId === r.id}
                  onClick={() => void act(r, "reject")}
                >
                  驳回
                </Button>
              </>
            )}
          </Space>
        ),
      },
    ],
    [busyId],
  );

  return (
    <Card title={title ?? "提交审核"}>
      <Space style={{ marginBottom: 16 }}>
        <Radio.Group
          value={statusTab}
          onChange={(e) => setStatusTab(e.target.value as string)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: "待处理", value: "pending" },
            { label: "已通过", value: "approved" },
            { label: "已驳回", value: "rejected" },
            { label: "全部", value: "all" },
          ]}
        />
        <Button onClick={() => void load()}>刷新</Button>
        {entityFilter && (
          <Typography.Text type="secondary">仅看表单：{entityFilter}</Typography.Text>
        )}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />
      <Modal
        title={detail ? `提交详情 · ${detail.id}` : "提交详情"}
        open={detail !== null}
        onCancel={() => setDetail(null)}
        footer={
          detail?.status === "pending"
            ? [
                <Button key="close" onClick={() => setDetail(null)}>
                  关闭
                </Button>,
                <Button
                  key="reject"
                  danger
                  loading={busyId === detail.id}
                  onClick={() => void act(detail, "reject")}
                >
                  驳回
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  loading={busyId === detail.id}
                  onClick={() => void act(detail, "approve")}
                >
                  通过并发布
                </Button>,
              ]
            : [
                <Button key="close" onClick={() => setDetail(null)}>
                  关闭
                </Button>,
              ]
        }
      >
        {detail && (
          <>
            <Typography.Paragraph type="secondary">
              来源表单 {detail.entity} · 提交于 {fmtTime(detail.createdAt)} · 状态{" "}
              {STATUS_META[detail.status]?.text ?? detail.status}
            </Typography.Paragraph>
            <JsonBlock value={detail.body} />
          </>
        )}
      </Modal>
    </Card>
  );
}
