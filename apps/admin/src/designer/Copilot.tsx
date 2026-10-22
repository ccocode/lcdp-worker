import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Input,
  List,
  Segmented,
  Space,
  Steps,
  Tag,
  Typography,
  message as antdMessage,
} from "antd";
import type { Proposal, ProposalChange, ProposalStatus } from "./api.js";
import { api } from "./api.js";
import { errText, fmtTime, tokens } from "@lcdp/ui";

/**
 * 设计态 AI Copilot 抽屉（M6）：一句话需求 → 七步生成链路 → 提案 Diff 逐项勾选 → 应用到草稿。
 * 生成走 api 异步提案通道（generate 立即返回 id，本组件每 3s 轮询状态）；
 * AI 只产出候选，Diff 由 api 对基线包确定性求差，本组件负责展示与勾选；
 * 应用后写的是设计草稿，发布仍由用户在设计器里人工确认（AI 永不直接发布）。
 */

const STEP_TITLES = [
  "意图解析",
  "规划拆解",
  "RAG 检索",
  "结构化生成",
  "静态校验",
  "Diff 预览",
  "用户确认",
] as const;

const EXAMPLES = [
  "给当前应用加一个供应商评价：记录每次交付的质量评分、准时率和评语，并生成评价列表页",
  "加一个图书借阅管理：图书、借阅记录（借阅人、借出与归还日期、状态），生成借阅列表页和借阅表单页",
];

const KIND_META: Record<
  ProposalChange["kind"],
  { color: string; text: string }
> = {
  addEntity: { color: "blue", text: "新增实体" },
  addField: { color: "green", text: "新增字段" },
  updateField: { color: "orange", text: "修改字段" },
  addPage: { color: "purple", text: "新增页面" },
};

const STATUS_META: Record<ProposalStatus, { color: string; text: string }> = {
  generating: { color: "processing", text: "生成中" },
  ready: { color: "green", text: "待确认" },
  failed: { color: "red", text: "生成失败" },
  applied: { color: "purple", text: "已应用" },
  discarded: { color: "default", text: "已丢弃" },
};

const SECTION_TITLES: Record<ProposalChange["section"], string> = {
  data: "数据模型",
  pages: "页面",
};

/* errText 单一实现已收编 @lcdp/ui（第 73 步片二），本文件直接引 ui 版 */

/** 提案 log 归一化为每步一句详情（字符串或结构化条目都收，按顺序回填到前六步） */
function logDetails(proposal: Proposal | null): (string | undefined)[] {
  const log = proposal?.log ?? [];
  return STEP_TITLES.slice(0, 6).map((_, i) => {
    const entry = log[i];
    if (!entry) return undefined;
    if (typeof entry === "string") return entry;
    return entry.detail ?? entry.message ?? entry.title;
  });
}

/**
 * 提案 Diff 呈现（Copilot 单发与创建向导陪跑步共用）：摘要 + 按段分组的
 * 变更清单；ready 态可勾选，applied 态以禁用勾选回显已应用条目。
 * 应用动作（调 apply 端点）由调用方持有，本组件只管展示与勾选状态。
 */
export function ProposalDiffView({
  proposal,
  selected,
  onSelectedChange,
}: {
  proposal: Proposal;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  const changes = proposal.changes ?? [];
  const sections = (["data", "pages"] as const)
    .map((section) => ({
      section,
      items: changes.filter((c) => c.section === section),
    }))
    .filter((g) => g.items.length > 0);
  const appliedIds = new Set(proposal.appliedChangeIds ?? []);
  return (
    <>
      {proposal.summary && (
        <Typography.Paragraph style={{ margin: "8px 0 4px", fontSize: 13 }}>
          {proposal.summary}
        </Typography.Paragraph>
      )}
      {changes.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          本次生成没有产生可应用的变更。
        </Typography.Paragraph>
      ) : (
        <>
          {proposal.status === "ready" && (
            <Space size={12} style={{ margin: "4px 0 8px" }}>
              <Typography.Link
                onClick={() =>
                  onSelectedChange(new Set(changes.map((c) => c.id)))
                }
              >
                全选
              </Typography.Link>
              <Typography.Link onClick={() => onSelectedChange(new Set())}>
                清空
              </Typography.Link>
              <Typography.Text type="secondary">
                已选 {selected.size} / {changes.length} 项
              </Typography.Text>
            </Space>
          )}
          {sections.map(({ section, items }) => (
            <div key={section} style={{ marginBottom: 10 }}>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, letterSpacing: 1 }}
              >
                {SECTION_TITLES[section]}（{items.length}）
              </Typography.Text>
              <List
                size="small"
                dataSource={items}
                renderItem={(c) => (
                  <List.Item style={{ padding: "6px 0" }}>
                    <Space size={8} align="start">
                      {proposal.status === "ready" ? (
                        <Checkbox
                          checked={selected.has(c.id)}
                          onChange={(e) =>
                            onSelectedChange(
                              (() => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(c.id);
                                else next.delete(c.id);
                                return next;
                              })(),
                            )
                          }
                        />
                      ) : (
                        <Checkbox checked={appliedIds.has(c.id)} disabled />
                      )}
                      <Tag
                        color={KIND_META[c.kind].color}
                        style={{ marginRight: 0 }}
                      >
                        {KIND_META[c.kind].text}
                      </Tag>
                      <span>{c.label}</span>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          ))}
        </>
      )}
    </>
  );
}

export default function Copilot({
  appId,
  open,
  onClose,
  onApplied,
  onOpenWizard,
}: {
  appId: string;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  /** 模式切换到「创建向导」时的跳转（向导只服务新建应用，去应用列表打开） */
  onOpenWizard?: () => void;
}) {
  /** 抽屉模式：single = 单发提案（当前应用增量）；wizard = 创建向导入口（新建应用专用） */
  const [mode, setMode] = useState<"single" | "wizard">("single");
  const [prompt, setPrompt] = useState("");
  const [exampleIdx, setExampleIdx] = useState(0);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Proposal[]>([]);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);
  /** 生成中的伪进度步（无服务端细粒度进度时按时间推进，封顶在 Diff 预览步等待就绪） */
  const [fakeStep, setFakeStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startAtRef = useRef<number | null>(null);

  const generating = current?.status === "generating";

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.copilotProposals(appId));
    } catch {
      // 历史拉取失败不阻塞主流程（抽屉打开时还会再试）
    }
  }, [appId]);

  /** 提案成为当前视图时：就绪默认全选其 Diff 条目；已应用则无可再选 */
  const adopt = useCallback((p: Proposal) => {
    setCurrent(p);
    setSelected(
      p.status === "ready"
        ? new Set((p.changes ?? []).map((c) => c.id))
        : new Set(),
    );
    if (p.status === "generating") {
      startAtRef.current = Date.now();
      setFakeStep(0);
      setElapsed(0);
    }
  }, []);

  // 抽屉打开：拉历史；若有生成中的提案，自动接管轮询展示
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const list = await api.copilotProposals(appId);
        setHistory(list);
        const running = list.find((p) => p.status === "generating");
        if (running && current?.id !== running.id) {
          adopt(await api.copilotProposal(appId, running.id));
        }
      } catch {
        // 同 refreshHistory：静默，生成主流程不受影响
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appId ]);

  // 生成中：每 3s 轮询提案状态，就绪/失败后停轮询并刷新历史
  useEffect(() => {
    if (!open || !generating || !current) return;
    const pid = current.id;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const p = await api.copilotProposal(appId, pid);
          if (p.status === "generating") {
            setCurrent(p);
          } else {
            adopt(p);
            void refreshHistory();
          }
        } catch {
          // 单次轮询失败忽略，等下一拍
        }
      })();
    }, 3000);
    return () => clearInterval(timer);
  }, [open, generating, current, appId, adopt, refreshHistory]);

  // 生成中：伪进度推进 + 已耗时（1s tick）
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      if (startAtRef.current) {
        setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000));
      }
      setFakeStep((s) => Math.min(s + 1, 5));
    }, 4000);
    const tick = setInterval(() => {
      if (startAtRef.current) {
        setElapsed(Math.floor((Date.now() - startAtRef.current) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [generating]);

  // 示例 placeholder 轮换（输入框为空时）
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(
      () => setExampleIdx((i) => (i + 1) % EXAMPLES.length),
      5000,
    );
    return () => clearInterval(timer);
  }, [open ]);

  const startGenerate = async (text: string) => {
    const value = text.trim();
    if (!value || starting) return;
    setStarting(true);
    try {
      const { id } = await api.copilotGenerate(appId, value);
      startAtRef.current = Date.now();
      setFakeStep(0);
      setElapsed(0);
      adopt({
        id,
        prompt: value,
        status: "generating",
        summary: null,
        changes: null,
        error: null,
        createdAt: new Date().toISOString(),
      });
      void refreshHistory();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setStarting(false);
    }
  };

  const applySelected = async () => {
    if (!current || current.status !== "ready" || selected.size === 0) return;
    setApplying(true);
    try {
      const changeIds = [...selected];
      const res = await api.copilotApply(appId, current.id, changeIds);
      const n = res.applied ?? changeIds.length;
      void antdMessage.success(
        `已应用 ${n} 项到草稿，请在设计器中复核后发布`,
      );
      setCurrent({
        ...current,
        status: "applied",
        appliedChangeIds: changeIds,
        appliedAt: new Date().toISOString(),
      });
      setSelected(new Set());
      void refreshHistory();
      onApplied();
      onClose();
    } catch (err) {
      void antdMessage.error(errText(err));
    } finally {
      setApplying(false);
    }
  };

  const openHistoryItem = async (item: Proposal) => {
    try {
      adopt(await api.copilotProposal(appId, item.id));
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  };

  // ------------------------------------------------------------ 七步进度
  const details = useMemo(() => logDetails(current), [current]);
  const stepItems = STEP_TITLES.map((title, i) => {
    let status: "wait" | "process" | "finish" | "error" = "wait";
    if (current) {
      if (current.status === "generating") {
        status = i < fakeStep ? "finish" : i === fakeStep ? "process" : "wait";
        if (i === 6) status = "wait";
      } else if (current.status === "failed") {
        status = i < fakeStep ? "finish" : i === fakeStep ? "error" : "wait";
        if (i === 6) status = "wait";
      } else {
        // ready / applied / discarded：前六步完成，第七步即确认区
        status =
          i < 6 ? "finish" : current.status === "applied" ? "finish" : "process";
      }
    }
    return {
      title,
      status,
      description:
        i < 6
          ? details[i]
          : current?.status === "applied"
            ? "已应用到草稿"
            : current?.status === "ready"
              ? "勾选下方变更后应用"
              : undefined,
    };
  });
  const stepCurrent =
    current?.status === "generating" || current?.status === "failed"
      ? fakeStep
      : current
        ? 6
        : 0;

  const changes = current?.changes ?? [];

  return (
    <Drawer
      title="AI 助手 · 设计 Copilot"
      width={560}
      open={open}
      onClose={onClose}
      destroyOnClose={false}
    >
      <Segmented
        block
        value={mode}
        onChange={(v) => setMode(v as "single" | "wizard")}
        options={[
          { label: "单发提案", value: "single" },
          { label: "创建向导", value: "wizard" },
        ]}
        style={{ marginBottom: 14 }}
      />
      {mode === "wizard" ? (
        <div>
          <Alert
            type="info"
            showIcon
            message="创建向导用于从零新建应用"
            description="向导会依次完成领域选型、关键抉择与分三步逐步生成，最后由你确认发布。已经打开的应用请继续用单发提案做增量设计。"
          />
          <Button
            type="primary"
            block
            style={{ marginTop: 14 }}
            disabled={!onOpenWizard}
            onClick={() => {
              onClose();
              onOpenWizard?.();
            }}
          >
            前往应用列表打开向导
          </Button>
        </div>
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            用一句话描述要新增的实体或页面。AI 生成的是作用于**当前应用**的增量提案：
            应用后只写入设计草稿，不会直接发布，请在设计器中复核后再发布。
          </Typography.Paragraph>
          <Input.TextArea
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={`例如：${EXAMPLES[exampleIdx]}`}
        disabled={generating}
        maxLength={500}
        showCount
      />
      <div style={{ marginTop: 10, display: "flex", alignItems: "center" }}>
        <Button
          type="primary"
          loading={starting}
          disabled={!prompt.trim() || generating}
          onClick={() => void startGenerate(prompt)}
        >
          生成提案
        </Button>
        {generating && (
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
            正在生成，已耗时 {elapsed}s（生成在后台进行，可先关闭抽屉，完成后在下方历史中查看）
          </Typography.Text>
        )}
      </div>

      {current && (
        <>
          <Divider style={{ margin: "18px 0 12px" }} />
          <Steps
            direction="vertical"
            size="small"
            current={stepCurrent}
            items={stepItems}
          />
        </>
      )}

      {current?.status === "failed" && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message="生成失败"
          description={current.error ?? "生成管线未返回结果，请调整需求后重试。"}
          action={
            <Button size="small" onClick={() => void startGenerate(current.prompt)}>
              重新生成
            </Button>
          }
        />
      )}

      {(current?.status === "ready" || current?.status === "applied") && (
        <>
          <Divider style={{ margin: "18px 0 12px" }} />
          <Typography.Text strong>变更预览（Diff）</Typography.Text>
          {current.status === "applied" && (
            <Tag color="purple" style={{ marginLeft: 8 }}>
              已应用到草稿
            </Tag>
          )}
          <ProposalDiffView
            proposal={current}
            selected={selected}
            onSelectedChange={setSelected}
          />
          {current.status === "ready" && changes.length > 0 && (
            <Button
              type="primary"
              block
              loading={applying}
              disabled={selected.size === 0}
              onClick={() => void applySelected()}
            >
              应用所选到草稿（{selected.size} 项）
            </Button>
          )}
        </>
      )}

      <Divider style={{ margin: "18px 0 12px" }} />
      <Typography.Text strong>历史提案</Typography.Text>
      <List
        size="small"
        style={{ marginTop: 6 }}
        dataSource={history.slice(0, 10)}
        locale={{ emptyText: "暂无历史提案" }}
        renderItem={(item) => (
          <List.Item
            onClick={() => void openHistoryItem(item)}
            style={{
              cursor: "pointer",
              background:
                current?.id === item.id ? tokens.colorPrimaryBg : undefined,
              padding: "8px 6px",
              borderRadius: 6,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Tag color={STATUS_META[item.status].color}>
                  {STATUS_META[item.status].text}
                </Tag>
                <Typography.Text
                  ellipsis
                  style={{ flex: 1, minWidth: 0 }}
                  title={item.prompt}
                >
                  {item.prompt}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12, flexShrink: 0 }}
                >
                  {fmtTime(item.createdAt)}
                </Typography.Text>
              </div>
              {item.summary && (
                <Typography.Text
                  type="secondary"
                  ellipsis
                  style={{ display: "block", fontSize: 12, marginTop: 2 }}
                  title={item.summary}
                >
                  {item.summary}
                </Typography.Text>
              )}
            </div>
          </List.Item>
        )}
      />
        </>
      )}
    </Drawer>
  );
}
