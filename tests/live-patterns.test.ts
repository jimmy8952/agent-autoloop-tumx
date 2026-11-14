// 哨兵模式库：每个正则都对着真实抓屏的夹具验，别对着想象中的屏幕调。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bareInputBox, confirmKeys, matchQuestion, matchTrust, onboardingKeys, shellPrompt } from "../live/patterns.ts";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", "live", name), "utf8");

test("提问画面：bypass 下 AskUserQuestion 完整渲染", () => {
  const screen = fixture("question-bypass.txt");
  const question = matchQuestion(screen);
  assert.ok(question, "应当识别出提问");
  assert.match(question.question, /测试提问是否渲染/);
  assert.ok(question.options.includes("甲方案"));
  assert.ok(question.options.some((option) => option.includes("Type something")));
  assert.equal(bareInputBox(screen), false);
  assert.equal(matchTrust(screen), false);
});

test("信任弹窗：页脚是 Enter to confirm，别认成提问", () => {
  const screen = fixture("trust.txt");
  assert.equal(matchTrust(screen), true);
  assert.deepEqual(confirmKeys(screen), ["Enter"], "光标在 Yes 上，直接 Enter");
  assert.equal(matchQuestion(screen), null);
  assert.equal(bareInputBox(screen), false);
});

test("信任弹窗无编号变体：光标默认在 No, exit 上，盲按数字会选成退出", () => {
  const screen = fixture("trust-unnumbered.txt");
  assert.equal(matchTrust(screen), true);
  assert.deepEqual(confirmKeys(screen), ["Down"], "先向下，等下一拍再 Enter");
});

test("bypass 首次接受框：同样导航到 Yes", () => {
  const screen = fixture("accept-bypass.txt");
  assert.deepEqual(confirmKeys(screen), ["Down"]);
});

test("引导画面只认已知长相", () => {
  assert.deepEqual(onboardingKeys("Press Enter to continue…"), ["Enter"]);
  assert.deepEqual(onboardingKeys("Syntax theme: Monokai Extended"), ["Enter"]);
  assert.equal(onboardingKeys("什么奇怪的屏幕"), null);
});

test("空闲画面：裸输入框，无提问无信任", () => {
  const screen = fixture("idle.txt");
  assert.equal(bareInputBox(screen), true);
  assert.equal(matchQuestion(screen), null);
  assert.equal(matchTrust(screen), false);
});

test("空闲画面（空会话变体）：输入框带随机占位提示也算空闲", () => {
  const screen = fixture("idle-placeholder.txt");
  assert.equal(bareInputBox(screen), true);
  assert.equal(matchQuestion(screen), null);
  assert.equal(matchTrust(screen), false);
});

test("空白与噪声不误报", () => {
  assert.equal(matchQuestion(""), null);
  assert.equal(matchTrust(""), false);
  assert.equal(bareInputBox(""), false);
});

test("shell 提示符：人路径第一站，最后一行 user@host:path#", () => {
  const screen = fixture("shell-prompt.txt");
  assert.equal(shellPrompt(screen), true);
  assert.equal(shellPrompt("Claude Code v2.1.325\n❯ Try \"fix lint errors\""), false);
  assert.equal(shellPrompt(""), false);
});
