// live 会话的参数：默认值 ← ~/.agent-autoloop/live-config.json ← start 的 flags，后者顶前者。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export type LiveConfig = {
  agent: string;
  cwd: string;
  /** 进容器的 shell 命令（人路径：交互 bash）。留空按 agent/cwd 拼 container exec。 */
  command: string;
  /** 在 shell 提示符后敲入的 claude 启动命令；command 是直起 TUI 的覆盖时留空（跳过等提示符）。 */
  claudeCommand: string;
  tmuxCwd: string;
  poll: number;
  stablePolls: number;
  idlePolls: number;
  nudgeAfterMin: number;
  killOnDone: boolean;
  /** kernel 轮次（bridge 模式）：终态交给 worker 的 Result，DONE 不再桌面通知。 */
  kernel?: boolean;
  /** 监工大脑：宿主机 headless 程序（默认 claude -p），只在离散事件上唤醒。 */
  supervisor?: { program?: string; model?: string; maxVerdictsPerQuestion?: number };
};

export const CONFIG_FILE = path.join(homedir(), ".agent-autoloop", "live-config.json");

export function defaults(): LiveConfig {
  return {
    agent: "glm-01",
    cwd: "/Users/jimmy/project/bbdown",
    command: "",
    claudeCommand: "claude --dangerously-skip-permissions",
    tmuxCwd: "",
    poll: 2,
    stablePolls: 2,
    idlePolls: 150,
    nudgeAfterMin: 10,
    killOnDone: false,
  };
}

/** 人路径进入：先起交互 bash（.bashrc 的全套环境自然就位），提示符稳定后再敲 claudeCommand。
 * exec 直起命令不读任何 shell 初始化文件——烘进镜像的环境变量会静默丢失，别走回头路。
 * command 覆盖时整个替换（宿主机冒烟直起 TUI 用），此时 claudeCommand 应留空以跳过等提示符。 */
export function sessionCommand(config: LiveConfig): string {
  return config.command || `container exec -it -w ${config.cwd} ${config.agent} bash`;
}

export function readConfig(overrides: Record<string, string>): LiveConfig {
  const merged: LiveConfig = defaults();
  if (existsSync(CONFIG_FILE)) {
    const file = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<LiveConfig>;
    Object.assign(merged, file);
  }
  const numbers: (keyof LiveConfig)[] = ["poll", "stablePolls", "idlePolls", "nudgeAfterMin"];
  for (const key of Object.keys(merged) as (keyof LiveConfig)[]) {
    const given = overrides[key];
    if (given === undefined) continue;
    if (key === "killOnDone") (merged.killOnDone as unknown) = given === "true";
    else if (key === "kernel") (merged.kernel as unknown) = given === "true";
    else if (numbers.includes(key)) (merged[key] as unknown) = Number(given);
    else (merged[key] as unknown) = given;
  }
  return merged;
}
