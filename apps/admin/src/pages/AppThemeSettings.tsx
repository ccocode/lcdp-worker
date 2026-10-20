import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Descriptions,
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
  siteThemeSlots,
  ThemeUploadError,
  THEME_SLOT_LABEL,
  versionFitsSlot,
  versionTargetLabel,
  type SiteAppView,
  type ThemeConfigItem,
  type ThemeItem,
  type ThemeSlotName,
  type ThemeSlots,
  type ThemeVersionView,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 主题（第 68 步口径：入口模型退役后，主题绑定是**应用自身的属性**）：
 * 呈现主语 = 本应用的主题——平台内置可选 + 本应用私有上传，列表就是
 * 该对象的集合形态属性；「设为当前」把某主题版本写进本应用的主题双槽
 * 指针（theme_slots，桌面槽/移动槽独立、values 按槽独立），经
 * PUT /admin/apps/:id/site 落盘，在本应用被访问时生效（专属域名 /
 * 主应用根路径 / 默认域名 /<id> 路径，形态见下方「当前绑定」）。
 * 写权口径：绑定权归本应用运营方——operator 仅可写 themeSlots 且主题须
 * builtin 或本应用私有（服务端供给执法），admin 全权。
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

/** 绑定初值：清单 default 打底，本应用该槽已绑同版本时用已存 values 覆盖 */
function initialValues(
  themes: ThemeItem[],
  slots: ThemeSlots,
  slot: ThemeSlotName,
  themeId: string,
  version: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of configOf(findVersion(themes, themeId, version))) {
    if (typeof item.default === "string") out[item.key] = item.default;
  }
  const ptr = slots[slot];
  if (ptr && ptr.id === themeId && ptr.version === version) {
    for (const [k, v] of Object.entries(ptr.values ?? {})) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  return out;
}

const THEME_SLOTS: ThemeSlotName[] = ["desktop", "mobile"];

/** 「设为当前」弹窗的编辑态：主题 × 槽位 × 版本 */
interface BindingState {
  theme: ThemeItem;
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
  const [site, setSite] = useState<SiteAppView | null>(null);
  const [defaultHost, setDefaultHost] = useState("www.coode.cc.cd");
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
      const [ts, s] = await Promise.all([api.themes.list(), api.site.get(appId)]);
      setThemes(ts);
      setSite(s.app);
      setDefaultHost(s.defaultHost);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const slots = useMemo(() => siteThemeSlots(site), [site]);

  /** 本应用的主题（可选全集）：平台内置全部 + 本应用私有 */
  const myThemes = useMemo(
    () => themes.filter((t) => t.scope === "builtin" || t.ownerAppId === appId),
    [themes, appId],
  );

  /** 某主题版本在本应用双槽上的当前绑定标记 */
  const marksFor = useCallback(
    (themeId: string, version: string) => {
      const marks: ThemeSlotName[] = [];
      for (const slot of THEME_SLOTS) {
        const ptr = slots[slot];
        if (ptr && ptr.id === themeId && ptr.version === version) {
          marks.push(slot);
        }
      }
      return marks;
    },
    [slots],
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

  /** 弹窗内切换 主题/槽位/版本 后，同步 values 编辑初值 */
  const syncBindingValues = useCallback(
    (b: BindingState) => {
      if (!b.version) {
        setBVals({});
        setBValsJson("{}");
        return;
      }
      setBVals(initialValues(themes, slots, b.slot, b.theme.id, b.version));
      const ptr = slots[b.slot];
      setBValsJson(
        ptr && ptr.id === b.theme.id && ptr.version === b.version
          ? JSON.stringify(ptr.values ?? {}, null, 2)
          : "{}",
      );
    },
    [slots, themes],
  );

  const openBinding = useCallback(
    (theme: ThemeItem) => {
      const slot: ThemeSlotName = "desktop";
      const version =
        theme.versions.find((v) => versionFitsSlot(v, slot))?.version ??
        theme.versions[0]?.version ??
        "";
      const b: BindingState = { theme, slot, version };
      setBinding(b);
      syncBindingValues(b);
    },
    [syncBindingValues],
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
      // 双槽整体重建：只改本槽，另一槽保持本应用现值（服务端按槽复核供给）
      const next: ThemeSlots = {
        ...slots,
        [slot]: { id: theme.id, version, values },
      };
      await api.site.update(appId, { themeSlots: next });
      message.success(
        `已设为当前：本应用${THEME_SLOT_LABEL[slot]} = ${theme.id}@${version}`,
      );
      await load();
      setBinding(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "设置失败");
    } finally {
      setBSaving(false);
    }
  }, [binding, bVals, bValsJson, themes, slots, appId, load]);

  const unbindCurrent = useCallback(async () => {
    if (!binding) return;
    setBSaving(true);
    try {
      const next: ThemeSlots = { ...slots, [binding.slot]: null };
      await api.site.update(appId, { themeSlots: next });
      message.success(`本应用${THEME_SLOT_LABEL[binding.slot]}已解绑主题`);
      await load();
      setBinding(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "解绑失败");
    } finally {
      setBSaving(false);
    }
  }, [binding, slots, appId, load]);

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
                  ? ` · 当前：${marks.map((s) => THEME_SLOT_LABEL[s]).join("、")}`
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
          disabled={t.versions.length === 0}
          onClick={() => openBinding(t)}
        >
          设为当前
        </Button>
      ),
    },
  ];

  const accessText = !site
    ? "—"
    : site.boundHost
      ? `专属域名 ${site.boundHost}`
      : site.isPrimary
        ? `默认域名 ${defaultHost} 根路径（主应用）`
        : `默认域名路径 ${defaultHost}/${appId}`;

  const bindingPtr = binding ? slots[binding.slot] : null;
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
          description="绑定保存在本应用的主题双槽上（桌面槽/移动槽独立、版本按 target 进对应槽、两槽各自独立的配置值），在本应用被访问时生效；绑定、解绑、回滚（改绑旧版本）都只是切换指针，即时生效，与站点的运行模式互不影响。绑定权归本应用运营方（仅可绑内置或本应用私有主题）与平台管理员。"
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

      <Card title="当前绑定">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="生效面">{accessText}</Descriptions.Item>
          <Descriptions.Item label="主应用">
            {site?.isPrimary ? <Tag color="gold">主应用</Tag> : "否"}
          </Descriptions.Item>
          {THEME_SLOTS.map((slot) => (
            <Descriptions.Item key={slot} label={`${THEME_SLOT_LABEL[slot]}当前`}>
              {slots[slot] ? (
                <Tag color="processing">
                  {slots[slot]!.id}@{slots[slot]!.version}
                </Tag>
              ) : (
                <Typography.Text type="secondary">未绑定</Typography.Text>
              )}
            </Descriptions.Item>
          ))}
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          主题只作用于本应用自身被访问时的呈现；其他应用各自维护自己的主题绑定。
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
