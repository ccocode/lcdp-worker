import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
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
  entryThemeSlots,
  ThemeUploadError,
  THEME_SLOT_LABEL,
  versionFitsSlot,
  versionTargetLabel,
  type EntryView,
  type ThemeConfigItem,
  type ThemeItem,
  type ThemeSlotName,
  type ThemeVersionView,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 主题管理（M14 线二）：主题包上传（zip：根目录 theme.json + index.html +
 * 静态资源，平台不构建）、版本列表、按入口绑定/改配置/解绑。
 * 绑定与回滚都只是改入口 config.theme 指针，与站点运行模式（siteMode）
 * 在「入口与站点」页各管一段、互不覆盖。M15 第⑤步起指针为双槽
 * {desktop, mobile}：两槽独立绑/解绑、values 按槽独立，版本按其
 * manifest.target 进对应槽（存量无 target 视为桌面）；分发按
 * 参数 → Cookie → 入口自检判定槽位，移动槽空缺回退桌面槽。
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

/** 绑定初值：清单 default 打底，入口该槽已绑同版本时用已存 values 覆盖 */
function initialValues(
  themes: ThemeItem[],
  entry: EntryView,
  slot: ThemeSlotName,
  themeId: string,
  version: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of configOf(findVersion(themes, themeId, version))) {
    if (typeof item.default === "string") out[item.key] = item.default;
  }
  const ptr = entryThemeSlots(entry)[slot];
  if (ptr && ptr.id === themeId && ptr.version === version) {
    for (const [k, v] of Object.entries(ptr.values ?? {})) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return out;
}

/** 绑定编辑态键：入口 id + 槽位（双槽各自一份编辑态） */
const slotKey = (entryId: string, slot: ThemeSlotName) => `${entryId}:${slot}`;
const THEME_SLOTS: ThemeSlotName[] = ["desktop", "mobile"];

export default function Themes() {
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 绑定编辑态（按「入口 id:槽位」）：选中的 "themeId@version"、values 表单值、JSON 兜底文本
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
      // 每个入口双槽的编辑态按当前绑定初始化（回滚 = 在下拉里改选旧版本再保存）
      const nextSel: Record<string, string> = {};
      const nextVals: Record<string, Record<string, string>> = {};
      const nextJson: Record<string, string> = {};
      for (const e of es) {
        const slots = entryThemeSlots(e);
        for (const slot of THEME_SLOTS) {
          const ptr = slots[slot];
          if (!ptr) continue;
          const k = slotKey(e.id, slot);
          nextSel[k] = `${ptr.id}@${ptr.version}`;
          nextVals[k] = initialValues(ts, e, slot, ptr.id, ptr.version);
          nextJson[k] = JSON.stringify(ptr.values ?? {}, null, 2);
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setProblems([]);
      try {
        const res = await api.themes.upload(file);
        message.success(
          `主题 ${res.themeId}@${res.version} 上传成功（${res.fileCount} 个文件，${fmtBytes(res.totalBytes)}），可到下方绑定到入口`,
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
    [load],
  );

  /** 某槽的主题版本下拉选项：只列 target 与槽位一致的版本（存量归桌面槽） */
  const versionOptionsFor = useCallback(
    (slot: ThemeSlotName) =>
      themes.flatMap((t) =>
        t.versions
          .filter((v) => versionFitsSlot(v, slot))
          .map((v) => ({
            value: `${t.id}@${v.version}`,
            label: `${t.name}（${t.id}）@ ${v.version} · ${versionTargetLabel(v)}`,
          })),
      ),
    [themes],
  );

  const onSelectVersion = useCallback(
    (entry: EntryView, slot: ThemeSlotName, value: string) => {
      const k = slotKey(entry.id, slot);
      setSel((prev) => ({ ...prev, [k]: value }));
      const [themeId, version] = value.split("@");
      setVals((prev) => ({
        ...prev,
        [k]: initialValues(themes, entry, slot, themeId, version),
      }));
      const ptr = entryThemeSlots(entry)[slot];
      setValsJson((prev) => ({
        ...prev,
        [k]:
          ptr && ptr.id === themeId && ptr.version === version
            ? JSON.stringify(ptr.values ?? {}, null, 2)
            : "{}",
      }));
    },
    [themes],
  );

  const saveBinding = useCallback(
    async (entry: EntryView, slot: ThemeSlotName) => {
      const k = slotKey(entry.id, slot);
      const picked = sel[k];
      if (!picked) return;
      const [themeId, version] = picked.split("@");
      const items = configOf(findVersion(themes, themeId, version));
      let values: Record<string, unknown>;
      if (items.length > 0) {
        values = { ...(vals[k] ?? {}) };
      } else {
        // 拿不到清单 config schema：JSON 文本域兜底
        try {
          const parsed: unknown = JSON.parse(valsJson[k] || "{}");
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
      setBindingId(k);
      try {
        // 双槽整体重建：只改本槽，另一槽保持入口现值
        const next = {
          ...entryThemeSlots(entry),
          [slot]: { id: themeId, version, values },
        };
        await api.entries.update(entry.id, { theme: next });
        message.success(
          `入口「${entry.name}」${THEME_SLOT_LABEL[slot]}已绑定主题 ${themeId}@${version}`,
        );
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
    async (entry: EntryView, slot: ThemeSlotName) => {
      const k = slotKey(entry.id, slot);
      setBindingId(k);
      try {
        const next = { ...entryThemeSlots(entry), [slot]: null };
        await api.entries.update(entry.id, { theme: next });
        message.success(
          `入口「${entry.name}」${THEME_SLOT_LABEL[slot]}已解绑主题`,
        );
        await load();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "解绑失败");
      } finally {
        setBindingId(null);
      }
    },
    [load],
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
      title: "供给",
      dataIndex: "scope",
      render: (_, t) =>
        t.scope === "app" ? (
          <Tag color="purple">应用私有 · {t.ownerAppId ?? "—"}</Tag>
        ) : (
          <Tag>内置</Tag>
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
              {v.version}（{v.fileCount} 文件 / {fmtBytes(v.totalBytes)} ·{" "}
              {versionTargetLabel(v)}）
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

  /** 单槽编辑块：槽位标题 + 版本下拉 + values 表单（清单 config 或 JSON 兜底） */
  const renderSlotEditor = (e: EntryView, slot: ThemeSlotName) => {
    const k = slotKey(e.id, slot);
    const picked = sel[k];
    const [themeId, version] = picked ? picked.split("@") : [null, null];
    const items =
      themeId && version ? configOf(findVersion(themes, themeId, version)) : [];
    return (
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Typography.Text strong style={{ fontSize: 12 }}>
          {THEME_SLOT_LABEL[slot]}
          {slot === "mobile" && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              （移动设备/壳内经自检或 view 参数进入，空缺回退桌面槽）
            </Typography.Text>
          )}
        </Typography.Text>
        <Select
          allowClear
          placeholder={`选择${THEME_SLOT_LABEL[slot]}主题版本`}
          style={{ width: 320 }}
          value={picked}
          options={versionOptionsFor(slot)}
          onChange={(v) => {
            if (v) onSelectVersion(e, slot, v);
            else setSel((prev) => ({ ...prev, [k]: "" }));
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
                      value={vals[k]?.[item.key] ?? ""}
                      onChange={(ev) =>
                        setVals((prev) => ({
                          ...prev,
                          [k]: { ...(prev[k] ?? {}), [item.key]: ev.target.value },
                        }))
                      }
                    />
                  ) : item.type === "color" ? (
                    <Space size={6}>
                      <input
                        type="color"
                        value={vals[k]?.[item.key] || "#000000"}
                        onChange={(ev) =>
                          setVals((prev) => ({
                            ...prev,
                            [k]: { ...(prev[k] ?? {}), [item.key]: ev.target.value },
                          }))
                        }
                      />
                      <Input
                        style={{ width: 120 }}
                        value={vals[k]?.[item.key] ?? ""}
                        onChange={(ev) =>
                          setVals((prev) => ({
                            ...prev,
                            [k]: { ...(prev[k] ?? {}), [item.key]: ev.target.value },
                          }))
                        }
                      />
                    </Space>
                  ) : (
                    <Input
                      style={{ width: 320 }}
                      placeholder={item.type === "image" ? "图片 URL" : undefined}
                      value={vals[k]?.[item.key] ?? ""}
                      onChange={(ev) =>
                        setVals((prev) => ({
                          ...prev,
                          [k]: { ...(prev[k] ?? {}), [item.key]: ev.target.value },
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
              value={valsJson[k] ?? "{}"}
              onChange={(ev) =>
                setValsJson((prev) => ({ ...prev, [k]: ev.target.value }))
              }
            />
          ))}
      </Space>
    );
  };

  const entryColumns: ColumnsType<EntryView> = [
    {
      title: "入口",
      dataIndex: "name",
      width: 220,
      render: (_, e) => {
        const slots = entryThemeSlots(e);
        return (
          <Space direction="vertical" size={2}>
            <Space size={6}>
              <Typography.Text strong>{e.name}</Typography.Text>
              {e.isDefault && <Tag>默认</Tag>}
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {e.hosts.length ? e.hosts.join("、") : "（任意域名）"}
            </Typography.Text>
            {THEME_SLOTS.map((slot) => (
              <Typography.Text key={slot} type="secondary" style={{ fontSize: 12 }}>
                {THEME_SLOT_LABEL[slot]}：
                {slots[slot] ? (
                  <Tag color="processing">
                    {slots[slot]!.id}@{slots[slot]!.version}
                  </Tag>
                ) : (
                  "未绑定"
                )}
              </Typography.Text>
            ))}
          </Space>
        );
      },
    },
    {
      title: "选择主题版本并配置（双槽）",
      render: (_, e) => (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {THEME_SLOTS.map((slot) => (
            <React.Fragment key={slot}>{renderSlotEditor(e, slot)}</React.Fragment>
          ))}
        </Space>
      ),
    },
    {
      title: "操作",
      width: 190,
      render: (_, e) => {
        const slots = entryThemeSlots(e);
        return (
          <Space direction="vertical" size={8}>
            {THEME_SLOTS.map((slot) => {
              const k = slotKey(e.id, slot);
              return (
                <Space key={slot} size={6}>
                  <Typography.Text style={{ fontSize: 12, width: 42, display: "inline-block" }}>
                    {slot === "desktop" ? "桌面" : "移动"}
                  </Typography.Text>
                  <Button
                    type="primary"
                    size="small"
                    loading={bindingId === k}
                    disabled={!sel[k]}
                    onClick={() => void saveBinding(e, slot)}
                  >
                    保存
                  </Button>
                  <Button
                    size="small"
                    danger
                    loading={bindingId === k}
                    disabled={!slots[slot]}
                    onClick={() => void unbind(e, slot)}
                  >
                    解绑
                  </Button>
                </Space>
              );
            })}
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="主题管理">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="主题 = 静态站点包（zip），绑定到入口后该入口的公开面由主题呈现"
          description="主题包根目录必须有 theme.json（清单：id / name / version，可声明 config 配置项）与 index.html，可带任意静态资源；平台不构建、上传校验通过即生效。版本不可变：改内容请升版本号重新上传。绑定、解绑、回滚（改绑旧版本）都只是切换入口指针，即时生效；与「入口与站点」页的运行模式互不影响。绑定期内公开面以主题为准（主题自带静态元信息，页面数据由主题脚本经公开接口拉取）。"
        />
        {error && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        )}
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
            上传主题包（.zip）
          </Button>
          <Typography.Text type="secondary">
            ≤200 个文件、解压总大小 ≤20MB、单文件 ≤5MB；扩展名限
            html/js/css/json/图片/字体等静态资源
          </Typography.Text>
        </Space>
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
        <Table
          rowKey="id"
          loading={loading}
          columns={themeColumns}
          dataSource={themes}
          pagination={false}
          expandable={{
            expandedRowRender: (t) => (
              <Space direction="vertical" size={4}>
                {t.versions.map((v) => (
                  <Typography.Text key={v.version} style={{ fontSize: 12 }}>
                    {t.id}@{v.version}：{v.fileCount} 个文件 / {fmtBytes(v.totalBytes)}
                    ，上传人 {v.createdBy ?? "—"}，{fmtTime(v.createdAt)}
                    ；端：{versionTargetLabel(v)}
                    {configOf(v).length > 0
                      ? `；配置项：${configOf(v)
                          .map((c) => `${c.label}(${c.key})`)
                          .join("、")}`
                      : "；无配置项"}
                  </Typography.Text>
                ))}
              </Space>
            ),
          }}
        />
      </Card>

      <Card title="入口主题绑定">
        <Table
          rowKey="id"
          loading={loading}
          columns={entryColumns}
          dataSource={entries}
          pagination={false}
        />
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <Button onClick={() => void load()}>刷新</Button>
        </div>
      </Card>
    </Space>
  );
}
