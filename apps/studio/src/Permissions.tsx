import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from "antd";
import { errText, fmtTime } from "@lcdp/ui";
import type { FormInstance } from "antd";
import type {
  DataSchema,
  EntityAccess,
  FieldRule,
  PageSchema,
  PermissionSchema,
  RolePermission,
  RowRule,
} from "@naka1205/schema";
import type { AdminUser, Submission } from "./api.js";
import type { Row } from "@lcdp/renderer";
import { api } from "./api.js";

/**
 * 权限页签（M4，契约 §7）：角色与用户管理 / 权限矩阵（含行级与字段规则）/
 * 菜单可见 / 公开策略 / 公开表单待审区。
 * 权限配置属于设计包的一部分：改动只改本地 bundle（经 onChange 标脏），
 * 走设计台既有「保存草稿 → 发布」流，服务端在存草稿/发布时做 validatePermissions 校验。
 * 用户管理与待审处理则是即时生效的平台接口，不进草稿。
 */

type PermAction = EntityAccess["actions"][number];
type FieldAccess = FieldRule["access"];
type AccessLevel = "none" | "read" | "edit" | "all";

const ACTIONS_BY_LEVEL: Record<AccessLevel, PermAction[]> = {
  none: [],
  read: ["read"],
  edit: ["read", "create", "update"],
  all: ["read", "create", "update", "delete"],
};

const LEVEL_OPTIONS: { value: AccessLevel; label: string }[] = [
  { value: "none", label: "无权限" },
  { value: "read", label: "只读" },
  { value: "edit", label: "可新建编辑" },
  { value: "all", label: "全部（含删除）" },
];

function levelOf(actions: PermAction[]): AccessLevel {
  if (!actions.includes("read")) return "none";
  if (actions.includes("delete")) return "all";
  if (actions.includes("create") || actions.includes("update")) return "edit";
  return "read";
}

const FIELD_ACCESS_OPTIONS: { value: FieldAccess | "default"; label: string }[] = [
  { value: "default", label: "默认（脱敏）" },
  { value: "masked", label: "脱敏" },
  { value: "readwrite", label: "可见（明文）" },
  { value: "readonly", label: "只读" },
  { value: "hidden", label: "隐藏" },
];

const ROW_KIND_OPTIONS: { value: RowRule["kind"]; label: string }[] = [
  { value: "all", label: "全部数据" },
  { value: "ownDepartment", label: "本部门" },
  { value: "own", label: "仅本人" },
];

/**
 * 会员策略（会员试点，本地结构形状）：与平台 memberPolicySchema 同构
 * （pages / readable / writable / owners），studio 不强依赖 schema 新版类型，
 * 读写一律经此形状对 bundle.permissions.member 做结构化访问。
 */
export interface MemberPolicyShape {
  /** 会员可见页面 route 列表 */
  pages: string[];
  /** 会员可读实体 key 列表 */
  readable: string[];
  /** 会员可写（新建/改己行）实体 key 列表 */
  writable: string[];
  /**
   * 会员可写字段白名单（商城线）：实体 key → 允许会员写的字段键数组；
   * 某实体未声明 = 沿用实体级口径（全字段可写）；声明后白名单外字段出现在
   * 写请求里服务端整单拒绝（400 field_not_writable）。
   * TODO(mall-schema-0.10.0): schema 0.10.0 的 memberPolicySchema 落地后与之对齐
   */
  writableFields: Record<string, string[]>;
  /** 归属映射：实体 key → 归属字段 key（行读写强制归属当前会员） */
  owners: Record<string, string>;
  /**
   * 只读全量实体（论坛立项，schema 0.11.0）：列于此的实体即使声明了归属，
   * 会员读取仍见全量行（如论坛主题：人人可读、只改己行），写入仍按归属收口。
   */
  readAll: string[];
  /**
   * 显示名盖章字段（论坛立项，schema 0.11.0）：会员新建行时服务端把会员
   * 显示名（缺省回退登录标识）盖入该字段（如 author_name），免逐行解析作者；
   * 该字段不受字段白名单约束、会员不可自填。
   */
  stampDisplayNameAs?: string;
}

export const EMPTY_MEMBER_POLICY: MemberPolicyShape = {
  pages: [],
  readable: [],
  writable: [],
  writableFields: {},
  owners: {},
  readAll: [],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/* errText 单一实现已收编 @lcdp/ui（第 73 步片二），本文件直接引 ui 版 */

function emptyRolePermission(role: string): RolePermission {
  return { role, menus: [], entityAccess: [], rowRules: [], fieldRules: [] };
}

/** 初始化用的默认权限配置：四类业务角色 + 空授权（契约 §7） */
export function defaultPermissions(appId: string): PermissionSchema {
  const now = new Date().toISOString();
  const roles = [
    { key: "finance", label: "财务" },
    { key: "manager", label: "部门经理" },
    { key: "employee", label: "员工" },
    { key: "warehouse", label: "仓库管理员" },
  ];
  // 会员策略缺省空（会员无任何数据面）；经本地形状并入字面量，兼容 schema 类型新旧版本
  const member: MemberPolicyShape = {
    pages: [],
    readable: [],
    writable: [],
    writableFields: {},
    owners: {},
    readAll: [],
  };
  return {
    id: `${appId}:permissions`,
    kind: "permission",
    version: 1,
    formatVersion: 1,
    name: "权限配置",
    createdAt: now,
    updatedAt: now,
    roles,
    permissions: roles.map((r) => emptyRolePermission(r.key)),
    public: { pages: [], readable: [], forms: [] },
    member,
  } as PermissionSchema;
}

export interface PermissionsProps {
  appId: string;
  data: DataSchema;
  pages: PageSchema[] | null;
  permissions: PermissionSchema | null;
  onChange: (next: PermissionSchema | null) => void;
}

export default function Permissions({
  appId,
  data,
  pages,
  permissions,
  onChange,
}: PermissionsProps) {
  /** 顶层实体（与 PageDesigner 的派生路由口径一致） */
  const topEntities = useMemo(
    () => data.entities.filter((e) => !e.parentField),
    [data],
  );

  /** 全部页面 route（设计页 ∪ 派生页），供菜单可见与公开策略选择 */
  const routeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pages ?? []) seen.set(p.route, `${p.route}（${p.name}）`);
    for (const e of topEntities) {
      if (!seen.has(`/e/${e.key}`))
        seen.set(`/e/${e.key}`, `/e/${e.key}（${e.label}列表·自动）`);
      if (!seen.has(`/e/${e.key}/form`))
        seen.set(`/e/${e.key}/form`, `/e/${e.key}/form（${e.label}表单·自动）`);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [pages, topEntities]);

  const entityOptions = useMemo(
    () =>
      data.entities.map((e) => ({
        value: e.key,
        label: `${e.label}（${e.key}）`,
      })),
    [data],
  );

  const sensitiveFields = useMemo(() => {
    const out: { entity: string; entityLabel: string; field: string; fieldLabel: string }[] = [];
    for (const e of data.entities)
      for (const f of e.fields)
        if (f.sensitive)
          out.push({ entity: e.key, entityLabel: e.label, field: f.key, fieldLabel: f.label });
    return out;
  }, [data]);

  // ---------------------------------------------------------- bundle 变更工具
  const mutate = (fn: (p: PermissionSchema) => void) => {
    if (!permissions) return;
    const next = clone(permissions);
    fn(next);
    next.updatedAt = new Date().toISOString();
    onChange(next);
  };

  const entryOf = (p: PermissionSchema, role: string): RolePermission => {
    let entry = p.permissions.find((x) => x.role === role);
    if (!entry) {
      entry = emptyRolePermission(role);
      p.permissions.push(entry);
    }
    return entry;
  };

  const entryFor = (role: string): RolePermission | undefined =>
    permissions?.permissions.find((x) => x.role === role);

  const setAccessLevel = (role: string, entity: string, level: AccessLevel) =>
    mutate((p) => {
      const entry = entryOf(p, role);
      entry.entityAccess = entry.entityAccess.filter((a) => a.entity !== entity);
      if (level !== "none") {
        entry.entityAccess.push({ entity, actions: [...ACTIONS_BY_LEVEL[level]] });
      } else {
        entry.rowRules = entry.rowRules.filter((r) => r.entity !== entity);
      }
    });

  const setRowRule = (role: string, entity: string, kind: RowRule["kind"]) =>
    mutate((p) => {
      const entry = entryOf(p, role);
      const ent = data.entities.find((e) => e.key === entity);
      const existing = entry.rowRules.find((r) => r.entity === entity);
      entry.rowRules = entry.rowRules.filter((r) => r.entity !== entity);
      if (kind === "all") return;
      const fieldValid = (f?: string) =>
        !!f && !!ent?.fields.some((x) => x.key === f);
      let field: string | undefined =
        existing && fieldValid(existing.field) ? existing.field : undefined;
      if (!field && ent) {
        field =
          kind === "ownDepartment"
            ? (ent.fields.find((f) => f.type === "ref" && f.refEntity === "department") ??
                ent.fields.find((f) => f.type === "ref"))?.key
            : ent.fields.find((f) => f.type === "string")?.key;
      }
      const rule: RowRule = { entity, kind };
      if (field) rule.field = field;
      entry.rowRules.push(rule);
    });

  const setRowRuleField = (role: string, entity: string, field: string) =>
    mutate((p) => {
      const rule = entryOf(p, role).rowRules.find((r) => r.entity === entity);
      if (rule) rule.field = field;
    });

  const setFieldRule = (
    role: string,
    entity: string,
    field: string,
    access: FieldAccess | "default",
  ) =>
    mutate((p) => {
      const entry = entryOf(p, role);
      entry.fieldRules = entry.fieldRules.filter(
        (r) => !(r.entity === entity && r.field === field),
      );
      if (access !== "default") entry.fieldRules.push({ entity, field, access });
    });

  const setMenus = (role: string, menus: string[]) =>
    mutate((p) => {
      entryOf(p, role).menus = menus;
    });

  // ---------------------------------------------------------- 会员策略（本地形状读写）
  const memberPolicy: MemberPolicyShape = useMemo(() => {
    const raw = (
      permissions as { member?: Partial<MemberPolicyShape> } | null
    )?.member;
    return {
      pages: raw?.pages ?? [],
      readable: raw?.readable ?? [],
      writable: raw?.writable ?? [],
      writableFields: raw?.writableFields ?? {},
      owners: raw?.owners ?? {},
      readAll: raw?.readAll ?? [],
      stampDisplayNameAs: raw?.stampDisplayNameAs,
    };
  }, [permissions]);

  const setMemberPolicy = (next: MemberPolicyShape) =>
    mutate((p) => {
      (p as unknown as { member: MemberPolicyShape }).member = next;
    });

  const setMemberOwners = (owners: Record<string, string>) =>
    setMemberPolicy({ ...memberPolicy, owners });

  // ---------------------------------------------------------- 角色增删
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleForm] = Form.useForm<{ key: string; label: string }>();

  const addRole = async () => {
    const v = await roleForm.validateFields().catch(() => null);
    if (!v) return;
    const key = v.key.trim();
    if (!key) return;
    if (key === "admin" || permissions?.roles.some((r) => r.key === key)) {
      void antdMessage.error(`角色 key「${key}」已存在或为内置保留`);
      return;
    }
    mutate((p) => {
      p.roles.push({ key, label: v.label.trim() || key });
      entryOf(p, key);
    });
    setRoleModalOpen(false);
    roleForm.resetFields();
  };

  const removeRole = (roleKey: string) =>
    mutate((p) => {
      p.roles = p.roles.filter((r) => r.key !== roleKey);
      p.permissions = p.permissions.filter((x) => x.role !== roleKey);
    });

  // ---------------------------------------------------------- 用户管理（即时接口）
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [deptRows, setDeptRows] = useState<Row[]>([]);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [userForm] = Form.useForm<{
    username: string;
    password: string;
    displayName?: string;
    role: string;
    departmentId?: string;
  }>();
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null);
  const [pwdForm] = Form.useForm<{ password: string }>();

  const hasDepartmentEntity = data.entities.some((e) => e.key === "department");

  const loadUsers = useCallback(async () => {
    setUsersError(null);
    try {
      setUsers(await api.adminUsers());
    } catch (err) {
      setUsersError(errText(err));
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!hasDepartmentEntity) return;
    api
      .dataList(appId, "department", { limit: 200 })
      .then((res) => setDeptRows(res.rows))
      .catch(() => setDeptRows([]));
  }, [appId, hasDepartmentEntity]);

  const deptOptions = useMemo(
    () =>
      deptRows.map((r) => ({
        value: String(r.id),
        label: typeof r.name === "string" && r.name ? r.name : String(r.id),
      })),
    [deptRows],
  );

  const roleSelectOptions = useMemo(
    () => [
      { value: "admin", label: "管理员（admin · 内置全权）" },
      ...(permissions?.roles ?? []).map((r) => ({
        value: r.key,
        label: `${r.label}（${r.key}）`,
      })),
    ],
    [permissions],
  );

  const patchUser = async (id: string, patch: Parameters<typeof api.updateUser>[1]) => {
    try {
      const updated = await api.updateUser(id, patch);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      void antdMessage.success("已更新");
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  };

  const createUser = async () => {
    const v = await userForm.validateFields().catch(() => null);
    if (!v) return;
    try {
      const created = await api.createUser({
        username: v.username.trim(),
        password: v.password,
        role: v.role,
        displayName: v.displayName?.trim() || undefined,
        departmentId: v.departmentId || undefined,
      });
      setUsers((prev) => [...prev, created]);
      setUserModalOpen(false);
      userForm.resetFields();
      void antdMessage.success(`用户「${created.username}」已创建`);
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  };

  const resetPassword = async () => {
    const v = await pwdForm.validateFields().catch(() => null);
    if (!v || !pwdTarget) return;
    try {
      await api.updateUser(pwdTarget.id, { password: v.password });
      setPwdTarget(null);
      pwdForm.resetFields();
      void antdMessage.success(`已重置「${pwdTarget.username}」的密码`);
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  };

  // ---------------------------------------------------------- 待审区（即时接口）
  const [subStatus, setSubStatus] = useState<Submission["status"] | undefined>("pending");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subsError, setSubsError] = useState<string | null>(null);

  const loadSubmissions = useCallback(async () => {
    setSubsError(null);
    try {
      setSubmissions(await api.submissions(appId, subStatus));
    } catch (err) {
      setSubsError(errText(err));
    }
  }, [appId, subStatus]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  const reviewSubmission = async (sub: Submission, approve: boolean) => {
    try {
      if (approve) await api.approveSubmission(appId, sub.id);
      else await api.rejectSubmission(appId, sub.id);
      void antdMessage.success(approve ? "已采纳并写入业务数据" : "已驳回");
      await loadSubmissions();
    } catch (err) {
      void antdMessage.error(errText(err));
    }
  };

  // ---------------------------------------------------------- 渲染
  if (!permissions) {
    return (
      <div style={{ padding: 24, maxWidth: 860 }}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          权限配置
        </Typography.Title>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="本应用尚未建立权限配置"
          description="未发布权限配置时，运行态沿用旧行为：登录用户全权、敏感字段对非管理员脱敏。初始化后可按角色配置菜单、实体动作、行级与字段规则以及公开（匿名）策略；配置随设计包一同保存草稿与发布。"
        />
        <Button type="primary" onClick={() => onChange(defaultPermissions(appId))}>
          初始化权限配置
        </Button>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
          将生成默认四类角色（财务 / 部门经理 / 员工 / 仓库管理员）与空授权，后续在下方各区逐项配置。
        </Typography.Paragraph>
        <UsersSection
          users={users}
          usersError={usersError}
          roleSelectOptions={roleSelectOptions}
          deptOptions={hasDepartmentEntity ? deptOptions : null}
          onReload={() => void loadUsers()}
          onCreate={() => setUserModalOpen(true)}
          onPatch={(id, patch) => void patchUser(id, patch)}
          onResetPassword={setPwdTarget}
          onDelete={(u) =>
            api
              .deleteUser(u.id)
              .then(() => {
                setUsers((prev) => prev.filter((x) => x.id !== u.id));
                void antdMessage.success(`用户「${u.username}」已删除`);
              })
              .catch((err) => void antdMessage.error(errText(err)))
          }
        />
        <SubmissionsSection
          submissions={submissions}
          subsError={subsError}
          subStatus={subStatus}
          onStatusChange={setSubStatus}
          onReload={() => void loadSubmissions()}
          onReview={(s, ok) => void reviewSubmission(s, ok)}
          entityLabel={(key) => data.entities.find((e) => e.key === key)?.label ?? key}
        />
        {userModalOpen && (
          <UserCreateModal
            form={userForm}
            roleSelectOptions={roleSelectOptions}
            deptOptions={hasDepartmentEntity ? deptOptions : null}
            onCancel={() => setUserModalOpen(false)}
            onOk={() => void createUser()}
          />
        )}
        {pwdTarget && (
          <PasswordModal
            form={pwdForm}
            username={pwdTarget.username}
            onCancel={() => setPwdTarget(null)}
            onOk={() => void resetPassword()}
          />
        )}
      </div>
    );
  }

  const roles = permissions.roles;

  return (
    <div style={{ padding: 24, maxWidth: 1180 }}>
      {/* ------------------------------------------------ 区块一：角色与用户 */}
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        角色与用户
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        管理员（admin）为内置全权角色，不参与矩阵配置。业务角色在此增删，用户的角色与部门归属即时生效（不随草稿发布）。
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        style={{ maxWidth: 560, marginBottom: 8 }}
        dataSource={[{ key: "admin", label: "管理员" }, ...roles]}
        columns={[
          {
            title: "角色 key",
            dataIndex: "key",
            width: 180,
            render: (k: string) =>
              k === "admin" ? (
                <span>
                  admin <Tag color="blue">内置</Tag>
                </span>
              ) : (
                k
              ),
          },
          {
            title: "显示名",
            render: (_, r) =>
              r.key === "admin" ? (
                "管理员"
              ) : (
                <Input
                  size="small"
                  style={{ width: 180 }}
                  defaultValue={r.label}
                  key={`${r.key}-${r.label}`}
                  onBlur={(ev) => {
                    const label = ev.target.value.trim();
                    if (label && label !== r.label)
                      mutate((p) => {
                        const role = p.roles.find((x) => x.key === r.key);
                        if (role) role.label = label;
                      });
                  }}
                />
              ),
          },
          {
            title: "操作",
            width: 90,
            render: (_, r) =>
              r.key === "admin" ? (
                <Typography.Text type="secondary">全权</Typography.Text>
              ) : (
                <Popconfirm
                  title={`删除角色「${r.label}」？`}
                  description="该角色的全部授权条目将一并从草稿中移除（保存草稿后生效）；使用该角色的用户需另行改派。"
                  onConfirm={() => removeRole(r.key)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
      <Button size="small" onClick={() => setRoleModalOpen(true)} style={{ marginBottom: 20 }}>
        新增角色
      </Button>

      <UsersSection
        users={users}
        usersError={usersError}
        roleSelectOptions={roleSelectOptions}
        deptOptions={hasDepartmentEntity ? deptOptions : null}
        onReload={() => void loadUsers()}
        onCreate={() => setUserModalOpen(true)}
        onPatch={(id, patch) => void patchUser(id, patch)}
        onResetPassword={setPwdTarget}
        onDelete={(u) =>
          api
            .deleteUser(u.id)
            .then(() => {
              setUsers((prev) => prev.filter((x) => x.id !== u.id));
              void antdMessage.success(`用户「${u.username}」已删除`);
            })
            .catch((err) => void antdMessage.error(errText(err)))
        }
      />

      {/* ------------------------------------------------ 区块二：权限矩阵 */}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        权限矩阵
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        行 = 实体，列 = 角色。展开实体行可为「只读以上」的角色设置行级数据范围；行级选「本部门」需指定部门引用字段，选「仅本人」需指定归属字段（行值与用户显示名比对）。
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="key"
        pagination={false}
        dataSource={data.entities}
        expandable={{
          expandedRowRender: (entity) => {
            const scoped = roles.filter((r) => {
              const a = entryFor(r.key)?.entityAccess.find((x) => x.entity === entity.key);
              return a && levelOf(a.actions) !== "none";
            });
            if (scoped.length === 0)
              return (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  暂无角色对该实体有读取以上权限，设置权限后可在此配置行级范围。
                </Typography.Text>
              );
            const refFields = entity.fields.filter((f) => f.type === "ref");
            const ownFields = entity.fields.filter((f) => f.type === "string");
            return (
              <Space direction="vertical" size={6} style={{ display: "flex" }}>
                {scoped.map((r) => {
                  const rule = entryFor(r.key)?.rowRules.find((x) => x.entity === entity.key);
                  const kind = rule?.kind ?? "all";
                  return (
                    <Space key={r.key} size={10} wrap>
                      <Typography.Text style={{ width: 110 }}>
                        {r.label} · 行级范围
                      </Typography.Text>
                      <Select
                        size="small"
                        style={{ width: 130 }}
                        value={kind}
                        options={ROW_KIND_OPTIONS}
                        onChange={(v) => setRowRule(r.key, entity.key, v)}
                      />
                      {kind === "ownDepartment" && (
                        <Select
                          size="small"
                          style={{ width: 220 }}
                          placeholder="选择部门引用字段"
                          value={rule?.field}
                          options={refFields.map((f) => ({
                            value: f.key,
                            label: `${f.label}（${f.key}）`,
                          }))}
                          onChange={(v) => setRowRuleField(r.key, entity.key, v)}
                        />
                      )}
                      {kind === "own" && (
                        <Select
                          size="small"
                          style={{ width: 220 }}
                          placeholder="选择归属字段"
                          value={rule?.field}
                          options={ownFields.map((f) => ({
                            value: f.key,
                            label: `${f.label}（${f.key}）`,
                          }))}
                          onChange={(v) => setRowRuleField(r.key, entity.key, v)}
                        />
                      )}
                    </Space>
                  );
                })}
              </Space>
            );
          },
        }}
        columns={[
          {
            title: "实体",
            width: 190,
            render: (_, e) => (
              <span>
                {e.label}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {" "}
                  {e.key}
                </Typography.Text>
              </span>
            ),
          },
          ...roles.map((r) => ({
            title: r.label,
            key: r.key,
            render: (_: unknown, e: (typeof data.entities)[number]) => {
              const a = entryFor(r.key)?.entityAccess.find((x) => x.entity === e.key);
              return (
                <Select
                  size="small"
                  style={{ width: 132 }}
                  value={levelOf(a?.actions ?? [])}
                  options={LEVEL_OPTIONS}
                  onChange={(v: AccessLevel) => setAccessLevel(r.key, e.key, v)}
                />
              );
            },
          })),
        ]}
      />

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        字段规则（敏感字段）
      </Typography.Title>
      {sensitiveFields.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          当前数据模型没有标记为敏感的字段。在「数据模型」页签把字段的「敏感」开关打开后，这里可按角色细化其可见性；未设规则的敏感字段默认对非管理员脱敏。
        </Typography.Paragraph>
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.entity}.${r.field}`}
          pagination={false}
          dataSource={sensitiveFields}
          columns={[
            {
              title: "敏感字段",
              width: 260,
              render: (_, r) => (
                <span>
                  {r.entityLabel} · {r.fieldLabel}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {" "}
                    {r.entity}.{r.field}
                  </Typography.Text>
                </span>
              ),
            },
            ...roles.map((role) => ({
              title: role.label,
              key: role.key,
              render: (_: unknown, r: (typeof sensitiveFields)[number]) => {
                const rule = entryFor(role.key)?.fieldRules.find(
                  (x) => x.entity === r.entity && x.field === r.field,
                );
                return (
                  <Select
                    size="small"
                    style={{ width: 132 }}
                    value={rule?.access ?? "default"}
                    options={FIELD_ACCESS_OPTIONS}
                    onChange={(v: FieldAccess | "default") =>
                      setFieldRule(role.key, r.entity, r.field, v)
                    }
                  />
                );
              },
            })),
          ]}
        />
      )}

      {/* ------------------------------------------------ 区块三：菜单可见 */}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        菜单可见
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        按角色勾选可见页面（包含设计页与自动生成页）。开启「全部页面」即写入 *，新页面自动可见。
      </Typography.Paragraph>
      <Space direction="vertical" size={10} style={{ display: "flex", marginBottom: 8 }}>
        {roles.map((r) => {
          const menus = entryFor(r.key)?.menus ?? [];
          const all = menus.includes("*");
          return (
            <Space key={r.key} size={10} wrap align="start">
              <Typography.Text style={{ width: 110, paddingTop: 4 }}>{r.label}</Typography.Text>
              <Switch
                checked={all}
                checkedChildren="全部页面"
                unCheckedChildren="全部页面"
                onChange={(v) => setMenus(r.key, v ? ["*"] : [])}
              />
              <Select
                mode="multiple"
                size="small"
                style={{ width: 560 }}
                placeholder="选择可见页面"
                disabled={all}
                value={all ? [] : menus}
                options={routeOptions}
                onChange={(v: string[]) => setMenus(r.key, v)}
              />
            </Space>
          );
        })}
      </Space>

      {/* ------------------------------------------------ 区块四：公开策略 */}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        公开策略（匿名访客）
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        匿名访客无需登录即可访问公开页面；公开可读实体仅经公开接口下发整形后的数据，公开表单仅可新增、提交先入待审区（下方），管理员采纳后才写入业务数据。
      </Typography.Paragraph>
      <Space direction="vertical" size={12} style={{ display: "flex" }}>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>公开页面</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择匿名可访问的页面"
            value={permissions.public.pages}
            options={routeOptions}
            onChange={(v: string[]) =>
              mutate((p) => {
                p.public.pages = v;
              })
            }
          />
        </Space>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>公开可读实体</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择匿名可读的实体"
            value={permissions.public.readable.map((r) => r.entity)}
            options={entityOptions}
            onChange={(v: string[]) =>
              mutate((p) => {
                p.public.readable = v.map((entity) => {
                  const prev = p.public.readable.find((r) => r.entity === entity);
                  return prev ?? { entity };
                });
              })
            }
          />
        </Space>
        {permissions.public.readable.map((r) => {
          const ent = data.entities.find((e) => e.key === r.entity);
          if (!ent) return null;
          return (
            <Space key={r.entity} size={10} wrap align="start" style={{ paddingLeft: 120 }}>
              <Typography.Text type="secondary" style={{ width: 110, paddingTop: 4 }}>
                {ent.label} 可见字段
              </Typography.Text>
              <Select
                mode="multiple"
                size="small"
                style={{ width: 450 }}
                placeholder="留空 = 全部非敏感字段"
                value={r.fields ?? []}
                options={ent.fields.map((f) => ({
                  value: f.key,
                  label: `${f.label}（${f.key}）${f.sensitive ? " · 敏感" : ""}`,
                }))}
                onChange={(v: string[]) =>
                  mutate((p) => {
                    const target = p.public.readable.find((x) => x.entity === r.entity);
                    if (!target) return;
                    if (v.length > 0) target.fields = v;
                    else delete target.fields;
                  })
                }
              />
            </Space>
          );
        })}
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>公开表单实体</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择匿名可提交（仅新增入待审）的实体"
            value={permissions.public.forms}
            options={entityOptions}
            onChange={(v: string[]) =>
              mutate((p) => {
                p.public.forms = v;
              })
            }
          />
        </Space>
      </Space>

      {/* ------------------------------------------------ 区块五：会员策略 */}
      <Typography.Title level={5} style={{ marginTop: 28 }}>
        会员策略（应用会员）
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        应用会员是前台自助注册的第三类主体（区别于员工角色与匿名访客）：会员页面仅登录会员可见，会员数据按此策略与归属范围管理，未声明的实体会员一律不可见、不可读写。归属字段声明后（如订单的
        member_id），该实体的数据读写只限当前会员本人。多应用共用一套会员在「应用设置」的会员域里配置。
      </Typography.Paragraph>
      <Space direction="vertical" size={12} style={{ display: "flex" }}>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>会员页面</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择仅会员可见的页面"
            value={memberPolicy.pages}
            options={routeOptions}
            onChange={(v: string[]) =>
              setMemberPolicy({ ...memberPolicy, pages: v })
            }
          />
        </Space>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>会员可读实体</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择会员可读的实体"
            value={memberPolicy.readable}
            options={entityOptions}
            onChange={(v: string[]) =>
              setMemberPolicy({ ...memberPolicy, readable: v })
            }
          />
        </Space>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>只读全量实体</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="已声明归属但会员可读全量的实体（如论坛主题）"
            value={memberPolicy.readAll}
            options={entityOptions}
            onChange={(v: string[]) =>
              setMemberPolicy({ ...memberPolicy, readAll: v })
            }
          />
        </Space>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>显示名盖章字段</Typography.Text>
          <Input
            size="small"
            style={{ width: 560 }}
            placeholder="如 author_name；留空 = 不盖章。会员新建时将自动写入其显示名"
            value={memberPolicy.stampDisplayNameAs ?? ""}
            onChange={(e) =>
              setMemberPolicy({
                ...memberPolicy,
                stampDisplayNameAs: e.target.value.trim() || undefined,
              })
            }
          />
        </Space>
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>会员可写实体</Typography.Text>
          <Select
            mode="multiple"
            size="small"
            style={{ width: 560 }}
            placeholder="选择会员可新建/改己行的实体"
            value={memberPolicy.writable}
            options={entityOptions}
            onChange={(v: string[]) => {
              const owners = Object.fromEntries(
                Object.entries(memberPolicy.owners).filter(([e]) =>
                  v.includes(e),
                ),
              );
              const writableFields = Object.fromEntries(
                Object.entries(memberPolicy.writableFields).filter(([e]) =>
                  v.includes(e),
                ),
              );
              setMemberPolicy({ ...memberPolicy, writable: v, owners, writableFields });
            }}
          />
        </Space>
        {memberPolicy.writable.map((entityKey) => {
          const ent = data.entities.find((e) => e.key === entityKey);
          if (!ent) return null;
          return (
            <Space
              key={entityKey}
              size={10}
              wrap
              align="start"
              style={{ paddingLeft: 120 }}
            >
              <Typography.Text
                type="secondary"
                style={{ width: 130, paddingTop: 4 }}
              >
                {ent.label} 可写字段
              </Typography.Text>
              <Select
                mode="multiple"
                size="small"
                style={{ width: 430 }}
                placeholder="未填写 = 全部字段可写"
                value={memberPolicy.writableFields[entityKey] ?? []}
                options={ent.fields.map((f) => ({
                  value: f.key,
                  label: `${f.label}（${f.key}）`,
                }))}
                onChange={(v: string[]) => {
                  const next = { ...memberPolicy.writableFields };
                  if (v.length > 0) next[entityKey] = v;
                  else delete next[entityKey];
                  setMemberPolicy({ ...memberPolicy, writableFields: next });
                }}
              />
            </Space>
          );
        })}
        {memberPolicy.writable.length > 0 && (
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, paddingLeft: 120, margin: 0 }}
          >
            可写字段（商城线）：为实体声明后，会员提交的数据里出现清单外字段将整单被拒（400）；系统盖章字段（如归属 member_id）不受此清单影响。订单类实体通常应排除状态字段，防止会员自行改单状态。
          </Typography.Paragraph>
        )}
        <Space size={10} wrap align="start">
          <Typography.Text style={{ width: 110, paddingTop: 4 }}>归属字段</Typography.Text>
          <Space direction="vertical" size={6}>
            {Object.entries(memberPolicy.owners).map(([entity, field]) => {
              const ent = data.entities.find((e) => e.key === entity);
              return (
                <Space key={entity} size={8} wrap>
                  <Select
                    size="small"
                    style={{ width: 200 }}
                    value={entity}
                    options={entityOptions.filter((o) =>
                      memberPolicy.writable.includes(o.value),
                    )}
                    onChange={(v: string) => {
                      const next = { ...memberPolicy.owners };
                      delete next[entity];
                      const firstField = data.entities.find(
                        (e) => e.key === v,
                      )?.fields[0]?.key;
                      if (firstField) next[v] = firstField;
                      setMemberOwners(next);
                    }}
                  />
                  <Select
                    size="small"
                    style={{ width: 220 }}
                    placeholder="选择归属字段"
                    value={field}
                    options={(ent?.fields ?? []).map((f) => ({
                      value: f.key,
                      label: `${f.label}（${f.key}）`,
                    }))}
                    onChange={(v: string) =>
                      setMemberOwners({ ...memberPolicy.owners, [entity]: v })
                    }
                  />
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      const next = { ...memberPolicy.owners };
                      delete next[entity];
                      setMemberOwners(next);
                    }}
                  >
                    删除
                  </Button>
                </Space>
              );
            })}
            <Space size={8} align="center">
              <Button
                size="small"
                disabled={
                  memberPolicy.writable.length === 0 ||
                  memberPolicy.writable.every((e) => e in memberPolicy.owners)
                }
                onClick={() => {
                  const entity = memberPolicy.writable.find(
                    (e) => !(e in memberPolicy.owners),
                  );
                  const firstField = data.entities.find(
                    (e) => e.key === entity,
                  )?.fields[0]?.key;
                  if (entity && firstField)
                    setMemberOwners({
                      ...memberPolicy.owners,
                      [entity]: firstField,
                    });
                }}
              >
                添加归属
              </Button>
              {memberPolicy.writable.length === 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  先选「会员可写实体」，再为需按会员隔离的实体指定归属字段（如订单的 member_id）。
                </Typography.Text>
              )}
            </Space>
          </Space>
        </Space>
      </Space>

      {/* ------------------------------------------------ 区块六：待审区 */}
      <SubmissionsSection
        submissions={submissions}
        subsError={subsError}
        subStatus={subStatus}
        onStatusChange={setSubStatus}
        onReload={() => void loadSubmissions()}
        onReview={(s, ok) => void reviewSubmission(s, ok)}
        entityLabel={(key) => data.entities.find((e) => e.key === key)?.label ?? key}
      />

      {/* ------------------------------------------------ 弹窗 */}
      <Modal
        open={roleModalOpen}
        title="新增角色"
        onCancel={() => setRoleModalOpen(false)}
        onOk={() => void addRole()}
        okText="添加"
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item
            label="角色 key（英文标识，创建后不可改）"
            name="key"
            rules={[
              { required: true, message: "请输入角色 key" },
              { pattern: /^[a-z][a-z0-9_]*$/, message: "小写字母开头，仅小写字母/数字/下划线" },
            ]}
          >
            <Input placeholder="如：sales 销售" />
          </Form.Item>
          <Form.Item
            label="显示名"
            name="label"
            rules={[{ required: true, message: "请输入显示名" }]}
          >
            <Input placeholder="如：销售" />
          </Form.Item>
        </Form>
      </Modal>
      {userModalOpen && (
        <UserCreateModal
          form={userForm}
          roleSelectOptions={roleSelectOptions}
          deptOptions={hasDepartmentEntity ? deptOptions : null}
          onCancel={() => setUserModalOpen(false)}
          onOk={() => void createUser()}
        />
      )}
      {pwdTarget && (
        <PasswordModal
          form={pwdForm}
          username={pwdTarget.username}
          onCancel={() => setPwdTarget(null)}
          onOk={() => void resetPassword()}
        />
      )}
    </div>
  );
}

// ============================================================ 用户管理子区块
function UsersSection({
  users,
  usersError,
  roleSelectOptions,
  deptOptions,
  onReload,
  onCreate,
  onPatch,
  onResetPassword,
  onDelete,
}: {
  users: AdminUser[];
  usersError: string | null;
  roleSelectOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[] | null;
  onReload: () => void;
  onCreate: () => void;
  onPatch: (id: string, patch: Parameters<typeof api.updateUser>[1]) => void;
  onResetPassword: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <Typography.Text strong>平台用户</Typography.Text>
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Button size="small" onClick={onReload}>
            刷新
          </Button>
          <Button size="small" type="primary" ghost onClick={onCreate}>
            新建用户
          </Button>
        </Space>
      </div>
      {usersError && (
        <Alert type="error" message={`用户列表加载失败：${usersError}`} style={{ marginBottom: 8 }} />
      )}
      <Table<AdminUser>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={users}
        columns={[
          { title: "用户名", dataIndex: "username", width: 130 },
          {
            title: "显示名",
            width: 150,
            render: (_, u) => (
              <Input
                size="small"
                defaultValue={u.displayName ?? ""}
                key={`${u.id}-${u.displayName ?? ""}`}
                placeholder="未设置"
                onBlur={(ev) => {
                  const v = ev.target.value.trim();
                  if (v !== (u.displayName ?? ""))
                    onPatch(u.id, { displayName: v });
                }}
              />
            ),
          },
          {
            title: "角色",
            width: 200,
            render: (_, u) => (
              <Select
                size="small"
                style={{ width: "100%" }}
                value={u.role}
                options={roleSelectOptions}
                onChange={(v) => onPatch(u.id, { role: v })}
              />
            ),
          },
          ...(deptOptions
            ? [
                {
                  title: "所属部门",
                  width: 180,
                  render: (_: unknown, u: AdminUser) => (
                    <Select
                      size="small"
                      style={{ width: "100%" }}
                      allowClear
                      placeholder="未设置"
                      value={u.departmentId ?? undefined}
                      options={deptOptions}
                      onChange={(v: string | undefined) =>
                        onPatch(u.id, { departmentId: v ?? null })
                      }
                    />
                  ),
                } as const,
              ]
            : []),
          {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 160,
            render: (t: string) => fmtTime(t),
          },
          {
            title: "操作",
            width: 150,
            render: (_, u) => (
              <Space size={4}>
                <Button size="small" onClick={() => onResetPassword(u)}>
                  重置密码
                </Button>
                <Popconfirm
                  title={`删除用户「${u.username}」？`}
                  description="删除后该账号立即无法登录（不能删除当前登录的自己）。"
                  onConfirm={() => onDelete(u)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </div>
  );
}

function UserCreateModal({
  form,
  roleSelectOptions,
  deptOptions,
  onCancel,
  onOk,
}: {
  form: FormInstance<any>;
  roleSelectOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[] | null;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <Modal open title="新建用户" onCancel={onCancel} onOk={onOk} okText="创建">
      <Form form={form} layout="vertical" initialValues={{ role: "employee" }}>
        <Form.Item
          label="用户名"
          name="username"
          rules={[{ required: true, message: "请输入用户名" }]}
        >
          <Input autoComplete="off" placeholder="登录用用户名，如 caiwu" />
        </Form.Item>
        <Form.Item
          label="初始密码"
          name="password"
          rules={[{ required: true, message: "请输入初始密码" }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item label="显示名（行级「仅本人」按显示名比对归属）" name="displayName">
          <Input placeholder="如：李强" />
        </Form.Item>
        <Form.Item label="角色" name="role" rules={[{ required: true }]}>
          <Select options={roleSelectOptions} />
        </Form.Item>
        {deptOptions && (
          <Form.Item label="所属部门" name="departmentId">
            <Select allowClear placeholder="未设置" options={deptOptions} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function PasswordModal({
  form,
  username,
  onCancel,
  onOk,
}: {
  form: FormInstance<any>;
  username: string;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <Modal
      open
      title={`重置密码 · ${username}`}
      onCancel={onCancel}
      onOk={onOk}
      okText="确认重置"
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="新密码"
          name="password"
          rules={[{ required: true, message: "请输入新密码" }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ============================================================ 待审区子区块
const SUB_STATUS_META: Record<Submission["status"], { label: string; color: string }> = {
  pending: { label: "待审核", color: "orange" },
  approved: { label: "已采纳", color: "green" },
  rejected: { label: "已驳回", color: "red" },
};

function SubmissionsSection({
  submissions,
  subsError,
  subStatus,
  onStatusChange,
  onReload,
  onReview,
  entityLabel,
}: {
  submissions: Submission[];
  subsError: string | null;
  subStatus: Submission["status"] | undefined;
  onStatusChange: (s: Submission["status"] | undefined) => void;
  onReload: () => void;
  onReview: (s: Submission, approve: boolean) => void;
  entityLabel: (key: string) => string;
}) {
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          待审区（公开表单提交）
        </Typography.Title>
        <div style={{ flex: 1 }} />
        <Space size={8}>
          <Select
            size="small"
            style={{ width: 120 }}
            value={subStatus ?? "all"}
            options={[
              { value: "all", label: "全部状态" },
              { value: "pending", label: "待审核" },
              { value: "approved", label: "已采纳" },
              { value: "rejected", label: "已驳回" },
            ]}
            onChange={(v) =>
              onStatusChange(v === "all" ? undefined : (v as Submission["status"]))
            }
          />
          <Button size="small" onClick={onReload}>
            刷新
          </Button>
        </Space>
      </div>
      {subsError && (
        <Alert type="error" message={`待审列表加载失败：${subsError}`} style={{ marginBottom: 8 }} />
      )}
      <Table<Submission>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={submissions}
        locale={{ emptyText: "暂无提交记录" }}
        columns={[
          {
            title: "提交时间",
            dataIndex: "createdAt",
            width: 170,
            render: (t: string) => fmtTime(t),
          },
          {
            title: "实体",
            width: 130,
            render: (_, s) => `${entityLabel(s.entity)}（${s.entity}）`,
          },
          {
            title: "内容摘要",
            render: (_, s) => {
              const text = Object.entries(s.body)
                .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join("；");
              return (
                <Typography.Text ellipsis={{ tooltip: text }} style={{ maxWidth: 480 }}>
                  {text}
                </Typography.Text>
              );
            },
          },
          {
            title: "状态",
            width: 90,
            render: (_, s) => (
              <Tag color={SUB_STATUS_META[s.status].color}>
                {SUB_STATUS_META[s.status].label}
              </Tag>
            ),
          },
          {
            title: "操作",
            width: 140,
            render: (_, s) =>
              s.status === "pending" ? (
                <Space size={4}>
                  <Button size="small" type="primary" ghost onClick={() => onReview(s, true)}>
                    采纳
                  </Button>
                  <Popconfirm
                    title="驳回这条提交？"
                    description="驳回后不会写入业务数据，提交记录保留备查。"
                    onConfirm={() => onReview(s, false)}
                  >
                    <Button size="small" danger>
                      驳回
                    </Button>
                  </Popconfirm>
                </Space>
              ) : (
                <Typography.Text type="secondary">
                  {s.reviewedBy ? `处理人 ${s.reviewedBy}` : "—"}
                </Typography.Text>
              ),
          },
        ]}
      />
    </div>
  );
}
