import { Button, Typography } from "antd";

/**
 * 运行态异常状态页（404 / 502 / 503 / 通用加载失败）。
 *
 * 覆盖面（刻意收窄，不碰组件内局部报错）：
 * - 未知路由 → 404（运行壳 PublicShell / AppView 的“页面不存在”两处）；
 * - 应用或站点加载失败 → 按 HTTP 状态映射 502 / 503 / 通用页
 *   （AppView 快照加载、EntryView 站点解析两处整页失败分支）。
 * 组件内的数据加载失败（如列表拉取 502）仍走各自的局部提示，不整页替换。
 *
 * 文案口径：只说人话，不出现内部/架构语义；状态码本身是页面的身份，
 * 故以大号数字呈现，说明文字只讲现象与下一步。
 */
export type ErrorVariant = "404" | "502" | "503" | "generic";

export function statusToVariant(status?: number): ErrorVariant {
  if (status === 502) return "502";
  if (status === 503) return "503";
  if (status === 404) return "404";
  return "generic";
}

const COPY: Record<
  ErrorVariant,
  { code: string | null; title: string; desc: string }
> = {
  "404": {
    code: "404",
    title: "这个页面不存在",
    desc: "你访问的页面不存在，或者已经被移走了。请检查地址是否正确。",
  },
  "502": {
    code: "502",
    title: "服务暂时出了点问题",
    desc: "服务器现在无法正常响应，可能是正在维护，或者上游服务出了问题。稍后再试一次。",
  },
  "503": {
    code: "503",
    title: "服务暂时不可用",
    desc: "服务现在暂时不可用，可能是正在维护。稍后再试一次。",
  },
  generic: {
    code: null,
    title: "加载失败",
    desc: "页面数据加载失败，请稍后再试。",
  },
};

export function ErrorStatePage({
  variant,
  detail,
  onHome,
  onRetry,
  onBack,
  fullPage = false,
}: {
  variant: ErrorVariant;
  /** 仅通用页展示的原始信息（如“请求失败 (401)”），帮助定位；404/502/503 不展示。 */
  detail?: string | null;
  onHome: () => void;
  /** 重新加载（整页失败分支用）；404 页不传。 */
  onRetry?: () => void;
  /** 返回上一页（壳内 404 用）；不传则不渲染该按钮。 */
  onBack?: () => void;
  /** 整页失败分支用：全屏居中；壳内 404 不传。 */
  fullPage?: boolean;
}) {
  const c = COPY[variant];
  const body = (
    <div style={{ textAlign: "center", padding: "80px 24px" }}>
      {c.code ? (
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            lineHeight: 1.1,
            color: "#d0d5dd",
          }}
        >
          {c.code}
        </div>
      ) : null}
      <Typography.Title level={3} style={{ marginTop: c.code ? 8 : 0 }}>
        {c.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{c.desc}</Typography.Paragraph>
      {variant === "generic" && detail ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {detail}
        </Typography.Paragraph>
      ) : null}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {onRetry ? (
          <Button type="primary" onClick={onRetry}>
            重新加载
          </Button>
        ) : null}
        <Button type={onRetry ? "default" : "primary"} onClick={onHome}>
          返回首页
        </Button>
        {onBack ? <Button onClick={onBack}>返回上一页</Button> : null}
      </div>
    </div>
  );
  if (!fullPage) return body;
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {body}
    </div>
  );
}
