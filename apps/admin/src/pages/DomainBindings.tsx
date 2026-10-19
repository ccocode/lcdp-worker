import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Space, Typography, message } from "antd";
import { api, type EntryView } from "../api";

/**
 * 域名（对象形态归正 W3 终版口径，用户 2026-10-20 03:42 定案）：
 * 域名是应用的**单值属性**——本页签就是应用设置里的一个域名输入框，
 * 不是入口列表。值的读写落点 = 该应用的专属入口（entries 中 appIds
 * 恰为 [本应用] 的那条）的 hosts 首项：
 * - 有专属入口 → 读 hosts[0]（存量若有多项只显首项，保存收敛为单值）；
 * - 无专属入口 → 未绑定（空值），admin 保存时经 POST /admin/entries
 *   新建专属入口承载；
 * - 员工默认入口（多应用装配）只是运行外壳兜底，不算任何应用的绑定，
 *   不出现在本页签。
 * 写权 admin-only、后端错误原文呈现；operator 只读（disabled 输入框 +
 * 注记）。
 */
export default function DomainBindings({
  appId,
  isAdmin,
}: {
  appId: string;
  isAdmin: boolean;
}) {
  /** 本应用的专属入口（appIds 恰为 [appId]）；undefined = 加载中，null = 无 */
  const [exclusive, setExclusive] = useState<EntryView | null | undefined>(
    undefined,
  );
  const [host, setHost] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await api.entries.list();
      const found =
        all.find((e) => e.appIds.length === 1 && e.appIds[0] === appId) ?? null;
      setExclusive(found);
      setHost(found?.hosts[0] ?? "");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载域名失败");
      setExclusive(null);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const v = host.trim();
    setSaving(true);
    try {
      if (exclusive) {
        await api.entries.update(exclusive.id, { hosts: v ? [v] : [] });
        message.success(v ? "域名已保存" : "域名已解绑（清空）");
      } else if (v) {
        await api.entries.create({ hosts: [v], appIds: [appId] });
        message.success("域名已绑定");
      }
      void load();
    } catch (err) {
      // 后端口径错误（如域名已被其他入口占用）原文呈现，不吞
      message.error(err instanceof Error ? err.message : "保存域名失败");
    } finally {
      setSaving(false);
    }
  };

  const unchanged =
    exclusive !== undefined && host.trim() === (exclusive?.hosts[0] ?? "");

  return (
    <div>
      <Space align="start" size={12} wrap>
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          disabled={!isAdmin || exclusive === undefined}
          placeholder="未绑定域名"
          style={{ width: 360 }}
          addonBefore="域名"
        />
        {isAdmin && (
          <Button
            type="primary"
            loading={saving}
            disabled={exclusive === undefined || unchanged}
            onClick={() => void save()}
          >
            保存
          </Button>
        )}
      </Space>
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message="域名由平台管理员在应用设置中维护"
        />
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        域名是本应用的单值属性；员工默认入口（多应用装配）为运行外壳兜底，不算本应用的绑定。
        {(exclusive?.hosts.length ?? 0) > 1 &&
          "（注：本应用专属入口现存多个域名，此处只显首项，下次保存将收敛为单值。）"}
      </Typography.Paragraph>
    </div>
  );
}
