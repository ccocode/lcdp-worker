import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type AdminDataMeta,
  type Row,
  type TranscriptView,
} from "../api";
import { asText, fmtTime } from "../helpers";
import { consumeTicketQueueIntent } from "../templates/ticketQueueIntent";

/**
 * 工单工作台（第 58 步专做，客服领域模版）：状态队列 + 行内受理/流转 +
 * 工单详情专用抽屉（工单字段 + 会话记录 + 处理表单），对应运行态
 * /ticket-detail 的三件套。队列分段取运行时 meta 的 ticket.status
 * options；会话记录走第 56 步 transcript 只读端点，无会话/404 显空态。
 */

/** 状态徽标色：沿用呈现层默认色板口径（待*→amber、处理中→blue、已解决→green、已关闭→gray） */
function statusColor(status: string): string {
  if (status.startsWith("待")) return "gold";
  if (status === "处理中") return "blue";
  if (status === "已解决") return "green";
  return "default";
}

/** 会话消息角色标注：visitor=访客、assistant=助手，其余原样 */
function roleLabel(role: string): string {
  if (role === "visitor") return "访客";
  if (role === "assistant") return "助手";
  return role;
}

export default function SupportTickets({
  appId,
  meta,
}: {
  appId: string;
  meta: AdminDataMeta;
}) {
  const roles = meta.domainModules?.roles ?? {};
  const ticketKey = roles["ticket"] ?? "after_sale_ticket";
  const ticketMeta = meta.entities.find((e) => e.key === ticketKey);
  const canUpdate = (ticketMeta?.actions ?? []).includes("update");

  const statusValues = useMemo(() => {
    const f = ticketMeta?.fields.find((x) => x.key === "status");
    return (f?.options ?? []).map((o) => (typeof o === "string" ? o : o.value));
  }, [ticketMeta]);
  const statusOptions = useMemo(
    () => statusValues.map((v) => ({ label: v, value: v })),
    [statusValues],
  );

  const [queue, setQueue] = useState<string>(() => {
    const intent = consumeTicketQueueIntent();
    return intent && intent !== "all" ? intent : "all";
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [detail, setDetail] = useState<Row | null>(null);
  const [transcript, setTranscript] = useState<TranscriptView | null>(null);
  const [transcriptState, setTranscriptState] = useState<"idle" | "loading" | "none" | "ok">("idle");
  const [handleStatus, setHandleStatus] = useState<string | undefined>(undefined);
  const [handleSummary, setHandleSummary] = useState("");
  const [handling, setHandling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminData.list(appId, ticketKey, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        filters: queue === "all" ? undefined : { status: queue },
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载工单失败");
    } finally {
      setLoading(false);
    }
  }, [appId, ticketKey, queue, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [queue]);

  const openDetail = (row: Row) => {
    setDetail(row);
    setHandleStatus(row.status ? String(row.status) : undefined);
    setHandleSummary(typeof row.summary === "string" ? row.summary : "");
    const cid =
      typeof row.conversation_id === "string" && row.conversation_id
        ? row.conversation_id
        : null;
    setTranscript(null);
    if (!cid) {
      setTranscriptState("none");
      return;
    }
    setTranscriptState("loading");
    void api.adminData
      .transcript(appId, cid)
      .then((t) => {
        setTranscript(t);
        setTranscriptState("ok");
      })
      .catch(() => {
        // 会话不存在/不属本应用（404）→ 空态呈现，不当错误打扰
        setTranscript(null);
        setTranscriptState("none");
      });
  };

  /** 行内状态流转：二次确认后 admindata 更新并刷新 */
  const act = (row: Row, to: string, verb: string) => {
    Modal.confirm({
      title: `确认${verb}？`,
      content: `工单「${asText(row.title)}」的状态将改为「${to}」（操作记入审计）。`,
      okText: verb,
      cancelText: "取消",
      onOk: async () => {
        try {
          // 第 65 步：以回读实际状态为准播报，字段被权限剔除时不再报假成功
          const { row: updated, strippedFields } = await api.adminData.update(appId, ticketKey, String(row.id), { status: to });
          const actual = String(updated?.status ?? "");
          if (actual === to) {
            message.success(`已${verb}（操作已记入审计）`);
          } else if (strippedFields.includes("status")) {
            message.warning(`状态未变更（仍为「${actual}」）：「状态」不在你的可写字段内`);
          } else {
            message.warning(`状态未变更（仍为「${actual}」），请刷新后核对`);
          }
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : `${verb}失败`);
        }
      },
    });
  };

  const saveHandling = async () => {
    if (!detail) return;
    setHandling(true);
    try {
      const { row: updated, strippedFields } = await api.adminData.update(appId, ticketKey, String(detail.id), {
        status: handleStatus,
        summary: handleSummary,
      });
      setDetail(updated);
      if (strippedFields.length) {
        const names: Record<string, string> = { status: "状态", summary: "处理摘要" };
        message.warning(
          `已保存其余内容；以下字段不在你的可写范围内，未保存：${strippedFields.map((k) => names[k] ?? k).join("、")}`,
        );
      } else {
        message.success("已保存处理结果（操作已记入审计）");
      }
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setHandling(false);
    }
  };

  const rowActions = (row: Row) => {
    const status = String(row.status ?? "");
    return (
      <Space size="small">
        <Button size="small" type="link" onClick={() => openDetail(row)}>
          详情
        </Button>
        {canUpdate && status === "待受理" && statusValues.includes("处理中") && (
          <Button size="small" type="link" onClick={() => act(row, "处理中", "受理")}>
            受理
          </Button>
        )}
        {canUpdate && status === "处理中" && statusValues.includes("已解决") && (
          <Button size="small" type="link" onClick={() => act(row, "已解决", "解决")}>
            解决
          </Button>
        )}
        {canUpdate && status !== "已关闭" && statusValues.includes("已关闭") && (
          <Button size="small" type="link" danger onClick={() => act(row, "已关闭", "关闭")}>
            关闭
          </Button>
        )}
      </Space>
    );
  };

  const columns: ColumnsType<Row> = [
    { title: "标题", dataIndex: "title", key: "title", render: (v: unknown) => asText(v) },
    { title: "分类", dataIndex: "category", key: "category", render: (v: unknown) => asText(v) },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: unknown) => <Tag color={statusColor(asText(v))}>{asText(v)}</Tag>,
    },
    {
      title: "访客",
      dataIndex: "visitor_name",
      key: "visitor_name",
      render: (v: unknown) => asText(v),
    },
    { title: "来源", dataIndex: "source", key: "source", render: (v: unknown) => asText(v) },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v: unknown) => fmtTime(v),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, row: Row) => rowActions(row),
    },
  ];

  return (
    <Card title="工单工作台">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Segmented
          value={queue}
          onChange={(v) => setQueue(String(v))}
          options={[
            { label: "全部", value: "all" },
            ...statusValues.map((v) => ({ label: v, value: v })),
          ]}
        />
        <Table
          rowKey={(r) => String(r.id)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, s) => {
              setPage(p);
              setPageSize(s);
            },
          }}
        />
      </Space>
      <Drawer
        title={detail ? `工单详情 · ${asText(detail.title)}` : "工单详情"}
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={680}
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Descriptions column={1} size="small" bordered>
              {(ticketMeta?.fields ?? []).map((f) => (
                <Descriptions.Item key={f.key} label={f.label}>
                  {f.key === "status" ? (
                    <Tag color={statusColor(asText(detail[f.key]))}>
                      {asText(detail[f.key])}
                    </Tag>
                  ) : f.type === "datetime" || f.type === "date" ? (
                    fmtTime(detail[f.key])
                  ) : f.key === "description" ? (
                    <span style={{ whiteSpace: "pre-wrap" }}>{asText(detail[f.key])}</span>
                  ) : (
                    asText(detail[f.key])
                  )}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label="创建时间">
                {fmtTime(detail.created_at)}
              </Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: "4px 0" }} />
            <Typography.Title level={5} style={{ margin: 0 }}>
              会话记录
            </Typography.Title>
            {transcriptState === "loading" && <Spin tip="加载会话记录…" />}
            {transcriptState === "none" && (
              <Empty description="无关联会话记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
            {transcriptState === "ok" && transcript && (
              <Space direction="vertical" size="small" style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  会话 {transcript.conversation.id} · 状态 {transcript.conversation.status}
                  {transcript.conversation.visitorName
                    ? ` · 访客 ${transcript.conversation.visitorName}`
                    : ""}
                </Typography.Text>
                {transcript.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      border: "1px solid #eef0f3",
                      borderRadius: 6,
                      padding: "8px 12px",
                      background: m.role === "visitor" ? "#f8f9fb" : undefined,
                    }}
                  >
                    <Space size="small">
                      <Tag>{roleLabel(m.role)}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtTime(m.createdAt)}
                      </Typography.Text>
                    </Space>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.text}</div>
                  </div>
                ))}
              </Space>
            )}

            <Divider style={{ margin: "4px 0" }} />
            <Typography.Title level={5} style={{ margin: 0 }}>
              处理
            </Typography.Title>
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <Select
                value={handleStatus}
                onChange={(v) => setHandleStatus(v)}
                options={statusOptions}
                disabled={!canUpdate}
                style={{ width: 200 }}
                placeholder="选择状态"
              />
              <Input.TextArea
                rows={3}
                value={handleSummary}
                onChange={(e) => setHandleSummary(e.target.value)}
                disabled={!canUpdate}
                placeholder="问题摘要（处理结论/要点）"
              />
              <Button
                type="primary"
                loading={handling}
                disabled={!canUpdate}
                onClick={() => void saveHandling()}
              >
                保存处理
              </Button>
              {!canUpdate && (
                <Typography.Text type="secondary">
                  你对工单只有读取权限，处理区只读呈现。
                </Typography.Text>
              )}
            </Space>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
