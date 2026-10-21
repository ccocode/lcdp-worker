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
import { api, type Row, type SiteAppView, type SiteMode, type StaticSiteStatus } from "../api";
import { showError, statusText } from "@lcdp/ui";
import { fmtTime } from "../helpers";

/**
 * 静态（第 68 步口径：站点模式是**应用自身的属性**）：本应用的运行模式
 * （site_mode）读写走 PUT /admin/apps/:id/site（写权 admin，operator
 * 只读呈现，与服务端 site PUT 的 admin/operator 分支同口径）；快照生成
 * 状态按应用读既有 staticGen 端点（第 68.1 起按应用站点字段枚举：
 * 仅绑定了域名的应用有静态站点面，未绑定应用经默认域名路径以动态
 * 模式提供服务、无快照）。
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
  const [site, setSite] = useState<SiteAppView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [switching, setSwitching] = useState(false);

  const switchMode = async (mode: SiteMode) => {
    setSwitching(true);
    try {
      await api.site.update(appId, { siteMode: mode });
      message.success(`已切换为「${MODE_META[mode]?.text ?? mode}」`);
      void load();
    } catch (err) {
      showError(err, "切换模式失败");
    } finally {
      setSwitching(false);
    }
  };

  // 第 71 步韧性小修：两路请求独立成败（allSettled）——status 一败不再连坐
  // 整页落入「未绑定专属域名」兜底（此前首挂载偶发即此）；status 失败置
  // loadError 走错误提示（可刷新重试），site 失败只丢站点字段呈现。
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, s] = await Promise.allSettled([
        api.staticGen.status(appId),
        api.site.get(appId),
      ]);
      if (st.status === "fulfilled") {
        setSites(st.value);
        setLoadError(null);
      } else {
        setSites([]);
        setLoadError(
          st.reason instanceof Error ? st.reason.message : "加载静态状态失败",
        );
      }
      setSite(s.status === "fulfilled" ? (s.value?.app ?? null) : null);
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
      key: h.host,
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
    { title: "域名", dataIndex: "host", key: "host" },
    {
      title: "最近生成",
      key: "lastRun",
      width: 260,
      render: (_: unknown, r: Row) =>
        r.lastOk === null ? (
          "尚未生成"
        ) : (
          <span>
            {r.lastOk ? "成功" : "失败"} · {statusText(r.kind)} · 页面{" "}
            {String(r.pages ?? 0)} / 详情 {String(r.details ?? 0)} · {fmtTime(r.at)}
          </span>
        ),
    },
    {
      title: "静态页",
      key: "snapshot",
      width: 220,
      render: (_: unknown, r: Row) =>
        r.snapshotCount === null
          ? "—"
          : `${String(r.snapshotCount)} 份 · ${fmtTime(r.generatedAt)}`,
    },
  ];

  const mode = site?.siteMode ?? sites[0]?.siteMode ?? "dynamic";

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => void load()}>刷新</Button>
        <Button type="primary" loading={rebuilding} onClick={() => void rebuild()}>
          全量重建快照
        </Button>
      </Space>
      <Descriptions column={2} style={{ marginBottom: 16 }} size="small">
        <Descriptions.Item label="绑定域名">
          {site?.boundHost ?? "未绑定（经默认域名路径访问）"}
        </Descriptions.Item>
        <Descriptions.Item label="运行模式">
          {isAdmin ? (
            <Select
              size="small"
              value={mode}
              loading={switching}
              style={{ width: 110 }}
              options={[
                { label: "动态", value: "dynamic" },
                { label: "伪静态", value: "pseudo" },
                { label: "真静态", value: "static" },
              ]}
              onChange={(m) => void switchMode(m as SiteMode)}
            />
          ) : (
            <Tag color={MODE_META[mode]?.color ?? "default"}>
              {MODE_META[mode]?.text ?? mode}
            </Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="说明">
          生成状态以快照清单为准；进程内最近运行记录在 api 重启后会清空。
          {!isAdmin && "运行模式切换由平台管理员操作。"}
        </Descriptions.Item>
      </Descriptions>
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message="静态状态加载失败"
          description={`${loadError}（加载失败不代表本应用未绑定域名，请刷新重试。）`}
        />
      ) : sites.length === 0 && !loading ? (
        <Alert
          type="info"
          showIcon
          message="本应用未绑定专属域名，暂无静态页面"
          description="绑定专属域名后，系统会为本应用生成静态页面；未绑定的应用通过默认域名正常提供服务。域名绑定见「域名」页签。"
        />
      ) : (
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={hostRows}
          pagination={false}
        />
      )}
    </div>
  );
}
