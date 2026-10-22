import {
  Alert,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { AgentsConfig, StaffAgentDecl, SupportAgentDecl } from "./api.js";
import { newStaffDecl, newVisitorDecl } from "./api.js";

/** 面孔键的职能称呼（运行面调整提示用，与管理台同名） */
const FACE_LABELS: Record<string, string> = {
  staff: "员工助手",
  visitor: "访客客服",
  ops: "运营助手",
};

/** 内置工具（结构面）中文名，与平台枚举一致 */
const BUILTIN_TOOL_LABELS: Record<string, string> = {
  kbSearch: "知识库检索",
  humanHandoff: "转人工",
  navigate: "页面导航",
  fillForm: "表单回填",
};

/** 派生工具域中文名，与平台枚举一致 */
const TOOL_SCOPE_LABELS: Record<string, string> = {
  entityQuery: "实体查询",
  entityWrite: "实体写入",
  workflow: "流程",
  connector: "连接器",
};

/** 调整时间呈现：ISO → 「年-月-日 时:分」 */
function fmtPresentTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

const staffToolRows: {
  key: keyof StaffAgentDecl["tools"];
  label: string;
  desc: string;
}[] = [
  { key: "query", label: "数据查询", desc: "按当前用户权限查询与查看业务数据" },
  { key: "create", label: "业务办理", desc: "新建/更新记录类写提案——执行前必经确认卡片，建单类默认回填表单待人工提交" },
  { key: "flow", label: "流程待办", desc: "发起流程、审批、催办与进度查询（写动作同样需确认）" },
  { key: "kb", label: "制度问答", desc: "检索知识库回答制度问题，并给出文档引用" },
];

/** 访客客服可编辑的内置工具（转人工单列锁定，不在此表内） */
const visitorToolRows: { key: string; label: string; desc: string }[] = [
  { key: "kbSearch", label: "知识库检索", desc: "基于知识范围内的知识库回答访客咨询" },
  { key: "navigate", label: "页面导航", desc: "引导访客前往站内页面（声明保留项）" },
  { key: "fillForm", label: "表单回填", desc: "把咨询要点回填到表单待访客提交（声明保留项）" },
];

function DeclaredSwitch({
  declared,
  onChange,
}: {
  declared: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Space size={8}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        在本应用声明
      </Typography.Text>
      <Switch checked={declared} onChange={onChange} />
    </Space>
  );
}

/**
 * 智能体页签（M7，第 84 步片四按画像重构）：三画像的设计声明编辑面——
 * 员工助手（全量编辑）、访客客服（人设/启停/知识范围/内置工具）、运营助手
 * （只读提示位，日常调整走管理台「智能服务」页）。受控组件：编辑经
 * onChange 回写设计包草稿，保存草稿/发布与其他段完全一致（App.tsx 的
 * updateBundle 通道）；每次回写都整段透传未编辑的画像，保证保存往返
 * 不冲掉其他段（尤其 ops 段与 null 段）。未声明（null）的画像运行时按
 * 「领域声明 → 平台默认」回填，visitor 无平台默认、两级皆无则不启用。
 */
export default function AgentsTab({
  agents,
  onChange,
}: {
  /** 已归一化的三画像声明（缺段为 null，由 App 侧 normalizeAgents 保证） */
  agents: AgentsConfig;
  onChange: (next: AgentsConfig) => void;
}) {
  const { staff, visitor, ops } = agents;
  const emit = (p: Partial<AgentsConfig>) => onChange({ ...agents, ...p });

  const patchStaff = (p: Partial<StaffAgentDecl>) =>
    staff && emit({ staff: { ...staff, ...p } });
  const patchStaffTool = (key: keyof StaffAgentDecl["tools"], v: boolean) =>
    staff && emit({ staff: { ...staff, tools: { ...staff.tools, [key]: v } } });

  const patchVisitor = (p: Partial<SupportAgentDecl>) =>
    visitor && emit({ visitor: { ...visitor, ...p } });
  const patchVisitorTool = (key: string, v: boolean) =>
    visitor &&
    emit({
      visitor: {
        ...visitor,
        builtinTools: v
          ? [...visitor.builtinTools, key]
          : visitor.builtinTools.filter((t) => t !== key),
      },
    });

  const present = agents.overridesPresent;
  const presentParts =
    present && Object.keys(present).length > 0
      ? Object.entries(present).map(
          ([face, at]) => `${FACE_LABELS[face] ?? face}，${fmtPresentTime(at)}`,
        )
      : [];

  return (
    <div style={{ padding: 20, maxWidth: 820 }}>
      {presentParts.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`本应用存在管理台运行面调整（${presentParts.join("；")}），发布不会清除`}
        />
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        配置本应用三位助手的设计声明，随设计草稿保存、发布后生效。助手能用的工具先按使用者角色与权限自动限定，下面的开关在此基础上进一步收窄；助手始终以提问者本人的身份与权限执行。日常的人设、启停与知识范围调整可在管理台「智能服务」页进行（运行面调整，立即生效、发布不清除）。
      </Typography.Paragraph>

      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          title={
            <Space>
              员工助手
              {staff ? <Tag color="blue">已声明</Tag> : <Tag>未声明</Tag>}
            </Space>
          }
          extra={
            <DeclaredSwitch
              declared={staff !== null}
              onChange={(v) => emit({ staff: v ? newStaffDecl() : null })}
            />
          }
        >
          {staff === null ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
              本应用未声明员工助手，将使用所属领域的声明；领域也未声明时使用平台默认。打开右上角开关，即在本应用落一份声明并开始编辑。
            </Typography.Paragraph>
          ) : (
            <Form layout="vertical">
              <Form.Item label="助手名称">
                <Input
                  value={staff.name}
                  maxLength={40}
                  onChange={(e) => patchStaff({ name: e.target.value })}
                  placeholder="应用助理"
                />
              </Form.Item>
              <Form.Item label="人设（补充系统提示，描述语气、职责边界等）">
                <Input.TextArea
                  value={staff.persona}
                  rows={4}
                  maxLength={2000}
                  onChange={(e) => patchStaff({ persona: e.target.value })}
                  placeholder="如：你是采购部门的智能助理，回答简洁，先给结论再给依据；不确定的数据先查询再回答。"
                />
              </Form.Item>
              <Form.Item label="工具开关">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {staffToolRows.map((t) => (
                    <div
                      key={t.key}
                      style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
                    >
                      <Switch
                        checked={staff.tools[t.key]}
                        onChange={(v) => patchStaffTool(t.key, v)}
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
                  value={staff.maxTurns}
                  onChange={(v) => patchStaff({ maxTurns: v ?? 6 })}
                />
              </Form.Item>
              <Form.Item label="写操作策略">
                <Select
                  value={staff.writePolicy}
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
          )}
        </Card>

        <Card
          title={
            <Space>
              访客客服
              {visitor ? <Tag color="blue">已声明</Tag> : <Tag>未声明</Tag>}
            </Space>
          }
          extra={
            <DeclaredSwitch
              declared={visitor !== null}
              onChange={(v) => emit({ visitor: v ? newVisitorDecl() : null })}
            />
          }
        >
          {visitor === null ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
              本应用未声明访客客服，将使用所属领域的声明；领域也未声明时，访客客服不启用。打开右上角开关，即在本应用落一份声明并开始编辑。
            </Typography.Paragraph>
          ) : (
            <Form layout="vertical">
              <Form.Item label="客服名称">
                <Input
                  value={visitor.name}
                  maxLength={40}
                  onChange={(e) => patchVisitor({ name: e.target.value })}
                  placeholder="客服"
                />
              </Form.Item>
              <Form.Item label="人设（系统提示，描述职责、语气与转人工时机等）">
                <Input.TextArea
                  value={visitor.systemPrompt}
                  rows={4}
                  maxLength={2000}
                  onChange={(e) => patchVisitor({ systemPrompt: e.target.value })}
                  placeholder="如：你是本应用的智能客服。基于知识库回答访客咨询并给出依据来源；知识库中没有的问题明确说明无法确认、不要编造，并建议转人工。"
                />
              </Form.Item>
              <Form.Item label="知识范围（知识库编号）">
                <Select
                  mode="tags"
                  style={{ width: "100%" }}
                  value={visitor.knowledgeBases}
                  onChange={(v) => patchVisitor({ knowledgeBases: v })}
                  placeholder="输入知识库编号后回车添加；留空表示使用本应用全部知识库"
                  tokenSeparators={[",", " "]}
                />
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, marginTop: 6 }}
                >
                  填写后客服仅检索所列知识库；留空表示本应用全部知识库。
                </Typography.Paragraph>
              </Form.Item>
              <Form.Item label="内置工具（结构面）">
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <Switch checked disabled />
                    <div>
                      <div>
                        转人工 <Tag>必需</Tag>
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        访客要求人工、问题需建单跟进或超出知识范围时转人工——客服声明必须启用，服务端保存时强制校验。
                      </Typography.Text>
                    </div>
                  </div>
                  {visitorToolRows.map((t) => (
                    <div
                      key={t.key}
                      style={{ display: "flex", alignItems: "flex-start", gap: 12 }}
                    >
                      <Switch
                        checked={visitor.builtinTools.includes(t.key)}
                        onChange={(v) => patchVisitorTool(t.key, v)}
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
              <Form.Item label="派生工具域（结构面，只许关小）">
                {visitor.toolScopes.length > 0 ? (
                  <Space size={6} wrap>
                    {visitor.toolScopes.map((s) => (
                      <Tag
                        key={s}
                        closable
                        onClose={(e) => {
                          e.preventDefault();
                          patchVisitor({
                            toolScopes: visitor.toolScopes.filter((x) => x !== s),
                          });
                        }}
                      >
                        {TOOL_SCOPE_LABELS[s] ?? s}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    未声明派生工具域。
                  </Typography.Text>
                )}
                <Typography.Paragraph
                  type="secondary"
                  style={{ fontSize: 12, marginTop: 6 }}
                >
                  访客回合的实际工具集由平台统一限定，此处仅作声明保留：只能移除已有工具域，不能在此新增。
                </Typography.Paragraph>
              </Form.Item>
              <Form.Item label="单回合工具循环上限（maxTurns，1–12）">
                <InputNumber
                  min={1}
                  max={12}
                  value={visitor.maxTurns}
                  onChange={(v) => patchVisitor({ maxTurns: v ?? 6 })}
                />
              </Form.Item>
              <Form.Item label="写操作策略">
                <Select
                  value={visitor.writePolicy}
                  onChange={(v) => patchVisitor({ writePolicy: v })}
                  options={[
                    { value: "confirm", label: "写操作需确认（确认卡片）" },
                    { value: "auto", label: "自动执行" },
                  ]}
                  style={{ width: 280 }}
                />
              </Form.Item>
            </Form>
          )}
        </Card>

        <Card
          title={
            <Space>
              运营助手
              {ops ? <Tag color="blue">已声明</Tag> : <Tag>未声明</Tag>}
              <Tag>只读</Tag>
            </Space>
          }
        >
          {ops === null ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              本应用未声明运营助手，将使用所属领域的声明；领域也未声明时使用平台默认。
            </Typography.Paragraph>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div>
                <Typography.Text type="secondary">名称：</Typography.Text>
                {ops.name || "—"}
              </div>
              <div>
                <Typography.Text type="secondary">人设：</Typography.Text>
                <span style={{ whiteSpace: "pre-wrap" }}>{ops.systemPrompt || "（空）"}</span>
              </div>
              <div>
                <Typography.Text type="secondary">内置工具：</Typography.Text>
                {ops.builtinTools.length > 0
                  ? ops.builtinTools.map((t) => BUILTIN_TOOL_LABELS[t] ?? t).join("、")
                  : "无"}
              </div>
              <div>
                <Typography.Text type="secondary">派生工具域：</Typography.Text>
                {ops.toolScopes.length > 0
                  ? ops.toolScopes.map((s) => TOOL_SCOPE_LABELS[s] ?? s).join("、")
                  : "无"}
              </div>
              <div>
                <Typography.Text type="secondary">知识范围：</Typography.Text>
                {ops.knowledgeBases.length > 0
                  ? ops.knowledgeBases.join("、")
                  : "本应用全部知识库"}
              </div>
              <div>
                <Typography.Text type="secondary">单回合工具循环上限：</Typography.Text>
                {ops.maxTurns}
              </div>
              <div>
                <Typography.Text type="secondary">写操作策略：</Typography.Text>
                {ops.writePolicy === "confirm" ? "写操作需确认（确认卡片）" : ops.writePolicy}
              </div>
            </div>
          )}
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
          >
            运营助手的声明在此仅供查看；其日常调整（人设、启停、知识范围）在管理台「智能服务」页进行，保存立即生效。
          </Typography.Paragraph>
        </Card>
      </Space>
    </div>
  );
}
