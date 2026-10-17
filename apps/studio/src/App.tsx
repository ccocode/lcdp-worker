import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  ColorPicker,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import type { DataSchema, Entity, Field, FieldType } from "@naka1205/schema";
import type {
  AppConfig,
  AppInfo,
  BundleView,
  DesignData,
  UserInfo,
} from "./api.js";
import { ApiError, api, getStoredUser, normalizeAgents, storeSession } from "./api.js";
import PageDesigner from "./PageDesigner.js";
import Permissions from "./Permissions.js";
import WorkflowDesigner from "./WorkflowDesigner.js";
import Copilot from "./Copilot.js";
import AgentsTab from "./AgentsTab.js";

/**
 * 设计台（M3 起，M4 增权限页签，M5 增流程页签）：数据模型设计器 + 页面设计器 + 流程设计器 + 权限 + 应用设置 + 发布/版本/回滚。
 * 草稿是整个设计包（数据模型 + 设计页面 + 应用主题 + 片段库 + 权限配置 + 流程定义），经 api 保存到平台，
 * 发布时服务端做增量迁移并留版本快照，运行态即时读取新发布版本。
 */

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "string", label: "短文本" },
  { value: "text", label: "长文本" },
  { value: "richtext", label: "富文本" },
  { value: "int", label: "整数" },
  { value: "decimal", label: "小数/金额" },
  { value: "boolean", label: "布尔" },
  { value: "date", label: "日期" },
  { value: "datetime", label: "日期时间" },
  { value: "enum", label: "枚举" },
  { value: "ref", label: "引用其他实体" },
  { value: "file", label: "文件" },
  { value: "image", label: "图片" },
  { value: "json", label: "JSON" },
];

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const cloneBundle = (b: BundleView): BundleView =>
  JSON.parse(JSON.stringify(b)) as BundleView;

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(() => getStoredUser());
  const [designing, setDesigning] = useState<string | null>(null);

  const logout = () => {
    storeSession(null, null);
    setUser(null);
    setDesigning(null);
  };

  return (
    <ConfigProvider locale={zhCN}>
      {!user ? (
        <LoginView onLoggedIn={setUser} />
      ) : designing ? (
        <Designer
          appId={designing}
          onBack={() => setDesigning(null)}
          onLogout={logout}
          user={user}
        />
      ) : (
        <AppsView user={user} onLogout={logout} onOpen={setDesigning} />
      )}
    </ConfigProvider>
  );
}

function LoginView({ onLoggedIn }: { onLoggedIn: (user: UserInfo) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(values.username.trim(), values.password);
      onLoggedIn(res.user);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f5f5",
      }}
    >
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ margin: "0 0 4px" }}>
          LCDP Studio · 设计台
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 13, marginBottom: 20 }}
        >
          以管理员账号登录，设计数据模型与页面并发布到运行态
        </Typography.Paragraph>
        {error && (
          <Alert type="error" message={error} style={{ marginBottom: 16 }} />
        )}
        <Form
          layout="vertical"
          initialValues={{ username: "admin" }}
          onFinish={(v) => void submit(v)}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function AppsView({
  user,
  onLogout,
  onOpen,
}: {
  user: UserInfo;
  onLogout: () => void;
  onOpen: (appId: string) => void;
}) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 新建应用对话框（M10 补强） */
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newAppId, setNewAppId] = useState("");
  const [newAppName, setNewAppName] = useState("");

  useEffect(() => {
    api
      .apps()
      .then(setApps)
      .catch((err) => setError(errText(err)));
  }, []);

  const submitCreate = async () => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const app = await api.createApp(newAppId.trim(), newAppName.trim());
      setCreateOpen(false);
      onOpen(app.id);
    } catch (err) {
      setCreateError(errText(err));
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px" }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", marginBottom: 24 }}
      >
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            设计台 · 我的应用
          </Typography.Title>
          <Typography.Text type="secondary">
            {user.username}（{user.role}）· 选择一个应用进入设计器
          </Typography.Text>
        </div>
        <div style={{ flex: 1 }} />
        <Space>
          <Button
            type="primary"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            新建应用
          </Button>
          <Button onClick={onLogout}>退出登录</Button>
        </Space>
      </div>
      <Modal
        title="新建应用"
        open={createOpen}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
        confirmLoading={createBusy}
        okText="创建并进入设计器"
        cancelText="取消"
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="应用 id（小写字母开头，小写字母/数字/连字符，创建后不可改）" required>
            <Input
              value={newAppId}
              onChange={(e) => setNewAppId(e.target.value)}
              placeholder="如 xingqiao-cms"
            />
          </Form.Item>
          <Form.Item label="应用名称" required>
            <Input
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              placeholder="如 星桥科技官网 CMS"
            />
          </Form.Item>
          {createError && <Alert type="error" message={createError} />}
        </Form>
      </Modal>
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {apps.map((app) => (
          <Card key={app.id} hoverable onClick={() => onOpen(app.id)}>
            <Card.Meta
              title={app.name}
              description={`场景：${app.scenario ?? "—"} · 点击进入设计器`}
            />
          </Card>
        ))}
      </div>
      {apps.length === 0 && !error && (
        <Typography.Text type="secondary">
          暂无应用（先完成平台初始化）
        </Typography.Text>
      )}
    </div>
  );
}

/** 枚举选项的文本表示：每项 value:label，逗号分隔（label 可省略） */
function optionsToText(field: Field): string {
  return (field.options ?? [])
    .map((o) => (o.label === o.value ? o.value : `${o.value}:${o.label}`))
    .join(", ");
}

function textToOptions(text: string): { value: string; label: string }[] {
  return text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [v, l] = item.split(/[:：]/);
      const value = (v ?? "").trim();
      return { value, label: (l ?? v ?? "").trim() || value };
    })
    .filter((o) => o.value);
}

let seq = 0;
function newField(): Field {
  seq += 1;
  return {
    key: `field_${seq}`,
    label: "新字段",
    type: "string",
    required: false,
    unique: false,
    indexed: false,
    sensitive: false,
  };
}

function Designer({
  appId,
  user,
  onBack,
  onLogout,
}: {
  appId: string;
  user: UserInfo;
  onBack: () => void;
  onLogout: () => void;
}) {
  const [design, setDesign] = useState<DesignData | null>(null);
  const [working, setWorking] = useState<BundleView | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [activeTab, setActiveTab] = useState("data");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  /** 流程图设计器上报的校验问题（M5.1）；非空时阻断保存草稿（服务端也会拒绝） */
  const [wfIssues, setWfIssues] = useState<string[]>([]);
  /** 设计态 AI Copilot 抽屉（M6） */
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [publishNote, setPublishNote] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.design(appId);
      setDesign(d);
      const initial: BundleView | null =
        d.draft ??
        (d.published
          ? {
              schema: d.published.schema,
              pages: d.published.pages,
              appConfig: d.published.appConfig,
              fragments: d.published.fragments,
              permissions: d.published.permissions,
              workflows: d.published.workflows,
              agents: d.published.agents,
            }
          : null);
      // agents 段（M7）旧快照/旧草稿可能缺失：归一化为完整配置（与服务端默认口径一致），
      // 保证智能体页签受控渲染，且 baseline 取归一化后的形态、不会误报未保存修改
      if (initial) initial.agents = normalizeAgents(initial.agents);
      setWorking(initial ? cloneBundle(initial) : null);
      setBaseline(initial ? JSON.stringify(initial) : "");
      setSelectedKey((prev) =>
        prev && initial?.schema.entities.some((e) => e.key === prev)
          ? prev
          : (initial?.schema.entities[0]?.key ?? null),
      );
      setNewKeys(new Set());
    } catch (err) {
      setError(errText(err));
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => (working ? JSON.stringify(working) !== baseline : false),
    [working, baseline],
  );

  const updateBundle = (fn: (draft: BundleView) => void) => {
    setWorking((prev) => {
      if (!prev) return prev;
      const next = cloneBundle(prev);
      fn(next);
      return next;
    });
  };

  const updateData = (fn: (draft: DataSchema) => void) =>
    updateBundle((b) => fn(b.schema));

  const entity: Entity | null = useMemo(
    () => working?.schema.entities.find((e) => e.key === selectedKey) ?? null,
    [working, selectedKey],
  );

  const saveDraft = async () => {
    if (!working) return;
    setBusy("save");
    setError(null);
    setIssues([]);
    try {
      const res = await api.saveDraft(appId, working);
      setWorking(cloneBundle(res.draft));
      setBaseline(JSON.stringify(res.draft));
      // 关键（M2 修复点，勿回退）：同步 design.draft，发布按钮才即时启用
      setDesign((prev) => (prev ? { ...prev, draft: res.draft } : prev));
      void antdMessage.success("草稿已保存（数据模型 + 页面 + 主题 + 片段 + 权限 + 流程 + 智能体）");
    } catch (err) {
      setError(errText(err));
      if (err instanceof ApiError && err.issues) setIssues(err.issues);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    setError(null);
    try {
      const res = await api.publish(appId, publishNote || undefined);
      setPublishOpen(false);
      setPublishNote("");
      void antdMessage.success(`已发布 v${res.version}`);
      Modal.success({
        title: `发布成功 · v${res.version}`,
        content:
          res.changes.length > 0
            ? `本次发布的变更：${res.changes.join("；")}`
            : "本次发布无结构变更。运行态已切换到新版本。",
      });
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (version: number) => {
    setBusy("rollback");
    setError(null);
    try {
      await api.rollback(appId, version);
      void antdMessage.success(`已回滚到 v${version}，运行态即时生效`);
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(null);
    }
  };

  if (error && !design) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: "0 24px" }}>
        <Alert type="error" message={error} style={{ marginBottom: 12 }} />
        <Button onClick={onBack}>返回应用列表</Button>
      </div>
    );
  }
  if (!design || !working) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <Spin size="large" tip="正在加载设计器…" />
      </div>
    );
  }

  const updateEntity = (patch: Partial<Entity>) => {
    if (!entity) return;
    updateData((d) => {
      const e = d.entities.find((x) => x.key === entity.key);
      if (e) Object.assign(e, patch);
    });
  };

  const updateField = (idx: number, patch: Partial<Field>) => {
    if (!entity) return;
    updateData((d) => {
      const e = d.entities.find((x) => x.key === entity.key);
      if (e?.fields[idx]) Object.assign(e.fields[idx], patch);
    });
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    if (!entity) return;
    updateData((d) => {
      const e = d.entities.find((x) => x.key === entity.key);
      if (!e) return;
      const j = idx + dir;
      if (j < 0 || j >= e.fields.length) return;
      const tmp = e.fields[idx]!;
      e.fields[idx] = e.fields[j]!;
      e.fields[j] = tmp;
    });
  };

  // ------------------------------------------------------------ 数据模型 tab
  const dataModelTab = (
    <div style={{ display: "flex", height: "calc(100vh - 64px - 46px)" }}>
      <div
        style={{
          width: 230,
          borderRight: "1px solid #f0f0f0",
          padding: 12,
          overflowY: "auto",
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <Typography.Text strong>数据实体</Typography.Text>
          <div style={{ flex: 1 }} />
          <Button
            size="small"
            type="primary"
            ghost
            onClick={() => {
              seq += 1;
              const key = `entity_${seq}`;
              updateData((d) => {
                d.entities.push({
                  key,
                  label: "新实体",
                  fields: [
                    { key: "name", label: "名称", type: "string", required: true, unique: false, indexed: false, sensitive: false },
                  ],
                });
              });
              setNewKeys((prev) => new Set(prev).add(key));
              setSelectedKey(key);
            }}
          >
            新增实体
          </Button>
        </div>
        <List
          size="small"
          dataSource={working.schema.entities}
          renderItem={(e) => (
            <List.Item
              onClick={() => setSelectedKey(e.key)}
              style={{
                cursor: "pointer",
                padding: "8px 10px",
                borderRadius: 6,
                background: e.key === selectedKey ? "#e6f4ff" : undefined,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{e.label}</div>
                <div style={{ color: "#9ca3af", fontSize: 12 }}>
                  {e.key} · {e.fields.length} 字段
                  {e.parentField ? " · 子表" : ""}
                </div>
              </div>
            </List.Item>
          )}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16 }}>
          发布只做增量迁移：新实体建表、新字段加列，不删表不删列；回滚换回旧 Schema 即可，数据不丢。
        </Typography.Paragraph>
      </div>
      <div style={{ flex: 1, padding: 20, overflowY: "auto", background: "#fff", minWidth: 0 }}>
        {entity ? (
          <>
            <Space size={16} wrap style={{ marginBottom: 8 }}>
              <span>
                实体标识 key：
                <Input
                  style={{ width: 180, marginLeft: 8 }}
                  value={entity.key}
                  disabled={!newKeys.has(entity.key)}
                  onChange={(ev) => {
                    const key = ev.target.value;
                    updateEntity({ key });
                    setSelectedKey(key);
                    setNewKeys((prev) => {
                      const next = new Set(prev);
                      next.delete(entity.key);
                      next.add(key);
                      return next;
                    });
                  }}
                />
              </span>
              <span>
                显示名：
                <Input
                  style={{ width: 180, marginLeft: 8 }}
                  value={entity.label}
                  onChange={(ev) => updateEntity({ label: ev.target.value })}
                />
              </span>
              <span>
                父实体字段（子表）：
                <Select
                  style={{ width: 200, marginLeft: 8 }}
                  allowClear
                  placeholder="无（独立实体）"
                  value={entity.parentField}
                  onChange={(v) => updateEntity({ parentField: v })}
                  options={entity.fields
                    .filter((f) => f.type === "ref")
                    .map((f) => ({ value: f.key, label: `${f.label}（${f.key}）` }))}
                />
              </span>
              <Popconfirm
                title="删除该实体？"
                description="仅从模型中移除；已建的物理表与数据保留（发布为增量迁移，不删表）。"
                onConfirm={() => {
                  updateData((d) => {
                    d.entities = d.entities.filter((x) => x.key !== entity.key);
                  });
                  setSelectedKey(
                    working.schema.entities.find((x) => x.key !== entity.key)?.key ?? null,
                  );
                }}
              >
                <Button danger>删除实体</Button>
              </Popconfirm>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              提示：已有实体的 key 不可改（改名等于新实体）；字段改 key 相当于新增字段，旧列保留。
            </Typography.Paragraph>
            <Table<Field>
              size="small"
              rowKey={(_, idx) => String(idx)}
              pagination={false}
              dataSource={entity.fields}
              columns={[
                {
                  title: "字段 key",
                  width: 150,
                  render: (_, f, idx) => (
                    <Input
                      size="small"
                      value={f.key}
                      onChange={(ev) => updateField(idx, { key: ev.target.value })}
                    />
                  ),
                },
                {
                  title: "显示名",
                  width: 130,
                  render: (_, f, idx) => (
                    <Input
                      size="small"
                      value={f.label}
                      onChange={(ev) => updateField(idx, { label: ev.target.value })}
                    />
                  ),
                },
                {
                  title: "类型",
                  width: 150,
                  render: (_, f, idx) => (
                    <Select
                      size="small"
                      style={{ width: "100%" }}
                      value={f.type}
                      options={FIELD_TYPES}
                      onChange={(v) => updateField(idx, { type: v })}
                    />
                  ),
                },
                {
                  title: "必填",
                  width: 60,
                  render: (_, f, idx) => (
                    <Switch
                      size="small"
                      checked={Boolean(f.required)}
                      onChange={(v) => updateField(idx, { required: v })}
                    />
                  ),
                },
                {
                  title: "敏感",
                  width: 60,
                  render: (_, f, idx) => (
                    <Switch
                      size="small"
                      checked={Boolean(f.sensitive)}
                      onChange={(v) => updateField(idx, { sensitive: v })}
                    />
                  ),
                },
                {
                  title: "引用实体 / 枚举选项",
                  render: (_, f, idx) =>
                    f.type === "ref" ? (
                      <Select
                        size="small"
                        style={{ width: "100%" }}
                        placeholder="选择被引用实体"
                        value={f.refEntity}
                        onChange={(v) => updateField(idx, { refEntity: v })}
                        options={working.schema.entities.map((e) => ({
                          value: e.key,
                          label: `${e.label}（${e.key}）`,
                        }))}
                      />
                    ) : f.type === "enum" ? (
                      <Input
                        size="small"
                        placeholder="值:标签, 值2:标签2"
                        defaultValue={optionsToText(f)}
                        onBlur={(ev) =>
                          updateField(idx, { options: textToOptions(ev.target.value) })
                        }
                      />
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    ),
                },
                {
                  title: "操作",
                  width: 150,
                  render: (_, __, idx) => (
                    <Space size={4}>
                      <Button size="small" onClick={() => moveField(idx, -1)}>
                        上移
                      </Button>
                      <Button size="small" onClick={() => moveField(idx, 1)}>
                        下移
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          updateData((d) => {
                            const e = d.entities.find((x) => x.key === entity.key);
                            if (e) e.fields = e.fields.filter((_, i) => i !== idx);
                          })
                        }
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
            <Button
              style={{ marginTop: 12 }}
              onClick={() =>
                updateData((d) => {
                  const e = d.entities.find((x) => x.key === entity.key);
                  if (e) e.fields.push(newField());
                })
              }
            >
              添加字段
            </Button>
          </>
        ) : (
          <Typography.Text type="secondary">
            从左侧选择一个实体开始设计，或新增实体。
          </Typography.Text>
        )}
      </div>
    </div>
  );

  // ------------------------------------------------------------ 应用设置 tab
  const theme = working.appConfig?.theme ?? {};
  const setTheme = (patch: Record<string, unknown>) =>
    updateBundle((b) => {
      const next: Record<string, unknown> = { ...(b.appConfig?.theme ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      // 保留 shell / globalVars 等同级配置，只替换 theme
      b.appConfig = { ...(b.appConfig ?? { theme: {} }), theme: next };
    });
  /** 外壳形态（M10）：写入 appConfig.shell，运行态以入口主应用的该值决定外壳呈现 */
  const shell = working.appConfig?.shell === "site" ? "site" : "system";
  const setShell = (v: string) =>
    updateBundle((b) => {
      b.appConfig = { ...(b.appConfig ?? { theme: {} }), shell: v };
    });
  /** 站点配置（M10 补强）：shell=site 时编辑 appConfig.globalVars 的站点外壳键（此前无 UI 可填） */
  const globalVars = working.appConfig?.globalVars ?? {};
  const globalVarText = (key: string) =>
    typeof globalVars[key] === "string" ? (globalVars[key] as string) : "";
  const setGlobalVar = (key: string, v: string) =>
    updateBundle((b) => {
      const next = { ...(b.appConfig?.globalVars ?? {}) };
      if (v) next[key] = v;
      else delete next[key];
      b.appConfig = { ...(b.appConfig ?? { theme: {} }), globalVars: next };
    });
  /** 生效会员域（会员试点）：写入 appConfig.memberScope，空 = 本应用自成一域 */
  const memberScope =
    typeof working.appConfig?.memberScope === "string"
      ? working.appConfig.memberScope
      : "";
  const setMemberScope = (v: string) =>
    updateBundle((b) => {
      const next: AppConfig = { ...(b.appConfig ?? { theme: {} }) };
      if (v) next.memberScope = v;
      else delete next.memberScope;
      b.appConfig = next;
    });
  const colorPrimary =
    typeof theme.colorPrimary === "string" ? theme.colorPrimary : "#1677ff";

  const settingsTab = (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        外壳形态
      </Typography.Title>
      <Space size={10}>
        <Typography.Text style={{ width: 90 }}>运行外壳</Typography.Text>
        <Select
          style={{ width: 320 }}
          value={shell}
          onChange={setShell}
          options={[
            { value: "system", label: "系统外壳（侧边导航 · 内部系统）" },
            { value: "site", label: "站点外壳（顶栏导航 + 页脚 · 公开站点）" },
          ]}
        />
      </Space>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 8, maxWidth: 560 }}
      >
        入口以本应用为主应用（装配顺序首位）时，运行态登录面与公开面按所选外壳呈现；作为次应用装配进其他入口时，外壳由该入口的主应用决定。
      </Typography.Paragraph>
      {shell === "site" && (
        <>
          <Typography.Title level={5} style={{ marginTop: 28 }}>
            站点配置
          </Typography.Title>
          <Space direction="vertical" size={14} style={{ display: "flex" }}>
            <Space size={10}>
              <Typography.Text style={{ width: 90 }}>搜索页路由</Typography.Text>
              <Input
                style={{ width: 320 }}
                defaultValue={globalVarText("siteSearchRoute")}
                placeholder="如 /search（留空则顶栏不显示搜索框）"
                onBlur={(e) => setGlobalVar("siteSearchRoute", e.target.value.trim())}
              />
            </Space>
            <Space size={10}>
              <Typography.Text style={{ width: 90 }}>页脚文案</Typography.Text>
              <Input
                style={{ width: 320 }}
                defaultValue={globalVarText("siteFooter")}
                placeholder="如 © 2026 星桥科技有限公司"
                onBlur={(e) => setGlobalVar("siteFooter", e.target.value.trim())}
              />
            </Space>
          </Space>
        </>
      )}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        会员
      </Typography.Title>
      <Space size={10}>
        <Typography.Text style={{ width: 90 }}>会员域</Typography.Text>
        <Input
          style={{ width: 320 }}
          defaultValue={memberScope}
          key={`member-scope-${design.app.id}`}
          placeholder="留空 = 本应用（一期单应用单域）"
          onBlur={(e) => setMemberScope(e.target.value.trim())}
        />
      </Space>
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 8, maxWidth: 560 }}
      >
        会员按「会员域」隔离：缺省时本应用自成一域；多个应用填同一个会员域值（如品牌名）即共用一套会员账号（一处注册、处处登录，数据权限仍各应用独立）。会员可见页面与可读写实体在「权限」页签的会员策略区配置。
      </Typography.Paragraph>
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        主题
      </Typography.Title>
      {!working.appConfig ? (
        <>
          <Typography.Paragraph type="secondary">
            当前未启用自定义主题，运行态使用平台默认主题（主色、圆角与 Logo 文案）。
          </Typography.Paragraph>
          <Button
            type="primary"
            ghost
            onClick={() => updateBundle((b) => (b.appConfig = { theme: {} }))}
          >
            启用自定义主题
          </Button>
        </>
      ) : (
        <>
          <Space direction="vertical" size={14} style={{ display: "flex" }}>
            <Space size={10}>
              <Typography.Text style={{ width: 90 }}>主题主色</Typography.Text>
              <ColorPicker
                value={colorPrimary}
                onChange={(c) => setTheme({ colorPrimary: c.toHexString() })}
              />
              <Input
                style={{ width: 140 }}
                value={colorPrimary}
                onChange={(ev) => setTheme({ colorPrimary: ev.target.value })}
              />
            </Space>
            <Space size={10}>
              <Typography.Text style={{ width: 90 }}>圆角（px）</Typography.Text>
              <InputNumber
                min={0}
                max={32}
                value={
                  typeof theme.borderRadius === "number"
                    ? theme.borderRadius
                    : undefined
                }
                placeholder="默认"
                onChange={(v) => setTheme({ borderRadius: v ?? undefined })}
              />
            </Space>
            <Space size={10}>
              <Typography.Text style={{ width: 90 }}>Logo 文案</Typography.Text>
              <Input
                style={{ width: 260 }}
                placeholder="如：公司名称缩写"
                defaultValue={
                  typeof theme.logoText === "string" ? theme.logoText : ""
                }
                key={`logo-${design.app.id}`}
                onBlur={(ev) =>
                  setTheme({ logoText: ev.target.value || undefined })
                }
              />
            </Space>
            <div>
              <Popconfirm
                title="停用自定义主题？"
                description="主题配置将从草稿中移除，发布后运行态恢复平台默认主题（外壳形态等其他配置保留）。"
                onConfirm={() =>
                  updateBundle((b) => {
                    if (!b.appConfig) return;
                    // 只清主题：shell / globalVars 等同级配置保留；无其余配置时回到未启用态
                    const rest: AppConfig = { ...b.appConfig, theme: {} };
                    const hasOther = Object.keys(rest).some(
                      (k) => k !== "theme",
                    );
                    b.appConfig = hasOther ? rest : null;
                  })
                }
              >
                <Button danger>停用自定义主题</Button>
              </Popconfirm>
            </div>
          </Space>
        </>
      )}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        呈现入口
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        message="当前应用经平台默认入口呈现（内部域名，面向企业内部用户）"
        description="入口装配（把页面组装到员工入口/客户门户/公开面）与独立域名配置将在后续里程碑开放；本期的主题设置对默认入口生效。"
      />
    </div>
  );

  // ------------------------------------------------------------ 版本历史 tab
  const versionsTab = (
    <div style={{ padding: 20 }}>
      <Table
        size="small"
        rowKey="version"
        pagination={false}
        dataSource={design.versions}
        columns={[
          {
            title: "版本",
            width: 90,
            render: (_, v) => (
              <span>
                v{v.version} {v.current && <Tag color="green">当前</Tag>}
              </span>
            ),
          },
          { title: "说明", dataIndex: "note", render: (t: string | null) => t ?? "—" },
          { title: "发布人", dataIndex: "publishedBy", width: 100, render: (t: string | null) => t ?? "—" },
          {
            title: "发布时间",
            dataIndex: "publishedAt",
            width: 180,
            render: (t: string) => new Date(t).toLocaleString("zh-CN"),
          },
          { title: "实体数", dataIndex: "entityCount", width: 80 },
          { title: "页面数", dataIndex: "pageCount", width: 80 },
          {
            title: "操作",
            width: 100,
            render: (_, v) =>
              v.current ? (
                <Typography.Text type="secondary">—</Typography.Text>
              ) : (
                <Popconfirm
                  title={`回滚到 v${v.version}？`}
                  description="运行态将立即切换到该版本的设计包（模型 + 页面 + 主题）；物理表只增不减，数据不丢。当前草稿会被清除。"
                  onConfirm={() => void rollback(v.version)}
                >
                  <Button size="small" loading={busy === "rollback"}>
                    回滚
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header
        style={{
          background: "#fff",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
        }}
      >
        <Typography.Title level={5} style={{ margin: 0 }}>
          {design.app.name}
        </Typography.Title>
        <Tag color="blue">当前发布 v{design.published?.version ?? "—"}</Tag>
        {design.draft && !dirty && <Tag>有已保存草稿待发布</Tag>}
        {dirty && <Tag color="orange">有未保存修改</Tag>}
        <div style={{ flex: 1 }} />
        <Button onClick={onBack}>← 应用列表</Button>
        <Button
          onClick={() =>
            window.open(`https://coode.cc.cd/#/app/${encodeURIComponent(appId)}`, "_blank")
          }
        >
          在运行态打开
        </Button>
        {wfIssues.length > 0 && (
          <Tag color="red">流程校验未通过（{wfIssues.length}）</Tag>
        )}
        <Button type="primary" ghost onClick={() => setCopilotOpen(true)}>
          ✦ AI 助手
        </Button>
        <Button
          loading={busy === "save"}
          disabled={!dirty || wfIssues.length > 0}
          title={
            wfIssues.length > 0
              ? `流程校验未通过：${wfIssues[0]}${wfIssues.length > 1 ? ` 等 ${wfIssues.length} 项` : ""}`
              : undefined
          }
          onClick={() => void saveDraft()}
        >
          保存草稿
        </Button>
        <Button
          type="primary"
          disabled={dirty || !design.draft}
          onClick={() => setPublishOpen(true)}
        >
          发布
        </Button>
        <Button onClick={onLogout}>退出（{user.username}）</Button>
      </Layout.Header>

      {error && (
        <Alert
          type="error"
          message={error}
          description={issues.length > 0 ? issues.join("；") : undefined}
          style={{ margin: "12px 20px 0" }}
          closable
          onClose={() => setError(null)}
        />
      )}

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ padding: "0 0" }}
        tabBarStyle={{ padding: "0 20px", marginBottom: 0 }}
        items={[
          { key: "data", label: "数据模型", children: dataModelTab },
          {
            key: "pages",
            label: "页面设计",
            children: (
              <div style={{ height: "calc(100vh - 64px - 46px)" }}>
                <PageDesigner
                  appId={appId}
                  data={working.schema}
                  pages={working.pages}
                  fragments={working.fragments}
                  theme={working.appConfig?.theme}
                  onPagesChange={(pages) => updateBundle((b) => (b.pages = pages))}
                  onFragmentsChange={(fragments) =>
                    updateBundle((b) => (b.fragments = fragments))
                  }
                />
              </div>
            ),
          },
          {
            key: "workflow",
            label: "流程",
            children: (
              <div style={{ height: "calc(100vh - 64px - 46px)", overflowY: "auto", background: "#fff" }}>
                <WorkflowDesigner
                  appId={appId}
                  data={working.schema}
                  permissions={working.permissions}
                  workflows={working.workflows}
                  onChange={(next) => updateBundle((b) => (b.workflows = next))}
                  onValidityChange={setWfIssues}
                />
              </div>
            ),
          },
          {
            key: "permissions",
            label: "权限",
            children: (
              <div style={{ height: "calc(100vh - 64px - 46px)", overflowY: "auto", background: "#fff" }}>
                <Permissions
                  appId={appId}
                  data={working.schema}
                  pages={working.pages}
                  permissions={working.permissions}
                  onChange={(next) => updateBundle((b) => (b.permissions = next))}
                />
              </div>
            ),
          },
          {
            key: "agents",
            label: "智能体",
            children: (
              <div style={{ height: "calc(100vh - 64px - 46px)", overflowY: "auto", background: "#fff" }}>
                <AgentsTab
                  agents={normalizeAgents(working.agents)}
                  onChange={(next) => updateBundle((b) => (b.agents = next))}
                />
              </div>
            ),
          },
          { key: "settings", label: "应用设置", children: settingsTab },
          { key: "versions", label: "版本历史", children: versionsTab },
        ]}
      />

      <Modal
        open={publishOpen}
        title={`发布新版本（当前发布为 v${design.published?.version ?? "—"}，新版本号发布时生成）`}
        onCancel={() => setPublishOpen(false)}
        onOk={() => void publish()}
        confirmLoading={busy === "publish"}
        okText="确认发布"
      >
        <Typography.Paragraph>
          发布将基于**已保存的草稿**（数据模型 + 页面设计 + 主题 + 片段 + 权限 + 流程 + 智能体）执行增量迁移并切换运行态。迁移只增不减，发布后可随时在版本历史中回滚。
        </Typography.Paragraph>
        <Input
          placeholder="版本说明（可选，如：新增合同实体）"
          value={publishNote}
          onChange={(e) => setPublishNote(e.target.value)}
        />
      </Modal>

      <Copilot
        appId={appId}
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        onApplied={() => void load()}
      />
    </Layout>
  );
}
