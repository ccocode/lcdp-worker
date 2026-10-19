import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type FlowTaskView, type UserInfo } from "../api";
import { asText, fmtTime } from "../helpers";

/**
 * 流程待办（第 57 步新增基础页）：队列走管理侧端点
 * GET /admin/apps/:appId/flow/tasks（第 56 步，按调用者数据权限裁剪）。
 * 两段——「待我办理」只作呈现判定（assignee 对当前用户/平台角色比对），
 * 办理执法在员工面 act 端点（只认流程指派，运营授权不赋予审批资格）；
 * 「全部待办」为数据权限内全量只读 + 催办（urge 仅发起人/admin，服务端执法）。
 */

const FETCH_LIMIT = 200;

function recordSummary(t: FlowTaskView): string {
  const rec = t.record;
  if (rec) {
    for (const k of ["title", "name", "subject", "code", "no"]) {
      const v = rec[k];
      if (typeof v === "string" && v.trim()) return v.slice(0, 60);
      if (typeof v === "number") return String(v);
    }
  }
  return t.recordId;
}

export default function FlowTasks({
  appId,
  user,
}: {
  appId: string;
  user: UserInfo;
}) {
  const [segment, setSegment] = useState<"mine" | "all">("mine");
  const [tasks, setTasks] = useState<FlowTaskView[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<FlowTaskView | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.flow.tasks(appId, {
        status: "pending",
        limit: FETCH_LIMIT,
        offset: 0,
      });
      setTasks(res.tasks);
      setServerTotal(res.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载待办失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 可办判定（仅呈现）：指派人是我，或指派角色与我的平台角色同名 */
  const isMine = useCallback(
    (t: FlowTaskView) =>
      (t.assigneeUserId !== null && t.assigneeUserId === user.id) ||
      (t.assigneeRole !== null && t.assigneeRole === user.role),
    [user.id, user.role],
  );

  const mine = useMemo(() => tasks.filter(isMine), [tasks, isMine]);
  const shown = segment === "mine" ? mine : tasks;

  const act = async (decision: "approve" | "reject") => {
    if (!acting) return;
    setBusy(true);
    try {
      await api.flow.act(appId, acting.id, decision, comment.trim() || undefined);
      message.success(decision === "approve" ? "已通过" : "已驳回");
      setActing(null);
      setComment("");
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "办理失败");
    } finally {
      setBusy(false);
    }
  };

  const urge = async (t: FlowTaskView) => {
    try {
      await api.flow.urge(appId, t.instanceId);
      message.success("已催办");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "催办失败");
    }
  };

  const columns: ColumnsType<FlowTaskView> = [
    {
      title: "节点",
      dataIndex: "nodeLabel",
      width: 140,
      render: (v: unknown, t) => asText(v ?? t.workflowId),
    },
    {
      title: "记录",
      key: "record",
      render: (_: unknown, t) => (
        <span>
          <Tag>{t.entity}</Tag>
          {recordSummary(t)}
        </span>
      ),
    },
    {
      title: "发起人",
      width: 120,
      render: (_: unknown, t) => asText(t.instance.createdByName),
    },
    {
      title: "指派给",
      width: 140,
      render: (_: unknown, t) =>
        t.assigneeName ?? (t.assigneeRole ? `角色：${t.assigneeRole}` : "—"),
    },
    {
      title: "到达时间",
      dataIndex: "createdAt",
      width: 170,
      render: (v: unknown) => fmtTime(v),
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_: unknown, t) =>
        segment === "mine" ? (
          <Button size="small" type="link" onClick={() => setActing(t)}>
            办理
          </Button>
        ) : (
          <Button size="small" type="link" onClick={() => void urge(t)}>
            催办
          </Button>
        ),
    },
  ];

  return (
    <Card title="流程待办">
      <Space style={{ marginBottom: 16 }} wrap>
        <Radio.Group
          value={segment}
          onChange={(e) => setSegment(e.target.value as "mine" | "all")}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: `待我办理（${mine.length}）`, value: "mine" },
            { label: `全部待办（${serverTotal}）`, value: "all" },
          ]}
        />
        <Button onClick={() => void load()}>刷新</Button>
        <Typography.Text type="secondary">
          办理按流程指派执法：运营授权不赋予审批资格，指派给他人时办理会被拒绝。
        </Typography.Text>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={shown}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{
          emptyText: (
            <Empty
              description={
                segment === "mine"
                  ? "暂无待你办理的事项"
                  : "当前没有待办（本应用可能未配置流程，或队列已清空）"
              }
            />
          ),
        }}
      />
      <Modal
        title={acting ? `办理 · ${acting.nodeLabel ?? acting.workflowId}` : "办理"}
        open={acting !== null}
        onCancel={() => setActing(null)}
        footer={[
          <Button key="cancel" onClick={() => setActing(null)}>
            取消
          </Button>,
          <Button
            key="reject"
            danger
            loading={busy}
            onClick={() => void act("reject")}
          >
            驳回
          </Button>,
          <Button
            key="approve"
            type="primary"
            loading={busy}
            onClick={() => void act("approve")}
          >
            通过
          </Button>,
        ]}
      >
        {acting && (
          <>
            <Typography.Paragraph type="secondary">
              {acting.entity} · {recordSummary(acting)} · 发起人{" "}
              {asText(acting.instance.createdByName)} · {fmtTime(acting.createdAt)}
            </Typography.Paragraph>
            <Input.TextArea
              rows={3}
              placeholder="审批意见（可选）"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}
