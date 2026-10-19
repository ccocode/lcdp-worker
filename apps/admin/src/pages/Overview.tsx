import React, { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Typography } from "antd";
import { api } from "../api";
import type { PageKey } from "../App";

interface Stats {
  tenants: number | null;
  apps: number | null;
  users: number | null;
  todayCalls: number | null;
  todayTokens: number | null;
  kbPending: number | null;
  meteringStart: string | null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Overview({ go }: { go: (k: PageKey) => void }) {
  const [stats, setStats] = useState<Stats>({
    tenants: null,
    apps: null,
    users: null,
    todayCalls: null,
    todayTokens: null,
    kbPending: null,
    meteringStart: null,
  });

  useEffect(() => {
    let alive = true;
    const set = (patch: Partial<Stats>) =>
      alive && setStats((s) => ({ ...s, ...patch }));
    // 各来源独立取数：单个接口失败只让对应卡片留空，不拖垮整页
    void api.tenants.list().then((r) => set({ tenants: r.length })).catch(() => {});
    void api.apps.list().then((r) => set({ apps: r.length })).catch(() => {});
    void api.users.list().then((r) => set({ users: r.length })).catch(() => {});
    void api.kb.pending().then((r) => set({ kbPending: r.length })).catch(() => {});
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
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const v = (n: number | null) => (n === null ? "—" : n);

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("tenants")}>
            <Statistic title="租户数" value={v(stats.tenants)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("apps")}>
            <Statistic title="应用数" value={v(stats.apps)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("users")}>
            <Statistic title="用户数（当前租户）" value={v(stats.users)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("kb")}>
            <Statistic title="知识库待审" value={v(stats.kbPending)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("usage")}>
            <Statistic title="今日 AI 调用次数" value={v(stats.todayCalls)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable onClick={() => go("usage")}>
            <Statistic title="今日 Token 用量" value={v(stats.todayTokens)} />
          </Card>
        </Col>
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        用量统计起点：{stats.meteringStart ?? "—"}（自该日起开始计量，此前消耗不补录、不折算金额）。
      </Typography.Paragraph>
    </div>
  );
}
