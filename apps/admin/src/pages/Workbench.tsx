import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  List,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  auditActionText,
  statCardGradients,
  statCardText,
  statCardTextSecondary,
} from "@lcdp/ui";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type AdminAssistantSuggestion,
  type AdminPlatformSuggestionAppCount,
  type FlowTaskView,
  type Row as DataRow,
  type SubmissionItem,
  type SuggestionDispositionKind,
} from "../api";
import SuggestionList from "../components/assistant/SuggestionList";
import type { MetricDecl, PageContext, PageKey } from "../registry";
import { templateForDomain } from "../templates";
import { asText, fmtTime } from "../helpers";

/**
 * 首页工作台（第 57 步，方案 §1.5；对象形态归正 W4 改版）：全身份默认落点。
 * 两种形态按身份分开组装（2026-10-23 用户定调重构）：
 * - admin（平台管理员）：只呈现平台维度——平台管理在应用之上，工作台不含
 *   应用层的角色数据（待办指标卡与由待办/待审拼成的最近动态均不渲染），
 *   也不设页内标题（页面定位由外壳头部承担）。顺序 = 平台统计卡（一排
 *   六张、渐变色，色值在 @lcdp/ui 的 statCardGradients）→ 近 12 小时
 *   Token 用量柱状图（groupBy=hour，空小时补零）→ 应用健康与平台动态
 *   并排（限高、限行数；平台动态只取无应用归属的平台级事件）→ 平台
 *   提醒（第 95 步：平台级事件逐条 + 按应用计数、只给数字，为空不渲染）。
 * - 运营者（有当前应用）：当前应用的对象区块（待办/指标/快捷入口/动态，
 *   APP_LAYOUT）。领域关键指标由领域模版声明（templates），本页只消费。
 * 计数一律取服务端 total——唯一例外是待审提交：submissions 端点无分页与
 * total、返回全量数组，计数取数组长度（口径在此明示）。
 * （应用列表已按用户 2026-10-20 晚指示撤出工作台：切换走顶栏切换器、
 * 盘点走平台区「应用管理」、新建/删除走 Studio 建应用与应用管理。）
 */

type BlockKey =
  | "platform-stat-cards"
  | "usage-chart"
  | "app-health"
  | "recent-audit"
  | "platform-suggestions"
  | "task-metrics"
  | "quick-links"
  | "app-activity";

const APP_LAYOUT: BlockKey[] = ["task-metrics", "quick-links", "app-activity"];

const todayStr = () => new Date().toISOString().slice(0, 10);

interface FeedItem {
  time: string | null;
  text: string;
  page: PageKey;
}

export default function Workbench({ ctx }: { ctx: PageContext }) {
  const { isAdmin, appId, appMeta, user, go, switchApp, visibleKeys } = ctx;
  const appForm = appId !== null;

  // ---------- 平台形态数据 ----------
  const [pStats, setPStats] = useState<{
    tenants: number | null;
    apps: number | null;
    users: number | null;
    todayCalls: number | null;
    todayTokens: number | null;
    kbPending: number | null;
  }>({
    tenants: null,
    apps: null,
    users: null,
    todayCalls: null,
    todayTokens: null,
    kbPending: null,
  });
  const [hourly, setHourly] = useState<
    { label: string; tokens: number; calls: number }[] | null
  >(null);
  const [health, setHealth] = useState<
    { app: DataRow; pending: number | null }[] | null
  >(null);
  const [auditFeed, setAuditFeed] = useState<DataRow[] | null>(null);
  // 平台提醒（第 95 步线 B · B3）：平台级事件候选 + 按应用计数；
  // 加载失败静默呈空（整区不渲染），不影响工作台其余区块。
  const [pSuggestions, setPSuggestions] = useState<{
    events: AdminAssistantSuggestion[];
    appCounts: AdminPlatformSuggestionAppCount[];
  }>({ events: [], appCounts: [] });
  const [busySuggestionFp, setBusySuggestionFp] = useState<string | null>(
    null,
  );

  // 静默 catch 清零（第 73 步片二）：统计类加载失败以同 key toast 呈现，
  // 同区块多路失败只弹一条，不刷屏。
  const statFail = (key: string, label: string) => () =>
    void message.error({ key, content: `${label}加载失败` });

  useEffect(() => {
    // 平台维度数据只为 admin 加载：admin 的工作台就是平台维度（见文件头）
    if (!isAdmin) return;
    let alive = true;
    const set = (patch: Partial<typeof pStats>) =>
      alive && setPStats((s) => ({ ...s, ...patch }));
    void api.tenants.list().then((r) => set({ tenants: r.length })).catch(statFail("wb-pstats", "平台统计"));
    void api.apps.list().then((r) => set({ apps: r.length })).catch(statFail("wb-pstats", "平台统计"));
    void api.users.list().then((r) => set({ users: r.length })).catch(statFail("wb-pstats", "平台统计"));
    void api.kb.pending().then((r) => set({ kbPending: r.length })).catch(statFail("wb-pstats", "平台统计"));
    void api.usage
      .query({ groupBy: "day", from: todayStr(), to: todayStr() })
      .then((r) => {
        let calls = 0;
        let tokens = 0;
        for (const row of r.rows) {
          calls += typeof row.calls === "number" ? row.calls : 0;
          tokens += typeof row.total_tokens === "number" ? row.total_tokens : 0;
        }
        set({ todayCalls: calls, todayTokens: tokens });
      })
      .catch(statFail("wb-usage", "今日用量"));
    // 近 12 小时（含当前小时）Token 用量：小时桶按时刻对齐，空小时补零
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() - 11);
    void api.usage
      .query({ groupBy: "hour", from: start.toISOString(), to: now.toISOString() })
      .then((r) => {
        if (!alive) return;
        const byIso = new Map(r.rows.map((row) => [String(row.bucket), row]));
        const bars: { label: string; tokens: number; calls: number }[] = [];
        for (let i = 0; i < 12; i++) {
          const t = new Date(start.getTime() + i * 3_600_000);
          const row = byIso.get(t.toISOString());
          bars.push({
            label: `${t.getHours()}时`,
            tokens: typeof row?.total_tokens === "number" ? row.total_tokens : 0,
            calls: typeof row?.calls === "number" ? row.calls : 0,
          });
        }
        setHourly(bars);
      })
      .catch(statFail("wb-hourly", "近12小时用量"));
    void api.apps
      .list()
      .then(async (apps) => {
        const rows = await Promise.all(
          apps.map(async (app) => {
            try {
              const res = await api.flow.tasks(String(app.id), {
                status: "pending",
                limit: 1,
              });
              return { app, pending: res.total as number | null };
            } catch {
              return { app, pending: null };
            }
          }),
        );
        if (alive) setHealth(rows);
      })
      .catch(statFail("wb-health", "应用健康"));
    void api.audit
      // 平台动态：只取无应用归属的平台级事件（scope=platform），各应用明细不混显
      .list({ page: 1, pageSize: 10, scope: "platform" })
      // 口径：服务端 pageOf 固定每页 50 条、未采信 pageSize，行数上限在客户端截断
      .then((r) => alive && setAuditFeed(r.rows.slice(0, 10)))
      .catch(statFail("wb-audit", "平台动态"));
    // 平台提醒（第 95 步线 B）：独立静默读，失败即空、不弹 toast
    void api.assistant.suggestions
      .getPlatformSuggestions()
      .then((r) => {
        if (alive) {
          setPSuggestions({
            events: [...r.events].sort((a, b) => b.severity - a.severity),
            appCounts: r.appCounts,
          });
        }
      })
      .catch(() => {
        if (alive) setPSuggestions({ events: [], appCounts: [] });
      });
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // ---------- 应用形态数据 ----------
  const [tasks, setTasks] = useState<FlowTaskView[] | null>(null);
  const [tasksTotal, setTasksTotal] = useState<number | null>(null);
  const [pendingSubs, setPendingSubs] = useState<SubmissionItem[] | null>(null);
  const [metricValues, setMetricValues] = useState<Record<string, number | null>>(
    {},
  );

  useEffect(() => {
    if (!appId) return;
    let alive = true;
    void api.flow
      .tasks(appId, { status: "pending", limit: 200 })
      .then((res) => {
        if (!alive) return;
        setTasks(res.tasks);
        setTasksTotal(res.total);
      })
      .catch(statFail("wb-tasks", "待办"));
    void api.submissions
      .list(appId, "pending")
      .then((list) => alive && setPendingSubs(list))
      .catch(statFail("wb-subs", "待审提交"));
    return () => {
      alive = false;
    };
  }, [appId]);

  const template = templateForDomain(appMeta?.app.domain);
  const metricDecls: MetricDecl[] = useMemo(() => {
    if (!appMeta || !template) return [];
    const roles = appMeta.domainModules?.roles ?? {};
    return template.metrics.filter((m) => {
      const entityKey = m.entity ?? (m.entityRole ? roles[m.entityRole] : undefined);
      const em = appMeta.entities.find((e) => e.key === entityKey);
      if (!em || !em.actions.includes("read")) return false;
      if (m.filterField && m.filterValue) {
        const field = em.fields.find((f) => f.key === m.filterField);
        const values = (field?.options ?? []).map((o) =>
          typeof o === "string" ? o : o.value,
        );
        if (values.length > 0 && !values.includes(m.filterValue)) return false;
      }
      return true;
    });
  }, [appMeta, template]);

  useEffect(() => {
    if (!appId || !appMeta || metricDecls.length === 0) return;
    let alive = true;
    const roles = appMeta.domainModules?.roles ?? {};
    for (const m of metricDecls) {
      const entityKey = m.entity ?? roles[m.entityRole!]!;
      void api.adminData
        .list(appId, entityKey, {
          limit: 1,
          filters:
            m.filterField && m.filterValue
              ? { [m.filterField]: m.filterValue }
              : undefined,
        })
        .then((res) => {
          if (alive) setMetricValues((s) => ({ ...s, [m.key]: res.total }));
        })
        .catch(() => {
          if (alive) setMetricValues((s) => ({ ...s, [m.key]: null }));
        });
    }
    return () => {
      alive = false;
    };
  }, [appId, appMeta, metricDecls]);

  const mineTasks = useMemo(
    () =>
      (tasks ?? []).filter(
        (t) =>
          (t.assigneeUserId !== null && t.assigneeUserId === user.id) ||
          (t.assigneeRole !== null && t.assigneeRole === user.role),
      ),
    [tasks, user.id, user.role],
  );

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];
    for (const t of (tasks ?? []).slice(0, 20)) {
      items.push({
        time: t.createdAt,
        text: `待办 · ${t.nodeLabel ?? t.workflowId}（${t.entity}）`,
        page: "tasks",
      });
    }
    for (const s of pendingSubs ?? []) {
      items.push({
        time: s.createdAt,
        text: `待审提交 · ${s.entity}`,
        page: "submissions",
      });
    }
    return items
      .sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")))
      .slice(0, 6);
  }, [tasks, pendingSubs]);

  const quickLinks = useMemo(() => {
    const base = [
      { label: "流程待办", page: "tasks" as PageKey },
      { label: "数据维护", page: "data" as PageKey },
      { label: "提交审核", page: "submissions" as PageKey },
      { label: "资产管理", page: "appassets" as PageKey },
    ];
    const all = [...(template?.quickLinks ?? []), ...base];
    const seen = new Set<PageKey>();
    return all.filter((l) => {
      if (!visibleKeys.has(l.page) || seen.has(l.page)) return false;
      seen.add(l.page);
      return true;
    });
  }, [template, visibleKeys]);

  // ---------- 平台提醒处置（第 95 步线 B · B3） ----------
  /** 处置回写（平台作用域）：成功才移除该条；失败留条并提示 */
  const applyPlatformDisposition = async (
    item: AdminAssistantSuggestion,
    disposition: SuggestionDispositionKind,
  ): Promise<void> => {
    setBusySuggestionFp(item.fingerprint);
    try {
      await api.assistant.suggestions.postSuggestionDisposition(
        { platform: true },
        item.fingerprint,
        { disposition },
      );
      setPSuggestions((s) => ({
        ...s,
        events: s.events.filter((e) => e.fingerprint !== item.fingerprint),
      }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusySuggestionFp(null);
    }
  };

  /**
   * 平台事件「去办」：记 acted 后深链——A2 熔断与配额页；A 类带应用
   * 归属的切到对应应用对应页（A1 审计日志 / A3 客服工单 / A4 应用
   * 设置），切应用后外壳地址对齐 effect 会把 ?app= 修正到新应用。
   */
  const goPlatformSuggestion = async (item: AdminAssistantSuggestion) => {
    await applyPlatformDisposition(item, "acted");
    const rule = item.rule || item.fingerprint.split(":")[0] || "";
    const targetApp = item.appId ?? item.subject?.appId ?? null;
    if (rule === "A2" || !targetApp) {
      go("switches");
      return;
    }
    switchApp(targetApp);
    if (rule === "A1") go("app-audit");
    else if (rule === "A3") go("support-tickets");
    else if (rule === "A4") go("appsettings");
    else go("appagentsvc-suggestions");
  };

  // ---------- 区块渲染（注册表） ----------
  const v = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n);

  const healthColumns: ColumnsType<{ app: DataRow; pending: number | null }> = [
    {
      title: "应用",
      render: (_, r) => asText(r.app.name ?? r.app.id),
    },
    {
      title: "发布版本",
      width: 110,
      render: (_, r) => {
        const ver = r.app.current_version ?? r.app.currentVersion;
        return ver === null || ver === undefined ? "未发布" : `v${asText(ver)}`;
      },
    },
    {
      title: "状态",
      width: 100,
      render: (_, r) =>
        asText(r.app.status ?? "active") === "disabled" ? (
          <Tag color="red">停用</Tag>
        ) : (
          <Tag color="green">启用</Tag>
        ),
    },
    {
      title: "待办积压",
      width: 110,
      render: (_, r) => v(r.pending),
    },
  ];

  const blocks: Record<BlockKey, () => React.ReactNode> = {
    "platform-stat-cards": () => {
      const cards: { title: string; value: number | null; page: PageKey }[] = [
        { title: "租户数", value: pStats.tenants, page: "tenants" },
        { title: "应用数", value: pStats.apps, page: "apps" },
        { title: "用户数（当前租户）", value: pStats.users, page: "users" },
        { title: "知识库待审", value: pStats.kbPending, page: "kb" },
        { title: "今日 AI 调用次数", value: pStats.todayCalls, page: "usage" },
        { title: "今日 Token 用量", value: pStats.todayTokens, page: "usage" },
      ];
      return (
        <Row gutter={[16, 16]}>
          {cards.map((card, i) => {
            const g = statCardGradients[i % statCardGradients.length];
            return (
              <Col xs={24} sm={12} md={8} lg={4} key={card.title}>
                <Card
                  hoverable
                  onClick={() => go(card.page)}
                  style={{
                    background: `linear-gradient(135deg, ${g[0]}, ${g[1]})`,
                    border: "none",
                  }}
                >
                  <div style={{ color: statCardTextSecondary, fontSize: 13 }}>
                    {card.title}
                  </div>
                  <div
                    style={{
                      color: statCardText,
                      fontSize: 24,
                      fontWeight: 600,
                      lineHeight: "32px",
                      marginTop: 4,
                    }}
                  >
                    {card.value === null
                      ? "—"
                      : card.value.toLocaleString("en-US")}
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      );
    },
    "usage-chart": () => {
      const bars = hourly ?? [];
      const max = Math.max(1, ...bars.map((b) => b.tokens));
      const totalTokens = bars.reduce((s, b) => s + b.tokens, 0);
      const totalCalls = bars.reduce((s, b) => s + b.calls, 0);
      return (
        <Card
          title="Token 用量"
          style={{ marginTop: 16 }}
          extra={
            <Typography.Text type="secondary">
              共 {totalTokens.toLocaleString("en-US")} Token · {totalCalls} 次调用
            </Typography.Text>
          }
        >
          <div style={{ display: "flex", gap: 8 }}>
            {bars.map((b) => (
              <Tooltip
                key={b.label}
                title={`${b.label} · Token ${b.tokens.toLocaleString("en-US")} · 调用 ${b.calls} 次`}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 11, height: 16 }}
                  >
                    {b.tokens >= 1000
                      ? `${(b.tokens / 1000).toFixed(1)}k`
                      : b.tokens > 0
                        ? b.tokens
                        : ""}
                  </Typography.Text>
                  <div
                    style={{
                      height: 168,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        width: "70%",
                        maxWidth: 36,
                        height: `${Math.max((b.tokens / max) * 100, b.tokens > 0 ? 6 : 0)}%`,
                        minHeight: b.tokens > 0 ? 5 : 3,
                        background: `linear-gradient(180deg, ${statCardGradients[0][1]}, ${statCardGradients[0][0]})`,
                        borderRadius: 4,
                        opacity: b.tokens > 0 ? 1 : 0.25,
                      }}
                    />
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {b.label}
                  </Typography.Text>
                </div>
              </Tooltip>
            ))}
          </div>
          {hourly === null && (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          )}
        </Card>
      );
    },
    "app-health": () => (
      <Card title="应用健康" style={{ height: "100%" }}>
        <Table
          rowKey={(r) => String(r.app.id)}
          size="small"
          pagination={false}
          loading={health === null}
          columns={healthColumns}
          dataSource={health ?? []}
          scroll={{ y: 400 }}
        />
      </Card>
    ),
    "recent-audit": () => {
      // 布局（2026-10-23 优化）：操作者（账号）→ 动作中文标签（字典
      // @lcdp/ui auditActionText，未映射回落原码）→ 所属应用名（借健康表
      // id→名称映射）→ 时间右对齐单行不折行；整行 flex 单行排布。
      const appNameOf = (id: string) =>
        (health ?? []).find((h) => String(h.app.id) === id)?.app.name;
      return auditFeed && auditFeed.length > 0 ? (
        <Card title="平台动态" style={{ height: "100%" }}>
          <div style={{ maxHeight: 440, overflowY: "auto" }}>
            <List
              size="small"
              dataSource={auditFeed}
              renderItem={(r) => {
                const zh = auditActionText(r.action);
                // 注意：不能经 asText 取 appId（空值会被它转成 "—" 而误判为有值）
                const rawAppId = r.app_id ?? r.appId;
                const appId = typeof rawAppId === "string" ? rawAppId : "";
                return (
                  <List.Item style={{ padding: "8px 0" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        minWidth: 0,
                      }}
                    >
                      <Typography.Text style={{ flexShrink: 0 }}>
                        {asText(r.actor)}
                      </Typography.Text>
                      {zh ? (
                        <Tag style={{ margin: 0, flexShrink: 0 }}>{zh}</Tag>
                      ) : (
                        <Typography.Text code style={{ flexShrink: 0 }}>
                          {asText(r.action)}
                        </Typography.Text>
                      )}
                      {appId && (
                        <Typography.Text
                          type="secondary"
                          ellipsis
                          style={{ fontSize: 12 }}
                        >
                          {asText(appNameOf(appId) ?? appId)}
                        </Typography.Text>
                      )}
                      <Typography.Text
                        type="secondary"
                        style={{
                          marginLeft: "auto",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {fmtTime(r.created_at ?? r.createdAt)}
                      </Typography.Text>
                    </div>
                  </List.Item>
                );
              }}
            />
          </div>
        </Card>
      ) : null;
    },
    "platform-suggestions": () => {
      // 平台提醒（第 95 步线 B · B3）：事件逐条带处置；按应用计数只给
      // 数字（应用名借健康表映射，缺失回落 id），无正文、无处置按钮。
      const counts = pSuggestions.appCounts.filter(
        (c) => c.stalledOrFailedTasks > 0 || c.unverifiedClaims > 0,
      );
      if (pSuggestions.events.length === 0 && counts.length === 0) return null;
      const appNameOf = (id: string) =>
        (health ?? []).find((h) => String(h.app.id) === id)?.app.name;
      return (
        <Card title="平台提醒" style={{ marginTop: 16 }}>
          {pSuggestions.events.length > 0 && (
            <SuggestionList
              items={pSuggestions.events}
              busyFingerprint={busySuggestionFp}
              onGo={(item) => void goPlatformSuggestion(item)}
              onDispose={(item, d) =>
                void applyPlatformDisposition(item, d)
              }
            />
          )}
          {counts.map((c) => (
            <Typography.Text
              key={c.appId}
              type="secondary"
              style={{ display: "block", fontSize: 12, marginTop: 4 }}
            >
              {asText(appNameOf(c.appId) ?? c.appId)}：悬置/未过任务{" "}
              {c.stalledOrFailedTasks} 张 · 未核实声称 {c.unverifiedClaims} 次
            </Typography.Text>
          ))}
        </Card>
      );
    },
    "task-metrics": () => (
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("tasks")}>
            <Statistic title="待我办理" value={v(tasks ? mineTasks.length : null)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("tasks")}>
            <Statistic title="待办积压（全部）" value={v(tasksTotal)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("submissions")}>
            {/* 口径：submissions 端点无 total，计数为返回数组长度 */}
            <Statistic title="待审提交" value={v(pendingSubs?.length)} />
          </Card>
        </Col>
        {metricDecls.map((m) => (
          <Col xs={24} sm={12} lg={6} key={m.key}>
            <Card hoverable onClick={() => go(m.page)}>
              <Statistic title={m.label} value={v(metricValues[m.key])} />
            </Card>
          </Col>
        ))}
      </Row>
    ),
    "quick-links": () => (
      <Card title="快捷入口" style={{ marginTop: 16 }}>
        <Space wrap>
          {quickLinks.map((l) => (
            <Button key={l.page} onClick={() => go(l.page)}>
              {l.label}
            </Button>
          ))}
        </Space>
      </Card>
    ),
    "app-activity": () =>
      feed.length > 0 ? (
        <Card title="最近动态" style={{ marginTop: 16 }}>
          <List
            size="small"
            dataSource={feed}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="go"
                    size="small"
                    type="link"
                    onClick={() => go(item.page)}
                  >
                    查看
                  </Button>,
                ]}
              >
                <Space wrap>
                  <Typography.Text type="secondary">
                    {fmtTime(item.time)}
                  </Typography.Text>
                  <Typography.Text>{item.text}</Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      ) : null,
  };

  if (!appForm && !isAdmin) {
    // 运营者无应用上下文只是归位 effect 生效前的瞬态；给出占位而非平台数据
    return (
      <Card>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          正在进入你的应用工作台…
        </Typography.Paragraph>
      </Card>
    );
  }

  // 组装顺序按身份分开（见文件头）：运营者 = APP_LAYOUT（应用对象区块）；
  // admin = 平台维度（统计卡一排 → 用量图 → 健康/动态并排），不渲染
  // task-metrics / app-activity 等应用层角色数据；两形态均不设页内标题。
  return (
    <div>
      {appForm &&
        !isAdmin &&
        APP_LAYOUT.map((key) => (
          <React.Fragment key={key}>{blocks[key]()}</React.Fragment>
        ))}
      {isAdmin && (
        <>
          {blocks["platform-stat-cards"]()}
          {blocks["usage-chart"]()}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} xl={12}>
              {blocks["app-health"]()}
            </Col>
            <Col xs={24} xl={12}>
              {blocks["recent-audit"]()}
            </Col>
          </Row>
          {blocks["platform-suggestions"]()}
        </>
      )}
    </div>
  );
}
