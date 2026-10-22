import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message as antdMessage,
} from "antd";
import type {
  Proposal,
  WizardCandidate,
  WizardDecisionItem,
  WizardDecisionOption,
  WizardSessionView,
  WizardStepKey,
} from "./api.js";
import { api } from "./api.js";
import { errText, tokens } from "@lcdp/ui";
import { ProposalDiffView } from "./Copilot.js";

/**
 * 创建向导（AGENT 三期）：只服务新建应用——选型（领域）→ 抉择（样板 /
 * 角色名 / 会员域 / 主题）→ 陪跑（建应用 + 三步提案）→ 发布收官。
 * 选项集全部来自服务端按领域注册表机械派生的脚本，本组件只呈现与回传
 * 定案；陪跑每步复用既有提案管线（生成 → 轮询 → Diff 勾选 → 应用到草稿），
 * 向导不直接落稿、不直接发布（发布仍由用户在向导内亲点确认）。
 */

const STEP_DEFS: { key: WizardStepKey; title: string; desc: string }[] = [
  {
    key: "model",
    title: "第一步 · 模型补充",
    desc: "按场景描述与已定抉择，生成增量实体与字段提案。",
  },
  {
    key: "pages",
    title: "第二步 · 页面",
    desc: "生成或调整页面提案，与第一步的模型变更衔接。",
  },
  {
    key: "flowPerms",
    title: "第三步 · 流程与权限",
    desc: "生成流程定义与角色权限提案。",
  },
];

const CHOICE_LABELS: Record<string, string> = {
  templates: "样板选择",
  roleNames: "角色名称",
  memberScope: "会员域",
  theme: "主题方向",
};

const STAGE_TEXT: Record<string, string> = {
  selecting: "选型中",
  deciding: "抉择中",
  companion: "陪跑中",
  done: "已完成",
  abandoned: "已放弃",
};

/**
 * 定案原始形态解读：服务端逐项回 { value, version, stale }（被上游回改
 * 置失效者 stale=true，保留旧值待重定）；裸值形态按未失效处理。内部统一
 * 以 invalidated 命名失效标记，消费点不感知服务端字段名。
 */
function choiceInfo(raw: unknown): {
  value: unknown;
  invalidated: boolean;
  decided: boolean;
} {
  if (raw && typeof raw === "object" && "value" in raw) {
    const o = raw as { value: unknown; stale?: boolean };
    return {
      value: o.value,
      invalidated: Boolean(o.stale),
      decided: o.value !== undefined && o.value !== null,
    };
  }
  return {
    value: raw,
    invalidated: false,
    decided: raw !== undefined && raw !== null,
  };
}

/**
 * 定案值的短摘要（侧栏用）；会员域定案是 { mode, scopeKey? } 对象，按 mode
 * 出文案；字符串值（主题 id / later 等）优先按条目选项标签出文案，不直出原值。
 */
function choiceSummary(value: unknown, item?: WizardDecisionItem): string {
  if (Array.isArray(value)) return `已选 ${value.length} 项`;
  if (typeof value === "string") {
    const opt = item?.options.find((o) => optionKeyOf(o) === value);
    if (opt?.label) return opt.label;
    if (value === "later") return "稍后再定";
    return value;
  }
  if (value && typeof value === "object") {
    const o = value as { mode?: unknown; scopeKey?: unknown };
    if (o.mode === "existing") {
      return typeof o.scopeKey === "string" && o.scopeKey
        ? `并入既有会员域 ${o.scopeKey}`
        : "并入既有会员域";
    }
    if (o.mode === "new") return "新建独立会员域";
    if (o.mode === "none") return "不启用会员";
    return "已设置";
  }
  return "已定案";
}

/** 选项归一键：字符串值用本身、对象值（如会员域的 { mode }）取 mode 字段，供单选控件作值 */
function optionKeyOf(o: WizardDecisionOption): string {
  if (typeof o.value === "string") return o.value;
  if (o.value && typeof o.value === "object" && !Array.isArray(o.value)) {
    const mode = (o.value as { mode?: unknown }).mode;
    if (typeof mode === "string") return mode;
  }
  return o.key ?? "";
}

function keyLabel(key: string): string {
  return (
    CHOICE_LABELS[key] ??
    STEP_DEFS.find((s) => s.key === key)?.title ??
    (key === "domain" ? "领域选型" : key)
  );
}

export default function WizardDrawer({
  open,
  onClose,
  onEnterDesigner,
}: {
  open: boolean;
  onClose: () => void;
  /** 完成或已建应用后跳进该应用的设计器 */
  onEnterDesigner: (appId: string) => void;
}) {
  const [session, setSession] = useState<WizardSessionView | null>(null);
  const [starting, setStarting] = useState(false);
  const [scenarioDraft, setScenarioDraft] = useState("");
  const [recommendOrder, setRecommendOrder] = useState<string[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [recommending, setRecommending] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [invalidatedNotice, setInvalidatedNotice] = useState<string[]>([]);
  /** 候选缓存：选型定案后服务端改回抉择脚本，领域名展示靠本地缓存兜底 */
  const [candidateCache, setCandidateCache] = useState<WizardCandidate[]>([]);
  const [appIdDraft, setAppIdDraft] = useState("");
  const [appNameDraft, setAppNameDraft] = useState("");
  const [creatingApp, setCreatingApp] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  const startNew = useCallback(async () => {
    setStarting(true);
    try {
      const created = await api.wizardCreate();
      // 创建回执只带会话本体、不带阶段脚本：补读一次拿选型候选
      // （wizardGet 已把顶层 script 合并进视图）；补读失败不阻塞开向导。
      let s = created;
      try {
        s = await api.wizardGet(created.id);
      } catch {
        s = created;
      }
      setSession(s);
      setScenarioDraft(s.scenario ?? "");
      setRecommendOrder(null);
      setReasons({});
      setInvalidatedNotice([]);
      setPublishedVersion(null);
      setAppIdDraft("");
      setAppNameDraft("");
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setStarting(false);
    }
  }, []);

  // 打开向导：无会话或上次会话已终结（完成/放弃）时开新会话；进行中会话直接续上
  useEffect(() => {
    if (!open) return;
    if (!session || session.stage === "done" || session.stage === "abandoned") {
      void startNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (session?.candidates && session.candidates.length > 0) {
      setCandidateCache(session.candidates);
    }
  }, [session?.candidates]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      setSession(await api.wizardGet(session.id));
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  }, [session]);

  // ------------------------------------------------------------ 派生状态
  const stage = session?.stage;
  const domainKey = session?.domainKey ?? null;
  const domainName =
    candidateCache.find((c) => c.key === domainKey)?.name ?? domainKey;
  const candidates = (() => {
    const base = session?.candidates ?? [];
    if (!recommendOrder || recommendOrder.length === 0) return base;
    const rank = new Map(recommendOrder.map((k, i) => [k, i]));
    return [...base].sort(
      (a, b) =>
        (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  })();
  const items = session?.items ?? [];
  const settled = (key: string): boolean => {
    if (!session) return false;
    const info = choiceInfo(session.choices[key]);
    return info.decided && !info.invalidated;
  };
  const allSettled =
    items.length > 0 && items.every((it) => settled(it.key));
  const companionUnlocked = Boolean(session?.appId) || allSettled;
  const stepApplied = (key: WizardStepKey): boolean =>
    session?.steps?.[key]?.status === "applied";
  const stepInvalidated = (key: WizardStepKey): boolean =>
    session?.steps?.[key]?.status === "invalidated";
  const stepEnabled = (idx: number): boolean =>
    STEP_DEFS.slice(0, idx).every(
      (s) => stepApplied(s.key) && !stepInvalidated(s.key),
    );

  // ------------------------------------------------------------ 动作
  const doRecommend = async () => {
    if (!session) return;
    const scenario = scenarioDraft.trim();
    if (!scenario) {
      void antdMessage.warning("先用一句话描述你想做的应用场景");
      return;
    }
    setRecommending(true);
    try {
      const res = await api.wizardRecommend(session.id, scenario);
      setRecommendOrder(res.order);
      setReasons(res.reasons);
      void antdMessage.success("已按场景给出推荐顺序，点选卡片即可定案");
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setRecommending(false);
    }
  };

  const doDomain = async (candidate: WizardCandidate) => {
    if (!session) return;
    setActingKey(`domain:${candidate.key}`);
    try {
      await api.wizardDomain(
        session.id,
        candidate.key,
        scenarioDraft.trim() || undefined,
      );
      setInvalidatedNotice([]);
      await refresh();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setActingKey(null);
    }
  };

  const doChoice = async (key: string, value: unknown) => {
    if (!session) return;
    setActingKey(`choice:${key}`);
    try {
      const res = await api.wizardChoices(session.id, key, value);
      // 回执 invalidated 是对象：choices 组（领域变更时）与 steps 组合并提示
      const invalidated = [
        ...(res.invalidated?.choices ?? []),
        ...(res.invalidated?.steps ?? []),
      ].map(keyLabel);
      if (invalidated.length > 0) {
        setInvalidatedNotice(invalidated);
      } else {
        setInvalidatedNotice([]);
        void antdMessage.success(`「${keyLabel(key)}」已定案`);
      }
      await refresh();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setActingKey(null);
    }
  };

  const doCreateApp = async () => {
    if (!session) return;
    const appId = appIdDraft.trim();
    const name = appNameDraft.trim();
    if (!/^[a-z][a-z0-9]*$/.test(appId)) {
      void antdMessage.warning("应用 id 须为小写字母开头，仅小写字母与数字");
      return;
    }
    if (!name) {
      void antdMessage.warning("请填写应用名称");
      return;
    }
    setCreatingApp(true);
    try {
      await api.wizardCreateApp(session.id, appId, name);
      void antdMessage.success("应用已创建，初始草稿已按定案生成");
      await refresh();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setCreatingApp(false);
    }
  };

  const doPublish = () => {
    if (!session?.appId) return;
    const appId = session.appId;
    Modal.confirm({
      title: "发布新版本？",
      content:
        "发布将基于已保存的草稿上线：陪跑步应用的变更都已写入草稿。发布后应用立即可以打开使用。",
      okText: "确认发布",
      cancelText: "再想想",
      onOk: async () => {
        setPublishing(true);
        try {
          const res = await api.publish(appId);
          await api.wizardComplete(session.id);
          setPublishedVersion(res.version);
          void antdMessage.success(`已发布 v${res.version}`);
          await refresh();
        } catch (err) {
          void antdMessage.error(errText(err));
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  const doAbandon = () => {
    if (!session) return;
    Modal.confirm({
      title: "放弃本次向导？",
      content: session.appId
        ? "已创建的应用会保留为普通草稿，不会被删除，之后可在应用列表里继续手动设计。"
        : "尚未创建应用，放弃不会产生任何变更。",
      okText: "放弃向导",
      okButtonProps: { danger: true },
      cancelText: "继续向导",
      onOk: async () => {
        try {
          await api.wizardAbandon(session.id);
          await refresh();
        } catch (err) {
          void antdMessage.error(errText(err));
        }
      },
    });
  };

  // ------------------------------------------------------------ 侧栏摘要
  const summaryPanel = session && (
    <div>
      <Typography.Text strong>定案摘要</Typography.Text>
      <div style={{ marginTop: 10, fontSize: 13, lineHeight: 2 }}>
        <div>
          阶段：
          <Tag style={{ marginLeft: 6 }}>
            {STAGE_TEXT[session.stage] ?? session.stage}
          </Tag>
        </div>
        <div>
          领域：
          {domainKey ? (
            <Typography.Text strong>{domainName}</Typography.Text>
          ) : (
            <Typography.Text type="secondary">未定案</Typography.Text>
          )}
        </div>
        <div>
          应用：
          {session.appId ? (
            <Typography.Text strong>{session.appId}</Typography.Text>
          ) : (
            <Typography.Text type="secondary">未创建</Typography.Text>
          )}
        </div>
      </div>
      <Divider style={{ margin: "12px 0" }} />
      <Typography.Text strong>抉择</Typography.Text>
      <div style={{ marginTop: 8 }}>
        {items.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            选型定案后逐项列出
          </Typography.Text>
        )}
        {items.map((it) => {
          const info = choiceInfo(session.choices[it.key]);
          return (
            <div
              key={it.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              <span style={{ flexShrink: 0 }}>{keyLabel(it.key)}</span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: tokens.colorTextSecondary,
                }}
              >
                {info.decided ? choiceSummary(info.value, it) : ""}
              </span>
              {info.invalidated ? (
                <Tag color="orange">待重定</Tag>
              ) : info.decided ? (
                <Tag color="green">已定案</Tag>
              ) : (
                <Tag>未定案</Tag>
              )}
            </div>
          );
        })}
      </div>
      <Divider style={{ margin: "12px 0" }} />
      <Typography.Text strong>陪跑进度</Typography.Text>
      <div style={{ marginTop: 8 }}>
        {STEP_DEFS.map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1 }}>{s.title}</span>
            {stepInvalidated(s.key) ? (
              <Tag color="orange">需重走</Tag>
            ) : stepApplied(s.key) ? (
              <Tag color="green">已应用</Tag>
            ) : session.steps?.[s.key]?.proposalId ? (
              <Tag color="blue">待确认</Tag>
            ) : (
              <Tag>未开始</Tag>
            )}
          </div>
        ))}
      </div>
      {stage !== "done" && stage !== "abandoned" && (
        <>
          <Divider style={{ margin: "12px 0" }} />
          <Button danger block onClick={doAbandon}>
            放弃向导
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Drawer
      title="创建向导"
      width={940}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      {!session ? (
        <div style={{ padding: "48px 0", textAlign: "center" }}>
          {starting ? (
            <Spin size="large" tip="正在开启向导…" />
          ) : (
            <>
              <Typography.Paragraph type="secondary">
                向导会话开启失败，请重试。
              </Typography.Paragraph>
              <Button type="primary" onClick={() => void startNew()}>
                重新开启
              </Button>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 20 }}>
            {stage === "abandoned" ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="本次向导已放弃"
                  description={
                    session.appId
                      ? `应用 ${session.appId} 已保留为普通草稿，可在应用列表中继续手动设计。`
                      : "尚未创建应用，没有产生任何变更。"
                  }
                />
                <Button
                  type="primary"
                  style={{ marginTop: 14 }}
                  onClick={() => void startNew()}
                >
                  开始新的向导
                </Button>
              </>
            ) : stage === "done" ? (
              <>
                <Alert
                  type="success"
                  showIcon
                  message={
                    publishedVersion
                      ? `已发布 v${publishedVersion}，向导完成`
                      : "已发布，向导完成"
                  }
                  description="应用已经上线，可以打开使用；后续调整可在设计器里继续，或用单发提案做增量设计。"
                />
                <Space style={{ marginTop: 14 }}>
                  {session.appId && (
                    <Button
                      type="primary"
                      onClick={() =>
                        window.open(
                          `https://coode.cc.cd/app/${encodeURIComponent(session.appId!)}`,
                          "_blank",
                        )
                      }
                    >
                      打开应用
                    </Button>
                  )}
                  {session.appId && (
                    <Button
                      onClick={() => onEnterDesigner(session.appId!)}
                    >
                      进入设计器
                    </Button>
                  )}
                  <Button onClick={onClose}>关闭</Button>
                </Space>
              </>
            ) : (
              <>
                {/* ---------------- 选型段 ---------------- */}
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  一、选型：先定领域
                </Typography.Title>
                {domainKey ? (
                  <Typography.Paragraph style={{ fontSize: 13 }}>
                    已选领域：<Typography.Text strong>{domainName}</Typography.Text>
                    <Typography.Text type="secondary">
                      （如需更换领域，请放弃本次向导后重新开始）
                    </Typography.Text>
                  </Typography.Paragraph>
                ) : (
                  <>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ fontSize: 13 }}
                    >
                      用一句话描述你想做的应用，智能推荐只会在下列候选内排序并给理由；也可以跳过推荐，直接点选最贴近的领域定案。
                    </Typography.Paragraph>
                    <Input.TextArea
                      rows={2}
                      value={scenarioDraft}
                      onChange={(e) => setScenarioDraft(e.target.value)}
                      placeholder="例如：给设备做巡检记录，巡检员扫码登记检查结果，主管能看统计"
                      maxLength={300}
                      showCount
                    />
                    <div style={{ margin: "10px 0 14px" }}>
                      <Button
                        loading={recommending}
                        onClick={() => void doRecommend()}
                      >
                        智能推荐
                      </Button>
                      {recommendOrder && (
                        <Typography.Text
                          type="secondary"
                          style={{ marginLeft: 10, fontSize: 12 }}
                        >
                          已按推荐顺序排列，点选卡片即定案
                        </Typography.Text>
                      )}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      {candidates.map((c, idx) => (
                        <Card
                          key={c.key}
                          size="small"
                          title={
                            <span>
                              {c.name}
                              {recommendOrder && idx === 0 && (
                                <Tag color="green" style={{ marginLeft: 8 }}>
                                  首选推荐
                                </Tag>
                              )}
                            </span>
                          }
                          extra={
                            <Button
                              type="primary"
                              size="small"
                              loading={actingKey === `domain:${c.key}`}
                              onClick={() => void doDomain(c)}
                            >
                              选此领域
                            </Button>
                          }
                        >
                          <Typography.Paragraph
                            style={{ fontSize: 13, marginBottom: 6 }}
                          >
                            {c.description}
                          </Typography.Paragraph>
                          {c.differences && (
                            <Typography.Paragraph
                              type="secondary"
                              style={{ fontSize: 12, marginBottom: 0 }}
                            >
                              与其他候选的区别：{c.differences}
                            </Typography.Paragraph>
                          )}
                          {reasons[c.key] && (
                            <Typography.Paragraph
                              style={{ fontSize: 12, margin: "6px 0 0" }}
                            >
                              推荐理由：{reasons[c.key]}
                            </Typography.Paragraph>
                          )}
                        </Card>
                      ))}
                    </div>
                    {candidates.length === 0 && (
                      <Typography.Text type="secondary">
                        候选加载中或暂无可用领域…
                      </Typography.Text>
                    )}
                  </>
                )}

                {/* ---------------- 抉择段 ---------------- */}
                {domainKey && (
                  <>
                    <Divider style={{ margin: "20px 0 12px" }} />
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      二、抉择：逐项定案（可随时回改）
                    </Typography.Title>
                    {invalidatedNotice.length > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        closable
                        onClose={() => setInvalidatedNotice([])}
                        style={{ marginBottom: 12 }}
                        message="刚才的回改使以下内容失效，需要重新定案或重走"
                        description={invalidatedNotice.join("、")}
                      />
                    )}
                    {items.length === 0 && (
                      <Typography.Text type="secondary">
                        抉择项加载中…
                      </Typography.Text>
                    )}
                    {items.map((it) => (
                      <DecisionItemCard
                        key={`${session.id}:${it.key}:${choiceInfo(session.choices[it.key]).invalidated}:${session.updatedAt ?? ""}`}
                        item={it}
                        raw={session.choices[it.key]}
                        scopes={it.scopes ?? session.memberScopes ?? []}
                        submitting={actingKey === `choice:${it.key}`}
                        onSubmit={(value) => void doChoice(it.key, value)}
                      />
                    ))}
                  </>
                )}

                {/* ---------------- 陪跑段 ---------------- */}
                {companionUnlocked && (
                  <>
                    <Divider style={{ margin: "20px 0 12px" }} />
                    <Typography.Title level={5} style={{ marginTop: 0 }}>
                      三、陪跑：建应用并逐步生成
                    </Typography.Title>
                    {!session.appId ? (
                      <Card size="small">
                        <Typography.Paragraph
                          type="secondary"
                          style={{ fontSize: 13 }}
                        >
                          创建后将按已定案的领域与样板生成初始草稿，然后开始三步陪跑生成。
                        </Typography.Paragraph>
                        <Space direction="vertical" style={{ display: "flex" }} size={10}>
                          <span>
                            应用 id（小写字母开头，仅小写字母与数字，创建后不可改）：
                            <Input
                              style={{ width: 260, marginLeft: 8 }}
                              value={appIdDraft}
                              onChange={(e) => setAppIdDraft(e.target.value)}
                              placeholder="如 patrol"
                            />
                          </span>
                          <span>
                            应用名称：
                            <Input
                              style={{ width: 260, marginLeft: 8 }}
                              value={appNameDraft}
                              onChange={(e) => setAppNameDraft(e.target.value)}
                              placeholder="如 设备巡检记录站"
                            />
                          </span>
                          <Button
                            type="primary"
                            loading={creatingApp}
                            onClick={() => void doCreateApp()}
                            style={{ alignSelf: "flex-start" }}
                          >
                            创建应用并开始陪跑
                          </Button>
                        </Space>
                      </Card>
                    ) : (
                      <>
                        {STEP_DEFS.map((def, idx) => (
                          <WizardStepCard
                            key={def.key}
                            session={session}
                            stepKey={def.key}
                            title={def.title}
                            desc={def.desc}
                            enabled={stepEnabled(idx)}
                            onSessionChanged={() => void refresh()}
                          />
                        ))}
                        <Card size="small" title="四、发布上线">
                          {!STEP_DEFS.every(
                            (s) => stepApplied(s.key) && !stepInvalidated(s.key),
                          ) && (
                            <Typography.Paragraph
                              type="secondary"
                              style={{ fontSize: 13 }}
                            >
                              尚有步骤未完成或需重走（
                              {STEP_DEFS.filter(
                                (s) =>
                                  !stepApplied(s.key) || stepInvalidated(s.key),
                              )
                                .map((s) => s.title)
                                .join("、")}
                              ）。也可以先发布当前草稿，之后在设计器里继续完善。
                            </Typography.Paragraph>
                          )}
                          <Button
                            type="primary"
                            loading={publishing}
                            onClick={doPublish}
                          >
                            发布新版本
                          </Button>
                        </Card>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          <div
            style={{
              width: 248,
              flexShrink: 0,
              borderLeft: `1px solid ${tokens.colorBorder}`,
              paddingLeft: 20,
            }}
          >
            {summaryPanel}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/**
 * 抉择单条卡：按 kind 渲染选项（多选 / 成套确认 / 角色改名 / 单选），
 * 本地草稿初值取已定案值；提交后由父组件调定案端点并处理失效通知。
 */
function DecisionItemCard({
  item,
  raw,
  scopes,
  submitting,
  onSubmit,
}: {
  item: WizardDecisionItem;
  raw: unknown;
  scopes: string[];
  submitting: boolean;
  onSubmit: (value: unknown) => void;
}) {
  const info = choiceInfo(raw);
  const saved = info.value;
  const [multiSel, setMultiSel] = useState<string[]>(() =>
    Array.isArray(saved) ? saved.filter((x): x is string => typeof x === "string") : [],
  );
  // 单选回显：主题定案是字符串（主题 id / later）；会员域定案是
  // { mode, scopeKey? } 对象，单选值取 mode、并入目标另存 scopeSel。
  const [singleSel, setSingleSel] = useState<string>(() => {
    if (typeof saved === "string") return saved;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const mode = (saved as { mode?: unknown }).mode;
      if (typeof mode === "string") return mode;
    }
    return "";
  });
  const [scopeSel, setScopeSel] = useState<string>(() => {
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      const sk = (saved as { scopeKey?: unknown }).scopeKey;
      if (typeof sk === "string") return sk;
    }
    return "";
  });
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {};
    const savedObj =
      saved && typeof saved === "object" && !Array.isArray(saved)
        ? (saved as Record<string, unknown>)
        : {};
    for (const r of item.roles ?? []) {
      const v = savedObj[r.key];
      draft[r.key] = typeof v === "string" && v ? v : r.label;
    }
    return draft;
  });

  const label = item.label ?? keyLabel(item.key);
  // 主题方向保证有「稍后」兜底项（服务端未给时前端补齐，value 固定 later）
  const singleOptions =
    item.key === "theme" &&
    !item.options.some((o) => o.value === "later")
      ? [...item.options, { value: "later", label: "稍后再定" }]
      : item.options;

  const submit = () => {
    if (item.kind === "multi") {
      onSubmit(multiSel);
    } else if (item.kind === "confirm") {
      // 骨架全量装入确认：服务端只接受空数组（样板项恒为 key 数组形态）
      onSubmit([]);
    } else if (item.kind === "roleNames") {
      onSubmit(roleDraft);
    } else if (item.key === "memberScope") {
      // 会员域定案是对象形态：{ mode } 或并入既有时带 scopeKey
      if (singleSel === "existing") {
        if (!scopeSel) {
          void antdMessage.warning("请选择要并入的会员域");
          return;
        }
        onSubmit({ mode: "existing", scopeKey: scopeSel });
      } else {
        onSubmit({ mode: singleSel });
      }
    } else {
      onSubmit(singleSel);
    }
  };

  const submitDisabled =
    submitting ||
    (item.kind !== "multi" &&
      item.kind !== "confirm" &&
      item.kind !== "roleNames" &&
      !singleSel);

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <span>
          {label}
          {info.invalidated ? (
            <Tag color="orange" style={{ marginLeft: 8 }}>
              已失效，待重定
            </Tag>
          ) : info.decided ? (
            <Tag color="green" style={{ marginLeft: 8 }}>
              已定案
            </Tag>
          ) : null}
        </span>
      }
      extra={
        <Button
          type="primary"
          size="small"
          loading={submitting}
          disabled={submitDisabled}
          onClick={submit}
        >
          {info.decided ? "更新定案" : "定案"}
        </Button>
      }
    >
      {item.impact && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          影响：{item.impact}
        </Typography.Paragraph>
      )}
      {item.kind === "multi" && (
        <Space direction="vertical" size={6} style={{ display: "flex" }}>
          {item.options.map((o) => {
            const v = optionKeyOf(o);
            return (
              <Checkbox
                key={v}
                checked={multiSel.includes(v)}
                onChange={(e) =>
                  setMultiSel((prev) =>
                    e.target.checked
                      ? [...prev, v]
                      : prev.filter((k) => k !== v),
                  )
                }
              >
                {o.label}
                {o.description && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, marginLeft: 6 }}
                  >
                    {o.description}
                  </Typography.Text>
                )}
              </Checkbox>
            );
          })}
          {item.options.length === 0 && (
            <Typography.Text type="secondary">本领域暂无可选样板。</Typography.Text>
          )}
        </Space>
      )}
      {item.kind === "confirm" && (
        <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
          本领域的模型是固定成套的，将全量装入（实体、页面与权限草案一并生成），点「定案」确认装入。
        </Typography.Paragraph>
      )}
      {item.kind === "roleNames" && (
        <Space direction="vertical" size={8} style={{ display: "flex" }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只能修改显示名称，角色的权限语义不变。
          </Typography.Text>
          {(item.roles ?? []).map((r) => (
            <span key={r.key}>
              <Typography.Text style={{ display: "inline-block", width: 140 }}>
                {r.label}
              </Typography.Text>
              <Input
                style={{ width: 240 }}
                value={roleDraft[r.key] ?? ""}
                onChange={(e) =>
                  setRoleDraft((prev) => ({
                    ...prev,
                    [r.key]: e.target.value,
                  }))
                }
                placeholder="显示名称"
              />
            </span>
          ))}
          {(item.roles ?? []).length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              该领域没有预置角色，此项无需定案。
            </Typography.Text>
          )}
        </Space>
      )}
      {item.kind !== "multi" &&
        item.kind !== "confirm" &&
        item.kind !== "roleNames" && (
          <>
            <Radio.Group
              value={singleSel}
              onChange={(e) => setSingleSel(e.target.value as string)}
            >
              <Space direction="vertical" size={6}>
                {singleOptions.map((o) => {
                  const k = optionKeyOf(o);
                  return (
                    <Radio key={k} value={k}>
                      {o.label}
                      {o.description && (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12, marginLeft: 6 }}
                        >
                          {o.description}
                        </Typography.Text>
                      )}
                    </Radio>
                  );
                })}
              </Space>
            </Radio.Group>
            {item.key === "memberScope" && singleSel === "existing" && (
              <div style={{ marginTop: 10 }}>
                <Select
                  style={{ width: 280 }}
                  placeholder="选择要并入的会员域"
                  value={scopeSel || undefined}
                  onChange={(v) => setScopeSel(v)}
                  options={scopes.map((s) => ({ value: s, label: s }))}
                />
                {scopes.length === 0 && (
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 12, marginLeft: 8 }}
                  >
                    暂无现存会员域可选
                  </Typography.Text>
                )}
              </div>
            )}
          </>
        )}
    </Card>
  );
}

/**
 * 陪跑单步卡：生成（向导步进端点）→ 轮询提案 → Diff 勾选 → 应用（既有
 * apply 端点）→ 登记已应用。已应用步不重开生成；仅当本步被抉择回改置
 * 失效时才允许重走。否决重出 = 写改述后重新生成，不动其他步。
 */
function WizardStepCard({
  session,
  stepKey,
  title,
  desc,
  enabled,
  onSessionChanged,
}: {
  session: WizardSessionView;
  stepKey: WizardStepKey;
  title: string;
  desc: string;
  enabled: boolean;
  onSessionChanged: () => void;
}) {
  const appId = session.appId ?? "";
  const stepState = session.steps?.[stepKey] ?? {};
  const invalidated = stepState.status === "invalidated";
  const applied = stepState.status === "applied" && !invalidated;
  const serverPid = stepState.proposalId ?? null;

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"gen" | "apply" | null>(null);

  const adopt = useCallback((p: Proposal) => {
    setProposal(p);
    setSelected(
      p.status === "ready"
        ? new Set((p.changes ?? []).map((c) => c.id))
        : new Set(),
    );
  }, []);

  // 服务端步状态带回提案 id 时拉取提案详情（首次挂载 / 重走后换新提案）
  useEffect(() => {
    if (!serverPid || !appId) return;
    if (proposal?.id === serverPid) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await api.copilotProposal(appId, serverPid);
        if (!cancelled) adopt(p);
      } catch {
        // 详情拉取失败静默：下一次会话刷新会再试
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPid, appId]);

  const generating = proposal?.status === "generating";

  // 生成中每 3s 轮询，就绪/失败后停并同步会话（步状态以服务端为准）
  useEffect(() => {
    if (!generating || !proposal) return;
    const pid = proposal.id;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const p = await api.copilotProposal(appId, pid);
          adopt(p);
          if (p.status !== "generating") onSessionChanged();
        } catch {
          // 单次轮询失败忽略，等下一拍
        }
      })();
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, proposal?.id, appId]);

  const doGenerate = async () => {
    setBusy("gen");
    try {
      const { proposalId } = await api.wizardStepGenerate(
        session.id,
        stepKey,
        note.trim() || undefined,
      );
      adopt(await api.copilotProposal(appId, proposalId));
      onSessionChanged();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const doApply = async () => {
    if (!proposal || proposal.status !== "ready" || selected.size === 0) return;
    setBusy("apply");
    try {
      const changeIds = [...selected];
      await api.copilotApply(appId, proposal.id, changeIds);
      await api.wizardStepApplied(session.id, stepKey, proposal.id);
      setProposal({
        ...proposal,
        status: "applied",
        appliedChangeIds: changeIds,
        appliedAt: new Date().toISOString(),
      });
      setSelected(new Set());
      void antdMessage.success("本步已应用到草稿");
      onSessionChanged();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const canGenerate = enabled && !applied && !generating;

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <span>
          {title}
          {invalidated ? (
            <Tag color="orange" style={{ marginLeft: 8 }}>
              需重走
            </Tag>
          ) : applied ? (
            <Tag color="green" style={{ marginLeft: 8 }}>
              已应用
            </Tag>
          ) : generating ? (
            <Tag color="processing" style={{ marginLeft: 8 }}>
              生成中
            </Tag>
          ) : proposal?.status === "ready" ? (
            <Tag color="blue" style={{ marginLeft: 8 }}>
              待确认
            </Tag>
          ) : !enabled ? (
            <Tag style={{ marginLeft: 8 }}>待上一步完成</Tag>
          ) : null}
        </span>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        {desc}
      </Typography.Paragraph>
      {invalidated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message="本步依据的抉择已变更，需要重新生成并应用本步；已应用的更早步骤不受影响。"
        />
      )}
      {!enabled ? (
        <Typography.Text type="secondary">
          上一步完成并应用后，本步开启。
        </Typography.Text>
      ) : applied ? (
        <>
          {proposal && (
            <ProposalDiffView
              proposal={proposal}
              selected={selected}
              onSelectedChange={setSelected}
            />
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已应用到草稿。如需调整，请回上方抉择段回改相关项，相关步会被标记为需重走。
          </Typography.Text>
        </>
      ) : (
        <>
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="对本步的补充或改述（可选）：如对上一版不满意，写明要改什么再重新生成"
            maxLength={300}
            disabled={generating}
          />
          <div style={{ marginTop: 10 }}>
            <Button
              type="primary"
              loading={busy === "gen"}
              disabled={!canGenerate}
              onClick={() => void doGenerate()}
            >
              {proposal ? "按改述重新生成" : "生成本步提案"}
            </Button>
            {generating && (
              <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
                正在生成…（生成在后台进行，可先关闭向导，回来后从定案摘要续上）
              </Typography.Text>
            )}
          </div>
          {proposal?.status === "failed" && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              message="本步生成失败"
              description={proposal.error ?? "生成未返回结果，请调整改述后重新生成。"}
            />
          )}
          {(proposal?.status === "ready" || proposal?.status === "applied") && (
            <>
              <Divider style={{ margin: "14px 0 10px" }} />
              <ProposalDiffView
                proposal={proposal}
                selected={selected}
                onSelectedChange={setSelected}
              />
              {proposal.status === "ready" && (
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 6 }}
                  loading={busy === "apply"}
                  disabled={selected.size === 0}
                  onClick={() => void doApply()}
                >
                  应用所选到草稿（{selected.size} 项）
                </Button>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
