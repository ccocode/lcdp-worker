import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { api, type Row } from "../api";
import { asText } from "../helpers";

interface ItemState {
  key: string;
  scope: string;
  secret: boolean;
  isSet: boolean;
  /** 服务端回显值（secret 为脱敏占位，不含明文） */
  value: unknown;
  /** 用户编辑值（undefined = 未改动） */
  edited?: string | number;
}

const NUMERIC_KEYS = new Set([
  "chat.timeoutMs",
  "chat.maxRetries",
  "embedding.dimensions",
  "llm.tenantTokenBudget",
  "mail.smtpPort",
]);

const KEY_LABELS: Record<string, string> = {
  "chat.baseUrl": "对话网关地址 baseUrl",
  "chat.apiKey": "对话网关密钥 apiKey",
  "chat.modelStrong": "强模型 modelStrong",
  "chat.modelFast": "快模型 modelFast",
  "chat.timeoutMs": "超时（毫秒）timeoutMs",
  "chat.maxRetries": "最大重试 maxRetries",
  "embedding.baseUrl": "向量网关地址 baseUrl",
  "embedding.apiKey": "向量网关密钥 apiKey",
  "embedding.model": "向量模型 model",
  "embedding.dimensions": "向量维度 dimensions",
  "llm.tenantTokenBudget": "租户日 Token 上限 tenantTokenBudget",
  "storage.endpoint": "对象存储端点 endpoint",
  "storage.bucket": "桶 bucket",
  "storage.region": "区域 region",
  "storage.accessKeyId": "AccessKey accessKeyId",
  "storage.secretAccessKey": "SecretKey secretAccessKey",
  "turnstile.siteKey": "站点密钥 siteKey",
  "turnstile.secretKey": "服务端密钥 secretKey",
  "mail.smtpHost": "SMTP 主机 smtpHost",
  "mail.smtpPort": "SMTP 端口 smtpPort",
  "mail.smtpSecure": "SSL/TLS smtpSecure（true / false）",
  "mail.smtpUser": "SMTP 账号 smtpUser",
  "mail.smtpPass": "SMTP 授权码 smtpPass",
  "mail.fromName": "发件人名称 fromName",
  "mail.fromAddress": "发件地址 fromAddress（留空 = 同账号）",
  "pay.sandboxSecret": "沙箱签名密钥 sandboxSecret",
  "pay.alipayAppId": "支付宝应用 ID alipayAppId",
  "pay.alipayPrivateKey": "支付宝应用私钥 alipayPrivateKey",
  "pay.alipayPublicKey": "支付宝公钥 alipayPublicKey",
  "pay.wechatMchId": "微信商户号 wechatMchId",
  "pay.wechatSerialNo": "微信证书序列号 wechatSerialNo",
  "pay.wechatApiV3Key": "微信 APIv3 密钥 wechatApiV3Key",
  "pay.wechatPrivateKey": "微信商户私钥 wechatPrivateKey",
  "pay.paypalClientId": "PayPal Client ID paypalClientId",
  "pay.paypalClientSecret": "PayPal Client Secret paypalClientSecret",
  "pay.paypalMode": "PayPal 模式 paypalMode（sandbox / live）",
};

const GROUPS: {
  title: string;
  prefix: string;
  channel?: "chat" | "embedding" | "storage" | "mail";
}[] = [
  { title: "对话网关（chat）", prefix: "chat.", channel: "chat" },
  { title: "向量网关（embedding）", prefix: "embedding.", channel: "embedding" },
  { title: "对象存储（storage）", prefix: "storage.", channel: "storage" },
  { title: "客服防刷（Turnstile）", prefix: "turnstile." },
  { title: "邮件服务（mail）", prefix: "mail.", channel: "mail" },
  { title: "支付渠道（pay）", prefix: "pay." },
  { title: "LLM 全局（llm）", prefix: "llm." },
];

function toItemState(r: Row): ItemState {
  return {
    key: asText(r.key),
    scope: asText(r.scope ?? "global"),
    secret: r.secret === true,
    isSet: r.isSet === true || r.is_set === true,
    value: r.value,
  };
}

export default function ConfigPage() {
  const [items, setItems] = useState<ItemState[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.config.get();
      setItems(rows.map(toItemState));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const initialDimensions = useMemo(() => {
    const it = items.find((i) => i.key === "embedding.dimensions");
    return it ? Number(it.value) : null;
  }, [items]);

  const dimensionsChanged = useMemo(() => {
    const it = items.find((i) => i.key === "embedding.dimensions");
    if (!it || it.edited === undefined || initialDimensions === null) return false;
    return Number(it.edited) !== initialDimensions;
  }, [items, initialDimensions]);

  const setEdited = (idx: number, v: string | number | undefined) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, edited: v } : it)));

  const save = async () => {
    const changed = items.filter((it) => {
      if (it.edited === undefined) return false;
      // secret 留空 = 保持原值，不提交
      if (it.secret && (it.edited === "" || it.edited === null)) return false;
      return true;
    });
    if (changed.length === 0) {
      message.info("没有改动（密钥留空表示保持原值）");
      return;
    }
    setSaving(true);
    try {
      await api.config.put(
        changed.map((it) => ({
          key: it.key,
          scope: it.scope,
          value: NUMERIC_KEYS.has(it.key) ? Number(it.edited) : it.edited,
        })),
      );
      message.success(`已保存 ${changed.length} 项配置`);
      void load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (channel: "chat" | "embedding" | "storage" | "mail") => {
    setTesting(channel);
    try {
      const res = await api.config.test(channel);
      const extra = [
        res.model ? `模型 ${res.model}` : "",
        res.dimensions !== undefined ? `维度 ${res.dimensions}` : "",
        res.latencyMs !== undefined ? `延迟 ${res.latencyMs}ms` : "",
      ]
        .filter(Boolean)
        .join("，");
      // 成功响应无 message 字段，不能直接拼接（曾显示「连通：undefined」）；
      // storage 不是网关，默认文案单独区分（契约 M9：headBucket → {ok, latencyMs}）
      const okText =
        channel === "storage"
          ? "存储可用"
          : channel === "mail"
            ? "测试邮件已发送"
            : "网关响应正常";
      const detail = res.message ?? (res.ok ? okText : "未知错误");
      const text = `${res.ok ? "连通" : "不通"}：${detail}${extra ? `（${extra}）` : ""}`;
      setTestResult((s) => ({ ...s, [channel]: text }));
      if (res.ok) message.success(text);
      else message.error(text);
    } catch (err) {
      const text = err instanceof Error ? err.message : "测试失败";
      setTestResult((s) => ({ ...s, [channel]: `不通：${text}` }));
      message.error(text);
    } finally {
      setTesting(null);
    }
  };

  const rebuild = () => {
    Modal.confirm({
      title: "重建向量索引",
      content:
        "将按新维度修改向量列并对全部知识片段重新向量化，期间语义检索可能短暂不可用。确定执行？（演示口径：保持 768 时无需执行）",
      okText: "执行重建",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await api.config.rebuildVectors();
          message.success(asText(res.message ?? "重建已触发，详见审计记录"));
        } catch (err) {
          message.error(err instanceof Error ? err.message : "重建失败");
        }
      },
    });
  };

  return (
    <div>
      {dimensionsChanged ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="向量维度已变更：保存后需重建向量索引，现有向量将按新维度全量重嵌（不会自动执行）。"
          action={
            <Button danger onClick={rebuild}>
              重建向量索引
            </Button>
          }
        />
      ) : null}
      {GROUPS.map((g) => {
        const groupItems = items
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => it.key.startsWith(g.prefix));
        return (
          <Card
            key={g.prefix}
            title={g.title}
            loading={loading}
            style={{ marginBottom: 16 }}
            extra={
              g.channel ? (
                <Space>
                  {testResult[g.channel] ? (
                    <Typography.Text type="secondary">
                      {testResult[g.channel]}
                    </Typography.Text>
                  ) : null}
                  <Button
                    loading={testing === g.channel}
                    onClick={() => void runTest(g.channel!)}
                  >
                    连通性测试
                  </Button>
                </Space>
              ) : undefined
            }
          >
            {groupItems.length === 0 ? (
              <Typography.Text type="secondary">
                暂无配置项（服务端未返回该组键，可能尚未落库，当前生效值为 env / 默认）。
              </Typography.Text>
            ) : (
              groupItems.map(({ it, idx }) => (
                <div
                  key={`${it.scope}:${it.key}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ width: 300 }}>
                    <div>{KEY_LABELS[it.key] ?? it.key}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {it.key}
                      {it.scope !== "global" ? ` · 作用域 ${it.scope}` : ""}
                    </Typography.Text>
                  </div>
                  {it.secret ? (
                    <>
                      <Input.Password
                        style={{ width: 320 }}
                        placeholder={it.isSet ? "已设置（留空保持原值）" : "未设置，请输入"}
                        onChange={(e) => setEdited(idx, e.target.value)}
                        autoComplete="new-password"
                      />
                      {it.isSet ? <Tag color="green">已设置</Tag> : <Tag>未设置</Tag>}
                    </>
                  ) : NUMERIC_KEYS.has(it.key) ? (
                    <InputNumber
                      style={{ width: 320 }}
                      defaultValue={
                        it.value !== null && it.value !== undefined
                          ? Number(it.value)
                          : undefined
                      }
                      onChange={(v) => setEdited(idx, v ?? undefined)}
                    />
                  ) : (
                    <Input
                      style={{ width: 320 }}
                      defaultValue={
                        it.value !== null && it.value !== undefined
                          ? asText(it.value)
                          : ""
                      }
                      onChange={(e) => setEdited(idx, e.target.value)}
                    />
                  )}
                </div>
              ))
            )}
          </Card>
        );
      })}
      <Space>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存配置
        </Button>
        <Button onClick={() => void load()}>重新加载</Button>
      </Space>
    </div>
  );
}
