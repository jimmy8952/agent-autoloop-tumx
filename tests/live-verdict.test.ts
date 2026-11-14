// 监工判决解析：正样本要宽松（大脑爱裹话），负样本要严（校验不过就降级找人）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVerdict } from "../live/verdict.ts";

test("纯 JSON 三种判决都认", () => {
  assert.deepEqual(parseVerdict('{"action":"answer","value":"2","reason":"统计口径，选 2"}'), {
    action: "answer",
    value: "2",
    reason: "统计口径，选 2",
  });
  assert.equal(parseVerdict('{"action":"wait","reason":"缺上下文，先等"}')?.action, "wait");
  assert.equal(
    parseVerdict('{"action":"notify","title":"卡死","text":"请 attach 查看","reason":"重试无效"}')?.action,
    "notify",
  );
});

test("裹了说明文字或围栏也能抓", () => {
  const said = '我认为该选第一个。\n```json\n{"action":"answer","value":"1","reason":"任务明确要求"}\n```';
  assert.equal(parseVerdict(said)?.action, "answer");
});

test("非法判决一律无效：未知 action、缺 value、空文本、非 JSON", () => {
  assert.equal(parseVerdict('{"action":"kill","reason":"x"}'), null);
  assert.equal(parseVerdict('{"action":"answer","reason":"没有 value"}'), null);
  assert.equal(parseVerdict('{"action":"notify","title":"","text":"空标题","reason":"x"}'), null);
  assert.equal(parseVerdict('{"action":"wait"}'), null);
  assert.equal(parseVerdict("大脑过载，无法回答"), null);
  assert.equal(parseVerdict(""), null);
  assert.equal(parseVerdict('["answer","2"]'), null);
});

test("answer 的 value 保序不折断：答案文本按原样传递", () => {
  assert.equal(parseVerdict('{"action":"answer","value":"用 1080p 版本","reason":"r"}')?.value, "用 1080p 版本");
});
