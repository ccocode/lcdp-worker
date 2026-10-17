import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type EntryView,
  type Row,
  type SiteMode,
  type StaticSiteStatus,
} from "../api";
import { asText, fmtTime } from "../helpers";

/**
 * 入口与站点设置（CMS 静态化/SEO 线）：按入口设置站点运行模式——
 * 动态（现状 SPA）/ 伪静态（边缘 cache-aside，首访生成后命中快照）/
 * 真静态（发布/状态变更时生成快照）。模式存 platform_entries.config，
 * 切换到伪静态/真静态后服务端自动排一次全量生成；也可手动重建并看状态。
 */

const MODE_OPTIONS: { value: SiteMode; label: string }[] = [
  { value: "dynamic", label: "动态" },
  { value: "pseudo", label: "伪静态" },
  { value: "static", label: "真静态" },
];

const MODE_TAG: Record<SiteMode, { color: string; text: string }> = {
  dynamic: { color: "default", text: "动态" },
  pseudo: { color: "processing", text: "伪静态" },
  static: { color: "success", text: "真静态" },
};

interface EntryRowView extends EntryView {
  primaryAppId: string | null;
  site: StaticSiteStatus | null;
}

export default function Sites() {
  const [rows, setRows] = useState<EntryRowView[]>([]);
  const [appNames, setAppNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Record<string, SiteMode>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rebuildingId, setRebuildingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entries, apps] = await Promise.all([
        api.entries.list(),
        api.apps.list(),
      ]);
      const names: Record<string, string> = {};
      for (const a of apps) names[asText(a.id)] = asText(a.name) || asText(a.id);
      setAppNames(names);
      // 主应用探测：按装配序逐个查静态状态，sites 命中本入口的即主应用
      const views: EntryRowView[] = [];
      for (const e of entries) {
        let primaryAppId: string | null = null;
        let site: StaticSiteStatus | null = null;
        for (const appId of e.appIds) {
          try {
            const sites = await api.staticGen.status(appId);
            const hit = sites.find((s) => s.entryId === e.id);
            if (hit) {
              primaryAppId = appId;
              site = hit;
              break;
            }
          } catch {
            // 单个应用状态查询失败不阻塞整页
          }
        }
        views.push({ ...e, primaryAppId, site });
      }
      setRows(views);
      setDraft((prev) => {
        const next = { ...prev };
        for (const v of views) {
          if (!(v.id in next)) next[v.id] = v.siteMode;
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMode = useCallback(
    async (row: EntryRowView) => {
      const mode = draft[row.id];
      if (!mode || mode === row.siteMode) return;
      setSavingId(row.id);
      try {
        const updated = await api.entries.update(row.id, { siteMode: mode });
        message.success(
          mode === "dynamic"
            ? `入口「${row.name}」已切回动态模式`
            : `入口「${row.name}」已切换为${MODE_TAG[mode].text}，服务端将自动全量生成静态页`,
        );
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)),
        );
        // 切换到静态模式后生成是异步的，稍后刷新一次状态
        if (mode !== "dynamic") {
          setTimeout(() => void load(), 3000);
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : "保存失败");
      } finally {
        setSavingId(null);
      }
    },
    [draft, load],
  );

  const rebuild = useCallback(
    async (row: EntryRowView) => {
      if (!row.primaryAppId) return;
      setRebuildingId(row.id);
      try {
        const res = await api.staticGen.rebuild(row.primaryAppId);
        for (const note of res.notes) message.info(note);
        if (res.queued > 0) {
          message.success(`已受理全量重建（${res.queued} 个域名），生成完成后状态自动更新`);
        } else if (res.notes.length === 0) {
          message.warning("未排入重建任务");
        }
        setTimeout(() => void load(), 3000);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "重建失败");
      } finally {
        setRebuildingId(null);
      }
    },
    [load],
  );

  const columns: ColumnsType<EntryRowView> = [
    {
      title: "入口",
      dataIndex: "name",
      render: (_, r) => (
        <Space size={6}>
          <Typography.Text strong>{r.name}</Typography.Text>
          {r.isDefault && <Tag>默认</Tag>}
        </Space>
      ),
    },
    {
      title: "域名",
      dataIndex: "hosts",
      render: (_, r) =>
        r.hosts.length ? (
          <Space size={4} wrap>
            {r.hosts.map((h) => (
              <Tag key={h}>{h}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">（任意域名）</Typography.Text>
        ),
    },
    {
      title: "装配应用",
      dataIndex: "appIds",
      render: (_, r) => (
        <span>
          {r.appIds.map((id) => appNames[id] ?? id).join("、") || "—"}
          {r.primaryAppId && (
            <Typography.Text type="secondary">
              {" "}
              （主应用：{appNames[r.primaryAppId] ?? r.primaryAppId}）
            </Typography.Text>
          )}
        </span>
      ),
    },
    {
      title: "运行模式",
      dataIndex: "siteMode",
      width: 300,
      render: (_, r) => (
        <Space size={8}>
          <Select
            value={draft[r.id] ?? r.siteMode}
            options={MODE_OPTIONS}
            style={{ width: 110 }}
            onChange={(v) =>
              setDraft((prev) => ({ ...prev, [r.id]: v as SiteMode }))
            }
          />
          <Button
            type="primary"
            size="small"
            loading={savingId === r.id}
            disabled={(draft[r.id] ?? r.siteMode) === r.siteMode}
            onClick={() => void saveMode(r)}
          >
            保存
          </Button>
          <Tag color={MODE_TAG[r.siteMode].color}>{MODE_TAG[r.siteMode].text}</Tag>
        </Space>
      ),
    },
    {
      title: "静态生成",
      width: 340,
      render: (_, r) => {
        if (!r.primaryAppId) {
          return <Typography.Text type="secondary">无主应用</Typography.Text>;
        }
        const hostInfos = r.site?.hosts ?? [];
        return (
          <Space direction="vertical" size={4}>
            {hostInfos.length === 0 && (
              <Typography.Text type="secondary">暂无生成记录</Typography.Text>
            )}
            {hostInfos.map((h) => (
              <Typography.Text key={h.host} style={{ fontSize: 12 }}>
                {h.host}：
                {h.lastRun
                  ? h.lastRun.ok
                    ? `上次生成 ${fmtTime(h.lastRun.at)}，站点页 ${h.lastRun.pages} / 详情 ${h.lastRun.details}`
                    : `上次生成失败（${fmtTime(h.lastRun.at)}）${h.lastRun.error ? `：${h.lastRun.error}` : ""}`
                  : h.manifest
                    ? `已有快照 ${h.manifest.snapshotCount} 份（${fmtTime(h.manifest.generatedAt)}）`
                    : "尚未生成"}
                {h.lastRun && h.lastRun.skipped && Object.keys(h.lastRun.skipped).length > 0
                  ? `；未支持组件 ${Object.entries(h.lastRun.skipped)
                      .map(([k, v]) => `${k}×${v}`)
                      .join("、")}`
                  : ""}
              </Typography.Text>
            ))}
            <Button
              size="small"
              loading={rebuildingId === r.id}
              onClick={() => void rebuild(r)}
            >
              全量重建静态页
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <Card title="入口与站点设置">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="站点运行模式（按入口设置）"
        description="动态 = 现状，前端应用实时渲染；伪静态 = 网址为干净 URL，页面首次访问时在边缘生成并缓存，内容变更自动失效；真静态 = 发布/状态变更时即生成完整 HTML 快照，边缘直接返回。三种模式共用同一套生成器，切换到伪静态/真静态后会自动全量生成一次。快照只是数据的派生副本，源数据不受影响；切回动态即恢复现状。"
      />
      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      )}
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <Button onClick={() => void load()}>刷新</Button>
      </div>
    </Card>
  );
}
