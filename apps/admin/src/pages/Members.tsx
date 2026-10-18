import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type MemberItem } from "../api";
import { asText, fmtTime } from "../helpers";

/**
 * 应用会员（会员试点）：按应用查看其生效会员域的注册会员并启停。
 * 会员域 = appConfig.memberScope ?? 应用 id（一期单应用单域；多应用共用同域时，
 * 任一应用下看到的都是同一域的会员全集，启停在域内全局生效）。
 * M15 第③步起应用由全局上下文给定（顶栏切换器 / URL ?app=），页内不再自选。
 */
export default function Members({ appId }: { appId: string }) {
  const [scope, setScope] = useState("");
  const [rows, setRows] = useState<MemberItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const res = await api.members.list(appId, {
        q: keyword || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setRows(res.members);
      setTotal(res.total);
      setScope(res.scope);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载会员失败");
    } finally {
      setLoading(false);
    }
  }, [appId, keyword, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (row: MemberItem) => {
    if (!appId) return;
    const next = row.status !== "active";
    const status = next ? "active" : "disabled";
    Modal.confirm({
      title: next ? "启用会员" : "禁用会员",
      content: next
        ? `确认启用会员 ${row.identifier}？该账号将可重新登录会员面。`
        : `确认禁用会员 ${row.identifier}？禁用后其会员令牌即刻失效（每次请求查库校验），在该会员域的全部应用都无法再登录；数据保留不删。操作会写入审计。`,
      okText: next ? "启用" : "禁用",
      okButtonProps: next ? {} : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusyId(row.id);
        try {
          await api.members.setStatus(appId, row.id, status);
          message.success(next ? "已启用" : "已禁用");
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "操作失败");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const columns: ColumnsType<MemberItem> = [
    { title: "标识", dataIndex: "identifier", render: (v) => asText(v) },
    {
      title: "昵称",
      dataIndex: "displayName",
      render: (v) => asText(v),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) =>
        v === "active" ? (
          <Tag color="green">正常</Tag>
        ) : (
          <Tag color="red">已禁用</Tag>
        ),
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      width: 180,
      render: (v) => fmtTime(v),
    },
    {
      title: "操作",
      width: 110,
      render: (_, r) =>
        r.status === "active" ? (
          <Button
            size="small"
            danger
            loading={busyId === r.id}
            onClick={() => toggle(r)}
          >
            禁用
          </Button>
        ) : (
          <Button
            size="small"
            loading={busyId === r.id}
            onClick={() => toggle(r)}
          >
            启用
          </Button>
        ),
    },
  ];

  return (
    <Card
      title="应用会员"
      extra={
        scope ? (
          <Typography.Text type="secondary">
            当前会员域：{scope}
            {appId && scope !== appId ? "（多应用共用）" : ""}
          </Typography.Text>
        ) : null
      }
    >
      <Space size={12} style={{ marginBottom: 16 }} wrap>
        <Input.Search
          style={{ width: 260 }}
          placeholder="按标识搜索"
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onSearch={(v) => {
            setKeyword(v.trim());
            setPage(1);
          }}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
        locale={{ emptyText: "该应用暂无注册会员" }}
      />
    </Card>
  );
}
