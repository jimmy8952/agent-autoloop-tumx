// `agent-autoloop memory`: what the hub remembers, as GET /v1/memory has it. Only the hub's own memory: what went
// through it. An Agent's memory is its own and isn't here.
type Entry = { key: string; text: string; at: string };
type Matter = { key: string; rule: string; lane: string; state: string; card?: number; at?: string; latest: string };
type Memory = {
  instructions: string;
  owner: Entry[];
  proposed: { key: string; text: string; card: number | null }[];
  rules: { name: string; instructions: string; memory: Entry[]; used: number }[];
  open: Matter[];
  stalled: Matter[];
  lastDream: string | null;
  limits: { owner: { entry: number; total: number }; rule: { entry: number; total: number } };
};

const chars = (text: string) => [...text].length;

function matterLine({ rule, lane, state, card, latest }: Matter) {
  const where = lane ? `${rule} ${lane}` : rule;
  const waiting = card ? `（卡片 #${card}）` : "";
  return `  ${where}：${state}${waiting}${latest ? `，最新：${latest}` : ""}`;
}

export function memoryText(memory: Memory, rule?: string) {
  const out: string[] = [];
  const say = (line = "") => out.push(line);
  if (rule === undefined) {
    const used = memory.owner.reduce((total, entry) => total + chars(entry.text), 0);
    say(`关于你（${used}/${memory.limits.owner.total} 字）`);
    if (memory.instructions) say(`  长期要求（rules.json 的 instructions）：${memory.instructions}`);
    for (const entry of memory.owner) say(`  ${entry.key}：${entry.text}`);
    if (!memory.instructions && !memory.owner.length) say("  还没有");
    if (memory.proposed.length) {
      say();
      say("等你确认的提议");
      for (const entry of memory.proposed) {
        const card = entry.card ? `（卡片 #${entry.card}）` : "（下次整理时发卡片）";
        say(`  ${entry.key}：${entry.text}${card}`);
      }
    }
    say();
  }
  for (const one of memory.rules) {
    if (rule === undefined && !one.memory.length && !one.instructions) continue;
    say(`规则「${one.name}」的经验（${one.used}/${memory.limits.rule.total} 字）`);
    if (one.instructions) say(`  长期要求：${one.instructions}`);
    for (const entry of one.memory) say(`  ${entry.key}：${entry.text}`);
    if (!one.memory.length) say("  还没有");
    say();
  }
  if (memory.open.length) {
    say("进行中的事");
    for (const matter of memory.open) say(matterLine(matter));
    say();
  }
  if (memory.stalled.length) {
    say("搁置的事（空了 20 分钟、没说做完；再有往来会重新打开）");
    for (const matter of memory.stalled.slice(0, 20)) say(matterLine(matter));
    say();
  }
  say(memory.lastDream ? `上次整理：${memory.lastDream}` : "还没整理过（规则里写 dreams: true 的那一条负责整理）");
  say("忘掉一条：agent-autoloop forget <规则> <名字>，关于你的用 agent-autoloop forget --owner <名字>");
  return out.join("\n");
}
