import { useEffect, useRef, useState } from "react";
import type { Field } from "@naka1205/schema";
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Upload,
} from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { AssetMeta, RuntimeAdapter, SelectOption } from "./adapter.js";
import { parseAssetIds } from "./adapter.js";
import { RichTextInput, RichTextView } from "./richtext.js";
import { StatusBadge, type StatusToken } from "./statusBadge.js";
import {
  SCAN_EVENT,
  bridgeCamera,
  bridgeScanner,
  scanTextOf,
} from "./bridge.js";

interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  adapter: RuntimeAdapter;
  /** 子表单元格内使用紧凑尺寸 */
  inChild?: boolean;
  readOnly?: boolean;
  /** 资产上传关联（宿主表单可透传实体/记录，新建未落库时 recordId 缺省） */
  linkage?: { entity?: string; recordId?: string };
  /** 状态徽标色覆盖（包二）：宿主组件 props.statusColors 透传，仅只读展示 status 字段时用 */
  statusColors?: Record<string, StatusToken>;
}

/** 把任意值规整成字符串（日期截到日，时间截到分） */
function asInputString(value: unknown, slice?: number): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return slice ? s.slice(0, slice) : s;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const fullWidth = { width: "100%" } as const;

/**
 * file/image 字段控件（M9）：antd Upload 直传平台资产（customRequest → adapter.uploadAsset，本体走 R2）。
 * 受控值 = 资产 id 数组的 JSON 字符串；已选资产以 chips 展示文件名（可移除），image 带缩略图。
 * 上传即时登记资产（表单未保存时资产先行存在，关联经 linkage 标注；记录删除不连带删资产，资产页统一治理）。
 */
function AssetUploadInput({
  field,
  value,
  onChange,
  adapter,
  size,
  linkage,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  adapter: RuntimeAdapter;
  size: "small" | "middle";
  linkage?: { entity?: string; recordId?: string };
}) {
  const ids = parseAssetIds(value);
  const idsSig = ids.join(",");
  const [metas, setMetas] = useState<AssetMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const isImage = field.type === "image";

  useEffect(() => {
    if (!idsSig) {
      setMetas([]);
      return;
    }
    let alive = true;
    adapter
      .assetsMeta(idsSig.split(","))
      .then((ms) => {
        if (alive) setMetas(ms);
      })
      .catch(() => {
        if (alive) setMetas([]);
      });
    return () => {
      alive = false;
    };
  }, [adapter, idsSig]);

  const nameOf = (id: string) => metas.find((m) => m.id === id)?.name ?? id;

  /**
   * 文件落资产链的唯一路径：系统文件选择（Upload customRequest）与设备桥拍照
   * 共用——上传本体 → 追加资产 id 回填字段，后续口径（关联、治理）完全一致。
   */
  const pushFile = (file: File): Promise<AssetMeta> => {
    setUploading(true);
    return adapter
      .uploadAsset(file, {
        entity: linkage?.entity,
        recordId: linkage?.recordId,
        field: field.key,
      })
      .then((meta) => {
        onChange(JSON.stringify([...ids, meta.id]));
        return meta;
      })
      .finally(() => setUploading(false));
  };

  // 设备桥相机仅在原生壳内可用；Web 环境为 null，不渲染拍照入口、行为不变。
  const camera = bridgeCamera();
  const takePhoto = async () => {
    if (!camera?.takePhoto) return;
    const r = await camera.takePhoto().catch(() => null);
    if (!r?.supported) {
      adapter.notify("拍照不可用，请改用上传文件", "error");
      return;
    }
    pushFile(r.value).catch((err: unknown) => {
      adapter.notify(
        err instanceof Error ? err.message : String(err),
        "error",
      );
    });
  };

  return (
    <div>
      {ids.length > 0 && (
        <Space size={6} wrap style={{ marginBottom: 8 }}>
          {ids.map((id) => (
            <Tag
              key={id}
              closable
              onClose={(e) => {
                e.preventDefault();
                onChange(JSON.stringify(ids.filter((x) => x !== id)));
              }}
            >
              {isImage && (
                <img
                  src={adapter.assetContentUrl(id)}
                  alt=""
                  style={{
                    width: 20,
                    height: 20,
                    objectFit: "cover",
                    borderRadius: 2,
                    verticalAlign: "middle",
                    marginRight: 6,
                  }}
                />
              )}
              {nameOf(id)}
            </Tag>
          ))}
        </Space>
      )}
      <Space size={6}>
        <Upload
          showUploadList={false}
          customRequest={(options) => {
            pushFile(options.file as File)
              .then((meta) => {
                options.onSuccess?.(meta, new XMLHttpRequest());
              })
              .catch((err: unknown) => {
                options.onError?.(
                  err instanceof Error ? err : new Error(String(err)),
                );
              });
          }}
        >
          <Button size={size} loading={uploading}>
            {isImage ? "上传图片" : "上传文件"}
          </Button>
        </Upload>
        {camera && (
          <Button size={size} loading={uploading} onClick={takePhoto}>
            拍照
          </Button>
        )}
      </Space>
    </div>
  );
}

/**
 * 单行文本输入（string 字段，单号类字段的载体）：原生壳内额外接设备桥扫码——
 * 聚焦期间监听 `lcdp:scan` 事件填充（外部触发的扫码回传），后缀另有「扫码」
 * 按钮由本字段直接发起扫描并以返回值填充；两路都走同一 onChange 回填，与手动
 * 输入无异。Web 环境桥不可用时退化为普通 Input，行为零变化。子表单元格
 * （inChild）空间紧凑，不挂后缀按钮（事件填充仍生效）。
 */
function TextFieldInput({
  value,
  onChange,
  size,
  inChild,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  size: "small" | "middle";
  inChild?: boolean;
}) {
  const scanner = bridgeScanner();
  const [scanning, setScanning] = useState(false);
  const focusedRef = useRef(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!scanner) return;
    const onScan = (e: Event) => {
      if (!focusedRef.current) return;
      const text = scanTextOf(e);
      if (text) changeRef.current(text);
    };
    window.addEventListener(SCAN_EVENT, onScan);
    return () => window.removeEventListener(SCAN_EVENT, onScan);
  }, [scanner]);

  const runScan = async () => {
    if (!scanner?.scan) return;
    setScanning(true);
    try {
      const r = await scanner.scan();
      // scan() 成功时桥已派发 lcdp:scan（聚焦中由上方监听填充）；此处再按返回值
      // 填充一次兜底，保证本字段触发的扫码必达（同值重复赋值无副作用）。
      // 失败（含用户取消）静默不填——降级为手动输入，不打扰录入。
      if (r.supported) onChange(r.value);
    } catch {
      /* 桥承诺不抛，此处仅兜底 */
    } finally {
      setScanning(false);
    }
  };

  return (
    <Input
      style={fullWidth}
      size={size}
      value={asInputString(value)}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
      }}
      suffix={
        scanner && !inChild ? (
          <Button
            type="link"
            size="small"
            loading={scanning}
            onClick={runScan}
            style={{ padding: 0 }}
          >
            扫码
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * 字段输入控件：按 Schema 字段类型渲染，统一走 Ant Design 原子组件
 * （不用原生 select/input，保证外观、可控性与可自动化操作一致）。
 * 值以原始形态回传，类型归一在表单提交时统一处理（与 api 的二次归一呼应）。
 */
export function FieldInput({
  field,
  value,
  onChange,
  adapter,
  inChild,
  readOnly,
  linkage,
  statusColors,
}: FieldInputProps) {
  const [refOptions, setRefOptions] = useState<SelectOption[]>([]);
  const size = inChild ? "small" : "middle";

  useEffect(() => {
    if (field.type !== "ref" || !field.refEntity) return;
    let alive = true;
    adapter
      .options(field.refEntity)
      .then((opts) => {
        if (alive) setRefOptions(opts);
      })
      .catch(() => {
        if (alive) setRefOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [adapter, field.type, field.refEntity]);

  if (readOnly) {
    // 富文本只读态呈现净化后 HTML（而非把 HTML 源码塞进禁用输入框），与 Detail 同一口径
    if (field.type === "richtext") {
      return <RichTextView html={asInputString(value)} />;
    }
    // 状态字段只读展示走徽标（包二）：文本取枚举标签（无标签时即原值），空值维持禁用框原貌
    if (field.key === "status" && asInputString(value)) {
      const rawText = asInputString(value);
      const text =
        field.options?.find((o) => o.value === rawText)?.label ?? rawText;
      return <StatusBadge raw={value} text={text} colors={statusColors} />;
    }
    return (
      <Input
        disabled
        size={size}
        style={fullWidth}
        value={asInputString(value)}
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return (
        <Checkbox
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "enum": {
      const current = asInputString(value);
      return (
        <Select
          style={fullWidth}
          size={size}
          value={current === "" ? undefined : current}
          placeholder="（请选择）"
          allowClear={!field.required}
          onChange={(v) => onChange(v ?? "")}
          options={(field.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      );
    }
    case "ref": {
      const current = asInputString(value);
      const known = refOptions.some((o) => o.value === current);
      const options = [
        // 当前值不在选项表里时（如选项尚未加载完）先以原值兜底成一项，避免显示空
        ...(!known && current ? [{ value: current, label: current }] : []),
        ...refOptions.map((o) => ({ value: o.value, label: o.label })),
      ];
      return (
        <Select
          style={fullWidth}
          size={size}
          value={current === "" ? undefined : current}
          placeholder="（请选择）"
          allowClear={!field.required}
          showSearch
          optionFilterProp="label"
          onChange={(v) => onChange(v ?? "")}
          options={options}
        />
      );
    }
    case "text":
      return (
        <Input.TextArea
          style={fullWidth}
          autoSize={{ minRows: 3, maxRows: 8 }}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "richtext":
      return (
        <RichTextInput
          value={value}
          onChange={onChange}
          adapter={adapter}
          fieldKey={field.key}
          linkage={linkage}
        />
      );
    case "json":
      return (
        <Input.TextArea
          style={fullWidth}
          autoSize={{ minRows: 3, maxRows: 8 }}
          value={
            typeof value === "string"
              ? value
              : value === undefined || value === null
                ? ""
                : JSON.stringify(value)
          }
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date": {
      const d = value ? dayjs(asInputString(value)) : null;
      return (
        <DatePicker
          style={fullWidth}
          size={size}
          value={d && d.isValid() ? d : null}
          onChange={(v: Dayjs | null) =>
            onChange(v ? v.format("YYYY-MM-DD") : "")
          }
        />
      );
    }
    case "datetime": {
      const d = value ? dayjs(asInputString(value)) : null;
      return (
        <DatePicker
          showTime
          style={fullWidth}
          size={size}
          value={d && d.isValid() ? d : null}
          onChange={(v: Dayjs | null) =>
            onChange(v ? v.format("YYYY-MM-DDTHH:mm") : "")
          }
        />
      );
    }
    case "int":
      return (
        <InputNumber
          style={fullWidth}
          size={size}
          step={1}
          value={asNumber(value)}
          onChange={(v) => onChange(v ?? "")}
        />
      );
    case "decimal":
      return (
        <InputNumber
          style={fullWidth}
          size={size}
          step={0.01}
          value={asNumber(value)}
          onChange={(v) => onChange(v ?? "")}
        />
      );
    case "file":
    case "image":
      return (
        <AssetUploadInput
          field={field}
          value={value}
          onChange={onChange}
          adapter={adapter}
          size={size}
          linkage={linkage}
        />
      );
    default:
      // string：文本输入（壳内接扫码填充，见 TextFieldInput）
      return (
        <TextFieldInput
          value={value}
          onChange={onChange}
          size={size}
          inChild={inChild}
        />
      );
  }
}
