// 粘贴通道预算铁律：TUI 输入框保尾丢头截断（实测 5.5KB→687 字符），所以注入的引导必须短、且指向 task.md 全文。
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOTSTRAP } from "../live/mailbox.ts";

const PASTE_BUDGET_BYTES = 2000;

test("bootstrap 在粘贴预算内（超了就会被 TUI 截头）", () => {
  const text = BOOTSTRAP("/Users/jimmy/.agent-autoloop/worker/runs/9-1/mailbox");
  assert.ok(Buffer.byteLength(text, "utf8") < PASTE_BUDGET_BYTES, `${Buffer.byteLength(text, "utf8")} 字节超预算`);
});

test("bootstrap 指向 task.md 且交代两个收尾动作", () => {
  const text = BOOTSTRAP("/mb");
  assert.match(text, /\/mb\/task\.md/);
  assert.match(text, /receipt\.md/);
  assert.match(text, /DONE/);
  assert.match(text, /Read/);
});
