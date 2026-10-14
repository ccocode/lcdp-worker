import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>LCDP Studio（设计态）</h1>
      <p>骨架已就绪。后续在此实现：应用/模型/页面/流程/权限设计器，以及设计态 Agent 的对话入口与 Diff 确认。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
