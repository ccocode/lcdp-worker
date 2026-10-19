import React from "react";
import { ApartmentOutlined, AuditOutlined, BookOutlined, TeamOutlined } from "@ant-design/icons";
import type { PageDef, TemplateDef } from "../registry";
import DataAdmin from "../pages/DataAdmin";
import Submissions from "../pages/Submissions";
import ContentArticles from "../pages/ContentArticles";

/**
 * 内容领域管理模版（第 57 步自 App.tsx 菜单/渲染链迁入注册表）：
 * 四页沿用三重门控（domain=content + 映射健康 + 锚点实体存在，见注册表
 * 可见性谓词），页面本体仍是既有组件（文章工作台 / DataAdmin lockEntity /
 * Submissions entityFilter），本步不改其行为。
 */
const pages: PageDef[] = [
  {
    key: "content-workbench",
    label: "文章工作台",
    icon: <BookOutlined />,
    segment: "template",
    section: "内容运营",
    templateDomain: "content",
    needsMeta: true,
    requiresEntities: [{ role: "article" }],
    render: (ctx) => (
      <ContentArticles key={ctx.appId!} appId={ctx.appId!} meta={ctx.appMeta!} />
    ),
  },
  {
    key: "content-categories",
    label: "栏目管理",
    icon: <ApartmentOutlined />,
    segment: "template",
    section: "内容运营",
    templateDomain: "content",
    needsMeta: true,
    requiresEntities: [{ role: "category" }],
    render: (ctx) => (
      <DataAdmin
        key={`${ctx.appId!}:cat`}
        appId={ctx.appId!}
        meta={ctx.appMeta!}
        lockEntity={ctx.appMeta?.domainModules?.roles["category"] ?? "category"}
        title="栏目管理"
      />
    ),
  },
  {
    key: "content-authors",
    label: "作者管理",
    icon: <TeamOutlined />,
    segment: "template",
    section: "内容运营",
    templateDomain: "content",
    needsMeta: true,
    requiresEntities: [{ role: "author" }],
    render: (ctx) => (
      <DataAdmin
        key={`${ctx.appId!}:author`}
        appId={ctx.appId!}
        meta={ctx.appMeta!}
        lockEntity={ctx.appMeta?.domainModules?.roles["author"] ?? "author"}
        title="作者管理"
      />
    ),
  },
  {
    key: "content-messages",
    label: "留言审核",
    icon: <AuditOutlined />,
    segment: "template",
    section: "内容运营",
    templateDomain: "content",
    requiresEntities: [{ role: "message" }],
    render: (ctx) => (
      <Submissions
        key={`${ctx.appId!}:msg`}
        appId={ctx.appId!}
        entityFilter={ctx.appMeta?.domainModules?.roles["message"] ?? "message"}
        title="留言审核"
      />
    ),
  },
];

export const contentTemplate: TemplateDef = {
  domain: "content",
  section: "内容运营",
  pages,
  /**
   * 工作台领域关键指标声明（方案 §1.5：指标由模版声明、工作台只消费）：
   * 实体经 roles 锚点解析；状态值取 content 骨架状态枚举，运行时再校验
   * 该值确实在已发布字段 options 内，不在则整卡不渲染（防骨架升版漂移）。
   */
  metrics: [
    { key: "pending-articles", label: "待审文章", entityRole: "article", filterField: "status", filterValue: "待审核", page: "content-workbench" },
    { key: "published-articles", label: "已发布文章", entityRole: "article", filterField: "status", filterValue: "已发布", page: "content-workbench" },
    { key: "draft-articles", label: "草稿文章", entityRole: "article", filterField: "status", filterValue: "草稿", page: "data" },
  ],
  quickLinks: [
    { label: "文章工作台", page: "content-workbench" },
    { label: "栏目管理", page: "content-categories" },
    { label: "留言审核", page: "content-messages" },
  ],
};
