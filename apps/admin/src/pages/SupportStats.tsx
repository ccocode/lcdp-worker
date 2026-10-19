import React, { useEffect, useState } from "react";
import { Card, Col, Row, Space, Statistic, Typography } from "antd";
import { api, type AdminDataMeta } from "../api";
import type { PageKey } from "../registry";
import { setTicketQueueIntent } from "../templates/ticketQueueIntent";

/**
 * 服务统计（第 58 步，客服领域模版）：四张统计卡，口径逐字对齐 support
 * 骨架 /support-stats 的 statCard 定义——工单总数（无过滤）/ 待受理
 * （status eq 待受理）/ 已解决（status eq 已解决）/ 转人工建单
 * （source eq 访客咨询）。数据走 admindata 列表计数（limit=1 取 total，
 * 四查并发），不新开端点。点卡跳工单工作台对应队列。
 */
export default function SupportStats({
  appId,
  meta,
  go,
}: {
  appId: string;
  meta: AdminDataMeta;
  go: (key: PageKey) => void;
}) {
  const roles = meta.domainModules?.roles ?? {};
  const ticketKey = roles["ticket"] ?? "after_sale_ticket";
  const [values, setValues] = useState<(number | null)[]>([null, null, null, null]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const queries: (Record<string, string> | undefined)[] = [
      undefined,
      { status: "待受理" },
      { status: "已解决" },
      { source: "访客咨询" },
    ];
    void Promise.all(
      queries.map((filters) =>
        api.adminData
          .list(appId, ticketKey, { limit: 1, filters })
          .then((res) => res.total)
          .catch(() => null),
      ),
    ).then((totals) => {
      if (!alive) return;
      setValues(totals);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [appId, ticketKey]);

  const cards: { label: string; queue: string; hint: string }[] = [
    { label: "工单总数", queue: "all", hint: "全部工单" },
    { label: "待受理", queue: "待受理", hint: "等待坐席受理" },
    { label: "已解决", queue: "已解决", hint: "已给出处理结论" },
    { label: "转人工建单", queue: "all", hint: "由访客咨询转人工建立" },
  ];

  return (
    <Card title="服务统计">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          口径与骨架服务统计一致（转人工建单 = 来源为「访客咨询」的工单）；点卡片进入工单工作台对应队列。
        </Typography.Text>
        <Row gutter={16}>
          {cards.map((c, i) => (
            <Col key={c.label} xs={12} lg={6}>
              <Card
                size="small"
                hoverable
                loading={loading}
                onClick={() => {
                  setTicketQueueIntent(c.queue);
                  go("support-tickets");
                }}
              >
                <Statistic title={c.label} value={values[i] ?? "—"} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.hint}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      </Space>
    </Card>
  );
}
