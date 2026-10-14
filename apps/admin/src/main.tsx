import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>LCDP Admin（平台管理台）</h1>
      <p>骨架已就绪。后续在此实现：租户与用户、模型网关双通道配置、配额熔断、审计查询、成本看板与初始化向导入口。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
