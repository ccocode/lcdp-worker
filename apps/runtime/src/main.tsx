import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>LCDP Runtime（运行态）</h1>
      <p>骨架已就绪。后续在此实现：已发布应用的 Schema 渲染、数据与流程操作，以及可拖入页面的 AgentChat 智能助手组件。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
