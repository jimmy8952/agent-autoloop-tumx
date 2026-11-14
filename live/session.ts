// tmux 会话原语：哨兵的一切"看"（capture）与"答"（send/paste）都经过这里。
import { spawnSync } from "node:child_process";

export function tmux(args: string[]): string {
  const run = spawnSync("tmux", args, { encoding: "utf8", timeout: 15_000 });
  if (run.status !== 0) throw new Error(`tmux ${args.join(" ")} 失败：${(run.stderr ?? "").trim() || (run.stdout ?? "").trim()}`);
  return run.stdout ?? "";
}

/** has-session 用退出码说话，不能走会抛错的 tmux()。 */
export function sessionAlive(name: string): boolean {
  return spawnSync("tmux", ["has-session", "-t", name], { encoding: "utf8" }).status === 0;
}

export function newSession(name: string, command: string, cwd?: string) {
  tmux(["new-session", "-d", "-s", name, ...(cwd ? ["-c", cwd] : []), command]);
}

export function capture(name: string): string {
  return tmux(["capture-pane", "-p", "-t", name]);
}

/** 键名（"Enter"、"1"）走这里；文字见 sendLiteral。 */
export function sendKeys(name: string, keys: string[]) {
  tmux(["send-keys", "-t", name, ...keys]);
}

export function sendLiteral(name: string, text: string) {
  tmux(["send-keys", "-t", name, "-l", text]);
}

/** 长文本必须走粘贴（bracketed paste）：send-keys 逐字发送会把换行当成提交，任务被拦腰截断。 */
export function pasteFile(name: string, file: string) {
  tmux(["load-buffer", file]);
  tmux(["paste-buffer", "-t", name]);
}

/** 全量终端留底：黑匣子。命令由 tmux 经 sh -c 执行。 */
export function pipeLog(name: string, logFile: string) {
  tmux(["pipe-pane", "-t", name, "-o", `cat >> "${logFile}"`]);
}

export function killSession(name: string) {
  const run = spawnSync("tmux", ["kill-session", "-t", name], { encoding: "utf8" });
  const error = String(run.stderr ?? "");
  // 杀掉最后一个会话会把 tmux server 一起带走，报的是这句而不是 can't find session。
  if (run.status !== 0 && !error.includes("can't find session") && !error.includes("no server running"))
    throw new Error(error);
}
