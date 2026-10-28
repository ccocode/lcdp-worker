import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Modal, Segmented } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MinusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import ChatPane, {
  type AssistantPageContext,
} from "./assistant/ChatPane";
import AssistantWorkbench from "./assistant/AssistantWorkbench";
import { hasRunningAssistantTask } from "./assistant/assistantRunning";
import { api } from "../api";

export type { AssistantPageContext };

/**
 * 管理台助手弹窗（第 103 步步骤 6）：外壳层唯一助手入口的壳，挂在
 * AppShell 内、路由视图之外——页内跳转不卸载、不重置；弹窗状态只
 * 属于外壳，不属于任何一页。内容复用既有组件，不重写对话核：
 * 应用上下文 = 助手工作台三栏（左会话 + 任务 / 中对话 / 右任务详情
 * + 记忆速览）；平台上下文 = 对话面（抽屉口径，平台侧无任务列表
 * 接口，运行中提示只覆盖应用侧）。
 * 形态（设计稿 §4.5）：可最小化（缩成右下角小条，任务在跑时显
 * 进行中状态）；左、右两侧均可收起、只留对话，右侧默认收起，左
 * 侧默认展开；收起与最小化只记本会话（刷新即回默认，不持久化）；
 * 窄屏（<900px）下左右栏叠成可切换面板，不挤对话。
 * 关闭语义：关闭即复位新对话代次（抽屉口径延续）；刷新默认关闭
 * （状态不持久化）；关闭 / 切换应用 / 刷新时若有任务在跑先提示，
 * 文案只讲后果，不讲机制。关闭与切换取实时任务值，刷新取最近
 * 一次轮询值（30 秒内）。
 * 迁移：原 AssistantDrawer 抽屉壳已随工作台改版删除，本文件为顶栏唯一入口。
 */
export default function AssistantModal({
  open,
  onClose,
  appId,
  appName,
  context,
  focusTask,
}: {
  open: boolean;
  onClose: () => void;
  appId: string | null;
  appName: string | null;
  context?: AssistantPageContext;
  /** 页内入口带来的任务定位信号（透传工作台选中对应任务卡） */
  focusTask?: { taskId: string; nonce: number } | null;
}) {
  /** 新对话代次（仅平台对话面用；应用侧工作台自带新对话控制） */
  const [seed, setSeed] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  /** 右侧默认收起（设计稿 §4.5 第 6 条） */
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [narrowTab, setNarrowTab] = useState<"left" | "chat" | "right">(
    "chat",
  );
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  /** 拖拽偏移（标题栏拖动；所装 antd 无 Modal 拖拽属性，手动实现） */
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  /** 标题栏按下即开始拖动（点中按钮则不拖，保证按钮点击正常） */
  const onTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: dragOffset.x,
        baseY: dragOffset.y,
      };
      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        setDragOffset({
          x: d.baseX + ev.clientX - d.startX,
          y: d.baseY + ev.clientY - d.startY,
        });
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [dragOffset],
  );
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 900,
  );

  const setRunningBoth = useCallback((v: boolean) => {
    runningRef.current = v;
    setRunning(v);
  }, []);

  const refreshRunning = useCallback(async () => {
    if (!appId) return false;
    try {
      const list = await api.assistant.app.tasks(appId, {
        status: "active",
      });
      const v = hasRunningAssistantTask(list);
      setRunningBoth(v);
      return v;
    } catch {
      return false;
    }
  }, [appId, setRunningBoth]);

  // 轮询任务在跑状态（供刷新提示用；关闭与切换另取实时值）
  useEffect(() => {
    if (!open || !appId) {
      setRunningBoth(false);
      return;
    }
    void refreshRunning();
    const timer = window.setInterval(() => {
      void refreshRunning();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [open, appId, refreshRunning, setRunningBoth]);

  // 窄屏断点跟随
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 刷新提示：浏览器原生离页确认（文案由浏览器定，无法自定义）
  useEffect(() => {
    if (!open || minimized) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!runningRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, minimized]);

  const doClose = useCallback(() => {
    setSeed(0);
    setMinimized(false);
    onClose();
  }, [onClose]);

  // 受 guard 的关闭：X / 遮罩 / Esc / 对话面关闭均走这里；应用侧
  // 任务在跑时先弹确认，确认后才关；平台侧无任务面，直接关。
  const requestClose = useCallback(async () => {
    if (!appId) {
      doClose();
      return;
    }
    const isRunning = await refreshRunning();
    if (!isRunning) {
      doClose();
      return;
    }
    Modal.confirm({
      title: "助手正在执行任务",
      content: "关闭后任务留在任务卡、可续跑，是否关闭？",
      okText: "关闭",
      cancelText: "取消",
      onOk: () => doClose(),
    });
  }, [appId, doClose, refreshRunning]);

  /** 标题不带应用名（用户修订）：只留助手身份 */
  const title = appId ? "运营助手" : "平台助手";

  if (!open) return null;

  // 最小化：只留右下角小条（任务在跑时显进行中状态），点按恢复
  if (minimized) {
    return (
      <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 1060 }}>
        <Badge dot={running} color={running ? "green" : undefined}>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => setMinimized(false)}
          >
            助手{running ? " · 进行中" : ""}
          </Button>
        </Badge>
      </div>
    );
  }

  // 操作按钮放标题栏右上角（用户修订：不独占一行高度）。
  // 关闭 X 的几何：宽 32px、距右缘约 12px，即占右缘 12–44px；
  // 标题内边距 24px，故按钮组右留 56px（距弹窗右缘 80px），
  // 与 X 之间留 36px 间隙，不再重叠。
  const titleNode = (
    <div
      onMouseDown={onTitleMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        cursor: "grab",
        paddingRight: 56,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {title}
      </span>
      {running && (
        <Badge status="processing" text="任务进行中" />
      )}
      <span style={{ flex: 1 }} />
      <span
        style={{ display: "flex", gap: 8, flexShrink: 0 }}
        // 按钮组内的按下不触发标题拖拽
        onMouseDown={(e) => e.stopPropagation()}
      >
        {appId && !narrow && (
          <>
            <Button
              size="small"
              icon={
                leftCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
              }
              title={leftCollapsed ? "展开会话栏" : "收起会话栏"}
              onClick={() => setLeftCollapsed((v) => !v)}
            >
              会话
            </Button>
            <Button
              size="small"
              icon={
                rightCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
              }
              title={rightCollapsed ? "展开详情栏" : "收起详情栏"}
              onClick={() => setRightCollapsed((v) => !v)}
            >
              详情
            </Button>
          </>
        )}
        {!appId && (
          <Button size="small" onClick={() => setSeed((s) => s + 1)}>
            新对话
          </Button>
        )}
        <Button
          size="small"
          icon={<MinusOutlined />}
          title="最小化"
          onClick={() => setMinimized(true)}
        />
      </span>
    </div>
  );

  /**
   * 对话内容宽度固定（用户修订）：弹窗宽度跟随可见面板变化——
   * 对话固定 720px，左栏 264px、右栏 300px，收起即减去对应宽度；
   * 窄屏时宽度跟随当前面板；平台面无面板即 720px。
   * 另加 antd Modal 内容横向内边距 48px（左右各 24）：不加时
   * 工作台实际可用宽少 48，中栏只剩 672，注释的 720 不成立
   * （2026-10-29 宽度复现定案）。
   */
  const CHAT_WIDTH = 720;
  const LEFT_WIDTH = 264;
  const RIGHT_WIDTH = 300;
  const MODAL_CONTENT_PADDING_X = 48;
  const modalWidth =
    (!appId
      ? CHAT_WIDTH
      : narrow
        ? narrowTab === "chat"
          ? CHAT_WIDTH
          : narrowTab === "left"
            ? LEFT_WIDTH
            : RIGHT_WIDTH
        : CHAT_WIDTH +
          (leftCollapsed ? 0 : LEFT_WIDTH) +
          (rightCollapsed ? 0 : RIGHT_WIDTH)) + MODAL_CONTENT_PADDING_X;

  return (
    <Modal
      title={titleNode}
      open
      onCancel={() => void requestClose()}
      footer={null}
      width={`min(${modalWidth}px, 96vw)`}
      // 默认靠右侧停靠（用户修订）：不居中，距右缘 24px、距顶 24px；
      // 拖拽仍以停靠位置为基准平移。antd v5 已无 top 属性，top 须
      // 写进 style 才能覆盖默认的 top: 100px。
      style={{
        top: 24,
        marginLeft: "auto",
        marginRight: 24,
        transform:
          dragOffset.x !== 0 || dragOffset.y !== 0
            ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
            : undefined,
        transition: "width 0.2s ease",
      }}
      // 无遮罩 + wrap 层点击穿透：弹窗打开时页面仍可操作，切应用
      // 与页内跳转才能发生。只去遮罩不够——rc-dialog 的 wrap 层整屏
      // 覆盖且默认 maskClosable 会把 wrap 层点击转为关闭（线上实测
      // 两度证实：点切换器弹出的总是关闭确认框），故 wrap 层设
      // pointerEvents none、对话框本体恢复 auto，并关掉遮罩点击关闭。
      mask={false}
      maskClosable={false}
      styles={{
        wrapper: { pointerEvents: "none" },
        content: { pointerEvents: "auto" },
        body: {
          height: "min(70vh, 720px)",
          padding: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* 窄屏时标题栏不放按钮，面板切换仍用体内这一行 */}
      {appId && narrow && (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Segmented
            value={narrowTab}
            onChange={(v) => setNarrowTab(v as "left" | "chat" | "right")}
            options={[
              { label: "会话", value: "left" },
              { label: "对话", value: "chat" },
              { label: "详情", value: "right" },
            ]}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {appId ? (
          <AssistantWorkbench
            key={appId}
            appId={appId}
            appName={appName}
            focusTask={focusTask}
            leftCollapsed={leftCollapsed}
            rightCollapsed={rightCollapsed}
            activePane={narrow ? narrowTab : null}
            onExpandRight={() => {
              setRightCollapsed(false);
              setNarrowTab("right");
            }}
            style={{ height: "100%", border: "none", borderRadius: 0 }}
          />
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <ChatPane
              key={`platform:${seed}`}
              appId={null}
              fresh={seed > 0}
              pageContext={context}
              onClose={doClose}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
