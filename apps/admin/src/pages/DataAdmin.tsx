import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import { PageTable, showError } from "@lcdp/ui";
import type { ColumnsType } from "antd/es/table";
import {
  api,
  type AdminDataMeta,
  type AdminEntityMeta,
  type AdminFieldMeta,
  type ApiRequestError,
  type Row,
} from "../api";
import { asText, fmtTime } from "../helpers";
import RichTextField from "../components/RichTextField";
import { htmlToText } from "../lib/richtext";

/**
 * 通用数据管理（M15 第③步通用模版，第 57 步补新建/删除）：按已发布 schema
 * 的实体元数据生成列表 / 检索 / 分页 / 新建 / 编辑（含状态字段直改）/ 删除。
 * 读写走管理侧数据端点族（按数据权限三档执法、全程审计），不经员工权限
 * 快照。新建/编辑/删除按钮以 meta 下发的实体 actions 为唯一门控：只有
 * read 的实体三者皆不渲染（点了必吃 403 的假按钮不出现）。
 * 删除被其他记录引用时服务端回 409 referencedBy，前端弹窗逐项明示。
 * 内容领域模版以 lockEntity + 状态筛选复用本组件（自动继承本套能力）。
 * 第 76 步：数据维护页按 ?entity= 锁定单实体呈现（展开组）；子表归位——
 * 编辑抽屉内以子表区（embedded + presetFilter）维护子实体行，子表不进菜单。
 */

export interface StatusFilter {
  field: string;
  value: string | null;
}

interface Props {
  appId: string;
  meta: AdminDataMeta;
  /** 锁定单个实体（领域模版用），不显实体切换 */
  lockEntity?: string;
  /** 外部状态筛选（如文章工作台的状态队列），value 为 null 表示全部 */
  statusFilter?: StatusFilter;
  /** 行内附加动作（领域模版的快捷直改），渲染在「编辑」之前 */
  extraRowActions?: (row: Row, reload: () => void) => React.ReactNode;
  title?: string;
  /**
   * 预置等值过滤（子表区用，第 76 步）：列表恒按此过滤、新建恒注入此值、
   * 表单不渲染此字段（父键由上下文决定，不给用户改）。
   */
  presetFilter?: { field: string; value: string };
  /** 内嵌呈现（子表区用）：不包 Card、工具栏紧凑 */
  embedded?: boolean;
  /** 嵌套深度：子表区仅在 depth=0 的编辑抽屉内渲染，防止无限嵌套 */
  depth?: number;
}

const SYSTEM_COLS = ["id", "created_at", "updated_at"];

function optionList(f: AdminFieldMeta): { label: string; value: string }[] {
  return (f.options ?? []).map((o) =>
    typeof o === "string" ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

function isLongText(f: AdminFieldMeta): boolean {
  return f.type === "text" || f.type === "richtext";
}

export default function DataAdmin({
  appId,
  meta,
  lockEntity,
  statusFilter,
  extraRowActions,
  title,
  presetFilter,
  embedded = false,
  depth = 0,
}: Props) {
  const presetField = presetFilter?.field;
  const presetValue = presetFilter?.value;
  const entities = meta.entities;
  const [entityKey, setEntityKey] = useState<string | null>(
    lockEntity ?? entities[0]?.key ?? null,
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const entity: AdminEntityMeta | null = useMemo(
    () => entities.find((e) => e.key === entityKey) ?? null,
    [entities, entityKey],
  );

  /** 子实体集（第 76 步子表归位）：parentField 的 ref 指向当前实体且可读者 */
  const childEntities = useMemo(() => {
    if (!entity) return [];
    return entities.filter(
      (c) =>
        !!c.parentField &&
        c.fields.find((f) => f.key === c.parentField)?.refEntity ===
          entity.key &&
        c.actions.includes("read"),
    );
  }, [entities, entity]);

  const statusValue = statusFilter?.value ?? null;

  const load = useCallback(async () => {
    if (!entityKey) return;
    setLoading(true);
    try {
      const filters: Record<string, string> = {};
      if (statusFilter && statusValue) filters[statusFilter.field] = statusValue;
      if (presetField && presetValue !== undefined) filters[presetField] = presetValue;
      const res = await api.adminData.list(appId, entityKey, {
        q: keyword || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        filters,
      });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      showError(err, "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [appId, entityKey, keyword, page, pageSize, statusFilter, statusValue, presetField, presetValue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [entityKey, keyword, statusValue]);

  const columns: ColumnsType<Row> = useMemo(() => {
    if (!entity) return [];
    const shown = entity.fields.slice(0, 6);
    const cols: ColumnsType<Row> = [
      {
        title: "ID",
        dataIndex: "id",
        key: "id",
        width: 110,
        render: (v: unknown) => (
          <Typography.Text copyable={{ text: String(v ?? "") }} style={{ fontSize: 12 }}>
            {String(v ?? "—").slice(0, 14)}
          </Typography.Text>
        ),
      },
      ...shown.map((f) => ({
        title: f.sensitive ? `${f.label}（敏感）` : f.label,
        dataIndex: f.key,
        key: f.key,
        ellipsis: true,
        render: (v: unknown) =>
          f.type === "richtext" ? (
            // richtext 单元格出纯文本摘要（第 58 步）：正文存 HTML，
            // asText 直出会露标签；经净化取 textContent 再截断
            <span>{htmlToText(typeof v === "string" ? v : "")}</span>
          ) : isLongText(f) ? (
            <span>{asText(v).slice(0, 60)}</span>
          ) : f.type === "datetime" || f.type === "date" ? (
            <span>{fmtTime(v)}</span>
          ) : (
            <span>{asText(v)}</span>
          ),
      })),
      {
        title: "操作",
        key: "actions",
        width: extraRowActions ? 300 : 150,
        render: (_: unknown, row: Row) => (
          <Space size="small">
            {extraRowActions?.(row, () => void load())}
            {entity.actions.includes("update") && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setEditing(row);
                  form.setFieldsValue({ ...row });
                }}
              >
                编辑
              </Button>
            )}
            {entity.actions.includes("delete") && (
              <Button
                size="small"
                type="link"
                danger
                onClick={() => removeRow(row)}
              >
                删除
              </Button>
            )}
          </Space>
        ),
      },
    ];
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, extraRowActions, form, load]);

  /** 删除一行：二次确认；被引用时 409 弹窗逐项明示 referencedBy，不吞错误 */
  const removeRow = (row: Row) => {
    if (!entityKey) return;
    Modal.confirm({
      title: `删除这条${entity?.label ?? "记录"}？`,
      content: `记录 ID：${String(row.id)}。删除后不可恢复（操作记入审计）。若该记录仍被其他记录引用，将无法删除并会列明引用来源。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await api.adminData.remove(appId, entityKey, String(row.id));
          message.success("已删除（操作已记入审计）");
          void load();
        } catch (err) {
          const apiErr = err as ApiRequestError;
          const refs = apiErr.body?.referencedBy;
          if (apiErr.status === 409 && Array.isArray(refs)) {
            Modal.warning({
              title: "该记录仍被引用，不能删除",
              content: (
                <div>
                  <p>以下记录正在引用它，请先处理引用关系后再删：</p>
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    {(refs as { entity: string; field: string; count: number }[]).map(
                      (r) => (
                        <li key={`${r.entity}.${r.field}`}>
                          {r.entity}.{r.field} × {r.count}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ),
            });
            return;
          }
          showError(err, "删除失败");
        }
      },
    });
  };

  const save = async () => {
    if (!entity || !entityKey) return;
    const values = (await form.validateFields()) as Record<string, unknown>;
    if (creating) {
      // 新建：系统列不进表单；只提交已填写字段，必填/enum/ref 由服务端校验，
      // 校验错误（400）原文呈现不吞
      const body: Record<string, unknown> = {};
      for (const f of entity.fields) {
        if (SYSTEM_COLS.includes(f.key)) continue;
        const v = values[f.key];
        if (v !== undefined && v !== null && v !== "") body[f.key] = v;
      }
      // 子表区新建：父键恒由上下文注入（表单不渲染该字段）
      if (presetField && presetValue !== undefined) body[presetField] = presetValue;
      setSaving(true);
      try {
        const { strippedFields } = await api.adminData.create(appId, entityKey, body);
        if (strippedFields.length) {
          const names = strippedFields.map(
            (k) => entity.fields.find((f) => f.key === k)?.label ?? k,
          );
          message.warning(`已新建；以下字段不在你的可写范围内，未保存：${names.join("、")}`);
        } else {
          message.success("已新建（操作已记入审计）");
        }
        setCreating(false);
        setPage(1);
        void load();
      } catch (err) {
        showError(err, "新建失败");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!editing) return;
    // 只提交真实变更字段（sensitive 的 masked 值原样未改时服务端会跳过回写）
    const changed: Record<string, unknown> = {};
    for (const f of entity.fields) {
      if (SYSTEM_COLS.includes(f.key)) continue;
      // 预置字段（父键）不进表单、不可变更：跳过比对，防被误判清空
      if (f.key === presetField) continue;
      const next = values[f.key];
      const prev = editing[f.key];
      const norm = (v: unknown) =>
        v === undefined || v === null ? null : typeof v === "object" ? JSON.stringify(v) : v;
      if (norm(next) !== norm(prev)) changed[f.key] = next ?? null;
    }
    if (Object.keys(changed).length === 0) {
      message.info("没有修改任何字段");
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      const { strippedFields } = await api.adminData.update(appId, entityKey, String(editing.id), changed);
      if (strippedFields.length) {
        const names = strippedFields.map(
          (k) => entity.fields.find((f) => f.key === k)?.label ?? k,
        );
        message.warning(`已保存其余修改；以下字段不在你的可写范围内，未保存：${names.join("、")}`);
      } else {
        message.success("已保存（操作已记入审计）");
      }
      setEditing(null);
      void load();
    } catch (err) {
      showError(err, "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!meta.published) {
    return (
      <Alert
        type="warning"
        showIcon
        message="该应用尚未发布任何版本"
        description="数据维护按已发布设计的实体元数据生成；请先在 Studio 完成设计并发布。"
      />
    );
  }
  if (entities.length === 0) {
    return <Alert type="info" showIcon message="已发布设计中没有数据实体" />;
  }

  const body = (
    <>
      {!lockEntity && !embedded && (
        <Typography.Paragraph
          type="secondary"
          style={{ marginBottom: 12, fontSize: 12 }}
        >
          保底维护工具：按实体元数据呈现；业务办理请用领域模版与运营页
        </Typography.Paragraph>
      )}
      <Space style={{ marginBottom: 16 }} wrap>
        {!lockEntity && (
          <Select
            value={entityKey ?? undefined}
            onChange={(v) => setEntityKey(v)}
            style={{ width: 220 }}
            options={entities.map((e) => ({ label: `${e.label}（${e.key}）`, value: e.key }))}
          />
        )}
        <Input.Search
          allowClear
          placeholder="关键字检索（全字段）"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onSearch={(v) => setKeyword(v.trim())}
          style={{ width: 260 }}
        />
        <Button onClick={() => void load()}>刷新</Button>
        {entity?.actions.includes("create") && (
          <Button
            type="primary"
            onClick={() => {
              form.resetFields();
              setCreating(true);
            }}
          >
            新建{entity.label}
          </Button>
        )}
        {!embedded && (
          <Typography.Text type="secondary">
            读 + 新建 + 编辑 + 删除（按你的数据权限呈现动作），全程审计；敏感字段以掩码呈现，未修改不会回写；被引用的记录不能删除。
          </Typography.Text>
        )}
      </Space>
      <PageTable
        rowKey={(r) => String(r.id)}
        loading={loading}
        columns={columns}
        dataSource={rows}
        serverPage={{
          current: page,
          pageSize,
          total,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
      <Drawer
        title={
          creating
            ? `新建 ${entity?.label ?? ""}`
            : editing
              ? `编辑 ${entity?.label ?? ""} · ${String(editing.id ?? "")}`
              : "编辑"
        }
        open={editing !== null || creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        width={editing && childEntities.length > 0 ? 760 : 560}
        extra={
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        }
      >
        {(editing || creating) && entity && (
          <Form form={form} layout="vertical">
            {entity.fields
              .filter((f) => !creating || !SYSTEM_COLS.includes(f.key))
              .filter((f) => f.key !== presetField)
              .map((f) => (
              <Form.Item
                key={f.key}
                name={f.key}
                label={f.sensitive ? `${f.label}（敏感字段）` : f.label}
                rules={f.required ? [{ required: true, message: `请填写${f.label}` }] : []}
              >
                {f.options && f.options.length > 0 ? (
                  <Select allowClear options={optionList(f)} placeholder={`选择${f.label}`} />
                ) : f.type === "boolean" ? (
                  <Switch />
                ) : f.type === "number" || f.type === "decimal" ? (
                  <InputNumber style={{ width: "100%" }} />
                ) : f.type === "richtext" ? (
                  // 富文本控件（第 58 步替换 TextArea）：与运行态同款编辑器，
                  // 正文级写作以模版专用页为准，这里保证通用面不露 HTML 源码
                  <RichTextField appId={appId} />
                ) : isLongText(f) ? (
                  <Input.TextArea rows={4} />
                ) : (
                  <Input />
                )}
              </Form.Item>
            ))}
            <Typography.Text type="secondary">
              字段类型：文本直接编辑；日期/时间按库内原格式文本编辑（如 2026-10-19 或 ISO 时间）。
            </Typography.Text>
          </Form>
        )}
        {/* 子表区（第 76 步）：子实体行在本记录的编辑抽屉内维护，不再单独成页 */}
        {editing &&
          depth === 0 &&
          childEntities.map((c) => (
            <div key={c.key} style={{ marginTop: 24 }}>
              <Typography.Title level={5} style={{ marginBottom: 8 }}>
                {c.label}
              </Typography.Title>
              <DataAdmin
                appId={appId}
                meta={meta}
                lockEntity={c.key}
                presetFilter={{
                  field: c.parentField!,
                  value: String(editing.id),
                }}
                embedded
                depth={1}
              />
            </div>
          ))}
      </Drawer>
    </>
  );

  return embedded ? (
    <div>{body}</div>
  ) : (
    <Card title={title ?? "数据维护"}>{body}</Card>
  );
}
