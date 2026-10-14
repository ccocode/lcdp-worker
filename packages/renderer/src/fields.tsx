import { useEffect, useState } from "react";
import type { Field } from "@naka1205/schema";
import type { RuntimeAdapter, SelectOption } from "./adapter.js";
import { styles } from "./styles.js";

interface FieldInputProps {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  adapter: RuntimeAdapter;
  /** 子表单元格内使用紧凑样式 */
  inChild?: boolean;
  readOnly?: boolean;
}

/** 把任意值规整成 input 可用的字符串（日期截到日，时间截到分） */
function asInputString(value: unknown, slice?: number): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  return slice ? s.slice(0, slice) : s;
}

/**
 * 字段输入控件：按 Schema 字段类型渲染（M1 覆盖全部字段类型）。
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
  const style = inChild ? styles.childInput : styles.input;

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
      <input
        style={style}
        value={asInputString(value)}
        readOnly
        disabled
      />
    );
  }

  switch (field.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case "enum": {
      const opts = field.options ?? [];
      return (
        <select
          style={style}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">（请选择）</option>}
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "ref": {
      const current = asInputString(value);
      const known = refOptions.some((o) => o.value === current);
      return (
        <select
          style={style}
          value={current}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">（请选择）</option>}
          {!known && current && <option value={current}>{current}</option>}
          {refOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "text":
      return (
        <textarea
          style={inChild ? styles.childInput : styles.textarea}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "json":
      return (
        <textarea
          style={inChild ? styles.childInput : styles.textarea}
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
    case "date":
      return (
        <input
          type="date"
          style={style}
          value={asInputString(value, 10)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          style={style}
          value={asInputString(value, 16)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "int":
      return (
        <input
          type="number"
          step="1"
          style={style}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "decimal":
      return (
        <input
          type="number"
          step="any"
          style={style}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      // string / file / image：M1 先用文本输入承载（文件上传走 R2 在后续阶段接入）
      return (
        <input
          type="text"
          style={style}
          value={asInputString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
