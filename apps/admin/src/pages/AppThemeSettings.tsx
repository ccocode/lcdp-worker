import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Segmented,
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
  type AdminThemeBindGate,
  type SiteAppView,
  type ThemeConfigItem,
  type ThemeItem,
  type ThemeSlotName,
  type ThemeSlots,
  type ThemeVersionView,
} from "../api";

/**
 * 主题（第 68 步口径：入口模型退役后，主题绑定是**应用自身的属性**；
 * 第 74 步 B′ 领域货架改版）：呈现主语 = 本应用的主题——可选集 = 本应用
 * 私有 + 本应用所属领域的货架主题（平台管理员供货、同领域应用自动
 * 可见；自定义/空白领域应用无货架），列表就是该对象的集合形态属性。
 * 列表按桌面 / 移动两组呈现，每组置顶显示当前激活（双槽指针、每组唯一），
 * 「设为当前」把某主题写进本应用对应槽的指针（theme_slots，values
 * 按槽独立），经 PUT /admin/apps/:id/site 落盘即时生效；绑定状态与操作
 * 直接放在卡片上（槽位头的当前激活标记、行内的激活中标记与设为当前按钮），
 * 页面底部不再设当前绑定区。写权口径：绑定权归本应用运营方与平台管理员，主题须
 * 本应用私有或本领域货架（服务端供给执法，admin 同口径）。
 * 上传口径（10-27 定）：上传主题不设归属，归属只由当前应用上下文决定，
 * 页签内上传恒落本应用私有（admin/operator 均可，operator 须持运营授权）。
 * 版本口径（10-28 定，模型不动）：版本号由平台内部管理，页面上不显示、
 * 不操作版本——无版本列、无版本记录弹窗、无版本选择器；“设为当前”即
 * 绑定该主题的最新合槽版本（接口按创建时间升序返回，取最后一个合槽
 * 版本），删除按主题行操作；主题名显示去掉应用名前缀，只显风格定义。
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

/**
 * 主题名显示：去掉应用名前缀，只显风格定义（如“星桥科技官网内置主题”
 * 在本应用页显示为“内置主题”；上传主题名不含应用名时原样显示）。
 */
function displayThemeName(name: string, appName: string | null): string {
  if (appName && name.startsWith(appName)) {
    const rest = name.slice(appName.length);
    return rest === "" ? name : rest;
  }
  return name;
}

/**
 * 某主题最新合槽版本：接口按创建时间升序返回，取合槽版本中创建时间
 * 最晚者；时间不可解析时退回列表最后一个合槽版本。
 */
function latestSlotVersion(
  theme: ThemeItem,
  slot: ThemeSlotName,
): ThemeVersionView | undefined {
  const fitting = theme.versions.filter((v) => versionFitsSlot(v, slot));
  if (fitting.length === 0) return undefined;
  let best = fitting[fitting.length - 1];
  let bestTime = Date.parse(best.createdAt ?? "");
  for (const v of fitting) {
    const t = Date.parse(v.createdAt ?? "");
    if (Number.isFinite(t) && (!Number.isFinite(bestTime) || t >= bestTime)) {
      best = v;
      bestTime = t;
    }
  }
  return best;
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
  /**
   * 绑定门（D6 首批只读）：弹窗打开时查该主题有无产出
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

  const [clonePreviewList, setClonePreviewList] = useState<{
    cloneId: string;
    sourceThemeId: string;
    sourceVersion: string;
    target: string;
    routes: string[];
    routeCount: number;
    preview: {
      tokenChanges: Array<{ key: string; from: unknown; to: unknown }>;
      configChanges: Array<{ key: string; from: unknown; to: unknown }>;
      layoutChanges: string[];
      navigationChanges: Array<{ route: string; hidden?: boolean; order?: number }>;
      skippedNavigation: Array<{ route: string; reason: string }>;
    };
  } | null>(null);
  const [cloneActing, setCloneActing] = useState<string | null>(null);

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

  /** 某主题在本应用某槽上是否激活（版本由平台内部管理，激活按主题认） */
  const isActive = useCallback(
    (themeId: string, slot: ThemeSlotName) => slots[slot]?.id === themeId,
    [slots],
  );

  /** 本应用名（主题名显示去前缀用）与主题显示名 */
  const appName = site?.name ?? null;
  const showName = useCallback(
    (t: ThemeItem) => displayThemeName(t.name, appName),
    [appName],
  );
  const showNameById = useCallback(
    (themeId: string) => {
      const t = themes.find((x) => x.id === themeId);
      return t ? showName(t) : themeId;
    },
    [themes, showName],
  );

  const onUploadFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setProblems([]);
      try {
        // 10-27 口径：上传主题不设归属，归属只由当前应用上下文决定（恒为本应用私有）。
        const res = await api.themes.upload(file, { appId });
        message.success(
          res.replaced
            ? `主题包上传成功，已替换旧版（${res.fileCount} 个文件，${fmtBytes(res.totalBytes)}），仅本应用可见可绑`
            : `主题包上传成功（${res.fileCount} 个文件，${fmtBytes(res.totalBytes)}），仅本应用可见可绑`,
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


  const onClonePreviewList = useCallback(async (theme: ThemeItem) => {
    try {
      const list = await api.themes.clonePreviewList(appId, theme.id);
      setClonePreviewList(list);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "预览清单加载失败");
    }
  }, [appId]);

  const onClonePreview = useCallback(async (theme: ThemeItem) => {
    const win = window.open("", "_blank");
    try {
      const res = await api.themes.clonePreview(appId, theme.id);
      if (win) win.location.href = res.url;
      else message.warning("新标签被浏览器拦截，请允许弹窗后重试");
    } catch (err) {
      win?.close();
      message.error(err instanceof Error ? err.message : "克隆预览打开失败");
    }
  }, [appId]);

  const onCloneBind = useCallback(async (theme: ThemeItem) => {
    setCloneActing(`bind:${theme.id}`);
    try {
      const res = await api.themes.cloneBind(appId, theme.id);
      message.success(`已绑定克隆：${showName(theme)}（${res.target === "mobile" ? "移动端" : "桌面端"}）`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "克隆绑定失败");
    } finally {
      setCloneActing(null);
    }
  }, [appId, load, showName]);

  const onCloneUnbind = useCallback(async (theme: ThemeItem) => {
    setCloneActing(`unbind:${theme.id}`);
    try {
      await api.themes.cloneUnbind(appId, theme.id);
      message.success(`已解绑回内置`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "克隆解绑失败");
    } finally {
      setCloneActing(null);
    }
  }, [appId, load]);

  /** 删除主题模板（本应用私有、非内置）：已绑定时服务端回 409，须先解绑再删。 */
  const onDeleteTheme = useCallback((theme: ThemeItem) => {
    Modal.confirm({
      title: `删除主题 ${showName(theme)}？`,
      content: "删除后该主题一并清除，不可恢复；已绑定的主题须先解绑才能删。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setCloneActing(`delete:${theme.id}`);
        try {
          await api.themes.remove(theme.id);
          message.success(`主题已删除：${theme.id}`);
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "主题删除失败");
        } finally {
          setCloneActing(null);
        }
      },
    });
  }, [load, showName]);

  /** 删除克隆（测试完即可删）：已绑定时服务端回 409，须先解绑再删。 */
  const onCloneDelete = useCallback((theme: ThemeItem) => {
    Modal.confirm({
      title: `删除克隆 ${showName(theme)}？`,
      content: "删除后该克隆一并清除，不可恢复；线上绑定不受影响（已解绑时指针早已回到内置）。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setCloneActing(`delete:${theme.id}`);
        try {
          await api.themes.remove(theme.id);
          message.success(`克隆已删除：${theme.id}`);
          await load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "克隆删除失败");
        } finally {
          setCloneActing(null);
        }
      },
    });
  }, [appId, load, showName]);

  /** 弹窗内切换 主题/槽位 后，同步 values 编辑初值（版本由平台内部定） */
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
      // 设为当前即绑定该主题的最新合槽版本（版本不由用户选）。
      const version = latestSlotVersion(theme, slot)?.version ?? "";
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
        // 槽位变化后版本随槽重定为该槽最新合槽版本（版本不由用户选）
        if (patch.slot) {
          next.version =
            latestSlotVersion(next.theme, patch.slot)?.version ?? "";
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
      message.warning("该主题终审尚未通过，暂不能设为当前");
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
        `已设为当前：本应用${THEME_SLOT_LABEL[slot]} = ${showName(theme)}`,
      );
      await load();
      setBinding(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "设置失败");
    } finally {
      setBSaving(false);
    }
  }, [binding, bindGate, bVals, bValsJson, themes, slots, appId, load, showName]);

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

  /** 主题来源标记：克隆 / 本应用私有 / 领域货架 / 已退役内置 / 他应用私有（仅已绑保底呈现） */
  const originTag = (t: ThemeItem) => {
    if (t.kind === "builtin") return <Tag color="purple">系统内置</Tag>;
    if (t.sourceThemeId) {
      return <Tag color="cyan">克隆</Tag>;
    }
    if (t.ownerAppId === appId) return <Tag color="blue">本应用私有</Tag>;
    if (t.scope === "domain") {
      return null;
    }
    if (t.scope === "builtin") return <Tag>平台内置（存量）</Tag>;
    return <Tag color="orange">其他应用私有</Tag>;
  };

  /** 分组（桌面/移动）共用的列定义：不设版本列，激活按主题认本组槽 */
  const themeColumnsFor = (slot: ThemeSlotName): ColumnsType<ThemeItem> => [
    {
      title: "主题",
      dataIndex: "name",
      render: (_, t) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Typography.Text strong>{showName(t)}</Typography.Text>
            {originTag(t)}
            {isActive(t.id, slot) && <Tag color="processing">激活中</Tag>}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.id}
            {t.description ? ` · ${t.description}` : ""}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "操作",
      width: 170,
      render: (_, t) => {
        const slotVersions = t.versions.filter((v) => versionFitsSlot(v, slot));
        const current = latestSlotVersion(t, slot);
        // 克隆行不走通用“设为当前”：克隆须经专属绑定生成生效版本后才可指指针，
        // 直接绑克隆 id 会因无生效版本而失败；绑定/解绑/预览均走克隆端点。
        if (t.sourceThemeId) {
          const active = isActive(t.id, slot);
          return (
            <Space direction="vertical" size={2}>
              <Button
                type="primary"
                size="small"
                disabled={readOnly}
                loading={cloneActing === `bind:${t.id}`}
                onClick={() => void onCloneBind(t)}
              >
                绑定
              </Button>
              {active && (
                <Button
                  size="small"
                  danger
                  disabled={readOnly}
                  loading={cloneActing === `unbind:${t.id}`}
                  onClick={() => void onCloneUnbind(t)}
                >
                  解绑回内置
                </Button>
              )}
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto" }}
                onClick={() => void onClonePreviewList(t)}
              >
                预览清单
              </Button>
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: "auto" }}
                onClick={() => void onClonePreview(t)}
              >
                预览
              </Button>
              <Button
                type="link"
                size="small"
                danger
                style={{ padding: 0, height: "auto" }}
                disabled={readOnly}
                loading={cloneActing === `delete:${t.id}`}
                onClick={() => onCloneDelete(t)}
              >
                删除克隆
              </Button>
            </Space>
          );
        }
        // 主题模板删除：只给本应用私有、非内置的行；领域货架、他应用私有、
        // 内置行不渲染删除入口（内置服务端也禁删，货架属共享供给）。
        const deletable = t.ownerAppId === appId && t.kind !== "builtin";
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
                预览
              </Button>
            )}
            {deletable && (
              <Button
                type="link"
                size="small"
                danger
                style={{ padding: 0, height: "auto" }}
                disabled={readOnly}
                loading={cloneActing === `delete:${t.id}`}
                onClick={() => onDeleteTheme(t)}
              >
                删除
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
            // 克隆行刚创建时还没有生效版本，仍须列出（否则绑定/预览无入口）；
            // 槽位归属以克隆目标为准，目标未明时两槽都列出，绑定时服务端定槽。
            const rows = myThemes.filter(
              (t) =>
                t.versions.some((v) => versionFitsSlot(v, slot)) ||
                Boolean(t.sourceThemeId),
            );
            return (
              <div key={slot} style={{ marginTop: slot === "mobile" ? 24 : 0 }}>
                <Space size={8} style={{ marginBottom: 8 }}>
                  <Typography.Text strong>
                    {slot === "desktop" ? "桌面端" : "移动端"}
                  </Typography.Text>
                  {ptr ? (
                    <Tag color="processing">
                      当前激活：{showNameById(ptr.id)}
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
        title={binding ? `设为当前主题 · ${showName(binding.theme)}` : "设为当前主题"}
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
                message="该主题由助手任务生成，终审尚未通过，暂不能设为当前"
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
            {bindingPtr && (
              <Alert
                type="info"
                showIcon
                message={
                  <>
                    当前绑定：{showNameById(bindingPtr.id)}
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
                  placeholder='该主题清单未声明 config，用 JSON 对象填写配置值，如 {"siteName":"星桥"}'
                  value={bValsJson}
                  onChange={(ev) => setBValsJson(ev.target.value)}
                />
              ))}
          </Space>
        )}
      </Modal>

      <Modal
        title={
          clonePreviewList
            ? `预览清单 · ${showNameById(clonePreviewList.cloneId)}（来源 ${showNameById(clonePreviewList.sourceThemeId)}）`
            : "预览清单"
        }
        open={clonePreviewList !== null}
        onCancel={() => setClonePreviewList(null)}
        footer={null}
        width={720}
      >
        {clonePreviewList && (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              系统算出、逐项核对：路由覆盖 {clonePreviewList.routeCount} 条，
              目标端 {clonePreviewList.target === "mobile" ? "移动端" : "桌面端"}。
              清单不等于生效，生效须点克隆行的绑定。
            </Typography.Text>
            {clonePreviewList.preview.tokenChanges.length > 0 && (
              <div>
                <Typography.Text strong>令牌</Typography.Text>
                <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                  {clonePreviewList.preview.tokenChanges.map((c) => (
                    <li key={c.key}>
                      {c.key}：{String(c.from)} → {String(c.to)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {clonePreviewList.preview.configChanges.length > 0 && (
              <div>
                <Typography.Text strong>配置</Typography.Text>
                <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                  {clonePreviewList.preview.configChanges.map((c) => (
                    <li key={c.key}>
                      {c.key}：{String(c.from)} → {String(c.to)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {clonePreviewList.preview.layoutChanges.length > 0 && (
              <div>
                <Typography.Text strong>布局</Typography.Text>
                <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                  {clonePreviewList.preview.layoutChanges.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {clonePreviewList.preview.navigationChanges.length > 0 && (
              <div>
                <Typography.Text strong>导航</Typography.Text>
                <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                  {clonePreviewList.preview.navigationChanges.map((c) => (
                    <li key={c.route}>
                      {c.route}
                      {c.hidden !== undefined ? ` · 隐藏=${String(c.hidden)}` : ""}
                      {c.order !== undefined ? ` · 顺序=${c.order}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {clonePreviewList.preview.skippedNavigation.length > 0 && (
              <div>
                <Typography.Text strong>未生效的导航项（无菜单页，不新增入口）</Typography.Text>
                <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
                  {clonePreviewList.preview.skippedNavigation.map((c) => (
                    <li key={c.route}>
                      {c.route}：{c.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <Typography.Text strong>路由覆盖（逐项）</Typography.Text>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {clonePreviewList.routes.map((r) => (
                  <Tag key={r} style={{ marginBottom: 4 }}>{r}</Tag>
                ))}
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
