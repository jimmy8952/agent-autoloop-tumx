// 观察循环：状态机 + 竞态防护。铁律：一切按键都在屏幕"稳定拍"之后发出（实测 Enter 会丢）。
import { writeFileSync } from "node:fs";
import path from "node:path";
import * as session from "./session.ts";
import * as patterns from "./patterns.ts";
import { notify } from "./notify.ts";
import type { LiveConfig } from "./config.ts";
import * as mb from "./mailbox.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 粘贴文本并提交。Enter 会丢是踩过的坑，所以确认画面离开草稿态才算提交成功。 */
async function pasteAndSubmit(name: string, file: string, config: LiveConfig) {
  session.pasteFile(name, file);
  await sleep(600);
  for (let attempt = 0; attempt < 4; attempt++) {
    session.sendKeys(name, ["Enter"]);
    await sleep(config.poll * 1000);
    const screen = session.capture(name);
    if (patterns.bareInputBox(screen) || patterns.matchQuestion(screen) || patterns.matchTrust(screen)) return;
  }
  throw new Error("提交失败：消息始终留在输入框，Enter 发了 4 次都没走");
}

/** 人路径第一站：等交互 shell 提示符稳定，再像人一样敲入 claude 命令（环境由 .bashrc 全套产出）。 */
async function shellThenClaude(name: string, config: LiveConfig) {
  const deadline = Date.now() + 60_000;
  let ready = 0;
  while (Date.now() < deadline) {
    if (patterns.shellPrompt(session.capture(name))) ready++;
    else ready = 0;
    if (ready >= config.stablePolls) break;
    await sleep(1000);
  }
  if (ready < config.stablePolls) throw new Error("60 秒内 shell 提示符没出现（看 live.log）");
  session.sendLiteral(name, config.claudeCommand);
  session.sendKeys(name, ["Enter"]);
}

/** 起 tmux 会话后的就绪等待：人路径先过 shell 提示符再敲 claude；然后处理信任弹窗，等裸输入框稳定出现，注入任务。 */
export async function launch(runDir: string, config: LiveConfig) {
  const name = mb.readState(runDir)!.session;
  if (config.claudeCommand) await shellThenClaude(name, config);
  const deadline = Date.now() + 180_000;
  let ready = 0;
  while (Date.now() < deadline) {
    const screen = session.capture(name);
    const confirm = patterns.confirmKeys(screen);
    if (confirm) {
      session.sendKeys(name, confirm);
      await sleep(1500);
      ready = 0;
      continue;
    }
    if (patterns.bareInputBox(screen)) {
      ready++;
    } else {
      ready = 0;
      const onboarding = patterns.onboardingKeys(screen);
      if (onboarding) session.sendKeys(name, onboarding);
    }
    if (ready >= config.stablePolls) break;
    await sleep(1000);
  }
  if (ready < config.stablePolls) throw new Error("180 秒内 TUI 没就绪（看 live.log）");
  await pasteAndSubmit(name, path.join(mb.mailboxOf(runDir), "task.md"), config);
}

/** 代答提问：纯数字=选序号；其他文字=走 "Type something" 输入框粘贴。 */
async function answerQuestion(runDir: string, name: string, answer: string, config: LiveConfig) {
  if (/^\d+$/.test(answer)) {
    session.sendKeys(name, [answer, "Enter"]);
    return;
  }
  const file = path.join(mb.mailboxOf(runDir), "answer-paste.txt");
  writeFileSync(file, answer);
  session.sendKeys(name, ["4", "Enter"]);
  await sleep(1500);
  session.pasteFile(name, file);
  await sleep(600);
  session.sendKeys(name, ["Enter"]);
  await sleep(config.poll * 1000);
  session.sendKeys(name, ["Enter"]);
}

export async function watch(runDir: string, config: LiveConfig) {
  const state = mb.readState(runDir)!;
  const name = state.session;
  let lastFp = "";
  let stableCount = 0;
  let suspectAt = 0;
  let nudgedAt = 0;
  let stuckTold = false;
  let lastQuestionFp = "";
  const setState = (value: mb.LiveState["state"], action: string) => {
    state.state = value;
    state.stateSince = new Date().toISOString();
    state.lastAction = action;
    state.lastBeat = new Date().toISOString();
    mb.logEvent(runDir, value, action);
    mb.writeState(state);
  };
  setState("working", "watcher 接管");
  while (true) {
    state.lastBeat = new Date().toISOString();
    mb.writeState(state);
    if (mb.stopRequested(runDir)) {
      setState("stopped", "收到 stop 命令");
      notify(`live ${state.name} 已停`, "watcher 退出，tmux 会话保留（--kill 才杀）");
      return;
    }
    if (!session.sessionAlive(name)) {
      setState("dead", "tmux 会话消失");
      notify(`live ${state.name} 异常结束`, "tmux 会话没了（claude 退出或被杀）。经过看 live.log");
      return;
    }
    if (mb.doneExists(runDir)) {
      const receipt = mb.readReceipt(runDir).trim();
      state.question = undefined;
      setState("done", receipt ? "收割回执" : "DONE 存在但没有 receipt.md");
      // kernel 轮次的终态交给 worker 的 Result（卡片/记录），桌面通知反而误导"已完成"。
      if (!config.kernel)
        notify(`live ${state.name} 完成`, receipt.slice(0, 120).replace(/\n/g, " ") || "DONE 存在但 receipt.md 为空");
      if (config.killOnDone) session.killSession(name);
      return;
    }
    let screen: string;
    try {
      screen = session.capture(name);
    } catch {
      continue; // 会话在存活检查和抓屏之间没了，下一轮死亡分支会接住
    }
    const question = patterns.matchQuestion(screen);
    if (question) {
      const qFp = mb.sha1(question.question + question.options.join("|"));
      if (state.state !== "question" || qFp !== lastQuestionFp) {
        lastQuestionFp = qFp;
        state.question = question;
        setState("question", question.question);
        mb.writeQuestion(runDir, question);
        notify(`live ${state.name} 在问你`, `${question.question} → live-sentinel answer ${state.name} <序号>`);
      }
      if (stableCount >= config.stablePolls - 1) {
        const answer = mb.takeAnswer(runDir);
        if (answer !== null) {
          await answerQuestion(runDir, name, answer, config);
          setState("working", `已代答：${answer.slice(0, 50)}`);
          notify(`live ${state.name} 已代答`, answer.slice(0, 100));
        }
      }
      stableCount = 0;
    } else if (state.state === "question") {
      state.question = undefined;
      setState("working", "提问画面消失");
      stableCount = 0;
    } else if (patterns.matchTrust(screen)) {
      const confirm = patterns.confirmKeys(screen)!;
      if (stableCount >= config.stablePolls) session.sendKeys(name, confirm);
    } else if (patterns.bareInputBox(screen) && stableCount >= config.idlePolls) {
      const now = Date.now();
      if (state.state !== "suspect" && state.state !== "stuck") {
        suspectAt = now;
        setState("suspect", "画面长时间无动静");
      }
      const nudgeMs = config.nudgeAfterMin * 60_000;
      if (nudgedAt === 0 && now - suspectAt >= nudgeMs) {
        const file = path.join(mb.mailboxOf(runDir), "nudge.md");
        writeFileSync(file, mb.NUDGE(mb.mailboxOf(runDir)));
        await pasteAndSubmit(name, file, config);
        nudgedAt = now;
        setState("nudged", "发出催单");
        notify(`live ${state.name} 长时间没动静`, "已自动催单：要求交回执或说明困难");
        stableCount = 0;
      } else if (nudgedAt !== 0 && now - nudgedAt >= nudgeMs && !stuckTold) {
        stuckTold = true;
        setState("stuck", "催单后仍无响应");
        notify(`live ${state.name} 疑似卡死`, "催单后仍无响应。建议 tmux attach -t " + name + " 人工查看");
      }
    } else if (state.state === "suspect" || state.state === "stuck" || state.state === "nudged") {
      setState("working", "画面恢复动静");
      nudgedAt = 0;
      stuckTold = false;
    }
    const fp = mb.sha1(screen);
    if (fp === lastFp) stableCount++;
    else stableCount = 0;
    lastFp = fp;
    await sleep(config.poll * 1000);
  }
}
