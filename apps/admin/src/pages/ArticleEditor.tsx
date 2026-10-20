import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row as AntRow,
  Select,
  Space,
  Spin,
  Typography,
  Upload,
  message,
} from "antd";
import { UploadOutlined } from "@ant-design/icons";
import {
  api,
  assetOpenUrl,
  type AdminDataMeta,
  type Row,
} from "../api";
import type { PageKey } from "../registry";
import { asText, fmtTime } from "../helpers";
import RichTextField from "../components/RichTextField";
import { tokens } from "@lcdp/ui";
import { consumeArticleEditorIntent } from "../templates/articleEditorIntent";

/**
 * 文章编辑页 / 写稿面（第 58 步专做，内容领域模版）：专用表单而非 DataAdmin
 * 抽屉——标题/栏目/作者/标签/摘要/正文（富文本）/封面/状态一页写完。
 * 进入方式：工作台「新建文章」/ 行内「编辑全文」经一次性意图带文章 id；
 * 无意图（刷新/深链）即新建模式，页首明示当前模式。
 * 保存走 admindata 新建/更新；标签经 article_tag 关联行对账（本体成功后）。
 * 角色档的字段规则由服务端裁剪（如 editor 的 status 只读）——保存后回读
 * 本体行刷新表单，以服务端实际落库值为准，不假装已改（与 DataAdmin 同口径）。
 */
export default function ArticleEditor({
  appId,
  meta,
  go,
}: {
  appId: string;
  meta: AdminDataMeta;
  go: (key: PageKey) => void;
}) {
  const roles = meta.domainModules?.roles ?? {};
  const articleKey = roles["article"] ?? "article";
  const categoryKey = roles["category"] ?? "category";
  const authorKey = roles["author"] ?? "author";
  const tagKey = roles["tag"] ?? "tag";
  const articleTagKey = roles["article_tag"] ?? "article_tag";

  const articleMeta = meta.entities.find((e) => e.key === articleKey);
  const articleTagMeta = meta.entities.find((e) => e.key === articleTagKey);
  const canCreate = (articleMeta?.actions ?? []).includes("create");
  const canUpdate = (articleMeta?.actions ?? []).includes("update");
  // 标签对账需要 article_tag 的新建 + 删除两动作，缺一即只读呈现
  const tagWritable =
    !!articleTagMeta &&
    articleTagMeta.actions.includes("create") &&
    articleTagMeta.actions.includes("delete");

  const statusOptions = useMemo(() => {
    const f = articleMeta?.fields.find((x) => x.key === "status");
    return (f?.options ?? []).map((o) =>
      typeof o === "string" ? { label: o, value: o } : { label: o.label, value: o.value },
    );
  }, [articleMeta]);

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [articleId, setArticleId] = useState<string | null>(null);
  const [publishedAt, setPublishedAt] = useState<unknown>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<{ label: string; value: string }[]>([]);
  const [authorOptions, setAuthorOptions] = useState<{ label: string; value: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const intent = consumeArticleEditorIntent();
    const editId =
      intent && "articleId" in intent ? intent.articleId : null;
    let alive = true;
    void (async () => {
      try {
        const [cats, authors, tags] = await Promise.all([
          api.adminData.list(appId, categoryKey, { limit: 200 }),
          api.adminData.list(appId, authorKey, { limit: 200 }),
          api.adminData.list(appId, tagKey, { limit: 200 }),
        ]);
        if (!alive) return;
        const toOpts = (rows: Row[]) =>
          rows.map((r) => ({
            label: asText(r.name ?? r.title ?? r.id),
            value: String(r.id),
          }));
        setCategoryOptions(toOpts(cats.rows));
        setAuthorOptions(toOpts(authors.rows));
        setTagOptions(toOpts(tags.rows));
        if (editId) {
          const [row, links] = await Promise.all([
            api.adminData.get(appId, articleKey, editId),
            api.adminData.list(appId, articleTagKey, {
              limit: 200,
              filters: { article_id: editId },
            }),
          ]);
          if (!alive) return;
          setArticleId(editId);
          form.setFieldsValue({
            title: row.title,
            category_id: row.category_id ? String(row.category_id) : undefined,
            author_id: row.author_id ? String(row.author_id) : undefined,
            summary: row.summary,
            content: typeof row.content === "string" ? row.content : "",
            status: row.status,
          });
          setCoverId(row.cover ? String(row.cover) : null);
          setPublishedAt(row.published_at ?? null);
          setTagIds(
            links.rows
              .map((l) => (l.tag_id ? String(l.tag_id) : ""))
              .filter((v) => v !== ""),
          );
        } else {
          // 新建模式：状态预填草稿（在 options 内时），其余由服务端默认值兜底
          if (statusOptions.some((o) => o.value === "草稿")) {
            form.setFieldsValue({ status: "草稿" });
          }
        }
      } catch (err) {
        if (alive) {
          message.error(err instanceof Error ? err.message : "加载文章失败");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const uploadCover = async (file: File) => {
    setCoverUploading(true);
    try {
      const metaRes = await api.assets.upload(file, appId, "public");
      setCoverId(metaRes.id);
      message.success("封面已上传");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  };

  const save = async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      const put = (k: string, v: unknown) => {
        if (v !== undefined && v !== null && v !== "") body[k] = v;
      };
      put("title", values.title);
      put("category_id", values.category_id);
      put("author_id", values.author_id);
      put("summary", values.summary);
      put("content", values.content);
      put("status", values.status);
      if (coverId) body.cover = coverId;
      else if (articleId) body.cover = null;

      let id = articleId;
      let stripped: string[] = [];
      if (id) {
        const res = await api.adminData.update(appId, articleKey, id, body);
        stripped = res.strippedFields;
      } else {
        const res = await api.adminData.create(appId, articleKey, body);
        id = String(res.row.id);
        stripped = res.strippedFields;
        setArticleId(id);
      }
      // 第 65 步：被字段权限剔除的字段如实提示（随后的回读刷新也会以落库值显形）
      if (stripped.length) {
        const labels = stripped.map(
          (k) => articleMeta?.fields.find((f) => f.key === k)?.label ?? k,
        );
        message.warning(`以下字段不在你的可写范围内，未保存：${labels.join("、")}`);
      }

      // 标签对账（本体保存成功后）：补建缺失关联、删除多余关联
      if (tagWritable && id) {
        const links = await api.adminData.list(appId, articleTagKey, {
          limit: 200,
          filters: { article_id: id },
        });
        const existing = new Map<string, string>(); // tag_id -> 关联行 id
        for (const l of links.rows) {
          if (l.tag_id) existing.set(String(l.tag_id), String(l.id));
        }
        const want = new Set(tagIds);
        for (const [tid, linkId] of existing) {
          if (!want.has(tid)) await api.adminData.remove(appId, articleTagKey, linkId);
        }
        for (const tid of want) {
          if (!existing.has(tid)) {
            await api.adminData.create(appId, articleTagKey, {
              article_id: id,
              tag_id: tid,
            });
          }
        }
      }

      // 回读本体行刷新表单：以服务端实际落库值为准（字段规则裁剪在此显形）
      if (id) {
        const fresh = await api.adminData.get(appId, articleKey, id);
        form.setFieldsValue({
          title: fresh.title,
          category_id: fresh.category_id ? String(fresh.category_id) : undefined,
          author_id: fresh.author_id ? String(fresh.author_id) : undefined,
          summary: fresh.summary,
          content: typeof fresh.content === "string" ? fresh.content : "",
          status: fresh.status,
        });
        setCoverId(fresh.cover ? String(fresh.cover) : null);
        setPublishedAt(fresh.published_at ?? null);
      }
      message.success("已保存（操作已记入审计）");
      go("content-workbench");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!articleMeta) {
    return (
      <Alert
        type="warning"
        showIcon
        message="当前应用没有文章实体"
        description="文章编辑页依赖内容领域骨架的 article 锚点实体，映射不健康时不可用。"
      />
    );
  }
  if (loading) {
    return (
      <Card>
        <Spin tip="加载中…" />
      </Card>
    );
  }

  const editing = articleId !== null;
  const readOnly = editing ? !canUpdate : !canCreate;

  return (
    <Card
      title={editing ? `编辑文章 · ${articleId}` : "新建文章"}
      extra={
        <Space>
          <Button onClick={() => go("content-workbench")}>返回工作台</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={readOnly}
            onClick={() => void save()}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          {editing
            ? "当前模式：编辑已有文章。保存后回读服务端落库值刷新表单（状态等字段按你的数据权限裁剪）。"
            : "当前模式：新建文章。填写后保存即落库，状态流转仍可在文章工作台或流程待办中处理。"}
        </Typography.Text>
        {readOnly && (
          <Alert
            type="info"
            showIcon
            message={
              editing
                ? "你对文章只有读取权限，本页只读呈现（保存按钮已禁用）。"
                : "你没有新建文章的权限，本页只读呈现（保存按钮已禁用）。"
            }
          />
        )}
        <Form form={form} layout="vertical" disabled={readOnly}>
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: "请填写标题" }]}
          >
            <Input placeholder="文章标题" />
          </Form.Item>
          <AntRow gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="category_id"
                label="栏目"
                rules={[{ required: true, message: "请选择栏目" }]}
              >
                <Select options={categoryOptions} placeholder="选择栏目" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="author_id" label="作者">
                <Select allowClear options={authorOptions} placeholder="选择作者（可空）" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="status" label="状态">
                <Select options={statusOptions} placeholder="选择状态" />
              </Form.Item>
            </Col>
          </AntRow>
          <Form.Item label="标签">
            <Select
              mode="multiple"
              value={tagIds}
              onChange={(v: string[]) => setTagIds(v)}
              options={tagOptions}
              disabled={!tagWritable || readOnly}
              placeholder="选择标签"
              style={{ width: "100%" }}
            />
            {!tagWritable && (
              <Typography.Text type="secondary">
                标签关联实体（article_tag）在你的数据权限内不可写，标签只读呈现。
              </Typography.Text>
            )}
          </Form.Item>
          <Form.Item name="summary" label="摘要">
            <Input.TextArea rows={3} placeholder="文章摘要（可空）" />
          </Form.Item>
          <Form.Item name="content" label="正文">
            <RichTextField appId={appId} height={420} readOnly={readOnly} />
          </Form.Item>
          <Form.Item label="封面">
            <Space direction="vertical" size="small">
              {coverId && (
                <img
                  src={assetOpenUrl(`/assets/${coverId}/content`)}
                  alt="封面预览"
                  style={{ maxWidth: 260, borderRadius: 6, border: `1px solid ${tokens.colorBorder}` }}
                />
              )}
              <Space>
                <Upload
                  showUploadList={false}
                  accept="image/*"
                  beforeUpload={(file) => {
                    void uploadCover(file);
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={coverUploading} disabled={readOnly}>
                    上传封面
                  </Button>
                </Upload>
                {coverId && (
                  <>
                    <a
                      href={assetOpenUrl(`/assets/${coverId}/content`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开原图
                    </a>
                    <Button
                      type="link"
                      danger
                      disabled={readOnly}
                      onClick={() => setCoverId(null)}
                    >
                      清除封面
                    </Button>
                  </>
                )}
              </Space>
              <Typography.Text type="secondary">
                封面以公开可见登记（官网直显）；未上传时文章无封面。
              </Typography.Text>
            </Space>
          </Form.Item>
          <Form.Item label="发布时间">
            <Typography.Text>
              {publishedAt ? fmtTime(publishedAt) : "—（由发布动作写入，只读）"}
            </Typography.Text>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  );
}
