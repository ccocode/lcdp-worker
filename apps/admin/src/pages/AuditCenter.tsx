import React, { useState } from "react";
import { Tabs } from "antd";
import Audit from "./Audit";
import Replay from "./Replay";

/**
 * 审计中心（第 57 步，E2 定案）：审计日志与审计回放合并为一页两页签。
 * 旧 /replay 深链经外壳别名落到本页并预选「回放」页签（initialTab）。
 * 两页本体自包含、无 props，合并只加宿主不改其行为。
 */
export default function AuditCenter({
  initialTab,
}: {
  /** 外壳别名种子：深链 /replay 时为 "replay"，普通进入为 null */
  initialTab?: string | null;
}) {
  const [tab, setTab] = useState<string>(initialTab === "replay" ? "replay" : "audit");
  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        { key: "audit", label: "审计日志", children: <Audit /> },
        { key: "replay", label: "审计回放", children: <Replay /> },
      ]}
    />
  );
}
