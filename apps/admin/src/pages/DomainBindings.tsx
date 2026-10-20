import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Space, Tag, Typography, message } from "antd";
import { api, type SiteAppView } from "../api";

/**
 * 域名（第 68 步口径：入口模型退役后，域名是应用的**单值属性**）：
 * 本页签读写 platform_apps 的站点字段（GET/PUT /admin/apps/:id/site）——
 * bound_host（绑定域名，空 = 未绑定）与 name_en（默认域名路径的英文别名）。
 * 访问形态由字段推导、只读呈现：
 * - 绑专属域名 → 该域名直达本应用；
 * - 主应用 → 占据默认域名根路径；
 * - 其余 → 默认域名 /<应用ID> 路径（英文名/中文名亦可作路径段，别名只作
 *   手输便利、平台生成的链接一律用 ID）。
 * 写权：域名/英文名 admin-only（服务端同口径），operator 只读呈现；
 * 校验错误（域名占用、默认域名仅主应用可绑等）原文呈现。
 */
export default function DomainBindings({
  appId,
  isAdmin,
}: {
  appId: string;
  isAdmin: boolean;
}) {
  const [site, setSite] = useState<SiteAppView | null | undefined>(undefined);
  const [defaultHost, setDefaultHost] = useState("www.coode.cc.cd");
  const [host, setHost] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.site.get(appId);
      setSite(res.app);
      setDefaultHost(res.defaultHost);
      setHost(res.app.boundHost ?? "");
      setNameEn(res.app.nameEn ?? "");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载域名失败");
      setSite(null);
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.site.update(appId, {
        boundHost: host.trim() ? host.trim() : null,
        nameEn: nameEn.trim() ? nameEn.trim() : null,
      });
      message.success(
        res.app.boundHost
          ? `域名已保存：${res.app.boundHost}`
          : "域名已解绑（清空）",
      );
      void load();
    } catch (err) {
      // 后端口径错误（如域名已被其他应用绑定）原文呈现，不吞
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const unchanged =
    site !== undefined &&
    host.trim() === (site?.boundHost ?? "") &&
    nameEn.trim() === (site?.nameEn ?? "");

  const accessHint = !site
    ? null
    : site.boundHost
      ? `专属域名直达：https://${site.boundHost}/`
      : site.isPrimary
        ? `本应用是主应用：占据默认域名根路径 https://${defaultHost}/`
        : `默认域名路径：https://${defaultHost}/${appId}${
            site.nameEn ? `（英文名别名 /${site.nameEn} 亦可达）` : ""
          }`;

  return (
    <div>
      <Space align="start" size={12} wrap>
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          disabled={!isAdmin || site === undefined}
          placeholder="未绑定域名"
          style={{ width: 360 }}
          addonBefore="域名"
        />
        <Input
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          disabled={!isAdmin || site === undefined}
          placeholder="未设置（可选）"
          style={{ width: 300 }}
          addonBefore="英文名"
        />
        {isAdmin && (
          <Button
            type="primary"
            loading={saving}
            disabled={site === undefined || unchanged}
            onClick={() => void save()}
          >
            保存
          </Button>
        )}
        {site?.isPrimary && <Tag color="gold">主应用</Tag>}
      </Space>
      {!isAdmin && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 16 }}
          message="域名与英文名由平台管理员在应用设置中维护"
        />
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
        域名是本应用的单值属性（清空即解绑）；默认域名（{defaultHost}
        ）仅主应用可绑定，未绑定的应用一律经默认域名 /&lt;应用ID&gt;
        路径访问，英文名只是该路径的手输别名。
        {accessHint && (
          <>
            <br />
            当前访问形态：{accessHint}
          </>
        )}
      </Typography.Paragraph>
    </div>
  );
}
