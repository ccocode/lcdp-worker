import { useState } from "react";
import { Button, Drawer, Popover, Typography } from "antd";
import { tokens } from "./tokens.js";

/**
 * 页面帮助（第 82 步，文案治理呈现层）：「?」图标 + 点击气泡收纳本页说明。
 * 页面正文只承载数据、状态与动作；机制、口径、范围类说明（原常驻正文的
 * B 类文案与 A 类保留部分）一律登记在消费方的帮助登记表、经本组件呈现。
 * 纯呈现组件：文案由消费方以 sections 传入，本包不含业务文案。
 * 全文较长（>300 字）时气泡内分段滚动呈现，底部「展开全文」打开抽屉作
 * 溢出通道；触发以点击为准（触屏可用），悬停不触发。
 */

export interface PageHelpSection {
  heading?: string;
  body: string[];
}

export interface PageHelpEntry {
  title: string;
  sections: PageHelpSection[];
}

function Sections({ entry }: { entry: PageHelpEntry }) {
  return (
    <div>
      {entry.sections.map((s, i) => (
        <div key={i} style={{ marginTop: i === 0 ? 0 : 12 }}>
          {s.heading ? (
            <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
              {s.heading}
            </Typography.Text>
          ) : null}
          {s.body.map((p, j) => (
            <Typography.Paragraph
              key={j}
              style={{ marginBottom: j === s.body.length - 1 ? 0 : 6 }}
            >
              {p}
            </Typography.Paragraph>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageHelp({ entry }: { entry: PageHelpEntry }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const totalChars = entry.sections.reduce(
    (n, s) => n + s.body.reduce((m, p) => m + p.length, 0),
    0,
  );
  const long = totalChars > 300;

  const content = (
    <div style={{ width: 380, maxWidth: "78vw" }}>
      <div style={{ maxHeight: "46vh", overflowY: "auto" }}>
        <Sections entry={entry} />
      </div>
      {long ? (
        <div style={{ textAlign: "right", marginTop: 8 }}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => {
              setOpen(false);
              setExpanded(true);
            }}
          >
            展开全文
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <Popover
        trigger="click"
        placement="bottomLeft"
        title={entry.title}
        content={content}
        open={open}
        onOpenChange={setOpen}
      >
        <Button
          type="text"
          size="small"
          aria-label="本页说明"
          style={{ padding: "0 2px" }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 17,
              height: 17,
              borderRadius: "50%",
              border: `1px solid ${tokens.colorBorder}`,
              color: tokens.colorTextSecondary,
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            ?
          </span>
        </Button>
      </Popover>
      <Drawer
        title={entry.title}
        open={expanded}
        onClose={() => setExpanded(false)}
        width={480}
      >
        <Sections entry={entry} />
      </Drawer>
    </>
  );
}
