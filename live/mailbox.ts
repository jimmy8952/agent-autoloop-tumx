// run 目录与 mailbox 信箱：文件通道只管终态（DONE/receipt），提问中转（question/answer）也借住在这里。
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOME } from "../host/home.ts";

export const RUNS_ROOT = path.join(HOME, "worker", "runs");

export type LiveState = {
  name: string;
  runDir: string;
  session: string;
  /** kernel 轮次（bridge 起的）：终态语义交给 worker，DONE 不再桌面通知。 */
  kernel?: boolean;
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

/** kernel 轮次的契约：receipt.md 是"最后一条消息"全文（首行结论 + 末尾回执块），readMessage 原样解析。
 * 提问走 kernel 的回合制（ask 回执→卡片→新轮次），不要用 AskUserQuestion 停在屏幕上等——那是独立 live 模式的语义。 */
export const KERNEL_CONTRACT = (mailbox: string) => `【live 会话契约】
1. 要问人就按下文任务正文里"怎么结束这一轮"的规范把问题写进回执 ask，然后收尾结束这一轮；不要用 AskUserQuestion 停在屏幕上等待（没有人在看屏幕）。
2. 完成全部工作后，两个动作缺一不可：
   a. 把你的"最后一条消息"全文写入 ${mailbox}/receipt.md——第一行是结论（按下文任务正文里的规范），末尾附 agent-autoloop 回执代码块（格式按下文的说明）；
   b. 然后 touch ${mailbox}/DONE 创建空文件。
3. 上述路径在你机器上原样可用（同路径挂载）。回执用中文。

以下是任务正文：
`;

/** TUI 输入框对粘贴有 ~2000 字节上限且保尾丢头（实测 5.5KB 任务只剩尾部 687 字符，任务正文全在头部所以必丢）。
 * 粘贴通道只送这个短引导，任务全文走文件、由 agent 自己 Read。 */
export const BOOTSTRAP = (mailbox: string) => `【live 轮次·先读任务】
你的任务全文在 ${mailbox}/task.md（含派单说明、live 契约和具体任务；路径同路径挂载，原样可用）。
第一步：用 Read 工具完整读取该文件，然后立刻按它干活，不要反问、不要待命。
完成后的收尾动作（写 ${mailbox}/receipt.md 与 touch ${mailbox}/DONE）按该文件里的契约执行，缺一不可。
`;

export function writeBootstrap(runDir: string) {
  writeFileSync(path.join(mailboxOf(runDir), "bootstrap.md"), BOOTSTRAP(mailboxOf(runDir)));
}

/** kernel 的 entry 目录跨轮次复用：开新轮前清掉上一轮的终态与信箱残留。 */
export function cleanForTurn(runDir: string) {
  for (const file of ["DONE", "receipt.md", "answer.txt", "answer-paste.txt", "question.json", "STOP", "bootstrap.md", "nudge.md"]) {
    rmSync(path.join(mailboxOf(runDir), file), { force: true });
  }
}

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
