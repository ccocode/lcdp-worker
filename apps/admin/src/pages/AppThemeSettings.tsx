import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Segmented,
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
 * 主题（对象形态归正 W3 + 03:39 补充口径：原独立页「主题设置」收进应用
 * 设置作属性页签后的内容组件）：呈现主语 = **本应用的主题**——
 * 一个应用可以有多个主题（平台内置可选 + 本应用私有上传），列表就是
 * 该对象的集合形态属性；「设为当前」把某主题版本设为本应用的当前主题。
 * 绑定落点仍是入口的主题双槽指针（桌面槽/移动槽独立、values 按槽独立），
 * 走既有 entries.update 通道与权限口径（绑定权归入口主应用）；入口在本
 * 页签只作**绑定载体信息**呈现（当前指针一览），不作页面主语、
 * 不以入口列表组织本页签。
 * 上传口径沿现状：运营者可上传本应用私有主题（admin 上传走平台内置
 * 通道、本页签不提供）。
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

const THEME_SLOTS: ThemeSlotName[] = ["desktop", "mobile"];

/** 「设为当前」弹窗的编辑态：主题 × 载体入口 × 槽位 × 版本 */
interface BindingState {
  theme: ThemeItem;
  entryId: string;
  slot: ThemeSlotName;
  version: string;
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

  const [binding, setBinding] = useState<BindingState | null>(null);
  const [bVals, setBVals] = useState<Record<string, string>>({});
  const [bValsJson, setBValsJson] = useState("{}");
  const [bSaving, setBSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ts, es] = await Promise.all([api.themes.list(), api.entries.list()]);
      setThemes(ts);
      setEntries(es);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 绑定载体：本应用作为主应用（appIds 首位）的入口 */
  const myEntries = useMemo(
    () => entries.filter((e) => e.appIds[0] === appId),
    [entries, appId],
  );
  /** 本应用的主题（可选全集）：平台内置全部 + 本应用私有 */
  const myThemes = useMemo(
    () => themes.filter((t) => t.scope === "builtin" || t.ownerAppId === appId),
    [themes, appId],
  );

  /** 某主题版本在各载体入口槽位上的当前绑定标记 */
  const marksFor = useCallback(
    (themeId: string, version: string) => {
      const marks: { entry: EntryView; slot: ThemeSlotName }[] = [];
      for (const e of myEntries) {
        const slots = entryThemeSlots(e);
        for (const slot of THEME_SLOTS) {
          const ptr = slots[slot];
          if (ptr && ptr.id === themeId && ptr.version === version) {
            marks.push({ entry: e, slot });
          }
        }
      }
      return marks;
    },
    [myEntries],
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

  /** 弹窗内切换 主题/入口/槽位/版本 后，同步 values 编辑初值 */
  const syncBindingValues = useCallback(
    (b: BindingState) => {
      const entry = myEntries.find((e) => e.id === b.entryId);
      if (!entry || !b.version) {
        setBVals({});
        setBValsJson("{}");
        return;
      }
      setBVals(initialValues(themes, entry, b.slot, b.theme.id, b.version));
      const ptr = entryThemeSlots(entry)[b.slot];
      setBValsJson(
        ptr && ptr.id === b.theme.id && ptr.version === b.version
          ? JSON.stringify(ptr.values ?? {}, null, 2)
          : "{}",
      );
    },
    [myEntries, themes],
  );

  const openBinding = useCallback(
    (theme: ThemeItem) => {
      const entry = myEntries[0];
      if (!entry) return;
      const slot: ThemeSlotName = "desktop";
      const version =
        theme.versions.find((v) => versionFitsSlot(v, slot))?.version ??
        theme.versions[0]?.version ??
        "";
      const b: BindingState = { theme, entryId: entry.id, slot, version };
      setBinding(b);
      syncBindingValues(b);
    },
    [myEntries, syncBindingValues],
  );

  const patchBinding = useCallback(
    (patch: Partial<BindingState>) => {
      setBinding((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        // 槽位变化后版本须仍合槽（target 口径），不合则取首个合槽版本
        if (patch.slot && next.version) {
          const cur = next.theme.versions.find((v) => v.version === next.version);
          if (!cur || !versionFitsSlot(cur, next.slot)) {
            next.version =
              next.theme.versions.find((v) => versionFitsSlot(v, next.slot))
                ?.version ?? "";
          }
        }
        syncBindingValues(next);
        return next;
      });
    },
    [syncBindingValues],
  );

  const saveBinding = useCallback(async () => {
    if (!binding || !binding.version) return;
    const entry = myEntries.find((e) => e.id === binding.entryId);
    if (!entry) return;
    const { theme, slot, version } = binding;
    const items = configOf(findVersion(themes, theme.id, version));
    let values: Record<string, unknown>;
    if (items.length > 0) {
      values = { ...bVals };
    } else {
      try {
        const parsed: unknown = JSON.parse(bValsJson || "{}");
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
    setBSaving(true);
    try {
      // 双槽整体重建：只改本槽，另一槽保持入口现值（服务端按槽复核供给）
      const next = {
        ...entryThemeSlots(entry),
        [slot]: { id: theme.id, version, values },
      };
      await api.entries.update(entry.id, { theme: next });
      message.success(
        `已设为当前：入口「${entry.name}」${THEME_SLOT_LABEL[slot]} = ${theme.id}@${version}`,
      );
      await load();
      setBinding(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "设置失败");
    } finally {
      setBSaving(false);
    }
  }, [binding, bVals, bValsJson, themes, myEntries, load]);

  const unbindCurrent = useCallback(async () => {
    if (!binding) return;
    const entry = myEntries.find((e) => e.id === binding.entryId);
    if (!entry) return;
    setBSaving(true);
    try {
      const next = { ...entryThemeSlots(entry), [binding.slot]: null };
      await api.entries.update(entry.id, { theme: next });
      message.success(
        `入口「${entry.name}」${THEME_SLOT_LABEL[binding.slot]}已解绑主题`,
      );
      await load();
      setBinding(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "解绑失败");
    } finally {
      setBSaving(false);
    }
  }, [binding, myEntries, load]);

  const versionDetail = (t: ThemeItem) => (
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
  );

  const themeColumns: ColumnsType<ThemeItem> = [
    {
      title: "主题",
      dataIndex: "name",
      render: (_, t) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Typography.Text strong>{t.name}</Typography.Text>
            {t.ownerAppId === appId ? (
              <Tag color="blue">本应用私有</Tag>
            ) : (
              <Tag>平台内置</Tag>
            )}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.id}
            {t.description ? ` · ${t.description}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "版本（当前绑定已标记）",
      dataIndex: "versions",
      render: (_, t) => (
        <Space size={4} wrap>
          {t.versions.length === 0 && (
            <Typography.Text type="secondary">无版本</Typography.Text>
          )}
          {t.versions.map((v) => {
            const marks = marksFor(t.id, v.version);
            return (
              <Tag key={v.version} color={marks.length > 0 ? "processing" : undefined}>
                {v.version}（{v.fileCount} 文件 / {fmtBytes(v.totalBytes)} ·{" "}
                {versionTargetLabel(v)}）
                {marks.length > 0
                  ? ` · 当前：${marks
                      .map(
                        (m) =>
                          `${THEME_SLOT_LABEL[m.slot]}${myEntries.length > 1 ? `（${m.entry.name}）` : ""}`,
                      )
                      .join("、")}`
                  : ""}
              </Tag>
            );
          })}
        </Space>
      ),
    },
    {
      title: "操作",
      width: 130,
      render: (_, t) => (
        <Button
          type="primary"
          size="small"
          disabled={myEntries.length === 0 || t.versions.length === 0}
          onClick={() => openBinding(t)}
        >
          设为当前
        </Button>
      ),
    },
  ];

  /** 载体信息行：入口只是绑定落点，只读呈现其双槽当前指针 */
  const carrierColumns: ColumnsType<EntryView> = [
    { title: "入口", dataIndex: "name", width: 220 },
    {
      title: "域名",
      render: (_, e) => (e.hosts.length ? e.hosts.join("、") : "（任意域名）"),
    },
    ...THEME_SLOTS.map(
      (slot) =>
        ({
          title: `${THEME_SLOT_LABEL[slot]}当前`,
          width: 220,
          render: (_: unknown, e: EntryView) => {
            const ptr = entryThemeSlots(e)[slot];
            return ptr ? (
              <Tag color="processing">
                {ptr.id}@{ptr.version}
              </Tag>
            ) : (
              <Typography.Text type="secondary">未绑定</Typography.Text>
            );
          },
        }) as ColumnsType<EntryView>[number],
    ),
  ];

  const bindingEntry = binding
    ? myEntries.find((e) => e.id === binding.entryId)
    : undefined;
  const bindingPtr =
    binding && bindingEntry
      ? entryThemeSlots(bindingEntry)[binding.slot]
      : null;
  const bindingItems =
    binding && binding.version
      ? configOf(findVersion(themes, binding.theme.id, binding.version))
      : [];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {error && <Alert type="error" showIcon message={error} />}

      <Card
        title="本应用的主题"
        extra={<Button onClick={() => void load()}>刷新</Button>}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="可选主题 = 平台内置主题全部 + 本应用私有主题；「设为当前」即把某主题版本设为本应用的当前主题"
          description="绑定按入口生效、绑定权归入口的主应用（即当前应用）：呈现上主题指针落在入口的桌面槽/移动槽（版本按 target 进对应槽、两槽各自独立的配置值），绑定、解绑、回滚（改绑旧版本）都只是切换指针，即时生效，与入口的运行模式互不影响。入口在本页签仅作绑定载体（见下方信息），主题列表才是本应用的属性主体。"
        />
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
        {myEntries.length === 0 && !loading && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="本应用不是任何入口的主应用，主题可浏览但「设为当前」不可用，绑定请由 admin 或主应用运营方操作"
          />
        )}
        {myThemes.length === 0 ? (
          <Empty description="暂无可选主题（平台内置与本应用私有均为空）" />
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

      <Card title="绑定载体（入口）信息">
        {myEntries.length === 0 ? (
          <Empty description="本应用不是任何入口的主应用" />
        ) : (
          <Table
            rowKey="id"
            loading={loading}
            columns={carrierColumns}
            dataSource={myEntries}
            pagination={false}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          入口若同时挂有其他应用，主题呈现对同入口的全部应用一致；入口装配本身在平台区「应用管理」中维护。
        </Typography.Paragraph>
      </Card>

      <Modal
        title={binding ? `设为当前主题 · ${binding.theme.name}` : "设为当前主题"}
        open={binding !== null}
        onCancel={() => setBinding(null)}
        onOk={() => void saveBinding()}
        confirmLoading={bSaving}
        okText="设为当前"
        cancelText="取消"
        width={640}
      >
        {binding && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Space size={8}>
              <Typography.Text style={{ width: 72, display: "inline-block" }}>
                绑定入口
              </Typography.Text>
              <Select
                style={{ width: 320 }}
                value={binding.entryId}
                options={myEntries.map((e) => ({ value: e.id, label: e.name }))}
                onChange={(v) => patchBinding({ entryId: v })}
              />
            </Space>
            <Space size={8}>
              <Typography.Text style={{ width: 72, display: "inline-block" }}>
                槽位
              </Typography.Text>
              <Segmented
                value={binding.slot}
                onChange={(v) => patchBinding({ slot: v as ThemeSlotName })}
                options={THEME_SLOTS.map((slot) => ({
                  label: THEME_SLOT_LABEL[slot],
                  value: slot,
                }))}
              />
              {binding.slot === "mobile" && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  移动设备/壳内进入，空缺回退桌面槽
                </Typography.Text>
              )}
            </Space>
            <Space size={8}>
              <Typography.Text style={{ width: 72, display: "inline-block" }}>
                版本
              </Typography.Text>
              <Select
                style={{ width: 320 }}
                placeholder="选择版本"
                value={binding.version || undefined}
                options={binding.theme.versions
                  .filter((v) => versionFitsSlot(v, binding.slot))
                  .map((v) => ({
                    value: v.version,
                    label: `${binding.theme.id} @ ${v.version} · ${versionTargetLabel(v)}`,
                  }))}
                onChange={(v) => patchBinding({ version: v })}
              />
            </Space>
            {bindingPtr && (
              <Alert
                type="info"
                showIcon
                message={
                  <>
                    该槽当前绑定：{bindingPtr.id}@{bindingPtr.version}
                    <Button
                      type="link"
                      danger
                      size="small"
                      loading={bSaving}
                      onClick={() => void unbindCurrent()}
                    >
                      解绑
                    </Button>
                  </>
                }
              />
            )}
            {binding.version &&
              (bindingItems.length > 0 ? (
                <Space direction="vertical" size={6} style={{ width: "100%" }}>
                  {bindingItems.map((item) => (
                    <Space key={item.key} size={8}>
                      <Typography.Text
                        style={{ width: 110, display: "inline-block" }}
                      >
                        {item.label}
                      </Typography.Text>
                      {item.type === "textarea" ? (
                        <Input.TextArea
                          rows={2}
                          style={{ width: 320 }}
                          value={bVals[item.key] ?? ""}
                          onChange={(ev) =>
                            setBVals((prev) => ({
                              ...prev,
                              [item.key]: ev.target.value,
                            }))
                          }
                        />
                      ) : item.type === "color" ? (
                        <Space size={6}>
                          <input
                            type="color"
                            value={bVals[item.key] || "#000000"}
                            onChange={(ev) =>
                              setBVals((prev) => ({
                                ...prev,
                                [item.key]: ev.target.value,
                              }))
                            }
                          />
                          <Input
                            style={{ width: 120 }}
                            value={bVals[item.key] ?? ""}
                            onChange={(ev) =>
                              setBVals((prev) => ({
                                ...prev,
                                [item.key]: ev.target.value,
                              }))
                            }
                          />
                        </Space>
                      ) : (
                        <Input
                          style={{ width: 320 }}
                          placeholder={item.type === "image" ? "图片 URL" : undefined}
                          value={bVals[item.key] ?? ""}
                          onChange={(ev) =>
                            setBVals((prev) => ({
                              ...prev,
                              [item.key]: ev.target.value,
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
                  placeholder='该版本清单未声明 config，用 JSON 对象填写配置值，如 {"siteName":"星桥"}'
                  value={bValsJson}
                  onChange={(ev) => setBValsJson(ev.target.value)}
                />
              ))}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
