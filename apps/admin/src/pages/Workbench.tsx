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
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type FlowTaskView,
  type Row as DataRow,
  type SubmissionItem,
} from "../api";
import type { MetricDecl, PageContext, PageKey } from "../registry";
import { templateForDomain } from "../templates";
import { asText, fmtTime } from "../helpers";

/**
 * 首页工作台（第 57 步，方案 §1.5；对象形态归正 W4 改版）：全身份默认落点。
 * 进入管理台即默认身处一个应用（外壳归位保证），本页统一顺序组装：
 * 当前应用的对象区块（待办/指标/快捷入口/动态）→ admin 附加
 * 的平台维度三区块（平台统计数字、应用健康积压计数、平台动态——只取无
 * 应用归属的平台级事件）。领域关键指标由领域模版声明（templates），
 * 本页只消费。计数一律取服务端 total——唯一例外是待审提交：submissions
 * 端点无分页与 total、返回全量数组，计数取数组长度（口径在此明示）。
 */

type BlockKey =
  | "platform-stats"
  | "app-health"
  | "recent-audit"
  | "task-metrics"
  | "quick-links"
  | "app-activity";

/**
 * 版式声明：有当前应用时 APP_LAYOUT → admin 附加 PLATFORM_LAYOUT。
 * （应用列表已按用户 2026-10-20 晚指示撤出工作台：切换走顶栏切换器、
 * 盘点走平台区「应用管理」、新建/删除走 Studio 建应用与应用管理。） */
const PLATFORM_LAYOUT: BlockKey[] = ["platform-stats", "app-health", "recent-audit"];
const APP_LAYOUT: BlockKey[] = ["task-metrics", "quick-links", "app-activity"];

const todayStr = () => new Date().toISOString().slice(0, 10);

interface FeedItem {
  time: string | null;
  text: string;
  page: PageKey;
}

export default function Workbench({ ctx }: { ctx: PageContext }) {
  const { isAdmin, appId, appMeta, user, go, visibleKeys } = ctx;
  const appForm = appId !== null;

  // ---------- 平台形态数据 ----------
  const [pStats, setPStats] = useState<{
    tenants: number | null;
    apps: number | null;
    users: number | null;
    todayCalls: number | null;
    todayTokens: number | null;
    kbPending: number | null;
    meteringStart: string | null;
  }>({
    tenants: null,
    apps: null,
    users: null,
    todayCalls: null,
    todayTokens: null,
    kbPending: null,
    meteringStart: null,
  });
  const [health, setHealth] = useState<
    { app: DataRow; pending: number | null }[] | null
  >(null);
  const [auditFeed, setAuditFeed] = useState<DataRow[] | null>(null);

  // 静默 catch 清零（第 73 步片二）：统计类加载失败以同 key toast 呈现，
  // 同区块多路失败只弹一条，不刷屏。
  const statFail = (key: string, label: string) => () =>
    void message.error({ key, content: `${label}加载失败` });

  useEffect(() => {
    // W4 后平台三区块是 admin 的附加维度：有无当前应用都加载（不再只限无应用形态）
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
        set({ todayCalls: calls, todayTokens: tokens, meteringStart: r.meteringStart });
      })
      .catch(statFail("wb-usage", "今日用量"));
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
      .list({ page: 1, pageSize: 8, scope: "platform" })
      .then((r) => alive && setAuditFeed(r.rows))
      .catch(statFail("wb-audit", "平台动态"));
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

  // ---------- 区块渲染（注册表） ----------
  const v = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n);

  const healthColumns: ColumnsType<{ app: DataRow; pending: number | null }> = [
    {
      title: "应用",
      render: (_, r) => `${asText(r.app.name ?? r.app.id)}（${asText(r.app.id)}）`,
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
          <Tag color="red">已下架</Tag>
        ) : (
          <Tag color="green">上架中</Tag>
        ),
    },
    {
      title: "待办积压",
      width: 110,
      render: (_, r) => v(r.pending),
    },
  ];

  const blocks: Record<BlockKey, () => React.ReactNode> = {
    "platform-stats": () => (
      <>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("tenants")}>
              <Statistic title="租户数" value={v(pStats.tenants)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("apps")}>
              <Statistic title="应用数" value={v(pStats.apps)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("users")}>
              <Statistic title="用户数（当前租户）" value={v(pStats.users)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("kb")}>
              <Statistic title="知识库待审" value={v(pStats.kbPending)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("usage")}>
              <Statistic title="今日 AI 调用次数" value={v(pStats.todayCalls)} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => go("usage")}>
              <Statistic title="今日 Token 用量" value={v(pStats.todayTokens)} />
            </Card>
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          用量统计起点：{pStats.meteringStart ?? "—"}
        </Typography.Paragraph>
      </>
    ),
    "app-health": () => (
      <Card title="应用健康" style={{ marginTop: 16 }}>
        <Table
          rowKey={(r) => String(r.app.id)}
          size="small"
          pagination={false}
          loading={health === null}
          columns={healthColumns}
          dataSource={health ?? []}
        />
      </Card>
    ),
    "recent-audit": () =>
      auditFeed && auditFeed.length > 0 ? (
        <Card title="平台动态" style={{ marginTop: 16 }}>
          <List
            size="small"
            dataSource={auditFeed}
            renderItem={(r) => (
              <List.Item>
                <Space wrap>
                  <Typography.Text type="secondary">
                    {fmtTime(r.created_at ?? r.createdAt)}
                  </Typography.Text>
                  <Typography.Text>{asText(r.actor)}</Typography.Text>
                  <Typography.Text code>{asText(r.action)}</Typography.Text>
                  <Typography.Text type="secondary">
                    {asText(r.app_id ?? r.appId)}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      ) : null,
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

  // 统一渲染顺序：（有当前应用）APP_LAYOUT →（admin）平台三区块
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {appForm
          ? `工作台 · ${appMeta?.app.name ?? ctx.currentApp?.name ?? appId}`
          : "工作台 · 平台总览"}
      </Typography.Title>
      {appForm &&
        APP_LAYOUT.map((key) => (
          <React.Fragment key={key}>{blocks[key]()}</React.Fragment>
        ))}
      {isAdmin &&
        PLATFORM_LAYOUT.map((key) => (
          <React.Fragment key={key}>{blocks[key]()}</React.Fragment>
        ))}
    </div>
  );
}
