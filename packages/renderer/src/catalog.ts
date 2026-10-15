import type { ComponentNode } from "@naka1205/schema";

/**
 * 组件目录：注册中心 v1 的物料清单（设计器物料面板的数据源）。
 * 与 createDefaultRegistry 的注册类型一一对应；make 生成可直接落进页面树的默认节点，
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
    type: "ChartPlaceholder",
    label: "图表",
    category: "数据",
    description: "图表占位：可先展示聚合数值，图表引擎后续里程碑接入",
    make: (id) => ({
      id,
      type: "ChartPlaceholder",
      props: { title: "图表" },
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
    description: "运行态智能助手面板（占位，后续里程碑接入对话能力）",
    make: (id) => ({
      id,
      type: "AgentChat",
      props: { title: "智能助手" },
    }),
  },
];
