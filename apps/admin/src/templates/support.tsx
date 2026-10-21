import React from "react";
import { BarChartOutlined, CustomerServiceOutlined } from "@ant-design/icons";
import type { PageDef, TemplateDef } from "../registry";
import SupportTickets from "../pages/SupportTickets";
import SupportStats from "../pages/SupportStats";

/**
 * 客服领域管理模版（第 58 步新建）：工单工作台 + 服务统计两页——实体定位
 * 走 domainModules.roles 的 ticket 锚点，门控 = domain 匹配 + 映射健康 +
 * 锚点齐备。工单流程的「坐席受理」审批节点由基础页流程待办承接
 * （坐席平台角色与节点指派同名直配），本模版不另设待办页。
 */
const pages: PageDef[] = [
  {
    key: "support-tickets",
    label: "工单工作台",
    icon: <CustomerServiceOutlined />,
    segment: "template",
    section: "客服工单",
    templateDomain: "support",
    needsMeta: true,
    requiresEntities: [{ role: "ticket" }],
    coversRole: "ticket",
    render: (ctx) => (
      <SupportTickets key={`${ctx.appId!}:tickets`} appId={ctx.appId!} meta={ctx.appMeta!} />
    ),
  },
  {
    key: "support-stats",
    label: "服务统计",
    icon: <BarChartOutlined />,
    segment: "template",
    section: "客服工单",
    templateDomain: "support",
    needsMeta: true,
    requiresEntities: [{ role: "ticket" }],
    render: (ctx) => (
      <SupportStats
        key={`${ctx.appId!}:stats`}
        appId={ctx.appId!}
        meta={ctx.appMeta!}
        go={ctx.go}
      />
    ),
  },
];

export const supportTemplate: TemplateDef = {
  domain: "support",
  section: "客服工单",
  pages,
  metrics: [
    { key: "pending-tickets", label: "待受理工单", entityRole: "ticket", filterField: "status", filterValue: "待受理", page: "support-tickets" },
    { key: "processing-tickets", label: "处理中工单", entityRole: "ticket", filterField: "status", filterValue: "处理中", page: "support-tickets" },
  ],
  quickLinks: [
    { label: "工单工作台", page: "support-tickets" },
    { label: "服务统计", page: "support-stats" },
  ],
};
