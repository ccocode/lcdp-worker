import React, { useMemo, useState } from "react";
import { Button, Radio, Space, message } from "antd";
import { api, type AdminDataMeta, type Row } from "../api";
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
}: {
  appId: string;
  meta: AdminDataMeta;
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

  const setStatus = async (row: Row, to: string, reload: () => void) => {
    setBusyId(String(row.id));
    try {
      await api.adminData.update(appId, articleEntity, String(row.id), { status: to });
      message.success(`已改为「${to}」（审计已记录）`);
      reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "状态变更失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
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
      <DataAdmin
        appId={appId}
        meta={meta}
        lockEntity={articleEntity}
        title="文章工作台"
        statusFilter={{ field: "status", value: queue === "all" ? null : queue }}
        extraRowActions={(row, reload) => (
          <>
            {ACTIONS.filter(
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
          </>
        )}
      />
    </Space>
  );
}
