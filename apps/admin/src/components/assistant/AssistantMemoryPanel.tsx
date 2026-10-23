import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantMemory,
  type AdminAssistantMemoryCategory,
} from "../../api";
import { fmtTime } from "../../helpers";
import { isPendingMemory } from "./turnSteps";

/**
 * 助手记忆管理区（第 91 步线 A · A3，设计 6.4 用户主权）：挂在
 * 应用「智能服务」页。本人作用域——可查、改、删全部条目，可新增
 * （明示直写）；助手提议的候选单列「待确认」区，确认才转正式
 * 条目、忽略即删除。记忆归用户所有、以 scope 区分平台级与应用
 * 级，本区默认看本应用 + 平台，可切「全部」。
 *
 * 后端为线 B · B1（platform_assistant_memories CRUD）；端点未
 * 就绪时本区呈空态 + 一行提示，不阻塞页面其余部分。
 */

export const MEMORY_CATEGORY_LABELS: Record<string, string> = {
  preference: "偏好",
  decision: "决定",
  longterm: "长期事项",
  fact: "事实",
};

const CATEGORY_OPTIONS: { value: AdminAssistantMemoryCategory; label: string }[] = [
  { value: "preference", label: "偏好" },
  { value: "decision", label: "决定" },
  { value: "longterm", label: "长期事项" },
  { value: "fact", label: "事实" },
];

const WRITE_MODE_LABELS: Record<string, string> = {
  explicit: "明示直写",
  proposed_confirmed: "助手提议 · 已确认",
  proposed: "助手提议 · 待确认",
};

interface MemoryFormValues {
  scope: string;
  category: string;
  content: string;
  expiresAt?: Dayjs | null;
}

export default function AssistantMemoryPanel({
  appId,
  appName,
}: {
  appId: string;
  appName?: string | null;
}) {
  const [memories, setMemories] = useState<AdminAssistantMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  /** 作用域筛选："" 全部 / "platform" 平台 / appId 本应用 */
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 编辑中的条目（null 且 formOpen 为真 = 新增） */
  const [editing, setEditing] = useState<AdminAssistantMemory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<MemoryFormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.assistant.memories.list({});
      setMemories(list);
      setUnavailable(false);
    } catch {
      // 端点未就绪（线 B 并行施工）：呈空态，不打扰页面
      setMemories([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeLabel = useCallback(
    (scope: string): string => {
      if (scope === "platform") return "平台";
      if (scope === appId) return appName ? `本应用 · ${appName}` : "本应用";
      return `应用 ${scope}`;
    },
    [appId, appName],
  );

  const pending = useMemo(
    () => memories.filter(isPendingMemory),
    [memories],
  );
  const active = useMemo(() => {
    return memories.filter((m) => {
      if (isPendingMemory(m)) return false;
      if (scopeFilter && m.scope !== scopeFilter) return false;
      if (categoryFilter && m.category !== categoryFilter) return false;
      return true;
    });
  }, [memories, scopeFilter, categoryFilter]);

  const act = async (id: string, fn: () => Promise<unknown>, okText: string) => {
    setBusyId(id);
    try {
      await fn();
      message.success(okText);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      scope: appId,
      category: "preference",
      content: "",
      expiresAt: null,
    });
    setFormOpen(true);
  };

  const openEdit = (m: AdminAssistantMemory) => {
    setEditing(m);
    form.resetFields();
    form.setFieldsValue({
      scope: m.scope,
      category: m.category,
      content: m.content,
      expiresAt: m.expiresAt ? dayjs(m.expiresAt) : null,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    let values: MemoryFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const expiresAt = values.expiresAt
      ? values.expiresAt.toISOString()
      : null;
    setSaving(true);
    try {
      if (editing) {
        await api.assistant.memories.update(editing.id, {
          category: values.category,
          content: values.content.trim(),
          expiresAt,
        });
        message.success("已更新");
      } else {
        await api.assistant.memories.create({
          scope: values.scope,
          category: values.category,
          content: values.content.trim(),
          expiresAt,
        });
        message.success("已记住");
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const renderMeta = (m: AdminAssistantMemory) => (
    <Space size={4} wrap>
      <Tag>{MEMORY_CATEGORY_LABELS[m.category] ?? m.category}</Tag>
      <Tag color="blue">{scopeLabel(m.scope)}</Tag>
      {m.writeMode && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {WRITE_MODE_LABELS[m.writeMode] ?? m.writeMode}
        </Typography.Text>
      )}
      {m.sourceConversationId && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          来自会话
        </Typography.Text>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {fmtTime(m.createdAt)}
        {m.expiresAt ? ` · ${fmtTime(m.expiresAt)} 过期` : ""}
      </Typography.Text>
    </Space>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <Select
          value={scopeFilter}
          style={{ width: 150 }}
          onChange={(v) => setScopeFilter(v)}
          options={[
            { value: "", label: "全部作用域" },
            { value: appId, label: "本应用" },
            { value: "platform", label: "平台" },
          ]}
        />
        <Select
          value={categoryFilter}
          style={{ width: 130 }}
          onChange={(v) => setCategoryFilter(v)}
          options={[
            { value: "", label: "全部类别" },
            ...CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          ]}
        />
        <div style={{ flex: 1 }} />
        <Button type="primary" onClick={openCreate}>
          新增记忆
        </Button>
      </div>

      {unavailable && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="助手记忆服务暂不可用，以下列表可能不完整"
        />
      )}

      {pending.length > 0 && (
        <div
          style={{
            border: `1px solid ${tokens.colorWarningBorder}`,
            background: tokens.colorWarningBg,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Typography.Text strong style={{ fontSize: 13 }}>
            待确认（助手提议，确认后才长期记住）
          </Typography.Text>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 8,
            }}
          >
            {pending.map((m) => (
              <div
                key={m.id}
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, wordBreak: "break-word" }}>
                    {m.content}
                  </div>
                  <div style={{ marginTop: 4 }}>{renderMeta(m)}</div>
                </div>
                <Button
                  size="small"
                  type="primary"
                  loading={busyId === m.id}
                  onClick={() =>
                    void act(m.id, () => api.assistant.memories.confirm(m.id), "已确认记住")
                  }
                >
                  确认
                </Button>
                <Button
                  size="small"
                  disabled={busyId === m.id}
                  onClick={() =>
                    void act(m.id, () => api.assistant.memories.remove(m.id), "已忽略")
                  }
                >
                  忽略
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: "center" }}>
          <Spin />
        </div>
      ) : active.length === 0 ? (
        <Empty description="暂无记忆条目" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {active.map((m, i) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "10px 0",
                borderTop:
                  i === 0
                    ? undefined
                    : `1px solid ${tokens.colorDivider}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, wordBreak: "break-word" }}>
                  {m.content}
                </div>
                <div style={{ marginTop: 4 }}>{renderMeta(m)}</div>
              </div>
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                onClick={() => openEdit(m)}
              >
                编辑
              </Button>
              <Popconfirm
                title="删除这条记忆？"
                okText="删除"
                cancelText="取消"
                onConfirm={() =>
                  act(m.id, () => api.assistant.memories.remove(m.id), "已删除")
                }
              >
                <Button
                  size="small"
                  type="link"
                  danger
                  style={{ padding: 0 }}
                  loading={busyId === m.id}
                >
                  删除
                </Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editing ? "编辑记忆" : "新增记忆"}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={() => void submitForm()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="作用域" name="scope">
            <Select
              disabled={editing !== null}
              options={[
                { value: appId, label: appName ? `本应用 · ${appName}` : "本应用" },
                { value: "platform", label: "平台（跨应用）" },
              ]}
            />
          </Form.Item>
          <Form.Item label="类别" name="category">
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="内容"
            name="content"
            rules={[{ required: true, message: "请填写要记住的内容" }]}
          >
            <Input.TextArea
              rows={4}
              maxLength={1000}
              placeholder="例如：报表默认按周汇总、先给我看结论再看明细"
            />
          </Form.Item>
          <Form.Item label="失效时间（可空）" name="expiresAt">
            <DatePicker style={{ width: "100%" }} placeholder="长期有效可不填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
