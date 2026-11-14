// 桥接终态合同：finalText 的每行产出都要过 readMessage 这一关——首行语义（没跑成=自动重派）就是 kernel 协议。
import assert from "node:assert/strict";
import { test } from "node:test";
import { finalText } from "../live/finals.ts";
import { readMessage } from "../worker/contract.ts";

const detail = { runDir: "/tmp/runs/12-1", session: "live-k-abc", at: "2026-11-14T15:00:00Z" };

test("done：agent 的最后一条消息原样交接，回执块入账", () => {
  const receipt = [
    "已把统计报表写进 docs/统计.md。",
    "",
    "```agent-autoloop",
    '{"notice":[{"title":"报表更新","text":"新表已生成，请过目"}]}',
    "```",
  ].join("\n");
  const message = readMessage(finalText("done", { ...detail, receipt }));
  assert.equal(message.outcome, "done");
  assert.match(message.summary!, /统计报表/);
  assert.ok(Array.isArray((message.receipt as { notice: unknown[] }).notice));
});

test("done：agent 自己写“没事可做”按 nothing 入账", () => {
  const message = readMessage(finalText("done", { ...detail, receipt: "没事可做：今天没有新事件" }));
  assert.equal(message.outcome, "nothing");
});

test("done：agent 自己写“没跑成”按 failed 入账（自动重派语义透传）", () => {
  const message = readMessage(finalText("done", { ...detail, receipt: "没跑成：B 站接口超时" }));
  assert.equal(message.outcome, "failed");
  assert.match(message.error!, /B 站接口超时/);
});

test("done-no-receipt：DONE 了没写 receipt，按 failed 重派", () => {
  const message = readMessage(finalText("done-no-receipt", detail));
  assert.equal(message.outcome, "failed");
  assert.match(message.error!, /receipt\.md/);
});

test("launch-failed：注入前失败，failed 且原因在首行", () => {
  const message = readMessage(finalText("launch-failed", { ...detail, reason: "180 秒内 TUI 没就绪" }));
  assert.equal(message.outcome, "failed");
  assert.match(message.error!, /TUI 没就绪/);
  assert.match(message.error!, /尚未注入/);
});

test("dead：done 入账 + notice 卡片，绝不自动重派", () => {
  const message = readMessage(finalText("dead", detail));
  assert.equal(message.outcome, "done");
  const notice = (message.receipt as { notice: { title: string; text: string }[] }).notice;
  assert.match(notice[0].title, /异常中断/);
  assert.match(notice[0].text, /live\.log/);
});

test("timeout：done 入账 + notice 带接管入口", () => {
  const message = readMessage(finalText("timeout", detail));
  assert.equal(message.outcome, "done");
  const notice = (message.receipt as { notice: { title: string; text: string }[] }).notice;
  assert.match(notice[0].text, /tmux attach -t live-k-abc/);
});

test("stopped：done 入账，无回执", () => {
  const message = readMessage(finalText("stopped", detail));
  assert.equal(message.outcome, "done");
  assert.equal(message.receipt, undefined);
  assert.equal(message.problem, undefined);
});
