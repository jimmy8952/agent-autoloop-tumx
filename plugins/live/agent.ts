// live 适配器：rules.json 里 "use": "live" 的 agent 走这里。桥接进程就是"agent"——它起 tmux live 会话、
// 当哨兵，终态把 receipt 打到 stdout；readMessage 解析首行和回执块，kernel 其余机制原样生效。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { tail, type Adapter, type Turn } from "../../worker/agents.ts";

// tmux 会话名只认安全字符；kernel 的 session id 截一段就够用。
const safe = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30) || "k";

export default {
  command: (turn: Turn) => {
    // prompt 落盘再传路径：worker 会把 argv 安全转义进 command-N.sh，但整段任务正文走文件更稳，也留了审计底。
    const promptFile = path.join(turn.folder, "live-prompt.md");
    writeFileSync(promptFile, turn.prompt);
    return [
      process.execPath,
      "--disable-warning=ExperimentalWarning",
      path.join(import.meta.dirname, "..", "..", "live", "bridge.ts"),
      "--folder",
      turn.folder,
      "--prompt-file",
      promptFile,
      "--session",
      `live-k-${safe(turn.session)}`,
      ...(turn.cwd ? ["--cwd", turn.cwd] : []),
    ];
  },
  read(stdout, code, stderr) {
    if (code === null) return {};
    if (code !== 0) return { error: `退出码 ${code}：${tail(stderr || stdout) || "没留下原因"}` };
    return { text: stdout };
  },
  link: (session) => `tmux attach -t live-k-${safe(session)}`,
  check: () => {
    try {
      execFileSync("tmux", ["-V"], { stdio: "ignore" });
      return null;
    } catch {
      return "没找到 tmux：先 brew install tmux";
    }
  },
} satisfies Adapter;
