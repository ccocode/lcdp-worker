import { useEffect, useState } from "react";
import type { Field } from "@naka1205/schema";
import { Checkbox, DatePicker, Input, InputNumber, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { RuntimeAdapter, SelectOption } from "./adapter.js";

interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  adapter: RuntimeAdapter;
  /** 子表单元格内使用紧凑尺寸 */
  inChild?: boolean;
  readOnly?: boolean;
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
    default:
      // string / file / image：先用文本输入承载（文件上传走 R2 在后续阶段接入）
      return (
        <Input
          style={fullWidth}
          size={size}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
