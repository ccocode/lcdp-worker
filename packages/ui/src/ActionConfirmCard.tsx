import React, { useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { tokens } from "./tokens.js";

export interface PendingActionField {
  label: string;
  value: unknown;
  key?: string;
}

export interface ActionConfirmCardProps {
  action: {
    summary: string;
    kind?: string;
    entity?: string;
    fields?: PendingActionField[];
    values?: Record<string, unknown>;
    items?: Record<string, unknown>[];
    children?: { entity: string; items: Record<string, unknown>[] }[];
    droppedKeys?: string[];
    missingFields?: string[];
    handled?: boolean | {
      decision: string;
      at: string;
      outcome?: string;
    } | null;
  };
  loading?: boolean;
  onConfirm: (patchArgs?: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function ActionConfirmCard({
  action,
  loading = false,
  onConfirm,
  onCancel,
}: ActionConfirmCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [itemEdits, setItemEdits] = useState<Record<number, Record<string, unknown>>>({});

  const childItems = action.items ?? action.children?.[0]?.items ?? [];

  const fields: PendingActionField[] =
    action.fields && action.fields.length > 0
      ? action.fields
      : action.values
        ? Object.entries(action.values).map(([k, v]) => ({
            label: k,
            value: v,
            key: k,
          }))
        : [];

  const getEffectiveKey = (f: PendingActionField, idx: number): string =>
    f.key || f.label || `field_${idx}`;

  const hasItemEdits = Object.keys(itemEdits).length > 0;
  const hasEdits = Object.keys(edits).length > 0 || hasItemEdits;

  const handleFieldChange = (key: string, newVal: unknown) => {
    setEdits((prev) => ({
      ...prev,
      [key]: newVal,
    }));
  };

  const handleItemFieldChange = (rowIndex: number, colKey: string, val: unknown) => {
    setItemEdits((prev) => ({
      ...prev,
      [rowIndex]: {
        ...(prev[rowIndex] || {}),
        [colKey]: val,
      },
    }));
  };

  const handleReset = () => {
    setEdits({});
    setItemEdits({});
  };

  const buildFinalPatch = (): Record<string, unknown> | undefined => {
    if (!hasEdits) return undefined;
    const patch: Record<string, unknown> = { ...edits };
    if (childItems.length > 0 && hasItemEdits) {
      patch.items = childItems.map((item, idx) => ({
        ...item,
        ...(itemEdits[idx] || {}),
      }));
    }
    return patch;
  };

  const formatDisplay = (val: unknown): string => {
    if (val === null || val === undefined || val === "") return "—";
    if (typeof val === "boolean") return val ? "是" : "否";
    if (typeof val === "object") {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val);
  };

  const renderFieldEditor = (f: PendingActionField, key: string) => {
    const origVal = f.value;
    const curVal = key in edits ? edits[key] : origVal;
    const isModified = key in edits && edits[key] !== origVal;

    if (typeof origVal === "boolean" || typeof curVal === "boolean") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Switch
            size="small"
            checked={Boolean(curVal)}
            onChange={(checked) => handleFieldChange(key, checked)}
          />
          {isModified && (
            <Tooltip title={`原建议: ${formatDisplay(origVal)}`}>
              <Tag color="processing" style={{ margin: 0 }}>
                已微调
              </Tag>
            </Tooltip>
          )}
        </div>
      );
    }

    if (
      typeof origVal === "number" ||
      (!isNaN(Number(origVal)) && origVal !== "" && origVal !== null)
    ) {
      const numVal =
        typeof curVal === "number" ? curVal : Number(curVal) || 0;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <InputNumber
            size="small"
            style={{ width: 140 }}
            value={numVal}
            onChange={(val) => handleFieldChange(key, val ?? 0)}
          />
          {isModified && (
            <Tooltip title={`原建议: ${formatDisplay(origVal)}`}>
              <Tag color="processing" style={{ margin: 0 }}>
                已微调
              </Tag>
            </Tooltip>
          )}
        </div>
      );
    }

    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <Input
          size="small"
          style={{ maxWidth: 260 }}
          value={curVal === null || curVal === undefined ? "" : String(curVal)}
          onChange={(e) => handleFieldChange(key, e.target.value)}
        />
        {isModified && (
          <Tooltip title={`原建议: ${formatDisplay(origVal)}`}>
            <Tag color="processing" style={{ margin: 0 }}>
              已微调
            </Tag>
          </Tooltip>
        )}
      </div>
    );
  };

  return (
    <Card
      size="small"
      title={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{action.summary}</span>
          {!action.handled && fields.length > 0 && (
            <Button
              type="link"
              size="small"
              style={{ fontSize: 12, padding: 0 }}
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? "收起微调" : "微调参数"}
            </Button>
          )}
        </div>
      }
      style={{
        borderColor: tokens.colorWarningBorder,
        background: tokens.colorWarningBg,
      }}
    >
      {/* 忽略的非模型字段提醒 */}
      {action.droppedKeys && action.droppedKeys.length > 0 && (
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          <Typography.Text type="secondary">
            提案中有 {action.droppedKeys.length} 个字段与数据模型不匹配，已自动忽略：
            {action.droppedKeys.join("、")}
          </Typography.Text>
        </div>
      )}

      {/* 字段列表 / 内联编辑表单 */}
      {fields.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: isEditing ? tokens.colorBgContainer : "transparent",
            padding: isEditing ? "8px 10px" : 0,
            borderRadius: 6,
          }}
        >
          {fields.map((f, i) => {
            const key = getEffectiveKey(f, i);
            const isModified = key in edits && edits[key] !== f.value;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  fontSize: 13,
                  gap: 8,
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{
                    minWidth: 80,
                    fontWeight: isModified ? 600 : "normal",
                  }}
                >
                  {f.label}：
                </Typography.Text>
                {isEditing ? (
                  renderFieldEditor(f, key)
                ) : (
                  <span style={{ wordBreak: "break-all" }}>
                    {formatDisplay(f.value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 子表/明细行列表展示 (Compound PendingAction) */}
      {childItems.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px dashed #e8e8e8", paddingTop: 8 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: tokens.colorTextSecondary,
              marginBottom: 6,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>📋 明细清单（共 {childItems.length} 项）</span>
            {hasItemEdits && (
              <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>
                明细已微调
              </Tag>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {childItems.map((item, rowIdx) => {
              const currentItem = { ...item, ...(itemEdits[rowIdx] || {}) };
              return (
                <div
                  key={rowIdx}
                  style={{
                    background: "#fafafa",
                    border: "1px solid #f0f0f0",
                    borderRadius: 4,
                    padding: "6px 10px",
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "6px 14px",
                      alignItems: "center",
                    }}
                  >
                    {Object.entries(currentItem).map(([colKey, colVal]) => {
                      if (colKey.startsWith("_") || colKey === "id" || colKey === "tenant_id" || colKey === "app_id") {
                        return null;
                      }
                      const isQty =
                        colKey.toLowerCase().includes("qty") ||
                        colKey.toLowerCase().includes("num") ||
                        colKey.toLowerCase().includes("count") ||
                        colKey.includes("数量");
                      const isPrice =
                        colKey.toLowerCase().includes("price") ||
                        colKey.includes("单价") ||
                        colKey.includes("金额");
                      const isRowEdited =
                        rowIdx in itemEdits && colKey in (itemEdits[rowIdx] || {});

                      return (
                        <div
                          key={colKey}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span style={{ color: tokens.colorTextSecondary }}>
                            {colKey}:
                          </span>
                          {isEditing && (isQty || isPrice) && typeof colVal === "number" ? (
                            <InputNumber
                              size="small"
                              value={colVal}
                              min={isQty ? 1 : 0}
                              step={isPrice ? 0.1 : 1}
                              onChange={(v) =>
                                handleItemFieldChange(rowIdx, colKey, v)
                              }
                              style={{ width: 80 }}
                            />
                          ) : (
                            <span
                              style={{
                                fontWeight: isRowEdited ? 600 : "normal",
                                color: isRowEdited ? tokens.colorPrimary : undefined,
                              }}
                            >
                              {formatDisplay(colVal)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 缺失字段提示 */}
      {action.missingFields && action.missingFields.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary
            style={{
              fontSize: 12,
              cursor: "pointer",
              color: tokens.colorTextSecondary,
            }}
          >
            未提供的选填字段（{action.missingFields.length}）
          </summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              marginTop: 4,
            }}
          >
            {action.missingFields.map((label, i) => (
              <div key={i} style={{ fontSize: 12 }}>
                <Typography.Text type="secondary">{label}：</Typography.Text>
                未提供
              </div>
            ))}
          </div>
        </details>
      )}

      {/* 操作按钮栏 */}
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {action.handled ? (
          <Tag color="default">
            {typeof action.handled === "object"
              ? `${action.handled.decision === "confirm" ? "已确认执行" : "已取消"}${action.handled.outcome ? `：${action.handled.outcome}` : ""}`
              : "已处理"}
          </Tag>
        ) : (
          <Space size={8}>
            <Button
              type="primary"
              size="small"
              loading={loading}
              onClick={() => onConfirm(buildFinalPatch())}
            >
              {hasEdits ? "确认并执行 (已微调)" : "确认执行"}
            </Button>
            <Button
              size="small"
              disabled={loading}
              onClick={onCancel}
            >
              取消
            </Button>
            {hasEdits && (
              <Button
                size="small"
                type="text"
                disabled={loading}
                onClick={handleReset}
                style={{ fontSize: 12, color: tokens.colorTextSecondary }}
              >
                重置
              </Button>
            )}
          </Space>
        )}
      </div>
    </Card>
  );
}
