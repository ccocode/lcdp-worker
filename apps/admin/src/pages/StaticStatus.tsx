import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row, type SiteMode, type StaticSiteStatus } from "../api";
import { fmtTime } from "../helpers";

/**
 * 静态（对象形态归正 W3：原独立页「静态状态」收进应用设置作属性页签后的
 * 内容组件）：本应用作为主应用的各入口站点模式与快照生成状态 + 手动
 * 全量重建。端点为既有 staticGen（按运营授权执法）。siteMode 切换走
 * entries.update{siteMode}：写权在服务端为 admin 分支（operator 分支
 * 只许 theme），故切换控件仅 admin 可用，运营者只读呈现。
 */

const MODE_META: Record<string, { color: string; text: string }> = {
  static: { color: "success", text: "真静态" },
  pseudo: { color: "processing", text: "伪静态" },
  dynamic: { color: "default", text: "动态" },
};

export default function StaticStatus({
  appId,
  isAdmin,
}: {
  appId: string;
  isAdmin: boolean;
}) {
  const [sites, setSites] = useState<StaticSiteStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const switchMode = async (entryId: string, mode: SiteMode) => {
    setSwitchingId(entryId);
    try {
      await api.entries.update(entryId, { siteMode: mode });
      message.success(`已切换为「${MODE_META[mode]?.text ?? mode}」（审计 entry.update 已记录）`);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "切换模式失败");
    } finally {
      setSwitchingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSites(await api.staticGen.status(appId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载静态状态失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const res = await api.staticGen.rebuild(appId);
      message.success(`已排队重建（${res.queued} 个目标）`);
      if (res.notes.length > 0) message.info(res.notes.join("；"));
      setTimeout(() => void load(), 1500);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "触发重建失败");
    } finally {
      setRebuilding(false);
    }
  };

  const hostRows: (Row & { key: string })[] = sites.flatMap((s) =>
    s.hosts.map((h) => ({
      key: `${s.entryId}:${h.host}`,
      entryId: s.entryId,
      entryName: s.entryName,
      siteMode: s.siteMode,
      host: h.host,
      lastOk: h.lastRun ? h.lastRun.ok : null,
      kind: h.lastRun?.kind ?? null,
      pages: h.lastRun?.pages ?? null,
      details: h.lastRun?.details ?? null,
      at: h.lastRun?.at ?? null,
      snapshotCount: h.manifest?.snapshotCount ?? null,
      generatedAt: h.manifest?.generatedAt ?? null,
    })),
  );

  const columns: ColumnsType<Row & { key: string }> = [
    { title: "入口", dataIndex: "entryName", key: "entryName" },
    { title: "域名", dataIndex: "host", key: "host" },
    {
      title: "运行模式",
      dataIndex: "siteMode",
      key: "siteMode",
      width: 150,
      render: (v: string, r: Row) =>
        isAdmin ? (
          <Select
            size="small"
            value={v}
            loading={switchingId === String(r.entryId)}
            style={{ width: 110 }}
            options={[
              { label: "动态", value: "dynamic" },
              { label: "伪静态", value: "pseudo" },
              { label: "真静态", value: "static" },
            ]}
            onChange={(mode) =>
              void switchMode(String(r.entryId), mode as SiteMode)
            }
          />
        ) : (
          <Tag color={MODE_META[v]?.color ?? "default"}>
            {MODE_META[v]?.text ?? v}
          </Tag>
        ),
    },
    {
      title: "最近生成",
      key: "lastRun",
      width: 220,
      render: (_: unknown, r: Row) =>
        r.lastOk === null ? (
          "尚未生成"
        ) : (
          <span>
            {r.lastOk ? "成功" : "失败"} · {String(r.kind ?? "")} · 页面{" "}
            {String(r.pages ?? 0)} / 详情 {String(r.details ?? 0)} · {fmtTime(r.at)}
          </span>
        ),
    },
    {
      title: "快照",
      key: "snapshot",
      width: 200,
      render: (_: unknown, r: Row) =>
        r.snapshotCount === null
          ? "—"
          : `${String(r.snapshotCount)} 份 · ${fmtTime(r.generatedAt)}`,
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => void load()}>刷新</Button>
        <Button type="primary" loading={rebuilding} onClick={() => void rebuild()}>
          全量重建快照
        </Button>
      </Space>
      {sites.length === 0 && !loading ? (
        <Alert
          type="info"
          showIcon
          message="该应用没有作为主应用绑定的入口"
          description="静态快照按入口生成；入口装配在平台区「应用管理」中维护，本应用的域名见「域名」页签。"
        />
      ) : (
        <>
          <Descriptions column={2} style={{ marginBottom: 16 }} size="small">
            <Descriptions.Item label="主应用入口数">{sites.length}</Descriptions.Item>
            <Descriptions.Item label="说明">
              生成状态以快照清单为准；进程内最近运行记录在 api 重启后会清空。
              {!isAdmin && "运行模式切换由平台管理员操作。"}
            </Descriptions.Item>
          </Descriptions>
          <Table
            rowKey="key"
            loading={loading}
            columns={columns}
            dataSource={hostRows}
            pagination={false}
          />
        </>
      )}
    </div>
  );
}
