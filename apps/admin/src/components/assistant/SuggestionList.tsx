import { Button, List, Typography } from "antd";
import type { AdminAssistantSuggestion } from "../../api";

/**
 * 主动建议条目列（第 95 步线 B）：助手工作台（应用面）与平台工作台
 * （平台面）共用同一行呈现——服务端模板文案 title + evidence 小字，
 * 右侧处置三按钮（去办/延后/忽略）。fingerprint 与 rule 只作寻址与
 * 分流、绝不渲染（红线）。回写、移除与深链导航全部由父页处理，
 * 本组件只负责呈现与回调。
 */
export default function SuggestionList({
  items,
  busyFingerprint,
  onGo,
  onDispose,
}: {
  items: AdminAssistantSuggestion[];
  /** 正在回写处置的条目指纹（该条按钮禁用防重复提交） */
  busyFingerprint?: string | null;
  onGo: (item: AdminAssistantSuggestion) => void;
  onDispose: (
    item: AdminAssistantSuggestion,
    disposition: "dismissed" | "snoozed",
  ) => void;
}) {
  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => {
        const busy = busyFingerprint === item.fingerprint;
        return (
          <List.Item
            actions={[
              <Button
                key="go"
                size="small"
                type="primary"
                disabled={busy}
                onClick={() => onGo(item)}
              >
                去办
              </Button>,
              <Button
                key="snooze"
                size="small"
                disabled={busy}
                onClick={() => onDispose(item, "snoozed")}
              >
                延后
              </Button>,
              <Button
                key="dismiss"
                size="small"
                disabled={busy}
                onClick={() => onDispose(item, "dismissed")}
              >
                忽略
              </Button>,
            ]}
          >
            <div style={{ minWidth: 0 }}>
              <Typography.Text>{item.title}</Typography.Text>
              {item.evidence ? (
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", fontSize: 12 }}
                >
                  {item.evidence}
                </Typography.Text>
              ) : null}
            </div>
          </List.Item>
        );
      }}
    />
  );
}
