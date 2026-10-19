/**
 * 文章编辑页一次性意图（第 58 步）：与审计页 auditTabSeed 同构的种子手法——
 * 进入编辑页前由来源页（文章工作台 / 工作台快捷入口）写入，编辑页挂载时
 * 消费一次即清。无意图（刷新/深链直达）时编辑页按新建模式打开。
 */
export type ArticleEditorIntent =
  | { articleId: string }
  | { mode: "new" }
  | null;

let pending: ArticleEditorIntent = null;

export function setArticleEditorIntent(intent: ArticleEditorIntent): void {
  pending = intent;
}

export function consumeArticleEditorIntent(): ArticleEditorIntent {
  const v = pending;
  pending = null;
  return v;
}
