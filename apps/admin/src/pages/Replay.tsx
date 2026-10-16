import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Segmented,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { JsonBlock, Mono, asText, fmtTime } from "../helpers";

type Kind = "conversations" | "proposals" | "flows";

/** 工具调用卡：工具名 + 参数 + 结果 + basis 放行依据原文（§16 步骤 7 点名要求） */
function ToolCallCard({ call }: { call: Row }) {
  return (
    <Card size="small" style={{ marginTop: 8 }} title={<Mono>{asText(call.tool)}</Mono>}>
      <Typography.Text type="secondary">参数</Typography.Text>
      <JsonBlock value={call.args} />
      <Typography.Text type="secondary">结果</Typography.Text>
      <JsonBlock value={call.result} />
      <Typography.Text type="secondary">放行依据（basis 原文）</Typography.Text>
      <div
        style={{
          background: "#fffbe6",
          border: "1px solid #ffe58f",
          borderRadius: 4,
          padding: "6px 8px",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {asText(call.basis)}
      </div>
      <Typography.Text type="secondary">{fmtTime(call.created_at)}</Typography.Text>
    </Card>
  );
}

function ConversationDetail({ id }: { id: string }) {
  const [data, setData] = useState<{
    conversation: Row;
    messages: Row[];
    toolCalls: Row[];
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void api.replay
      .conversation(id)
      .then((d) => alive && setData(d))
      .catch((err) =>
        message.error(err instanceof Error ? err.message : "加载会话失败"),
      );
    return () => {
      alive = false;
    };
  }, [id]);

  const callsByMessage = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const c of data?.toolCalls ?? []) {
      const mid = asText(c.message_id ?? c.messageId);
      const arr = map.get(mid) ?? [];
      arr.push(c);
      map.set(mid, arr);
    }
    return map;
  }, [data]);

  if (!data) return <Typography.Text type="secondary">加载中…</Typography.Text>;
  const conv = data.conversation;
  return (
    <div>
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="会话">{asText(conv.id)}</Descriptions.Item>
        <Descriptions.Item label="应用">{asText(conv.app_id ?? conv.appId)}</Descriptions.Item>
        <Descriptions.Item label="用户">{asText(conv.username)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtTime(conv.created_at)}</Descriptions.Item>
      </Descriptions>
      <Timeline
        items={data.messages.map((m) => {
          const isUser = asText(m.role) === "user";
          const calls = callsByMessage.get(asText(m.id)) ?? [];
          const pending = m.pending_action ?? m.pendingAction;
          return {
            color: isUser ? "blue" : "green",
            children: (
              <div>
                <Space size={8}>
                  <Tag color={isUser ? "blue" : "green"}>
                    {isUser ? "用户" : "助手"}
                  </Tag>
                  <Typography.Text type="secondary">
                    {fmtTime(m.created_at)}
                  </Typography.Text>
                </Space>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                  {asText(m.text)}
                </div>
                {pending ? (
                  <Card size="small" style={{ marginTop: 8 }} title="待确认动作留痕">
                    <JsonBlock value={pending} />
                  </Card>
                ) : null}
                {calls.map((c) => (
                  <ToolCallCard key={asText(c.id)} call={c} />
                ))}
              </div>
            ),
          };
        })}
      />
      {data.toolCalls.some(
        (c) => !data.messages.some((m) => asText(m.id) === asText(c.message_id)),
      ) ? (
        <div>
          <Typography.Title level={5}>未挂消息的工具调用</Typography.Title>
          {data.toolCalls
            .filter(
              (c) =>
                !data.messages.some((m) => asText(m.id) === asText(c.message_id)),
            )
            .map((c) => (
              <ToolCallCard key={asText(c.id)} call={c} />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function ProposalDetail({ id }: { id: string }) {
  const [p, setP] = useState<Row | null>(null);
  useEffect(() => {
    let alive = true;
    void api.replay
      .proposal(id)
      .then((d) => alive && setP(d))
      .catch((err) =>
        message.error(err instanceof Error ? err.message : "加载提案失败"),
      );
    return () => {
      alive = false;
    };
  }, [id]);
  if (!p) return <Typography.Text type="secondary">加载中…</Typography.Text>;
  const log = p.log;
  const logText = Array.isArray(log)
    ? log.map((x) => (typeof x === "string" ? x : asText(x))).join("\n")
    : asText(log);
  return (
    <div>
      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label="状态">{asText(p.status)}</Descriptions.Item>
        <Descriptions.Item label="应用">{asText(p.app_id ?? p.appId)}</Descriptions.Item>
        <Descriptions.Item label="发起人">{asText(p.username)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtTime(p.created_at)}</Descriptions.Item>
        <Descriptions.Item label="需求（prompt）">
          <span style={{ whiteSpace: "pre-wrap" }}>{asText(p.prompt)}</span>
        </Descriptions.Item>
        <Descriptions.Item label="步骤日志">
          <span style={{ whiteSpace: "pre-wrap" }}>{logText}</span>
        </Descriptions.Item>
        <Descriptions.Item label="变更（changes）">
          <JsonBlock value={p.changes} />
        </Descriptions.Item>
        <Descriptions.Item label="已勾选应用">
          <JsonBlock value={p.applied_change_ids ?? p.appliedChangeIds} />
        </Descriptions.Item>
        <Descriptions.Item label="应用时间">
          {fmtTime(p.applied_at ?? p.appliedAt)}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

function FlowDetail({ id }: { id: string }) {
  const [data, setData] = useState<{ instance: Row; tasks: Row[]; events: Row[] } | null>(
    null,
  );
  useEffect(() => {
    let alive = true;
    void api.replay
      .flow(id)
      .then((d) => alive && setData(d))
      .catch((err) =>
        message.error(err instanceof Error ? err.message : "加载流程失败"),
      );
    return () => {
      alive = false;
    };
  }, [id]);
  if (!data) return <Typography.Text type="secondary">加载中…</Typography.Text>;
  const inst = data.instance;
  return (
    <div>
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="实体">{asText(inst.entity)}</Descriptions.Item>
        <Descriptions.Item label="记录">{asText(inst.record_id ?? inst.recordId)}</Descriptions.Item>
        <Descriptions.Item label="状态">{asText(inst.status)}</Descriptions.Item>
        <Descriptions.Item label="当前节点">
          {asText(inst.current_node_label ?? inst.currentNodeLabel ?? inst.current_node)}
        </Descriptions.Item>
        <Descriptions.Item label="发起人">
          {asText(inst.created_by_name ?? inst.createdByName ?? inst.created_by)}
        </Descriptions.Item>
        <Descriptions.Item label="发起时间">{fmtTime(inst.created_at)}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5}>事件时间线</Typography.Title>
      <Timeline
        items={data.events.map((e) => ({
          children: (
            <div>
              <Space size={8}>
                <Tag>{asText(e.kind)}</Tag>
                <Typography.Text type="secondary">
                  {fmtTime(e.created_at)}
                </Typography.Text>
                {e.actor ? <span>{asText(e.actor)}</span> : null}
              </Space>
              <div style={{ whiteSpace: "pre-wrap" }}>{asText(e.message)}</div>
              {e.payload ? <JsonBlock value={e.payload} /> : null}
            </div>
          ),
        }))}
      />

      <Typography.Title level={5}>审批任务</Typography.Title>
      <Table
        size="small"
        rowKey={(r) => asText(r.id)}
        pagination={false}
        dataSource={data.tasks}
        columns={[
          { title: "节点", render: (_, r: Row) => asText(r.node_label ?? r.nodeLabel) },
          {
            title: "处理人",
            render: (_, r: Row) =>
              asText(r.acted_by ?? r.actedBy ?? r.assignee_role ?? r.assigneeRole),
          },
          { title: "状态", render: (_, r: Row) => asText(r.status) },
          { title: "意见", render: (_, r: Row) => asText(r.comment) },
          {
            title: "处理时间",
            render: (_, r: Row) => fmtTime(r.acted_at ?? r.actedAt),
          },
        ]}
      />
    </div>
  );
}

export default function Replay() {
  const [kind, setKind] = useState<Kind>("conversations");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fn =
        kind === "conversations"
          ? api.replay.conversations
          : kind === "proposals"
            ? api.replay.proposals
            : api.replay.flows;
      const res = await fn({ page, pageSize });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载回放列表失败");
    } finally {
      setLoading(false);
    }
  }, [kind, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<Row> =
    kind === "conversations"
      ? [
          { title: "会话 ID", dataIndex: "id", render: (v) => <Mono>{asText(v)}</Mono> },
          { title: "应用", render: (_, r) => asText(r.app_id ?? r.appId) },
          { title: "用户", dataIndex: "username", render: (v) => asText(v) },
          {
            title: "消息数",
            render: (_, r) => asText(r.message_count ?? r.messageCount),
          },
          { title: "创建时间", render: (_, r) => fmtTime(r.created_at) },
        ]
      : kind === "proposals"
        ? [
            { title: "提案 ID", dataIndex: "id", render: (v) => <Mono>{asText(v)}</Mono> },
            { title: "应用", render: (_, r) => asText(r.app_id ?? r.appId) },
            { title: "发起人", dataIndex: "username", render: (v) => asText(v) },
            {
              title: "需求",
              render: (_, r) => {
                const s = asText(r.prompt);
                return s.length > 60 ? `${s.slice(0, 60)}…` : s;
              },
            },
            { title: "状态", dataIndex: "status", render: (v) => asText(v) },
            { title: "创建时间", render: (_, r) => fmtTime(r.created_at) },
          ]
        : [
            { title: "实例 ID", dataIndex: "id", render: (v) => <Mono>{asText(v)}</Mono> },
            { title: "应用", render: (_, r) => asText(r.app_id ?? r.appId) },
            { title: "实体", dataIndex: "entity", render: (v) => asText(v) },
            {
              title: "记录",
              render: (_, r) => asText(r.record_id ?? r.recordId),
            },
            { title: "状态", dataIndex: "status", render: (v) => asText(v) },
            {
              title: "当前节点",
              render: (_, r) =>
                asText(r.current_node_label ?? r.currentNodeLabel ?? r.current_node),
            },
            { title: "创建时间", render: (_, r) => fmtTime(r.created_at) },
          ];

  const titles: Record<Kind, string> = {
    conversations: "助手会话回放",
    proposals: "AI 提案回放",
    flows: "流程实例回放",
  };

  return (
    <Card
      title="审计回放"
      extra={
        <Segmented
          value={kind}
          onChange={(v) => {
            setKind(v as Kind);
            setPage(1);
            setDetailId(null);
          }}
          options={[
            { label: "助手会话", value: "conversations" },
            { label: "AI 提案", value: "proposals" },
            { label: "流程实例", value: "flows" },
          ]}
        />
      }
    >
      <Table
        rowKey={(r) => asText(r.id)}
        loading={loading}
        columns={[
          ...columns,
          {
            title: "",
            width: 90,
            render: (_: unknown, r: Row) => (
              <Button size="small" onClick={() => setDetailId(asText(r.id))}>
                回放
              </Button>
            ),
          },
        ]}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
        }}
      />
      <Drawer
        title={detailId ? titles[kind] : ""}
        width={760}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        destroyOnClose
      >
        {detailId && kind === "conversations" ? (
          <ConversationDetail id={detailId} />
        ) : null}
        {detailId && kind === "proposals" ? <ProposalDetail id={detailId} /> : null}
        {detailId && kind === "flows" ? <FlowDetail id={detailId} /> : null}
      </Drawer>
    </Card>
  );
}
