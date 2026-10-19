import React from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";

/**
 * B 端视觉基线令牌（第 49 步，包三令牌草案落地）：
 * 主色 #1677ff、控件圆角 6 / 卡片圆角 8、边框 #e4e7ec、页底 #f5f6f8、文字三级；
 * 菜单选中底 #e8f1ff、分组标题 #8a94a6；表格头 #f8f9fb。
 * 各业务页内部版式不逐页迁移，靠主题令牌统一承接。
 */
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
          borderRadiusLG: 8,
          colorBorder: "#e4e7ec",
          colorBgLayout: "#f5f6f8",
          colorText: "#1f2328",
          colorTextSecondary: "#5f6b7a",
          colorTextTertiary: "#8a94a6",
        },
        components: {
          Menu: {
            itemBorderRadius: 6,
            itemSelectedBg: "#e8f1ff",
            itemSelectedColor: "#1677ff",
            groupTitleColor: "#8a94a6",
            groupTitleFontSize: 12,
          },
          Layout: { siderBg: "#ffffff", headerBg: "#ffffff" },
          Table: { headerBg: "#f8f9fb", rowHoverBg: "#f5f8ff" },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
