import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
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
  ThemeUploadError,
  type EntryView,
  type ThemeConfigItem,
  type ThemeItem,
  type ThemeVersionView,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 主题设置（M15 第④步·主题供给）：应用上下文内的主题消费页。
 * - 本应用的入口：主应用（appIds 首位）= 当前应用的入口可在此选绑/解绑主题，
 *   可用集 = 平台内置主题全部 + 本应用私有主题（服务端另有执法兜底）；
 * - 我的主题：本应用私有主题与版本，运营者可上传（admin 上传恒走平台区
 *   「主题管理」的内置通道，本页不给 admin 显示上传）；
 * - 内置主题库：平台内置主题只读一览，供选绑对照。
 * values 编辑口径与平台区 Themes 页一致：清单 config 的 default 打底，
 * 入口已绑同版本时以已存 values 覆盖；无 config 声明时用 JSON 文本兜底。
 */

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 版本的清单 config（防御式取：形状不对当无配置项） */
function configOf(v: ThemeVersionView | undefined): ThemeConfigItem[] {
  const cfg = v?.manifest?.config;
  return Array.isArray(cfg) ? cfg : [];
}

function findVersion(
  themes: ThemeItem[],
  themeId: string,
  version: string,
): ThemeVersionView | undefined {
  return themes
    .find((t) => t.id === themeId)
    ?.versions.find((v) => v.version === version);
}

/** 绑定初值：清单 default 打底，入口已绑同版本时用已存 values 覆盖 */
function initialValues(
  themes: ThemeItem[],
  entry: EntryView,
  themeId: string,
  version: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of configOf(findVersion(themes, themeId, version))) {
    if (typeof item.default === "string") out[item.key] = item.default;
  }
  if (entry.theme && entry.theme.id === themeId && entry.theme.version === version) {
    for (const [k, v] of Object.entries(entry.theme.values ?? {})) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return out;
}

export default function AppThemeSettings({
  appId,
  isAdmin,
}: {
  appId: string;
  isAdmin: boolean;
}) {
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 绑定编辑态（按入口 id）：选中的 "themeId@version"、values 表单值、JSON 兜底文本
  const [sel, setSel] = useState<Record<string, string>>({});
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({});
  const [valsJson, setValsJson] = useState<Record<string, string>>({});
  const [bindingId, setBindingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ts, es] = await Promise.all([api.themes.list(), api.entries.list()]);
      setThemes(ts);
      setEntries(es);
      const nextSel: Record<string, string> = {};
      const nextVals: Record<string, Record<string, string>> = {};
      const nextJson: Record<string, string> = {};
      for (const e of es) {
        if (e.theme) {
          nextSel[e.id] = `${e.theme.id}@${e.theme.version}`;
          nextVals[e.id] = initialValues(ts, e, e.theme.id, e.theme.version);
          nextJson[e.id] = JSON.stringify(e.theme.values ?? {}, null, 2);
        }
      }
      setSel(nextSel);
      setVals(nextVals);
      setValsJson(nextJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 本应用作为主应用（appIds 首位）的入口 */
  const myEntries = useMemo(
    () => entries.filter((e) => e.appIds[0] === appId),
    [entries, appId],
  );
  /** 本应用私有主题 */
  const myThemes = useMemo(
    () => themes.filter((t) => t.ownerAppId === appId),
    [themes, appId],
  );
  /** 平台内置主题 */
  const builtinThemes = useMemo(
    () => themes.filter((t) => t.scope === "builtin"),
    [themes],
  );
  /** 可绑集：内置全部 + 本应用私有 */
  const bindableThemes = useMemo(
    () => themes.filter((t) => t.scope === "builtin" || t.ownerAppId === appId),
    [themes, appId],
  );

  const onUploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setProblems([]);
      try {
        const res = await api.themes.upload(file, appId);
        message.success(
          `私有主题 ${res.themeId}@${res.version} 上传成功（${res.fileCount} 个文件，${fmtBytes(res.totalBytes)}），仅本应用可见可绑`,
        );
        await load();
      } catch (err) {
        if (err instanceof ThemeUploadError) {
          setProblems(err.problems);
          message.error(err.problems.length > 0 ? "主题包校验未通过" : err.message);
        } else {
          message.error(err instanceof Error ? err.message : "上传失败");
        }
      } finally {
        setUploading(false);
      }
    },
    [appId, load],
  );

  /** 主题版本下拉选项（按主题分组；value = "id@version"，含全部版本） */
  const versionOptions = useMemo(
    () =>
      bindableThemes.map((t) => ({
        label: `${t.name}（${t.id}）${t.scope === "app" ? " · 本应用私有" : ""}`,
        options: t.versions.map((v) => ({
          value: `${t.id}@${v.version}`,
          label: `${t.id} @ ${v.version}`,
        })),
      })),
    [bindableThemes],
  );

  const onSelectVersion = useCallback(
    (entry: EntryView, value: string) => {
      setSel((prev) => ({ ...prev, [entry.id]: value }));
      const [themeId, version] = value.split("@");
      setVals((prev) => ({
        ...prev,
        [entry.id]: initialValues(themes, entry, themeId, version),
      }));
      setValsJson((prev) => ({
        ...prev,
        [entry.id]:
          entry.theme && entry.theme.id === themeId && entry.theme.version === version
            ? JSON.stringify(entry.theme.values ?? {}, null, 2)
            : "{}",
      }));
    },
    [themes],
  );

  const saveBinding = useCallback(
    async (entry: EntryView) => {
      const picked = sel[entry.id];
      if (!picked) return;
      const [themeId, version] = picked.split("@");
      const items = configOf(findVersion(themes, themeId, version));
      let values: Record<string, unknown>;
      if (items.length > 0) {
        values = { ...(vals[entry.id] ?? {}) };
      } else {
        // 拿不到清单 config schema：JSON 文本域兜底
        try {
          const parsed: unknown = JSON.parse(valsJson[entry.id] || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            message.error("配置值必须是 JSON 对象");
            return;
          }
          values = parsed as Record<string, unknown>;
        } catch {
          message.error("配置值 JSON 解析失败");
          return;
        }
      }
      setBindingId(entry.id);
      try {
        await api.entries.update(entry.id, {
          theme: { id: themeId, version, values },
        });
        message.success(`入口「${entry.name}」已绑定主题 ${themeId}@${version}`);
        await load();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "绑定失败");
      } finally {
        setBindingId(null);
      }
    },
    [sel, vals, valsJson, themes, load],
  );

  const unbind = useCallback(
    async (entry: EntryView) => {
      setBindingId(entry.id);
      try {
        await api.entries.update(entry.id, { theme: null });
        message.success(`入口「${entry.name}」已解绑主题，公开面恢复原有分发`);
        await load();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "解绑失败");
      } finally {
        setBindingId(null);
      }
    },
    [load],
  );

  const versionDetail = (t: ThemeItem) => (
    <Space direction="vertical" size={4}>
      {t.versions.map((v) => (
        <Typography.Text key={v.version} style={{ fontSize: 12 }}>
          {t.id}@{v.version}：{v.fileCount} 个文件 / {fmtBytes(v.totalBytes)}
          ，上传人 {v.createdBy ?? "—"}，{fmtTime(v.createdAt)}
          {configOf(v).length > 0
            ? `；配置项：${configOf(v)
                .map((c) => `${c.label}(${c.key})`)
                .join("、")}`
            : "；无配置项"}
        </Typography.Text>
      ))}
    </Space>
  );

  const themeColumns: ColumnsType<ThemeItem> = [
    {
      title: "主题",
      dataIndex: "name",
      render: (_, t) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{t.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.id}
            {t.description ? ` · ${t.description}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "版本",
      dataIndex: "versions",
      render: (_, t) => (
        <Space size={4} wrap>
          {t.versions.length === 0 && (
            <Typography.Text type="secondary">无版本</Typography.Text>
          )}
          {t.versions.map((v) => (
            <Tag key={v.version}>
              {v.version}（{v.fileCount} 文件 / {fmtBytes(v.totalBytes)}）
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "绑定入口",
      dataIndex: "boundEntries",
      render: (_, t) =>
        t.boundEntries.length ? (
          <Space size={4} wrap>
            {t.boundEntries.map((b) => (
              <Tag key={b.entryId} color="processing">
                {b.entryName} @ {b.version}
              </Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">未绑定</Typography.Text>
        ),
    },
  ];

  const entryColumns: ColumnsType<EntryView> = [
    {
      title: "入口",
      dataIndex: "name",
      width: 220,
      render: (_, e) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Typography.Text strong>{e.name}</Typography.Text>
            {e.isDefault && <Tag>默认</Tag>}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {e.hosts.length ? e.hosts.join("、") : "（任意域名）"}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前绑定：
            {e.theme ? (
              <Tag color="processing">
                {e.theme.id}@{e.theme.version}
              </Tag>
            ) : (
              "未绑定"
            )}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "选择主题版本并配置",
      render: (_, e) => {
        const picked = sel[e.id];
        const [themeId, version] = picked ? picked.split("@") : [null, null];
        const items =
          themeId && version
            ? configOf(findVersion(themes, themeId, version))
            : [];
        return (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Select
              allowClear
              placeholder="选择主题版本"
              style={{ width: 320 }}
              value={picked}
              options={versionOptions}
              onChange={(v) => {
                if (v) onSelectVersion(e, v);
                else setSel((prev) => ({ ...prev, [e.id]: "" }));
              }}
            />
            {picked &&
              (items.length > 0 ? (
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {items.map((item) => (
                    <Space key={item.key} size={8}>
                      <Typography.Text style={{ width: 110, display: "inline-block" }}>
                        {item.label}
                      </Typography.Text>
                      {item.type === "textarea" ? (
                        <Input.TextArea
                          rows={2}
                          style={{ width: 320 }}
                          value={vals[e.id]?.[item.key] ?? ""}
                          onChange={(ev) =>
                            setVals((prev) => ({
                              ...prev,
                              [e.id]: { ...(prev[e.id] ?? {}), [item.key]: ev.target.value },
                            }))
                          }
                        />
                      ) : item.type === "color" ? (
                        <Space size={6}>
                          <input
                            type="color"
                            value={vals[e.id]?.[item.key] || "#000000"}
                            onChange={(ev) =>
                              setVals((prev) => ({
                                ...prev,
                                [e.id]: { ...(prev[e.id] ?? {}), [item.key]: ev.target.value },
                              }))
                            }
                          />
                          <Input
                            style={{ width: 120 }}
                            value={vals[e.id]?.[item.key] ?? ""}
                            onChange={(ev) =>
                              setVals((prev) => ({
                                ...prev,
                                [e.id]: { ...(prev[e.id] ?? {}), [item.key]: ev.target.value },
                              }))
                            }
                          />
                        </Space>
                      ) : (
                        <Input
                          style={{ width: 320 }}
                          placeholder={item.type === "image" ? "图片 URL" : undefined}
                          value={vals[e.id]?.[item.key] ?? ""}
                          onChange={(ev) =>
                            setVals((prev) => ({
                              ...prev,
                              [e.id]: { ...(prev[e.id] ?? {}), [item.key]: ev.target.value },
                            }))
                          }
                        />
                      )}
                    </Space>
                  ))}
                </Space>
              ) : (
                <Input.TextArea
                  rows={3}
                  style={{ width: 440 }}
                  placeholder='该版本清单未声明 config，用 JSON 对象填写配置值，如 {"siteName":"星桥"}'
                  value={valsJson[e.id] ?? "{}"}
                  onChange={(ev) =>
                    setValsJson((prev) => ({ ...prev, [e.id]: ev.target.value }))
                  }
                />
              ))}
          </Space>
        );
      },
    },
    {
      title: "操作",
      width: 170,
      render: (_, e) => (
        <Space size={6}>
          <Button
            type="primary"
            size="small"
            loading={bindingId === e.id}
            disabled={!sel[e.id]}
            onClick={() => void saveBinding(e)}
          >
            保存绑定
          </Button>
          <Button
            size="small"
            danger
            loading={bindingId === e.id}
            disabled={!e.theme}
            onClick={() => void unbind(e)}
          >
            解绑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Card title="本应用的入口">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="主题绑定按入口生效，绑定权归入口的主应用（即当前应用）"
          description="入口若同时挂有其他应用，主题呈现对同入口的全部应用一致。可选主题 = 平台内置主题全部 + 本应用私有主题；绑定、解绑、回滚（改绑旧版本）都只是切换入口指针，即时生效，与入口的运行模式互不影响。"
        />
        {!loading && myEntries.length === 0 ? (
          <Empty
            description="本应用不是任何入口的主应用，主题绑定请由 admin 或主应用运营方操作"
          />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={entryColumns}
            dataSource={myEntries}
            pagination={false}
          />
        )}
      </Card>

      <Card title="我的主题（应用私有）">
        {!isAdmin && (
          <Space size={8} style={{ marginBottom: 16 }}>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void onUploadFile(f);
              }}
            />
            <Button
              type="primary"
              loading={uploading}
              onClick={() => fileRef.current?.click()}
            >
              上传私有主题包（.zip）
            </Button>
            <Typography.Text type="secondary">
              私有主题仅本应用可见可绑，校验口径与平台内置主题一致（≤200 个文件、解压总大小 ≤20MB、单文件 ≤5MB）
            </Typography.Text>
          </Space>
        )}
        {problems.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="主题包校验未通过（整包拒绝，未写入任何文件）"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            }
          />
        )}
        {myThemes.length === 0 ? (
          <Empty description="暂无本应用私有主题" />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={themeColumns}
            dataSource={myThemes}
            pagination={false}
            expandable={{ expandedRowRender: versionDetail }}
          />
        )}
      </Card>

      <Card title="内置主题库（平台供给，只读）">
        {builtinThemes.length === 0 ? (
          <Empty description="暂无内置主题" />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={themeColumns}
            dataSource={builtinThemes}
            pagination={false}
            expandable={{ expandedRowRender: versionDetail }}
          />
        )}
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button onClick={() => void load()}>刷新</Button>
        </div>
      </Card>
    </Space>
  );
}
