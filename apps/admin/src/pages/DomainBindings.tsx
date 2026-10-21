import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Input, Space, Tag, Typography, message } from "antd";
import { api, type SiteAppView } from "../api";
import { errText, showError } from "@lcdp/ui";
import { accessFormText } from "../helpers";

/**
 * 域名（第 68 步口径：入口模型退役后，域名是应用的**单值属性**）：
 * 本页签读写 platform_apps 的站点字段（GET/PUT /admin/apps/:id/site）——
 * bound_host（绑定域名，空 = 未绑定）与 name_en（默认域名路径的应用别名）。
 * 访问形态由字段推导、只读呈现：
 * - 绑专属域名 → 该域名直达本应用；
 * - 主应用 → 占据默认域名根路径；
 * - 其余 → 默认域名 /<应用ID> 路径（应用别名/中文名亦可作路径段，别名只作
 *   手输便利、平台生成的链接一律用 ID）。
 * 写权：域名/应用别名 admin-only（服务端同口径），operator 只读呈现；
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.site.get(appId);
      setSite(res.app);
      setDefaultHost(res.defaultHost);
      setHost(res.app.boundHost ?? "");
      setNameEn(res.app.nameEn ?? "");
      setLoadError(null);
    } catch (err) {
      // 失败呈现与「静态」页签（StaticStatus）统一为页内 Alert（第 73 步片二）
      setLoadError(errText(err) || "加载域名失败");
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
      showError(err, "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const unchanged =
    site !== undefined &&
    host.trim() === (site?.boundHost ?? "") &&
    nameEn.trim() === (site?.nameEn ?? "");

  // 第 71 步口径统一：访问形态文案走 helpers.accessFormText 单一来源
  // （本页签原措辞即基准，主应用一态的句式随之与其余两处对齐）。
  const accessHint = !site
    ? null
    : accessFormText(
        {
          boundHost: site.boundHost,
          isPrimary: site.isPrimary,
          id: appId,
          nameEn: site.nameEn,
        },
        defaultHost,
      );

  return (
    <div>
      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="域名信息加载失败"
          description={`${loadError}（请刷新重试。）`}
        />
      )}
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
          addonBefore="应用别名"
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
          message="域名与应用别名由平台管理员在应用设置中维护"
        />
      )}
      {accessHint && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          当前访问形态：{accessHint}
        </Typography.Paragraph>
      )}
    </div>
  );
}
