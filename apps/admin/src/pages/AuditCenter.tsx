import React, { useState } from "react";
import { Alert, Tabs } from "antd";
import Audit from "./Audit";
import Replay from "./Replay";

/**
 * 审计（第 57 步 E2 合并：审计日志 + 审计回放一页两页签；对象形态归正 W6
 * 起双 scope）：
 * - platform（平台区「审计中心」）：列表只取无应用归属的平台级事件
 *   （scope=platform）；回放（会话/提案/流程）须先选定一个应用才取数——
 *   明细行一律跟随应用，平台层不混显各应用明细；
 * - app（应用区「审计日志」）：列表与回放都固定本应用（按应用端点），
 *   运营者凭本应用运营资格可达。
 * 旧 /replay 深链经外壳别名落到本页并预选「回放」页签（initialTab）。
 */
export type AuditScope = "platform" | "app";

export default function AuditCenter({
  initialTab,
  scope,
  appId,
}: {
  /** 外壳别名种子：深链 /replay 时为 "replay"，普通进入为 null */
  initialTab?: string | null;
  scope: AuditScope;
  /** scope=app 时的当前应用 */
  appId?: string;
}) {
  const [tab, setTab] = useState<string>(initialTab === "replay" ? "replay" : "audit");
  return (
    <div>
      {scope === "platform" ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="仅平台级事件（无应用归属）；各应用的审计请进入该应用查看"
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="本应用审计"
          description="仅本应用的审计事件与回放明细；其他应用的明细请切换到该应用查看。"
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "audit",
            label: "审计日志",
            children: <Audit scope={scope} appId={appId} />,
          },
          {
            key: "replay",
            label: "审计回放",
            children: <Replay scope={scope} appId={appId} />,
          },
        ]}
      />
    </div>
  );
}
