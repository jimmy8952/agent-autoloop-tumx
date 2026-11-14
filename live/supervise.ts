// 监工 AI：事件驱动的答题员+升级员。铁律：只在离散事件上唤醒大脑（每 poll 看屏的是程序不是 AI）；
// 判决校验不过或大脑超时一律降级找人；执行通道只有 answer.txt 和桌面通知，绝不直接敲 TUI。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LiveConfig } from "./config.ts";
import * as mb from "./mailbox.ts";
import { notify } from "./notify.ts";
import { parseVerdict, type Verdict } from "./verdict.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 同一问题的重判间隔（拍）：判了 wait 之后过这么久还挂着，才允许再问大脑一次。 */
const RECHECK_POLLS = 30;

function brainPrompt(task: string, question: { question: string; options: string[] }, events: string): string {
  return [
    "你是 live 会话的监工。干活者（另一个 AI）正在 tmux 里执行下面的任务，现在在屏幕上问人一个问题，由你替人拿主意。",
    "",
    "【任务全文】",
    task.slice(0, 4000),
    "",
    "【它问的问题】",
    question.question,
    "",
    "【选项】",
    ...question.options.map((option, index) => `${index + 1}. ${option}`),
    "",
    "【最近事件】",
    events || "（无）",
    "",
    "只输出一个 JSON 对象，不要输出任何别的文字：",
    '- 替人答题：{"action":"answer","value":"选项序号或答案文本","reason":"为什么"}',
    '- 必须人亲自处理：{"action":"notify","title":"一句话","text":"要人做什么","reason":"为什么不能自动答"}',
    '- 现在不动手更好：{"action":"wait","reason":"在等什么"}',
    "拿不准就 notify，绝不猜。",
  ].join("\n");
}

function askBrain(config: LiveConfig, prompt: string): Verdict | null {
  const supervisor = config.supervisor ?? {};
  const run = spawnSync(
    supervisor.program ?? "claude",
    [...(supervisor.model ? ["--model", supervisor.model] : []), "-p", prompt],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (run.error || run.status !== 0) return null;
  return parseVerdict(run.stdout ?? "");
}

export async function supervise(runDir: string, config: LiveConfig, dryRun: boolean, once: boolean) {
  const maxVerdicts = config.supervisor?.maxVerdictsPerQuestion ?? 2;
  const eventsFile = path.join(runDir, "events.jsonl");
  const recent = () => (existsSync(eventsFile) ? readFileSync(eventsFile, "utf8").trim().split("\n").slice(-8).join("\n") : "");
  const task = () => {
    const file = path.join(mb.mailboxOf(runDir), "task.md");
    return existsSync(file) ? readFileSync(file, "utf8") : "";
  };
  // dry-run 的意义就是打印判决看它想干什么，只是不落键不通知。
  const say = (line: string) => console.log(line);
  let questionFp = "";
  let verdicts = 0;
  let verdictAt = 0;
  let pollsSinceVerdict = 0;
  let stuckTold = false;
  const act = (verdict: Verdict | null, context: string) => {
    if (verdict === null) {
      mb.logEvent(runDir, "supervisor", `判决无效，降级找人：${context}`);
      say(`[监工] 判决无效（${context}），已转人工：${context}`);
      if (!dryRun) notify(`live 监工无能为力`, `大脑判决无效或超时：${context}`);
      return;
    }
    mb.logEvent(runDir, "supervisor", `判决 ${verdict.action}：${verdict.reason}`);
    say(`[监工] ${verdict.action}：${verdict.reason}`);
    if (dryRun) return;
    if (verdict.action === "answer") {
      writeFileSync(path.join(mb.mailboxOf(runDir), "answer.txt"), verdict.value);
      notify("live 监工已代答", `${verdict.value}（${verdict.reason}）`);
    } else if (verdict.action === "notify") {
      notify(verdict.title, verdict.text);
    }
  };
  while (true) {
    const state = mb.readState(runDir);
    if (!state) return console.log("run 目录没有状态，监工退出。");
    if (["done", "dead", "stopped"].includes(state.state)) {
      mb.logEvent(runDir, "supervisor", `终态 ${state.state}，监工退场`);
      return console.log(`终态 ${state.state}，监工退场。`);
    }
    if (state.state === "question" && state.question) {
      const fp = mb.sha1(state.question.question + state.question.options.join("|"));
      if (fp !== questionFp) {
        questionFp = fp;
        verdicts = 0;
        pollsSinceVerdict = RECHECK_POLLS;
      }
      const canRetry = verdicts > 0 && pollsSinceVerdict >= RECHECK_POLLS;
      if (verdicts < maxVerdicts && (verdicts === 0 || canRetry)) {
        verdicts++;
        pollsSinceVerdict = 0;
        act(
          askBrain(config, brainPrompt(task(), state.question, recent())),
          state.question.question.slice(0, 80),
        );
      }
      if (verdicts >= maxVerdicts && pollsSinceVerdict >= RECHECK_POLLS) {
        // 次数用完还挂着：降级提示一次，之后只等人。
        pollsSinceVerdict = -Infinity;
        act(null, `同一问题已判决 ${verdicts} 次仍未解决`);
      }
    } else if (state.state === "stuck" && !stuckTold) {
      stuckTold = true;
      act(
        askBrain(
          config,
          [
            "你是 live 会话的监工。干活者催单后仍无响应，疑似卡死。",
            "",
            "【任务全文】",
            task().slice(0, 4000),
            "",
            "【最近事件】",
            recent(),
            "",
            '只输出一个 JSON：{"action":"notify","title":"…","text":"建议人怎么做","reason":"…"} 或 {"action":"wait","reason":"…"}',
          ].join("\n"),
        ),
        "催单后无响应",
      );
    } else if (state.state === "working") {
      stuckTold = false;
    }
    pollsSinceVerdict++;
    if (once) return console.log("--once：看完这一拍就退。");
    await sleep(config.poll * 1000);
  }
}
