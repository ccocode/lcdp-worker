import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import App from "./App.js";
import { installBridge } from "./bridge.js";

// 设备桥（M13 线 C）：先于应用渲染安装 window.lcdpBridge——壳环境判定
// （App 的 isShellEnv）在挂载期读该全局，且能力消费方只经此入口调用设备。
installBridge();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
