import { Alert, Form, Input, InputNumber, Select, Switch, Typography } from "antd";
import type { AgentsConfig } from "./api.js";

/** 面孔键的职能称呼（运行面调整提示用，与管理台同名） */
const FACE_LABELS: Record<string, string> = {
  staff: "员工助手",
  visitor: "访客客服",
  ops: "运营助手",
};

/** 调整时间呈现：ISO → 「年-月-日 时:分」 */
function fmtPresentTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

/**
 * 智能体页签（M7）：AgentSchema 基础版编辑器——运行态助手的名称、人设、
 * 四类工具开关与回合上限。受控组件：编辑经 onChange 回写设计包草稿，
 * 保存草稿/发布与其他段完全一致（App.tsx 的 updateBundle 通道）。
 * writePolicy 本期唯一值 confirm（写操作需确认），以禁用下拉呈现口径。
 */
export default function AgentsTab({
  agents,
  onChange,
}: {
  /** 已归一化的完整配置（缺段时由 App 侧补默认值后传入） */
  agents: AgentsConfig;
  onChange: (next: AgentsConfig) => void;
}) {
  const a = agents.assistant;
  const patch = (p: Partial<AgentsConfig["assistant"]>) =>
    onChange({ assistant: { ...a, ...p } });
  const patchTool = (key: keyof AgentsConfig["assistant"]["tools"], v: boolean) =>
    onChange({ assistant: { ...a, tools: { ...a.tools, [key]: v } } });

  const toolRows: {
    key: keyof AgentsConfig["assistant"]["tools"];
    label: string;
    desc: string;
  }[] = [
    { key: "query", label: "数据查询", desc: "按当前用户权限查询与查看业务数据" },
    { key: "create", label: "业务办理", desc: "新建/更新记录类写提案——执行前必经确认卡片，建单类默认回填表单待人工提交" },
    { key: "flow", label: "流程待办", desc: "发起流程、审批、催办与进度查询（写动作同样需确认）" },
    { key: "kb", label: "制度问答", desc: "检索知识库回答制度问题，并给出文档引用" },
  ];

  const present = agents.overridesPresent;
  const presentParts =
    present && Object.keys(present).length > 0
      ? Object.entries(present).map(
          ([face, at]) =>
            `${FACE_LABELS[face] ?? face}，${fmtPresentTime(at)}`,
        )
      : [];

  return (
    <div style={{ padding: 20, maxWidth: 760 }}>
      {presentParts.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`本应用存在管理台运行面调整（${presentParts.join("；")}），发布不会清除`}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        配置运行态右下角「✦ 助手」的行为。助手能用的工具先按使用者角色与权限自动限定
        （无权限的实体工具不会出现）；下面的工具开关在此基础上进一步收窄，关掉的整类工具不会提供给助手。助手始终以提问者本人的身份与权限执行。
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="助手名称">
          <Input
            value={a.name}
            maxLength={40}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="应用助理"
          />
        </Form.Item>
        <Form.Item label="人设（补充系统提示，描述语气、职责边界等）">
          <Input.TextArea
            value={a.persona}
            rows={4}
            maxLength={2000}
            onChange={(e) => patch({ persona: e.target.value })}
            placeholder="如：你是采购部门的智能助理，回答简洁，先给结论再给依据；不确定的数据先查询再回答。"
          />
        </Form.Item>
        <Form.Item label="工具开关">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {toolRows.map((t) => (
              <div
                key={t.key}
                style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
              >
                <Switch
                  checked={a.tools[t.key]}
                  onChange={(v) => patchTool(t.key, v)}
                />
                <div>
                  <div>{t.label}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t.desc}
                  </Typography.Text>
                </div>
              </div>
            ))}
          </div>
        </Form.Item>
        <Form.Item label="单回合工具循环上限（maxTurns，1–12）">
          <InputNumber
            min={1}
            max={12}
            value={a.maxTurns}
            onChange={(v) => patch({ maxTurns: v ?? 6 })}
          />
        </Form.Item>
        <Form.Item label="写操作策略">
          <Select
            value={a.writePolicy}
            disabled
            options={[{ value: "confirm", label: "写操作需确认（确认卡片）" }]}
            style={{ width: 280 }}
          />
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 6 }}
          >
            助手提出的任何写操作都会先出确认卡片，用户确认后才执行；删除类操作不提供。
          </Typography.Paragraph>
        </Form.Item>
      </Form>
    </div>
  );
}
