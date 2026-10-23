import React, { useCallback, useEffect, useRef, useState } from "react";
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
  type AdminAssistantSuggestion,
  type AgentFaceKey,
  type AgentOverrideFields,
  type AgentOverrideRow,
  type SuggestionDispositionKind,
} from "../api";
import type { PageKey } from "../registry";
import { fmtTime } from "../helpers";
import AssistantWorkbench from "../components/assistant/AssistantWorkbench";
import AssistantMemoryPanel from "../components/assistant/AssistantMemoryPanel";
import SuggestionList from "../components/assistant/SuggestionList";

/**
 * 应用内「智能服务」页（第 83 步片二第 3 点）：本应用三位助手的
 * 日常调整面——人设、启停、知识范围，保存后立即生效、不用重新
 * 发布。表单呈现的是本应用做过的调整本身：某项留空表示该项没
 * 有调整、沿用已发布设置（服务端只回调整内容，不回设置本体）。
 * 能使用哪些工具由应用的设计决定，不在本页出现。页面档位随
 * 管理台既有分档：领域角色身份只读，管理员与应用管理员可改。
 * 下半部分为运营助手会话记录（只读；监督视图——本应用管理员档位
 * 看本应用全部运营会话，领域角色档位只看本人会话）。
 * 第 91 步线 A 起页首另挂两区（本人面，不随档位只读）：助手全页
 * 工作台（A1）与助手记忆管理区（A3），组件在 components/assistant/。
 * 第 95 步线 B 起工作台之上再增「主动建议」区（本人任务卡 + 本应用
 * 审计读时派生，处置三态回写；为空或加载失败整区不渲染）。
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

export default function AppAgentService({
  appId,
  go,
}: {
  appId: string;
  /** 外壳导航（第 95 步线 B：主动建议 A 类深链用；缺省时深链降级为仅记处置） */
  go?: (key: PageKey) => void;
}) {
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
  const [editingFace, setEditingFace] = useState<AgentFaceKey | null>(null);
  /** 第 91 步线 A：工作台/记忆区展示用的应用名（随站点属性一并读） */
  const [appName, setAppName] = useState<string | null>(null);
  const memorySectionRef = useRef<HTMLDivElement | null>(null);
  /** 第 95 步线 B：主动建议（独立静默加载，失败/为空整区不渲染） */
  const [suggestions, setSuggestions] = useState<AdminAssistantSuggestion[]>(
    [],
  );
  const [busySuggestionFp, setBusySuggestionFp] = useState<string | null>(
    null,
  );
  /** T 类建议「去办」的任务定位信号（透传工作台选中并放宽筛选） */
  const [focusTask, setFocusTask] = useState<{
    taskId: string;
    nonce: number;
  } | null>(null);
  const workbenchSectionRef = useRef<HTMLDivElement | null>(null);

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
      setAppName(site.app?.name ?? null);
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

  // 主动建议（第 95 步线 B）：与主加载解耦的独立静默读——失败即空，
  // 不阻塞调整面与工作台；按 severity 降序呈现（服务端同口径，客户端再稳一手）。
  useEffect(() => {
    let alive = true;
    void api.assistant.suggestions
      .getAppSuggestions(appId)
      .then((list) => {
        if (alive) {
          setSuggestions(
            [...list].sort((a, b) => b.severity - a.severity),
          );
        }
      })
      .catch(() => {
        if (alive) setSuggestions([]);
      });
    return () => {
      alive = false;
    };
  }, [appId]);

  /** 建议处置回写：成功才移除该条；失败留条并提示（不静默吞处置） */
  const applyDisposition = useCallback(
    async (
      item: AdminAssistantSuggestion,
      disposition: SuggestionDispositionKind,
    ): Promise<boolean> => {
      setBusySuggestionFp(item.fingerprint);
      try {
        await api.assistant.suggestions.postSuggestionDisposition(
          { appId },
          item.fingerprint,
          { disposition },
        );
        setSuggestions((prev) =>
          prev.filter((s) => s.fingerprint !== item.fingerprint),
        );
        return true;
      } catch (err) {
        message.error(err instanceof Error ? err.message : "操作失败");
        return false;
      } finally {
        setBusySuggestionFp(null);
      }
    },
    [appId],
  );

  const disposeSuggestion = useCallback(
    (item: AdminAssistantSuggestion, disposition: "dismissed" | "snoozed") => {
      void applyDisposition(item, disposition);
    },
    [applyDisposition],
  );

  /**
   * 建议「去办」（第 95 步线 B · B2）：记 acted 后按类别深链——
   * T 类定位本页工作台对应任务卡；A1 本应用审计页；A3 客服工单页；
   * A4 本应用应用设置页。回写失败不拦导航（条目留待下次呈现）。
   */
  const goSuggestion = useCallback(
    async (item: AdminAssistantSuggestion) => {
      await applyDisposition(item, "acted");
      const rule = item.rule || item.fingerprint.split(":")[0] || "";
      if (rule.startsWith("T")) {
        const taskId = item.subject?.taskId;
        if (taskId) setFocusTask({ taskId, nonce: Date.now() });
        workbenchSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      } else if (rule === "A1") {
        go?.("app-audit");
      } else if (rule === "A3") {
        go?.("support-tickets");
      } else if (rule === "A4") {
        go?.("appsettings");
      }
    },
    [applyDisposition, go],
  );

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
      setEditingFace(null);
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
      setEditingFace(null);
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

  const faceColumns: ColumnsType<(typeof FACES)[number]> = [
    {
      title: "助手",
      width: 180,
      render: (_, f) => (
        <div>
          <div>{f.label}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {f.hint}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "启用",
      width: 90,
      render: (_, f) =>
        forms[f.key].enabled ? (
          <Tag color="green">已启用</Tag>
        ) : (
          <Tag>已停用</Tag>
        ),
    },
    {
      title: "调整状态",
      width: 100,
      render: (_, f) =>
        rowOf(f.key) ? <Tag color="blue">已调整</Tag> : <Tag>未调整</Tag>,
    },
    {
      title: "人设",
      render: (_, f) => {
        const v = rowOf(f.key)?.fields.systemPrompt;
        return v ? (
          <Typography.Paragraph
            style={{ margin: 0 }}
            ellipsis={{ rows: 2, tooltip: v }}
          >
            {v}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type="secondary">沿用已发布设置</Typography.Text>
        );
      },
    },
    {
      title: "知识范围",
      width: 200,
      render: (_, f) => {
        const v = rowOf(f.key)?.fields.knowledgeScope;
        return v ? (
          <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 200 }}>
            {v}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">沿用已发布设置</Typography.Text>
        );
      },
    },
    {
      title: "最近调整",
      width: 190,
      render: (_, f) => {
        const row = rowOf(f.key);
        if (!row) {
          return (
            <Typography.Text type="secondary">当前用已发布设置</Typography.Text>
          );
        }
        return (
          <span>
            {fmtTime(row.updatedAt)}
            {row.updatedBy ? ` · ${row.updatedBy}` : ""}
          </span>
        );
      },
    },
    {
      title: "操作",
      width: 90,
      render: (_, f) => (
        <Button
          type="link"
          size="small"
          onClick={() => setEditingFace(f.key)}
        >
          {readOnly ? "查看" : "调整"}
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
      {/* 第 95 步线 B：主动建议（工作台之上；为空整区不渲染） */}
      {suggestions.length > 0 && (
        <Card title="主动建议" style={{ marginBottom: 16 }}>
          <SuggestionList
            items={suggestions}
            busyFingerprint={busySuggestionFp}
            onGo={(item) => void goSuggestion(item)}
            onDispose={disposeSuggestion}
          />
        </Card>
      )}

      {/* 第 91 步线 A · A1：助手全页工作台（本页内三栏，不新增一级菜单） */}
      <div ref={workbenchSectionRef} style={{ scrollMarginTop: 16 }}>
        <Card title="助手工作台" style={{ marginBottom: 16 }}>
          <AssistantWorkbench
            appId={appId}
            appName={appName}
            focusTask={focusTask}
            onManageMemories={() =>
              memorySectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          />
        </Card>
      </div>

      {/* 第 91 步线 A · A3：助手记忆（本人作用域，可查改删 + 待确认区） */}
      <div ref={memorySectionRef} style={{ scrollMarginTop: 16 }}>
        <Card title="助手记忆" style={{ marginBottom: 16 }}>
          <AssistantMemoryPanel appId={appId} appName={appName} />
        </Card>
      </div>

      <Card title="智能助手">
        <Table
          rowKey="key"
          columns={faceColumns}
          dataSource={FACES}
          pagination={false}
        />
      </Card>

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
        title={
          editingFace
            ? `${FACES.find((f) => f.key === editingFace)?.label ?? ""} · ${
                readOnly ? "查看" : "调整"
              }`
            : "调整"
        }
        width={"min(560px, 100vw)"}
        open={editingFace !== null}
        onClose={() => setEditingFace(null)}
      >
        {editingFace &&
          (() => {
            const f = FACES.find((x) => x.key === editingFace)!;
            const form = forms[f.key];
            const row = rowOf(f.key);
            return (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {f.hint}；保存后立即生效，不用重新发布。
                  {row
                    ? `最近调整 ${fmtTime(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}`
                    : "当前用已发布设置"}
                </Typography.Text>
                <div>
                  <div style={{ marginBottom: 4 }}>人设</div>
                  <Input.TextArea
                    rows={6}
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
            );
          })()}
      </Drawer>

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
