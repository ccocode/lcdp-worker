import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { desktopTheme } from "@lcdp/ui";
import App from "./App";

/**
 * B 端视觉基线令牌单一事实源在 @lcdp/ui（第 73 步片一收口；值沿第 49 步基线：
 * 主色 #1677ff、圆角 6/8、边框 #e4e7ec、页底 #f5f6f8、文字三级、菜单选中底
 * #e8f1ff、表头 #f8f9fb）。各业务页内部版式不逐页迁移，靠主题令牌统一承接。
 */
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={desktopTheme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
