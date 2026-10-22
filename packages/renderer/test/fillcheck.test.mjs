// 回填断言纯逻辑单测（第 85 步）：从构建产物 dist/fillcheck.js 导入。
// 运行：先按链序构建（ui → renderer），再 `node --test test/fillcheck.test.mjs`。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkChildRows,
  checkFieldValue,
  matchChildRows,
  matchChildRowSummaryLabel,
  resolveLabelField,
  sameDay,
} from "../dist/fillcheck.js";

const parent = {
  key: "purchase_order",
  label: "采购单",
  fields: [
    { key: "supplier_id", label: "供应商", type: "ref", refEntity: "supplier" },
    { key: "order_date", label: "申请日期", type: "date" },
    { key: "total_amount", label: "总金额", type: "decimal" },
    { key: "status", label: "状态", type: "enum", options: [
      { value: "draft", label: "草稿" },
      { value: "submitted", label: "已提交" },
    ] },
  ],
};
const child = {
  key: "purchase_item",
  label: "采购明细",
  parentField: "order_id",
  fields: [
    { key: "order_id", label: "采购单", type: "ref", refEntity: "purchase_order" },
    { key: "material_id", label: "物料", type: "ref", refEntity: "material" },
    { key: "quantity", label: "数量", type: "int" },
    { key: "unit_price", label: "单价", type: "decimal" },
    { key: "amount", label: "小计", type: "decimal" },
  ],
};
const noteChild = {
  key: "order_note",
  label: "订单备注行",
  parentField: "order_id",
  fields: [
    { key: "order_id", label: "采购单", type: "ref", refEntity: "purchase_order" },
    { key: "note", label: "备注内容", type: "string" },
  ],
};
const f = (e, k) => e.fields.find((x) => x.key === k);

test("标签解析：子表字段标签解析到子实体", () => {
  const r = resolveLabelField("物料", parent, [child]);
  assert.equal(r.field.key, "material_id");
  assert.equal(r.isChild, true);
  assert.equal(r.owner.key, "purchase_item");
});

test("标签解析：父实体字段与未知标签", () => {
  const r = resolveLabelField("供应商", parent, [child]);
  assert.equal(r.field.key, "supplier_id");
  assert.equal(r.isChild, false);
  // 未知标签返回 null —— 调用方据此归入「无法核对」，绝不判未落
  assert.equal(resolveLabelField("不存在的字段", parent, [child]), null);
});

test("日期同日判定：同日/异日/空值/时刻串", () => {
  assert.equal(sameDay("2026-10-24", "2026-10-24"), true);
  assert.equal(sameDay("2026-10-24", "2026-10-24T15:30:00"), true);
  assert.equal(sameDay("2026-10-24", "2026-10-25"), false);
  assert.equal(sameDay("", "2026-10-24"), false);
  assert.equal(sameDay("2026-10-24", ""), false);
  assert.equal(sameDay("不是日期", "2026-10-24"), false);
});

test("逐字段判定：日期同日已落、异日未落、空值未落、意图不可解析无法核对", () => {
  const dateF = f(parent, "order_date");
  assert.equal(checkFieldValue(dateF, "2026-10-24", "2026-10-24"), "landed");
  assert.equal(
    checkFieldValue(dateF, "2026-10-24", "2026-10-24T09:00:00"),
    "landed",
  );
  assert.equal(checkFieldValue(dateF, "2026-10-24", "2026-10-23"), "missed");
  assert.equal(checkFieldValue(dateF, "2026-10-24", ""), "missed");
  assert.equal(checkFieldValue(dateF, "下周一", "2026-10-24"), "unverifiable");
});

test("逐字段判定：enum 比选项值、ref 比 id 与选项集合", () => {
  const statusF = f(parent, "status");
  assert.equal(checkFieldValue(statusF, "draft", "draft"), "landed");
  assert.equal(checkFieldValue(statusF, "draft", "bogus"), "missed");
  const supF = f(parent, "supplier_id");
  assert.equal(checkFieldValue(supF, "sup01", "sup01"), "landed");
  assert.equal(checkFieldValue(supF, "sup01", "sup02"), "missed");
  assert.equal(
    checkFieldValue(supF, "sup02", "sup02", { optionValues: ["sup01"] }),
    "missed",
  );
});

test("子表行匹配：按 ref id 匹配（乱序也能配对）", () => {
  const intent = [
    { material_id: "mat02", quantity: 5, unit_price: 100, amount: 500 },
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2400 },
  ];
  const actual = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2400 },
    { material_id: "mat02", quantity: 5, unit_price: 100, amount: 500 },
  ];
  const { pairs, unmatchedIntent } = matchChildRows(child, intent, actual);
  assert.equal(unmatchedIntent.length, 0);
  assert.equal(pairs.length, 2);
  for (const p of pairs) {
    assert.equal(p.intent.material_id, p.actual.material_id);
  }
  const res = checkChildRows(child, intent, actual);
  assert.deepEqual(res.missedLabels, []);
});

test("子表行匹配：无 ref 可匹配时按序位配对", () => {
  const intent = [{ note: "第一行" }, { note: "第二行" }];
  const actual = [{ note: "第一行" }, { note: "被改了" }];
  const { pairs } = matchChildRows(noteChild, intent, actual);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[1].actual.note, "被改了");
  const res = checkChildRows(noteChild, intent, actual);
  assert.deepEqual(res.missedLabels, ["备注内容"]);
});

test("子表小计：amount 允许数量×单价的汇总补算值", () => {
  // 意图小计写错（999），表单里是补算出的 2400 —— 按补算口径判已落
  const intent = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 999 },
  ];
  const actual = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2400 },
  ];
  assert.deepEqual(checkChildRows(child, intent, actual).missedLabels, []);
  // 实际小计既不等于意图值也不等于补算值 —— 未落
  const bad = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2300 },
  ];
  assert.deepEqual(checkChildRows(child, intent, bad).missedLabels, ["小计"]);
});

test("子表行缺失：意图行没有对应实存行时其字段记未落", () => {
  const intent = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2400 },
    { material_id: "mat02", quantity: 5, unit_price: 100, amount: 500 },
  ];
  const actual = [
    { material_id: "mat01", quantity: 10, unit_price: 240, amount: 2400 },
  ];
  const res = checkChildRows(child, intent, actual);
  assert.ok(res.missedLabels.includes("物料"));
  assert.ok(res.missedLabels.includes("数量"));
});

test("行摘要条目：明细序号标签唯一命中子实体", () => {
  // 模型给明细行造的汇总条目「明细1」「明细2」→ 子实体「采购明细」
  assert.equal(matchChildRowSummaryLabel("明细1", [child])?.key, "purchase_item");
  assert.equal(matchChildRowSummaryLabel("明细2", [child])?.key, "purchase_item");
  assert.equal(matchChildRowSummaryLabel("采购明细1", [child])?.key, "purchase_item");
  assert.equal(matchChildRowSummaryLabel("采购明细", [child])?.key, "purchase_item");
});

test("行摘要条目：无关标签不命中、多义不命中", () => {
  // 与子实体标签无包含关系的字段型标签不被吞掉（仍走无法核对）
  assert.equal(matchChildRowSummaryLabel("采购日期", [child]), null);
  assert.equal(matchChildRowSummaryLabel("备注", [child]), null);
  // 「明细」同时被两个子实体标签包含 → 多义返回 null，不冒认
  const child2 = { key: "purchase_item_old", label: "采购明细（旧）", fields: [] };
  assert.equal(matchChildRowSummaryLabel("明细1", [child, child2]), null);
  assert.equal(matchChildRowSummaryLabel("备注行1", [child, noteChild])?.key, "order_note");
});
