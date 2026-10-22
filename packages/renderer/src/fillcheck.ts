/**
 * 回填断言纯逻辑（第 85 步 F5 收口）：助手回填（fillForm）落定后，把确认卡
 * 意图与表单真实状态逐字段比对，结论分三态——已落 / 未落 / 无法核对。
 * 本文件无 React 依赖，全部函数为纯函数，供 EntityForm 断言段调用与单测。
 *
 * 口径要点（与旧断言的差别）：
 * - 标签解析范围 = 父实体 + 全部子实体；子表字段标签不再被误判未落，
 *   任何实体都解析不到的标签归「无法核对」，绝不进未落。
 * - 比对源是回填后的表单实值（主表 values / 子表 childRows），不是提案值本身。
 * - 日期按同日判定、日期时间按同一时刻判定；子表小计（amount）允许
 *   数量×单价四舍五入 2 位的汇总补算值。
 */
import dayjs from "dayjs";
import type { Entity, Field } from "@naka1205/schema";
import type { Row } from "./adapter.js";

/** 空值口径：null / undefined / 空串视为无值 */
export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export interface ResolvedLabelField {
  field: Field;
  /** 归属实体（父实体或某个子实体） */
  owner: Entity;
  /** 是否子实体字段 */
  isChild: boolean;
}

/**
 * 标签→字段解析：先在父实体、再在各子实体里精确匹配 label；
 * 精确无果时做包含近似匹配（容忍提案标签与字段标签的包含关系），
 * 全部候选唯一命中才采信，多义或无命中返回 null（调用方归无法核对）。
 */
export function resolveLabelField(
  label: string,
  parent: Entity,
  children: Entity[],
): ResolvedLabelField | null {
  const scopes: { owner: Entity; isChild: boolean }[] = [
    { owner: parent, isChild: false },
    ...children.map((c) => ({ owner: c, isChild: true })),
  ];
  for (const s of scopes) {
    const f = s.owner.fields.find((x) => x.label === label);
    if (f) return { field: f, owner: s.owner, isChild: s.isChild };
  }
  const cands: ResolvedLabelField[] = [];
  for (const s of scopes) {
    for (const f of s.owner.fields) {
      if (f.label.includes(label) || label.includes(f.label)) {
        cands.push({ field: f, owner: s.owner, isChild: s.isChild });
      }
    }
  }
  return cands.length === 1 ? cands[0]! : null;
}

function parseDateLike(v: unknown): dayjs.Dayjs | null {
  if (typeof v !== "string" && typeof v !== "number" && !(v instanceof Date)) {
    return null;
  }
  const d = dayjs(v as string);
  return d.isValid() ? d : null;
}

/** 同日判定：两值都可解析且 YYYY-MM-DD 相等（任一为空或不可解析为 false） */
export function sameDay(a: unknown, b: unknown): boolean {
  const da = parseDateLike(a);
  const db = parseDateLike(b);
  if (!da || !db) return false;
  return da.format("YYYY-MM-DD") === db.format("YYYY-MM-DD");
}

/** 同一时刻判定：两值都可解析且秒级时刻相等 */
export function sameMoment(a: unknown, b: unknown): boolean {
  const da = parseDateLike(a);
  const db = parseDateLike(b);
  if (!da || !db) return false;
  return da.format("YYYY-MM-DD HH:mm:ss") === db.format("YYYY-MM-DD HH:mm:ss");
}

export type FieldCheckResult = "landed" | "missed" | "unverifiable";

export interface CheckFieldOptions {
  /**
   * ref 字段的合法选项 id 集合（调用方拉取引用选项成功后传入）：
   * 实际值不在集合内判未落。未传时 ref 只做 id 字符串直比。
   */
  optionValues?: string[];
  /**
   * 子表 amount 的汇总补算期望值（数量×单价四舍五入 2 位）：
   * 实际值等于意图值或补算值任一即判已落。
   */
  rollupAlt?: number;
}

function normBool(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "true") return true;
  if (v === false || v === 0 || v === "false") return false;
  return null;
}

/**
 * 逐字段落位判定：intent = 意图原值，actual = 回填后表单实值。
 * - actual 为空 → missed（有意图而表单无值）。
 * - date 同日 / datetime 同一时刻；意图本身不可解析 → unverifiable，
 *   表单值不可解析 → missed。
 * - int/decimal 数值比对；enum 比选项值；ref 比 id 字符串（有 optionValues
 *   时实际值还须命中集合）；其余类型按字符串（对象按 JSON）比对。
 */
export function checkFieldValue(
  field: Field,
  intent: unknown,
  actual: unknown,
  opts: CheckFieldOptions = {},
): FieldCheckResult {
  if (isEmptyValue(actual)) return "missed";
  switch (field.type) {
    case "date": {
      if (!parseDateLike(intent)) return "unverifiable";
      if (!parseDateLike(actual)) return "missed";
      return sameDay(intent, actual) ? "landed" : "missed";
    }
    case "datetime": {
      if (!parseDateLike(intent)) return "unverifiable";
      if (!parseDateLike(actual)) return "missed";
      return sameMoment(intent, actual) ? "landed" : "missed";
    }
    case "int":
    case "decimal": {
      const ni = Number(intent);
      if (!Number.isFinite(ni)) return "unverifiable";
      const na = Number(actual);
      if (!Number.isFinite(na)) return "missed";
      if (Math.abs(na - ni) < 1e-9) return "landed";
      if (
        opts.rollupAlt !== undefined &&
        Math.round(na * 100) / 100 === opts.rollupAlt
      ) {
        return "landed";
      }
      return "missed";
    }
    case "enum": {
      const values = (field.options ?? []).map((o) => o.value);
      if (values.length > 0) {
        return values.includes(String(actual)) ? "landed" : "missed";
      }
      return String(actual) === String(intent) ? "landed" : "missed";
    }
    case "ref": {
      if (
        opts.optionValues &&
        opts.optionValues.length > 0 &&
        !opts.optionValues.includes(String(actual))
      ) {
        return "missed";
      }
      return String(actual) === String(intent) ? "landed" : "missed";
    }
    case "boolean": {
      const bi = normBool(intent);
      const ba = normBool(actual);
      if (bi !== null && ba !== null) return bi === ba ? "landed" : "missed";
      return String(actual) === String(intent) ? "landed" : "missed";
    }
    default: {
      if (typeof intent === "object" || typeof actual === "object") {
        return JSON.stringify(actual) === JSON.stringify(intent)
          ? "landed"
          : "missed";
      }
      return String(actual) === String(intent) ? "landed" : "missed";
    }
  }
}

export interface ChildRowMatch {
  pairs: { intent: Row; actual: Row }[];
  unmatchedIntent: Row[];
}

/**
 * 子表行匹配：先按 ref 字段 id 匹配（意图行带非空 ref 字段时，找 ref 全等
 * 的未用实存行）；未命中（含无 ref 可匹配）的意图行按序位与剩余实存行
 * 配对；实存行不足的意图行进 unmatchedIntent。
 */
export function matchChildRows(
  child: Entity,
  intentRows: Row[],
  actualRows: Row[],
): ChildRowMatch {
  const refFields = child.fields.filter(
    (f) => f.type === "ref" && f.key !== child.parentField,
  );
  const used = new Set<number>();
  const pairs: { intent: Row; actual: Row }[] = [];
  const rest: Row[] = [];
  for (const row of intentRows) {
    const keys = refFields.filter((f) => !isEmptyValue(row[f.key]));
    let hit = -1;
    if (keys.length > 0) {
      hit = actualRows.findIndex(
        (a, i) =>
          !used.has(i) &&
          keys.every((f) => String(a[f.key]) === String(row[f.key])),
      );
    }
    if (hit >= 0) {
      used.add(hit);
      pairs.push({ intent: row, actual: actualRows[hit]! });
    } else {
      rest.push(row);
    }
  }
  const freeActual = actualRows.filter((_, i) => !used.has(i));
  const unmatchedIntent: Row[] = [];
  rest.forEach((row, i) => {
    const a = freeActual[i];
    if (a) pairs.push({ intent: row, actual: a });
    else unmatchedIntent.push(row);
  });
  return { pairs, unmatchedIntent };
}

export interface ChildRowsCheck {
  missedLabels: string[];
  unverifiableLabels: string[];
}

/**
 * 子表逐行逐字段核对：意图行与回填后实存行匹配后逐字段判落位
 * （父键字段是关联键、不作内容核对；amount 带汇总补算口径）。
 * 匹配不到实存行的意图行，其全部非空字段记未落。
 */
export function checkChildRows(
  child: Entity,
  intentRows: Row[],
  actualRows: Row[],
): ChildRowsCheck {
  const missedLabels: string[] = [];
  const unverifiableLabels: string[] = [];
  const push = (list: string[], label: string) => {
    if (label && !list.includes(label)) list.push(label);
  };
  const checkRow = (intent: Row, actual: Row | null) => {
    for (const field of child.fields) {
      if (child.parentField && field.key === child.parentField) continue;
      const intentVal = intent[field.key];
      if (isEmptyValue(intentVal)) continue;
      if (!actual) {
        push(missedLabels, field.label);
        continue;
      }
      let rollupAlt: number | undefined;
      if (field.key === "amount") {
        const q = Number(intent.quantity);
        const p = Number(intent.unit_price);
        if (Number.isFinite(q) && Number.isFinite(p)) {
          rollupAlt = Math.round(q * p * 100) / 100;
        }
      }
      const r = checkFieldValue(field, intentVal, actual[field.key], {
        rollupAlt,
      });
      if (r === "missed") push(missedLabels, field.label);
      else if (r === "unverifiable") push(unverifiableLabels, field.label);
    }
  };
  const { pairs, unmatchedIntent } = matchChildRows(
    child,
    intentRows,
    actualRows,
  );
  for (const p of pairs) checkRow(p.intent, p.actual);
  for (const row of unmatchedIntent) checkRow(row, null);
  return { missedLabels, unverifiableLabels };
}
