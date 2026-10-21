import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantConversation,
  type AdminAssistantMessage,
  type AgentFaceKey,
  type AgentOverrideFields,
  type AgentOverrideRow,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 应用内「智能服务」页（第 83 步片二第 3 点）：本应用三位助手的
 * 日常调整面——人设、启停、知识范围，保存后立即生效、不用重新
 * 发布。表单呈现的是本应用做过的调整本身：某项留空表示该项没
 * 有调整、沿用已发布设置（服务端只回调整内容，不回设置本体）。
 * 能使用哪些工具由应用的设计决定，不在本页出现。页面档位随
 * 管理台既有分档：领域角色身份只读，管理员与应用管理员可改。
 * 下半部分为运营助手会话记录（只读；监督视图——本应用管理员档位
 * 看本应用全部运营会话，领域角色档位只看本人会话）。
 */

const FACES: { key: AgentFaceKey; label: string; hint: string }[] = [
  { key: "staff", label: "员工助手", hint: "应用内员工日常使用的助手" },
  { key: "visitor", label: "访客客服", hint: "面向对外访客的咨询客服" },
  { key: "ops", label: "运营助手", hint: "管理台内使用的运营助手" },
];

interface FaceForm {
  prompt: string;
  scope: string;
  enabled: boolean;
}

const emptyForm = (): FaceForm => ({ prompt: "", scope: "", enabled: true });

export default function AppAgentService({ appId }: { appId: string }) {
  const [rows, setRows] = useState<AgentOverrideRow[]>([]);
  const [forms, setForms] = useState<Record<AgentFaceKey, FaceForm>>({
    staff: emptyForm(),
    visitor: emptyForm(),
    ops: emptyForm(),
  });
  const [tier, setTier] = useState<"t0" | "t1" | "t2" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingFace, setSavingFace] = useState<AgentFaceKey | null>(null);
  const [conversations, setConversations] = useState<
    AdminAssistantConversation[]
  >([]);
  const [detail, setDetail] = useState<{
    title: string;
    messages: AdminAssistantMessage[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const readOnly = tier === "t2";

  const applyRows = useCallback((next: AgentOverrideRow[]) => {
    setRows(next);
    const f: Record<AgentFaceKey, FaceForm> = {
      staff: emptyForm(),
      visitor: emptyForm(),
      ops: emptyForm(),
    };
    for (const r of next) {
      f[r.face] = {
        prompt: r.fields.systemPrompt ?? "",
        scope: r.fields.knowledgeScope ?? "",
        enabled: r.fields.enabled ?? true,
      };
    }
    setForms(f);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ov, site] = await Promise.all([
        api.agents.overrides(appId),
        api.site.get(appId),
      ]);
      applyRows(ov);
      setTier(site.accessTier);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
    try {
      setConversations(
        await api.assistant.app.conversations(appId, { scope: "all" }),
      );
    } catch {
      // 会话记录读取失败不阻塞调整面，列表保持为空
      setConversations([]);
    }
  }, [appId, applyRows]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchForm = (face: AgentFaceKey, p: Partial<FaceForm>) =>
    setForms((prev) => ({ ...prev, [face]: { ...prev[face], ...p } }));

  /** 保存一个面孔：留空的项不下发，三项皆空即清除该面孔的调整 */
  const saveFace = async (face: AgentFaceKey) => {
    const form = forms[face];
    const fields: AgentOverrideFields = {};
    if (form.prompt.trim()) fields.systemPrompt = form.prompt.trim();
    if (form.scope.trim()) fields.knowledgeScope = form.scope.trim();
    if (!form.enabled) fields.enabled = false;
    setSavingFace(face);
    try {
      const next = await api.agents.putOverride(appId, face, fields);
      applyRows(next);
      message.success("已保存，立即生效");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingFace(null);
    }
  };

  const clearFace = async (face: AgentFaceKey) => {
    setSavingFace(face);
    try {
      const next = await api.agents.putOverride(appId, face, {});
      applyRows(next);
      message.success("已清除，恢复已发布设置");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "清除失败");
    } finally {
      setSavingFace(null);
    }
  };

  const openConversation = async (c: AdminAssistantConversation) => {
    setDetailLoading(true);
    setDetail({ title: c.title ?? "会话记录", messages: [] });
    try {
      const res = await api.assistant.app.conversation(appId, c.id);
      setDetail({
        title: res.conversation.title ?? c.title ?? "会话记录",
        messages: res.messages,
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "读取会话失败");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const rowOf = (face: AgentFaceKey) => rows.find((r) => r.face === face);

  const convColumns: ColumnsType<AdminAssistantConversation> = [
    {
      title: "会话",
      render: (_, c) => c.title || "（无标题）",
    },
    {
      title: "发起人",
      width: 140,
      render: (_, c) => c.username ?? "—",
    },
    {
      title: "最近活动",
      width: 200,
      render: (_, c) => fmtTime(c.updatedAt),
    },
    {
      title: "操作",
      width: 90,
      render: (_, c) => (
        <Button type="link" size="small" onClick={() => void openConversation(c)}>
          查看
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin tip="加载中…" />
      </div>
    );
  }
  if (loadError) {
    return <Alert type="error" showIcon message={loadError} />;
  }

  return (
    <div>
      {readOnly && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前身份可查看本页，不可调整"
        />
      )}
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {FACES.map((f) => {
          const row = rowOf(f.key);
          const form = forms[f.key];
          return (
            <Card
              key={f.key}
              title={
                <Space>
                  {f.label}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {f.hint}
                  </Typography.Text>
                  {row ? (
                    <Tag color="blue">已调整</Tag>
                  ) : (
                    <Tag>未调整</Tag>
                  )}
                </Space>
              }
              extra={
                row ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    最近调整 {fmtTime(row.updatedAt)}
                    {row.updatedBy ? ` · ${row.updatedBy}` : ""}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    当前用已发布设置
                  </Typography.Text>
                )
              }
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  maxWidth: 720,
                }}
              >
                <div>
                  <div style={{ marginBottom: 4 }}>人设</div>
                  <Input.TextArea
                    rows={4}
                    maxLength={2000}
                    value={form.prompt}
                    disabled={readOnly}
                    placeholder="留空表示沿用已发布的人设"
                    onChange={(e) =>
                      patchForm(f.key, { prompt: e.target.value })
                    }
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>知识范围</div>
                  <Input
                    maxLength={500}
                    value={form.scope}
                    disabled={readOnly}
                    placeholder="留空表示沿用已发布的知识范围"
                    onChange={(e) =>
                      patchForm(f.key, { scope: e.target.value })
                    }
                  />
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span>启用</span>
                  <Switch
                    checked={form.enabled}
                    disabled={readOnly}
                    onChange={(v) => patchForm(f.key, { enabled: v })}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    关闭后该助手随即停用
                  </Typography.Text>
                </div>
                {!readOnly && (
                  <Space>
                    <Button
                      type="primary"
                      loading={savingFace === f.key}
                      onClick={() => void saveFace(f.key)}
                    >
                      保存本面调整
                    </Button>
                    <Button
                      disabled={!row || savingFace === f.key}
                      onClick={() => void clearFace(f.key)}
                    >
                      清除本面调整
                    </Button>
                  </Space>
                )}
              </div>
            </Card>
          );
        })}
      </Space>

      <Card title="运营助手会话记录" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          columns={convColumns}
          dataSource={conversations}
          pagination={false}
          locale={{ emptyText: "暂无会话记录" }}
        />
      </Card>

      <Drawer
        title={detail?.title ?? "会话记录"}
        width={"min(520px, 100vw)"}
        open={detail !== null}
        onClose={() => setDetail(null)}
      >
        {detailLoading ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <Spin />
          </div>
        ) : detail && detail.messages.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            {detail?.messages.map((m) => (
              <ReadonlyBubble key={m.id} msg={m} />
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function ReadonlyBubble({ msg }: { msg: AdminAssistantMessage }) {
  if (msg.role === "system") {
    return (
      <div
        style={{
          alignSelf: "center",
          color: tokens.colorTextTertiary,
          fontSize: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.text}
      </div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "88%",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          background: isUser ? tokens.colorPrimary : tokens.colorBgLayout,
          color: isUser ? tokens.colorBgContainer : tokens.colorText,
          borderRadius: 12,
          padding: "8px 12px",
          fontSize: 14,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {msg.text}
      </div>
      {!isUser && msg.pendingAction && (
        <Card
          size="small"
          title={msg.pendingAction.summary}
          style={{
            borderColor: tokens.colorWarningBorder,
            background: tokens.colorWarningBg,
          }}
        >
          {msg.pendingAction.handled ? (
            <Tag>
              已处理
              {msg.pendingAction.handled.outcome
                ? `：${msg.pendingAction.handled.outcome}`
                : ""}
            </Tag>
          ) : (
            <Tag color="orange">待确认</Tag>
          )}
        </Card>
      )}
    </div>
  );
}
