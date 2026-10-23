import { useEffect, useMemo, useState } from "react";
import { Alert, Checkbox, Form, Input, Modal, Select, Typography } from "antd";
import type { AppInfo, DomainInfo } from "./api.js";
import { api } from "./api.js";
import { errText } from "@lcdp/ui";

/**
 * 普通创建应用对话框（第 89 步自设计台 AppsView 迁出为 designer 模块导出件，
 * 管理台应用管理页等宿主共用）：id / 名称 / 主领域 / 样板勾选 → api.createApp。
 * 成功后 onCreated(app) 回宿主（宿主负责刷新上下文、切换当前应用、打开设计器），
 * 本组件随后自行关闭。
 */
export default function CreateAppModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (app: AppInfo) => void;
}) {
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newAppId, setNewAppId] = useState("");
  const [newAppName, setNewAppName] = useState("");
  /** 主领域选择：默认空白领域；有骨架的领域创建即落骨架草稿（M15） */
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [newAppDomain, setNewAppDomain] = useState("generic");
  /** 样板库型领域（如 OA）：建应用时勾选整束装配的样板 key 列表 */
  const [newAppTemplates, setNewAppTemplates] = useState<string[]>([]);

  const selectedDomain = domains.find((d) => d.key === newAppDomain);
  const templateGroups = useMemo(() => {
    const groups: { category: string; items: NonNullable<DomainInfo["templates"]> }[] = [];
    for (const t of selectedDomain?.templates ?? []) {
      const g = groups.find((x) => x.category === t.category);
      if (g) g.items.push(t);
      else groups.push({ category: t.category, items: [t] });
    }
    return groups;
  }, [selectedDomain]);

  // 每次打开复位表单并拉领域清单（与旧设计台「点新建才清错误/样板」同口径）
  useEffect(() => {
    if (!open) return;
    setCreateError(null);
    setNewAppId("");
    setNewAppName("");
    setNewAppDomain("generic");
    setNewAppTemplates([]);
    api
      .domains()
      .then(setDomains)
      .catch((err) => setCreateError(errText(err)));
  }, [open ]);

  const submitCreate = async () => {
    setCreateBusy(true);
    setCreateError(null);
    try {
      const app = await api.createApp(
        newAppId.trim(),
        newAppName.trim(),
        newAppDomain,
        templateGroups.length > 0 ? newAppTemplates : undefined,
      );
      onCreated(app);
      onClose();
    } catch (err) {
      setCreateError(errText(err));
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <Modal
      title="新建应用"
      open={open}
      onOk={() => void submitCreate()}
      onCancel={onClose}
      confirmLoading={createBusy}
      okText="创建并进入设计器"
      cancelText="取消"
      destroyOnClose
    >
      <Form layout="vertical">
        <Form.Item label="应用 id（小写字母开头，仅小写字母与数字，创建后不可改）" required>
          <Input
            value={newAppId}
            onChange={(e) => setNewAppId(e.target.value)}
            placeholder="如 oa2"
          />
        </Form.Item>
        <Form.Item label="应用名称" required>
          <Input
            value={newAppName}
            onChange={(e) => setNewAppName(e.target.value)}
            placeholder="如 星桥科技官网"
          />
        </Form.Item>
        <Form.Item label="主领域（创建后不可变更；选择带预置模型的领域将自动生成数据模型、页面与权限草稿）">
          <Select
            value={newAppDomain}
            onChange={(v) => {
              setNewAppDomain(v);
              setNewAppTemplates([]);
            }}
            options={domains.map((d) => ({
              value: d.key,
              disabled: !d.available,
              label: d.available
                ? `${d.name}领域${d.skeleton ? `（预置模型 ${d.skeleton}）` : ""}`
                : `${d.name}领域（预置模型打磨中）`,
            }))}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {domains.find((d) => d.key === newAppDomain)?.description ?? ""}
          </Typography.Text>
        </Form.Item>
        {templateGroups.length > 0 && (
          <Form.Item label="单据仓库（勾选的单据将整套加入应用：实体 + 审批流 + 页面 + 权限；未勾选不加入）">
            {templateGroups.map((g) => (
              <div key={g.category} style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {g.category}
                </Typography.Text>
                <div>
                  {g.items.map((t) => (
                    <div key={t.key}>
                      <Checkbox
                        checked={newAppTemplates.includes(t.key)}
                        onChange={(e) =>
                          setNewAppTemplates((prev) =>
                            e.target.checked
                              ? [...prev, t.key]
                              : prev.filter((k) => k !== t.key),
                          )
                        }
                      >
                        {t.name}
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                          {t.description}
                        </Typography.Text>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Form.Item>
        )}
        {createError && <Alert type="error" message={createError} />}
      </Form>
    </Modal>
  );
}
