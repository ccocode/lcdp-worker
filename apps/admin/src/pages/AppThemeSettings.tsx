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
  siteThemeSlots,
  ThemeUploadError,
  THEME_SLOT_LABEL,
  versionFitsSlot,
  versionTargetLabel,
  type AdminThemeBindGate,
  type SiteAppView,
  type ThemeConfigItem,
  type ThemeItem,
  type ThemeSlotName,
  type ThemeSlots,
  type ThemeVersionView,
} from "../api";
import { fmtTime } from "../helpers";

/**
 * 主题（第 68 步口径：入口模型退役后，主题绑定是**应用自身的属性**；
 * 第 74 步 B′ 领域货架改版）：呈现主语 = 本应用的主题——可选集 = 本应用
 * 私有 + 本应用所属领域的货架主题（平台管理员供货、同领域应用自动
 * 可见；自定义/空白领域应用无货架），列表就是该对象的集合形态属性。
 * 列表按桌面 / 移动两组呈现，每组置顶显示当前激活（双槽指针、每组唯一），
 * 「设为当前」把某主题版本写进本应用对应槽的指针（theme_slots，values
 * 按槽独立），经 PUT /admin/apps/:id/site 落盘即时生效；绑定状态与操作
 * 直接放在卡片上（槽位头的当前激活标记、行内的激活中标记与设为当前按钮），
 * 页面底部不再设当前绑定区。写权口径：绑定权归本应用运营方与平台管理员，主题须
 * 本应用私有或本领域货架（服务端供给执法，admin 同口径）。
 * 上传口径（10-27 定）：上传主题不设归属，归属只由当前应用上下文决定，
 * 页签内上传恒落本应用私有（admin/operator 均可，operator 须持运营授权）。
 * 卡片只显当前版本（已激活者优先，否则首个合槽版本），历史版本走弹窗查看。
 */

/** 领域 key → 展示名（与平台领域注册表 DOMAINS 的 name 同步） */
const DOMAIN_LABEL: Record<string, string> = {
  content: "内容",
  commerce: "商城",
  forum: "论坛",
  support: "客服",
  oa: "审批协同",
  generic: "空白",
};

export function domainLabel(key: string | null | undefined): string {
  if (!key) return "未归类";
  return DOMAIN_LABEL[key] ?? key;
}

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
  appDomain,
}: {
  appId: string;
  isAdmin: boolean;
  /** 本应用主领域 key（platform_apps.domain；无领域/未加载为 null） */
  appDomain: string | null;
}) {
  const [themes, setThemes] = useState<ThemeItem[]>([]);
  const [site, setSite] = useState<SiteAppView | null>(null);
  /** 管理档位（第 81 步）：t2 领域角色只读——上传/绑定控件禁用，执法在服务端 */
  const [accessTier, setAccessTier] = useState<"t0" | "t1" | "t2" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [binding, setBinding] = useState<BindingState | null>(null);
  /** 历史版本弹窗：主题 × 槽位（10-27 口径：卡片只显当前版本，历史走弹窗） */
  const [history, setHistory] = useState<{
    theme: ThemeItem;
    slot: ThemeSlotName;
  } | null>(null);
  /**
   * 绑定门（D6 首批只读）：弹窗打开/版本切换时查该版本有无产出
   * run；有且终审未通过时“设为当前”不可点。查不到（null）时不拦，
   * 与今日行为一致（fail-open）。
   */
  const [bindGate, setBindGate] = useState<AdminThemeBindGate | null>(null);
  const bindingThemeId = binding?.theme.id;
  const bindingVersion = binding?.version;
  useEffect(() => {
    if (!bindingThemeId || !bindingVersion) {
      setBindGate(null);
      return;
    }
    let alive = true;
    void api.assistant.app
      .themeBindGate(appId, bindingThemeId, bindingVersion)
      .then((res) => {
        if (alive) setBindGate(res);
      });
    return () => {
      alive = false;
    };
  }, [appId, bindingThemeId, bindingVersion]);
  const [bVals, setBVals] = useState<Record<string, string>>({});
  const [bValsJson, setBValsJson] = useState("{}");
  const [bSaving, setBSaving] = useState(false);
  /** 正在签发预览的主题版本（`${themeId}@${version}`），仅按钮 loading 态用 */
  const [previewing, setPreviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ts, s] = await Promise.all([api.themes.list(), api.site.get(appId)]);
      setThemes(ts);
      setSite(s.app);
      setAccessTier(s.accessTier);
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
  const readOnly = accessTier === "t2";

  /**
   * 本应用的主题（可选全集）：本应用私有 + 本应用所属领域的货架 +
   * 当前已绑定的主题（状态保底：即使归属口径变化，已绑主题仍须可见可管）。
   * operator 的服务端列表已按其应用/领域过滤，此处再交一层口径一致。
   */
  const boundIds = useMemo(
    () =>
      new Set(
        THEME_SLOTS.flatMap((s) => (slots[s] ? [slots[s]!.id] : [])),
      ),
    [slots],
  );
  const myThemes = useMemo(
    () =>
      themes.filter(
        (t) =>
          t.ownerAppId === appId ||
          (t.scope === "domain" &&
            appDomain !== null &&
            t.domainKey === appDomain) ||
          boundIds.has(t.id),
      ),
    [themes, appId, appDomain, boundIds],
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
        // 10-27 口径：上传主题不设归属，归属只由当前应用上下文决定（恒为本应用私有）。
        const res = await api.themes.upload(file, { appId });
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

  /**
   * 预览（第 83 步片五）：向服务端签发短时效预览地址后新标签打开，
   * 以该主题版本渲染本应用、不改当前绑定。预览是查看动作，只读档
   * （领域角色）同样可点。先同步开空标签再回填地址，避免异步签发
   * 被浏览器弹窗拦截。
   */
  const onPreview = useCallback(
    async (theme: ThemeItem, slot: ThemeSlotName, version: string) => {
      const key = `${theme.id}@${version}`;
      setPreviewing(key);
      const win = window.open("", "_blank");
      try {
        const res = await api.themes.preview(appId, {
          themeId: theme.id,
          version,
          slot,
        });
        if (win) {
          win.location.href = res.url;
        } else {
          message.warning("新标签被浏览器拦截，请允许弹窗后重试");
        }
      } catch (err) {
        win?.close();
        message.error(err instanceof Error ? err.message : "预览打开失败");
      } finally {
        setPreviewing(null);
      }
    },
    [appId],
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
    (theme: ThemeItem, slot: ThemeSlotName) => {
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
    // 绑定门纵深：按钮已禁用时再拦一次（门信号取弹窗打开时那次查询）
    if (bindGate && !bindGate.canBind) {
      message.warning("该版本终审尚未通过，暂不能设为当前");
      return;
    }
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
  }, [binding, bindGate, bVals, bValsJson, themes, slots, appId, load]);

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

  /** 主题来源标记：本应用私有 / 领域货架 / 已退役内置 / 他应用私有（仅已绑保底呈现） */
  const originTag = (t: ThemeItem) => {
    if (t.ownerAppId === appId) return <Tag color="blue">本应用私有</Tag>;
    if (t.scope === "domain") {
      return null;
    }
    if (t.scope === "builtin") return <Tag>平台内置（存量）</Tag>;
    return <Tag color="orange">其他应用私有</Tag>;
  };

  /** 分组（桌面/移动）共用的列定义：版本只列本组端的，绑定标记只认本组槽 */
  const themeColumnsFor = (slot: ThemeSlotName): ColumnsType<ThemeItem> => [
    {
      title: "主题",
      dataIndex: "name",
      render: (_, t) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Typography.Text strong>{t.name}</Typography.Text>
            {originTag(t)}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.id}
            {t.description ? ` · ${t.description}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "当前版本",
      dataIndex: "versions",
      render: (_, t) => {
        const slotVersions = t.versions.filter((v) => versionFitsSlot(v, slot));
        const current =
          slotVersions.find((v) => marksFor(t.id, v.version).includes(slot)) ??
          slotVersions[0];
        if (!current) {
          return <Typography.Text type="secondary">—</Typography.Text>;
        }
        const active = marksFor(t.id, current.version).includes(slot);
        return (
          <Space size={4} wrap>
            <Tag color={active ? "processing" : undefined}>
              {current.version}（{current.fileCount} 文件 / {fmtBytes(current.totalBytes)} ·{" "}
              {versionTargetLabel(current)}）{active ? " · 激活中" : ""}
            </Tag>
            {slotVersions.length > 1 && (
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto" }}
                onClick={() => setHistory({ theme: t, slot })}
              >
                历史版本（{slotVersions.length}）
              </Button>
            )}
          </Space>
        );
      },
    },
    {
      title: "操作",
      width: 170,
      render: (_, t) => {
        const slotVersions = t.versions.filter((v) => versionFitsSlot(v, slot));
        const current =
          slotVersions.find((v) => marksFor(t.id, v.version).includes(slot)) ??
          slotVersions[0];
        return (
          <Space direction="vertical" size={2}>
            <Button
              type="primary"
              size="small"
              disabled={readOnly || slotVersions.length === 0}
              onClick={() => openBinding(t, slot)}
            >
              设为当前
            </Button>
            {current && (
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto" }}
                loading={previewing === `${t.id}@${current.version}`}
                onClick={() => void onPreview(t, slot, current.version)}
              >
                预览 {current.version}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

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
        {readOnly && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="你对本应用是领域角色，只能查看主题"
            description="主题的上传与绑定属于应用管理事项，请由本应用管理员（运营授权）或平台管理员操作。"
          />
        )}
        <Space size={8} wrap style={{ marginBottom: 16 }}>
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
            disabled={readOnly}
            onClick={() => fileRef.current?.click()}
          >
            上传主题包（.zip）
          </Button>
          <Typography.Text type="secondary">
            私有主题仅本应用可见可绑，校验标准一致（≤200 个文件、解压总大小 ≤20MB、单文件 ≤5MB）
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
        {myThemes.length === 0 ? (
          <Empty
            description={`暂无可选主题（本应用私有与「${domainLabel(appDomain)}」领域共享主题均为空）`}
          />
        ) : (
          THEME_SLOTS.map((slot) => {
            const ptr = slots[slot];
            const rows = myThemes.filter((t) =>
              t.versions.some((v) => versionFitsSlot(v, slot)),
            );
            return (
              <div key={slot} style={{ marginTop: slot === "mobile" ? 24 : 0 }}>
                <Space size={8} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>
                    {slot === "desktop" ? "桌面端" : "移动端"}
                  </Typography.Text>
                  {ptr ? (
                    <Tag color="processing">
                      当前激活：{ptr.id}@{ptr.version}
                    </Tag>
                  ) : (
                    <Tag>未绑定</Tag>
                  )}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {slot === "desktop"
                      ? "桌面设备访问本应用时呈现"
                      : "移动设备 / 壳内访问时呈现，未绑定时回退桌面端"}
                  </Typography.Text>
                </Space>
                {rows.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`暂无${slot === "desktop" ? "桌面" : "移动"}端主题`}
                  />
                ) : (
                  <Table
                    rowKey="id"
                    size="small"
                    loading={loading}
                    columns={themeColumnsFor(slot)}
                    dataSource={rows}
                    pagination={false}
                  />
                )}
              </div>
            );
          })
        )}
      </Card>

      {/* 10-27 口径：页面底部不再设当前绑定区，绑定状态与操作直接放在上方卡片（槽位头与行内）上。 */}

      <Modal
        title={binding ? `设为当前主题 · ${binding.theme.name}` : "设为当前主题"}
        open={binding !== null}
        onCancel={() => setBinding(null)}
        onOk={() => void saveBinding()}
        confirmLoading={bSaving}
        okText="设为当前"
        cancelText="取消"
        width={640}
        okButtonProps={{
          disabled: bindGate !== null && !bindGate.canBind,
        }}
      >
        {binding && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {bindGate !== null && !bindGate.canBind && (
              <Alert
                type="warning"
                showIcon
                message="该版本由助手任务生成，终审尚未通过，暂不能设为当前"
              />
            )}
            <Space size={8}>
              <Typography.Text style={{ width: 72, display: "inline-block" }}>
                设备
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
                  移动设备/壳内进入，未单独设置时使用桌面端主题
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
                    当前绑定：{bindingPtr.id}@{bindingPtr.version}
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

      <Modal
        title={
          history
            ? `历史版本 · ${history.theme.name}（${THEME_SLOT_LABEL[history.slot]}）`
            : "历史版本"
        }
        open={history !== null}
        onCancel={() => setHistory(null)}
        footer={null}
        width={640}
      >
        {history && (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            {history.theme.versions
              .filter((v) => versionFitsSlot(v, history.slot))
              .map((v) => {
                const active = marksFor(history.theme.id, v.version).includes(
                  history.slot,
                );
                return (
                  <Space key={v.version} size={8} wrap>
                    <Tag color={active ? "processing" : undefined}>
                      {v.version}
                      {active ? " · 激活中" : ""}
                    </Tag>
                    <Typography.Text style={{ fontSize: 12 }}>
                      {history.theme.id}@{v.version}：{v.fileCount} 个文件 /{" "}
                      {fmtBytes(v.totalBytes)}，上传人 {v.createdBy ?? "—"}，
                      {fmtTime(v.createdAt)}；端：{versionTargetLabel(v)}
                    </Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: "auto" }}
                      loading={
                        previewing === `${history.theme.id}@${v.version}`
                      }
                      onClick={() =>
                        void onPreview(history.theme, history.slot, v.version)
                      }
                    >
                      预览
                    </Button>
                  </Space>
                );
              })}
          </Space>
        )}
      </Modal>
    </Space>
  );
}
