import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Radio, Space, message } from "antd";
import { api, type AdminDataMeta, type Row } from "../api";
import type { PageKey } from "../registry";
import { setArticleEditorIntent } from "../templates/articleEditorIntent";
import DataAdmin from "./DataAdmin";

/**
 * 文章工作台（M15 第③步内容领域模版）：按状态队列列出 article 角色实体，
 * 行内直改发布状态（已发布 / 已下线 / 草稿）——全部走管理侧数据端点，
 * 变更经数据层事件联动静态快照，审计可查。状态值按骨架状态枚举动态取，
 * 不写死 CMS 命名。
 */

const ACTIONS: { to: string; label: string; fromNot: string }[] = [
  { to: "已发布", label: "发布", fromNot: "已发布" },
  { to: "已下线", label: "下架", fromNot: "已下线" },
  { to: "草稿", label: "退回草稿", fromNot: "草稿" },
];

export default function ContentArticles({
  appId,
  meta,
  go,
  visibleKeys,
}: {
  appId: string;
  meta: AdminDataMeta;
  go: (key: PageKey) => void;
  visibleKeys: Set<PageKey>;
}) {
  const roles = meta.domainModules?.roles ?? {};
  const articleEntity = roles["article"] ?? "article";
  const entityMeta = meta.entities.find((e) => e.key === articleEntity);
  const statusField = entityMeta?.fields.find((f) => f.key === "status");
  const statusValues = useMemo(() => {
    const raw = statusField?.options ?? [];
    return raw.map((o) => (typeof o === "string" ? o : o.value));
  }, [statusField]);
  const [queue, setQueue] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const articleActions = entityMeta?.actions ?? [];
  const canCreate = articleActions.includes("create");
  const canUpdate = articleActions.includes("update");

  // 第 65 步发起面（动作执行面定案：管理侧兜底补齐）：挂载时取一次可发起清单，
  // 行在清单内才渲染「发起审核」；执法在服务端（startable 已按权限/状态裁剪）。
  const [startableIds, setStartableIds] = useState<Set<string>>(new Set());
  const [flowTitle, setFlowTitle] = useState<string | null>(null);
  const refreshStartable = async () => {
    try {
      const s = await api.flow.startable(appId, articleEntity);
      setFlowTitle(s.workflow?.title ?? null);
      setStartableIds(new Set(s.records.map((r) => String(r.id))));
    } catch {
      setStartableIds(new Set());
      setFlowTitle(null);
    }
  };
  useEffect(() => {
    void refreshStartable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, articleEntity]);
  const [startingId, setStartingId] = useState<string | null>(null);
  const startReview = async (row: Row, reload: () => void) => {
    setStartingId(String(row.id));
    try {
      await api.flow.start(appId, articleEntity, String(row.id));
      message.success(`已发起${flowTitle ? `「${flowTitle}」` : "审核流程"}（审批人在「流程待办」中办理）`);
      reload();
      void refreshStartable();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发起失败");
    } finally {
      setStartingId(null);
    }
  };

  const setStatus = async (row: Row, to: string, reload: () => void) => {
    setBusyId(String(row.id));
    try {
      // 第 65 步：以服务端回读的实际落库状态为准出提示——status 在调用者
      // 字段只读集内时会被服务端静默剔除（strippedFields 回带），旧逻辑只看
      // HTTP 成功就报「已改为」是假成功（第 62 步注记②）。
      const { row: updated, strippedFields } = await api.adminData.update(
        appId,
        articleEntity,
        String(row.id),
        { status: to },
      );
      const actual = String(updated?.status ?? "");
      if (actual === to) {
        message.success(`已改为「${to}」（审计已记录）`);
      } else if (strippedFields.includes("status")) {
        message.warning(
          `状态未变更（仍为「${actual}」）：「状态」不在你的可写字段内，请走流程审批或联系有权限的角色`,
        );
      } else {
        message.warning(`状态未变更（仍为「${actual}」），请刷新后核对`);
      }
      reload();
      void refreshStartable();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "状态变更失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Radio.Group
          value={queue}
          onChange={(e) => setQueue(e.target.value as string)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: "全部", value: "all" },
            ...statusValues.map((v) => ({ label: v, value: v })),
          ]}
        />
        {canCreate && (
          <Button
            type="primary"
            onClick={() => {
              setArticleEditorIntent({ mode: "new" });
              go("content-article-editor");
            }}
          >
            新建文章
          </Button>
        )}
      </Space>
      {queue === "待审核" && (
        <Alert
          type="info"
          showIcon
          message="正式审批请在「流程待办」中办理（记流程审计）；本页状态直改记数据审计。"
          action={
            visibleKeys.has("tasks") ? (
              <Button size="small" onClick={() => go("tasks")}>
                去流程待办
              </Button>
            ) : undefined
          }
        />
      )}
      <DataAdmin
        appId={appId}
        meta={meta}
        lockEntity={articleEntity}
        title="文章工作台"
        statusFilter={{ field: "status", value: queue === "all" ? null : queue }}
        extraRowActions={(row, reload) => (
          <>
            {canUpdate && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setArticleEditorIntent({ articleId: String(row.id) });
                  go("content-article-editor");
                }}
              >
                编辑全文
              </Button>
            )}
            {/* 状态直改本质是 update 动作：第 57 步起按实体 actions 门控，
                无 update 权限时不渲染（DataAdmin 的编辑/删除同口径） */}
            {canUpdate &&
              ACTIONS.filter(
                (a) => statusValues.includes(a.to) && String(row.status ?? "") !== a.fromNot,
              ).map((a) => (
              <Button
                key={a.to}
                size="small"
                type="link"
                danger={a.to === "已下线"}
                loading={busyId === String(row.id)}
                onClick={() => void setStatus(row, a.to, reload)}
              >
                {a.label}
              </Button>
            ))}
            {/* 第 65 步：发起审核（流程发起面）——记录在服务端可发起清单内才渲染 */}
            {startableIds.has(String(row.id)) && (
              <Button
                size="small"
                type="link"
                loading={startingId === String(row.id)}
                onClick={() => void startReview(row, reload)}
              >
                发起审核
              </Button>
            )}
          </>
        )}
      />
    </Space>
  );
}
