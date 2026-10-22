import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type Row } from "../api";
import { asText, fmtTime } from "../helpers";
import type { PageContext } from "../registry";
import { tokens } from "@lcdp/ui";
import Designer from "../designer/Designer";
import CreateAppModal from "../designer/CreateAppModal";
import WizardDrawer from "../designer/Wizard";

/** 领域 key → 展示名（与 AppThemeSettings 的 DOMAIN_LABEL 同步） */
const DOMAIN_LABEL: Record<string, string> = {
  content: "内容",
  commerce: "商城",
  forum: "论坛",
  support: "客服",
  oa: "审批协同",
  generic: "空白",
};

/**
 * 应用管理（平台页）：应用总览 + 启用/停用（第 68 步：入口装配模型
 * 退役后，域名/主应用都是应用自身字段；第 75 步列表优化：加应用名称与
 * 领域模型列、去掉访问形态列、场景列改创建时间列、状态即开关——拨动经确认后落盘，停用后
 * 运行态全拒绝 403 app_disabled）。主应用以「是/否」开关呈现（拨开经
 * 确认后 PUT /admin/apps/:id/site 落盘；当前主应用不可关闭——主应用
 * 只能改设、不能取消；目标应用绑有专属域名时服务端拒绝、须先在该
 * 应用设置里解绑）。单应用的域名/应用别名维护在应用区「应用设置 ·
 * 域名」页签。
 *
 * 第 89 步：创建入口收进本页——「新建应用」（普通创建）与「向导创建」
 * 两按钮（仅平台管理员呈现）；创建成功后先刷新外壳上下文再切换当前
 * 应用为新应用（归位校验按可运营集判定，顺序不可反）。行操作「设计」
 * 以全屏覆盖层打开设计器（作用域锁定该行应用，关闭回本页原位）；
 * 「删除」须输入应用 ID 全文一致才可提交（服务端级联删除、审计留痕）。
 */
export default function Apps({ ctx }: { ctx: PageContext }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 设计器覆盖层当前设计的应用 id（null = 未打开） */
  const [designing, setDesigning] = useState<string | null>(null);
  /** 普通创建对话框 */
  const [createOpen, setCreateOpen] = useState(false);
  /** 创建向导抽屉（宿主挂载，designer 模块的 WizardDrawer） */
  const [wizardOpen, setWizardOpen] = useState(false);
  /** 删除确认：目标行 + 输入的应用 ID 全文 */
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.apps.list());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载应用失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 应用创建成功后的统一接线（普通创建与向导创建共用）：先刷新外壳
   * 上下文（grants + 应用清单落定）再切换当前应用——反过来会被归位
   * 校验按旧可运营集弹回。
   */
  const afterAppCreated = useCallback(
    async (appId: string) => {
      await ctx.refreshContext();
      ctx.switchApp(appId);
    },
    [ctx],
  );

  const toggle = (row: Row, next: boolean) => {
    const id = String(row.id);
    const status = next ? "active" : "disabled";
    Modal.confirm({
      title: next ? "启用应用" : "停用应用",
      content: next
        ? `确认启用应用 ${id}？运行态将重新可访问。`
        : `确认停用应用 ${id}？停用后运行态入口、数据、流程、助手与公开页将全部拒绝访问（403 app_disabled）；设计态与管理台不受影响。操作会写入审计。`,
      okText: next ? "启用" : "停用",
      okButtonProps: next ? {} : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusyId(id);
        try {
          await api.apps.setStatus(id, status);
          message.success(next ? "已启用" : "已停用");
          void load();
        } catch (err) {
          message.error(err instanceof Error ? err.message : "操作失败");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const setPrimary = (row: Row) => {
    const id = String(row.id);
    Modal.confirm({
      title: "设为主应用",
      content: `确认把应用 ${id} 设为主应用？主应用占据默认域名的根路径，原主应用随即让位。若该应用已绑定专属域名，须先解绑后才能设置。操作会写入审计。`,
      okText: "设为主应用",
      cancelText: "取消",
      onOk: async () => {
        setBusyId(id);
        try {
          await api.site.update(id, { isPrimary: true });
          message.success(`已设为主应用：${id}`);
          void load();
        } catch (err) {
          // 后端口径错误（已绑专属域名须先解绑等）原文呈现
          message.error(err instanceof Error ? err.message : "设置失败");
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const doDelete = async () => {
    if (!deleteRow) return;
    const id = String(deleteRow.id);
    setDeleting(true);
    try {
      await api.apps.remove(id);
      message.success(`已删除应用 ${id}`);
      setDeleteRow(null);
      setDeleteText("");
      // 删的若是当前上下文应用：刷新后可运营集不再含它，外壳归位自动兜底
      await ctx.refreshContext();
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const columns: ColumnsType<Row> = [
    {
      title: "编号",
      dataIndex: "appNo",
      width: 70,
      render: (v) => (v === null || v === undefined ? "—" : asText(v)),
    },
    { title: "应用 ID", dataIndex: "id", render: (v) => asText(v) },
    {
      title: "应用名称",
      dataIndex: "name",
      render: (v) => asText(v) || "—",
    },
    {
      title: "领域模型",
      dataIndex: "domain",
      render: (v) => {
        const key = asText(v);
        if (!key) return "—";
        const label = DOMAIN_LABEL[key];
        return label ? `${label}（${key}）` : key;
      },
    },
    { title: "租户", dataIndex: "tenant_id", render: (v, r) => asText(v ?? r.tenantId) },
    {
      // 第 75 步续：场景列（来源标记、仅 setup 播种的应用有值）去掉，
      // 改显应用创建时间（服务端按审计/版本证据回填、fmtTime 统一格式）。
      title: "创建时间",
      render: (_, r) => fmtTime(r.createdAt ?? r.created_at),
    },
    {
      title: "当前版本",
      render: (_, r) => {
        const v = r.current_version ?? r.currentVersion;
        return v === null || v === undefined ? "未发布" : `v${asText(v)}`;
      },
    },
    {
      title: "主应用",
      width: 110,
      render: (_, r) => (
        <Switch
          checked={!!r.isPrimary}
          // 当前主应用不可关（只能改设到别的应用）；改设走确认弹窗
          disabled={!!r.isPrimary}
          loading={busyId === String(r.id)}
          checkedChildren="是"
          unCheckedChildren="否"
          onChange={(next) => {
            if (next) setPrimary(r);
          }}
        />
      ),
    },
    {
      title: "状态",
      width: 110,
      render: (_, r) => (
        <Switch
          checked={asText(r.status ?? "active") !== "disabled"}
          loading={busyId === String(r.id)}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={(next) => toggle(r, next)}
        />
      ),
    },
    ...(ctx.isAdmin
      ? [
          {
            title: "操作",
            width: 130,
            render: (_: unknown, r: Row) => (
              <Space size={4}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setDesigning(String(r.id))}
                >
                  设计
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => {
                    setDeleteText("");
                    setDeleteRow(r);
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          } as ColumnsType<Row>[number],
        ]
      : []),
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card
        title="应用管理"
        extra={
          ctx.isAdmin ? (
            <Space>
              <Button type="primary" onClick={() => setCreateOpen(true)}>
                新建应用
              </Button>
              <Button onClick={() => setWizardOpen(true)}>向导创建</Button>
            </Space>
          ) : undefined
        }
      >
        <Table
          rowKey={(r) => String(r.id)}
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
      </Card>

      <CreateAppModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(app) => {
          void (async () => {
            await afterAppCreated(app.id);
            setDesigning(app.id);
          })();
        }}
      />

      <WizardDrawer
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onAppCreated={(appId) => {
          void afterAppCreated(appId);
        }}
        onEnterDesigner={(appId) => {
          setWizardOpen(false);
          setDesigning(appId);
        }}
      />

      <Modal
        title="删除应用"
        open={deleteRow !== null}
        onOk={() => void doDelete()}
        onCancel={() => {
          setDeleteRow(null);
          setDeleteText("");
        }}
        okText="删除"
        okButtonProps={{
          danger: true,
          disabled:
            deleteRow === null || deleteText !== String(deleteRow.id),
        }}
        confirmLoading={deleting}
        cancelText="取消"
        destroyOnClose
      >
        <p>
          确认删除应用 <strong>{deleteRow ? String(deleteRow.id) : ""}</strong>
          ？设计、数据、流程、授权与资产将被级联删除（审计留痕），此操作不可恢复。
        </p>
        <p>请输入应用 ID 全文以确认：</p>
        <Input
          value={deleteText}
          onChange={(e) => setDeleteText(e.target.value)}
          placeholder={deleteRow ? String(deleteRow.id) : ""}
        />
      </Modal>

      {designing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 900,
            background: tokens.colorBgLayout,
          }}
        >
          <Designer
            appId={designing}
            user={ctx.user}
            onClose={() => {
              setDesigning(null);
              // 关闭回本页：刷新列表反映设计器内的发布/改名等变化，
              // 页面不卸载、滚动位置保持
              void load();
            }}
            onOpenWizard={() => {
              setDesigning(null);
              setWizardOpen(true);
            }}
          />
        </div>
      )}
    </Space>
  );
}
