/**
 * 面向平台管理人员与运营人员的业务语义转换与文案净化器。
 * 彻底消除底层研发黑话（theme.json patterns、令牌、契约页、stalled 代号等），
 * 呈现清晰、优雅、业务导向的中文表述。
 */

/**
 * 步骤标题业务化净化
 */
export function humanizeStepLabel(label: string): string {
  if (!label) return "";
  let text = label;

  // 1. 替换首页设计与读取基底阶段的研发词汇
  text = text.replace(/读取目标应用主题契约摘要与内置主题基底/gi, "读取当前网站样式规范与基础配置");
  text = text.replace(/主题契约摘要/gi, "网站业务规范摘要");
  text = text.replace(/内置主题基底/gi, "默认网站风格基底");
  text = text.replace(/按(.*?)方向生成首页段主题（含\s*theme\.json\s*patterns、令牌与首页视图）/gi, "按$1风格设计首页（含视觉布局、品牌色板与首屏视图）");
  text = text.replace(/生成首页段主题备稿（.*?）/gi, "设计并生成首页主题方案（含页面版式与视觉调整）");
  text = text.replace(/生成首页段主题（.*?）/gi, "设计并生成首页视觉样式");
  text = text.replace(/生成其余页面（列表、详情及其余页键）主题/gi, "完善全站其余页面（包含文章列表页、详情页、关于与联系页及会员中心）");
  text = text.replace(/theme\.json\s*patterns/gi, "页面配色与布局");
  text = text.replace(/theme\.json/gi, "主题配置文件");
  text = text.replace(/patterns\s*声明/gi, "页面版式布局");
  text = text.replace(/patterns/gi, "页面布局");
  text = text.replace(/主题备稿/gi, "主题方案");
  text = text.replace(/备稿/gi, "设计草稿");
  text = text.replace(/首页段/gi, "首页");
  text = text.replace(/其余页键/gi, "其他页面");
  text = text.replace(/令牌与首页视图/gi, "品牌色板与首页效果");
  text = text.replace(/令牌/gi, "品牌配色");

  // 2. 替换其余页面补齐阶段的研发词汇
  text = text.replace(/增量补齐其余页面（列表、详情、\/account、\/account\/memories\s*等契约页）/gi, "完善全站其余页面（包含列表页、详情页、关于、联系及会员中心）");
  text = text.replace(/增量补齐其余页面（.*?契约页.*?）/gi, "完善全站其余页面样式");
  text = text.replace(/契约页/gi, "核心业务页面");
  text = text.replace(/契约摘要/gi, "业务规范摘要");
  text = text.replace(/契约/gi, "业务规范");

  // 3. 替换验收与生成阶段
  text = text.replace(/预览验收（桌面与移动）/gi, "全终端预览与最终验收（电脑端与手机端）");
  text = text.replace(/预览验收/gi, "效果预览与最终验收");
  text = text.replace(/克隆已创建/gi, "基础设计环境已就绪");
  text = text.replace(/改动层已出/gi, "主题样式定制已完成");
  text = text.replace(/预览确认已过/gi, "设计效果已验收确认");

  return text;
}

/**
 * 调度与运行事件日志业务化转换（去底层代码化）
 * 如果是纯系统内部调度噪音，返回 null（前端予以过滤）
 */
export function humanizeTimelineSummary(
  summary: string,
  opts?: { isLastAndRunning?: boolean },
): string | null {
  if (!summary) return null;
  const s = summary.trim();

  // 1. 首页门等待
  if (s.includes("run.home-gate-stalled")) {
    return "正在推进首页前置准备工作，稍后生成首页预览";
  }
  if (s === "run.awaiting-home" || s.startsWith("run.awaiting-home")) {
    return "首页效果已生成，等待确认风格";
  }
  if (s === "run.awaiting-preview" || s.startsWith("run.awaiting-preview")) {
    return "全站效果预览已就绪，等待最终验收";
  }
  if (s === "run.awaiting-bind" || s.startsWith("run.awaiting-bind")) {
    return "预览验收已通过，等待确认上线";
  }

  // 2. 状态机流转（去掉内部 run / 节点等开发词）
  if (s === "run 已开始" || s === "run.running" || s === "run.started") {
    return "开始执行设计步骤";
  }
  if (s === "run 已创建" || s.includes("run.created")) {
    return "设计任务已创建";
  }
  if (s in HUMAN_PAUSE_REASONS) {
    return HUMAN_PAUSE_REASONS[s]!;
  }
  if (s === "run 已暂停" || s.includes("run.paused") || s.includes("run.pause-reason")) {
    return "设计流程已暂停，等待处理";
  }
  if (s === "run 已完成" || s.includes("run.completed")) {
    return "设计任务全部完成";
  }
  if (s === "run 已恢复（进程重启后从数据库续跑）") {
    return "服务重连后自动恢复执行";
  }

  // 3. 备稿与产物日志业务化
  if (s.startsWith("主题备稿 ")) {
    return "已保存主题设计草稿";
  }
  if (s.includes("node.gateway-call")) {
    // 只有当它是最后一条且仍在执行中时展示“正在生成…”，历史轮次的生成过程用已完成替代或过滤
    return opts?.isLastAndRunning ? "AI 正在生成设计内容…" : null;
  }
  if (s.includes("node.repair-round")) {
    return opts?.isLastAndRunning ? "系统正在自动校准设计细节…" : null;
  }
  if (s.includes("node.validation-failed")) {
    return null;
  }
  if (s.includes("node.failed")) {
    return "当前步骤执行遇阻";
  }
  if (s.includes("node.completed") || s.includes("node.succeeded")) {
    return "本阶段设计已完成";
  }
  if (s.startsWith("节点开始执行")) {
    return "开始生成设计内容";
  }
  if (s.startsWith("节点完成")) {
    // 对“仅为 theme.json 补齐缺失的 patterns...”这类补丁细节进行净化收口
    if (s.includes("theme.json") || s.includes("patterns") || s.includes("--bt-")) {
      return "设计产物校验通过并已整理就绪";
    }
    const cleanBody = humanizeStepLabel(s.replace(/^节点完成[：:]\s*/, ""));
    return `阶段完成：${cleanBody}`;
  }
  if (s.startsWith("节点失败")) {
    return "本阶段生成遇阻，待处理";
  }

  // 3.5 验收与重开事件（去掉文件名、CSS 选择器与 domEvidence 等研发术语）
  if (s.startsWith("终审第")) {
    if (s.includes("通过") && !s.includes("未通过")) {
      return "设计效果验收已通过";
    }
    if (s.includes("未通过")) {
      const m = s.match(/终审第\s*(\d+)\s*轮/);
      return m ? `第 ${m[1]} 轮效果验收：发现待完善细节` : "效果验收：发现待完善细节";
    }
  }
  if (s.startsWith("节点被终审重开")) {
    const body = s.replace(/^节点被终审重开[：:]\s*/, "");
    return `效果验收反馈：${humanizeTechnicalDetail(body)}，正在自动优化`;
  }

  // 4. 过滤纯底层调度噪声
  if (
    s.startsWith("frontier.") ||
    s.startsWith("chain.") ||
    s.startsWith("writer.") ||
    s.startsWith("lock.")
  ) {
    return null;
  }

  // 5. 其他常规中文文案净化
  return humanizeStepLabel(s);
}

/**
 * 将内部节点 ID 转为运营/管理员可读的步骤名称
 */
export function humanizeNodeName(nodeId: string): string {
  const id = (nodeId || "").trim().toLowerCase();
  if (!id) return "主题设计步骤";
  if (id === "theme-generate-home" || id.includes("home")) return "首页视觉与布局设计";
  if (id === "theme-assemble-preview" || id.includes("assemble")) return "全站页面补齐与效果整合";
  if (id === "theme-design-blueprint" || id === "theme-design-package") return "整站主题方案设计";
  if (id.includes("audit") || id.includes("survey")) return "站点结构梳理";
  return "主题设计步骤";
}

/**
 * 将产物路径列表转为面向管理员的业务成果摘要（隐藏 .html/.css/.json 文件名）
 */
export function summarizeArtifactFiles(paths: readonly string[]): string {
  if (!paths || paths.length === 0) return "";
  const labels = new Set<string>();
  for (const raw of paths) {
    const p = (raw || "").toLowerCase();
    if (p.endsWith("index.html")) labels.add("首页");
    else if (p.endsWith("list.html") || p.endsWith("articles.html")) labels.add("文章列表页");
    else if (p.endsWith("detail.html") || p.endsWith("articles-detail.html")) labels.add("详情页");
    else if (p.endsWith("about.html")) labels.add("关于我们页");
    else if (p.endsWith("contact.html")) labels.add("联系留言页");
    else if (p.endsWith("account.html") || p.endsWith("account-memories.html")) labels.add("会员中心页");
    else if (p.endsWith(".css")) labels.add("视觉样式");
    else if (p.endsWith("preview-card.json") || p.endsWith("theme.json")) labels.add("主题配置与预览信息");
    else if (p.endsWith(".html")) labels.add("站点页面");
  }
  if (labels.size === 0) return `已准备 ${paths.length} 项设计资源`;
  return `已生成内容：${[...labels].join("、")}`;
}

/**
 * 过滤或转译研发级技术细节（CSS 选择器、文件路径、domEvidence、修复耗尽提示等）
 */
export function humanizeTechnicalDetail(raw: string): string {
  if (!raw) return "";
  const s = raw.trim();
  if (/吸顶导航|position:\s*sticky/i.test(s)) {
    return "首页顶部导航需要固定吸顶效果";
  }
  if (/domEvidence.*hero|hero.*DOM|h1 文本/i.test(s)) {
    return "首页主视觉标题区待完善";
  }
  if (/未锁定色值|色板/.test(s)) {
    return "部分配色与首页已定色板不完全一致";
  }
  if (/undefined in package CSS|引用的样式表/i.test(s)) {
    return "部分页面样式规则待补充完善";
  }
  if (/repair 耗尽|提交校验未过/.test(s)) {
    return "页面结构或样式自动校验多次未通过，需人工介入确认";
  }
  // 剔除文件路径、CSS 类选择器和代码属性
  let cleaned = s
    .replace(/首页门连续\s*\d+\s*轮挡住全部可派节点[：:][^）)]*/g, "正在等待首页风格确认，后续页面暂未继续")
    .replace(/首页门/g, "首页确认步骤")
    .replace(/首页确认关口/g, "首页风格确认")
    .replace(/首页文件已落库但门未放行/g, "首页样式尚未确认放行")
    .replace(/\btheme-generate-home\b/gi, "首页视觉与布局设计")
    .replace(/\btheme-assemble-preview\b/gi, "全站页面补齐与效果整合")
    .replace(/\btheme-design-(?:blueprint|package)\b/gi, "整站主题方案设计")
    .replace(/\btheme-[a-z0-9-]+\b/gi, "主题设计步骤")
    .replace(/[A-Za-z0-9_./-]+\.(css|html|json|js|mjs|ts|tsx)/gi, "相关页面")
    .replace(/(^|\s)\.[A-Za-z_-][A-Za-z0-9_-]*/g, "$1界面元素")
    .replace(/position:\s*[a-z-]+/gi, "固定位置样式")
    .replace(/--[a-z0-9-]+/gi, "品牌配色变量")
    .replace(/domEvidence/gi, "页面结构检查")
    .replace(/layoutChanges/gi, "版式调整说明")
    .replace(/\s+/g, " ")
    .trim();
  return humanizeStepLabel(cleaned);
}

/**
 * 暂停原因业务化翻译
 */
export const HUMAN_PAUSE_REASONS: Record<string, string> = {
  "budget-exhausted": "单次生成次数达到上限",
  "script-failure": "设计步骤执行遇阻",
  "consecutive-failures": "多次尝试未成功",
  "preview-card-incomplete": "预览效果未就绪",
  "planner-exhausted": "规划流程已就绪",
  "home-gate-stalled": "等待首页风格确认",
  "already-paused": "任务已暂停",
};

const TOOL_DISPLAY_LABELS: Record<string, string> = {
  plan_update: "整理执行计划",
  app_theme_contract: "了解站点功能规范",
  app_theme_files: "读取基础样式参考",
  theme_files: "读取参考样式",
  app_theme_catalog: "查看可用风格与板块库",
  theme_design_catalog: "读取应用风格与板块目录",
  theme_design_apply: "设计并保存主题方案",
  theme_design_patch: "微调主题视觉细节",
  theme_image_fetch: "准备配图素材",
  theme_list: "查看已有主题库",
  theme_create: "生成主题方案",
  theme_clone: "定制主题方案",
  theme_bind: "生成主题启用建议",
  app_theme_image: "准备配图素材",
  app_site: "查看站点设置",
  platform_apps: "查看应用清单",
  app_entities: "了解业务对象结构",
  app_query: "查询业务数据",
  app_get: "查看单条记录",
  app_aggregate: "汇总业务数据",
  app_flow_tasks: "查看待办流程",
  app_static_rebuild: "更新静态页面",
};

export function humanizeToolName(toolName: string): string {
  const key = (toolName || "").trim();
  if (!key) return "业务操作";
  if (TOOL_DISPLAY_LABELS[key]) return TOOL_DISPLAY_LABELS[key];
  if (key.startsWith("query_")) return "查询业务列表";
  if (key.startsWith("get_")) return "查看业务详情";
  if (key.startsWith("create_")) return "准备新建单据";
  if (key.startsWith("update_")) return "准备更新单据";
  if (key.startsWith("app_")) return "读取应用信息";
  return "处理业务请求";
}

export function humanizeToolSummary(toolName: string, rawSummary: string): string {
  const s = (rawSummary || "").trim();
  if (!s) return "";
  if (toolName === "plan_update") {
    if (/"action"\s*:\s*"create"/.test(s)) return "建立执行计划";
    if (/"action"\s*:\s*"advance"/.test(s)) return "推进当前步骤";
    return "更新执行计划";
  }
  if (toolName === "app_theme_contract") return "核对页面功能与交互入口规范";
  if (toolName === "theme_list") return "检索已有主题方案";
  if (toolName === "app_theme_files" || toolName === "theme_files") return "参考基础样式结构";
  if (toolName === "theme_create" || toolName === "theme_clone") return "保存新设计方案并准备预览";
  if (toolName === "app_theme_catalog" || toolName === "theme_design_catalog") return "读取可用视觉预设与页面模块目录";
  if (toolName === "theme_design_apply") return "拼装主题视觉方案并生成预览";
  if (toolName === "theme_design_patch") return "局部微调方案并刷新预览";
  if (toolName === "app_theme_image" || toolName === "theme_image_fetch") return "获取氛围配图资源";
  if (toolName === "app_site") return "确认当前站点启用状态";
  if (/^\{/.test(s)) return "处理参数准备中";
  return humanizeOpsCopy(s);
}

export function humanizeTaskTitle(title: string): string {
  const s = (title || "").trim();
  if (!s) return "主题设计任务";
  // 屏蔽 `主题任务 · zakka-market-warm` 类英文 slug 暴露
  if (/^主题任务\s*[·:]\s*[a-z0-9-]+$/i.test(s)) {
    return "主题视觉设计任务";
  }
  return humanizeOpsCopy(s);
}

/**
 * 面向运营/业务管理员的对话与任务卡片全量文案净化器：
 * 确保即便历史消息、底层自检附注或模型偶发回显包含研发词汇，前端展示层也一律转译为自然业务语言。
 */
export function humanizeOpsCopy(raw: string): string {
  if (!raw) return "";
  let text = raw;
  // 1. 消除内部实现模式注释
  text = text
    .replace(/[（(]\s*克隆内置主题做改动层改造\s*[）)]/g, "")
    .replace(/[，,]?\s*走克隆改动层路径/g, "")
    .replace(/[（(]app_theme_contract[、,，\s]*theme_list[、,，\s]*app_theme_files[）)]/gi, "")
    .replace(/读取主题契约摘要与内置基底[（(][^）)]*[）)]?/g, "了解当前站点功能规范与参考样式");

  // 2. 转化底层自检与自动返工回执文案
  text = text
    .replace(
      /已生成主题「[a-z0-9-]+」版本\s*(\S+?)[（(]\d+\s*个文件[^）)]*[）)]/gi,
      "已为您生成新版主题方案（v$1）",
    )
    .replace(/自检结果（平台在落库后自动执行，([^）)]+)）：?/g, "方案质量检查结果（$1）：")
    .replace(/自检未过，自动返工第\s*(\d+)\s*次[：:]\s*/g, "系统正在自动微调优化（第 $1 次）：")
    .replace(/静态检[：:]/g, "基础结构检查：")
    .replace(/渲染检[：:]/g, "页面展示检查：")
    .replace(/链路检[：:]/g, "功能衔接检查：")
    .replace(/视觉检[：:]/g, "视觉观感检查：")
    .replace(/包文件齐[（(][^）)]+[）)]/g, "基础页面配置完整")
    .replace(/包文件齐/g, "基础页面配置完整")
    .replace(/routes\s*与契约桥接表对账/gi, "站点页面与功能入口衔接核对")
    .replace(/必备按钮\/入口片段指纹齐全/g, "核心功能按钮与会员入口齐全")
    .replace(/详情链接\s*\?id=\s*口径/g, "详情页访问链接格式")
    .replace(/视图逻辑与数据接线在位/g, "页面数据展示就绪");

  // 3. 转译内部流程词、工具名、文件名与代码缩写
  text = text
    .replace(/契约已读全/g, "已确认站点功能规范")
    .replace(/主题契约摘要|契约摘要|功能契约|主题契约/g, "站点功能规范")
    .replace(/首页段主题备稿/g, "首页视觉设计方案")
    .replace(/主题备稿/g, "主题设计草稿")
    .replace(/首页段/g, "首页设计")
    .replace(/其余页面/g, "其他内页")
    .replace(/改动层/g, "定制样式调整")
    .replace(/内置基底|基底已读回/g, "基础样式参考")
    .replace(/片段指纹|片段标记/g, "功能入口标记")
    .replace(/member_center_nav/gi, "会员中心导航入口")
    .replace(/member_api/gi, "会员登录与服务能力")
    .replace(/cart_add/gi, "加入购物车交互")
    .replace(/detail_link/gi, "详情页链接")
    .replace(/app_theme_contract/gi, "站点规范核对")
    .replace(/app_theme_files/gi, "参考样式读取")
    .replace(/app_theme_catalog|theme_design_catalog/gi, "风格与板块目录读取")
    .replace(/theme_design_apply/gi, "主题视觉方案生成")
    .replace(/theme_design_patch/gi, "主题视觉局部微调")
    .replace(/theme_image_fetch/gi, "氛围配图获取")
    .replace(/\bdesignSpec\b|\bvisualPreset\b/gi, "视觉设计方案")
    .replace(/theme_create/gi, "主题方案保存")
    .replace(/theme_clone/gi, "主题方案定制")
    .replace(/theme_list/gi, "现有主题清单")
    .replace(/plan_update/gi, "执行计划更新")
    .replace(/preview-card\.json/gi, "预览展示信息")
    .replace(/theme\.json/gi, "主题配置文件")
    .replace(/index\.html/gi, "首页页面")
    .replace(/内联\s*SVG\s*(主视觉)?/gi, "定制矢量插画$1")
    .replace(/\bSVG\b/gi, "定制矢量图形")
    .replace(/纯\s*CSS\s*(纹理)?/gi, "视觉样式$1")
    .replace(/\bCSS\b/gi, "视觉样式")
    .replace(/\bHTML\b/gi, "页面结构")
    .replace(/\bJSON\b/gi, "方案数据")
    .replace(/\bDOM\b/gi, "页面内容")
    .replace(/\bconsecutive-failures\b/gi, "多次尝试未成功")
    .replace(/首页门连续\s*\d+\s*轮挡住全部可派节点[：:][^）)]*/g, "正在等待首页风格确认，后续页面暂未继续")
    .replace(/首页门/g, "首页确认步骤")
    .replace(/首页确认关口/g, "首页风格确认")
    .replace(/首页文件已落库但门未放行/g, "首页样式尚未确认放行")
    .replace(/\btheme-generate-home\b/gi, "首页视觉与布局设计")
    .replace(/\btheme-assemble-preview\b/gi, "全站页面补齐与效果整合")
    .replace(/\btheme-design-(?:blueprint|package)\b/gi, "整站主题方案设计")
    .replace(/\btheme-[a-z0-9-]+\b/gi, "主题设计步骤")
    .replace(/执行图全部节点已终态且终审已通过。?/g, "全部设计步骤已完成并通过验收。")
    .replace(/\broutes\b/gi, "页面路由")
    .replace(/（[0-9]+\s*个文件）/g, "");

  // 4. 复用步骤标签净化规则
  text = humanizeStepLabel(text);
  return text.replace(/[ \t]{2,}/g, " ").trim();
}
