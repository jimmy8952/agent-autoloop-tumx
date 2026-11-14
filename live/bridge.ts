// 桥接进程：worker 眼里的"agent"，实际是它起 tmux live 会话并当哨兵。
// stdout 铁律：全程静默，终态一次性打印（readMessage 的首行语义就是全部协议）；诊断只走 stderr 和 live.log。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readConfig, sessionCommand } from "./config.ts";
import * as mb from "./mailbox.ts";
import * as session from "./session.ts";
import { launch, watch } from "./watcher.ts";
import { finalText } from "./finals.ts";

const say = (text: string) => process.stderr.write(`[bridge] ${text}\n`);

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i] ?? "";
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const runDir = flags.folder;
  const promptFile = flags["prompt-file"];
  const name = flags.session;
  if (!runDir || !promptFile || !name) {
    say("需要 --folder <entry目录> --prompt-file <任务文件> --session <tmux会话名>");
    process.exit(1);
  }
  const config = readConfig(flags);
  config.kernel = true;
  mkdirSync(mb.mailboxOf(runDir), { recursive: true });
  // entry 目录跨轮次复用：上一轮的终态残留（DONE/receipt/STOP）必须清，会话名确定性复用所以旧的先杀。
  mb.cleanForTurn(runDir);
  session.killSession(name);
  mb.writeTask(runDir, mb.KERNEL_CONTRACT(mb.mailboxOf(runDir)) + readFileSync(promptFile, "utf8"));
  writeFileSync(path.join(runDir, "config.json"), JSON.stringify(config, null, 2));
  mb.logEvent(runDir, "starting", `kernel 轮次，会话 ${name}`);
  session.newSession(name, sessionCommand(config), config.tmuxCwd || undefined);
  session.pipeLog(name, path.join(runDir, "live.log"));
  const state: mb.LiveState = {
    name: `k:${path.basename(runDir)}`,
    runDir,
    session: name,
    kernel: true,
    state: "launching",
    startedAt: new Date().toISOString(),
    stateSince: new Date().toISOString(),
    lastBeat: new Date().toISOString(),
  };
  mb.writeState(state);
  let printed = false;
  const finish = (text: string) => {
    if (printed) return;
    printed = true;
    process.stdout.write(text);
    process.exit(0);
  };
  // worker 超时/取消发 SIGTERM（GRACE 30 秒）：抢在被打死前交超时终态；tmux 会话不杀，留人接管。
  process.on("SIGTERM", () => {
    state.error = "收到超时/取消信号";
    state.state = "dead";
    mb.writeState(state);
    finish(finalText("timeout", { runDir, session: name }));
  });
  process.on("SIGINT", () => finish(finalText("timeout", { runDir, session: name })));
  try {
    await launch(runDir, config);
  } catch (error) {
    state.state = "dead";
    state.error = String((error as Error).message);
    mb.writeState(state);
    session.killSession(name);
    say(`launch 失败：${state.error}`);
    finish(finalText("launch-failed", { runDir, session: name, reason: state.error }));
  }
  say("任务已注入，转观察循环");
  await watch(runDir, config);
  const ended = mb.readState(runDir)?.state;
  say(`watch 终态：${ended}`);
  if (ended === "done") {
    const receipt = mb.readReceipt(runDir);
    finish(receipt.trim() ? finalText("done", { runDir, session: name, receipt }) : finalText("done-no-receipt", { runDir, session: name }));
  }
  if (ended === "dead") finish(finalText("dead", { runDir, session: name }));
  finish(finalText("stopped", { runDir, session: name }));
}

await main();
