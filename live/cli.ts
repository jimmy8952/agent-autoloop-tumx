// live-sentinel 命令行：start 起会话并转后台 watcher，其余都是看与答。
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readConfig, sessionCommand, type LiveConfig } from "./config.ts";
import * as mb from "./mailbox.ts";
import * as session from "./session.ts";
import { launch, watch } from "./watcher.ts";

const USAGE = `live-sentinel：tmux live 会话的哨兵（P1，独立于 kernel）

  live-sentinel start <名字> --prompt-file <任务文件> [--agent glm-01] [--cwd <容器内目录>] [--command <整条命令>]
  live-sentinel status [名字]
  live-sentinel answer <名字> <序号或文本>
  live-sentinel stop <名字> [--kill]
  live-sentinel watch --run <run目录>（内部用，start 会自己拉起）`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i] ?? fail(`${args[i]} 需要值`);
    else positional.push(args[i]);
  }
  return { positional, flags };
}

function runDirOf(name: string): string {
  if (!existsSync(mb.RUNS_ROOT)) fail("还没有任何 live 轮次。");
  const matches = readdirSync(mb.RUNS_ROOT)
    .filter((dir) => dir.startsWith("live-") && dir.endsWith(`-${name}`))
    .sort();
  const latest = matches.at(-1) ?? fail(`没找到 live 轮次：${name}`);
  return path.join(mb.RUNS_ROOT, latest);
}

async function start(args: string[]) {
  const { positional, flags } = parseFlags(args);
  const name = positional[0] ?? fail(USAGE);
  if (!flags["prompt-file"] || !existsSync(flags["prompt-file"])) fail("--prompt-file 必须指向存在的任务文件");
  if (session.sessionAlive(mb.sessionName(name))) fail(`tmux 会话 ${mb.sessionName(name)} 已经在了，先 stop 或换个名字`);
  const config = readConfig(flags);
  const runDir = mb.newRunDir(name);
  const prompt = mb.taskPrompt(runDir, flags["prompt-file"]);
  mb.writeTask(runDir, prompt);
  writeFileSync(path.join(runDir, "config.json"), JSON.stringify(config, null, 2));
  mb.logEvent(runDir, "starting", `会话 ${mb.sessionName(name)}`);
  session.newSession(mb.sessionName(name), sessionCommand(config), config.tmuxCwd || undefined);
  session.pipeLog(mb.sessionName(name), path.join(runDir, "live.log"));
  const state: mb.LiveState = {
    name,
    runDir,
    session: mb.sessionName(name),
    state: "launching",
    startedAt: new Date().toISOString(),
    stateSince: new Date().toISOString(),
    lastBeat: new Date().toISOString(),
  };
  mb.writeState(state);
  try {
    await launch(runDir, config);
  } catch (error) {
    state.state = "dead";
    state.error = String((error as Error).message);
    mb.writeState(state);
    session.killSession(mb.sessionName(name));
    fail(`启动失败：${state.error}`);
  }
  const entry = path.join(import.meta.dirname, "..", "bin", "live-sentinel.ts");
  const watcher = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", entry, "watch", "--run", runDir], {
    detached: true,
    stdio: "ignore",
  });
  watcher.unref();
  console.log(`live 任务已派出。run 目录：${runDir}`);
  console.log(`围观：tmux attach -t ${mb.sessionName(name)}；状态：live-sentinel status ${name}`);
}

async function watchRun(args: string[]) {
  const { flags } = parseFlags(args);
  if (!flags.run || !existsSync(flags.run)) fail("watch 需要 --run 指向存在的 run 目录");
  const config = JSON.parse((await import("node:fs")).readFileSync(path.join(flags.run, "config.json"), "utf8")) as LiveConfig;
  await watch(flags.run, config);
}

function status(name?: string) {
  if (!existsSync(mb.RUNS_ROOT)) return console.log("还没有任何 live 轮次。");
  const dirs = readdirSync(mb.RUNS_ROOT).filter((dir) => dir.startsWith("live-"));
  const shown = dirs
    .map((dir) => path.join(mb.RUNS_ROOT, dir))
    .filter((dir) => !name || dir.endsWith(`-${name}`))
    .map((dir) => mb.readState(dir))
    .filter((state): state is mb.LiveState => state !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!shown.length) return console.log(name ? `没找到 live 轮次：${name}` : "还没有任何 live 轮次。");
  for (const state of shown) {
    const stale = Date.now() - Date.parse(state.lastBeat) > 10_000 && !["done", "dead", "stopped"].includes(state.state);
    const minutes = Math.round((Date.now() - Date.parse(state.startedAt)) / 60_000);
    console.log(`${state.name}\t${state.state}${stale ? "（watcher 失联）" : ""}\t${minutes} 分钟\t${state.lastAction ?? ""}`);
    if (state.question) console.log(`  在问：${state.question.question}（选项 ${state.question.options.length} 个）`);
    if (state.error) console.log(`  错误：${state.error}`);
    console.log(`  ${state.runDir}`);
  }
}

function answer(name: string, words: string[]) {
  const runDir = runDirOf(name);
  const state = mb.readState(runDir);
  if (state?.state !== "question") fail(`当前状态是 ${state?.state ?? "未知"}，不在等回答；回答不会被消费`);
  writeFileSync(path.join(runDir, "mailbox", "answer.txt"), words.join(" "));
  console.log("已写入 answer.txt，watcher 会在画面稳定后代答。");
}

function stop(name: string, kill: boolean) {
  const runDir = runDirOf(name);
  writeFileSync(path.join(runDir, "mailbox", "STOP"), "");
  if (kill) session.killSession(mb.sessionName(name));
  console.log(kill ? "已发停令并杀会话。" : "已发停令（watcher 会退出，tmux 会话保留）。");
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "start":
    await start(rest);
    break;
  case "watch":
    await watchRun(rest);
    break;
  case "status":
    status(rest[0]);
    break;
  case "answer":
    rest.length >= 2 ? answer(rest[0], rest.slice(1)) : fail(USAGE);
    break;
  case "stop":
    stop(rest[0] ?? fail(USAGE), rest.includes("--kill"));
    break;
  default:
    fail(USAGE);
}
