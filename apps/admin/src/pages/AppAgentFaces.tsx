/**
 * 应用内「智能服务 · 智能助手」页（由原 AppAgentService 拆出）：
 * 本应用三位助手的日常调整面——人设、启停、知识范围，保存后
 * 立即生效、不用重新发布。表单呈现的是本应用做过的调整本身：
 * 某项留空表示该项没有调整、沿用已发布设置（服务端只回调整
 * 内容，不回设置本体）。能使用哪些工具由应用的设计决定，不在
 * 本页出现。页面档位随管理台既有分档：领域角色身份只读，管理
 * 员与应用管理员可改。
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Input,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type AgentFaceKey,
  type AgentOverrideFields,
  type AgentOverrideRow,
} from "../api";
import { fmtTime } from "../helpers";

const FACES: { key: AgentFaceKey; label: string; hint: string }[] = [
  { key: "staff", label: "员工助手", hint: "应用内员工日常使用的助手" },
  { key: "visitor", label: "访客客服", hint: "面向对外访客的咨询客服" },
  { key: "ops", label: "运营助手", hint: "管理台内使用的运营助手" },
];

interface FaceForm {
  prompt: string;
  scope: string;
  enabled: boolean;
}

const emptyForm = (): FaceForm => ({ prompt: "", scope: "", enabled: true });

export default function AppAgentFaces({ appId }: { appId: string }) {
  const [rows, setRows] = useState<AgentOverrideRow[]>([]);
  const [forms, setForms] = useState<Record<AgentFaceKey, FaceForm>>({
    staff: emptyForm(),
    visitor: emptyForm(),
    ops: emptyForm(),
  });
  const [tier, setTier] = useState<"t0" | "t1" | "t2" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingFace, setSavingFace] = useState<AgentFaceKey | null>(null);
  const [editingFace, setEditingFace] = useState<AgentFaceKey | null>(null);

  const readOnly = tier === "t2";

  const applyRows = useCallback((next: AgentOverrideRow[]) => {
    setRows(next);
    const f: Record<AgentFaceKey, FaceForm> = {
      staff: emptyForm(),
      visitor: emptyForm(),
      ops: emptyForm(),
    };
    for (const r of next) {
      f[r.face] = {
        prompt: r.fields.systemPrompt ?? "",
        scope: r.fields.knowledgeScope ?? "",
        enabled: r.fields.enabled ?? true,
      };
    }
    setForms(f);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ov, site] = await Promise.all([
        api.agents.overrides(appId),
        api.site.get(appId),
      ]);
      applyRows(ov);
      setTier(site.accessTier);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [appId, applyRows]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchForm = (face: AgentFaceKey, p: Partial<FaceForm>) =>
    setForms((prev) => ({ ...prev, [face]: { ...prev[face], ...p } }));

  /** 保存一个面孔：留空的项不下发，三项皆空即清除该面孔的调整 */
  const saveFace = async (face: AgentFaceKey) => {
    const form = forms[face];
    const fields: AgentOverrideFields = {};
    if (form.prompt.trim()) fields.systemPrompt = form.prompt.trim();
    if (form.scope.trim()) fields.knowledgeScope = form.scope.trim();
    if (!form.enabled) fields.enabled = false;
    setSavingFace(face);
    try {
      const next = await api.agents.putOverride(appId, face, fields);
      applyRows(next);
      message.success("已保存，立即生效");
      setEditingFace(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingFace(null);
    }
  };

  const clearFace = async (face: AgentFaceKey) => {
    setSavingFace(face);
    try {
      const next = await api.agents.putOverride(appId, face, {});
      applyRows(next);
      message.success("已清除，恢复已发布设置");
      setEditingFace(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "清除失败");
    } finally {
      setSavingFace(null);
    }
  };

  const rowOf = (face: AgentFaceKey) => rows.find((r) => r.face === face);

  const faceColumns: ColumnsType<(typeof FACES)[number]> = [
    {
      title: "助手",
      width: 180,
      render: (_, f) => (
        <div>
          <div>{f.label}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {f.hint}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "启用",
      width: 90,
      render: (_, f) =>
        forms[f.key].enabled ? (
          <Tag color="green">已启用</Tag>
        ) : (
          <Tag>已停用</Tag>
        ),
    },
    {
      title: "调整状态",
      width: 100,
      render: (_, f) =>
        rowOf(f.key) ? <Tag color="blue">已调整</Tag> : <Tag>未调整</Tag>,
    },
    {
      title: "人设",
      render: (_, f) => {
        const v = rowOf(f.key)?.fields.systemPrompt;
        return v ? (
          <Typography.Paragraph
            style={{ margin: 0 }}
            ellipsis={{ rows: 2, tooltip: v }}
          >
            {v}
          </Typography.Paragraph>
        ) : (
          <Typography.Text type="secondary">沿用已发布设置</Typography.Text>
        );
      },
    },
    {
      title: "知识范围",
      width: 200,
      render: (_, f) => {
        const v = rowOf(f.key)?.fields.knowledgeScope;
        return v ? (
          <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 200 }}>
            {v}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">沿用已发布设置</Typography.Text>
        );
      },
    },
    {
      title: "最近调整",
      width: 190,
      render: (_, f) => {
        const row = rowOf(f.key);
        if (!row) {
          return (
            <Typography.Text type="secondary">当前用已发布设置</Typography.Text>
          );
        }
        return (
          <span>
            {fmtTime(row.updatedAt)}
            {row.updatedBy ? ` · ${row.updatedBy}` : ""}
          </span>
        );
      },
    },
    {
      title: "操作",
      width: 90,
      render: (_, f) => (
        <Button type="link" size="small" onClick={() => setEditingFace(f.key)}>
          {readOnly ? "查看" : "调整"}
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <Spin tip="加载中…" />
      </div>
    );
  }
  if (loadError) {
    return <Alert type="error" showIcon message={loadError} />;
  }

  return (
    <div>
      {readOnly && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前身份可查看本页，不可调整"
        />
      )}
      <Table rowKey="key" columns={faceColumns} dataSource={FACES} pagination={false} />
      <Drawer
        title={
          editingFace
            ? `${FACES.find((f) => f.key === editingFace)?.label ?? ""} · ${
                readOnly ? "查看" : "调整"
              }`
            : "调整"
        }
        width={"min(560px, 100vw)"}
        open={editingFace !== null}
        onClose={() => setEditingFace(null)}
      >
        {editingFace &&
          (() => {
            const f = FACES.find((x) => x.key === editingFace)!;
            const form = forms[f.key];
            const row = rowOf(f.key);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {f.hint}；保存后立即生效，不用重新发布。
                  {row
                    ? `最近调整 ${fmtTime(row.updatedAt)}${row.updatedBy ? ` · ${row.updatedBy}` : ""}`
                    : "当前用已发布设置"}
                </Typography.Text>
                <div>
                  <div style={{ marginBottom: 4 }}>人设</div>
                  <Input.TextArea
                    rows={6}
                    maxLength={2000}
                    value={form.prompt}
                    disabled={readOnly}
                    placeholder="留空表示沿用已发布的人设"
                    onChange={(e) => patchForm(f.key, { prompt: e.target.value })}
                  />
                </div>
                <div>
                  <div style={{ marginBottom: 4 }}>知识范围</div>
                  <Input
                    maxLength={500}
                    value={form.scope}
                    disabled={readOnly}
                    placeholder="留空表示沿用已发布的知识范围"
                    onChange={(e) => patchForm(f.key, { scope: e.target.value })}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>启用</span>
                  <Switch
                    checked={form.enabled}
                    disabled={readOnly}
                    onChange={(v) => patchForm(f.key, { enabled: v })}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    关闭后该助手随即停用
                  </Typography.Text>
                </div>
                {!readOnly && (
                  <Space>
                    <Button
                      type="primary"
                      loading={savingFace === f.key}
                      onClick={() => void saveFace(f.key)}
                    >
                      保存本面调整
                    </Button>
                    <Button
                      disabled={!row || savingFace === f.key}
                      onClick={() => void clearFace(f.key)}
                    >
                      清除本面调整
                    </Button>
                  </Space>
                )}
              </div>
            );
          })()}
      </Drawer>
    </div>
  );
}
