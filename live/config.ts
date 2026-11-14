// live 会话的参数：默认值 ← ~/.agent-autoloop/live-config.json ← start 的 flags，后者顶前者。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export type LiveConfig = {
  agent: string;
  cwd: string;
  command: string;
  tmuxCwd: string;
  poll: number;
  stablePolls: number;
  idlePolls: number;
  nudgeAfterMin: number;
  killOnDone: boolean;
};

export const CONFIG_FILE = path.join(homedir(), ".agent-autoloop", "live-config.json");

export function defaults(): LiveConfig {
  return {
    agent: "glm-01",
    cwd: "/Users/jimmy/project/bbdown",
    command: "",
    tmuxCwd: "",
    poll: 2,
    stablePolls: 2,
    idlePolls: 150,
    nudgeAfterMin: 10,
    killOnDone: false,
  };
}

/** command 留空时按 agent/cwd 拼 container exec；给了就整个替换（宿主机冒烟用）。
 * IS_SANDBOX 必须显式带上：container exec 不走 bashrc，种子里的设置不生效。 */
export function sessionCommand(config: LiveConfig): string {
  return (
    config.command ||
    `container exec -it -e IS_SANDBOX=1 -w ${config.cwd} ${config.agent} claude --dangerously-skip-permissions`
  );
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
    else if (numbers.includes(key)) (merged[key] as unknown) = Number(given);
    else (merged[key] as unknown) = given;
  }
  return merged;
}
