import React from "react";
import { AppstoreOutlined, ProfileOutlined, ShoppingOutlined } from "@ant-design/icons";
import { Button, message } from "antd";
import type { PageDef, TemplateDef } from "../registry";
import DataAdmin from "../pages/DataAdmin";
import CommerceOrders from "../pages/CommerceOrders";
import { api, type Row } from "../api";

/**
 * 商城领域管理模版（第 58 步新建）：三页同 content 模版手法——实体定位走
 * domainModules.roles 语义锚点、门控 = domain 匹配 + 映射健康 + 锚点齐备。
 * 商品/分类为 DataAdmin lockEntity 参数化组装（上下架为商品页的附加直改），
 * 订单处理为专做页（状态队列 + 详情抽屉 + 明细子表）。支付单不单设页。
 */
const pages: PageDef[] = [
  {
    key: "commerce-products",
    label: "商品管理",
    icon: <ShoppingOutlined />,
    segment: "template",
    section: "商城运营",
    templateDomain: "commerce",
    needsMeta: true,
    requiresEntities: [{ role: "product" }],
    coversRole: "product",
    render: (ctx) => {
      const meta = ctx.appMeta!;
      const productKey = meta.domainModules?.roles["product"] ?? "product";
      const productMeta = meta.entities.find((e) => e.key === productKey);
      const canUpdate = (productMeta?.actions ?? []).includes("update");
      const statusField = productMeta?.fields.find((f) => f.key === "status");
      const statusValues = (statusField?.options ?? []).map((o) =>
        typeof o === "string" ? o : o.value,
      );
      return (
        <DataAdmin
          key={`${ctx.appId!}:product`}
          appId={ctx.appId!}
          meta={meta}
          lockEntity={productKey}
          title="商品管理"
          extraRowActions={(row: Row, reload: () => void) => {
            if (!canUpdate) return null;
            const current = String(row.status ?? "");
            // 上下架直改：目标 = 状态枚举中与当前值不同的另一值（骨架为二值枚举）
            const target = statusValues.find((v) => v !== current);
            if (!target) return null;
            const label =
              target === "在售" ? "上架" : target === "下架" ? "下架" : `改为${target}`;
            return (
              <Button
                size="small"
                type="link"
                onClick={async () => {
                  try {
                    // 第 65 步：以回读实际状态为准播报，字段被权限剔除时不再报假成功
                    const { row: updated, strippedFields } = await api.adminData.update(ctx.appId!, productKey, String(row.id), {
                      status: target,
                    });
                    const actual = String(updated?.status ?? "");
                    if (actual === target) {
                      message.success(`已改为「${target}」（审计已记录）`);
                    } else if (strippedFields.includes("status")) {
                      message.warning(`状态未变更（仍为「${actual}」）：「状态」不在你的可写字段内`);
                    } else {
                      message.warning(`状态未变更（仍为「${actual}」），请刷新后核对`);
                    }
                    reload();
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : "状态变更失败");
                  }
                }}
              >
                {label}
              </Button>
            );
          }}
        />
      );
    },
  },
  {
    key: "commerce-orders",
    label: "订单处理",
    icon: <ProfileOutlined />,
    segment: "template",
    section: "商城运营",
    templateDomain: "commerce",
    needsMeta: true,
    requiresEntities: [{ role: "order" }],
    coversRole: "order",
    render: (ctx) => (
      <CommerceOrders key={`${ctx.appId!}:orders`} appId={ctx.appId!} meta={ctx.appMeta!} />
    ),
  },
  {
    key: "commerce-categories",
    label: "分类管理",
    icon: <AppstoreOutlined />,
    segment: "template",
    section: "商城运营",
    templateDomain: "commerce",
    needsMeta: true,
    requiresEntities: [{ role: "category" }],
    coversRole: "category",
    render: (ctx) => (
      <DataAdmin
        key={`${ctx.appId!}:mallcat`}
        appId={ctx.appId!}
        meta={ctx.appMeta!}
        lockEntity={ctx.appMeta?.domainModules?.roles["category"] ?? "category"}
        title="分类管理"
      />
    ),
  },
];

export const commerceTemplate: TemplateDef = {
  domain: "commerce",
  section: "商城运营",
  pages,
  metrics: [
    { key: "pending-ship-orders", label: "待发货订单", entityRole: "order", filterField: "status", filterValue: "已支付", page: "commerce-orders" },
    { key: "on-sale-products", label: "在售商品", entityRole: "product", filterField: "status", filterValue: "在售", page: "commerce-products" },
  ],
  quickLinks: [
    { label: "订单处理", page: "commerce-orders" },
    { label: "商品管理", page: "commerce-products" },
    { label: "分类管理", page: "commerce-categories" },
  ],
};
