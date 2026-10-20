import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  LoadingState,
  errText,
  fmtTime,
  showError,
} from "@lcdp/ui";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from "antd";
import type { Row } from "@lcdp/renderer";
import type { DataSchema } from "@naka1205/schema";
import type {
  FlowDoneTask,
  FlowEvent,
  FlowInstanceDetail,
  FlowMineInstance,
  FlowStartable,
  FlowTodoTask,
  UserInfo,
} from "./api.js";
import { api } from "./api.js";

type EntityDef = DataSchema["entities"][number];

/**
 * 待办中心（M5）：登录用户的流程工作台。
 * 四区——待我审批 / 我发起的（含发起流程）/ 已处理 / 通知；
 * 数据全部走 flow 接口（服务端按当前用户过滤、记录摘要已按权限整形），前端只做呈现与动作转发。
 */
export interface FlowCenterProps {
  appId: string;
  user: UserInfo;
  /** 当前应用的实体定义（记录摘要取字段标签、发起区筛非子表实体用） */
  entities: DataSchema["entities"];
  /** 待办数变化时回告外壳，刷新侧边菜单 Badge */
  onTodoCountChange?: (count: number) => void;
}

/* fmtTime / errText 单一实现已收编 @lcdp/ui（第 73 步片二），本文件直接引 ui 版 */

/* ---------- 记录摘要：record 是经服务端整形的行对象，取标识字段 + 关键字段通用渲染 ---------- */

const TITLE_KEYS = ["name", "title", "order_no", "in_no", "req_no", "code"];
const SUMMARY_KEYS = [
  "order_no",
  "in_no",
  "req_no",
  "code",
  "total_amount",
  "status",
  "applicant",
  "requester",
  "operator",
  "created_date",
  "in_date",
  "req_date",
];

function recordTitle(record: Row): string {
  for (const key of TITLE_KEYS) {
    const v = record[key];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return String(record.id ?? "");
}

function summaryPairs(
  entity: EntityDef | undefined,
  record: Row,
): { label: string; value: string }[] {
  const pairs: { label: string; value: string }[] = [];
  const used = new Set<string>();
  const push = (key: string) => {
    if (used.has(key) || key === "id") return;
    const v = record[key];
    if (v === null || v === undefined || v === "" || typeof v === "object") {
      return;
    }
    used.add(key);
    const field = entity?.fields.find((f) => f.key === key);
    let value = typeof v === "boolean" ? (v ? "是" : "否") : String(v);
    if (field?.type === "enum" && field.options) {
      value = field.options.find((o) => o.value === v)?.label ?? value;
    }
    pairs.push({ label: field?.label ?? key, value });
  };
  for (const key of SUMMARY_KEYS) push(key);
  if (entity) {
    for (const f of entity.fields) {
      if (pairs.length >= 5) break;
      push(f.key);
    }
  }
  return pairs.slice(0, 5);
}

function RecordSummary({
  entity,
  record,
}: {
  entity?: EntityDef;
  record: Row;
}) {
  const pairs = summaryPairs(entity, record);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{recordTitle(record)}</div>
      {pairs.length > 0 && (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
          {pairs.map((p) => `${p.label}：${p.value}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

/* ---------- 状态与事件呈现 ---------- */

function instanceStatusTag(status: string) {
  if (status === "running") return <Tag color="processing">进行中</Tag>;
  if (status === "approved") return <Tag color="success">已通过</Tag>;
  if (status === "rejected") return <Tag color="error">已驳回</Tag>;
  return <Tag>未知状态</Tag>;
}

function taskStatusTag(status: string) {
  if (status === "pending") return <Tag color="gold">待处理</Tag>;
  if (status === "approved") return <Tag color="success">已批准</Tag>;
  if (status === "rejected") return <Tag color="error">已驳回</Tag>;
  if (status === "cancelled") return <Tag>已取消</Tag>;
  return <Tag>未知状态</Tag>;
}

const EVENT_META: Record<string, { label: string; color: string }> = {
  start: { label: "已发起", color: "blue" },
  task_created: { label: "新任务", color: "blue" },
  approve: { label: "已批准", color: "green" },
  reject: { label: "已驳回", color: "red" },
  urge: { label: "催办", color: "orange" },
  task_action: { label: "自动动作", color: "default" },
  webhook: { label: "Webhook 事件", color: "default" },
  low_stock: { label: "低库存", color: "red" },
  complete: { label: "已完成", color: "green" },
  cc: { label: "抄送", color: "purple" },
};

function eventTag(kind: string) {
  const meta = EVENT_META[kind] ?? { label: "未知事件", color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function timelineColor(kind: string): string {
  if (kind === "reject" || kind === "low_stock") return "red";
  if (kind === "complete" || kind === "approve") return "green";
  if (kind === "urge") return "orange";
  return "blue";
}

/* ---------- 主组件 ---------- */

export default function FlowCenter({
  appId,
  user,
  entities,
  onTodoCountChange,
}: FlowCenterProps) {
  const [tab, setTab] = useState("todos");
  const [error, setError] = useState<string | null>(null);
  const [todos, setTodos] = useState<FlowTodoTask[] | null>(null);
  const [done, setDone] = useState<FlowDoneTask[] | null>(null);
  const [mine, setMine] = useState<FlowMineInstance[] | null>(null);
  const [notes, setNotes] = useState<FlowEvent[] | null>(null);

  // 处理（批准/驳回）弹窗
  const [actTask, setActTask] = useState<FlowTodoTask | null>(null);
  const [actDecision, setActDecision] = useState<"approve" | "reject">(
    "approve",
  );
  const [actComment, setActComment] = useState("");
  const [actBusy, setActBusy] = useState(false);

  // 进度抽屉
  const [detail, setDetail] = useState<FlowInstanceDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // 发起流程区
  const [startEntity, setStartEntity] = useState<string | undefined>(
    undefined,
  );
  const [startable, setStartable] = useState<FlowStartable | null>(null);
  const [startableLoading, setStartableLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);

  const [urgingId, setUrgingId] = useState<string | null>(null);

  const entityOf = useCallback(
    (key: string) => entities.find((e) => e.key === key),
    [entities],
  );
  const entityLabel = useCallback(
    (key: string) => entityOf(key)?.label ?? key,
    [entityOf],
  );

  const loadTodos = useCallback(async () => {
    try {
      const tasks = await api.flow.todos(appId);
      setTodos(tasks);
      onTodoCountChange?.(tasks.length);
    } catch (err) {
      setError(errText(err));
    }
  }, [appId, onTodoCountChange]);

  const loadDone = useCallback(async () => {
    try {
      setDone(await api.flow.done(appId));
    } catch (err) {
      setError(errText(err));
    }
  }, [appId]);

  const loadMine = useCallback(async () => {
    try {
      setMine(await api.flow.mine(appId));
    } catch (err) {
      setError(errText(err));
    }
  }, [appId]);

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await api.flow.notifications(appId));
    } catch (err) {
      setError(errText(err));
    }
  }, [appId]);

  // 切页签即重拉该页签列表：在别处（其他页签内处理、助手、他人）变动过的
  // 任务，回到该页签应见最新状态——此前仅首次为 null 时懒加载，会话内长期
  // 停在旧数据、只能手点刷新。手动「刷新」按钮保留（refresh 不变）。
  useEffect(() => {
    if (tab === "todos") void loadTodos();
    if (tab === "done") void loadDone();
    if (tab === "mine") void loadMine();
    if (tab === "notes") void loadNotes();
  }, [tab, loadTodos, loadDone, loadMine, loadNotes]);

  const refresh = () => {
    setError(null);
    void loadTodos();
    if (tab === "done") void loadDone();
    if (tab === "mine") void loadMine();
    if (tab === "notes") void loadNotes();
  };

  const openDetail = async (instanceId: string) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await api.flow.instance(appId, instanceId));
    } catch (err) {
      showError(err);
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openAct = (task: FlowTodoTask, decision: "approve" | "reject") => {
    setActTask(task);
    setActDecision(decision);
    setActComment("");
  };

  const submitAct = async () => {
    if (!actTask) return;
    setActBusy(true);
    try {
      await api.flow.act(
        appId,
        actTask.id,
        actDecision,
        actComment.trim() || undefined,
      );
      void message.success(actDecision === "approve" ? "已批准" : "已驳回");
      setActTask(null);
      // 待办立即刷新（Badge 同步）；已处理/我发起的失效后切过去时重拉
      setDone(null);
      setMine(null);
      await loadTodos();
    } catch (err) {
      showError(err);
    } finally {
      setActBusy(false);
    }
  };

  const urge = async (instanceId: string) => {
    setUrgingId(instanceId);
    try {
      await api.flow.urge(appId, instanceId);
      void message.success("已催办，当前审批人将收到通知");
    } catch (err) {
      showError(err);
    } finally {
      setUrgingId(null);
    }
  };

  const loadStartable = async (entity: string) => {
    setStartable(null);
    setStartableLoading(true);
    try {
      setStartable(await api.flow.startable(appId, entity));
    } catch (err) {
      showError(err);
    } finally {
      setStartableLoading(false);
    }
  };

  const startFlow = async (record: Row) => {
    if (!startEntity) return;
    const recordId = String(record.id);
    setStartingId(recordId);
    try {
      await api.flow.start(appId, startEntity, recordId);
      void message.success("流程已发起");
      setMine(null);
      await loadMine();
      await loadStartable(startEntity);
    } catch (err) {
      showError(err);
    } finally {
      setStartingId(null);
    }
  };

  const startEntityOptions = useMemo(
    () =>
      entities
        .filter((e) => !e.parentField)
        .map((e) => ({ value: e.key, label: `${e.label}（${e.key}）` })),
    [entities],
  );

  /* ---------- 各页签内容 ---------- */

  const todosPane =
    todos === null ? (
      <div style={{ padding: 40, textAlign: "center" }}>
        <LoadingState tip="正在加载待办…" />
      </div>
    ) : todos.length === 0 ? (
      <EmptyState description="暂无待我审批的任务" />
    ) : (
      <List
        dataSource={todos}
        renderItem={(task) => (
          <List.Item>
            <Card
              size="small"
              hoverable
              style={{ width: "100%" }}
              onClick={() => void openDetail(task.instanceId)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <RecordSummary
                  entity={entityOf(task.entity)}
                  record={task.record}
                />
                <Space size={4} style={{ flexShrink: 0 }}>
                  <Tag color="blue">{entityLabel(task.entity)}</Tag>
                  {task.mode === "all" && <Tag color="purple">会签</Tag>}
                </Space>
              </div>
              <div
                style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}
              >
                当前步骤：{task.nodeLabel} · 发起人：
                {task.instance.createdByName} · 到达：{fmtTime(task.createdAt)}
              </div>
              <Space
                style={{ marginTop: 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="primary"
                  size="small"
                  onClick={() => openAct(task, "approve")}
                >
                  批准
                </Button>
                <Button
                  danger
                  size="small"
                  onClick={() => openAct(task, "reject")}
                >
                  驳回
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => void openDetail(task.instanceId)}
                >
                  查看进度
                </Button>
              </Space>
            </Card>
          </List.Item>
        )}
      />
    );

  const startPane = (
    <Card size="small" title="发起流程" style={{ marginBottom: 16 }}>
      <Space wrap>
        <Select
          style={{ width: 280 }}
          placeholder="选择要发起流程的实体"
          allowClear
          options={startEntityOptions}
          value={startEntity}
          onChange={(v) => {
            setStartEntity(v);
            setStartable(null);
            if (v) void loadStartable(v);
          }}
        />
        {startEntity && startable?.workflow && (
          <Typography.Text type="secondary">
            绑定流程：{startable.workflow.title}
          </Typography.Text>
        )}
      </Space>
      {startEntity && startableLoading && (
        <div style={{ padding: 16 }}>
          <LoadingState size="small" tip="" />
        </div>
      )}
      {startEntity && !startableLoading && startable && !startable.workflow && (
        <Typography.Paragraph
          type="secondary"
          style={{ margin: "12px 0 0" }}
        >
          该实体未绑定流程（或流程尚未发布），无法发起。
        </Typography.Paragraph>
      )}
      {startEntity &&
        !startableLoading &&
        startable?.workflow &&
        (startable.records.length === 0 ? (
          <Typography.Paragraph
            type="secondary"
            style={{ margin: "12px 0 0" }}
          >
            暂无可发起的记录（记录须处于可发起状态，且没有进行中的流程）。
          </Typography.Paragraph>
        ) : (
          <List
            style={{ marginTop: 8 }}
            dataSource={startable.records}
            renderItem={(record) => (
              <List.Item
                actions={[
                  <Button
                    key="start"
                    type="primary"
                    size="small"
                    loading={startingId === String(record.id)}
                    onClick={() => void startFlow(record)}
                  >
                    发起
                  </Button>,
                ]}
              >
                <RecordSummary
                  entity={entityOf(startEntity)}
                  record={record}
                />
              </List.Item>
            )}
          />
        ))}
    </Card>
  );

  const minePane = (
    <div>
      {startPane}
      {mine === null ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <LoadingState tip="正在加载我发起的流程…" />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState description="我还没有发起过流程" />
      ) : (
        <List
          dataSource={mine}
          renderItem={(inst) => (
            <List.Item>
              <Card
                size="small"
                hoverable
                style={{ width: "100%" }}
                onClick={() => void openDetail(inst.id)}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <RecordSummary
                    entity={entityOf(inst.entity)}
                    record={inst.record}
                  />
                  <Space size={4} style={{ flexShrink: 0 }}>
                    <Tag color="blue">{entityLabel(inst.entity)}</Tag>
                    {instanceStatusTag(inst.status)}
                  </Space>
                </div>
                <div
                  style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}
                >
                  发起：{fmtTime(inst.createdAt)} · 更新：
                  {fmtTime(inst.updatedAt)}
                  {inst.status === "running" && (
                    <>
                      {" "}
                      · 当前步骤：{inst.currentNodeLabel ?? "—"} · 待审批：
                      {inst.pendingAssignees.length > 0
                        ? inst.pendingAssignees.join("、")
                        : "—"}
                    </>
                  )}
                </div>
                <Space
                  style={{ marginTop: 10 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {inst.status === "running" && (
                    <Button
                      size="small"
                      loading={urgingId === inst.id}
                      onClick={() => void urge(inst.id)}
                    >
                      催办
                    </Button>
                  )}
                  <Button
                    type="link"
                    size="small"
                    onClick={() => void openDetail(inst.id)}
                  >
                    查看进度
                  </Button>
                </Space>
              </Card>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  const donePane =
    done === null ? (
      <div style={{ padding: 40, textAlign: "center" }}>
        <LoadingState tip="正在加载已处理记录…" />
      </div>
    ) : done.length === 0 ? (
      <EmptyState description="暂无处理记录" />
    ) : (
      <List
        dataSource={done}
        renderItem={(task) => (
          <List.Item>
            <Card
              size="small"
              hoverable
              style={{ width: "100%" }}
              onClick={() => void openDetail(task.instanceId)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <RecordSummary
                  entity={entityOf(task.entity)}
                  record={task.record}
                />
                <Space size={4} style={{ flexShrink: 0 }}>
                  <Tag color="blue">{entityLabel(task.entity)}</Tag>
                  {task.status === "approved" ? (
                    <Tag color="success">已批准</Tag>
                  ) : (
                    <Tag color="error">已驳回</Tag>
                  )}
                </Space>
              </div>
              <div
                style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}
              >
                步骤：{task.nodeLabel} · 处理于：{fmtTime(task.actedAt)}
                {task.comment && <> · 意见：{task.comment}</>}
              </div>
            </Card>
          </List.Item>
        )}
      />
    );

  const notesPane =
    notes === null ? (
      <div style={{ padding: 40, textAlign: "center" }}>
        <LoadingState tip="正在加载通知…" />
      </div>
    ) : notes.length === 0 ? (
      <EmptyState description="暂无通知" />
    ) : (
      <List
        dataSource={notes}
        renderItem={(ev) => (
          <List.Item
            style={{ cursor: ev.instanceId ? "pointer" : undefined }}
            onClick={() => {
              if (ev.instanceId) void openDetail(ev.instanceId);
            }}
          >
            <Space align="start">
              {eventTag(ev.kind)}
              <span
                style={
                  ev.kind === "low_stock"
                    ? { color: "#cf1322", fontWeight: 600 }
                    : undefined
                }
              >
                {ev.message}
              </span>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fmtTime(ev.createdAt)}
            </Typography.Text>
          </List.Item>
        )}
      />
    );

  /* ---------- 进度抽屉 ---------- */

  const detailNodeLabel = (d: FlowInstanceDetail): string => {
    if (!d.instance.currentNode) return "—";
    return (
      d.tasks.find((t) => t.nodeId === d.instance.currentNode)?.nodeLabel ??
      d.instance.currentNode
    );
  };

  const drawer = (
    <Drawer
      title="流程进度"
      width={540}
      open={detailOpen}
      onClose={() => setDetailOpen(false)}
    >
      {detailLoading || !detail ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <LoadingState tip="正在加载进度…" />
        </div>
      ) : (
        <div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="实体">
              {entityLabel(detail.instance.entity)}
            </Descriptions.Item>
            <Descriptions.Item label="记录">
              {detail.instance.recordId}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {instanceStatusTag(detail.instance.status)}
            </Descriptions.Item>
            <Descriptions.Item label="发起人">
              {detail.instance.createdByName}（{detail.instance.createdBy}）
            </Descriptions.Item>
            <Descriptions.Item label="当前步骤">
              {detail.instance.status === "running"
                ? detailNodeLabel(detail)
                : "—"}
            </Descriptions.Item>
            <Descriptions.Item label="发起时间">
              {fmtTime(detail.instance.createdAt)}
            </Descriptions.Item>
          </Descriptions>

          <Typography.Title level={5} style={{ marginTop: 20 }}>
            审批任务
          </Typography.Title>
          {detail.tasks.length === 0 ? (
            <Typography.Text type="secondary">暂无审批任务</Typography.Text>
          ) : (
            <List
              size="small"
              dataSource={detail.tasks}
              renderItem={(t) => (
                <List.Item>
                  <Space direction="vertical" size={2}>
                    <Space size={6}>
                      <span style={{ fontWeight: 600 }}>{t.nodeLabel}</span>
                      {taskStatusTag(t.status)}
                      {t.mode === "all" && <Tag color="purple">会签</Tag>}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      审批人：
                      {t.assigneeName ?? t.assigneeRole ?? t.assigneeUserId ?? "—"}
                      {t.actedBy && (
                        <>
                          {" "}
                          · 处理人：{t.actedName ?? t.actedBy} · {fmtTime(t.actedAt)}
                        </>
                      )}
                      {t.comment && <> · 意见：{t.comment}</>}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          )}

          <Typography.Title level={5} style={{ marginTop: 20 }}>
            时间线
          </Typography.Title>
          <Timeline
            items={[...detail.events]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((ev) => ({
                color: timelineColor(ev.kind),
                children: (
                  <div>
                    <div>
                      {eventTag(ev.kind)} {ev.message}
                    </div>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                    >
                      {ev.actor ? `${ev.actorName ?? ev.actor} · ` : ""}
                      {fmtTime(ev.createdAt)}
                    </Typography.Text>
                  </div>
                ),
              }))}
          />
        </div>
      )}
    </Drawer>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          待办中心
        </Typography.Title>
        <Space>
          <Typography.Text type="secondary">
            当前用户：{user.username}（{user.role}）
          </Typography.Text>
          <Button onClick={refresh}>刷新</Button>
        </Space>
      </div>
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "todos",
            label: `待我审批${todos ? ` (${todos.length})` : ""}`,
            children: todosPane,
          },
          { key: "mine", label: "我发起的", children: minePane },
          { key: "done", label: "已处理", children: donePane },
          { key: "notes", label: "通知", children: notesPane },
        ]}
      />
      <Modal
        title={actDecision === "approve" ? "批准" : "驳回"}
        open={actTask !== null}
        onOk={() => void submitAct()}
        onCancel={() => setActTask(null)}
        confirmLoading={actBusy}
        okText={actDecision === "approve" ? "确认批准" : "确认驳回"}
        okButtonProps={
          actDecision === "reject" ? { danger: true } : undefined
        }
        destroyOnClose
      >
        {actTask && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <RecordSummary
                entity={entityOf(actTask.entity)}
                record={actTask.record}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                步骤：{actTask.nodeLabel} · 发起人：
                {actTask.instance.createdByName}
              </Typography.Text>
            </div>
            <Input.TextArea
              rows={3}
              placeholder="审批意见（可选）"
              value={actComment}
              onChange={(e) => setActComment(e.target.value)}
            />
          </div>
        )}
      </Modal>
      {drawer}
    </div>
  );
}
