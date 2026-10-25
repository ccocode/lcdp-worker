/**
 * 应用内「智能服务 · 会话记录」页（由原 AppAgentService 拆出）：
 * 运营助手会话记录（只读；监督视图——本应用管理员档位看本应用
 * 全部运营会话，领域角色档位只看本人会话）。列表为分页表格，
 * 点「查看」在抽屉里回放该会话的全部消息。子代理会话不在此
 * 列（与助手面板左栏同口径：子会话只在派发卡的右侧详情里看）。
 */
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Drawer,
  Empty,
  Spin,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { tokens } from "@lcdp/ui";
import {
  api,
  type AdminAssistantConversation,
  type AdminAssistantMessage,
} from "../api";
import { fmtTime } from "../helpers";

export default function AppAgentConversations({ appId }: { appId: string }) {
  const [conversations, setConversations] = useState<
    AdminAssistantConversation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{
    title: string;
    messages: AdminAssistantMessage[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, tasks] = await Promise.all([
        api.assistant.app.conversations(appId, { scope: "all" }),
        // 子会话 id 集：全部任务行的派发记录（与左栏同口径）
        api.assistant.app
          .tasks(appId, { status: "all" })
          .catch(() => []),
      ]);
      const childIds = new Set<string>();
      for (const t of tasks) {
        const arts = t.artifacts as { delegations?: unknown } | null | undefined;
        const deps = arts?.delegations;
        if (!Array.isArray(deps)) continue;
        for (const d of deps) {
          const rec = d as { childConversationId?: unknown } | null;
          if (rec && typeof rec.childConversationId === "string") {
            childIds.add(rec.childConversationId);
          }
        }
      }
      setConversations(list.filter((c) => !childIds.has(c.id)));
    } catch {
      // 会话记录读取失败呈空态，不阻塞页面
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div>
      <Table
        rowKey="id"
        columns={convColumns}
        dataSource={conversations}
        loading={loading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{ emptyText: "暂无会话记录" }}
      />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
