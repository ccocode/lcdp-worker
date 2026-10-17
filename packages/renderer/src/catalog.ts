import type { ComponentNode } from "@naka1205/schema";

/**
 * 组件目录：注册中心 v1 的物料清单（设计器物料面板的数据源）。
 * 与 createDefaultRegistry 的注册类型基本一一对应（ChartPlaceholder 仅作旧页面兼容注册、
 * 不再进物料栏，新图表统一用 Chart）；make 生成可直接落进页面树的默认节点，
 * 数据类组件的 binding.source 先留空字符串，由设计器在画布上绑定实体
 * （未绑定时服务端校验与运行态都会明确报错，属预期）。
 */
export const componentCatalog: Array<{
  type: string;
  label: string;
  category: "数据" | "布局" | "内容" | "动作" | "智能";
  description: string;
  make: (id: string) => ComponentNode;
}> = [
  {
    type: "Page",
    label: "页面",
    category: "布局",
    description: "页面根容器：标题 + 子组件纵向排列",
    make: (id) => ({
      id,
      type: "Page",
      props: { title: "页面标题" },
      children: [],
    }),
  },
  {
    type: "Container",
    label: "容器",
    category: "布局",
    description: "flex 布局容器：横排/竖排子组件，支持双设备方向变体",
    make: (id) => ({
      id,
      type: "Container",
      props: { direction: "column", gap: 12 },
      children: [],
    }),
  },
  {
    type: "Tabs",
    label: "标签页",
    category: "布局",
    description: "把子组件组织为可切换的页签（页签标题取子组件标题）",
    make: (id) => ({ id, type: "Tabs", children: [] }),
  },
  {
    type: "DataTable",
    label: "数据表格",
    category: "数据",
    description: "绑定实体的分页表格，支持指定列与数据视图过滤/排序",
    make: (id) => ({
      id,
      type: "DataTable",
      binding: { source: "" },
      props: { pageSize: 20 },
    }),
  },
  {
    type: "EntityForm",
    label: "实体表单",
    category: "数据",
    description: "绑定实体的新建/编辑表单（含主子表与总额汇总）",
    make: (id) => ({ id, type: "EntityForm", binding: { source: "" } }),
  },
  {
    type: "Detail",
    label: "详情",
    category: "数据",
    description: "按页面参数 id 展示一条记录的字段详情",
    make: (id) => ({ id, type: "Detail", binding: { source: "" } }),
  },
  {
    type: "StatCard",
    label: "统计卡片",
    category: "数据",
    description: "聚合数值卡片：计数/求和/平均，可带等值过滤与后缀",
    make: (id) => ({
      id,
      type: "StatCard",
      binding: { source: "", view: { aggregate: { fn: "count" } } },
      props: { title: "统计" },
    }),
  },
  {
    type: "Chart",
    label: "图表",
    category: "数据",
    description: "预置图表（柱/折/饼）：数据视图聚合带分组字段时按组绘图，无分组时展示单值",
    make: (id) => ({
      id,
      type: "Chart",
      binding: { source: "", view: { aggregate: { fn: "count" } } },
      props: { title: "图表", chartType: "bar" },
    }),
  },
  {
    type: "ContentList",
    label: "内容列表",
    category: "内容",
    description: "卡片式内容列表（封面/标题/摘要/日期），点击进详情页，适合文章资讯类前台",
    make: (id) => ({
      id,
      type: "ContentList",
      binding: { source: "" },
      props: { pageSize: 10 },
    }),
  },
  {
    type: "TextBlock",
    label: "文本",
    category: "内容",
    description: "纯文本段落或标题（level=title）",
    make: (id) => ({
      id,
      type: "TextBlock",
      props: { text: "文本内容" },
    }),
  },
  {
    type: "Image",
    label: "图片",
    category: "内容",
    description: "按 URL 展示图片，自适应容器宽度",
    make: (id) => ({ id, type: "Image", props: { src: "", alt: "" } }),
  },
  {
    type: "Button",
    label: "按钮",
    category: "动作",
    description: "动作按钮：点击后按 route 跳转页面",
    make: (id) => ({ id, type: "Button", props: { label: "按钮" } }),
  },
  {
    type: "AgentChat",
    label: "智能助手",
    category: "智能",
    description: "运行态智能助手入口：点击打开对话面板（查数据、办业务、制度问答）",
    make: (id) => ({
      id,
      type: "AgentChat",
      props: { title: "智能助手" },
    }),
  },
  {
    type: "SupportTranscript",
    label: "客服会话记录",
    category: "智能",
    description:
      "按当前记录的会话字段展示访客客服会话全文与转人工摘要，坐席可将问答沉淀为 FAQ 草稿",
    make: (id) => ({
      id,
      type: "SupportTranscript",
      binding: { source: "" },
      props: { title: "会话记录", conversationField: "conversation_id" },
    }),
  },
  {
    type: "CartView",
    label: "购物车",
    category: "数据",
    description:
      "本地购物车与结算（绑定商品实体）：按现价渲染、失效商品不计入，结算调会员 checkout 端点由服务端重算",
    make: (id) => ({
      id,
      type: "CartView",
      binding: { source: "" },
      props: { variant: "cart" },
    }),
  },
];
