// run 目录与 mailbox 信箱：文件通道只管终态（DONE/receipt），提问中转（question/answer）也借住在这里。
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export const RUNS_ROOT = path.join(homedir(), ".agent-autoloop", "worker", "runs");

export type LiveState = {
  name: string;
  runDir: string;
  session: string;
  state: "launching" | "working" | "question" | "suspect" | "nudged" | "stuck" | "done" | "dead" | "stopped";
  startedAt: string;
  stateSince: string;
  lastBeat: string;
  question?: { question: string; options: string[] };
  lastAction?: string;
  error?: string;
};

export function sessionName(name: string): string {
  return `live-${name}`;
}

export function newRunDir(name: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dir = path.join(RUNS_ROOT, `live-${stamp}-${name}`);
  mkdirSync(path.join(dir, "mailbox"), { recursive: true });
  return dir;
}

export function mailboxOf(runDir: string): string {
  return path.join(runDir, "mailbox");
}

export function stateFile(runDir: string): string {
  return path.join(runDir, "state.json");
}

export function readState(runDir: string): LiveState | null {
  const file = stateFile(runDir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as LiveState;
}

export function writeState(state: LiveState) {
  writeFileSync(stateFile(state.runDir), JSON.stringify(state, null, 2));
}

/** 观察事件流水：P1 的 why 回放，P2 入核时的现成事件源。 */
export function logEvent(runDir: string, type: string, detail: string) {
  appendFileSync(path.join(runDir, "events.jsonl"), `${new Date().toISOString()}\t${type}\t${detail.replace(/\n/g, " ")}\n`);
}

export const CONTRACT = (mailbox: string) => `【live 会话契约】
1. 需要人拍板时，用 AskUserQuestion 工具提问：一次一个问题、选项精炼（不超过 4 个）。
2. 完成全部工作后，两个动作缺一不可：
   a. 写回执到 ${mailbox}/receipt.md —— 内容是一个 \`\`\`agent-autoloop 代码块，JSON 五选一或组合：
      {"resolve":"结案一句话"} / {"notice":"通报一件事"} / {"ask":{"title":"…","text":"…","options":["…"]}} / {"later":"等什么"} / {"events":["…"]}
   b. 然后 touch ${mailbox}/DONE 创建空文件。
3. 上述路径在你机器上原样可用（同路径挂载）。提问用中文。

以下是任务正文：
`;

export const NUDGE = (mailbox: string) => `【哨兵催单】画面长时间没有动静。如果你已完成全部工作：写 ${mailbox}/receipt.md 并 touch ${mailbox}/DONE（两步都要）。如果卡住了：用 AskUserQuestion 说明困难提问。如果还在正常工作：继续，忽略本条。`;

export function taskPrompt(runDir: string, promptFile: string): string {
  return CONTRACT(mailboxOf(runDir)) + readFileSync(promptFile, "utf8");
}

export function writeTask(runDir: string, prompt: string) {
  writeFileSync(path.join(mailboxOf(runDir), "task.md"), prompt);
}

export function writeQuestion(runDir: string, question: { question: string; options: string[] }) {
  writeFileSync(
    path.join(mailboxOf(runDir), "question.json"),
    JSON.stringify({ ...question, askedAt: new Date().toISOString() }, null, 2),
  );
}

export function takeAnswer(runDir: string): string | null {
  const file = path.join(mailboxOf(runDir), "answer.txt");
  if (!existsSync(file)) return null;
  const answer = readFileSync(file, "utf8").trim();
  rmSync(file);
  return answer;
}

export function doneExists(runDir: string): boolean {
  return existsSync(path.join(mailboxOf(runDir), "DONE"));
}

export function readReceipt(runDir: string): string {
  const file = path.join(mailboxOf(runDir), "receipt.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export function stopRequested(runDir: string): boolean {
  return existsSync(path.join(mailboxOf(runDir), "STOP"));
}

export function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}
